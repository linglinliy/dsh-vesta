#!/usr/bin/env node
/**
 * make-compare —— 把同一根目录下多个任务的 DOS 或收敛曲线叠加到一张图（单文件 HTML）。
 *
 *   node scripts/make-compare.mjs --root <根目录> --kind dos|conv [--out compare.html]
 *                                 [--names 5.5,latticefine_C2_a2p464_k25] [--window 6]
 *
 * dos ：横轴 E − E_f（eV），纵轴总态密度（states/eV）；不同体系互相比较时可开「归一化」。
 * conv：横轴电子步，纵轴 E − E_final（eV），看谁收敛得更快/更稳。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { readDoscarFile, readOszicarFile, scanTasks } from '../core.js'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const root = flag('root', '')
const kind = String(flag('kind', 'dos')).toLowerCase()
if (!root || !['dos', 'conv'].includes(kind)) {
  console.error('用法：node scripts/make-compare.mjs --root <根目录> --kind dos|conv [--out compare.html] [--names a,b]')
  process.exit(2)
}
const window = Number(flag('window', '6'))
const names = String(flag('names', '')).split(',').map((item) => item.trim()).filter(Boolean)

const scan = await scanTasks(resolve(root), { maxDepth: Number(flag('depth', '3')) })
const tasks = names.length > 0 ? scan.tasks.filter((task) => names.includes(task.name)) : scan.tasks
if (tasks.length === 0) {
  console.error('没有匹配的任务')
  process.exit(2)
}

const palette = ['#2f6feb', '#d93b3b', '#1f9d55', '#8a4fd3', '#d68a1e', '#0f8d9e', '#b23b7a', '#5a6b7d']
const series = []
/** 被跳过的任务及原因（真实数据里会有截断文件）。 */
const skipped = []

for (const [index, task] of tasks.entries()) {
  const color = palette[index % palette.length]
  if (kind === 'dos') {
    const doscar = join(task.dir, 'DOSCAR')
    if (!existsSync(doscar)) continue
    let dos
    try {
      dos = readDoscarFile(doscar)
    } catch (error) {
      // 真实数据里有被截断/空的 DOSCAR：跳过并记一笔，不要让整张图失败
      skipped.push(`${task.name}（DOSCAR 不可用：${String(error.message).slice(0, 40)}）`)
      continue
    }
    const total = dos.energies.map((energy, i) => ({
      x: energy - dos.efermi,
      y: dos.up[i] + (dos.spinPolarized ? dos.down[i] : 0),
    }))
    series.push({ name: task.name, color, points: total, efermi: dos.efermi, spin: dos.spinPolarized })
  } else {
    const oszicar = join(task.dir, 'OSZICAR')
    if (!existsSync(oszicar)) continue
    const data = readOszicarFile(oszicar)
    const last = data.steps[data.steps.length - 1]
    series.push({
      name: task.name,
      color,
      points: data.steps.map((step, i) => ({ x: i + 1, y: step.energy - last.energy })),
      finalEnergy: last.energy,
    })
  }
}

if (series.length === 0) {
  console.error(`所给任务里没有可用的 ${kind === 'dos' ? 'DOSCAR' : 'OSZICAR'}`)
  process.exit(2)
}

