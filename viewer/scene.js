/**
 * scene.js —— 把「原子 + 晶胞」变成可绘制的 2D 图元（圆 + 线段），供两处共用：
 *   · 浏览器里的 HTML 查看器（canvas 2D）
 *   · Node 侧的无头验收渲染（用来生成 PNG，亲眼核对几何是否正确）
 *
 * 这里只做数学：旋转、正交投影、深度排序、按元素给颜色和半径、按距离判成键、
 * 画晶胞棱。不碰 DOM，也不碰 canvas API。
 */

/** 常见元素的 CPK 颜色与相对半径（Å）。未收录的元素按碳处理并标灰。 */
export const ELEMENTS = {
  H: { color: '#e8e8e8', radius: 0.31 },
  D: { color: '#e8e8e8', radius: 0.31 },
  Li: { color: '#cc80ff', radius: 1.28 },
  B: { color: '#ffb5b5', radius: 0.84 },
  C: { color: '#6e7377', radius: 0.76 },
  N: { color: '#3050f8', radius: 0.71 },
  O: { color: '#ff2d2d', radius: 0.66 },
  F: { color: '#90e050', radius: 0.57 },
  Na: { color: '#ab5cf2', radius: 1.66 },
  Mg: { color: '#8aff00', radius: 1.41 },
  Al: { color: '#bfa6a6', radius: 1.21 },
  Si: { color: '#f0c8a0', radius: 1.11 },
  P: { color: '#ff8000', radius: 1.07 },
  S: { color: '#ffff30', radius: 1.05 },
  Cl: { color: '#1ff01f', radius: 1.02 },
  K: { color: '#8f40d4', radius: 2.03 },
  Ca: { color: '#3dff00', radius: 1.76 },
  Ti: { color: '#bfc2c7', radius: 1.6 },
  Mn: { color: '#9c7ac7', radius: 1.39 },
  Fe: { color: '#e06633', radius: 1.32 },
  Co: { color: '#f090a0', radius: 1.26 },
  Ni: { color: '#50d050', radius: 1.24 },
  Cu: { color: '#c88033', radius: 1.32 },
  Zn: { color: '#7d80b0', radius: 1.22 },
  Mo: { color: '#54b5b5', radius: 1.54 },
  Ru: { color: '#248f8f', radius: 1.46 },
  Pd: { color: '#006985', radius: 1.39 },
  Ag: { color: '#c0c0c0', radius: 1.45 },
  Pt: { color: '#d0d0e0', radius: 1.36 },
  Au: { color: '#ffd123', radius: 1.36 },
  W: { color: '#2194d6', radius: 1.62 },
}

const FALLBACK = { color: '#9a9a9a', radius: 0.9 }

/** 范德华半径（Å）——空间填充模式用；缺失时按共价半径 ×2 近似。 */
export const VDW = {
  H: 1.2, D: 1.2, Li: 1.82, B: 1.92, C: 1.7, N: 1.55, O: 1.52, F: 1.47,
  Na: 2.27, Mg: 1.73, Al: 1.84, Si: 2.1, P: 1.8, S: 1.8, Cl: 1.75,
  K: 2.75, Ca: 2.31, Ti: 2.0, Mn: 2.05, Fe: 2.05, Co: 2.0, Ni: 1.97,
  Cu: 1.96, Zn: 2.01, Mo: 1.98, Ru: 2.0, Pd: 2.05, Ag: 2.11, Pt: 2.13,
  Au: 2.14, W: 2.0,
}

/** 取范德华半径。 */
export function vdwRadius(symbol) {
  const key = String(symbol ?? '').trim()
  const normalized = key.length > 1 ? key[0].toUpperCase() + key.slice(1).toLowerCase() : key.toUpperCase()
  return VDW[normalized] ?? (elementStyle(symbol).radius * 2)
}

