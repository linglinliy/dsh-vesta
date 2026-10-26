/**
 * 层分离与吸附高度（layerProfile / adsorbateHeight）。
 *   node --test test/layer.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { adsorbateHeight, layerProfile, parsePoscar } from '../core.js'

/**
 * 造一个 c 轴 20 Å 的胞。atoms 按物种顺序排列（同 VASP 的 POSCAR 约定），
 * counts 行自动按顺序统计每个物种的原子数。
 */
const makeSlab = (species, atoms) => {
  const counts = species.map((symbol) => atoms.filter((atom) => atom.symbol === symbol).length)
  const ordered = species.flatMap((symbol) => atoms.filter((atom) => atom.symbol === symbol))
  return parsePoscar([
    'slab', '1.0',
    '3 0 0', '0 3 0', '0 0 20',
    species.join(' '), counts.join(' '), 'Direct',
    ...ordered.map((atom) => atom.frac.map((value) => value.toFixed(6)).join(' ')),
  ].join('\n'), 'slab')
}

const frac = (z, symbol = 'C') => ({ symbol, frac: [0, 0, z] })

test('layerProfile：沿 c 轴把原子分成层', () => {
  const structure = makeSlab(['C', 'Na'], [
    frac(0.5, 'C'), { symbol: 'C', frac: [0.3, 0, 0.5] }, { symbol: 'C', frac: [0.6, 0, 0.5] },
    frac(0.615, 'Na'), // z = 12.3 Å
  ])
  const profile = layerProfile(structure)
  assert.equal(profile.layers.length, 2)
  assert.ok(Math.abs(profile.layers[0].z - 10) < 1e-6)
  assert.deepEqual(profile.layers[0].elements, { C: 3 })
  assert.ok(Math.abs(profile.layers[1].z - 12.3) < 1e-6)
  assert.deepEqual(profile.layers[1].elements, { Na: 1 })
})

test('adsorbateHeight：吸附高度等于两者 z 差', () => {
  const structure = makeSlab(['C', 'Na'], [
    frac(0.2), { symbol: 'C', frac: [0.3, 0, 0.2] },
    frac(0.315, 'Na'), // 4 → 6.3 Å
  ])
  const height = adsorbateHeight(structure, { adsorbate: 'Na', substrate: ['C'] })
  assert.ok(Math.abs(height.mean - 2.3) < 1e-6, `mean = ${height.mean}`)
})

test('adsorbateHeight：掺杂基底（含 B/N）仍然算基底（回归用例）', () => {
  // 早期版本用「层里只含基底元素」判据，会把含 B 的碳层排除，导致返回 null
  const structure = makeSlab(['C', 'B', 'Na'], [
    frac(0.2), { symbol: 'C', frac: [0.3, 0, 0.2] }, { symbol: 'B', frac: [0.6, 0, 0.2] },
    frac(0.315, 'Na'),
  ])
  const height = adsorbateHeight(structure, { adsorbate: 'Na', substrate: ['C'] })
  assert.ok(height.mean !== null, '掺杂基底不应被排除')
  assert.ok(Math.abs(height.mean - 2.3) < 1e-6, `mean = ${height.mean}`)
})

test('adsorbateHeight：多层基底时取最近的一层', () => {
  const structure = makeSlab(['C', 'Na'], [
    frac(0.05), // z = 1 Å（底层）
    frac(0.5),  // z = 10 Å（上层）
    frac(0.515, 'Na'), // z = 10.3 Å
  ])
  const height = adsorbateHeight(structure, { adsorbate: 'Na', substrate: ['C'] })
  assert.ok(Math.abs(height.mean - 0.3) < 1e-6, `mean = ${height.mean}`)
})

test('adsorbateHeight：没有吸附物时均值为 null', () => {
  const structure = makeSlab(['C'], [frac(0.5)])
  assert.equal(adsorbateHeight(structure, { adsorbate: 'Na', substrate: ['C'] }).mean, null)
})
