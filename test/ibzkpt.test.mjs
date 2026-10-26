/**
 * IBZKPT（不可约 k 点与对称性约化）测试。
 *   node --test test/ibzkpt.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseIbzkpt } from '../core.js'

const TEXT = [
  'Automatically generated mesh',
  '      3',
  'Reciprocal lattice',
  '    0.00000000000000    0.00000000000000    0.00000000000000             1',
  '    0.11111111111111    0.00000000000000    0.00000000000000             8',
  '    0.22222222222222    0.00000000000000    0.00000000000000             8',
].join('\n')

test('parseIbzkpt：读出 IBZ 点数、权重与权重和', () => {
  const parsed = parseIbzkpt(TEXT)
  assert.equal(parsed.count, 3)
  assert.deepEqual(parsed.weights, [1, 8, 8])
  assert.equal(parsed.totalWeight, 17)
  assert.equal(parsed.comment, 'Automatically generated mesh')
  assert.ok(Math.abs(parsed.kpoints[1].k[0] - 1 / 9) < 1e-12)
})

test('parseIbzkpt：行数不足时报错', () => {
  const broken = TEXT.split('\n').slice(0, 4).join('\n')
  assert.throws(() => parseIbzkpt(broken), /数据行不足/)
})

test('parseIbzkpt：第 2 行不是数字时报错', () => {
  assert.throws(() => parseIbzkpt('comment\nnot-a-number\nReciprocal lattice\n'), /不是有效的 k 点个数/)
})
