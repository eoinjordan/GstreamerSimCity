export type Backend = 'imsdk' | 'deepstream'
export type Source = 'camera' | 'file'
export type LeakPolicy = 'none' | 'upstream' | 'downstream'
export type PipelineState = 'NULL' | 'READY' | 'PAUSED' | 'PLAYING'

export interface Settings {
  backend: Backend
  source: Source
  fps: number
  inferenceMs: number
  capacity: number
  leak: LeakPolicy
}

export const DEFAULTS: Readonly<Settings> = {
  backend: 'imsdk', source: 'camera', fps: 30, inferenceMs: 24, capacity: 4, leak: 'none',
}

export const SCENARIOS = {
  balanced: { fps: 30, inferenceMs: 24, capacity: 4, leak: 'none' },
  pressure: { fps: 30, inferenceMs: 90, capacity: 6, leak: 'none' },
  realtime: { fps: 30, inferenceMs: 90, capacity: 2, leak: 'downstream' },
} as const

export interface Frame { id: number; pts: number }
export interface Job { frame: Frame; started: number; ready: number }
export interface ModelEvent { at: number; kind: string; message: string }
export interface Trace { at: number; fps: number; queue: number; latency: number }

function validate(settings: Settings): void {
  if (!['imsdk', 'deepstream'].includes(settings.backend) || !['camera', 'file'].includes(settings.source)
    || !['none', 'upstream', 'downstream'].includes(settings.leak)
    || !Number.isInteger(settings.fps) || settings.fps < 1 || settings.fps > 60
    || !Number.isInteger(settings.inferenceMs) || settings.inferenceMs < 5 || settings.inferenceMs > 200
    || !Number.isInteger(settings.capacity) || settings.capacity < 1 || settings.capacity > 16) {
    throw new RangeError('Invalid pipeline settings')
  }
}

export function frameBytes(width: number, height: number, format: 'NV12' | 'RGBA'): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || (format === 'NV12' && (width % 2 !== 0 || height % 2 !== 0))) {
    throw new RangeError('NV12 requires positive, even frame dimensions')
  }
  return width * height * (format === 'NV12' ? 1.5 : 4)
}

export class PipelineSimulation {
  settings: Settings
  state: PipelineState = 'PLAYING'
  time = 0
  produced = 0
  completed = 0
  dropped = 0
  blockedMs = 0
  queue: Frame[] = []
  pending: Frame | null = null
  job: Job | null = null
  output: Job[] = []
  lastFrame: Frame | null = null
  lastDropped: Frame | null = null
  eosRequested = false
  ended = false
  events: ModelEvent[] = []
  trace: Trace[] = []
  private remainder = 0
  private nextFrameAt = 0
  private completionTimes: number[] = []
  private latencies: number[] = []
  private nextTraceAt = 250
  private lastOverrunAt = -1000

  constructor(settings: Partial<Settings> = {}) {
    this.settings = { ...DEFAULTS, ...settings }
    validate(this.settings)
    this.log('STATE', 'NULL > READY > PAUSED > PLAYING')
    this.log('PROFILE', this.settings.backend === 'imsdk' ? 'Qualcomm IM SDK / QCS6490' : 'NVIDIA DeepStream / Jetson')
  }

  get fps(): number {
    return this.completionTimes.length / Math.max(1, Math.min(1000, this.time) / 1000)
  }

  get latency(): number {
    return this.latencies.length ? this.latencies.reduce((sum, value) => sum + value, 0) / this.latencies.length : 0
  }

  get inFlight(): number {
    return this.queue.length + Number(this.pending !== null) + Number(this.job !== null) + this.output.length
  }

  get phase(): string {
    if (this.ended) return 'EOS'
    if (this.state !== 'PLAYING') return this.state
    if (this.eosRequested) return 'DRAINING'
    if (this.pending) return 'BACKPRESSURE'
    return 'PLAYING'
  }

  configure(patch: Partial<Settings>): void {
    const settings = { ...this.settings, ...patch }
    validate(settings)
    this.settings = settings
    this.reset()
  }

