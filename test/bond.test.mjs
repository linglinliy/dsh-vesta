/**
 * bondList（查看器成键判据）的单元测试。
 *   node --test test/bond.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { bondList, parsePoscar } from '../core.js'

const SI = ['Si', '5.5', '0 0.5 0.5', '0.5 0 0.5', '0.5 0.5 0', 'Si', '2', 'Direct', '0 0 0', '0.25 0.25 0.25'].join('\n')

test('bondList：金刚石 Si 只有一对等价键，2.38157 Å', () => {
  const bonds = bondList(parsePoscar(SI, 'x'))
  assert.equal(bonds.length, 1)
  assert.equal(bonds[0].symbols, 'Si1-Si2')
  assert.ok(Math.abs(bonds[0].length - 2.38157) < 1e-4)
})

test('bondList：石墨烯 C–C 键 1.42259 Å（VESTA 同值）', () => {
  const poscar = [
    'C2 graphene', '1.0',
    '2.464 0 0', '-1.232 2.1339 0', '0 0 20',
    'C', '2', 'Direct',
    '0.333333 0.666667 0.5',
    '0.666667 0.333333 0.5',
  ].join('\n')
  const bonds = bondList(parsePoscar(poscar, 'x'))
  assert.equal(bonds.length, 1)
  assert.ok(Math.abs(bonds[0].length - 1.4226) < 1e-3)
})

test('bondList：距离超出判据的不算键', () => {
  const poscar = ['C', '1.0', '2 0 0', '0 2 0', '0 0 2', 'C', '2', 'Direct', '0 0 0', '0.5 0 0'].join('\n')
  // 距离 1 Å < 1.25×(0.76+0.76)=1.9 → 算键
  assert.equal(bondList(parsePoscar(poscar, 'x')).length, 1)
  // 判据收紧到 0.5 → 不算
  assert.equal(bondList(parsePoscar(poscar, 'x'), { scale: 0.3 }).length, 0)
})

test('bondList：单原子没有键', () => {
  const poscar = ['C', '1.0', '2 0 0', '0 2 0', '0 0 2', 'C', '1', 'Direct', '0 0 0'].join('\n')
  assert.deepEqual(bondList(parsePoscar(poscar, 'x')), [])
})
