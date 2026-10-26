#!/usr/bin/env node
/**
 * make-viewer-gl —— 生成「接近 VESTA 观感」的单文件 WebGL 查看器。
 *
 * 与 scripts/make-viewer.mjs（Canvas 2D 版）的区别：这一版用 three.js 做真实的
 * 三维渲染——着色球（带高光）、圆柱键、两点光照、抗锯齿、坐标轴，观感接近 VESTA。
 * three.js 源码被内联进 HTML，因此文件离线可用、不依赖 CDN。
 *
 *   node scripts/make-viewer-gl.mjs <POSCAR> [--repeat 2,2,2] [--out viewer.html]
 *                                   [--rx 18 --ry 28]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePoscar, buildSupercell, structureSummary, resolveTarget, readVolumeFile, encodeVolume, potcarElements, differenceVolume } from '../core.js'
import { buildPeriodicScene } from '../viewer/scene.js'
import { installFriendlyErrors } from './_friendly-errors.mjs'

installFriendlyErrors()

const HERE = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/make-viewer-gl.mjs <POSCAR> [--repeat 2,2,2] [--out viewer.html]')
  process.exit(2)
}

const repeat = String(flag('repeat', '1,1,1')).split(/[x, ]+/).filter(Boolean).map(Number)
const target = resolveTarget(input, process.cwd())
const inputIsCube = /\.(cube|cub)$/i.test(target)
// 直接把 CUBE 当输入时，没有 POSCAR 可解析：结构（原子+晶胞）从 CUBE 头里取。
const cubeVolume = inputIsCube ? readVolumeFile(target) : null
// VASP4 的 POSCAR 没有元素行：同目录 POTCAR 里的元素就是答案。
const siblingPotcar = join(dirname(target), 'POTCAR')
const siblingSymbols = existsSync(siblingPotcar) ? potcarElements(readFileSync(siblingPotcar, 'utf8')) : []
const parsed = inputIsCube ? null : parsePoscar(readFileSync(target, 'utf8'), basename(target), { symbols: siblingSymbols })
const structure = inputIsCube
  ? {
    a1: cubeVolume.steps[0].map((value) => value * cubeVolume.dims[0]),
    a2: cubeVolume.steps[1].map((value) => value * cubeVolume.dims[1]),
    a3: cubeVolume.steps[2].map((value) => value * cubeVolume.dims[2]),
    atoms: cubeVolume.atoms.map((atom) => ({ symbol: atom.symbol, cart: atom.cart })),
  }
  : buildSupercell(parsed, repeat)
const summary = structureSummary(structure)
const scene = buildPeriodicScene(structure)

// 把几何以结构中心为原点重排：相机固定看向原点，旋转也绕原点。
const atomPoints = scene.atoms.filter((atom) => !atom.ghost).map((atom) => atom.position)
// 纯体积数据（CUBE 里可能一个原子都没有）没有原子可当基准，退化成用晶胞角点取景。
const framePoints = atomPoints.length > 0
  ? atomPoints
  : scene.cellEdges.flatMap((edge) => [edge.from, edge.to])
const min = [Infinity, Infinity, Infinity]
const max = [-Infinity, -Infinity, -Infinity]
for (const p of framePoints) {
  for (let i = 0; i < 3; i += 1) {
    min[i] = Math.min(min[i], p[i])
    max[i] = Math.max(max[i], p[i])
  }
}
const center = [0, 1, 2].map((i) => (min[i] + max[i]) / 2)
const shift = (p) => [p[0] - center[0], p[1] - center[1], p[2] - center[2]]
const atomRadius = Math.max(...framePoints.map((p) => Math.hypot(...shift(p))), 1.5)
const cellRadius = Math.max(...scene.cellEdges.flatMap((edge) => [Math.hypot(...shift(edge.from)), Math.hypot(...shift(edge.to))]))
// 有体积数据时把晶胞也纳入取景，等值面才有足够画幅。
const hasVolume = Boolean(flag('vol', '')) || inputIsCube
const radius = hasVolume ? Math.max(atomRadius * 1.35, cellRadius * 0.95, 2) : Math.max(atomRadius * 1.35, 2)

const axesScale = Math.max(radius * 0.18, 1.2)
const unit = (v) => {
  const length = Math.hypot(...v) || 1
  return v.map((value) => (value / length) * axesScale)
}

// 坐标轴放到晶胞的最小角上（VESTA 也是画在晶胞角），避免横穿结构。
const boxCorners = scene.cellEdges.flatMap((edge) => [edge.from, edge.to])
const minCorner = [0, 1, 2].map((axis) => Math.min(...boxCorners.map((corner) => corner[axis])))
const axesOrigin = shift(minCorner)

// ── 可选体积数据（CHGCAR / CUBE）→ 等值面 ────────────────────────────────
const volumePath = flag('vol', '')
let volumePayload = null
let volumeTitle = ''
const volumeSource = volumePath ? resolve(volumePath) : (inputIsCube ? target : '')
const volumeBlock = Number(flag('vol-block', '1')) === 2 ? 2 : 1
// --ref 支持逗号分隔的多个参照文件：A − B − C …；每个参照都会从当前网格里减掉。
const refPaths = String(flag('ref', '')).split(',').map((item) => item.trim()).filter(Boolean)
if (volumeSource) {
  let volume = volumeSource === target ? cubeVolume : readVolumeFile(volumeSource, { block: volumeBlock })
  let isDifference = false
  for (const refPath of refPaths) {
    volume = differenceVolume(volume, readVolumeFile(resolve(refPath)))
    isDifference = true
  }
  const encoded = encodeVolume(volume)
  const [nx, ny, nz] = volume.dims
  const gridCell = volume.steps.map((step, axis) => step.map((value) => value * (volume.dims[axis])))
  volumePayload = {
    dims: encoded.dims,
    // 原子已经平移居中，体积网格必须用同一套坐标，否则等值面会飘到晶胞另一头。
    origin: shift(volume.origin),
    // 降采样后每个格点代表 stride 个原始格点，步长要跟着放大。
    steps: volume.steps.map((step) => step.map((value) => value * encoded.stride)),
    data: encoded.data,
    min: encoded.min,
    max: encoded.max,
    unit: volume.unit ?? '',
    // 总电荷密度（CHGCAR/CHG）的负值只是 FFT 噪声，不画负值面；CUBE 可能是差密度/自旋密度，保留双向。
    signed: isDifference ? true : !/^CHG/i.test(basename(volumeSource)),
    isoPercent: Number(flag('iso', '30')),
    gridDims: [nx, ny, nz],
    cell: gridCell,
  }
  volumeTitle = isDifference
    ? `差值：${basename(volumeSource)} − ${refPaths.map((item) => basename(item)).join(' − ')}（${nx}×${ny}×${nz} → ${encoded.dims.join('×')}）`
    : `${volume.title}${volume.block === 2 ? ' · 磁化密度块' : ''}（${nx}×${ny}×${nz} → ${encoded.dims.join('×')}，${volume.unit ?? ''}）`
}

const payload = {
  formula: summary.formula,
  axesOrigin,
  atoms: scene.atoms.map((atom) => {
    const p = shift(atom.position)
    return { x: p[0], y: p[1], z: p[2], sym: atom.symbol, color: atom.color, v: atom.radius, vdw: atom.vdw, ghost: atom.ghost === true }
  }),
  bonds: scene.bonds.map((bond) => ({ a: bond.a, b: bond.b })),
  cell: scene.cellEdges.map((edge) => [...shift(edge.from), ...shift(edge.to)]),
  axes: { a: unit(structure.a1), b: unit(structure.a2), c: unit(structure.a3) },
  radius,
  cellRadius,
  initial: { rx: Number(flag('rx', '18')), ry: Number(flag('ry', '28')) },
  volume: volumePayload,
}

/** 去掉 ESM 的 import/export，让 examples 里的类能拼进同一个模块作用域。 */
const stripModule = (source) => source
  .replace(/^import\s*\{[\s\S]*?\}\s*from\s*'[^']*';?\s*$/gm, '')
  .replace(/^import\s+[^;]*?from\s*'[^']*';?\s*$/gm, '')
  .replace(/^export\s*\{[^}]*\};?\s*$/gm, '')
  .replace(/^export\s+/gm, '')