  reset(): void {
    this.time = 0
    this.produced = 0
    this.completed = 0
    this.dropped = 0
    this.blockedMs = 0
    this.queue = []
    this.pending = null
    this.job = null
    this.output = []
    this.lastFrame = null
    this.lastDropped = null
    this.eosRequested = false
    this.ended = false
    this.remainder = 0
    this.nextFrameAt = 0
    this.completionTimes = []
    this.latencies = []
    this.trace = []
    this.events = []
    this.nextTraceAt = 250
    this.lastOverrunAt = -1000
    this.log('RESET', `${this.settings.backend} / ${this.settings.source}; buffers cleared`)
  }

  setState(state: PipelineState): void {
    if (!['NULL', 'READY', 'PAUSED', 'PLAYING'].includes(state)) throw new RangeError('Invalid pipeline state')
    const previous = this.state
    if (state === 'NULL' || state === 'READY' || (state === 'PLAYING' && this.ended)) this.reset()
    this.state = state
    this.log('STATE', `${previous} > ${state}`)
  }

  requestEos(): void {
    if (this.eosRequested) return
    this.eosRequested = true
    this.log('EVENT', 'EOS requested; draining queued buffers')
  }

  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 60000) throw new RangeError('Invalid simulation delta')
    if (this.state !== 'PLAYING' || this.ended) return
    this.remainder += milliseconds
    while (this.remainder >= 5 && !this.ended) {
      this.remainder -= 5
      this.step()
    }
  }

  private log(kind: string, message: string): void {
    this.events.unshift({ at: this.time, kind, message })
    this.events.length = Math.min(this.events.length, 32)
  }

  private enqueue(frame: Frame): void {
    if (this.queue.length < this.settings.capacity) {
      this.queue.push(frame)
      return
    }
    if (this.time - this.lastOverrunAt >= 1000) {
      this.log('SIGNAL', `queue overrun / ${this.settings.leak === 'none' ? 'upstream blocked' : `leaky=${this.settings.leak}`}`)
      this.lastOverrunAt = this.time
    }
    if (this.settings.leak === 'none') {
      this.pending = frame
    } else {
      this.dropped += 1
      if (this.settings.leak === 'upstream') this.lastDropped = frame
      else {
        this.lastDropped = this.queue.shift()!
        this.queue.push(frame)
      }
    }
  }

  private step(): void {
    this.time += 5
    while (this.output.length && this.output[0].ready <= this.time) {
      const result = this.output.shift()!
      this.completed += 1
      this.lastFrame = result.frame
      this.completionTimes.push(this.time)
      this.latencies.push(this.time - result.frame.pts)
      if (this.latencies.length > 60) this.latencies.shift()
    }
    if (this.job && this.job.ready <= this.time) {
      this.output.push({ ...this.job, started: this.time, ready: this.time + 5 })
      this.job = null
    }
    if (!this.job && this.queue.length) this.startJob()
    if (this.pending) {
      if (this.queue.length < this.settings.capacity) {
        this.queue.push(this.pending)
        this.pending = null
        this.nextFrameAt = this.time + 1000 / this.settings.fps
      } else this.blockedMs += 5
    }
    if (!this.eosRequested && !this.pending && this.time >= this.nextFrameAt) {
      const frame = { id: this.produced++, pts: this.time }
      this.enqueue(frame)
      this.nextFrameAt += 1000 / this.settings.fps
      if (this.settings.source === 'file' && this.produced >= 300) this.requestEos()
    }
    if (!this.job && this.queue.length) this.startJob()
    this.completionTimes = this.completionTimes.filter((at) => at > this.time - 1000)
    if (this.time >= this.nextTraceAt) {
      this.trace.push({ at: this.time, fps: this.fps, queue: this.queue.length, latency: this.latency })
      if (this.trace.length > 100) this.trace.shift()
      this.nextTraceAt += 250
    }
    if (this.eosRequested && this.inFlight === 0) {
      this.ended = true
      this.state = 'PAUSED'
      this.log('BUS', 'EOS / all accepted buffers drained')
    }
  }

  private startJob(): void {
    this.job = { frame: this.queue.shift()!, started: this.time, ready: this.time + this.settings.inferenceMs + 5 }
  }
}