#!/usr/bin/env node
/**
 * make-conv —— OSZICAR → 收敛曲线（能量 + |ΔE| 双面板，单文件 HTML）。
 *
 *   node scripts/make-conv.mjs <OSZICAR> [--out conv.html] [--ediff 1e-6]
 *
 * 上图：电子步能量（看是否走到平台）；
 * 下图：|ΔE| 的 log10（看是否穿过 EDIFF）；EDIFF 优先从同目录 INCAR 读，也可用 --ediff 指定。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { readOszicarFile } from '../core.js'
import { installFriendlyErrors } from './_friendly-errors.mjs'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/make-conv.mjs <OSZICAR> [--out conv.html] [--ediff 1e-6]')
  process.exit(2)
}

const source = resolve(input)
const data = readOszicarFile(source)

// EDIFF：优先命令行，其次同目录 INCAR
let ediff = Number(flag('ediff', 'NaN'))
if (!Number.isFinite(ediff)) {
  const incar = join(dirname(source), 'INCAR')
  if (existsSync(incar)) {
    const match = /EDIFF\s*=\s*([\d.eE+-]+)/.exec(readFileSync(incar, 'utf8'))
    if (match) ediff = Number(match[1])
  }
}
if (!Number.isFinite(ediff)) ediff = 0

const payload = {
  steps: data.steps,
  ions: data.ions,
  ediff,
  title: `${basename(dirname(source))} · 收敛`,
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
  .title { font-weight: 600; font-size: 14px; background: rgba(255,255,255,.9);
    padding: 6px 10px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .sub { font-size: 12px; color: #5b6472; background: rgba(255,255,255,.9);
    padding: 6px 10px; border-radius: 8px; }
  .spacer { flex: 1; }
  button { font: inherit; border: 1px solid #ccd3dc; background: #fff; color: #2a2f36;
    padding: 6px 10px; border-radius: 8px; cursor: pointer; }
  button:hover { background: #f0f4f9; }
  #readout { position: fixed; right: 14px; bottom: 14px; font-size: 12px; color: #3a4150;
    background: rgba(255,255,255,.9); padding: 6px 10px; border-radius: 8px; min-width: 220px; }
</style>
<canvas id="plot"></canvas>
<div class="bar">
  <div class="title">${title}</div>
  <div class="sub">电子步 ${data.steps.length}　离子步 ${data.ions.length}${ediff > 0 ? `　EDIFF = ${ediff}` : ''}</div>
  <div class="spacer"></div>
  <button id="b-save">存 PNG</button>
</div>
<div id="readout">悬停查看每一步</div>
<script>
const DATA = ${json};
const canvas = document.getElementById('plot');
const ctx = canvas.getContext('2d');
const state = { width: 0, height: 0, dpr: 1 };
let hover = -1;

const steps = DATA.steps;
const margins = { left: 78, right: 28, top: 64, bottom: 46, gap: 38 };

function panels() {
  const usable = state.height - margins.top - margins.bottom - margins.gap;
  const each = usable / 2;
  return {
    energy: { left: margins.left, right: state.width - margins.right, top: margins.top, bottom: margins.top + each },
    delta: { left: margins.left, right: state.width - margins.right, top: margins.top + each + margins.gap, bottom: margins.top + each + margins.gap + each },
  };
}

const energyValues = steps.map((s) => s.energy);
const eMin = Math.min(...energyValues);
const eMax = Math.max(...energyValues);
const pad = Math.max((eMax - eMin) * 0.12, 1e-3);
// 1-2-5 步长：让能量轴刻度是整齐的数（而不是 eLo + span/4 这种）
const niceStep = (value) => {
  const pow = 10 ** Math.floor(Math.log10(Math.max(value, 1e-9)));
  const mant = value / pow;
  const pick = mant <= 1 ? 1 : mant <= 2 ? 2 : mant <= 5 ? 5 : 10;
  return pick * pow;
};
const eStep = niceStep(((eMax + pad * 0.6) - (eMin - pad)) / 4);
const eLo = Math.floor((eMin - pad) / eStep) * eStep;
const eHi = eLo + 4 * eStep;

const deltas = steps.map((s) => Math.abs(s.dE) || 1e-12);
const dMaxExp = Math.ceil(Math.log10(Math.max(...deltas)));
const dMinExp = Math.floor(Math.log10(Math.min(Math.min(...deltas), DATA.ediff > 0 ? DATA.ediff : 1e-12)));
const expLo = Math.max(dMinExp - 0.5, -16);
const expHi = Math.max(dMaxExp + 0.5, expLo + 1);

const xOf = (i) => {
  const { left, right } = panels().energy;
  const n = Math.max(steps.length - 1, 1);
  return left + (i / n) * (right - left);
};
const yEnergy = (value) => {
  const p = panels().energy;
  return p.bottom - ((value - eLo) / (eHi - eLo)) * (p.bottom - p.top);
};
const yDelta = (value) => {
  const p = panels().delta;
  const exp = Math.log10(Math.max(value, 10 ** expLo));
  return p.bottom - ((exp - expLo) / (expHi - expLo)) * (p.bottom - p.top);
};

function draw() {
  const W = state.width;
  const H = state.height;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.fillStyle = '#f7f8fa';
  ctx.fillRect(0, 0, W, H);
  const p = panels();

  const axis = (rect) => {
    ctx.strokeStyle = '#c7ced8';
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
    for (let i = 0; i <= 4; i += 1) {
      const y = rect.top + ((rect.bottom - rect.top) * i) / 4;
      ctx.strokeStyle = '#e8ecf2';
      ctx.beginPath(); ctx.moveTo(rect.left, y); ctx.lineTo(rect.right, y); ctx.stroke();
    }
    const count = Math.max(steps.length - 1, 1);
    for (let i = 0; i <= count; i += Math.ceil(count / 8)) {
      const x = xOf(i);
      ctx.strokeStyle = '#eef1f6';
      ctx.beginPath(); ctx.moveTo(x, rect.top); ctx.lineTo(x, rect.bottom); ctx.stroke();
      ctx.fillStyle = '#7b8494';
      ctx.font = '11px sans-serif';
      ctx.fillText(String(i + 1), x - 6, rect.bottom + 15);
    }
  };
  axis(p.energy);
  axis(p.delta);

  ctx.fillStyle = '#5b6472';
  ctx.font = '12px sans-serif';
  ctx.fillText('E (eV)', p.energy.left, p.energy.top - 8);
  ctx.fillText('|ΔE| (eV, log)', p.delta.left, p.delta.top - 8);
  ctx.fillText('电子步', (p.delta.left + p.delta.right) / 2 - 16, p.delta.bottom + 34);

  // 能量刻度
  for (let i = 0; i <= 4; i += 1) {
    const value = eLo + eStep * (4 - i);
    ctx.fillStyle = '#7b8494';
    ctx.font = '11px sans-serif';
    ctx.fillText(value.toFixed(2), 14, p.energy.top + ((p.energy.bottom - p.energy.top) * i) / 4 + 4);
  }
  // ΔE 刻度（指数）
  const expStep = Math.max(1, Math.round((expHi - expLo) / 5));
  for (let exp = Math.ceil(expLo); exp <= expHi; exp += expStep) {
    const y = p.delta.bottom - ((exp - expLo) / (expHi - expLo)) * (p.delta.bottom - p.delta.top);
    ctx.fillStyle = '#7b8494';
    ctx.fillText('1e' + exp, 22, y + 4);
  }

  // 能量曲线
  ctx.beginPath();
  steps.forEach((s, i) => {
    const x = xOf(i);
    const y = yEnergy(s.energy);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#2f6feb';
  ctx.lineWidth = 1.8;
  ctx.stroke();
  steps.forEach((s, i) => {
    ctx.beginPath();
    ctx.arc(xOf(i), yEnergy(s.energy), 2.2, 0, Math.PI * 2);
    ctx.fillStyle = '#2f6feb';
    ctx.fill();
  });

  // ΔE 曲线（对数）
  ctx.beginPath();
  steps.forEach((s, i) => {
    const x = xOf(i);
    const y = yDelta(Math.abs(s.dE) || 1e-12);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#d93b3b';
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // EDIFF 参考线
  if (DATA.ediff > 0) {
    const y = yDelta(DATA.ediff);
    ctx.strokeStyle = 'rgba(214,158,46,.95)';
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(p.delta.left, y); ctx.lineTo(p.delta.right, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#8a6a1f';
    ctx.fillText('EDIFF = ' + DATA.ediff.toExponential(0), p.delta.right - 110, y - 6);
  }

  if (hover >= 0) {
    const x = xOf(hover);
    ctx.strokeStyle = 'rgba(42,47,54,.5)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, p.energy.top); ctx.lineTo(x, p.delta.bottom); ctx.stroke();
    ctx.setLineDash([]);
  }
}

canvas.addEventListener('pointermove', (event) => {
  const p = panels();
  const ratio = (event.clientX - p.energy.left) / Math.max(1, p.energy.right - p.energy.left);
  hover = Math.max(0, Math.min(steps.length - 1, Math.round(ratio * (steps.length - 1))));
  const s = steps[hover];
  document.getElementById('readout').textContent =
    '第 ' + s.iter + ' 步　E = ' + s.energy.toFixed(6) + ' eV　ΔE = ' + s.dE.toExponential(2);
  draw();
});
canvas.addEventListener('pointerleave', () => { hover = -1; draw(); });

document.getElementById('b-save').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'convergence.png';
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

const out = resolve(flag('out', join(dirname(source), `${basename(source)}-conv.html`)))
writeFileSync(out, html, 'utf8')
console.log(JSON.stringify({
  out,
  steps: data.steps.length,
  ions: data.ions.length,
  ediff,
  firstEnergy: data.steps[0]?.energy ?? null,
  lastEnergy: data.steps[data.steps.length - 1]?.energy ?? null,
  lastDeltaE: data.steps[data.steps.length - 1]?.dE ?? null,
  bytes: html.length,
}, null, 2))
