#!/usr/bin/env node
/**
 * make-slice —— 体积数据 → 二维截面查看器（对应 VESTA 的 2D Data Display）。
 *
 *   node scripts/make-slice.mjs <CHGCAR|CUBE|ELFCAR|LOCPOT> [--plane xy|yz|zx] [--at 0.5] [--out slice.html]
 *
 * 界面上可切换截面方向、拖动截面位置，鼠标悬停读该点数值；底部颜色条给出量程。
 * 结构与原子来自体积文件本身（VASP 体积文件自带 POSCAR 段）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { readVolumeFile, encodeVolume, sampleSlice } from '../core.js'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/make-slice.mjs <CHGCAR|CUBE|ELFCAR|LOCPOT> [--plane xy|yz|zx] [--at 0.5] [--out slice.html]')
  process.exit(2)
}

const source = resolve(input)
const volume = readVolumeFile(source)
const encoded = encodeVolume(volume)
const plane = ['xy', 'yz', 'zx'].includes(flag('plane', 'xy')) ? flag('plane', 'xy') : 'xy'
const at = Number(flag('at', '0.5'))

// 统计用全分辨率采样（页面里用降采样后的网格）
const stats = sampleSlice(volume, { plane, at, size: 128 })

const structure = volume.structure ?? null
const atoms = structure
  ? structure.atoms.map((atom) => ({ symbol: atom.symbol, frac: atom.frac }))
  : (volume.atoms ?? []).map((atom) => ({ symbol: atom.symbol, frac: null }))

const payload = {
  volume: {
    dims: encoded.dims,
    min: encoded.min,
    max: encoded.max,
    data: encoded.data,
  },
  plane,
  at,
  unit: volume.unit ?? '',
  title: volume.title ?? basename(source),
  atoms: atoms.filter((atom) => Array.isArray(atom.frac)),
  cell: structure ? [structure.a1, structure.a2, structure.a3] : null,
}

const json = JSON.stringify(payload)
const title = `${basename(dirname(source))} · 截面`

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
  #stage { display: block; width: 100vw; height: 100vh; cursor: crosshair; }
  .bar { position: fixed; left: 14px; top: 14px; right: 14px; display: flex; gap: 8px;
    align-items: center; flex-wrap: wrap; pointer-events: none; }
  .bar > * { pointer-events: auto; }
  .title { font-weight: 600; font-size: 14px; background: rgba(255,255,255,.92);
    padding: 6px 10px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .sub { font-size: 12px; color: #5b6472; background: rgba(255,255,255,.92); padding: 6px 10px; border-radius: 8px; }
  .spacer { flex: 1; }
  button { font: inherit; border: 1px solid #ccd3dc; background: #fff; color: #2a2f36;
    padding: 6px 10px; border-radius: 8px; cursor: pointer; }
  button:hover { background: #f0f4f9; }
  button.on { border-color: #2f6feb; color: #2f6feb; background: #eef4ff; }
  .dock { position: fixed; left: 14px; right: 14px; bottom: 14px; display: flex; gap: 12px;
    align-items: center; background: rgba(255,255,255,.94); padding: 10px 14px; border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  input[type=range] { flex: 1; }
  #readout { position: fixed; right: 14px; top: 64px; font-size: 12px; color: #3a4150;
    background: rgba(255,255,255,.92); padding: 6px 10px; border-radius: 8px; min-width: 170px; }
</style>
<canvas id="stage"></canvas>
<div class="bar">
  <div class="title">${title}</div>
  <div class="sub">${volume.title ?? ''}　${encoded.dims.join('×')}　单位 ${volume.unit ?? ''}</div>
  <div class="spacer"></div>
  <button data-plane="xy" class="${plane === 'xy' ? 'on' : ''}">xy</button>
  <button data-plane="yz" class="${plane === 'yz' ? 'on' : ''}">yz</button>
  <button data-plane="zx" class="${plane === 'zx' ? 'on' : ''}">zx</button>
</div>
<div id="readout">悬停读取数值</div>
<div class="dock">
  <span id="posLabel">截面位置 0.50</span>
  <input id="slider" type="range" min="0" max="0.99" step="0.01" value="${Number.isFinite(at) ? at : 0.5}">
</div>
<script>
const DATA = ${json};
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const slider = document.getElementById('slider');
const posLabel = document.getElementById('posLabel');
const readout = document.getElementById('readout');

const state = { plane: DATA.plane, at: Number(slider.value), dpr: 1, width: 0, height: 0, hover: null };

// base64 → Uint8
const binary = atob(DATA.volume.data);
const voxels = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i += 1) voxels[i] = binary.charCodeAt(i);
const [NX, NY, NZ] = DATA.volume.dims;
const VMIN = DATA.volume.min;
const VMAX = DATA.volume.max;
const valueAt = (i, j, k) => VMIN + (voxels[(k * NY + j) * NX + i] / 255) * (VMAX - VMIN);

function wrap(value, count) {
  const scaled = value * count;
  const base = Math.floor(scaled);
  return { lo: ((base % count) + count) % count, hi: (((base + 1) % count) + count) % count, frac: scaled - base };
}
function sample(x, y, z) {
  const fx = wrap(x, NX), fy = wrap(y, NY), fz = wrap(z, NZ);
  const c00 = valueAt(fx.lo, fy.lo, fz.lo) * (1 - fx.frac) + valueAt(fx.hi, fy.lo, fz.lo) * fx.frac;
  const c10 = valueAt(fx.lo, fy.hi, fz.lo) * (1 - fx.frac) + valueAt(fx.hi, fy.hi, fz.lo) * fx.frac;
  const c01 = valueAt(fx.lo, fy.lo, fz.hi) * (1 - fx.frac) + valueAt(fx.hi, fy.lo, fz.hi) * fx.frac;
  const c11 = valueAt(fx.lo, fy.hi, fz.hi) * (1 - fx.frac) + valueAt(fx.hi, fy.hi, fz.hi) * fx.frac;
  const bottom = c00 * (1 - fy.frac) + c10 * fy.frac;
  const top = c01 * (1 - fy.frac) + c11 * fy.frac;
  return bottom * (1 - fz.frac) + top * fz.frac;
}
const samplePlane = (u, v) => state.plane === 'xy' ? sample(u, v, state.at)
  : state.plane === 'yz' ? sample(state.at, u, v)
    : sample(v, state.at, u);

function colorOf(value) {
  const lo = Math.min(0, VMIN);
  const hi = Math.max(0, VMAX);
  const range = Math.max(hi - lo, 1e-12);
  const t = Math.min(Math.max((value - lo) / range, 0), 1);
  if (VMIN < 0) {
    // 有符号：0 附近接近白，正蓝负红
    const mid = (0 - lo) / range;
    if (t >= mid) {
      const k = (t - mid) / Math.max(1 - mid, 1e-9);
      return [255 - k * 208, 255 - k * 144, 255 - k * 20];
    }
    const k = (mid - t) / Math.max(mid, 1e-9);
    return [255 - k * 38, 255 - k * 196, 255 - k * 196];
  }
  // 全正：白 → 深蓝
  return [255 - t * 208, 255 - t * 144, 255 - t * 20];
}

function draw() {
  const W = state.width, H = state.height;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.fillStyle = '#f7f8fa';
  ctx.fillRect(0, 0, W, H);

  const size = Math.min(W, H) * 0.72;
  const left = (W - size) / 2;
  const top = (H - size) / 2 - 10;
  const resolution = Math.min(256, Math.round(size));
  const image = ctx.createImageData(resolution, resolution);
  for (let row = 0; row < resolution; row += 1) {
    const v = row / resolution;
    for (let col = 0; col < resolution; col += 1) {
      const u = col / resolution;
      const [r, g, b] = colorOf(samplePlane(u, v));
      const index = (row * resolution + col) * 4;
      image.data[index] = r;
      image.data[index + 1] = g;
      image.data[index + 2] = b;
      image.data[index + 3] = 255;
    }
  }
  const off = document.createElement('canvas');
  off.width = resolution;
  off.height = resolution;
  off.getContext('2d').putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, left, top, size, size);

  // 原子投影
  ctx.font = '11px sans-serif';
  for (const atom of DATA.atoms) {
    let u, v;
    if (state.plane === 'xy') { u = atom.frac[0]; v = atom.frac[1] }
    else if (state.plane === 'yz') { u = atom.frac[1]; v = atom.frac[2] }
    else { u = atom.frac[2]; v = atom.frac[0] }
    const x = left + u * size;
    const y = top + v * size;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,45,52,.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = '#2a2f36';
    ctx.fillText(atom.symbol, x + 6, y - 5);
  }

  // 颜色条
  const barWidth = 160;
  const barLeft = left + size + 18;
  const barTop = top;
  const barHeight = size;
  const gradient = ctx.createLinearGradient(0, barTop + barHeight, 0, barTop);
  const lo = Math.min(0, VMIN), hi = Math.max(0, VMAX);
  for (let i = 0; i <= 10; i += 1) {
    const value = lo + ((hi - lo) * i) / 10;
    const [r, g, b] = colorOf(value);
    gradient.addColorStop(i / 10, 'rgb(' + [Math.round(r), Math.round(g), Math.round(b)].join(',') + ')');
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(barLeft, barTop, 16, barHeight);
  ctx.strokeStyle = '#c7ced8';
  ctx.strokeRect(barLeft, barTop, 16, barHeight);
  ctx.fillStyle = '#5b6472';
  for (let i = 0; i <= 4; i += 1) {
    const value = lo + ((hi - lo) * i) / 4;
    const y = barTop + barHeight - (barHeight * i) / 4;
    ctx.fillText(value.toExponential(2), barLeft + 22, y + 4);
  }
  ctx.fillText(DATA.unit, barLeft, barTop - 8);

  // 悬停十字与读数
  if (state.hover) {
    const { x, y } = state.hover;
    ctx.strokeStyle = 'rgba(42,47,54,.6)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + size, y); ctx.stroke();
    ctx.setLineDash([]);
  }
}

canvas.addEventListener('pointermove', (event) => {
  const W = state.width, H = state.height;
  const size = Math.min(W, H) * 0.72;
  const left = (W - size) / 2;
  const top = (H - size) / 2 - 10;
  const u = (event.clientX - left) / size;
  const v = (event.clientY - top) / size;
  if (u < 0 || u > 1 || v < 0 || v > 1) {
    state.hover = null;
    draw();
    return;
  }
  state.hover = { x: event.clientX, y: event.clientY };
  const value = samplePlane(u, v);
  readout.textContent = 'u = ' + u.toFixed(3) + '　v = ' + v.toFixed(3) + '　值 = ' + value.toExponential(4) + ' ' + DATA.unit;
  draw();
});

slider.addEventListener('input', () => {
  state.at = Number(slider.value);
  posLabel.textContent = '截面位置 ' + state.at.toFixed(2);
  draw();
});

for (const button of document.querySelectorAll('button[data-plane]')) {
  button.addEventListener('click', () => {
    state.plane = button.dataset.plane;
    for (const other of document.querySelectorAll('button[data-plane]')) other.classList.toggle('on', other === button);
    draw();
  });
}

function resize() {
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.width = window.innerWidth;
  state.height = window.innerHeight;
  canvas.width = Math.round(state.width * state.dpr);
  canvas.height = Math.round(state.height * state.dpr);
  draw();
}
window.addEventListener('resize', resize);
slider.value = String(state.at);
posLabel.textContent = '截面位置 ' + state.at.toFixed(2);
resize();
</script>
</html>
`

const out = resolve(flag('out', join(dirname(source), `${basename(source)}-slice.html`)))
writeFileSync(out, html, 'utf8')
console.log(JSON.stringify({
  out,
  plane,
  at,
  dims: encoded.dims,
  fullDims: volume.dims,
  unit: volume.unit,
  stats: { min: +stats.min.toFixed(6), max: +stats.max.toFixed(6), mean: +stats.mean.toFixed(6) },
  bytes: html.length,
}, null, 2))
