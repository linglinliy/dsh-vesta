/**
 * SVG 矢量导出（structureToSvg / vesta_vector）。
 *   node --test test/svg.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync as readFile } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePoscar, structureFromCif, structureToSvg } from '../core.js'

const POSCAR = [
  'Si-fcc', '1.0',
  '0.000000 2.715500 2.715500',
  '2.715500 0.000000 2.715500',
  '2.715500 2.715500 0.000000',
  'Si', '2', 'Direct',
  '0.000000 0.000000 0.000000',
  '0.250000 0.250000 0.250000',
].join('\n') + '\n'

const structure = () => {
  const parsed = parsePoscar(POSCAR, 'Si')
  return {
    a1: parsed.a1, a2: parsed.a2, a3: parsed.a3,
    atoms: parsed.atoms.map((atom) => ({ symbol: atom.symbol, frac: atom.frac })),
  }
}

test('structureToSvg：输出是完整 SVG，且圆/线的数量与结构对应', () => {
  const result = structureToSvg(structure(), { width: 400, height: 300 })
  assert.ok(result.svg.startsWith('<svg'))
  assert.ok(result.svg.trimEnd().endsWith('</svg>'))
  assert.equal(result.atoms, 2)
  assert.equal((result.svg.match(/<circle/g) ?? []).length, 2)
  // 12 条晶胞棱 + 1 条键
  assert.equal((result.svg.match(/<line/g) ?? []).length, 12 + result.bonds)
  assert.equal(result.width, 400)
  assert.equal(result.height, 300)
})

test('structureToSvg：同样参数两次输出完全相同（确定性）', () => {
  const a = structureToSvg(structure(), { rx: 20, ry: 15, width: 500, height: 400 })
  const b = structureToSvg(structure(), { rx: 20, ry: 15, width: 500, height: 400 })
  assert.equal(a.svg, b.svg)
})

test('structureToSvg：旋转角改变输出，但不改变原子数', () => {
  const a = structureToSvg(structure(), { rx: 0 })
  const b = structureToSvg(structure(), { rx: 40 })
  assert.notEqual(a.svg, b.svg)
  assert.equal(a.atoms, b.atoms)
})

test('structureToSvg：关掉晶胞与键后只剩圆', () => {
  const result = structureToSvg(structure(), { showCell: false, showBonds: false })
  assert.equal((result.svg.match(/<line/g) ?? []).length, 0)
  assert.equal((result.svg.match(/<circle/g) ?? []).length, 2)
  assert.equal(result.bonds, 0)
})

test('structureToSvg：所有坐标都是有限数值（不会出现 NaN）', () => {
  const result = structureToSvg(structure(), { rx: 10, ry: -20, rz: 30 })
  assert.ok(!/NaN/.test(result.svg), 'SVG 里不应出现 NaN')
})

test('structureToSvg：原子为空时不抛错', () => {
  const result = structureToSvg({ a1: [5, 0, 0], a2: [0, 5, 0], a3: [0, 0, 5], atoms: [] })
  assert.equal(result.atoms, 0)
  assert.ok(result.svg.startsWith('<svg'))
})
test('structureToSvg：部分占位原子按占位率降低不透明度并标虚线', { skip: !existsSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'public', 'cod-9006316.cif')) && '缺少公开夹具' }, () => {
  const cif = readFile(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'public', 'cod-9006316.cif'), 'utf8')
  const structure = structureFromCif(cif)
  const result = structureToSvg(structure, { width: 600, height: 400 })
  assert.equal(result.partial, 16, "γ-Fe2O3 有 16 个 0.833 占位的铁")
  assert.equal((result.svg.match(/stroke-dasharray/g) ?? []).length, 16)
  assert.equal((result.svg.match(/occ=/g) ?? []).length, 16)
  assert.equal(result.atoms, 56)
})

test('structureToSvg：满占位结构不带虚线也不降透明度', () => {
  const result = structureToSvg(structure(), { width: 400, height: 300 })
  assert.equal(result.partial, 0)
  assert.equal((result.svg.match(/stroke-dasharray/g) ?? []).length, 0)
  assert.equal((result.svg.match(/occ=/g) ?? []).length, 0)
})