/** 取元素样式。 */
export function elementStyle(symbol) {
  const key = String(symbol ?? '').trim()
  const normalized = key.length > 1 ? key[0].toUpperCase() + key.slice(1).toLowerCase() : key.toUpperCase()
  return ELEMENTS[normalized] ?? ELEMENTS[key.toUpperCase()] ?? FALLBACK
}

/** 向量减法。 */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
/** 向量长度。 */
const len = (v) => Math.hypot(v[0], v[1], v[2])

/**
 * 从结构生成场景：原子样式、成键、晶胞棱。
 * @param {{ a1: number[], a2: number[], a3: number[], atoms: Array<{ symbol: string, cart: number[] }> }} structure - 结构（含笛卡尔坐标）。
 * @param {{ bondScale?: number, showHydrogen?: boolean }} [options] - 成键判定系数等。
 * @returns {object} 场景对象。
 */
export function buildScene(structure, options = {}) {
  const bondScale = Number.isFinite(options.bondScale) ? options.bondScale : 1.18
  const atoms = structure.atoms.map((atom, index) => {
    const style = elementStyle(atom.symbol)
    return {
      index,
      symbol: atom.symbol,
      position: atom.cart ?? [0, 0, 0],
      color: style.color,
      radius: style.radius,
      vdw: vdwRadius(atom.symbol),
    }
  })

  // 成键：两原子距离落在「半径和的 0.4–bondScale 倍」之间就当一根键。
  const bonds = []
  for (let i = 0; i < atoms.length; i += 1) {
    for (let j = i + 1; j < atoms.length; j += 1) {
      const distance = len(sub(atoms[j].position, atoms[i].position))
      const limit = (atoms[i].radius + atoms[j].radius) * bondScale
      if (distance <= 0.15 || distance > limit) continue
      bonds.push({ a: i, b: j, distance })
    }
  }

  // 晶胞：以原点为一个角点的平行六面体，12 条棱。
  const { a1, a2, a3 } = structure
  const corner = (i, j, k) => [
    i * a1[0] + j * a2[0] + k * a3[0],
    i * a1[1] + j * a2[1] + k * a3[1],
    i * a1[2] + j * a2[2] + k * a3[2],
  ]
  const cellEdges = []
  const corners = []
  for (let i = 0; i <= 1; i += 1) {
    for (let j = 0; j <= 1; j += 1) {
      for (let k = 0; k <= 1; k += 1) corners.push(corner(i, j, k))
    }
  }
  const edgePairs = [
    [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7],
  ]
  for (const [a, b] of edgePairs) cellEdges.push({ from: corners[a], to: corners[b] })

  // 两套取景：按原子（默认，适合带真空层的板/分子）与按晶胞（适合块体晶体）。
  const mean = (points) => points
    .reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0])
    .map((v) => v / Math.max(points.length, 1))
  const atomCenter = atoms.length > 0 ? mean(atoms.map((atom) => atom.position)) : mean(corners)
  const atomExtent = Math.max(...atoms.map((atom) => len(sub(atom.position, atomCenter))), 1)
  const allCenter = mean(atoms.map((atom) => atom.position).concat(corners))
  const allExtent = Math.max(
    ...atoms.map((atom) => len(sub(atom.position, allCenter))),
    ...corners.map((corner) => len(sub(corner, allCenter))),
    1,
  )

  return {
    atoms,
    bonds,
    cellEdges,
    center: atomCenter,
    extent: atomExtent,
    cellCenter: allCenter,
    cellExtent: allExtent,
  }
}

