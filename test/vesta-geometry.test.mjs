/**
 * VESTA 键长列表解析 与 最短原子间距 的单元测试。
 *   node --test test/vesta-geometry.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseVestaBondList, parsePoscar, shortestAtomDistance } from '../core.js'

const BOND_TEXT = [
  'Bond: l(Si1-Si2) =  2.38157(0) Å',
  '   1     Si1 Si   0.00000   0.00000   0.00000 ( 0  0  0)+ x, y, z',
  '   2     Si2 Si   0.25000   0.25000   0.25000 ( 0  0  0)+ x, y, z',
  '',
  'Bond: l(Si2-Si1) =  2.38157(0) Å',
  'Bond: l(Si1-Si2) =  2.50000(0) Å',
].join('\n')

test('parseVestaBondList：按对去重，取最小键长，并保留原始条目数', () => {
  const parsed = parseVestaBondList(BOND_TEXT)
  assert.equal(parsed.count, 3)
  assert.deepEqual(parsed.pairs, [
    { pair: 'Si1-Si2', length: 2.38157 },
    { pair: 'Si2-Si1', length: 2.38157 },
  ])
})

test('parseVestaBondList：没有键时返回空列表', () => {
  assert.deepEqual(parseVestaBondList('nothing here'), { pairs: [], count: 0 })
})

test('shortestAtomDistance：fcc 原胞 Si 的最短间距 2.38157 Å', () => {
  const poscar = ['Si', '5.5', '0 0.5 0.5', '0.5 0 0.5', '0.5 0.5 0', 'Si', '2', 'Direct', '0 0 0', '0.25 0.25 0.25'].join('\n')
  const structure = parsePoscar(poscar, 'x')
  assert.ok(Math.abs(shortestAtomDistance(structure) - 2.38157) < 1e-4)
})

test('shortestAtomDistance：单原子返回 null', () => {
  const poscar = ['C', '1.0', '2 0 0', '0 2 0', '0 0 2', 'C', '1', 'Direct', '0 0 0'].join('\n')
  assert.equal(shortestAtomDistance(parsePoscar(poscar, 'x')), null)
})
