#!/usr/bin/env node
/**
 * pdos —— 从 DOSCAR 的 PDOS 块（LORBIT ≥ 11）汇总每个元素的轨道电子数与带中心。
 *
 *   node scripts/pdos.mjs --root <任务目录> [--format md|csv] [--out pdos.md]
 *
 * 只读。元素归属靠同目录 POSCAR（VASP4 写法用 POTCAR 补元素）；读不到就按原子序号标注。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseDoscarPdos, pdosSummary, parsePoscar, potcarElements } from '../core.js'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
const root = flag('root', '')
if (!root) {
  console.error('用法：node scripts/pdos.mjs --root <任务目录> [--format md|csv] [--out pdos.md]')
  process.exit(2)
}
const dir = resolve(root)
const doscarPath = join(dir, 'DOSCAR')
if (!existsSync(doscarPath)) {
  console.error(`找不到 DOSCAR：${doscarPath}`)
  process.exit(2)
}

const pdos = parseDoscarPdos(readFileSync(doscarPath, 'utf8'))
let structure = null
const poscarPath = join(dir, 'POSCAR')
if (existsSync(poscarPath)) {
  try {
    const symbols = existsSync(join(dir, 'POTCAR'))
      ? potcarElements(readFileSync(join(dir, 'POTCAR'), 'utf8'))
      : undefined
    const parsed = parsePoscar(readFileSync(poscarPath, 'utf8'), 'POSCAR', { symbols })
    const counts = new Map()
    for (const atom of parsed.atoms) counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1)
    structure = { symbols: [...counts.keys()], counts: [...counts.values()] }
  } catch {
    structure = null
  }
}

const rows = pdosSummary(pdos, structure)

if (rows.length === 0) {
  console.error('DOSCAR 里没有 PDOS 块（通常需要 LORBIT = 11 或 12 重算）')
  process.exit(2)
}

const format = String(flag('format', 'md')).toLowerCase() === 'csv' ? 'csv' : 'md'
const header = ['元素', '轨道', '电子数（到 E_f）', '带中心 (eV)']
const body = rows.map((row) => [row.element, row.orbital, row.electrons.toFixed(4), row.center === null ? '—' : row.center.toFixed(4)])
const output = format === 'csv'
  ? [header, ...body].map((line) => line.join(',')).join('\n') + '\n'
  : `| ${header.join(' | ')} |\n| ${header.map(() => '---').join(' | ')} |\n${body.map((line) => `| ${line.join(' | ')} |`).join('\n')}\n`

const out = flag('out', '')
if (out) {
  const target = resolve(out)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, output, 'utf8')
  console.log(JSON.stringify({ out: target, format, atoms: pdos.atoms.length, rows: rows.length }, null, 2))
} else {
  console.log(output)
}
