/**
 * 结构折叠（foldStructure）与越界坐标的鲁棒性。
 *   node --test test/fold.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { adsorbateHeight, foldStructure, layerProfile, parsePoscar } from '../core.js'

const makeCell = (atoms) => {
  const species = [...new Set(atoms.map((atom) => atom.symbol))]
  const counts = species.map((symbol) => atoms.filter((atom) => atom.symbol === symbol).length)
  const ordered = species.flatMap((symbol) => atoms.filter((atom) => atom.symbol === symbol))
  return parsePoscar([
    'cell', '1.0',
    '4 0 0', '0 4 0', '0 0 20',
    species.join(' '), counts.join(' '), 'Direct',
    ...ordered.map((atom) => atom.frac.map((value) => value.toFixed(6)).join(' ')),
  ].join('\n'), 'cell')
}

test('foldStructure：越界坐标绕回 [0,1)，不改变原子数', () => {
  const structure = makeCell([
    { symbol: 'C', frac: [0.0, 0.0, 0.5] },
    { symbol: 'C', frac: [0.3, 0.0, 1.02] },   // 越界
    { symbol: 'Na', frac: [-0.05, 0.0, 0.6] }, // 越界
  ])
  const folded = foldStructure(structure)
  assert.equal(folded.wrapped, 2)
  assert.equal(folded.merged, 0)
  assert.equal(folded.atoms.length, 3)
  for (const atom of folded.atoms) {
    for (const value of atom.frac) assert.ok(value >= 0 && value < 1, `越界：${value}`)
  }
  assert.ok(Math.abs(folded.atoms[1].frac[2] - 0.02) < 1e-9)
  assert.ok(Math.abs(folded.atoms[2].frac[0] - 0.95) < 1e-9)
})

test('foldStructure：周期性重复的原子被合并', () => {
  const structure = makeCell([
    { symbol: 'Na', frac: [0.25, 0.25, 0.5] },
    { symbol: 'Na', frac: [1.25, 0.25, 0.5] }, // 与第一个周期等价
  ])
  const folded = foldStructure(structure)
  assert.equal(folded.merged, 1)
  assert.equal(folded.atoms.length, 1)
})

test('foldStructure：不同元素即使位置重合也不合并', () => {
  const structure = makeCell([
    { symbol: 'C', frac: [0.5, 0.5, 0.5] },
    { symbol: 'Na', frac: [0.5, 0.5, 0.5] },
  ])
  assert.equal(foldStructure(structure).merged, 0)
  assert.equal(foldStructure(structure, { keepSymbol: false }).merged, 1)
})

test('layerProfile：越界 z 会被绕回，不会算到下一个周期', () => {
  const structure = makeCell([
    { symbol: 'C', frac: [0.0, 0.0, 0.5] },
    { symbol: 'Na', frac: [0.0, 0.0, 1.115] }, // 绕回后 z = 0.115 × 20 = 2.3 Å
  ])
  const profile = layerProfile(structure)
  const sodium = profile.layers.find((layer) => layer.elements.Na)
  assert.ok(Math.abs(sodium.z - 2.3) < 1e-6, `Na 层 z = ${sodium.z}`)
})

test('adsorbateHeight：越界坐标（1.515 → 0.515）与直接写 0.515 结果一致', () => {
  const normal = makeCell([
    { symbol: 'C', frac: [0.0, 0.0, 0.5] },
    { symbol: 'Na', frac: [0.0, 0.0, 0.515] }, // z = 10.3 Å，碳层在 10 Å
  ])
  const outOfRange = makeCell([
    { symbol: 'C', frac: [0.0, 0.0, 0.5] },
    { symbol: 'Na', frac: [0.0, 0.0, 1.515] }, // 绕回后同为 0.515
  ])
  const expected = adsorbateHeight(normal, { adsorbate: 'Na', substrate: ['C'], gap: 0.5 }).mean
  const actual = adsorbateHeight(outOfRange, { adsorbate: 'Na', substrate: ['C'], gap: 0.5 }).mean
  assert.ok(Math.abs(expected - 0.3) < 1e-6, `基准高度 ${expected}`)
  assert.ok(Math.abs(actual - expected) < 1e-6, `越界坐标高度 ${actual}，应为 ${expected}`)
})