/** 绕 X 轴旋转（右手系，角度为度）。 */
function rotateX(point, degrees) {
  const r = (degrees * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [point[0], point[1] * c - point[2] * s, point[1] * s + point[2] * c]
}

/** 绕 Y 轴旋转。 */
function rotateY(point, degrees) {
  const r = (degrees * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [point[0] * c + point[2] * s, point[1], -point[0] * s + point[2] * c]
}

/** 绕 Z 轴旋转。 */
function rotateZ(point, degrees) {
  const r = (degrees * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [point[0] * c - point[1] * s, point[0] * s + point[1] * c, point[2]]
}

/**
 * 正交投影：先按 (rx, ry, rz) 旋转，再缩放平移到画布。
 * @param {object} scene - buildScene 的结果。
 * @param {{ width: number, height: number, rx?: number, ry?: number, rz?: number, zoom?: number, panX?: number, panY?: number, labels?: boolean }} view - 视图参数。
 * @returns {{ circles: object[], lines: object[], labels: object[] }} 图元（已按深度排序）。
 */
export function projectScene(scene, view) {
  const width = view.width
  const height = view.height
  const rx = view.rx ?? 0
  const ry = view.ry ?? 0
  const rz = view.rz ?? 0
  // fit='cell' 时把整块晶胞纳入取景；默认 'atoms' 让原子铺满画面（带真空层的板看起来才正常）。
  const fitCell = view.fit === 'cell'
  const viewCenter = fitCell ? scene.cellCenter : scene.center
  const viewExtent = fitCell ? scene.cellExtent : scene.extent
  // 默认把结构缩到画布的 62%，再乘用户缩放。
  const zoom = (view.zoom ?? 1) * (Math.min(width, height) * 0.62) / (viewExtent * 2)
  const panX = view.panX ?? 0
  const panY = view.panY ?? 0

  const toScreen = (position) => {
    const local = sub(position, viewCenter)
    const r = rotateZ(rotateY(rotateX(local, rx), ry), rz)
    return {
      x: width / 2 + r[0] * zoom + panX,
      y: height / 2 - r[1] * zoom + panY,
      z: r[2],
    }
  }

  const circles = scene.atoms.map((atom) => {
    const p = toScreen(atom.position)
    return {
      kind: 'atom',
      symbol: atom.symbol,
      x: p.x,
      y: p.y,
      z: p.z,
      // 球半径按 zoom 换算，并做一点透视感的深度缩放。
      r: Math.max(2.2, atom.radius * zoom * 0.92),
      color: atom.color,
      index: atom.index,
    }
  })

  const lines = scene.bonds.map((bond) => {
    const p1 = toScreen(scene.atoms[bond.a].position)
    const p2 = toScreen(scene.atoms[bond.b].position)
    return {
      kind: 'bond',
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      z: (p1.z + p2.z) / 2,
      color: '#b8b8b8',
      width: Math.max(1.2, zoom * 0.5),
    }
  })

  for (const edge of scene.cellEdges) {
    const p1 = toScreen(edge.from)
    const p2 = toScreen(edge.to)
    lines.push({
      kind: 'cell',
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      z: (p1.z + p2.z) / 2,
      color: '#7f8ea3',
      width: 1.1,
    })
  }

  // 画家算法：远的先画（screen y 向下，z 越大越靠近观察者）。
  circles.sort((a, b) => a.z - b.z)
  lines.sort((a, b) => a.z - b.z)
  const labels = view.labels === false ? [] : circles.map((circle) => ({
    text: circle.symbol,
    x: circle.x,
    y: circle.y - circle.r - 3,
    z: circle.z,
  }))
  return { circles, lines, labels }
}

/**
 * 带周期性边界的场景：把「跨晶胞的邻居」作为 ghost 原子补进来，边界原子不再断键。
 *
 * VESTA 的默认行为就是这个：键可以伸出晶胞框，伸出去那一端画成边界外的原子。
 * 原子数超过 1200 时自动退化为非周期成键（生成时间与内存都不值得）。
 *
 * @param {object} structure - `{ a1, a2, a3, atoms:[{symbol, cart}] }`
 * @param {{ bondScale?: number }} [options] - 成键判定系数。
 * @returns {object} 与 buildScene 同形，额外带 `ghosts` 数量，原子带 `ghost` 标记。
 */
export function buildPeriodicScene(structure, options = {}) {
  const bondScale = Number.isFinite(options.bondScale) ? options.bondScale : 1.18
  const { a1, a2, a3 } = structure
  const atoms = structure.atoms.map((atom, index) => {
    const style = elementStyle(atom.symbol)
    return {
      index,
      symbol: atom.symbol,
      position: atom.cart ?? [0, 0, 0],
      color: style.color,
      radius: style.radius,
      vdw: vdwRadius(atom.symbol),
      ghost: false,
    }
  })
  const baseCount = atoms.length
  const bonds = []
  const seenBonds = new Set()
  const ghostIndex = new Map()

  const pushBond = (a, b, distance) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    if (seenBonds.has(key)) return
    seenBonds.add(key)
    bonds.push({ a, b, distance })
  }

  if (baseCount <= 1200) {
    const offsets = []
    for (let i = -1; i <= 1; i += 1) {
      for (let j = -1; j <= 1; j += 1) {
        for (let k = -1; k <= 1; k += 1) offsets.push([i, j, k])
      }
    }
    for (let i = 0; i < baseCount; i += 1) {
      const origin = atoms[i].position
      for (let j = 0; j < baseCount; j += 1) {
        const base = atoms[j].position
        for (const [ci, cj, ck] of offsets) {
          if (i === j && ci === 0 && cj === 0 && ck === 0) continue
          const shifted = [
            base[0] + ci * a1[0] + cj * a2[0] + ck * a3[0],
            base[1] + ci * a1[1] + cj * a2[1] + ck * a3[1],
            base[2] + ci * a1[2] + cj * a2[2] + ck * a3[2],
          ]
          const distance = len(sub(shifted, origin))
          const limit = (atoms[i].radius + atoms[j].radius) * bondScale
          if (distance <= 0.15 || distance > limit) continue
          let target = j
          if (ci !== 0 || cj !== 0 || ck !== 0) {
            const key = `${j}:${ci},${cj},${ck}`
            target = ghostIndex.get(key)
            if (target === undefined) {
              target = atoms.length
              ghostIndex.set(key, target)
              atoms.push({ ...atoms[j], index: target, position: shifted, ghost: true })
            }
          }
          pushBond(i, target, distance)
        }
      }
    }
  } else {
    for (let i = 0; i < baseCount; i += 1) {
      for (let j = i + 1; j < baseCount; j += 1) {
        const distance = len(sub(atoms[j].position, atoms[i].position))
        const limit = (atoms[i].radius + atoms[j].radius) * bondScale
        if (distance <= 0.15 || distance > limit) continue
        pushBond(i, j, distance)
      }
    }
  }

  // 晶胞框（单位晶胞）
  const corner = (i, j, k) => [
    i * a1[0] + j * a2[0] + k * a3[0],
    i * a1[1] + j * a2[1] + k * a3[1],
    i * a1[2] + j * a2[2] + k * a3[2],
  ]
  const corners = []
  for (let i = 0; i <= 1; i += 1) {
    for (let j = 0; j <= 1; j += 1) {
      for (let k = 0; k <= 1; k += 1) corners.push(corner(i, j, k))
    }
  }
  const edgePairs = [
    [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7],
  ]
  const cellEdges = edgePairs.map(([a, b]) => ({ from: corners[a], to: corners[b] }))

  const real = atoms.filter((atom) => !atom.ghost)
  const mean = (points) => points
    .reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0])
    .map((value) => value / Math.max(points.length, 1))
  const center = real.length > 0 ? mean(real.map((atom) => atom.position)) : mean(corners)
  const extent = Math.max(...real.map((atom) => len(sub(atom.position, center))), 1)
  const allCenter = mean(real.map((atom) => atom.position).concat(corners))
  const allExtent = Math.max(
    ...real.map((atom) => len(sub(atom.position, allCenter))),
    ...corners.map((cornerPoint) => len(sub(cornerPoint, allCenter))),
    1,
  )

  return {
    atoms,
    bonds,
    cellEdges,
    center,
    extent,
    cellCenter: allCenter,
    cellExtent: allExtent,
    ghosts: atoms.length - baseCount,
  }
}
