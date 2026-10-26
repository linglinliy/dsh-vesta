#!/usr/bin/env node
/**
 * make-bands —— EIGENVAL → 自包含能带/本征值图（单文件 HTML）。
 *
 *   node scripts/make-bands.mjs <EIGENVAL> [--out bands.html] [--connect]
 *
 * 说明：MP/IBZ 格点上的 k 点没有高对称路径顺序，默认只画点不连线；若是 line-mode
 * 计算的 EIGENVAL，加 --connect 或页面上点「连线」才按文件顺序连成能带。
 * 纵轴默认以 VBM 为 0，页面上可切到绝对能量。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { readEigenvalFile, bandGap, parsePoscar, bandPathDistances, potcarElements, parseKpoints, kpointsToFractional } from '../core.js'
import { installFriendlyErrors } from './_friendly-errors.mjs'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/make-bands.mjs <EIGENVAL> [--out bands.html] [--connect]')
  process.exit(2)
}

const eigen = readEigenvalFile(resolve(input))
const gap = bandGap(eigen)
const connect = args.includes('--connect')
const distanceMode = args.includes('--distance')
const source = resolve(input)

// --distance：横轴用倒空间路径距离（2π/Å）而不是 k 点序号
let distances = null
let distanceTotal = 0
let labels = []
if (distanceMode) {
  const poscarPath = join(dirname(source), 'POSCAR')
  if (existsSync(poscarPath)) {
    try {
      const symbols = existsSync(join(dirname(source), 'POTCAR'))
        ? potcarElements(readFileSync(join(dirname(source), 'POTCAR'), 'utf8'))
        : undefined
      const structure = parsePoscar(readFileSync(poscarPath, 'utf8'), 'POSCAR', { symbols })
      const path = bandPathDistances(eigen.kpoints, [structure.a1, structure.a2, structure.a3])
      distances = path.distances
      distanceTotal = path.total

      // 高对称点：KPOINTS line-mode 的端点匹配到 EIGENVAL 的 k 点
      const kpointsPath = join(dirname(source), 'KPOINTS')
      if (existsSync(kpointsPath)) {
        try {
          const parsedK = parseKpoints(readFileSync(kpointsPath, 'utf8'))
          if (parsedK.mode === 'line') {
            const fractional = kpointsToFractional(parsedK, structure)
            if (fractional) {
              labels = []
              for (const point of fractional) {
                let bestIndex = -1
                let bestDelta = Infinity
                eigen.kpoints.forEach((kPoint, index) => {
                  const delta = Math.hypot(
                    kPoint.k[0] - point.k[0],
                    kPoint.k[1] - point.k[1],
                    kPoint.k[2] - point.k[2],
                  )
                  if (delta < bestDelta) { bestDelta = delta; bestIndex = index }
                })
                if (bestIndex >= 0 && bestDelta < 1e-3) {
                  const distance = path.distances[bestIndex]
                  const last = labels[labels.length - 1]
                  // 相邻两段共享端点（X 会出现在两段里），同一距离只留一个标签
                  if (!last || Math.abs(last.distance - distance) > 1e-6) {
                    labels.push({ distance, label: point.label || `k${bestIndex + 1}` })
                  }
                }
              }
            }
          }
        } catch {
          labels = []
        }
      }
    } catch {
      distances = null
    }
  }
}
const title = `${basename(dirname(source))} · 能带`

const payload = {
  energies: eigen.energies,
  energiesDown: eigen.energiesDown,
  occupations: eigen.occupations,
  occupationsDown: eigen.occupationsDown,
  spinPolarized: eigen.spinPolarized,
  nkpts: eigen.nkpts,
  nbands: eigen.nbands,
  nelect: eigen.nelect,
  vbm: gap.vbm,
  cbm: gap.cbm,
  gap: gap.gap,
  direct: gap.direct,
  vbmK: gap.vbmK,
  cbmK: gap.cbmK,
  connect,
  distances,
  distanceTotal,
  labels,
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
    padding: 6px 10px; border-radius: 8px; cursor: pointer; }
  button:hover { background: #f0f4f9; }
  button.on { border-color: #2f6feb; color: #2f6feb; background: #eef4ff; }
  #readout { position: fixed; right: 14px; top: 96px; font-size: 12px; color: #3a4150;
    background: rgba(255,255,255,.9); padding: 6px 10px; border-radius: 8px; min-width: 200px; }
</style>
<canvas id="plot"></canvas>
<div class="bar">
  <div class="title">${title}</div>
  <div class="sub">${eigen.nkpts} 个 k 点 · ${eigen.nbands} 条带 · NELECT ${eigen.nelect}　带隙 ${gap.gap.toFixed(3)} eV（${gap.direct ? '直接' : '间接'}）</div>
  <div class="spacer"></div>
  <button id="b-reset">复位</button>
  <button id="b-connect"${connect ? ' class="on"' : ''}>连线</button>
  <button id="b-abs">绝对能量</button>
  <button id="b-save">存 PNG</button>
</div>
<div id="readout">悬停查看 k 点与能级</div>
<script>
const DATA = ${json};
const canvas = document.getElementById('plot');
const ctx = canvas.getContext('2d');
const state = {
  connect: DATA.connect,
  absolutE: false,
  ymin: -2,
  ymax: 4,
  xpad: 0.04,
  dpr: 1,
  width: 0,
  height: 0,
};
let hover = null;

const nk = DATA.nkpts;
const eRef = DATA.vbm;

function valueAt(k, b, spin) {
  if (spin === 'down') return DATA.energiesDown[k][b];
  return DATA.energies[k][b];
}
function occAt(k, b, spin) {
  if (spin === 'down') return DATA.occupationsDown[k][b];
  return DATA.occupations[k][b];
}
function yOf(energy) { return state.absolutE ? energy : energy - eRef; }

function plotRect() {
  return { left: 70, right: state.width - 24, top: 64, bottom: state.height - 56 };
}
const USE_DISTANCE = Array.isArray(DATA.distances) && DATA.distances.length === nk && DATA.distanceTotal > 0;
function xOf(k) {
  const { left, right } = plotRect();
  if (USE_DISTANCE) return left + (DATA.distances[k] / DATA.distanceTotal) * (right - left);
  return left + ((k + 0.5) / nk) * (right - left);
}
function yOfValue(value) {
  const { top, bottom } = plotRect();
  return bottom - ((value - state.ymin) / Math.max(1e-9, state.ymax - state.ymin)) * (bottom - top);
}

function draw() {
  const { left, right, top, bottom } = plotRect();
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.fillStyle = '#f7f8fa';
  ctx.fillRect(0, 0, state.width, state.height);
  ctx.strokeStyle = '#c7ced8';
  ctx.strokeRect(left, top, right - left, bottom - top);

  // 带隙阴影（相对模式）
  if (!state.absolutE && DATA.gap > 0) {
    const yVbm = yOfValue(0);
    const yCbm = yOfValue(DATA.gap);
    ctx.fillStyle = 'rgba(240,196,90,0.16)';
    ctx.fillRect(left, Math.min(yVbm, yCbm), right - left, Math.abs(yCbm - yVbm));
    ctx.strokeStyle = 'rgba(214,158,46,0.9)';
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(left, yVbm); ctx.lineTo(right, yVbm); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(left, yCbm); ctx.lineTo(right, yCbm); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#8a6a1f';
    ctx.font = '12px sans-serif';
    ctx.fillText('E_g = ' + DATA.gap.toFixed(3) + ' eV', right - 120, (yVbm + yCbm) / 2 + 4);
  }

  // y 轴网格
  const ticks = 6;
  for (let i = 0; i <= ticks; i += 1) {
    const value = state.ymin + ((state.ymax - state.ymin) * i) / ticks;
    const y = yOfValue(value);
    ctx.strokeStyle = '#e8ecf2';
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.fillStyle = '#7b8494';
    ctx.font = '11px sans-serif';
    ctx.fillText(value.toFixed(2), 26, y + 4);
  }
  ctx.fillStyle = '#5b6472';
  ctx.font = '12px sans-serif';
  ctx.fillText(state.absolutE ? 'E (eV)' : 'E − E_VBM (eV)', left + 6, top + 16);
  // 横轴刻度：距离模式显示 2π/Å，否则显示 k 点序号
  for (let i = 0; i <= 4; i += 1) {
    const t = i / 4;
    const x = left + t * (right - left);
    const value = USE_DISTANCE ? t * DATA.distanceTotal : Math.round(1 + t * (nk - 1));
    ctx.fillStyle = '#7b8494';
    ctx.font = '11px sans-serif';
    ctx.fillText(value.toFixed(USE_DISTANCE ? 1 : 0), x - 8, bottom + 15);
  }
  ctx.fillText(USE_DISTANCE ? 'k 路径距离 (2π/Å)' : 'k 点序号（文件顺序，非高对称路径）', (left + right) / 2 - 60, bottom + 34);

  // 能级
  const drawBand = (spin, colorPath, colorPoint) => {
    for (let b = 0; b < DATA.nbands; b += 1) {
      if (state.connect) {
        ctx.beginPath();
        for (let k = 0; k < nk; k += 1) {
          const x = xOf(k);
          const y = yOfValue(yOf(valueAt(k, b, spin)));
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = colorPath;
        ctx.lineWidth = 1.1;
        ctx.stroke();
      } else {
        for (let k = 0; k < nk; k += 1) {
          const value = yOf(valueAt(k, b, spin));
          if (value < state.ymin || value > state.ymax) continue;
          const occupied = occAt(k, b, spin) > 0.5;
          ctx.beginPath();
          ctx.arc(xOf(k), yOfValue(value), 2.1, 0, Math.PI * 2);
          ctx.fillStyle = occupied ? colorPoint : 'rgba(200,120,40,0.75)';
          ctx.fill();
        }
      }
    }
  };
  drawBand('up', 'rgba(47,111,235,0.55)', '#2f6feb');
  if (DATA.spinPolarized) drawBand('down', 'rgba(217,59,59,0.45)', '#d93b3b');

  // VBM/CBM 标记
  if (!state.absolutE) {
    ctx.fillStyle = '#8a6a1f';
    ctx.beginPath(); ctx.arc(xOf(DATA.cbmK), yOfValue(DATA.gap), 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2f6feb';
    ctx.beginPath(); ctx.arc(xOf(DATA.vbmK), yOfValue(0), 4, 0, Math.PI * 2); ctx.fill();
  }

  // 高对称点刻度（有 KPOINTS line-mode 时）
  if (Array.isArray(DATA.labels) && DATA.labels.length > 0 && USE_DISTANCE) {
    for (const point of DATA.labels) {
      const x = left + (point.distance / DATA.distanceTotal) * (right - left);
      ctx.strokeStyle = 'rgba(120,130,145,.45)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.setLineDash([]);
      const pretty = point.label
        .replace(/^Gamma$/i, 'Γ')
        .replace(/^Sigma$/i, 'Σ')
        .replace(/^Delta$/i, 'Δ')
        .replace(/^Lambda$/i, 'Λ')
      ctx.fillStyle = '#33465c';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pretty, Math.max(left + 12, Math.min(right - 12, x)), top + 30);
      ctx.textAlign = 'left';
    }
  }

  if (hover) {
    const x = xOf(hover.k);
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
  if (state.absolutE) {
    // 绝对能量：全范围
    const values = [];
    for (let k = 0; k < nk; k += 1) {
      for (let b = 0; b < DATA.nbands; b += 1) {
        values.push(DATA.energies[k][b]);
        if (DATA.spinPolarized) values.push(DATA.energiesDown[k][b]);
      }
    }
    state.ymin = Math.min(...values) - 0.3;
    state.ymax = Math.max(...values) + 0.3;
  } else {
    // 相对能量：以带隙为中心，默认只看 ±2.5 eV，带隙才不会被压成一条线
    state.ymin = -2.5;
    state.ymax = Math.max(2.5, DATA.gap + 1.5);
  }
  draw();
}

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const factor = Math.exp(event.deltaY * 0.0012);
  const anchor = yOfValue(0);
  const ratio = (event.clientY - plotRect().top) / Math.max(1, plotRect().bottom - plotRect().top);
  const v = state.ymax - (state.ymax - state.ymin) * ratio;
  state.ymin = v + (state.ymin - v) * factor;
  state.ymax = v + (state.ymax - v) * factor;
  void anchor;
  draw();
}, { passive: false });

let drag = null;
canvas.addEventListener('pointerdown', (event) => {
  drag = { y: event.clientY, ymin: state.ymin, ymax: state.ymax };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  const { left, right, top, bottom } = plotRect();
  const k = Math.max(0, Math.min(nk - 1, Math.round(((event.clientX - left) / (right - left)) * nk - 0.5)));
  const value = state.ymax - ((event.clientY - top) / (bottom - top)) * (state.ymax - state.ymin);
  hover = { k };
  let best = null;
  for (let b = 0; b < DATA.nbands; b += 1) {
    const bandValue = yOf(DATA.energies[k][b]);
    if (!best || Math.abs(bandValue - value) < Math.abs(best.e - value)) best = { band: b + 1, e: bandValue, occ: DATA.occupations[k][b] };
  }
  const el = document.getElementById('readout');
  el.textContent = 'k #' + k + '　能带 ' + (best ? best.band : '-') + '　E = '
    + (best ? best.e.toFixed(3) : '-') + ' eV　占据 ' + (best ? best.occ.toFixed(2) : '-');
  if (drag) {
    const span = drag.ymax - drag.ymin;
    const shift = ((event.clientY - drag.y) / Math.max(1, bottom - top)) * span;
    state.ymin = drag.ymin + shift;
    state.ymax = drag.ymax + shift;
  }
  draw();
});
canvas.addEventListener('pointerup', () => { drag = null });
canvas.addEventListener('dblclick', reset);

document.getElementById('b-reset').addEventListener('click', reset);
document.getElementById('b-connect').addEventListener('click', (event) => {
  state.connect = !state.connect;
  event.currentTarget.classList.toggle('on', state.connect);
  draw();
});
document.getElementById('b-abs').addEventListener('click', (event) => {
  state.absolutE = !state.absolutE;
  event.currentTarget.classList.toggle('on', state.absolutE);
  reset();
});
document.getElementById('b-save').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'bands.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
});
window.addEventListener('resize', resize);

const params = new URLSearchParams(location.search);
if (params.get('connect') === '1') state.connect = true;
if (params.get('abs') === '1') state.absolutE = true;
resize();
reset();
</script>
</html>
`

const out = resolve(flag('out', join(dirname(input), `${basename(input)}-bands.html`)))
writeFileSync(out, html, 'utf8')
console.log(JSON.stringify({
  out,
  nkpts: eigen.nkpts,
  nbands: eigen.nbands,
  spinPolarized: eigen.spinPolarized,
  vbm: +gap.vbm.toFixed(3),
  cbm: +gap.cbm.toFixed(3),
  gap: +gap.gap.toFixed(3),
  direct: gap.direct,
  labels: labels.map((item) => `${item.label}@${item.distance.toFixed(3)}`),
  bytes: html.length,
}, null, 2))