const three = readFileSync(join(HERE, '..', 'vendor', 'three.module.js'), 'utf8')
// 必须包在 IIFE 里：three 与 ConvexHull 各自有 _y1 这类顶层标识符，同作用域会重复声明。
const convexBundle = `(function () {
${stripModule(readFileSync(join(HERE, '..', 'vendor', 'ConvexHull.js'), 'utf8'))}
${stripModule(readFileSync(join(HERE, '..', 'vendor', 'ConvexGeometry.js'), 'utf8'))}
window.ConvexHull = ConvexHull
window.ConvexGeometry = ConvexGeometry
})();`
if (three.includes('</script>')) throw new Error('three 源码里出现 </script>，需要转义后再内联')
const viewer = readFileSync(join(HERE, '..', 'viewer', 'webgl-viewer.js'), 'utf8')

const volumeControls = volumePayload
  ? `<label class="iso">等值面 <input id="iso" type="range" min="5" max="85" step="1" value="${volumePayload.isoPercent}"> <span id="iso-val">${volumePayload.isoPercent}%</span></label>
  <button id="t-iso" class="on">等值面</button>`
  : ''
const subtitle = `原子 ${summary.atoms}　${repeat.join('×')} 扩胞　a=${summary.cell.a.toFixed(2)} b=${summary.cell.b.toFixed(2)} c=${summary.cell.c.toFixed(2)} Å　γ=${summary.cell.gamma.toFixed(1)}°`
// 体积/差值信息：之前算了却没显示，这里接到顶部信息栏。
const volumeNote = volumeTitle ? `<div class="sub">${volumeTitle}</div>` : ''
const title = `${summary.formula || basename(target)} · ${repeat.join('×')} · ${basename(target)}`
const json = JSON.stringify(payload)

