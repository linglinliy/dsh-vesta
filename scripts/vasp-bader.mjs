#!/usr/bin/env node
/**
 * vasp-bader —— 按最近原子做离散 Voronoi 电荷归属（Bader 近似），从 CHGCAR 给每原子电荷。
 *
 *   node scripts/vasp-bader.mjs <CHGCAR 或任务目录> [--poscar POSCAR] [--out charges.csv]
 *
 * 注意：这是「体素归最近原子」的离散近似，与真 Voronoi/Bader 会有小差异；
 * 总和应等于 NELECT（可作为自检）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { parseOutcar, parsePoscar, potcarElements, readVolumeFile, voronoiCharges } from '../core.js'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/vasp-bader.mjs <CHGCAR 或任务目录> [--poscar POSCAR] [--out charges.csv]')
  process.exit(2)
}

const source = resolve(input)
const chgcar = existsSync(source) && !/chgcar|chg$/i.test(source) ? join(source, 'CHGCAR') : source
if (!existsSync(chgcar)) {
  console.error(`找不到 CHGCAR：${chgcar}`)
  process.exit(2)
}

const poscarPath = flag('poscar', join(dirname(chgcar), 'POSCAR'))
if (!existsSync(poscarPath)) {
  console.error(`找不到 POSCAR：${poscarPath}（可用 --poscar 指定）`)
  process.exit(2)
}
const potcarPath = join(dirname(poscarPath), 'POTCAR')
const symbols = existsSync(potcarPath) ? potcarElements(readFileSync(potcarPath, 'utf8')) : undefined
const structure = parsePoscar(readFileSync(poscarPath, 'utf8'), basename(poscarPath), { symbols })

const volume = readVolumeFile(chgcar, { structure })
const result = voronoiCharges(volume, { structure })

// NELECT（若同目录有 OUTCAR）
let nelect = null
const outcarPath = join(dirname(chgcar), 'OUTCAR')
if (existsSync(outcarPath)) nelect = parseOutcar(readFileSync(outcarPath, 'utf8')).nelect

console.log(`文件：${basename(chgcar)}　网格 ${volume.dims.join('×')}　原子 ${structure.atoms.length}`)
console.log(`总电荷 ${result.total.toFixed(4)} e` + (nelect === null ? '' : `　NELECT ${nelect} e（差 ${Math.abs(result.total - nelect).toExponential(2)}）`))
console.log('元素     原子数   总电荷(e)     每原子(e)')
for (const [symbol, entry] of Object.entries(result.byElement)) {
  console.log(`${symbol.padEnd(6)} ${String(entry.count).padStart(6)} ${entry.charge.toFixed(4).padStart(12)} ${entry.perAtom.toFixed(4).padStart(12)}`)
}

const out = flag('out', '')
if (out) {
  const lines = ['index,symbol,charge_e,volume_A3']
  for (const atom of result.atoms) {
    lines.push(`${atom.index},${atom.symbol},${atom.charge.toFixed(6)},${atom.volume.toFixed(4)}`)
  }
  writeFileSync(resolve(out), `${lines.join('\n')}\n`, 'utf8')
  console.log(`已写出：${resolve(out)}`)
}

console.log(JSON.stringify({
  file: chgcar,
  total: +result.total.toFixed(6),
  nelect,
  byElement: Object.fromEntries(Object.entries(result.byElement).map(([symbol, entry]) => [symbol, {
    count: entry.count,
    perAtom: +entry.perAtom.toFixed(6),
  }])),
  out: out ? resolve(out) : null,
}, null, 2))
