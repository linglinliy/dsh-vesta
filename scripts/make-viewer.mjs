#!/usr/bin/env node
/**
 * make-viewer —— 为一个 POSCAR/CONTCAR 生成**自包含的交互式 HTML 查看器**。
 *
 * 单文件、零依赖、离线可用：双击就能在浏览器里看，鼠标拖拽旋转、滚轮缩放、
 * 右键拖动平移、双击复位；带晶胞框、按距离成键、元素配色、原子标签。
 *
 *   node scripts/make-viewer.mjs <POSCAR> [--repeat 2,2,2] [--out viewer.html]
 *
 * 渲染数学与 scripts/render-proof.mjs 共用 viewer/scene.js（这里把源码内联进 HTML）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePoscar, buildSupercell, structureSummary, resolveTarget } from '../core.js'
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
  console.error('用法：node scripts/make-viewer.mjs <POSCAR> [--repeat 2,2,2] [--out viewer.html]')
  process.exit(2)
}

const repeat = String(flag('repeat', '1,1,1')).split(/[x, ]+/).filter(Boolean).map(Number)
const target = resolveTarget(input, process.cwd())
const parsed = parsePoscar(readFileSync(target, 'utf8'), basename(target))
const structure = buildSupercell(parsed, repeat)
const summary = structureSummary(structure)

// 内联 scene.js：去掉 ESM 的 export 关键字，作为普通脚本注入。
const sceneSource = readFileSync(join(HERE, '..', 'viewer', 'scene.js'), 'utf8')
  .replace(/^export\s+/gm, '')
  .replace(/^import .*$/gm, '')

const payload = JSON.stringify({ a1: structure.a1, a2: structure.a2, a3: structure.a3, atoms: structure.atoms })
const title = `${summary.formula} · ${repeat.join('×')} · ${basename(target)}`
const subtitle = `原子 ${summary.atoms}　晶胞 a=${summary.cell.a.toFixed(2)} b=${summary.cell.b.toFixed(2)} c=${summary.cell.c.toFixed(2)} Å　α=${summary.cell.alpha.toFixed(1)}° β=${summary.cell.beta.toFixed(1)}° γ=${summary.cell.gamma.toFixed(1)}°`

const html = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: #f7f8fa;
    font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #2a2f36; }
  #canvas { display: block; width: 100vw; height: 100vh; cursor: grab; touch-action: none; }
  #canvas.dragging { cursor: grabbing; }
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
  button.on { border-color: #2f6feb; color: #2f6feb; }
  .legend { position: fixed; left: 14px; bottom: 14px; display: flex; gap: 10px;
    background: rgba(255,255,255,.86); padding: 6px 10px; border-radius: 8px; font-size: 12px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%;
    margin-right: 4px; vertical-align: -1px; }
  .hint { position: fixed; right: 14px; bottom: 14px; font-size: 12px; color: #7b8494;
    background: rgba(255,255,255,.86); padding: 6px 10px; border-radius: 8px; }
</style>
<canvas id="canvas"></canvas>
<div class="bar">
  <div class="title">${title}</div>
  <div class="sub">${subtitle}</div>
  <div class="spacer"></div>
  <button id="fit">按晶胞取景</button>
  <button id="labels" class="on">原子标签</button>
  <button id="cell" class="on">晶胞框</button>
  <button id="shot">存 PNG</button>
  <button id="reset">复位</button>
</div>
<div class="legend" id="legend"></div>
<div class="hint">拖拽旋转 · 滚轮缩放 · 右键拖动平移 · 双击复位</div>
<script>${sceneSource}</script>
<script>
const STRUCT = ${payload};
const scene = buildScene(STRUCT);
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const view = { rx: 18, ry: 28, rz: 0, zoom: 1, panX: 0, panY: 0, fit: 'atoms', labels: true, cell: true };
// URL 参数：?rx=45&ry=-30&zoom=2&fit=cell&labels=off —— 也方便无头截图做验收。
const params = new URLSearchParams(location.search);
for (const key of ['rx', 'ry', 'rz', 'zoom']) {
  if (params.has(key) && Number.isFinite(Number(params.get(key)))) view[key] = Number(params.get(key));
}
if (params.get('fit') === 'cell') view.fit = 'cell';
if (params.get('labels') === 'off') view.labels = false;
if (params.get('cell') === 'off') view.cell = false;
let dpr = 1, width = 0, height = 0;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth; height = window.innerHeight;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function draw() {
  ctx.clearRect(0, 0, width, height);
  const primitives = projectScene(scene, { ...view, width, height, fit: view.fit });
  ctx.lineCap = 'round';
  for (const line of primitives.lines) {
    if (line.kind === 'cell' && !view.cell) continue;
    ctx.strokeStyle = line.color;
    ctx.lineWidth = line.width;
    ctx.beginPath(); ctx.moveTo(line.x1, line.y1); ctx.lineTo(line.x2, line.y2); ctx.stroke();
  }
  for (const circle of primitives.circles) {
    ctx.beginPath(); ctx.arc(circle.x, circle.y, circle.r * 1.06, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(42,47,54,.85)'; ctx.fill();
    ctx.beginPath(); ctx.arc(circle.x, circle.y, circle.r, 0, Math.PI * 2);
    ctx.fillStyle = circle.color; ctx.fill();
  }
  if (view.labels) {
    ctx.font = '600 11px -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = '#3a4150';
    ctx.textAlign = 'center';
    for (const label of primitives.labels) ctx.fillText(label.text, label.x, label.y);
  }
}

// 元素图例
const seen = new Map();
for (const atom of scene.atoms) if (!seen.has(atom.symbol)) seen.set(atom.symbol, atom.color);
document.getElementById('legend').innerHTML = [...seen.entries()]
  .map(([symbol, color]) => '<span><i style="background:' + color + '"></i>' + symbol + '</span>').join('');

let mode = null, last = null;
canvas.addEventListener('pointerdown', (event) => {
  mode = event.button === 2 || event.shiftKey ? 'pan' : 'rotate';
  last = { x: event.clientX, y: event.clientY };
  canvas.classList.add('dragging');
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!mode || !last) return;
  const dx = event.clientX - last.x, dy = event.clientY - last.y;
  last = { x: event.clientX, y: event.clientY };
  if (mode === 'rotate') { view.ry += dx * 0.45; view.rx += dy * 0.45; }
  else { view.panX += dx; view.panY += dy; }
  draw();
});
const endDrag = () => { mode = null; last = null; canvas.classList.remove('dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  view.zoom = Math.max(0.15, Math.min(12, view.zoom * Math.exp(-event.deltaY * 0.0015)));
  draw();
}, { passive: false });
canvas.addEventListener('dblclick', () => { view.panX = 0; view.panY = 0; view.zoom = 1; draw(); });

document.getElementById('fit').addEventListener('click', (event) => {
  view.fit = view.fit === 'cell' ? 'atoms' : 'cell';
  event.currentTarget.classList.toggle('on', view.fit === 'cell');
  event.currentTarget.textContent = view.fit === 'cell' ? '按原子取景' : '按晶胞取景';
  draw();
});
document.getElementById('labels').addEventListener('click', (event) => {
  view.labels = !view.labels; event.currentTarget.classList.toggle('on', view.labels); draw();
});
document.getElementById('cell').addEventListener('click', (event) => {
  view.cell = !view.cell; event.currentTarget.classList.toggle('on', view.cell); draw();
});
document.getElementById('reset').addEventListener('click', () => {
  view.rx = 18; view.ry = 28; view.rz = 0; view.zoom = 1; view.panX = 0; view.panY = 0; draw();
});
document.getElementById('shot').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'structure.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});
window.addEventListener('resize', resize);
resize();
</script>
</html>
`

const fallbackOut = join(dirname(target), `${(basename(target).replace(/\.[^.]+$/, '') || 'structure')}-${repeat.join('x')}.html`)
const out = resolve(flag('out', fallbackOut))
writeFileSync(out, html, 'utf8')
console.log(JSON.stringify({ out, formula: summary.formula, atoms: summary.atoms, repeat, bytes: html.length }, null, 2))
