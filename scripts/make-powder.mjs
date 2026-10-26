#!/usr/bin/env node
/**
 * make-powder —— 由结构算 X 射线粉末衍射图谱，输出单文件 HTML（棒图 + 可选展宽）。
 *
 *   node scripts/make-powder.mjs <结构文件> [--lambda 1.5406] [--two-theta-max 90] [--fwhm 0.15] [--out powder.html]
 *
 * 峰值来自 powderPattern()；FWHM > 0 时用高斯展宽画成连续曲线。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { parsePoscar, potcarElements, powderPattern } from '../core.js'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/make-powder.mjs <结构文件> [--lambda 1.5406] [--two-theta-max 90] [--fwhm 0.15] [--out powder.html]')
  process.exit(2)
}

const source = resolve(input)
const potcarPath = join(dirname(source), 'POTCAR')
const symbols = existsSync(potcarPath) ? potcarElements(readFileSync(potcarPath, 'utf8')) : undefined
const structure = parsePoscar(readFileSync(source, 'utf8'), basename(source), { symbols })
const lambda = Number(flag('lambda', '1.5406'))
const twoThetaMax = Number(flag('two-theta-max', '90'))
const fwhm = Number(flag('fwhm', '0.15'))
const result = powderPattern(structure, { lambda, twoThetaMax })

const payload = {
  lambda,
  fwhm,
  peaks: result.peaks.map((peak) => ({
    twoTheta: peak.twoTheta,
    d: peak.d,
    intensity: peak.intensity,
    hkl: peak.hkls[0] ? peak.hkls[0].join(' ') : '',
  })),
  title: `${basename(dirname(source))} · 粉末衍射`,
}
const json = JSON.stringify(payload)
const title = payload.title

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
  #plot { display: block; width: 100vw; height: 100vh; cursor: crosshair; }
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
  #readout { position: fixed; right: 14px; bottom: 14px; font-size: 12px; color: #3a4150;
    background: rgba(255,255,255,.92); padding: 6px 10px; border-radius: 8px; min-width: 220px; }
</style>
<canvas id="plot"></canvas>
<div class="bar">
  <div class="title">${title}</div>
  <div class="sub">λ = ${lambda} Å　${result.peaks.length} 个峰　FWHM ${fwhm}°　hkl 按原胞基矢</div>
  <div class="spacer"></div>
  <button id="b-save">存 PNG</button>
</div>
<div id="readout">悬停查看峰位</div>
<script>
const DATA = ${json};
const canvas = document.getElementById('plot');
const ctx = canvas.getContext('2d');
const state = { width: 0, height: 0, dpr: 1, hover: null };

const xMin = 5;
const xMax = ${twoThetaMax};
const peaks = DATA.peaks;

function profile(x) {
  // 高斯展宽：FWHM → σ
  const sigma = DATA.fwhm / 2.3548;
  let value = 0;
  for (const peak of peaks) {
    const dx = (x - peak.twoTheta) / Math.max(sigma, 1e-6);
    value += peak.intensity * Math.exp(-0.5 * dx * dx);
  }
  return value;
}

function draw() {
  const W = state.width, H = state.height;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.fillStyle = '#f7f8fa';
  ctx.fillRect(0, 0, W, H);
  const left = 70, right = W - 28, top = 70, bottom = H - 60;
  ctx.strokeStyle = '#c7ced8';
  ctx.strokeRect(left, top, right - left, bottom - top);

  const xOf = (angle) => left + ((angle - xMin) / (xMax - xMin)) * (right - left);
  const yOf = (value) => bottom - (value / 105) * (bottom - top);

  // 网格与 2θ 刻度
  for (let angle = Math.ceil(xMin / 10) * 10; angle <= xMax; angle += 10) {
    const x = xOf(angle);
    ctx.strokeStyle = '#e8ecf2';
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.fillStyle = '#7b8494'; ctx.font = '11px sans-serif';
    ctx.fillText(angle + '°', x - 8, bottom + 16);
  }
  for (let value = 0; value <= 100; value += 25) {
    const y = yOf(value);
    ctx.strokeStyle = '#eef1f6';
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.fillStyle = '#7b8494'; ctx.font = '11px sans-serif';
    ctx.fillText(String(value), 40, y + 4);
  }
  ctx.fillStyle = '#5b6472'; ctx.font = '12px sans-serif';
  ctx.fillText('2θ (°)', (left + right) / 2 - 16, bottom + 36);
  ctx.fillText('强度 (%)', 14, top - 8);

  // 曲线（高斯展宽）
  if (DATA.fwhm > 0) {
    ctx.beginPath();
    let started = false;
    for (let x = left; x <= right; x += 1) {
      const angle = xMin + ((x - left) / (right - left)) * (xMax - xMin);
      const y = yOf(profile(angle));
      if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#2f6feb';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  // 棒图与峰标
  const labelled = peaks.filter((peak) => peak.intensity >= 5)
    .sort((a, b) => b.intensity - a.intensity).slice(0, 10);
  for (const peak of peaks) {
    const x = xOf(peak.twoTheta);
    const y = yOf(peak.intensity);
    ctx.strokeStyle = 'rgba(47,111,235,.55)';
    ctx.beginPath(); ctx.moveTo(x, bottom); ctx.lineTo(x, y); ctx.stroke();
    if (labelled.includes(peak)) {
      ctx.fillStyle = '#33465c';
      ctx.font = '11px sans-serif';
      ctx.fillText(peak.hkl, Math.max(left + 4, Math.min(right - 30, x - 10)), Math.max(top + 14, y - 6));
    }
  }

  if (state.hover !== null) {
    const x = xOf(state.hover);
    ctx.strokeStyle = 'rgba(42,47,54,.5)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.setLineDash([]);
  }
}

canvas.addEventListener('pointermove', (event) => {
  const left = 70, right = state.width - 28;
  const angle = xMin + ((event.clientX - left) / Math.max(1, right - left)) * (xMax - xMin);
  state.hover = angle;
  let best = null;
  for (const peak of peaks) {
    if (!best || Math.abs(peak.twoTheta - angle) < Math.abs(best.twoTheta - angle)) best = peak;
  }
  document.getElementById('readout').textContent = '2θ = ' + angle.toFixed(2) + '°　最近峰 '
    + (best ? best.hkl + ' @ ' + best.twoTheta.toFixed(2) + '°（d=' + best.d.toFixed(3) + ' Å, I=' + best.intensity.toFixed(0) + '%）' : '—');
  draw();
});
canvas.addEventListener('pointerleave', () => { state.hover = null; draw(); });

document.getElementById('b-save').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'powder.png';
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

const out = resolve(flag('out', join(dirname(source), `${basename(source)}-powder.html`)))
writeFileSync(out, html, 'utf8')
console.log(JSON.stringify({
  out,
  lambda,
  peaks: result.peaks.length,
  strongest: result.strongest ? {
    twoTheta: +result.strongest.twoTheta.toFixed(3),
    d: +result.strongest.d.toFixed(4),
    intensity: +result.strongest.intensity.toFixed(1),
  } : null,
  bytes: html.length,
}, null, 2))
