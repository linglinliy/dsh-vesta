#!/usr/bin/env node
/**
 * make-supercell —— 把 POSCAR/CONTCAR 扩成超胞并写出新的 POSCAR。
 *
 *   node scripts/make-supercell.mjs <结构文件> --repeat 2,2,1 [--out SUPER.vasp]
 *
 * 分数坐标按 (i+x)/n 重排，晶胞向量按倍数放大；写出 VASP5 写法（带元素行）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { installFriendlyErrors } from './_friendly-errors.mjs'
import { cellParameters, makeSupercell, parsePoscar, potcarElements } from '../core.js'

installFriendlyErrors()

const args = process.argv.slice(2)
const input = args.find((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback
}
if (!input) {
  console.error('用法：node scripts/make-supercell.mjs <结构文件> --repeat 2,2,1 [--out SUPER.vasp]')
  process.exit(2)
}

const repeat = String(flag('repeat', '1,1,1')).split(',').map(Number)
if (repeat.length !== 3 || repeat.some((value) => !Number.isInteger(value) || value <= 0)) {
  console.error(`--repeat 需要三个正整数，收到：${flag('repeat', '')}`)
  process.exit(2)
}

const source = resolve(input)
const potcarPath = join(dirname(source), 'POTCAR')
const symbols = existsSync(potcarPath)
  ? potcarElements(readFileSync(potcarPath, 'utf8'))
  : undefined
const structure = parsePoscar(readFileSync(source, 'utf8'), basename(source), { symbols })
const supercell = makeSupercell(structure, repeat)

// 写出 VASP5 POSCAR
const counts = new Map()
for (const atom of supercell.atoms) counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1)
const order = [...new Set(structure.atoms.map((atom) => atom.symbol))]
const species = order.filter((symbol) => counts.has(symbol))
const lines = [
  `${basename(source)} ${repeat.join('x')}`,
  '1.0',
  supercell.a1.map((value) => value.toFixed(10)).join(' '),
  supercell.a2.map((value) => value.toFixed(10)).join(' '),
  supercell.a3.map((value) => value.toFixed(10)).join(' '),
  species.join(' '),
  species.map((symbol) => counts.get(symbol)).join(' '),
  'Direct',
  ...supercell.atoms.map((atom) => atom.frac.map((value) => value.toFixed(10)).join(' ')),
]
const out = resolve(flag('out', join(dirname(source), `${basename(source)}-${repeat.join('x')}.vasp`)))
writeFileSync(out, `${lines.join('\n')}\n`, 'utf8')

const cell = cellParameters([structure.a1, structure.a2, structure.a3])
const newCell = cellParameters([supercell.a1, supercell.a2, supercell.a3])
console.log(`原结构：${structure.atoms.length} 原子，V = ${cell.volume.toFixed(3)} Å³`)
console.log(`超胞：${supercell.atoms.length} 原子（${repeat.join('×')}），V = ${newCell.volume.toFixed(3)} Å³`)
console.log(`已写出：${out}`)
console.log(JSON.stringify({
  out,
  repeat,
  atoms: supercell.atoms.length,
  volume: +newCell.volume.toFixed(4),
  formula: species.map((symbol) => `${symbol}${counts.get(symbol)}`).join(''),
}, null, 2))
