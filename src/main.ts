import './style.css'
import { Timer } from 'three'
import { createElement, Network, Play, Pause, RotateCcw, Focus, ZoomIn, ZoomOut, Sun, Moon, Download, Copy, Route, SkipForward, ChevronRight, ChevronLeft, X, Camera, FileVideo, type IconNode } from 'lucide'
import { PipelineSimulation, SCENARIOS, frameBytes, type Backend, type Source, type LeakPolicy, type PipelineState } from './sim/model'
import { COLORS, REFERENCES, getProfile, deploymentRecipe } from './sim/profiles'
import { createCity } from './world/city'

const icon = (node: IconNode) => createElement(node, { width: '18', height: '18', 'stroke-width': '1.7', 'aria-hidden': 'true' }).outerHTML
const tool = (id: string, label: string, node: IconNode) => `<button type="button" class="icon-button" id="${id}" aria-label="${label}" title="${label}">${icon(node)}</button>`
const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <header class="app-header">
    <a class="brand" href="./" aria-label="GStreamer SimCity home">${icon(Network)}<span>GStreamer <strong>SimCity</strong></span></a>
    <div class="backend-switch" role="group" aria-label="Pipeline backend">
      <button data-backend="imsdk" aria-pressed="true"><small>QUALCOMM</small><span>IM SDK</span></button>
      <button data-backend="deepstream" aria-pressed="false"><small>NVIDIA</small><span>DeepStream</span></button>
    </div>
    <div class="header-actions"><button id="tour-start" class="command">${icon(Route)}<span>Guided tour</span></button>${tool('theme', 'Switch to day view', Sun)}${tool('export', 'Export simulation snapshot', Download)}</div>
  </header>
  <main class="workspace">
    <section class="stage" aria-label="Pipeline workspace">
      <div class="readouts">
        <div><span>OUTPUT / SIM</span><strong id="fps-value">0<small>fps</small></strong></div>
        <div><span>LATENCY / SIM</span><strong id="latency-value">0<small>ms</small></strong></div>
        <div><span>QUEUED</span><strong id="queue-value">0<small>/ 4</small></strong></div>
        <div><span>DROPPED</span><strong id="dropped-value">0</strong></div>
        <div class="state-readout"><span>PIPELINE STATE</span><strong id="phase">PLAYING</strong></div>
      </div>
      <div class="scene-surface">
        <div id="scene"></div>
        <div class="scene-heading"><p class="eyebrow">GSTREAMER / VISION PIPELINE</p><h1>Object detection</h1><p id="scene-context">Qualcomm IM SDK</p></div>
        <div class="view-switch segmented" role="group" aria-label="Camera view"><button data-view="city" aria-pressed="true">City</button><button data-view="plan" aria-pressed="false">Topology</button></div>
        <div class="camera-tools">${tool('home', 'Frame the pipeline', Focus)}${tool('zoom-in', 'Zoom in', ZoomIn)}${tool('zoom-out', 'Zoom out', ZoomOut)}<label class="label-toggle"><input type="checkbox" id="labels" checked>Labels</label></div>
        <section id="tour" class="tour-panel" aria-label="Guided pipeline tour" hidden>
          <div class="tour-top"><span id="tour-count" class="eyebrow"></span>${tool('tour-close', 'End guided tour', X)}</div>
          <h2 id="tour-title"></h2><p id="tour-description"></p>
          <div class="tour-bottom">${tool('tour-prev', 'Previous tour stage', ChevronLeft)}<div id="tour-progress"></div>${tool('tour-next', 'Next tour stage', ChevronRight)}</div>
        </section>
        <div class="scene-legend" aria-label="Dataflow legend"><span><i style="--swatch:${COLORS.video}"></i>Video</span><span><i style="--swatch:${COLORS.tensor}"></i>Tensors</span><span><i style="--swatch:${COLORS.metadata}"></i>Metadata</span><span><i style="--swatch:${COLORS.annotated}"></i>Video + results</span></div>
      </div>
      <div class="trace-band">
        <div class="frame-monitor"><canvas id="frame-preview" width="256" height="144" aria-label="Synthetic output frame, not a live camera"></canvas><div><span>SYNTHETIC OUTPUT</span><span id="frame-id">NO FRAME</span></div></div>
        <div class="history"><div class="history-title"><span class="eyebrow">PIPELINE TRACE / LAST 25s</span><span id="elapsed">00:00.0</span></div><canvas id="trace" aria-label="Simulated output rate and queue occupancy over time"></canvas><div class="trace-key"><span><i style="--swatch:${COLORS.video}"></i>Output: 0-60 fps</span><span><i style="--swatch:${COLORS.tensor}"></i>Queue: 0-capacity</span></div></div>
      </div>
      <div class="transport"><div class="transport-buttons">${tool('play', 'Pause simulation', Pause)}${tool('step', 'Advance one frame interval', SkipForward)}${tool('reset', 'Reset simulation', RotateCcw)}<button id="eos" class="text-command">Send EOS</button></div><label class="speed-label">PACE<select id="pace" aria-label="Simulation pace"><option value="0.25">0.25x</option><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="2">2x</option></select></label><span class="simulation-tag">SIMULATION / NOT A BENCHMARK</span></div>
    </section>
    <aside class="sidebar" aria-label="Pipeline details">
      <div class="profile-heading"><p class="eyebrow" id="profile-vendor"></p><h2 id="profile-name"></h2><p id="profile-target"></p></div>
      <div class="tabs" role="tablist" aria-label="Pipeline panels"><button role="tab" id="tab-run" data-tab="run" aria-selected="true" aria-controls="panel-run">Pipeline</button><button role="tab" id="tab-inspect" data-tab="inspect" aria-selected="false" aria-controls="panel-inspect" tabindex="-1">Inspector</button><button role="tab" id="tab-deploy" data-tab="deploy" aria-selected="false" aria-controls="panel-deploy" tabindex="-1">Deploy</button></div>
      <div class="panel-body">
        <div id="panel-run" role="tabpanel" aria-labelledby="tab-run">
          <section class="panel-section"><h3>Source &amp; state</h3><div class="source-switch segmented" role="group" aria-label="Pipeline source"><button data-source="camera" aria-pressed="true">${icon(Camera)}Camera</button><button data-source="file" aria-pressed="false">${icon(FileVideo)}Video file</button></div><label class="field">Pipeline state<select id="pipeline-state"><option>NULL</option><option>READY</option><option>PAUSED</option><option selected>PLAYING</option></select></label></section>
          <section class="panel-section"><h3>Timing model</h3><label class="field">Scenario<select id="scenario"><option value="balanced">Balanced pipeline</option><option value="pressure">Inference bottleneck</option><option value="realtime">Low-latency / leaky queue</option><option value="custom">Custom</option></select></label><label class="slider-field" for="input-fps"><span>Source cadence<output id="input-fps-output">30 fps</output></span><input id="input-fps" type="range" min="1" max="60" value="30"></label><label class="slider-field" for="inference-ms"><span>Inference service time<output id="inference-ms-output">24 ms</output></span><input id="inference-ms" type="range" min="5" max="200" value="24"></label><label class="slider-field" for="capacity"><span>Queue capacity<output id="capacity-output">4 buffers</output></span><input id="capacity" type="range" min="1" max="16" value="4"></label><label class="field">When the queue fills<select id="leak"><option value="none">Block upstream (leaky=no)</option><option value="downstream">Drop oldest (downstream)</option><option value="upstream">Drop newest (upstream)</option></select></label><p class="fine-print">User-set service times, identical across SDKs. No GPU or NPU performance is inferred.</p></section>
          <section class="panel-section"><h3>Buffer accounting</h3><dl class="accounting"><div><dt>Produced</dt><dd id="produced">0</dd></div><div><dt>Completed</dt><dd id="completed">0</dd></div><div><dt>In flight</dt><dd id="inflight">0</dd></div><div><dt>Blocked time</dt><dd id="blocked">0 ms</dd></div><div><dt>NV12 payload / frame</dt><dd>${(frameBytes(1280, 720, 'NV12') / 1024 / 1024).toFixed(2)} MiB</dd></div></dl></section>
          <section class="panel-section"><h3>Model events</h3><div id="events" class="events"></div></section>
        </div>
        <div id="panel-inspect" role="tabpanel" aria-labelledby="tab-inspect" hidden><section class="panel-section" id="inspector"></section><section class="panel-section"><h3>Element index</h3><div id="element-index" class="element-index"></div></section></div>
        <div id="panel-deploy" role="tabpanel" aria-labelledby="tab-deploy" hidden><section class="panel-section"><h3>Target requirements</h3><ol id="prerequisites"></ol></section><section class="panel-section"><div class="section-title"><h3>Launch notes</h3><div>${tool('copy-notes', 'Copy launch notes', Copy)}${tool('download-notes', 'Download launch notes', Download)}</div></div><pre><code id="recipe"></code></pre><p class="fine-print">Reference commands for an installed target SDK, not a runnable browser export.</p></section><section class="panel-section"><h3>Sources</h3><div class="source-links"><a href="${REFERENCES.workshop}" target="_blank" rel="noreferrer">Multi-Solutions Workshop</a><a href="${REFERENCES.deployment}" target="_blank" rel="noreferrer">Edge Impulse IM SDK deployment</a><a href="${REFERENCES.imsdk}" target="_blank" rel="noreferrer">Qualcomm QIM pipeline reference</a><a href="${REFERENCES.nvidia}" target="_blank" rel="noreferrer">NVIDIA DeepStream samples</a><a href="${REFERENCES.queue}" target="_blank" rel="noreferrer">GStreamer queue semantics</a></div></section></div>
      </div>
      <footer class="sidebar-footer"><span>Independent educational model</span><a href="https://github.com/eoinjordan/GstreamerSimCity" target="_blank" rel="noreferrer">Source</a></footer>
    </aside>
  </main><div id="notice" role="status" aria-live="polite"></div>`

function get<T extends HTMLElement = HTMLElement>(id: string) { return document.getElementById(id) as T }
const params = new URLSearchParams(location.search)
const simulation = new PipelineSimulation({ backend: params.get('backend') === 'deepstream' ? 'deepstream' : 'imsdk', source: params.get('source') === 'file' ? 'file' : 'camera' })
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
if (reducedMotion.matches) simulation.setState('PAUSED')
let profile = getProfile(simulation.settings.backend, simulation.settings.source)
let selected = 'inference'
let tab = 'run'
let day = false
let pace = 1
let tourIndex: number | null = null
let tourElapsed = 0
let noticeTimer: ReturnType<typeof setTimeout> | undefined
let uiElapsed = 0
let previousEvents = ''
let city: ReturnType<typeof createCity> | null = null

function setTab(next: string) {
  tab = next
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    const active = button.dataset.tab === tab
    button.setAttribute('aria-selected', String(active))
    button.tabIndex = active ? 0 : -1
    get(`panel-${button.dataset.tab}`).hidden = !active
  }
}

function inspect(id: string, focus = false) {
  selected = profile.nodes.some((node) => node.id === id) ? id : 'inference'
  const node = profile.nodes.find((item) => item.id === selected)!
  city?.select(selected)
  if (focus) city?.focus(selected)
  get('inspector').innerHTML = `<p class="eyebrow" style="color:${COLORS[node.kind]}">${node.kind.toUpperCase()} / ${profile.name}</p><h2>${node.title}</h2><code class="plugin-name">${node.plugin}</code><p class="description">${node.description}</p><dl class="properties"><div><dt>Input contract</dt><dd>${node.input}</dd></div><div><dt>Output contract</dt><dd>${node.output}</dd></div><div><dt>Execution context</dt><dd>${node.execution}</dd></div></dl><div class="caution"><span>VERIFICATION BOUNDARY</span><p>${node.caution}</p></div><a class="reference-link" href="${node.reference}" target="_blank" rel="noreferrer">Official reference ${icon(ChevronRight)}</a>`
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-inspect]')) button.setAttribute('aria-pressed', String(button.dataset.inspect === selected))
}

try {
  city = createCity(get<HTMLDivElement>('scene'), (id) => { stopTour(); inspect(id); setTab('inspect') })
} catch (error) {
  get('scene').innerHTML = '<div class="scene-error" role="alert"><h2>WebGL2 unavailable</h2><p>The pipeline model and inspector remain available.</p></div>'
  console.warn('WebGL initialization failed', error)
}

function rebuild() {
  stopTour()
  profile = getProfile(simulation.settings.backend, simulation.settings.source)
  city?.setProfile(profile)
  city?.home()
  app.dataset.backend = profile.id
  get('profile-vendor').textContent = `${profile.vendor.toUpperCase()} / GST PLUGINS`
  get('profile-name').textContent = `${profile.name} pipeline`
  get('profile-target').textContent = profile.target
  get('scene-context').textContent = `${profile.vendor} ${profile.name} / ${simulation.settings.source === 'camera' ? 'Camera' : 'Video file'} / 1280 x 720`
  get('element-index').innerHTML = profile.nodes.map((node, index) => `<button data-inspect="${node.id}" aria-pressed="false"><span class="node-number" style="color:${COLORS[node.kind]}">${String(index + 1).padStart(2, '0')}</span><span><strong>${node.title}</strong><small>${node.plugin}</small></span>${icon(ChevronRight)}</button>`).join('')
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-inspect]')) button.addEventListener('click', () => { stopTour(); inspect(button.dataset.inspect!, true) })
  get('prerequisites').replaceChildren(...profile.prerequisites.map((text) => { const item = document.createElement('li'); item.textContent = text; return item }))
  get('recipe').textContent = deploymentRecipe(simulation.settings)
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-backend]')) button.setAttribute('aria-pressed', String(button.dataset.backend === profile.id))
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-source]')) button.setAttribute('aria-pressed', String(button.dataset.source === simulation.settings.source))
  const url = new URL(location.href)
  url.searchParams.set('backend', profile.id)
  url.searchParams.set('source', simulation.settings.source)
  history.replaceState(null, '', url)
  inspect(selected)
  syncControls()
  updateUi()
}

function syncControls() {
  get<HTMLInputElement>('input-fps').value = String(simulation.settings.fps)
  get<HTMLInputElement>('inference-ms').value = String(simulation.settings.inferenceMs)
  get<HTMLInputElement>('capacity').value = String(simulation.settings.capacity)
  get<HTMLSelectElement>('leak').value = simulation.settings.leak
  get('input-fps-output').textContent = `${simulation.settings.fps} fps`
  get('inference-ms-output').textContent = `${simulation.settings.inferenceMs} ms`
  get('capacity-output').textContent = `${simulation.settings.capacity} buffers`
}

function notice(message: string) {
  clearTimeout(noticeTimer)
  get('notice').textContent = message
  get('notice').classList.add('visible')
  noticeTimer = setTimeout(() => get('notice').classList.remove('visible'), 2800)
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function togglePlay() {
  simulation.setState(simulation.state === 'PLAYING' ? 'PAUSED' : 'PLAYING')
  updateUi()
}

function stopTour() {
  tourIndex = null
  get('tour').hidden = true
  get('tour-start').setAttribute('aria-pressed', 'false')
}

function showTour(index: number) {
  if (index >= profile.tour.length) { stopTour(); city?.home(); return }
  const stageIndex = Math.max(0, index)
  tourIndex = stageIndex
  tourElapsed = 0
  const node = profile.nodes.find((item) => item.id === profile.tour[stageIndex])!
  city?.focus(node.id)
  inspect(node.id)
  get('tour').hidden = false
  get('tour-start').setAttribute('aria-pressed', 'true')
  get('tour-count').textContent = `GUIDED TOUR / ${tourIndex + 1} OF ${profile.tour.length}`
  get('tour-title').textContent = node.title
  get('tour-description').textContent = node.description
  get<HTMLButtonElement>('tour-prev').disabled = tourIndex === 0
  get('tour-progress').innerHTML = profile.tour.map((_, index) => `<i class="${index <= tourIndex! ? 'visited' : ''}"></i>`).join('')
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-backend]')) button.addEventListener('click', () => {
  if (button.dataset.backend === simulation.settings.backend) return
  simulation.configure({ backend: button.dataset.backend as Backend })
  rebuild()
})
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-source]')) button.addEventListener('click', () => {
  simulation.configure({ source: button.dataset.source as Source }); rebuild()
})
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
  button.addEventListener('click', () => setTab(button.dataset.tab!))
  button.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const tabs = ['run', 'inspect', 'deploy']
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 2)) % 3
    setTab(tabs[index]); get(`tab-${tabs[index]}`).focus()
  })
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) button.addEventListener('click', () => {
  stopTour(); city?.setView(button.dataset.view === 'plan')
  for (const other of document.querySelectorAll('[data-view]')) other.setAttribute('aria-pressed', String(other === button))
})
get('scenario').addEventListener('change', () => {
  const key = get<HTMLSelectElement>('scenario').value as keyof typeof SCENARIOS
  if (key in SCENARIOS) { simulation.configure(SCENARIOS[key]); syncControls(); updateUi() }
})
for (const [id, setting] of [['input-fps', 'fps'], ['inference-ms', 'inferenceMs'], ['capacity', 'capacity']] as const) {
  get(id).addEventListener('input', () => {
    simulation.configure({ [setting]: Number(get<HTMLInputElement>(id).value) })
    get<HTMLSelectElement>('scenario').value = 'custom'; syncControls(); updateUi()
  })
}
get('leak').addEventListener('change', () => {
  simulation.configure({ leak: get<HTMLSelectElement>('leak').value as LeakPolicy })
  get<HTMLSelectElement>('scenario').value = 'custom'; updateUi()
})
get('pipeline-state').addEventListener('change', () => { simulation.setState(get<HTMLSelectElement>('pipeline-state').value as PipelineState); updateUi() })
get('pace').addEventListener('change', () => { pace = Number(get<HTMLSelectElement>('pace').value) })
get('play').addEventListener('click', togglePlay)
get('reset').addEventListener('click', () => { simulation.reset(); stopTour(); city?.home(); updateUi() })
get('step').addEventListener('click', () => { simulation.setState('PLAYING'); simulation.advance(1000 / simulation.settings.fps); simulation.setState('PAUSED'); updateUi() })
get('eos').addEventListener('click', () => { simulation.requestEos(); updateUi() })
get('home').addEventListener('click', () => { stopTour(); city?.home() })
get('zoom-in').addEventListener('click', () => { stopTour(); city?.zoom(1) })
get('zoom-out').addEventListener('click', () => { stopTour(); city?.zoom(-1) })
get('labels').addEventListener('change', () => city?.setLabels(get<HTMLInputElement>('labels').checked))
get('theme').addEventListener('click', () => {
  day = !day; document.documentElement.dataset.theme = day ? 'day' : 'night'; city?.setDay(day)
  get('theme').innerHTML = icon(day ? Moon : Sun)
  get('theme').setAttribute('aria-label', day ? 'Switch to night view' : 'Switch to day view')
  get('theme').title = get('theme').getAttribute('aria-label')!
})
get('tour-start').addEventListener('click', () => tourIndex === null ? showTour(0) : stopTour())
get('tour-close').addEventListener('click', stopTour)
get('tour-prev').addEventListener('click', () => showTour((tourIndex ?? 0) - 1))
get('tour-next').addEventListener('click', () => showTour((tourIndex ?? 0) + 1))
get('copy-notes').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(deploymentRecipe(simulation.settings)); notice('Launch notes copied') }
  catch { notice('Clipboard unavailable. Download remains available.') }
})
get('download-notes').addEventListener('click', () => download(`${profile.id}-launch-notes.txt`, deploymentRecipe(simulation.settings), 'text/plain'))
get('export').addEventListener('click', () => {
  const snapshot = { schema: 'gstreamer-simcity/v1', kind: 'simulation-not-measurement', settings: simulation.settings, state: simulation.state, timeMs: simulation.time, counters: { produced: simulation.produced, completed: simulation.completed, dropped: simulation.dropped, inFlight: simulation.inFlight, blockedMs: simulation.blockedMs }, graph: { nodes: profile.nodes, links: profile.links }, trace: simulation.trace }
  download(`${profile.id}-simulation.json`, JSON.stringify(snapshot, null, 2), 'application/json')
  notice('Simulation snapshot exported')
})
document.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLElement && (event.target.matches('input, select, textarea, button, a') || event.target.isContentEditable) || event.ctrlKey || event.metaKey || event.altKey) return
  const key = event.key.toLowerCase()
  if (key === ' ' || key === 'p') { event.preventDefault(); togglePlay() }
  if (key === 't') tourIndex === null ? showTour(0) : stopTour()
  if (key === 'r') get('reset').click()
  if (key === 'h') get('home').click()
  if (key === 'n') get('theme').click()
  if (key === 'escape') stopTour()
  if (key === '1' || key === '2') document.querySelector<HTMLButtonElement>(`[data-backend="${key === '1' ? 'imsdk' : 'deepstream'}"]`)!.click()
})
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) { simulation.setState('PAUSED'); stopTour(); updateUi() } })

function drawTrace() {
  const canvas = get<HTMLCanvasElement>('trace')
  const width = Math.max(1, canvas.clientWidth)
  const height = Math.max(1, canvas.clientHeight)
  const scale = Math.min(devicePixelRatio, 2)
  if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale)
  }
  const context = canvas.getContext('2d')!
  context.setTransform(scale, 0, 0, scale, 0, 0)
  context.clearRect(0, 0, width, height)
  context.strokeStyle = day ? '#c6cfcf' : '#2d3538'; context.lineWidth = 1
  for (let index = 0; index < 5; index += 1) {
    context.beginPath(); context.moveTo(0, index * height / 4); context.lineTo(width, index * height / 4); context.stroke()
  }
  for (const [field, maximum, color] of [['fps', 60, day ? '#087c96' : COLORS.video], ['queue', simulation.settings.capacity, day ? '#9b6c11' : COLORS.tensor]] as const) {
    context.beginPath(); context.strokeStyle = color; context.lineWidth = 2
    simulation.trace.forEach((sample, index) => {
      const position = width * (1 - (simulation.time - sample.at) / 25000)
      const vertical = height - 3 - (height - 6) * Math.min(1, sample[field] / maximum)
      if (index === 0) context.moveTo(position, vertical); else context.lineTo(position, vertical)
    })
    context.stroke()
  }
}

function updateUi() {
  get('fps-value').innerHTML = `${simulation.fps.toFixed(0)}<small>fps</small>`
  get('latency-value').innerHTML = `${simulation.latency.toFixed(0)}<small>ms</small>`
  get('queue-value').innerHTML = `${simulation.queue.length}<small>/ ${simulation.settings.capacity}</small>`
  get('dropped-value').textContent = String(simulation.dropped)
  get('phase').textContent = simulation.phase
  get('phase').dataset.phase = simulation.phase
  for (const [id, value] of [['produced', simulation.produced], ['completed', simulation.completed], ['inflight', simulation.inFlight], ['blocked', `${simulation.blockedMs} ms`]] as const) get(id).textContent = String(value)
  const minutes = Math.floor(simulation.time / 60000)
  get('elapsed').textContent = `${String(minutes).padStart(2, '0')}:${(simulation.time / 1000 % 60).toFixed(1).padStart(4, '0')}`
  get('frame-id').textContent = simulation.lastFrame ? `#${String(simulation.lastFrame.id).padStart(5, '0')}` : 'NO FRAME'
  get<HTMLSelectElement>('pipeline-state').value = simulation.state
  const playing = simulation.state === 'PLAYING'
  const label = playing ? 'Pause simulation' : 'Play simulation'
  if (get('play').getAttribute('aria-label') !== label) { get('play').innerHTML = icon(playing ? Pause : Play); get('play').setAttribute('aria-label', label); get('play').title = label }
  get<HTMLButtonElement>('eos').disabled = simulation.eosRequested || simulation.state === 'NULL' || simulation.state === 'READY'
  const eventKey = simulation.events.map((event) => `${event.at}${event.kind}${event.message}`).join('|')
  if (previousEvents !== eventKey) {
    previousEvents = eventKey
    get('events').replaceChildren(...simulation.events.slice(0, 7).map((event) => {
      const row = document.createElement('div')
      const time = document.createElement('time'); time.textContent = `${(event.at / 1000).toFixed(2)}s`
      const message = document.createElement('span'); message.textContent = `${event.kind} / ${event.message}`
      row.append(time, message); return row
    }))
  }
  drawTrace()
  const preview = get<HTMLCanvasElement>('frame-preview').getContext('2d')!
  if (city) preview.drawImage(city.preview, 0, 0, 256, 144)
}

rebuild()
const timer = new Timer()
timer.connect(document)
let animationId = 0
function animate(timestamp: number) {
  animationId = requestAnimationFrame(animate)
  timer.update(timestamp)
  const delta = Math.max(0, Math.min(timer.getDelta(), 0.1))
  simulation.advance(delta * 1000 * pace)
  city?.render(simulation, delta)
  if (tourIndex !== null && !reducedMotion.matches) {
    tourElapsed += delta
    if (tourElapsed > 7) showTour(tourIndex + 1)
  }
  uiElapsed += delta
  if (uiElapsed >= 0.1) { updateUi(); uiElapsed = 0 }
}
animationId = requestAnimationFrame(animate)
if (import.meta.hot) import.meta.hot.dispose(() => { cancelAnimationFrame(animationId); timer.dispose(); city?.dispose() })
