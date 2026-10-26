/**
 * 吸附位点判别（adsorbateSite）。
 *   node --test test/site.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { adsorbateSite, parsePoscar } from '../core.js'

/**
 * c 轴 20 Å、面内 4×4 Å 的胞（注意：L=4 时 0 与 4 是同一个原子，所以基底放在 0 与 2）。
 */
const L = 4
const makeCell = (atoms) => {
  const species = [...new Set(atoms.map((atom) => atom.symbol))]
  const counts = species.map((symbol) => atoms.filter((atom) => atom.symbol === symbol).length)
  const ordered = species.flatMap((symbol) => atoms.filter((atom) => atom.symbol === symbol))
  return parsePoscar([
    'site', '1.0',
    `${L} 0 0`, `0 ${L} 0`, '0 0 20',
    species.join(' '), counts.join(' '), 'Direct',
    ...ordered.map((atom) => atom.frac.map((value) => value.toFixed(6)).join(' ')),
  ].join('\n'), 'site')
}

/** 由面内 Å 坐标转分数坐标（z 固定 0.5）。 */
const at = (x, y, symbol = 'C') => ({ symbol, frac: [x / L, y / L, 0.5] })

test('adsorbateSite：正上方一个原子 → top', () => {
  const structure = makeCell([
    at(0, 0), at(2, 0), at(0, 2), at(2, 2),
    at(0, 0, 'Na'),
  ])
  const result = adsorbateSite(structure, { adsorbate: 'Na', substrate: ['C'], tolerance: 0.2 })
  assert.equal(result.sites[0].site, 'top')
  assert.equal(result.sites[0].neighbors, 1)
  assert.ok(Math.abs(result.sites[0].distance) < 1e-9)
})

test('adsorbateSite：两个等距原子之间 → bridge', () => {
  const structure = makeCell([at(0, 0), at(2, 0), at(1, 0, 'Na')])
  const result = adsorbateSite(structure, { adsorbate: 'Na', substrate: ['C'], tolerance: 0.2 })
  assert.equal(result.sites[0].site, 'bridge')
  assert.equal(result.sites[0].neighbors, 2)
  assert.ok(Math.abs(result.sites[0].distance - 1) < 1e-6)
})

test('adsorbateSite：四个等距原子的方孔中心 → hollow', () => {
  const structure = makeCell([
    at(0, 0), at(2, 0), at(0, 2), at(2, 2),
    at(1, 1, 'Na'),
  ])
  const result = adsorbateSite(structure, { adsorbate: 'Na', substrate: ['C'], tolerance: 0.2 })
  assert.equal(result.sites[0].site, 'hollow')
  assert.equal(result.sites[0].neighbors, 4)
  assert.ok(Math.abs(result.sites[0].distance - Math.SQRT2) < 1e-6)
})

test('adsorbateSite：面内距离按周期性取最小镜像', () => {
  // 基底在 (0,0)，吸附物在 (0.2,0)：跨越周期边界时距离应仍是 0.2 而不是 3.8
  const structure = makeCell([at(0, 0), at(0.2, 0, 'Na')])
  const result = adsorbateSite(structure, { adsorbate: 'Na', substrate: ['C'], tolerance: 0.2 })
  assert.equal(result.sites[0].site, 'top')
  assert.ok(Math.abs(result.sites[0].distance - 0.2) < 1e-6)
})

test('adsorbateSite：没有吸附物时返回空列表', () => {
  const structure = makeCell([at(0, 0)])
  const result = adsorbateSite(structure, { adsorbate: 'Na', substrate: ['C'] })
  assert.deepEqual(result.sites, [])
  assert.equal(result.summary, '')
})
