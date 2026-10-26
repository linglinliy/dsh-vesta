/**
 * XDATCAR 轨迹解析测试。
 *   node --test test/xdatcar.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseXdatcar } from '../core.js'

const TEXT = [
  'C2 test',
  '1.0',
  '2.0 0 0',
  '0 2.0 0',
  '0 0 10.0',
  'C',
  '2',
  'Direct configuration= 1',
  '0.50 0.50 0.50',
  '0.50 0.50 0.50',
  'Direct configuration= 2',
  '0.45 0.50 0.50',
  '0.55 0.50 0.50',
].join('\n')

test('parseXdatcar：头部与两帧坐标', () => {
  const data = parseXdatcar(TEXT)
  assert.equal(data.symbols[0], 'C')
  assert.deepEqual(data.counts, [2])
  assert.deepEqual(data.cell[2], [0, 0, 10])
  assert.equal(data.frames.length, 2)
  assert.deepEqual(data.frames[0].frac, [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5]])
  assert.deepEqual(data.frames[1].frac[0], [0.45, 0.5, 0.5])
  assert.equal(data.frames[1].index, 2)
})

test('parseXdatcar：缩放因子作用到晶胞', () => {
  const scaled = TEXT.replace('1.0\n', '2.0\n')
  const data = parseXdatcar(scaled)
  assert.deepEqual(data.cell[0], [4, 0, 0])
})

test('parseXdatcar：没有帧时报错', () => {
  const head = TEXT.split('\n').slice(0, 7).join('\n')
  assert.throws(() => parseXdatcar(head), /没有找到任何 Direct \/ Cartesian configuration/)
})

test('parseXdatcar：坐标行不足时报错', () => {
  const broken = TEXT.split('\n').slice(0, 9).join('\n')
  assert.throws(() => parseXdatcar(broken), /坐标无法解析/)
})
test('parseXdatcar：Cartesian 帧换算成分数坐标', () => {
  const cart = [
    'C1 cartesian',
    '1.0',
    '2 0 0',
    '0 2 0',
    '0 0 10',
    'C',
    '1',
    'Cartesian configuration= 1',
    '1.0 1.0 5.0',
  ].join('\n')
  const data = parseXdatcar(cart)
  assert.equal(data.frames.length, 1)
  assert.equal(data.frames[0].cartesian, true)
  assert.deepEqual(data.frames[0].frac[0].map((v) => Math.round(v * 1e6) / 1e6), [0.5, 0.5, 0.5])
})

test('parseXdatcar：Direct 与 Cartesian 混合的多帧', () => {
  const mixed = [
    'mixed',
    '1.0',
    '2 0 0',
    '0 2 0',
    '0 0 10',
    'C',
    '1',
    'Direct configuration= 1',
    '0.25 0.25 0.5',
    'Cartesian configuration= 2',
    '1.0 1.0 5.0',
  ].join('\n')
  const data = parseXdatcar(mixed)
  assert.equal(data.frames.length, 2)
  assert.equal(data.frames[0].cartesian, false)
  assert.equal(data.frames[1].cartesian, true)
  assert.ok(Math.abs(data.frames[1].frac[0][0] - 0.5) < 1e-9)
})