const legendSeen = new Map()
for (const atom of scene.atoms) if (!legendSeen.has(atom.symbol)) legendSeen.set(atom.symbol, atom.color)
const legendHtml = [...legendSeen.entries()]
  .map(([symbol, color]) => `<span><i style="background:${color}"></i>${symbol}</span>`)
  .join('')

const head = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: #f7f8fa;
    font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #2a2f36; }
  #view { display: block; width: 100vw; height: 100vh; cursor: grab; touch-action: none; }
  #view.dragging { cursor: grabbing; }
  #labels { position: fixed; inset: 0; pointer-events: none; }
  #labels span { position: absolute; font: 600 11px -apple-system, "Segoe UI", sans-serif;
    color: #3a4150; text-shadow: 0 0 3px #fff, 0 0 3px #fff; }
  .bar { position: fixed; left: 14px; top: 14px; right: 14px; display: flex; gap: 8px;
    align-items: center; flex-wrap: wrap; pointer-events: none; }
  .bar > * { pointer-events: auto; }
  .title { font-weight: 600; font-size: 14px; background: rgba(255,255,255,.86);
    padding: 6px 10px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .sub { font-size: 12px; color: #5b6472; background: rgba(255,255,255,.86);
    padding: 6px 10px; border-radius: 8px; }
  .spacer { flex: 1; }
  button { font: inherit; border: 1px solid #ccd3dc; background: #fff; color: #2a2f36;
    padding: 6px 10px; border-radius: 8px; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,.05); }
  button:hover { background: #f0f4f9; }
  button.on { border-color: #2f6feb; color: #2f6feb; background: #eef4ff; }
  .legend { position: fixed; left: 14px; bottom: 14px; display: flex; gap: 10px;
    background: rgba(255,255,255,.86); padding: 6px 10px; border-radius: 8px; font-size: 12px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%;
    margin-right: 4px; vertical-align: -1px; }
  .iso { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,.86);
    padding: 4px 10px; border-radius: 8px; font-size: 12px; color: #3a4150; }
  .iso input { width: 130px; }
  .hint { position: fixed; right: 14px; bottom: 14px; font-size: 12px; color: #7b8494;
    background: rgba(255,255,255,.86); padding: 6px 10px; border-radius: 8px; }
  #nogl { position: fixed; inset: 0; display: none; align-items: center; justify-content: center;
    font-size: 15px; color: #b23b3b; background: #fff; }
</style>
<canvas id="view"></canvas>
<div id="labels"></div>
<div class="bar">
  <div class="title">${title}</div>
  <div class="sub">${subtitle}</div>
  ${volumeNote}
  <div class="spacer"></div>
  <button data-mode="ballstick" class="on">球棍</button>
  <button data-mode="spacefill">空间填充</button>
  <button data-mode="stick">棒</button>
  <button data-mode="polyhedra">多面体</button>
  <button data-mode="wire">线框</button>
  <button id="t-labels" class="on">标签</button>
  <button id="t-cell" class="on">晶胞</button>
  <button id="t-axes" class="on">a/b/c</button>
  ${volumeControls}
  <button id="save">存 PNG</button>
  <button id="reset">复位</button>
</div>
<div class="legend" id="legend">${legendHtml}</div>
<div class="hint">拖拽旋转 · 滚轮缩放 · 右键拖动平移 · 双击复位</div>
<div id="nogl">当前浏览器不支持 WebGL，无法显示三维结构</div>
<pre id="err" style="position:fixed;left:14px;bottom:52px;color:#b23b3b;font:12px monospace;white-space:pre-wrap;max-width:80vw"></pre>
<script>
  // 把运行时错误写进 DOM：无头截图/--dump-dom 都能看见，避免"白屏无解释"。
  window.addEventListener("error", (e) => {
    const el = document.getElementById("err");
    if (el) el.textContent += "ERR: " + (e.message || e.error) + " @" + (e.filename || "") + ":" + (e.lineno || 0) + "\\n";
  });
  window.addEventListener("unhandledrejection", (e) => {
    const el = document.getElementById("err");
    if (el) el.textContent += "REJECT: " + (e.reason && (e.reason.stack || e.reason.message || e.reason)) + "\\n";
  });
</script>
<script type="module">
`

const tail = `
</script>
</html>
`



const html = [
  head,
  three,
  convexBundle,
  `\nconst STRUCT = ${json};\n`,
  viewer,
  tail,
].join('')

const fallbackOut = join(dirname(target), `${(basename(target).replace(/\.[^.]+$/, '') || 'structure')}-gl-${repeat.join('x')}.html`)
const out = resolve(flag('out', fallbackOut))
writeFileSync(out, html, 'utf8')
console.log(JSON.stringify({
  out,
  formula: summary.formula,
  atoms: scene.atoms.filter((atom) => !atom.ghost).length,
  ghostAtoms: scene.ghosts ?? 0,
  bonds: scene.bonds.length,
  cellEdges: scene.cellEdges.length,
  radius: +radius.toFixed(2),
  bytes: html.length,
}, null, 2))
