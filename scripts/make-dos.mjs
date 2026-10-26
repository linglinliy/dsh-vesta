#!/usr/bin/env node
/**
 * make-dos —— DOSCAR → 自包含交互式 DOS 曲线图（单文件 HTML，离线可开）。
 *
 *   node scripts/make-dos.mjs <DOSCAR> [--out dos.html] [--window 8] [--log]
 *
 * 画法：x 轴默认以费米能级为 0；自旋极化时向上为正、向下为负（镜像）。
 * 交互：滚轮缩放（Shift+滚轮缩纵轴）、拖拽平移、双击复位、悬停读数、存 PNG。
 * URL 参数便于固定视角验收：?xmin=-8&xmax=6&log=1&abs=1
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { readDoscarFile, integrateDos } from '../core.js'
import { installFriendlyErrors } from './_friendly-errors.mjs'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/make-dos.mjs <DOSCAR> [--out dos.html] [--window 8] [--log]')
  process.exit(2)
}

const dos = readDoscarFile(resolve(input))
const nelect = integrateDos(dos)
const window = Number(flag('window', '8'))
const title = `${basename(dirname(resolve(input)))} · DOS`

const payload = {
  energies: dos.energies,
  up: dos.up,
  down: dos.down,
  efermi: dos.efermi,
  emin: dos.emin,
  emax: dos.emax,
  spinPolarized: dos.spinPolarized,
  integratedColumn: dos.integratedDos.length > 0,
  nelect,
  window,
  title,
}
const json = JSON.stringify(payload)

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
  #plot { display: block; width: 100vw; height: 100vh; cursor: crosshair; touch-action: none; }
  .bar { position: fixed; left: 14px; top: 14px; right: 14px; display: flex; gap: 8px;
    align-items: center; flex-wrap: wrap; pointer-events: none; }
  .bar > * { pointer-events: auto; }
  .title { font-weight: 600; font-size: 14px; background: rgba(255,255,255,.9);
    padding: 6px 10px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .sub { font-size: 12px; color: #5b6472; background: rgba(255,255,255,.9);
    padding: 6px 10px; border-radius: 8px; }
  .spacer { flex: 1; }
  button { font: inherit; border: 1px solid #ccd3dc; background: #fff; color: #2a2f36;
    padding: 6px 10px; border-radius: 8px; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,.05); }
  button:hover { background: #f0f4f9; }
  button.on { border-color: #2f6feb; color: #2f6feb; background: #eef4ff; }
  #readout { position: fixed; right: 14px; top: 62px; font-size: 12px; color: #3a4150;
    background: rgba(255,255,255,.9); padding: 6px 10px; border-radius: 8px; min-width: 190px; }
</style>
<canvas id="plot"></canvas>
<div class="bar">
  <div class="title">${title}</div>
  <div class="sub">E-fermi = ${dos.efermi.toFixed(4)} eV　∫DOS dE = ${nelect.toFixed(3)} e${dos.spinPolarized ? '　自旋极化' : ''}</div>
  <div class="spacer"></div>
  <button id="b-reset">复位</button>
  <button id="b-log">对数纵轴</button>
  <button id="b-fill" class="on">填充</button>
  <button id="b-abs">绝对能量</button>
  <button id="b-save">存 PNG</button>
</div>
<div id="readout">悬停查看数值</div>
<script>
const DATA = ${json};
const canvas = document.getElementById('plot');
const ctx = canvas.getContext('2d');
const state = {
  absolutE: false,
  log: false,
  fill: true,
  xmin: -${window},
  xmax: ${Math.max(3, Math.round(window / 2))},
  ymax: 1,
  dpr: 1,
  width: 0,
  height: 0,
};
let readoutValue = null;

const e0 = DATA.efermi;
const energies = DATA.energies;
const up = DATA.up;
const down = DATA.down;
const isSpin = DATA.spinPolarized;
const yMaxAuto = Math.max(...up, ...down.map((v) => Math.abs(v)), 1e-6);

function energyOf(i) { return state.absolutE ? energies[i] : energies[i] - e0; }

function xToEnergy(x) {
  const left = 70, right = state.width - 24;
  return state.xmin + ((x - left) / Math.max(1, right - left)) * (state.xmax - state.xmin);
}
function energyToX(e) {
  const left = 70, right = state.width - 24;
  return left + ((e - state.xmin) / Math.max(1e-9, state.xmax - state.xmin)) * (right - left);
}
function dosToY(v) {
  const top = 60, bottom = state.height - 56;
  const mid = isSpin ? (top + bottom) / 2 : bottom;
  const span = isSpin ? (bottom - top) / 2 : (bottom - top);
  const scale = (value) => {
    if (!state.log) return value / state.ymax;
    return Math.log10(1 + value) / Math.log10(1 + state.ymax);
  };
  return mid - (v / Math.abs(state.ymax)) * span * scale(Math.abs(state.ymax)) / Math.max(scale(Math.abs(state.ymax)), 1e-9);
}

function draw() {
  const W = state.width;
  const H = state.height;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f7f8fa';
  ctx.fillRect(0, 0, W, H);
  const left = 70, right = W - 24, top = 60, bottom = H - 56;

  // 坐标框
  ctx.strokeStyle = '#c7ced8';
  ctx.lineWidth = 1;
  ctx.strokeRect(left, top, right - left, bottom - top);

  // 零线：绝对能量时是 E=0，否则是费米能级
  const zeroE = state.absolutE ? 0 : 0;
  const zeroX = energyToX(zeroE);
  ctx.strokeStyle = '#98a1af';
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(zeroX, top); ctx.lineTo(zeroX, bottom); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#5b6472';
  ctx.font = '11px sans-serif';
  ctx.fillText(state.absolutE ? 'E = 0' : 'E_f', zeroX + 4, top + 12);

  // 能量网格
  const ticks = 6;
  for (let i = 0; i <= ticks; i += 1) {
    const e = state.xmin + ((state.xmax - state.xmin) * i) / ticks;
    const x = energyToX(e);
    ctx.strokeStyle = '#e6eaf0';
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.fillStyle = '#7b8494';
    ctx.fillText(e.toFixed(1), x - 10, bottom + 16);
  }
  ctx.fillStyle = '#5b6472';
  ctx.fillText(state.absolutE ? 'E (eV)' : 'E − E_f (eV)', (left + right) / 2 - 28, bottom + 36);

  // 曲线
  const drawSeries = (series, sign, color) => {
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < energies.length; i += 1) {
      const e = energyOf(i);
      if (e < state.xmin || e > state.xmax) continue;
      const x = energyToX(e);
      const y = dosToY(sign * Math.abs(series[i]));
      if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y);
    }
    if (!started) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    if (state.fill) {
      ctx.lineTo(energyToX(Math.min(state.xmax, Math.max(state.xmin, energyOf(energies.length - 1)))), dosToY(0));
      ctx.lineTo(energyToX(Math.min(state.xmax, Math.max(state.xmin, energyOf(0)))), dosToY(0));
      ctx.closePath();
      ctx.fillStyle = color.replace('rgb', 'rgba').replace(')', ',0.18)');
      ctx.fill();
    }
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, right - left, bottom - top);
  ctx.clip();
  drawSeries(up, 1, 'rgb(47,111,235)');
  if (isSpin) drawSeries(down, -1, 'rgb(217,59,59)');
  ctx.restore();

  // 纵轴刻度
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i += 1) {
    const value = (state.ymax * i) / yTicks;
    const y = dosToY(value);
    ctx.strokeStyle = '#eef1f6';
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.fillStyle = '#7b8494';
    ctx.fillText(value.toFixed(2), 24, y + 4);
    if (isSpin) {
      const yDown = dosToY(-value);
      ctx.strokeStyle = '#eef1f6';
      ctx.beginPath(); ctx.moveTo(left, yDown); ctx.lineTo(right, yDown); ctx.stroke();
      ctx.fillStyle = '#7b8494';
      ctx.fillText('-' + value.toFixed(2), 18, yDown + 4);
    }
  }
  ctx.fillStyle = '#5b6472';
  ctx.fillText('DOS (states/eV)', left, top - 8);

  if (readoutValue) {
    const x = energyToX(readoutValue.energy);
    ctx.strokeStyle = '#2a2f36';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.setLineDash([]);
  }
}

function resize() {
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  canvas.width = Math.round(state.width * state.dpr);
  canvas.height = Math.round(state.height * state.dpr);
  draw();
}

function reset() {
  state.xmin = -${window};
  state.xmax = ${Math.max(3, Math.round(window / 2))};
  state.ymax = yMaxAuto * 1.05;
  draw();
}

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  if (event.shiftKey) {
    state.ymax *= Math.exp(event.deltaY * 0.0012);
  } else {
    const centre = xToEnergy(event.clientX);
    const factor = Math.exp(event.deltaY * 0.0012);
    state.xmin = centre + (state.xmin - centre) * factor;
    state.xmax = centre + (state.xmax - centre) * factor;
  }
  draw();
}, { passive: false });

let drag = null;
canvas.addEventListener('pointerdown', (event) => {
  drag = { x: event.clientX, y: event.clientY, xmin: state.xmin, xmax: state.xmax, ymax: state.ymax };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  const e = xToEnergy(event.clientX);
  const index = energies.reduce((best, energy, i) => (
    Math.abs(energyOf(i) - e) < Math.abs(energyOf(best) - e) ? i : best
  ), 0);
  readoutValue = { energy: energyOf(index), up: up[index], down: down[index] };
  const el = document.getElementById('readout');
  el.textContent = 'E' + (state.absolutE ? '' : '−E_f') + ' = ' + readoutValue.energy.toFixed(3) + ' eV　DOS = '
    + readoutValue.up.toFixed(3) + (isSpin ? ' / ' + readoutValue.down.toFixed(3) : '');
  if (drag) {
    const dx = (event.clientX - drag.x) / Math.max(1, canvas.width / state.dpr - 94);
    const span = drag.xmax - drag.xmin;
    state.xmin = drag.xmin - dx * span;
    state.xmax = drag.xmax - dx * span;
    if (event.shiftKey) state.ymax = drag.ymax * Math.exp((drag.y - event.clientY) * 0.004);
  }
  draw();
});
canvas.addEventListener('pointerup', () => { drag = null });
canvas.addEventListener('dblclick', reset);

document.getElementById('b-reset').addEventListener('click', reset);
document.getElementById('b-log').addEventListener('click', (event) => {
  state.log = !state.log;
  event.currentTarget.classList.toggle('on', state.log);
  draw();
});
document.getElementById('b-fill').addEventListener('click', (event) => {
  state.fill = !state.fill;
  event.currentTarget.classList.toggle('on', state.fill);
  draw();
});
document.getElementById('b-abs').addEventListener('click', (event) => {
  state.absolutE = !state.absolutE;
  event.currentTarget.classList.toggle('on', state.absolutE);
  if (state.absolutE) {
    state.xmin = e0 - ${window};
    state.xmax = e0 + ${Math.max(3, Math.round(window / 2))};
  } else {
    state.xmin = -${window};
    state.xmax = ${Math.max(3, Math.round(window / 2))};
  }
  draw();
});
document.getElementById('b-save').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'dos.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});
window.addEventListener('resize', resize);

// URL 参数：固定视角，便于分享与无头验收
const params = new URLSearchParams(location.search);
if (params.has('xmin')) state.xmin = Number(params.get('xmin'));
if (params.has('xmax')) state.xmax = Number(params.get('xmax'));
if (params.get('log') === '1') state.log = true;
if (params.get('abs') === '1') state.absolutE = true;
if (params.has('ymax')) state.ymax = Number(params.get('ymax'));
else state.ymax = yMaxAuto * 1.05;

resize();
</script>
</html>
`

const out = resolve(flag('out', join(dirname(input), `${basename(input)}-dos.html`)))
writeFileSync(out, html, 'utf8')
console.log(JSON.stringify({
  out,
  nedos: dos.nedos,
  efermi: +dos.efermi.toFixed(4),
  spinPolarized: dos.spinPolarized,
  integratedElectrons: +nelect.toFixed(3),
  bytes: html.length,
}, null, 2))