const payload = {
  kind,
  window,
  series: series.map((item) => ({
    name: item.name,
    color: item.color,
    points: item.points,
    note: kind === 'dos'
      ? `E_f = ${item.efermi.toFixed(3)} eV${item.spin ? '（自旋极化）' : ''}`
      : `E_final = ${item.finalEnergy.toFixed(4)} eV`,
  })),
}
const json = JSON.stringify(payload)
const title = `${basename(resolve(root))} · ${kind === 'dos' ? 'DOS 叠加' : '收敛叠加'}`

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
  #plot { display: block; width: 100vw; height: 100vh; }
  .bar { position: fixed; left: 14px; top: 14px; right: 14px; display: flex; gap: 8px;
    align-items: center; flex-wrap: wrap; pointer-events: none; }
  .bar > * { pointer-events: auto; }
  .title { font-weight: 600; font-size: 14px; background: rgba(255,255,255,.9);
    padding: 6px 10px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .sub { font-size: 12px; color: #5b6472; background: rgba(255,255,255,.9);
    padding: 6px 10px; border-radius: 8px; }
  .spacer { flex: 1; }
  button { font: inherit; border: 1px solid #ccd3dc; background: #fff; color: #2a2f36;
    padding: 6px 10px; border-radius: 8px; cursor: pointer; }
  button:hover { background: #f0f4f9; }
  button.on { border-color: #2f6feb; color: #2f6feb; background: #eef4ff; }
  .legend { position: fixed; left: 14px; bottom: 14px; background: rgba(255,255,255,.92);
    padding: 8px 12px; border-radius: 8px; font-size: 12px; line-height: 1.8; }
  .legend i { display: inline-block; width: 14px; height: 3px; border-radius: 2px;
    margin-right: 6px; vertical-align: 3px; }
</style>
<canvas id="plot"></canvas>
<div class="bar">
  <div class="title">${title}</div>
  <div class="sub">${series.length} 个曲线　${kind === 'dos' ? `窗口 ±${window} eV` : '纵轴 E − E_final'}</div>
  <div class="spacer"></div>
  <button id="b-log">对数</button>
  <button id="b-norm">归一化</button>
  <button id="b-save">存 PNG</button>
</div>
<div class="legend" id="legend"></div>
<script>
const DATA = ${json};
const canvas = document.getElementById('plot');
const ctx = canvas.getContext('2d');
const state = { normalize: false, logConv: DATA.kind === 'conv', dpr: 1, width: 0, height: 0 };
const FLOOR = 1e-6;
const transformY = (value) => (DATA.kind === 'conv' && state.logConv
  ? Math.log10(Math.max(value, FLOOR))
  : value);

document.getElementById('legend').innerHTML = DATA.series
  .map((item) => '<div><i style="background:' + item.color + '"></i>' + item.name + '　<span style="color:#7b8494">' + item.note + '</span></div>')
  .join('');

function bounds() {
  const xs = [];
  const ys = [];
  for (const item of DATA.series) {
    for (const point of item.points) {
      if (DATA.kind === 'dos' && Math.abs(point.x) > DATA.window) continue;
      xs.push(point.x);
      ys.push(transformY(point.y));
    }
  }
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(...ys, 1e-9);
  return { xMin, xMax, yMin, yMax };
}

function draw() {
  const W = state.width;
  const H = state.height;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.fillStyle = '#f7f8fa';
  ctx.fillRect(0, 0, W, H);
  const left = 78, right = W - 28, top = 64, bottom = H - 56;
  const { xMin, xMax, yMin, yMax } = bounds();
  ctx.strokeStyle = '#c7ced8';
  ctx.strokeRect(left, top, right - left, bottom - top);

  const xOf = (value) => left + ((value - xMin) / Math.max(1e-9, xMax - xMin)) * (right - left);
  const yOf = (value) => bottom - ((value - yMin) / Math.max(1e-9, yMax - yMin)) * (bottom - top);

  // 网格与刻度
  let lastLabel = null;
  for (let i = 0; i <= 5; i += 1) {
    const value = xMin + ((xMax - xMin) * i) / 5;
    const x = xOf(value);
    ctx.strokeStyle = '#e8ecf2';
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.fillStyle = '#7b8494';
    ctx.font = '11px sans-serif';
    ctx.fillText(value.toFixed(1), x - 9, bottom + 16);
    const yValue = yMin + ((yMax - yMin) * i) / 5;
    const y = yOf(yValue);
    ctx.strokeStyle = '#eef1f6';
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.fillStyle = '#7b8494';
    const label = DATA.kind === 'conv' && state.logConv ? '1e' + Math.round(yValue) : yValue.toFixed(DATA.kind === 'conv' ? 3 : 2);
    if (label !== lastLabel) {
      ctx.fillText(label, 16, y + 4);
      lastLabel = label;
    }
  }
  ctx.fillStyle = '#5b6472';
  ctx.font = '12px sans-serif';
  ctx.fillText(DATA.kind === 'dos' ? 'E − E_f (eV)' : '电子步', (left + right) / 2 - 30, bottom + 36);
  ctx.fillText(DATA.kind === 'dos' ? 'DOS (states/eV)' : (state.logConv ? 'log10(E − E_final)' : 'E − E_final (eV)'), left + 6, top + 16);

  // 零线
  if (xMin < 0 && xMax > 0) {
    ctx.strokeStyle = '#98a1af';
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(xOf(0), top); ctx.lineTo(xOf(0), bottom); ctx.stroke();
    ctx.setLineDash([]);
  }

  for (const item of DATA.series) {
    const scale = state.normalize
      ? 1 / Math.max(...item.points.map((p) => p.y), 1e-9)
      : 1;
    ctx.beginPath();
    let started = false;
    for (const point of item.points) {
      if (DATA.kind === 'dos' && Math.abs(point.x) > DATA.window) continue;
      const x = xOf(point.x);
      const y = yOf(transformY(point.y) * (state.logConv && DATA.kind === 'conv' ? 1 : scale));
      if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y);
    }
    if (!started) continue;
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 1.7;
    ctx.stroke();
  }
}

document.getElementById('b-log').classList.toggle('on', state.logConv);
if (DATA.kind !== 'conv') document.getElementById('b-log').style.display = 'none';
document.getElementById('b-log').addEventListener('click', (event) => {
  state.logConv = !state.logConv;
  event.currentTarget.classList.toggle('on', state.logConv);
  draw();
});

document.getElementById('b-norm').addEventListener('click', (event) => {
  state.normalize = !state.normalize;
  event.currentTarget.classList.toggle('on', state.normalize);
  draw();
});
document.getElementById('b-save').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'compare.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});

function resize() {
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  canvas.width = Math.round(state.width * state.dpr);
  canvas.height = Math.round(state.height * state.dpr);
  draw();
}
window.addEventListener('resize', resize);
resize();
</script>
</html>
`

const out = resolve(flag('out', join(resolve(root), `compare-${kind}.html`)))
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, html, 'utf8')
console.log(JSON.stringify({
  out,
  kind,
  tasks: series.map((item) => item.name),
  skipped,
  bytes: html.length,
}, null, 2))
