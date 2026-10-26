/**
 * DOSCAR 解析与积分测试。
 *   node --test test/doscar.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDoscar, integrateDos } from '../core.js'

/**
 * ISPIN=1 的 DOSCAR：三列是 E、DOS、积分 DOS。
 * 期望的累积积分：E=-5 处 0，到 E=0 时 0.5·(0+1)·5 = 2.5，到 E=2 时再加 0.5·(1+1)·2 = 2 → 4.5
 */
const SINGLE = [
  '2 2 0 0',
  '0.1 0.2 0.3 0.4 0.5',
  '1.0',
  'CAR ',
  'test',
  '10.0 -5.0 3 0.0 1.0',
  '-5.0 0.0 0.0',
  '0.0 1.0 2.5',
  '2.0 1.0 4.5',
].join('\n')

/** ISPIN=2 的 DOSCAR：三列是 E、自旋向上、自旋向下。 */
const SPIN = [
  '1 2 0 0',
  '0.1 0.2 0.3 0.4 0.5',
  '1.0',
  'CAR ',
  'test',
  '10.0 -5.0 3 0.0 1.0',
  '-5.0 0.2 0.1',
  '0.0 2.0 0.5',
  '2.0 1.0 0.3',
].join('\n')

test('parseDoscar：ISPIN=1 时第三列是积分 DOS，不是自旋向下', () => {
  const dos = parseDoscar(SINGLE)
  assert.equal(dos.nedos, 3)
  assert.equal(dos.spinPolarized, false)
  assert.deepEqual(dos.integratedDos, [0, 2.5, 4.5])
  assert.ok(dos.down.every((value) => value === 0))
  assert.deepEqual(dos.up, [0, 1, 1])
})

test('parseDoscar：ISPIN=2 时识别自旋向下', () => {
  const dos = parseDoscar(SPIN)
  assert.equal(dos.spinPolarized, true)
  assert.equal(dos.integratedDos.length, 0)
  assert.deepEqual(dos.up, [0.2, 2, 1])
  assert.deepEqual(dos.down, [0.1, 0.5, 0.3])
})

test('integrateDos：梯形积分到给定能量', () => {
  const single = parseDoscar(SINGLE)
  // 0..2 区间：0.5·(1+1)·2 = 2，加上 -5..0 的 0.5·(0+1)·5 = 2.5 → 4.5
  assert.ok(Math.abs(integrateDos(single, 2) - 4.5) < 1e-9)
  assert.ok(Math.abs(integrateDos(single, 0) - 2.5) < 1e-9)
  // 自旋极化积分全程：-5..0 段 0.5·(0.3+2.5)·5 = 7，0..2 段 0.5·(2.5+1.3)·2 = 3.8 → 10.8
  assert.ok(Math.abs(integrateDos(parseDoscar(SPIN), 2) - 10.8) < 1e-9)
})

test('parseDoscar：数据行不足时报错', () => {
  const broken = SINGLE.split('\n').slice(0, 7).join('\n')
  assert.throws(() => parseDoscar(broken), /数据行不足/)
})
