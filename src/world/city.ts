import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { COLORS, type Element, type Profile } from '../sim/profiles'
import type { PipelineSimulation } from '../sim/model'

interface District {
  element: Element
  group: THREE.Group
  label: HTMLButtonElement
  outline: THREE.LineSegments
  slots: THREE.Mesh[]
  lights: THREE.Mesh[]
  height: number
}

interface Transport {
  curve: THREE.CurvePath<THREE.Vector3>
  packets: THREE.Mesh[]
  from: string
  downstream: boolean
}

export function createCity(host: HTMLDivElement, onPick: (id: string) => void) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#121516')
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D GStreamer pipeline')
  renderer.domElement.tabIndex = 0
  host.append(renderer.domElement)
  const labelLayer = document.createElement('div')
  labelLayer.className = 'world-labels'
  host.append(labelLayer)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 8
  controls.maxDistance = 90
  controls.maxPolarAngle = Math.PI * 0.46
  controls.target.set(0, 0, 0)
  controls.enablePan = false
  const light = new THREE.HemisphereLight(0xf4fbff, 0x34342e, 2.7)
  const sun = new THREE.DirectionalLight(0xfff4df, 3)
  sun.position.set(-12, 25, 15)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -22
  sun.shadow.camera.right = 22
  sun.shadow.camera.top = 18
  sun.shadow.camera.bottom = -18
  sun.shadow.normalBias = 0.04
  scene.add(light, sun)

  const cube = new THREE.BoxGeometry(1, 1, 1)
  const materials = new Map<string, THREE.MeshStandardMaterial>()
  const disposableGeometry: THREE.BufferGeometry[] = []
  function material(color: string) {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, metalness: 0.18, roughness: 0.6 }))
    return materials.get(color)!
  }
  function box(parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], color: string) {
    const mesh = new THREE.Mesh(cube, material(color))
    mesh.scale.set(...size)
    mesh.position.set(...position)
    mesh.castShadow = true
    mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const ground = box(scene, [33, 0.5, 17], [0.5, -0.36, 0], '#252b2d')
  box(scene, [33.5, 0.15, 17.5], [0.5, -0.68, 0], '#454c4e')
  const grid = new THREE.GridHelper(34, 34, 0x465053, 0x30383a)
  grid.position.y = -0.09
  scene.add(grid)
  const buildings = new THREE.Group()
  const roads = new THREE.Group()
  scene.add(buildings, roads)
  const districts: District[] = []
  const transports: Transport[] = []
  const selectable: THREE.Object3D[] = []
  let selected = 'inference'
  let labelsVisible = true
  let planView = false
  let flight: { position: THREE.Vector3; target: THREE.Vector3 } | null = null
  let lastInput = -2
  let lastOutput = -2
  const motion = matchMedia('(prefers-reduced-motion: reduce)')
  const inputCanvas = document.createElement('canvas')
  const outputCanvas = document.createElement('canvas')
  for (const canvas of [inputCanvas, outputCanvas]) { canvas.width = 512; canvas.height = 288 }
  const inputTexture = new THREE.CanvasTexture(inputCanvas)
  const outputTexture = new THREE.CanvasTexture(outputCanvas)
  inputTexture.colorSpace = outputTexture.colorSpace = THREE.SRGBColorSpace

  function drawFrame(canvas: HTMLCanvasElement, frame: number, annotated: boolean) {
    const context = canvas.getContext('2d')!
    context.fillStyle = '#233239'
    context.fillRect(0, 0, 512, 288)
    context.fillStyle = '#425157'
    context.fillRect(0, 182, 512, 84)
    context.strokeStyle = '#64757a'
    context.lineWidth = 2
    for (let line = 0; line < 12; line += 1) {
      const offset = ((line * 50 + Math.max(frame, 0) * 5) % 600) - 40
      context.beginPath(); context.moveTo(offset, 184); context.lineTo(offset - 35, 266); context.stroke()
    }
    for (let index = 0; index < 3; index += 1) {
      const offset = (index * 165 + Math.max(frame, 0) * 3) % 530 - 55
      const top = 110 + index * 12
      context.fillStyle = ['#e4b85f', '#7fc1be', '#e19387'][index]
      context.fillRect(offset, top, 64, 92)
      context.fillStyle = '#dbe2dc'
      context.fillRect(offset + 18, top + 20, 28, 17)
      if (annotated && frame >= 0) {
        context.strokeStyle = '#bbec8b'; context.lineWidth = 3
        context.strokeRect(offset - 7, top - 7, 78, 106)
      }
    }
    context.fillStyle = '#d7e5df'
    context.font = '16px monospace'
    context.fillText(frame < 0 ? 'NO COMPLETED FRAME' : `SYNTHETIC BUFFER ${String(frame).padStart(5, '0')}`, 18, 29)
    context.fillStyle = '#a8bdc3'
    context.fillText(annotated ? 'ILLUSTRATIVE OVERLAY' : '1280 x 720 / NV12', 18, 278)
  }

  function screen(parent: THREE.Object3D, output: boolean) {
    box(parent, [2.15, 1.35, 0.16], [0, 1.45, 0.5], '#414e54')
    const geometry = new THREE.PlaneGeometry(1.95, 1.1)
    disposableGeometry.push(geometry)
    const screenMaterial = new THREE.MeshBasicMaterial({ map: output ? outputTexture : inputTexture })
    const monitor = new THREE.Mesh(geometry, screenMaterial)
    monitor.position.set(0, 1.46, 0.59)
    parent.add(monitor)
    box(parent, [0.25, 0.7, 0.25], [0, 0.46, 0.48], '#839499')
    box(parent, [1.2, 0.12, 0.7], [0, 0.18, 0.48], '#576568')
  }

  function makeDistrict(element: Element): District {
    const group = new THREE.Group()
    group.position.set(element.position[0], 0, element.position[1])
    group.userData.elementId = element.id
    buildings.add(group)
    selectable.push(group)
    const color = COLORS[element.kind]
    const base = box(group, [2.85, 0.22, 2.6], [0, 0.04, 0], '#4b5557')
    base.userData.elementId = element.id
    box(group, [2.5, 0.06, 2.28], [0, 0.19, 0], color)
    const slots: THREE.Mesh[] = []
    const lights: THREE.Mesh[] = []
    let height = 2
    if (element.kind === 'sink' || element.kind === 'source') {
      screen(group, element.kind === 'sink')
      for (let index = 0; index < 3; index += 1) box(group, [0.38, 0.12, 0.3], [index * 0.55 - 0.55, 0.3, -0.65], color)
    } else if (element.kind === 'queue') {
      box(group, [2.2, 1.55, 1.35], [0, 0.97, -0.1], '#364046')
      for (let index = 0; index < 16; index += 1) {
        slots.push(box(group, [0.44, 0.21, 0.35], [(index % 4 - 1.5) * 0.5, 0.4 + Math.floor(index / 4) * 0.35, 0.67], '#e6bf6b'))
      }
      height = 1.85
    } else if (element.kind === 'inference') {
      box(group, [2.2, 0.6, 2], [0, 0.5, 0], '#424c44')
      for (let row = 0; row < 4; row += 1) for (let column = 0; column < 4; column += 1) {
        const towerHeight = 0.85 + ((row + column) % 3) * 0.24
        const tower = box(group, [0.36, towerHeight, 0.36], [(column - 1.5) * 0.48, 0.8 + towerHeight / 2, (row - 1.5) * 0.48], '#83b760')
        lights.push(tower)
      }
      for (const side of [-1, 1]) for (let pin = 0; pin < 6; pin += 1) box(group, [0.22, 0.09, 0.12], [side * 1.18, 0.45, (pin - 2.5) * 0.29], '#d8dec8')
      height = 2.6
    } else if (element.kind === 'split' || element.kind === 'join') {
      box(group, [1.9, 0.65, 1.8], [0, 0.57, 0], '#435653')
      for (const side of [-1, 1]) {
        box(group, [0.65, 0.35, 0.4], [side * 0.65, 1.03, side * 0.5], color)
        lights.push(box(group, [0.18, 0.18, 0.18], [side * 0.65, 1.29, side * 0.5], '#cfece1'))
      }
      height = 1.6
    } else if (element.kind === 'metadata' || element.kind === 'overlay') {
      for (let layer = 0; layer < 3; layer += 1) {
        const size: [number, number, number] = [1.55, 0.13, 1.55]
        lights.push(box(group, size, [layer * 0.16 - 0.16, 0.6 + layer * 0.48, 0], color))
        for (const side of [-1, 1]) box(group, [0.08, 0.36, 1.4], [side * 0.7 + layer * 0.16 - 0.16, 0.8 + layer * 0.48, 0], '#f0d7e6')
      }
      height = 2.2
    } else {
      box(group, [2.1, 1.2, 1.7], [0, 0.84, 0], '#537586')
      for (let index = 0; index < 6; index += 1) lights.push(box(group, [0.21, 0.15, 1.45], [(index - 2.5) * 0.3, 1.52, 0], color))
      height = 1.95
    }
    const outlineGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(3, height + 0.3, 2.8))
    disposableGeometry.push(outlineGeometry)
    const outline = new THREE.LineSegments(outlineGeometry, new THREE.LineBasicMaterial({ color: '#efface', transparent: true, opacity: 0.9 }))
    outline.position.y = height / 2
    outline.visible = element.id === selected
    group.add(outline)
    const label = document.createElement('button')
    label.className = 'world-label'
    label.style.setProperty('--district', color)
    label.dataset.element = element.id
    label.title = `${element.title}: ${element.plugin}`
    label.setAttribute('aria-label', `Inspect ${element.title}`)
    const title = document.createElement('strong'); title.textContent = element.title
    const plugin = document.createElement('span'); plugin.textContent = element.plugin
    label.append(title, plugin)
    label.addEventListener('click', () => onPick(element.id))
    labelLayer.append(label)
    return { element, group, label, outline, slots, lights, height }
  }

  function clearProfile() {
    for (const district of districts) {
      district.label.remove()
      district.group.traverse((object) => {
        if (object instanceof THREE.Mesh && object.material instanceof THREE.MeshBasicMaterial) object.material.dispose()
      })
      ;(district.outline.material as THREE.Material).dispose()
    }
    for (const geometry of disposableGeometry) geometry.dispose()
    disposableGeometry.length = 0
    districts.length = 0
    transports.length = 0
    selectable.length = 0
    buildings.clear()
    roads.clear()
  }

  function setProfile(profile: Profile) {
    clearProfile()
    for (const element of profile.nodes) districts.push(makeDistrict(element))
    for (const edge of profile.links) {
      const source = profile.nodes.find((node) => node.id === edge.from)!
      const target = profile.nodes.find((node) => node.id === edge.to)!
      const start = new THREE.Vector3(source.position[0], 0.38, source.position[1])
      const end = new THREE.Vector3(target.position[0], 0.38, target.position[1])
      const direction = new THREE.Vector3().subVectors(end, start)
      const horizontal = Math.abs(direction.x) > 0.5
      if (horizontal) { start.x += Math.sign(direction.x) * 1.43; end.x -= Math.sign(direction.x) * 1.43 }
      else { start.z += Math.sign(direction.z) * 1.3; end.z -= Math.sign(direction.z) * 1.3 }
      const midpoint = (start.x + end.x) / 2
      const points = [start, new THREE.Vector3(midpoint, 0.38, start.z), new THREE.Vector3(midpoint, 0.38, end.z), end]
      const curve = new THREE.CurvePath<THREE.Vector3>()
      for (let index = 1; index < points.length; index += 1) if (points[index - 1].distanceTo(points[index]) > 0.001) curve.add(new THREE.LineCurve3(points[index - 1], points[index]))
      const geometry = new THREE.TubeGeometry(curve, 32, 0.055, 5, false)
      disposableGeometry.push(geometry)
      roads.add(new THREE.Mesh(geometry, material(COLORS[edge.payload])))
      const arrowGeometry = new THREE.ConeGeometry(0.18, 0.45, 5)
      disposableGeometry.push(arrowGeometry)
      const arrow = new THREE.Mesh(arrowGeometry, material(COLORS[edge.payload]))
      arrow.position.copy(curve.getPoint(0.72))
      arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(0.72))
      roads.add(arrow)
      const packets = Array.from({ length: 7 }, () => {
        const packet = box(roads, [0.24, 0.18, 0.34], [0, 0.6, 0], COLORS[edge.payload])
        packet.castShadow = false
        return packet
      })
      transports.push({ curve, packets, from: edge.from, downstream: ['inference', 'postprocess', 'join', 'overlay'].includes(edge.from) })
    }
    select(selected)
    host.dataset.profile = profile.id
    host.dataset.nodes = String(districts.length)
  }

  function select(id: string) {
    selected = id
    for (const district of districts) {
      const active = district.element.id === id
      district.outline.visible = active
      district.label.classList.toggle('selected', active)
      district.label.setAttribute('aria-pressed', String(active))
    }
  }

  function move(position: THREE.Vector3, target: THREE.Vector3, immediate = false) {
    if (motion.matches || immediate) { camera.position.copy(position); controls.target.copy(target); flight = null }
    else flight = { position, target }
  }

  function home(immediate = false) {
    const aspect = Math.max(0.35, host.clientWidth / Math.max(1, host.clientHeight))
    const horizontalFit = 18 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect)
    const distance = Math.max(34, horizontalFit)
    const position = planView ? new THREE.Vector3(0.5, distance * 1.25, 0.01) : new THREE.Vector3(0.3, 0.84, 1.05).normalize().multiplyScalar(distance)
    move(position, new THREE.Vector3(0.5, 0, 0), immediate)
  }

  function focus(id: string) {
    const district = districts.find((item) => item.element.id === id)
    if (!district) return
    select(id)
    const target = district.group.position.clone().add(new THREE.Vector3(0, 0.7, 0))
    const offset = planView ? new THREE.Vector3(0, 15, 0.01) : new THREE.Vector3(3, 10, 13)
    move(target.clone().add(offset), target)
  }

  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let down = new THREE.Vector2()
  function hit(event: PointerEvent) {
    const bounds = renderer.domElement.getBoundingClientRect()
    pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2)
    raycaster.setFromCamera(pointer, camera)
    let object: THREE.Object3D | null = raycaster.intersectObjects(selectable, true)[0]?.object ?? null
    while (object) {
      if (typeof object.userData.elementId === 'string') return object.userData.elementId as string
      object = object.parent
    }
    return null
  }
  renderer.domElement.addEventListener('pointerdown', (event) => { down = new THREE.Vector2(event.clientX, event.clientY); flight = null })
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (down.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5) return
    const id = hit(event)
    if (id) onPick(id)
  })
  renderer.domElement.addEventListener('pointermove', (event) => { renderer.domElement.style.cursor = hit(event) ? 'pointer' : 'grab' })
  controls.addEventListener('start', () => { flight = null })

  function resize() {
    const width = Math.max(1, host.clientWidth)
    const height = Math.max(1, host.clientHeight)
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    home(true)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()

  function placeLabels() {
    const occupied: { left: number; top: number; right: number; bottom: number }[] = []
    const sorted = [...districts].sort((first, second) => Number(second.element.id === selected) - Number(first.element.id === selected))
    for (const district of sorted) {
      const point = district.group.position.clone().add(new THREE.Vector3(0, district.height + 0.7, 0)).project(camera)
      const left = (point.x * 0.5 + 0.5) * host.clientWidth
      const top = (0.5 - point.y * 0.5) * host.clientHeight
      const width = host.clientWidth < 650 ? 100 : 142
      const height = host.clientWidth < 650 ? 27 : 43
      const bounds = { left: left - width / 2 - 3, right: left + width / 2 + 3, top: top - height, bottom: top + 5 }
      const overlap = occupied.some((other) => bounds.left < other.right && bounds.right > other.left && bounds.top < other.bottom && bounds.bottom > other.top)
      const visible = labelsVisible && point.z > -1 && point.z < 1 && bounds.left > 8 && bounds.right < host.clientWidth - 8 && bounds.top > 83 && bounds.bottom < host.clientHeight - 48 && !overlap
      district.label.hidden = !visible
      if (visible) {
        occupied.push(bounds)
        district.label.style.left = `${left}px`
        district.label.style.top = `${top}px`
      }
    }
  }

  function render(simulation: PipelineSimulation, delta: number) {
    if (flight) {
      const alpha = 1 - Math.exp(-delta * 7)
      camera.position.lerp(flight.position, alpha)
      controls.target.lerp(flight.target, alpha)
      if (camera.position.distanceTo(flight.position) < 0.02) flight = null
    }
    const elapsed = simulation.time / 1000
    const active = simulation.produced > 0 && !simulation.ended
    for (const transport of transports) {
      const speed = transport.downstream ? Math.max(0.18, simulation.fps / 30) : simulation.pending ? 0 : 1
      for (const [index, packet] of transport.packets.entries()) {
        packet.visible = active && speed > 0 && index < Math.max(1, Math.ceil(speed * 7))
        const progress = (elapsed * 0.36 + index / 7) % 1
        packet.position.copy(transport.curve.getPoint(progress))
        packet.position.y += 0.14
        packet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), transport.curve.getTangent(progress))
      }
    }
    for (const district of districts) {
      district.slots.forEach((slot, index) => {
        const filled = district.element.id === 'queue' ? index < simulation.queue.length : false
        slot.material = material(filled ? '#f2c95e' : '#4d5046')
      })
      district.lights.forEach((mesh, index) => {
        const pulse = active ? 1 + Math.sin(elapsed * 3 + index * 0.65) * 0.05 : 1
        mesh.position.y = mesh.userData.baseY ?? mesh.position.y
        mesh.userData.baseY = mesh.position.y
        mesh.position.y *= pulse
      })
    }
    const input = simulation.produced - 1
    const output = simulation.lastFrame?.id ?? -1
    if (lastInput !== input) { drawFrame(inputCanvas, input, false); inputTexture.needsUpdate = true; lastInput = input }
    if (lastOutput !== output) { drawFrame(outputCanvas, output, true); outputTexture.needsUpdate = true; lastOutput = output }
    controls.update()
    renderer.render(scene, camera)
    placeLabels()
    const framed = districts.filter((district) => {
      for (const offsetX of [-1.5, 1.5]) for (const offsetZ of [-1.4, 1.4]) for (const height of [0, district.height]) {
        const point = district.group.position.clone().add(new THREE.Vector3(offsetX, height, offsetZ)).project(camera)
        if (Math.abs(point.x) > 0.98 || Math.abs(point.y) > 0.98 || Math.abs(point.z) > 1) return false
      }
      return true
    }).length
    host.dataset.framedNodes = String(framed)
    host.dataset.rendered = 'true'
  }

  return {
    setProfile, select, focus, home, render, preview: outputCanvas,
    setView(plan: boolean) { planView = plan; home() },
    setLabels(visible: boolean) { labelsVisible = visible },
    setDay(day: boolean) {
      scene.background = new THREE.Color(day ? '#e2e7e8' : '#121516')
      ground.material = material(day ? '#bbc5c5' : '#252b2d')
      light.intensity = day ? 3.5 : 2.7
    },
    zoom(direction: number) {
      const target = controls.target.clone()
      const offset = camera.position.clone().sub(target)
      offset.setLength(THREE.MathUtils.clamp(offset.length() * (direction > 0 ? 0.8 : 1.25), controls.minDistance, controls.maxDistance))
      move(target.clone().add(offset), target)
    },
    dispose() {
      observer.disconnect(); controls.dispose(); clearProfile(); cube.dispose()
      for (const entry of materials.values()) entry.dispose()
      inputTexture.dispose(); outputTexture.dispose(); grid.geometry.dispose()
      renderer.dispose(); host.replaceChildren()
    },
  }
}