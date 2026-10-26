#!/usr/bin/env node
/**
 * make-pdos —— DOSCAR 的投影态密度（LORBIT ≥ 11）画成单文件 HTML。
 *
 *   node scripts/make-pdos.mjs <DOSCAR> [--out pdos.html] [--window 8]
 *
 * 按元素聚合，s/p/d(/f) 各一条曲线；ISPIN=2 时向上为自旋向上、向下为自旋向下（镜像）。
 * 元素归属靠同目录 POSCAR（VASP4 写法用 POTCAR 补）；读不到就按原子序号画。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { parseDoscarPdos, parsePoscar, potcarElements } from '../core.js'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/make-pdos.mjs <DOSCAR> [--out pdos.html] [--window 8]')
  process.exit(2)
}

const source = resolve(input)
const pdos = parseDoscarPdos(readFileSync(source, 'utf8'))
if (pdos.atoms.length === 0) {
  console.error('DOSCAR 里没有 PDOS 块（通常需要 LORBIT = 11 或 12 重算）')
  process.exit(2)
}

// 元素归属
let symbols = []
if (existsSync(join(dirname(source), 'POSCAR'))) {
  try {
    const potcarSymbols = existsSync(join(dirname(source), 'POTCAR'))
      ? potcarElements(readFileSync(join(dirname(source), 'POTCAR'), 'utf8'))
      : undefined
    const structure = parsePoscar(readFileSync(join(dirname(source), 'POSCAR'), 'utf8'), 'POSCAR', { symbols: potcarSymbols })
    symbols = structure.atoms.map((atom) => atom.symbol)
  } catch {
    symbols = []
  }
}

const elementOf = (index) => symbols[index - 1] ?? `#${index}`
const spinPolarized = pdos.atoms.some((atom) => (atom.orbitals.s.down ?? []).some((value) => Math.abs(value) > 1e-9))

// 按元素聚合
const grouped = new Map()
for (const atom of pdos.atoms) {
  const element = elementOf(atom.index)
  const bucket = grouped.get(element) ?? { element, energies: atom.energies, efermi: atom.efermi, orbitals: {} }
  for (const [orbital, channels] of Object.entries(atom.orbitals)) {
    const target = bucket.orbitals[orbital] ?? { up: channels.up.map(() => 0), down: channels.up.map(() => 0) }
    target.up = target.up.map((value, i) => value + (channels.up[i] ?? 0))
    if (spinPolarized) target.down = target.down.map((value, i) => value + (channels.down[i] ?? 0))
    bucket.orbitals[orbital] = target
  }
  grouped.set(element, bucket)
}

const series = [...grouped.values()].map((bucket) => ({
  element: bucket.element,
  efermi: bucket.efermi,
  energies: bucket.energies.map((energy) => energy - bucket.efermi),
  orbitals: Object.entries(bucket.orbitals).map(([orbital, channels]) => ({ orbital, up: channels.up, down: channels.down })),
}))

const payload = { series, spinPolarized, window: Number(flag('window', '8')) }
const json = JSON.stringify(payload)
const title = `${basename(dirname(source))} · PDOS`

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
  .title { font-weight: 600; font-size: 14px; background: rgba(255,255,255,.92);
    padding: 6px 10px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .sub { font-size: 12px; color: #5b6472; background: rgba(255,255,255,.92); padding: 6px 10px; border-radius: 8px; }
  .spacer { flex: 1; }
  button { font: inherit; border: 1px solid #ccd3dc; background: #fff; color: #2a2f36;
    padding: 6px 10px; border-radius: 8px; cursor: pointer; }
  button:hover { background: #f0f4f9; }
  .legend { position: fixed; left: 14px; bottom: 14px; background: rgba(255,255,255,.92);
    padding: 8px 12px; border-radius: 8px; font-size: 12px; line-height: 1.9; }
  .legend i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: 3px; }
  .legend label { display: block; cursor: pointer; }
  .legend input { margin-right: 4px; }
</style>
<canvas id="plot"></canvas>
<div class="bar">
  <div class="title">${title}</div>
  <div class="sub">${series.length} 种元素${spinPolarized ? '　自旋极化（上正下负）' : ''}</div>
  <div class="spacer"></div>
  <button id="b-save">存 PNG</button>
</div>
<div class="legend" id="legend"></div>
<script>
const DATA = ${json};
const canvas = document.getElementById('plot');
const ctx = canvas.getContext('2d');
const state = { width: 0, height: 0, dpr: 1 };

const COLORS = ['#2f6feb', '#d93b3b', '#1f9d55', '#8a4fd3', '#d68a1e', '#0f8d9e'];
const DASHES = { s: [], p: [6, 4], d: [2, 3], f: [8, 3, 2, 3] };
const hidden = new Set();

const flat = [];
DATA.series.forEach((series, sIndex) => {
  series.orbitals.forEach((orbital) => {
    flat.push({
      key: series.element + '-' + orbital.orbital,
      element: series.element,
      orbital: orbital.orbital,
      energies: series.energies,
      up: orbital.up,
      down: orbital.down,
      color: COLORS[sIndex % COLORS.length],
      dash: DASHES[orbital.orbital] ?? [],
    });
  });
});

document.getElementById('legend').innerHTML = flat.map((item) =>
  '<label><input type="checkbox" checked data-key="' + item.key + '">'
  + '<i style="' + (item.dash.length === 0
      ? 'background:' + item.color
      : 'height:0;border-top:2px ' + (item.dash.length === 2 && item.dash[0] === 2 ? 'dotted' : 'dashed') + ' ' + item.color) + '"></i>'
  + item.element + ' ' + item.orbital + '</label>'
).join('');
document.getElementById('legend').addEventListener('change', (event) => {
  const key = event.target.dataset.key;
  if (!key) return;
  if (event.target.checked) hidden.delete(key); else hidden.add(key);
  draw();
});

function visible() {
  return flat.filter((item) => !hidden.has(item.key));
}

function draw() {
  const W = state.width, H = state.height;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.fillStyle = '#f7f8fa';
  ctx.fillRect(0, 0, W, H);
  const left = 78, right = W - 28, top = 64, bottom = H - 90;
  ctx.strokeStyle = '#c7ced8';
  ctx.strokeRect(left, top, right - left, bottom - top);

  const items = visible();
  const eMin = -DATA.window, eMax = DATA.window / 2;
  let yMax = 1e-9;
  for (const item of items) {
    item.energies.forEach((energy, i) => {
      if (energy < eMin || energy > eMax) return;
      yMax = Math.max(yMax, item.up[i] ?? 0, DATA.spinPolarized ? (item.down[i] ?? 0) : 0);
    });
  }
  const xOf = (energy) => left + ((energy - eMin) / (eMax - eMin)) * (right - left);
  const yOf = (value) => {
    if (!DATA.spinPolarized) return bottom - (value / yMax) * (bottom - top);
    const mid = (top + bottom) / 2;
    return mid - (value / yMax) * ((bottom - top) / 2);
  };

  // 网格与刻度
  for (let i = 0; i <= 5; i += 1) {
    const energy = eMin + ((eMax - eMin) * i) / 5;
    const x = xOf(energy);
    ctx.strokeStyle = '#e8ecf2';
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
    ctx.fillStyle = '#7b8494';
    ctx.font = '11px sans-serif';
    ctx.fillText(energy.toFixed(1), x - 9, bottom + 16);
  }
  // 费米能级
  ctx.strokeStyle = '#98a1af';
  ctx.setLineDash([5, 4]);
  ctx.beginPath(); ctx.moveTo(xOf(0), top); ctx.lineTo(xOf(0), bottom); ctx.stroke();
  ctx.setLineDash([]);
  if (DATA.spinPolarized) {
    ctx.strokeStyle = '#c7ced8';
    ctx.beginPath(); ctx.moveTo(left, (top + bottom) / 2); ctx.lineTo(right, (top + bottom) / 2); ctx.stroke();
  }
  ctx.fillStyle = '#5b6472';
  ctx.font = '12px sans-serif';
  ctx.fillText('E − E_f (eV)', (left + right) / 2 - 30, bottom + 36);
  ctx.fillText('PDOS', left + 6, top + 15);

  for (const item of items) {
    ctx.beginPath();
    let started = false;
    item.energies.forEach((energy, i) => {
      if (energy < eMin || energy > eMax) return;
      const x = xOf(energy);
      const y = yOf(item.up[i] ?? 0);
      if (!started) { ctx.moveTo(x, y); started = true } else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 1.6;
    ctx.setLineDash(item.dash);
    if (started) ctx.stroke();
    if (DATA.spinPolarized) {
      ctx.beginPath();
      let downStarted = false;
      item.energies.forEach((energy, i) => {
        if (energy < eMin || energy > eMax) return;
        const x = xOf(energy);
        const y = yOf(-(item.down[i] ?? 0));
        if (!downStarted) { ctx.moveTo(x, y); downStarted = true } else ctx.lineTo(x, y);
      });
      if (downStarted) ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // 纵轴刻度
  for (let i = 0; i <= 4; i += 1) {
    const value = (yMax * i) / 4;
    ctx.fillStyle = '#7b8494';
    ctx.font = '11px sans-serif';
    if (DATA.spinPolarized) {
      const mid = (top + bottom) / 2;
      const span = (bottom - top) / 2;
      ctx.fillText(value.toFixed(1), 22, mid - (value / yMax) * span + 4);
      ctx.fillText('-' + value.toFixed(1), 18, mid + (value / yMax) * span + 4);
    } else {
      ctx.fillText(value.toFixed(1), 26, bottom - (value / yMax) * (bottom - top) + 4);
    }
  }
}

document.getElementById('b-save').addEventListener('click', () => {
  const link = document.createElement('a');
  link.download = 'pdos.png';
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

const out = resolve(flag('out', join(dirname(source), `${basename(source)}-pdos.html`)))
writeFileSync(out, html, 'utf8')
console.log(JSON.stringify({
  out,
  elements: series.map((item) => item.element),
  orbitals: [...new Set(series.flatMap((item) => item.orbitals.map((orbital) => orbital.orbital)))],
  spinPolarized,
  energies: series[0]?.energies.length ?? 0,
  bytes: html.length,
}, null, 2))
