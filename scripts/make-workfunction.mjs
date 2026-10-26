#!/usr/bin/env node
/**
 * make-workfunction —— LOCPOT 平面平均电势剖面 + 功函数标注，输出单文件 HTML。
 *
 *   node scripts/make-workfunction.mjs <LOCPOT 或任务目录> [--axis c] [--efermi 2.0] [--out wf.html]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { parseOutcar, readVolumeFile, workFunction } from '../core.js'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/make-workfunction.mjs <LOCPOT 或任务目录> [--axis c] [--efermi 2.0] [--out wf.html]')
  process.exit(2)
}

const source = resolve(input)
const locpot = existsSync(source) && !/locpot$/i.test(source) ? join(source, 'LOCPOT') : source
if (!existsSync(locpot)) {
  console.error(`找不到 LOCPOT：${locpot}`)
  process.exit(2)
}

let efermi = Number(flag('efermi', 'NaN'))
let efermiSource = '--efermi'
if (!Number.isFinite(efermi)) {
  const outcar = join(dirname(locpot), 'OUTCAR')
  if (existsSync(outcar)) {
    const parsed = parseOutcar(readFileSync(outcar, 'utf8'))
    if (Number.isFinite(parsed.efermi)) {
      efermi = parsed.efermi
      efermiSource = 'OUTCAR'
    }
  }
}
if (!Number.isFinite(efermi)) {
  console.error('读不到费米能级：请用 --efermi 指定')
  process.exit(3)
}

const volume = readVolumeFile(locpot)
const axis = flag('axis', 'c')
const result = workFunction(volume, { efermi, axis })
const title = `${basename(dirname(locpot))} · 平面平均电势`
const payload = JSON.stringify({
  positions: result.profile.positions,
  values: result.profile.values,
  efermi: result.efermi,
  vacuumLevel: result.vacuumLevel,
  workFunction: result.workFunction,
  plateau: result.plateau,
  axis,
  title,
})

const html = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #f7f8fa;
    font: 13px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; color: #2a2f36; }
  #plot { display: block; width: 100vw; height: 100vh; }
  .bar { position: fixed; left: 14px; top: 14px; display: flex; gap: 8px; align-items: center; }
  .card { background: rgba(255,255,255,.94); padding: 6px 10px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .title { font-weight: 600; }
  .sub { color: #5b6472; font-size: 12px; }
  #readout { position: fixed; right: 14px; bottom: 14px; background: rgba(255,255,255,.94);
    padding: 6px 10px; border-radius: 8px; font-size: 12px; min-width: 200px; }
  button { font: inherit; border: 1px solid #ccd3dc; background: #fff; padding: 6px 10px;
    border-radius: 8px; cursor: pointer; }
</style>
<canvas id="plot"></canvas>
<div class="bar">
  <div class="card"><span class="title">${title}</span>
    <span class="sub">　轴 ${axis}　Φ = ${result.workFunction.toFixed(3)} eV　E_vac = ${result.vacuumLevel.toFixed(3)} eV　E_F = ${result.efermi.toFixed(3)} eV（${efermiSource}）</span></div>
  <div class="card"><button id="b-save">存 PNG</button></div>
</div>
<div id="readout">悬停查看电势</div>
<script>
const DATA = ${payload};
const canvas = document.getElementById('plot');
const ctx = canvas.getContext('2d');
const state = { width: 0, height: 0, dpr: 1, hover: null };
const values = DATA.values;
const min = Math.min(...values, DATA.efermi);
const max = Math.max(...values);
const pad = (max - min) * 0.12 || 1;
const yMin = min - pad;
const yMax = max + pad;

function draw() {
  const W = state.width, H = state.height;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.fillStyle = '#f7f8fa'; ctx.fillRect(0, 0, W, H);
  const left = 74, right = W - 30, top = 76, bottom = H - 58;
  const xOf = (position) => left + (position / DATA.positions[DATA.positions.length - 1]) * (right - left);
  const yOf = (value) => bottom - ((value - yMin) / (yMax - yMin)) * (bottom - top);

  // 真空平台阴影（平台可能跨周期边界）
  const start = DATA.plateau.start;
  const end = DATA.plateau.end;
  ctx.fillStyle = 'rgba(47,111,235,.08)';
  if (start <= end) ctx.fillRect(xOf(start), top, xOf(end) - xOf(start), bottom - top);
  else {
    ctx.fillRect(xOf(start), top, right - xOf(start), bottom - top);
    ctx.fillRect(left, top, xOf(end) - left, bottom - top);
  }

  // 网格与刻度
  ctx.strokeStyle = '#c7ced8'; ctx.strokeRect(left, top, right - left, bottom - top);
  for (let value = Math.ceil(yMin); value <= yMax; value += 1) {
    const y = yOf(value);
    ctx.strokeStyle = '#eef1f6'; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.fillStyle = '#7b8494'; ctx.font = '11px sans-serif'; ctx.fillText(value.toFixed(0), 44, y + 4);
  }
  for (let position = 0; position <= DATA.positions[DATA.positions.length - 1]; position += 10) {
    const x = xOf(position);
    ctx.strokeStyle = '#e8ecf2'; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.fillStyle = '#7b8494'; ctx.fillText(position.toFixed(0), x - 6, bottom + 16);
  }
  ctx.fillStyle = '#5b6472'; ctx.font = '12px sans-serif';
  ctx.fillText('沿 ' + DATA.axis + ' 的位置 (Å)', (left + right) / 2 - 46, bottom + 38);
  ctx.fillText('电势 (eV)', 12, top - 10);

  // 费米能级与真空能级
  const line = (value, color, label) => {
    const y = yOf(value);
    ctx.strokeStyle = color; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color; ctx.font = '11px sans-serif';
    ctx.fillText(label, right - 88, y - 4);
  };
  line(DATA.efermi, '#c2410c', 'E_F ' + DATA.efermi.toFixed(2));
  line(DATA.vacuumLevel, '#1d4ed8', 'E_vac ' + DATA.vacuumLevel.toFixed(2));

  // 曲线
  ctx.beginPath();
  DATA.positions.forEach((position, index) => {
    const x = xOf(position);
    const y = yOf(values[index]);
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#2f6feb'; ctx.lineWidth = 1.6; ctx.stroke();

  // Φ 标注
  const midX = left + (right - left) * 0.5;
  ctx.strokeStyle = '#33465c'; ctx.beginPath();
  ctx.moveTo(midX, yOf(DATA.vacuumLevel)); ctx.lineTo(midX, yOf(DATA.efermi)); ctx.stroke();
  ctx.fillStyle = '#33465c'; ctx.font = '600 12px sans-serif';
  ctx.fillText('Φ = ' + DATA.workFunction.toFixed(3) + ' eV', midX + 8, (yOf(DATA.vacuumLevel) + yOf(DATA.efermi)) / 2 + 4);

  if (state.hover !== null) {
    const x = xOf(state.hover);
    ctx.strokeStyle = 'rgba(42,47,54,.45)'; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]);
  }
}

canvas.addEventListener('pointermove', (event) => {
  const left = 74, right = state.width - 30;
  const position = ((event.clientX - left) / Math.max(1, right - left)) * DATA.positions[DATA.positions.length - 1];
  state.hover = position;
  const index = Math.max(0, Math.min(values.length - 1, Math.round(position / DATA.positions[DATA.positions.length - 1] * (values.length - 1))));
  document.getElementById('readout').textContent = '位置 ' + position.toFixed(2) + ' Å　电势 ' + values[index].toFixed(3) + ' eV';
  draw();
});
canvas.addEventListener('pointerleave', () => { state.hover = null; draw(); });
document.getElementById('b-save').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'workfunction.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});
function resize() {
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.width = window.innerWidth; state.height = window.innerHeight;
  canvas.width = Math.round(state.width * state.dpr);
  canvas.height = Math.round(state.height * state.dpr);
  draw();
}
window.addEventListener('resize', resize);
resize();
</script>
</html>
`

const out = resolve(flag('out', join(dirname(locpot), 'workfunction.html')))
writeFileSync(out, html, 'utf8')
console.log(JSON.stringify({
  out,
  axis,
  efermi: +result.efermi.toFixed(4),
  vacuumLevel: +result.vacuumLevel.toFixed(4),
  workFunction: +result.workFunction.toFixed(4),
  plateau: result.plateau,
  bytes: html.length,
}, null, 2))
