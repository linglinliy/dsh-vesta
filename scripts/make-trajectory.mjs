#!/usr/bin/env node
/**
 * make-trajectory —— XDATCAR → 离子轨迹播放器（单文件 HTML，可拖拽旋转、滑块/播放逐帧）。
 *
 *   node scripts/make-trajectory.mjs <XDATCAR> [--out traj.html] [--oszicar OSZICAR]
 *
 * 给了 --oszicar 时，把离子步能量显示在曲线上，播放时同步高亮当前帧。
 * 渲染用 Canvas 2D：正交投影 + 按深度排序 + 距离判键（每帧重算），足够看轨迹趋势。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parseXdatcar, parseOszicar } from '../core.js'
import { installFriendlyErrors } from './_friendly-errors.mjs'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/make-trajectory.mjs <XDATCAR> [--out traj.html] [--oszicar OSZICAR]')
  process.exit(2)
}

const source = resolve(input)
const data = parseXdatcar(readFileSync(source, 'utf8'))
const energies = []
const oszicarPath = flag('oszicar', '')
if (oszicarPath) {
  try {
    const ionic = parseOszicar(readFileSync(resolve(oszicarPath), 'utf8')).ions
    for (const step of ionic) energies.push({ step: step.step, energy: step.energy })
  } catch {
    // 能量读不了就当没有
  }
}

const payload = {
  comment: data.comment,
  cell: data.cell,
  symbols: data.symbols,
  counts: data.counts,
  frames: data.frames.map((frame) => frame.frac),
  frameIndex: data.frames.map((frame) => frame.index),
  energies,
}
const json = JSON.stringify(payload)
const title = `${basename(dirname(source))} · 轨迹（${data.frames.length} 帧）`

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
  #stage { display: block; width: 100vw; height: 100vh; cursor: grab; }
  .bar { position: fixed; left: 14px; top: 14px; right: 14px; display: flex; gap: 8px;
    align-items: center; flex-wrap: wrap; pointer-events: none; }
  .bar > * { pointer-events: auto; }
  .title { font-weight: 600; font-size: 14px; background: rgba(255,255,255,.92);
    padding: 6px 10px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .hint { font-size: 12px; color: #5b6472; background: rgba(255,255,255,.92); padding: 6px 10px; border-radius: 8px; }
  .spacer { flex: 1; }
  .dock { position: fixed; left: 14px; right: 14px; bottom: 14px; display: flex; gap: 10px;
    align-items: center; background: rgba(255,255,255,.94); padding: 10px 14px; border-radius: 12px;
    box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  input[type=range] { flex: 1; }
  button { font: inherit; border: 1px solid #ccd3dc; background: #fff; color: #2a2f36;
    padding: 5px 12px; border-radius: 8px; cursor: pointer; }
  button:hover { background: #f0f4f9; }
  .frame { font-variant-numeric: tabular-nums; min-width: 96px; text-align: right; color: #33465c; }
</style>
<canvas id="stage"></canvas>
<div class="bar">
  <div class="title">${title}</div>
  <div class="hint">拖拽旋转 · 滚轮缩放 · 空格播放/暂停</div>
</div>
<div class="dock">
  <button id="play">▶ 播放</button>
  <input id="slider" type="range" min="0" max="${data.frames.length - 1}" value="0" step="1">
  <span class="frame" id="label">帧 1 / ${data.frames.length}</span>
</div>
<script>
const DATA = ${json};
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const slider = document.getElementById('slider');
const label = document.getElementById('label');

const RADII = { H: 0.31, C: 0.76, N: 0.71, O: 0.66, Si: 1.11, Na: 1.66, Mg: 1.41, Al: 1.21, P: 1.07, S: 1.05, Cl: 1.02, Fe: 1.32, Cu: 1.32, Zn: 1.22, Ge: 1.20, Ga: 1.22, As: 1.19, Se: 1.20, Br: 1.20, I: 1.39 };
const COLORS = { H: '#e8e8e8', C: '#6e7377', N: '#3050f8', O: '#ff2d2d', Si: '#f0c8a0', Na: '#ab5cf2', Mg: '#8aff00', Al: '#bfa6a6', P: '#ff8000', S: '#ffff30', Cl: '#1ff01f', Fe: '#e06633', Cu: '#c88033', Zn: '#7d80b0', Ge: '#668f8f', Ga: '#c28f8f', As: '#bd80e3', Se: '#ffa100', Br: '#a62929', I: '#940094' };
const radiusOf = (symbol) => RADII[symbol] ?? 0.85;
const colorOf = (symbol) => COLORS[symbol] ?? '#9aa2ac';

const symbols = [];
DATA.symbols.forEach((symbol, index) => {
  for (let i = 0; i < DATA.counts[index]; i += 1) symbols.push(symbol);
});

const state = { frame: 0, rotX: -0.32, rotY: 0.62, zoom: 1, dpr: 1, width: 0, height: 0, playing: false };
let dragging = null;

const cell = DATA.cell;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function cart(frac) {
  return [0, 1, 2].map((axis) => frac[0] * cell[0][axis] + frac[1] * cell[1][axis] + frac[2] * cell[2][axis]);
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const len = (v) => Math.hypot(v[0], v[1], v[2]);

const ALL_CART = DATA.frames.flatMap((frame) => frame.map(cart));
const BMIN = [0, 1, 2].map((axis) => Math.min(...ALL_CART.map((p) => p[axis])));
const BMAX = [0, 1, 2].map((axis) => Math.max(...ALL_CART.map((p) => p[axis])));
const CENTER = [0, 1, 2].map((axis) => (BMIN[axis] + BMAX[axis]) / 2);
const EXTENT = Math.max(BMAX[0] - BMIN[0], BMAX[1] - BMIN[1], BMAX[2] - BMIN[2], 0.6);

function project(point) {
  const cy = Math.cos(state.rotY), sy = Math.sin(state.rotY);
  const cx = Math.cos(state.rotX), sx = Math.sin(state.rotX);
  const px = point[0] - CENTER[0];
  const py = point[1] - CENTER[1];
  const pz = point[2] - CENTER[2];
  let x = px * cy - pz * sy;
  let z = px * sy + pz * cy;
  const y = py * cx - z * sx;
  z = py * sx + z * cx;
  // 视野：至少覆盖 4 Å（小分子不要糊满屏），再按原子跨度放大
  const span = Math.max(EXTENT * 1.4, 4);
  const k = (Math.min(state.width, state.height) * 0.62 * state.zoom) / span;
  return { x: state.width / 2 + x * k, y: state.height / 2 - y * k, z, k };
}

function draw() {
  const W = state.width, H = state.height;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.fillStyle = '#f7f8fa';
  ctx.fillRect(0, 0, W, H);

  const frac = DATA.frames[state.frame];
  const positions = frac.map(cart);
  const proj = positions.map(project);

  // 晶胞棱（12 条）
  const corners = [];
  for (let i = 0; i <= 1; i += 1) for (let j = 0; j <= 1; j += 1) for (let k = 0; k <= 1; k += 1) {
    corners.push([i * cell[0][0] + j * cell[1][0] + k * cell[2][0],
                  i * cell[0][1] + j * cell[1][1] + k * cell[2][1],
                  i * cell[0][2] + j * cell[1][2] + k * cell[2][2]]);
  }
  const edges = [[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
  ctx.strokeStyle = 'rgba(140,150,165,.55)';
  ctx.lineWidth = 1;
  for (const [a, b] of edges) {
    const pa = project(corners[a]), pb = project(corners[b]);
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  }

  // 键：距离 < 1.25×(r_i+r_j) 且不超过 2.6 Å
  ctx.strokeStyle = 'rgba(90,100,115,.45)';
  ctx.lineWidth = 1.6;
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      const d = dist(positions[i], positions[j]);
      const cutoff = Math.min(2.6, 1.25 * (radiusOf(symbols[i]) + radiusOf(symbols[j])));
      if (d > cutoff) continue;
      ctx.beginPath(); ctx.moveTo(proj[i].x, proj[i].y); ctx.lineTo(proj[j].x, proj[j].y); ctx.stroke();
    }
  }

  // 原子：按深度排序后画
  const order = proj.map((p, index) => index).sort((a, b) => proj[a].z - proj[b].z);
  for (const index of order) {
    const p = proj[index];
    // 屏幕上限制原子半径，避免近距离时糊成一片
    const radius = Math.min(26, Math.max(3, radiusOf(symbols[index]) * p.k * 0.42));
    const gradient = ctx.createRadialGradient(p.x - radius * 0.3, p.y - radius * 0.3, radius * 0.2, p.x, p.y, radius);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.35, colorOf(symbols[index]));
    gradient.addColorStop(1, '#2a2f36');
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,45,52,.35)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // 能量曲线（有 OSZICAR 时）
  if (DATA.energies.length > 1) {
    const box = { left: 20, right: 220, top: H - 190, bottom: H - 70 };
    const values = DATA.energies.map((item) => item.energy);
    const min = Math.min(...values), max = Math.max(...values);
    ctx.strokeStyle = 'rgba(120,130,145,.35)';
    ctx.strokeRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
    ctx.beginPath();
    DATA.energies.forEach((item, index) => {
      const x = box.left + ((box.right - box.left) * index) / Math.max(1, DATA.energies.length - 1);
      const y = box.bottom - ((item.energy - min) / Math.max(1e-9, max - min)) * (box.bottom - box.top);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#2f6feb';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    const index = Math.min(state.frame, DATA.energies.length - 1);
    const x = box.left + ((box.right - box.left) * index) / Math.max(1, DATA.energies.length - 1);
    ctx.strokeStyle = 'rgba(217,59,59,.9)';
    ctx.beginPath(); ctx.moveTo(x, box.top); ctx.lineTo(x, box.bottom); ctx.stroke();
    ctx.fillStyle = '#5b6472';
    ctx.font = '11px sans-serif';
    ctx.fillText('E (eV) vs 离子步', box.left + 2, box.top - 6);
  }
}

function setFrame(index) {
  state.frame = Math.max(0, Math.min(DATA.frames.length - 1, index));
  slider.value = String(state.frame);
  label.textContent = '帧 ' + (state.frame + 1) + ' / ' + DATA.frames.length;
  draw();
}

slider.addEventListener('input', () => setFrame(Number(slider.value)));

const playButton = document.getElementById('play');
let timer = null;
function togglePlay() {
  state.playing = !state.playing;
  playButton.textContent = state.playing ? '⏸ 暂停' : '▶ 播放';
  if (state.playing) {
    timer = setInterval(() => {
      if (state.frame >= DATA.frames.length - 1) setFrame(0);
      else setFrame(state.frame + 1);
    }, 120);
  } else if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
playButton.addEventListener('click', togglePlay);
window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
  if (event.code === 'ArrowRight') setFrame(state.frame + 1);
  if (event.code === 'ArrowLeft') setFrame(state.frame - 1);
});

canvas.addEventListener('pointerdown', (event) => {
  dragging = { x: event.clientX, y: event.clientY, rotX: state.rotX, rotY: state.rotY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  state.rotY = dragging.rotY + (event.clientX - dragging.x) * 0.008;
  state.rotX = dragging.rotX - (event.clientY - dragging.y) * 0.008;
  draw();
});
canvas.addEventListener('pointerup', () => { dragging = null });
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  state.zoom *= Math.exp(-event.deltaY * 0.0012);
  draw();
}, { passive: false });

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

const params = new URLSearchParams(location.search);
if (params.has('frame')) setFrame(Number(params.get('frame')) - 1);
else setFrame(0);
</script>
</html>
`

const out = resolve(flag('out', join(dirname(source), `${basename(source)}-traj.html`)))
writeFileSync(out, html, 'utf8')
console.log(JSON.stringify({
  out,
  frames: data.frames.length,
  atoms: data.frames[0].frac.length,
  symbols: data.symbols,
  energies: energies.length,
  bytes: html.length,
}, null, 2))
