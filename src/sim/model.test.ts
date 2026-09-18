import assert from 'node:assert/strict'
import test from 'node:test'
import { PipelineSimulation, frameBytes, SCENARIOS } from './model.ts'
import { getProfile, deploymentRecipe } from './profiles.ts'

test('platform graphs are linked, inspectable, and use separate inference contracts', () => {
  for (const backend of ['imsdk', 'deepstream'] as const) for (const source of ['camera', 'file'] as const) {
    const profile = getProfile(backend, source)
    const ids = new Set(profile.nodes.map((node) => node.id))
    assert.equal(ids.size, profile.nodes.length)
    for (const edge of profile.links) {
      assert.ok(ids.has(edge.from) && ids.has(edge.to))
      assert.notEqual(edge.from, edge.to)
    }
    for (const id of profile.tour) assert.ok(ids.has(id))
    assert.ok(profile.nodes.every((node) => node.reference.startsWith('https://') && node.description && node.caution))
    assert.equal(ids.has('tee'), backend === 'imsdk')
    assert.equal(ids.has('batch'), backend === 'deepstream')
    const inference = profile.nodes.find((node) => node.id === 'inference')!
    assert.equal(inference.plugin, backend === 'imsdk' ? 'qtimltflite' : 'nvinfer')
  }
})

test('deployment recipes retain workshop commands without pretending models are interchangeable', () => {
  const simulation = new PipelineSimulation({ source: 'file' })
  assert.match(deploymentRecipe(simulation.settings), /run-file-pipeline.sh --in-file/)
  simulation.configure({ backend: 'deepstream' })
  const recipe = deploymentRecipe(simulation.settings)
  assert.match(recipe, /gst-inspect-1.0 nvinfer/)
  assert.doesNotMatch(recipe, /run-file-pipeline|qtimltflite/)
})

test('balanced pipeline keeps pace without loss or upstream blocking', () => {
  const simulation = new PipelineSimulation()
  simulation.advance(10000)
  assert.ok(simulation.completed >= 290)
  assert.equal(simulation.dropped, 0)
  assert.equal(simulation.blockedMs, 0)
  assert.equal(simulation.produced, simulation.completed + simulation.inFlight)
})

test('bounded non-leaky queue blocks without losing frames', () => {
  const simulation = new PipelineSimulation(SCENARIOS.pressure)
  simulation.advance(10000)
  assert.ok(simulation.blockedMs > 0)
  assert.ok(simulation.queue.length <= simulation.settings.capacity)
  assert.equal(simulation.dropped, 0)
  assert.equal(simulation.produced, simulation.completed + simulation.inFlight)
})

test('downstream leakage bounds latency and counts discarded old buffers', () => {
  const blocked = new PipelineSimulation(SCENARIOS.pressure)
  const leaky = new PipelineSimulation(SCENARIOS.realtime)
  blocked.advance(10000)
  leaky.advance(10000)
  assert.ok(leaky.dropped > 0)
  assert.equal(leaky.blockedMs, 0)
  assert.ok(leaky.latency < blocked.latency)
  assert.equal(leaky.produced, leaky.completed + leaky.inFlight + leaky.dropped)
})

test('leak policies discard opposite ends of the queue', () => {
  const newest = new PipelineSimulation({ inferenceMs: 200, capacity: 2, leak: 'upstream' })
  const oldest = new PipelineSimulation({ inferenceMs: 200, capacity: 2, leak: 'downstream' })
  newest.advance(140)
  oldest.advance(140)
  assert.deepEqual(newest.queue.map((frame) => frame.id), [1, 2])
  assert.deepEqual(oldest.queue.map((frame) => frame.id), [3, 4])
})

test('backend changes clear all buffers, traces, and results', () => {
  const simulation = new PipelineSimulation(SCENARIOS.pressure)
  simulation.advance(2000)
  simulation.configure({ backend: 'deepstream' })
  assert.equal(simulation.settings.backend, 'deepstream')
  assert.equal(simulation.time, 0)
  assert.equal(simulation.inFlight, 0)
  assert.equal(simulation.lastFrame, null)
  assert.equal(simulation.completed, 0)
  assert.equal(simulation.trace.length, 0)
  simulation.configure({ backend: 'imsdk' })
  assert.equal(simulation.settings.backend, 'imsdk')
})

test('pause freezes all simulated time and stepping is partition invariant', () => {
  const partitioned = new PipelineSimulation()
  const whole = new PipelineSimulation()
  for (let index = 0; index < 100; index += 1) partitioned.advance(17)
  whole.advance(1700)
  assert.deepEqual(partitioned, whole)
  whole.setState('PAUSED')
  const before = JSON.stringify(whole)
  whole.advance(1000)
  assert.equal(JSON.stringify(whole), before)
})

test('EOS drains pending, queued, processing, and output buffers', () => {
  const simulation = new PipelineSimulation(SCENARIOS.pressure)
  simulation.advance(1000)
  simulation.requestEos()
  const produced = simulation.produced
  simulation.advance(10000)
  assert.equal(simulation.ended, true)
  assert.equal(simulation.completed, produced)
  assert.equal(simulation.inFlight, 0)
  assert.equal(simulation.produced, produced)
  simulation.setState('PLAYING')
  assert.equal(simulation.ended, false)
  assert.equal(simulation.produced, 0)
})

test('file source has a finite length and NULL clears pipeline resources', () => {
  const simulation = new PipelineSimulation({ source: 'file' })
  simulation.advance(12000)
  assert.equal(simulation.produced, 300)
  assert.equal(simulation.completed, 300)
  assert.equal(simulation.phase, 'EOS')
  simulation.setState('NULL')
  assert.equal(simulation.inFlight, 0)
  assert.equal(simulation.time, 0)
  assert.equal(simulation.phase, 'NULL')
})

test('buffer sizes use binary byte arithmetic, without stride overhead', () => {
  assert.equal(frameBytes(1280, 720, 'NV12'), 1382400)
  assert.equal(frameBytes(1280, 720, 'RGBA'), 3686400)
  assert.throws(() => frameBytes(1279, 720, 'NV12'), RangeError)
})

test('invalid configuration or elapsed time is rejected', () => {
  for (const settings of [{ fps: NaN }, { capacity: 0 }, { inferenceMs: Infinity }, { fps: 61 }]) {
    assert.throws(() => new PipelineSimulation(settings), RangeError)
  }
  const simulation = new PipelineSimulation()
  assert.throws(() => simulation.advance(Infinity), RangeError)
  assert.throws(() => simulation.advance(-1), RangeError)
  assert.throws(() => simulation.configure({ capacity: 99 }), RangeError)
  assert.equal(simulation.settings.capacity, 4)
})