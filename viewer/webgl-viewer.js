/**
 * webgl-viewer.js —— 内联进单文件 HTML 的渲染运行时。
 *
 * 由 scripts/make-viewer-gl.mjs 拼接在 three.js 源码与 STRUCT 数据之后，
 * 因此这里**不使用 import**，直接引用 three 在模块作用域里的同名绑定
 * （WebGLRenderer / Scene / PerspectiveCamera …）。
 *
 * 目标是接近 VESTA 的观感：着色球（有高光）、圆柱键、两点光照、抗锯齿、
 * 元素配色、晶胞框、坐标轴 a/b/c、球棍/空间填充/棒/线框四种模式、2× 分辨率存图。
 */
(function startViewer() {
  const data = STRUCT
  const canvas = document.getElementById('view')
  const labelLayer = document.getElementById('labels')
  const modeButtons = Array.from(document.querySelectorAll('[data-mode]'))

  let renderer
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: false })
  } catch (error) {
    document.getElementById('nogl').style.display = 'flex'
    return
  }
  renderer.outputColorSpace = SRGBColorSpace
  renderer.setClearColor(new Color('#f7f8fa'), 1)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))

  const scene = new Scene()
  const camera = new PerspectiveCamera(32, 1, 0.05, 20000)
  const root = new Group()
  scene.add(root)

  // ── 光照：环境 + 主光 + 补光（VESTA 的球面高光靠主光的镜面项）─────
  scene.add(new AmbientLight(0xffffff, 0.62))
  const keyLight = new DirectionalLight(0xffffff, 0.95)
  keyLight.position.set(0.55, 0.9, 1.0)
  scene.add(keyLight)
  const fillLight = new DirectionalLight(0xffffff, 0.34)
  fillLight.position.set(-0.9, -0.4, -0.7)
  scene.add(fillLight)

  const sphereGeometry = new SphereGeometry(1, 36, 24)
  const cylinderGeometry = new CylinderGeometry(1, 1, 1, 20, 1, false)
  const upAxis = new Vector3(0, 1, 0)
  const dummy = new Object3D()
  const tmpColor = new Color()

  // 取景距离：让整个包围球落在竖直视野内（d = r / sin(fov/2)），再留 4% 余量。
  const fitDistance = data.radius / Math.sin(((camera.fov / 2) * Math.PI) / 180)
  const state = {
    mode: 'ballstick',
    labels: false,
    cell: true,
    axes: true,
    distance: fitDistance,
    minDistance: data.radius * 0.12,
    maxDistance: fitDistance * 6,
    target: new Vector3(0, 0, 0),
  }

  /** 各类模式下原子球半径（Å）。 */
  const radiusFor = (atom, mode) => {
    // 跨晶胞邻居（ghost）画小一号，视觉上区分「胞内原子」与「为补键而画的邻居」。
    const ghostScale = 1
    if (mode === 'spacefill') return (atom.vdw ?? atom.v * 2) * 0.45 * ghostScale
    if (mode === 'stick') return atom.v * 0.18
    if (mode === 'wire') return 0
    if (mode === 'polyhedra') return atom.v * 0.22 * ghostScale
    return atom.v * 0.42 * ghostScale
  }

  /** 各类模式下键的半径（Å）。 */
  const bondRadiusFor = (mode) => {
    if (mode === 'wire') return 0.03
    if (mode === 'stick') return 0.13
    if (mode === 'spacefill' || mode === 'polyhedra') return 0
    return 0.11
  }

  let atomsMesh = null
  let bondsMesh = null
  let cellLines = null
  let axesGroup = null

  const disposeIfAny = (object) => {
    if (!object) return
    root.remove(object)
    object.geometry?.dispose?.()
    if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose())
    else object.material?.dispose?.()
  }

  function rebuildAtoms() {
    disposeIfAny(atomsMesh)
    atomsMesh = null
    const radius = bondRadiusFor(state.mode) // 只为判断 wire/spacefill
    if (state.mode === 'wire') return
    const material = new MeshPhongMaterial({ shininess: 46, specular: 0x5a5a5a })
    atomsMesh = new InstancedMesh(sphereGeometry, material, data.atoms.length)
    data.atoms.forEach((atom, index) => {
      const r = radiusFor(atom, state.mode)
      dummy.position.set(atom.x, atom.y, atom.z)
      dummy.scale.set(r, r, r)
      dummy.quaternion.identity()
      dummy.updateMatrix()
      atomsMesh.setMatrixAt(index, dummy.matrix)
      atomsMesh.setColorAt(index, tmpColor.set(atom.color))
    })
    atomsMesh.instanceMatrix.needsUpdate = true
    if (atomsMesh.instanceColor) atomsMesh.instanceColor.needsUpdate = true
    void radius
    root.add(atomsMesh)
  }

  function rebuildBonds() {
    disposeIfAny(bondsMesh)
    bondsMesh = null
    const bondRadius = bondRadiusFor(state.mode)
    if (bondRadius <= 0) return
    const material = new MeshPhongMaterial({ shininess: 18, specular: 0x333333 })
    bondsMesh = new InstancedMesh(cylinderGeometry, material, data.bonds.length)
    data.bonds.forEach((bond, index) => {
      const a = data.atoms[bond.a]
      const b = data.atoms[bond.b]
      const from = new Vector3(a.x, a.y, a.z)
      const to = new Vector3(b.x, b.y, b.z)
      const direction = new Vector3().subVectors(to, from)
      const length = direction.length()
      dummy.position.copy(from).add(to).multiplyScalar(0.5)
      dummy.quaternion.setFromUnitVectors(upAxis, direction.clone().normalize())
      dummy.scale.set(bondRadius, length, bondRadius)
      dummy.updateMatrix()
      bondsMesh.setMatrixAt(index, dummy.matrix)
      bondsMesh.setColorAt(index, tmpColor.set('#9aa2ad'))
    })
    bondsMesh.instanceMatrix.needsUpdate = true
    if (bondsMesh.instanceColor) bondsMesh.instanceColor.needsUpdate = true
    root.add(bondsMesh)
  }

  function buildCell() {
    const positions = new Float32Array(data.cell.length * 6)
    data.cell.forEach((edge, index) => {
      positions.set(edge, index * 6)
    })
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    const material = new LineBasicMaterial({ color: 0x7f8ea3, transparent: true, opacity: 0.9 })
    cellLines = new LineSegments(geometry, material)
    cellLines.visible = state.cell
    root.add(cellLines)
  }

  function buildAxes() {
    // 坐标轴：a(红)/b(绿)/c(蓝)，长度取晶胞最短轴的一半，像 VESTA 左下角的三轴。
    const axes = new Group()
    axes.position.set(data.axesOrigin[0], data.axesOrigin[1], data.axesOrigin[2])
    const colors = [0xd93b3b, 0x1f9d55, 0x2f6feb]
    const vectors = [data.axes.a, data.axes.b, data.axes.c]
    vectors.forEach((vector, index) => {
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, vector[0], vector[1], vector[2]], 3))
      const material = new LineBasicMaterial({ color: colors[index] })
      axes.add(new LineSegments(geometry, material))
    })
    axesGroup = axes
    axesGroup.visible = state.axes
    root.add(axesGroup)
  }

  /** 释放一棵对象树上的几何与材质。 */
  function disposeTree(object) {
    if (!object) return
    root.remove(object)
    object.traverse((child) => {
      child.geometry?.dispose?.()
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose())
      else child.material?.dispose?.()
    })
  }

  let polyhedraGroup = null

  /**
   * 多面体模式：给配位数 4–12 的「非 C/H」原子（阳离子/金属）画配位多面体。
   * VESTA 的多面体就是这样由近邻点的凸包得到的。
   */
  function buildPolyhedra() {
    if (polyhedraGroup) {
      disposeTree(polyhedraGroup)
      polyhedraGroup = null
    }
    if (state.mode !== 'polyhedra') return
    const adjacency = data.atoms.map(() => [])
    for (const bond of data.bonds) {
      adjacency[bond.a].push(bond.b)
      adjacency[bond.b].push(bond.a)
    }
    const group = new Group()
    let built = 0
    data.atoms.forEach((atom, index) => {
      // 多面体只用胞内邻居：ghost 是跨胞补键用的，拼进凸包会得到框外的畸形多面体。
      const neighbours = adjacency[index].filter((n) => !data.atoms[n].ghost)
      if (neighbours.length < 4 || neighbours.length > 12) return
      if (atom.sym === 'C' || atom.sym === 'H') return
      const points = neighbours.map((n) => new Vector3(data.atoms[n].x, data.atoms[n].y, data.atoms[n].z))
      try {
        const geometry = new window.ConvexGeometry(points)
        const material = new MeshPhongMaterial({
          color: new Color(atom.color),
          transparent: true,
          opacity: 0.38,
          side: DoubleSide,
          depthWrite: false,
          shininess: 14,
        })
        group.add(new Mesh(geometry, material))
        const edges = new LineSegments(
          new EdgesGeometry(geometry),
          new LineBasicMaterial({ color: 0x3c424b, transparent: true, opacity: 0.5 }),
        )
        group.add(edges)
        built += 1
      } catch (error) {
        if (!window.__polyError) window.__polyError = String(error && error.message ? error.message : error)
      }
    })
    polyhedraGroup = group
    polyhedraGroup.userData.built = built
    root.add(polyhedraGroup)

  }

  // ── 等值面（CHGCAR / CUBE）────────────────────────────────────────────
  const volume = data.volume || null
  let volumeMesh = null
  const isoState = { percent: volume ? (volume.isoPercent ?? 30) : 30, visible: true }

  function decodeBase64(b64) {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  }

  /**
   * marching tetrahedra：每个立方体切成 6 个四面体，逐个线性插值取交点。
   * 比 marching cubes 省掉 256 项查表，代码短、没有表错的风险。
   */
  // 双向等值面：正值一面蓝、负值一面红（CUBE 的 2p/自旋密度就需要这个）。
  function buildSurfaceMesh(threshold, side, color) {
    const [nx, ny, nz] = volume.dims
    const bytes = volume.bytes || (volume.bytes = decodeBase64(volume.data))
    const [ax, ay, az] = volume.steps
    const origin = volume.origin
    const cornerOffsets = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]
    const tets = [[0, 1, 3, 7], [0, 3, 2, 7], [0, 2, 6, 7], [0, 6, 4, 7], [0, 4, 5, 7], [0, 5, 1, 7]]
    const tetEdges = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]
    const inside = (value) => (side === 'below' ? value <= threshold : value >= threshold)
    const positions = []
    const pushTriangle = (a, b, c) => {
      positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
    }
    const values = new Array(8)
    const points = new Array(8)
    for (let k = 0; k < nz - 1; k += 1) {
      for (let j = 0; j < ny - 1; j += 1) {
        for (let i = 0; i < nx - 1; i += 1) {
          for (let c = 0; c < 8; c += 1) {
            const [dx, dy, dz] = cornerOffsets[c]
            values[c] = bytes[((k + dz) * ny + (j + dy)) * nx + (i + dx)]
            points[c] = [
              origin[0] + (i + dx) * ax[0] + (j + dy) * ay[0] + (k + dz) * az[0],
              origin[1] + (i + dx) * ax[1] + (j + dy) * ay[1] + (k + dz) * az[1],
              origin[2] + (i + dx) * ax[2] + (j + dy) * ay[2] + (k + dz) * az[2],
            ]
          }
          for (const tet of tets) {
            let insideCount = 0
            for (const corner of tet) if (inside(values[corner])) insideCount += 1
            if (insideCount === 0 || insideCount === 4) continue
            const hits = []
            for (const [ea, eb] of tetEdges) {
              const ca = tet[ea]
              const cb = tet[eb]
              if (inside(values[ca]) === inside(values[cb])) continue
              const t = (threshold - values[ca]) / (values[cb] - values[ca] || 1)
              hits.push([
                points[ca][0] + t * (points[cb][0] - points[ca][0]),
                points[ca][1] + t * (points[cb][1] - points[ca][1]),
                points[ca][2] + t * (points[cb][2] - points[ca][2]),
              ])
            }
            if (hits.length === 3) pushTriangle(hits[0], hits[1], hits[2])
            else if (hits.length === 4) {
              pushTriangle(hits[0], hits[1], hits[2])
              pushTriangle(hits[1], hits[2], hits[3])
            }
          }
        }
      }
    }
    if (positions.length === 0) return null
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.computeVertexNormals()
    const material = new MeshPhongMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      side: DoubleSide,
      depthWrite: false,
      shininess: 28,
      specular: 0x555555,
    })
    return new Mesh(geometry, material)
  }

  /** 量程里绝对值最大的那一侧，作为 100% 的基准（正负对称地取阈值）。 */
  function isoAbsMax() {
    if (!volume) return 1
    return Math.max(Math.abs(volume.min), Math.abs(volume.max)) || 1
  }

  function buildIsoMesh() {
    if (!volume) return
    if (volumeMesh) {
      disposeTree(volumeMesh)
      volumeMesh = null
    }
    if (!isoState.visible) return
    const level = (isoState.percent / 100) * isoAbsMax()
    const toQuant = (value) => ((value - volume.min) / (volume.max - volume.min || 1)) * 255
    const group = new Group()
    const positive = buildSurfaceMesh(toQuant(Math.abs(level)), 'above', 0x2f6feb)
    if (positive) group.add(positive)
    if (volume.min < 0 && volume.signed !== false) {
      const negative = buildSurfaceMesh(toQuant(-Math.abs(level)), 'below', 0xd93b3b)
      if (negative) group.add(negative)
    }
    if (group.children.length === 0) return
    volumeMesh = group
    root.add(volumeMesh)
  }

  function rebuildGeometry() {
    buildPolyhedra()
    rebuildAtoms()
    rebuildBonds()
    renderNow()
  }

  // ── 相机 / 交互 ────────────────────────────────────────────────────────
  const spherical = { theta: 0, phi: 0 }
  function applyCamera() {
    const distance = state.distance
    camera.position.set(0, 0, distance)
    camera.lookAt(state.target)
    camera.updateMatrixWorld()
  }

  function resize() {
    const width = window.innerWidth
    const height = window.innerHeight
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderNow()
  }

  const projected = new Vector3()
  function updateLabels() {
    if ((!state.labels || !atomsMesh) && !state.axes) {
      labelLayer.innerHTML = ''
      return
    }
    const width = window.innerWidth
    const height = window.innerHeight
    const limit = Math.min(data.atoms.length, 300)
    const parts = []
    if (state.axes) {
      const axesOriginLocal = new Vector3(data.axesOrigin[0], data.axesOrigin[1], data.axesOrigin[2])
      for (const [name, vector] of [['a', data.axes.a], ['b', data.axes.b], ['c', data.axes.c]]) {
        const tip = axesOriginLocal.clone().add(new Vector3(vector[0], vector[1], vector[2]))
        tip.applyMatrix4(root.matrixWorld).project(camera)
        if (tip.z <= 1) {
          const x = (tip.x * 0.5 + 0.5) * width
          const y = (-tip.y * 0.5 + 0.5) * height
          const color = name === 'a' ? '#d93b3b' : name === 'b' ? '#1f9d55' : '#2f6feb'
          parts.push(`<span style="left:${(x + 2).toFixed(1)}px;top:${(y - 6).toFixed(1)}px;color:${color}">${name}</span>`)
        }
      }
    }
    if (state.labels && atomsMesh) {
      for (let index = 0; index < limit; index += 1) {
        const atom = data.atoms[index]
        if (atom.ghost) continue
        projected.set(atom.x, atom.y, atom.z).applyMatrix4(root.matrixWorld).project(camera)
        if (projected.z > 1) continue
        const x = (projected.x * 0.5 + 0.5) * width
        const y = (-projected.y * 0.5 + 0.5) * height
        const radiusPx = Math.max(6, (atom.v * 0.42) / state.distance * height * 1.6)
        parts.push(`<span style="left:${(x - 10).toFixed(1)}px;top:${(y - radiusPx - 14).toFixed(1)}px">${atom.sym}</span>`)
      }
    }
    labelLayer.innerHTML = parts.join('')
  }

  function renderNow() {
    renderer.render(scene, camera)
    updateLabels()
  }

  let dragMode = null
  let lastPointer = null
  canvas.addEventListener('pointerdown', (event) => {
    dragMode = event.button === 2 || event.shiftKey ? 'pan' : 'rotate'
    lastPointer = { x: event.clientX, y: event.clientY }
    canvas.setPointerCapture(event.pointerId)
    canvas.classList.add('dragging')
  })
  canvas.addEventListener('pointermove', (event) => {
    if (!dragMode || !lastPointer) return
    const dx = event.clientX - lastPointer.x
    const dy = event.clientY - lastPointer.y
    lastPointer = { x: event.clientX, y: event.clientY }
    if (dragMode === 'rotate') {
      const rotationY = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), dx * 0.006)
      const rightAxis = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize()
      const rotationX = new Quaternion().setFromAxisAngle(rightAxis, dy * 0.006)
      root.quaternion.premultiply(rotationY).premultiply(rotationX)
    } else {
      const rightAxis = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize()
      const upAxisWorld = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize()
      const scale = state.distance / window.innerHeight
      state.target.addScaledVector(rightAxis, -dx * scale).addScaledVector(upAxisWorld, dy * scale)
    }
    applyCamera()
    renderNow()
  })
  const stopDrag = () => {
    dragMode = null
    lastPointer = null
    canvas.classList.remove('dragging')
  }
  canvas.addEventListener('pointerup', stopDrag)
  canvas.addEventListener('pointercancel', stopDrag)
  canvas.addEventListener('contextmenu', (event) => event.preventDefault())
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault()
    const factor = Math.exp(event.deltaY * 0.0012)
    state.distance = Math.max(state.minDistance, Math.min(state.maxDistance, state.distance * factor))
    applyCamera()
    renderNow()
  }, { passive: false })
  canvas.addEventListener('dblclick', () => resetView())

  function resetView() {
    root.quaternion.identity()
    state.distance = fitDistance
    state.target.set(0, 0, 0)
    if (data.initial) {
      const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (data.initial.rx * Math.PI) / 180)
      const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (data.initial.ry * Math.PI) / 180)
      root.quaternion.copy(qx).premultiply(qy)
    }
    applyCamera()
    renderNow()
  }

  // ── UI ────────────────────────────────────────────────────────────────
  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode
      modeButtons.forEach((other) => other.classList.toggle('on', other === button))
      rebuildGeometry()
    })
  })

  const toggle = (id, key, after) => {
    const button = document.getElementById(id)
    button.addEventListener('click', () => {
      state[key] = !state[key]
      button.classList.toggle('on', state[key])
      if (after) after()
      renderNow()
    })
  }
  toggle('t-labels', 'labels')
  toggle('t-cell', 'cell', () => { if (cellLines) cellLines.visible = state.cell })
  toggle('t-axes', 'axes', () => { if (axesGroup) axesGroup.visible = state.axes })
  document.getElementById('reset').addEventListener('click', resetView)
  document.getElementById('save').addEventListener('click', () => {
    const ratio = renderer.getPixelRatio()
    renderer.setPixelRatio(Math.min(4, (window.devicePixelRatio || 1) * 2))
    renderer.setSize(window.innerWidth, window.innerHeight, false)
    renderer.render(scene, camera)
    const link = document.createElement('a')
    link.download = (document.title || 'structure').replace(/[\\/:*?"<>|]+/g, '_') + '.png'
    link.href = renderer.domElement.toDataURL('image/png')
    link.click()
    renderer.setPixelRatio(ratio)
    resize()
  })

  window.addEventListener('resize', resize)

  // 初始视角：URL 参数优先（便于固定视角分享与无头验收）
  const params = new URLSearchParams(location.search)
  if (params.get('mode') && ['ballstick', 'spacefill', 'stick', 'polyhedra', 'wire'].includes(params.get('mode'))) {
    state.mode = params.get('mode')
  }
  if (params.get('labels') === 'on') state.labels = true
  if (params.get('axes') === 'on') state.axes = true
  if (params.get('cell') === 'off') state.cell = false
  if (params.get('axes') === 'off') state.axes = false
  if (params.has('zoom') && Number.isFinite(Number(params.get('zoom')))) {
    state.distance = fitDistance / Math.max(0.05, Number(params.get('zoom')))
  }

  buildCell()
  buildAxes()
  // 初始几何走 rebuildGeometry：带 ?mode=polyhedra 时也要真的把多面体建出来。
  rebuildGeometry()

  // 滑杆同时给出绝对阈值：CHGCAR 是 e/Å³，CUBE 保持文件原单位。
  const updateIsoLabel = () => {
    const label = document.getElementById('iso-val')
    if (!label) return
    if (!volume) {
      label.textContent = `${isoState.percent}%`
      return
    }
    const absMax = Math.max(Math.abs(volume.min), Math.abs(volume.max)) || 1
    const value = absMax * (isoState.percent / 100)
    const signed = volume.min < 0 ? ' ±' : ' '
    label.textContent = `${isoState.percent}%${signed}${value.toFixed(3)}${volume.unit ? ` ${volume.unit}` : ''}`
  }
  // ?iso=35 便于分享固定阈值，也用于无头验收
  const isoSrc = new URLSearchParams(location.search)
  if (isoSrc.has('iso') && Number.isFinite(Number(isoSrc.get('iso')))) {
    isoState.percent = Math.max(1, Math.min(95, Number(isoSrc.get('iso'))))
    const sliderNow = document.getElementById('iso')
    if (sliderNow) sliderNow.value = String(isoState.percent)
  }
  updateIsoLabel()
  // 参数在上面的 buildIsoMesh 之后才读到，这里按最终阈值重建一次。
  buildIsoMesh()

  const isoSlider = document.getElementById('iso')
  if (isoSlider) {
    let isoDebounce = null
    isoSlider.addEventListener('input', () => {
      isoState.percent = Number(isoSlider.value)
      updateIsoLabel()
      clearTimeout(isoDebounce)
      isoDebounce = setTimeout(() => {
        buildIsoMesh()
        renderNow()
      }, 160)
    })
    const isoButton = document.getElementById('t-iso')
    if (isoButton) {
      isoButton.addEventListener('click', () => {
        isoState.visible = !isoState.visible
        isoButton.classList.toggle('on', isoState.visible)
        buildIsoMesh()
        renderNow()
      })
    }
  }
  applyCamera()
  resetView()

  const initialRotation = {
    rx: params.has('rx') ? Number(params.get('rx')) : (data.initial?.rx ?? 18),
    ry: params.has('ry') ? Number(params.get('ry')) : (data.initial?.ry ?? 28),
  }
  data.initial = initialRotation
  modeButtons.forEach((button) => button.classList.toggle('on', button.dataset.mode === state.mode))
  document.getElementById('t-labels').classList.toggle('on', state.labels)
  document.getElementById('t-cell').classList.toggle('on', state.cell)
  document.getElementById('t-axes').classList.toggle('on', state.axes)
  resetView()
  if (!state.labels) {
    labelLayer.innerHTML = ''
  }
  resize()
})()
