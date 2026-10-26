/**
 * PDOS 解析与汇总测试（合成 DOSCAR：ISPIN=1，2 个原子，s/p/d 三列）。
 *   node --test test/pdos.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDoscarPdos, pdosSummary } from '../core.js'

/** 构造：总 DOS 块（NEDOS=3）+ 2 个原子块，每块 3 行（E, s, p, d）。 */
const build = () => {
  const lines = [
    '2 2 0 0',
    '0.1 0.1 0.1 0.9 0.1',
    '1e-4',
    'CAR',
    'fixture',
    '10.0 -5.0 3 0.0 1.0',
    '-5 0 0 0',
    '0 0 0 0',
    '5 0 0 0',
  ]
  for (let atom = 0; atom < 2; atom += 1) {
    lines.push('')
    lines.push('10.0 -5.0 3 0.0 1.0')
    lines.push('-5 1.0 0.0 0.0')
    lines.push('0 1.0 0.0 0.0')
    lines.push('5 1.0 0.0 0.0')
  }
  return lines.join('\n')
}

test('parseDoscarPdos：跳过总 DOS 块，读出逐原子块', () => {
  const pdos = parseDoscarPdos(build())
  assert.equal(pdos.natoms, 2)
  assert.equal(pdos.atoms.length, 2)
  assert.deepEqual(Object.keys(pdos.atoms[0].orbitals), ['s', 'p', 'd'])
  assert.equal(pdos.atoms[0].energies.length, 3)
  assert.deepEqual(pdos.atoms[0].orbitals.s.up, [1, 1, 1])
})

test('pdosSummary：s 轨道在 [-5,0] 上积分 = 5（每个原子）→ 两原子 10', () => {
  const summary = pdosSummary(parseDoscarPdos(build()), { symbols: ['C'], counts: [2] })
  const s = summary.find((row) => row.orbital === 's')
  assert.ok(Math.abs(s.electrons - 10) < 1e-9)
  // 带中心：DOS 恒为 1 且只在 [-5,0] 有值 → 平均能量 -2.5
  assert.ok(Math.abs(s.center - -2.5) < 1e-9)
})

test('pdosSummary：p/d 轨道没有态 → 电子数 0、带中心为 null', () => {
  const summary = pdosSummary(parseDoscarPdos(build()), { symbols: ['C'], counts: [2] })
  const p = summary.find((row) => row.orbital === 'p')
  const d = summary.find((row) => row.orbital === 'd')
  assert.equal(p.electrons, 0)
  assert.equal(p.center, null)
  assert.equal(d.electrons, 0)
})

test('parseDoscarPdos：没有 PDOS 块时返回空列表', () => {
  const totalOnly = build().split('\n').slice(0, 9).join('\n')
  const pdos = parseDoscarPdos(totalOnly)
  assert.equal(pdos.atoms.length, 0)
})
test('parseDoscarPdos：ISPIN=2 的 6 列（E + s↑ s↓ p↑ p↓ d↑ d↓）识别为双自旋', () => {
  const lines = [
    '1 2 0 0',
    '0.1 0.1 0.1 0.9 0.1',
    '1e-4',
    'CAR',
    'fixture',
    '10.0 -5.0 2 0.0 1.0',
    '-5 0 0',
    '0 0 0',
  ]
  lines.push('', '10.0 -5.0 2 0.0 1.0')
  lines.push('-5 1.0 2.0 3.0 4.0 5.0 6.0')
  lines.push('0 1.2 2.2 3.2 4.2 5.2 6.2')
  const pdos = parseDoscarPdos(lines.join('\n'))
  assert.deepEqual(Object.keys(pdos.atoms[0].orbitals), ['s', 'p', 'd'])
  assert.deepEqual(pdos.atoms[0].orbitals.s.up, [1.0, 1.2])
  assert.deepEqual(pdos.atoms[0].orbitals.s.down, [2.0, 2.2])
  assert.deepEqual(pdos.atoms[0].orbitals.d.up, [5.0, 5.2])
  assert.deepEqual(pdos.atoms[0].orbitals.d.down, [6.0, 6.2])
})

test('parseDoscarPdos：ISPIN=1 的 5 列（s p d f）识别出 f 轨道', () => {
  const lines = [
    '1 1 0 0',
    '0.1 0.1 0.1 0.9 0.1',
    '1e-4',
    'CAR',
    'fixture',
    '10.0 -5.0 2 0.0 1.0',
    '-5 0 0',
    '0 0 0',
  ]
  lines.push('', '10.0 -5.0 2 0.0 1.0')
  lines.push('-5 1.0 2.0 3.0 4.0 5.0')
  lines.push('0 1.5 2.5 3.5 4.5 5.5')
  const pdos = parseDoscarPdos(lines.join('\n'))
  assert.deepEqual(Object.keys(pdos.atoms[0].orbitals), ['s', 'p', 'd', 'f'])
  assert.deepEqual(pdos.atoms[0].orbitals.f.up, [4.0, 4.5])
})

test('parseDoscarPdos：lm 分辨（9 列）把 p/d 分量各自求和', () => {
  const lines = [
    '1 1 1 0',
    '0.1 0.1 0.1 0.9 0.1',
    '1e-4',
    'CAR',
    'fixture',
    '5.0 -5.0 2 0.0 1.0',
    '-5 0 0',
    '0 0 0',
  ]
  lines.push('', '5.0 -5.0 2 0.0 1.0')
  // E s py pz px dxy dyz dz2 dxz dx2-y2
  lines.push('-5 1 2 3 4 5 6 7 8 9')
  lines.push('0 1.1 2.1 3.1 4.1 5.1 6.1 7.1 8.1 9.1')
  const pdos = parseDoscarPdos(lines.join('\n'))
  const orbitals = pdos.atoms[0].orbitals
  assert.deepEqual(Object.keys(orbitals), ['s', 'p', 'd'])
  assert.deepEqual(orbitals.s.up, [1, 1.1])
  assert.ok(Math.abs(orbitals.p.up[0] - 9) < 1e-9)   // 2+3+4
  assert.ok(Math.abs(orbitals.d.up[0] - 35) < 1e-9)  // 5+6+7+8+9
  assert.deepEqual(orbitals.s.down, [])
})

test('parseDoscarPdos：lm 分辨 + 双自旋（18 列）', () => {
  const lines = [
    '1 2 1 0',
    '0.1 0.1 0.1 0.9 0.1',
    '1e-4',
    'CAR',
    'fixture',
    '5.0 -5.0 2 0.0 1.0',
    '-5 0 0',
    '0 0 0',
  ]
  lines.push('', '5.0 -5.0 2 0.0 1.0')
  // s↑ s↓ p_y↑ p_y↓ p_z↑ p_z↓ p_x↑ p_x↓ d_xy↑ d_xy↓ d_yz↑ d_yz↓ d_z2↑ d_z2↓ d_xz↑ d_xz↓ d_x2↑ d_x2↓
  const row = (base) => Array.from({ length: 18 }, (_, i) => base + i)
  lines.push([-5, ...row(1)].join(' '))
  lines.push([0, ...row(2)].join(' '))
  const pdos = parseDoscarPdos(lines.join('\n'))
  const orbitals = pdos.atoms[0].orbitals
  assert.deepEqual(orbitals.s.up, [1, 2])
  assert.deepEqual(orbitals.s.down, [2, 3])
  assert.ok(Math.abs(orbitals.p.up[0] - (3 + 5 + 7)) < 1e-9)
  assert.ok(Math.abs(orbitals.p.down[0] - (4 + 6 + 8)) < 1e-9)
  assert.ok(Math.abs(orbitals.d.up[0] - (9 + 11 + 13 + 15 + 17)) < 1e-9)
})

test('parseDoscarPdos：头部 partial-DOS 标志位如实回报', () => {
  const withPartial = ['1 1 1 0', '0.1 0.1 0.1 0.9 0.1', '1e-4', 'CAR', 'x', '5.0 -5.0 2 0.0 1.0', '-5 0 0', '0 0 0'].join('\n')
  assert.equal(parseDoscarPdos(withPartial).hasPartial, true)
  const withoutPartial = ['1 1 0 0', '0.1 0.1 0.1 0.9 0.1', '1e-4', 'CAR', 'x', '5.0 -5.0 2 0.0 1.0', '-5 0 0', '0 0 0'].join('\n')
  const parsed = parseDoscarPdos(withoutPartial)
  assert.equal(parsed.hasPartial, false)
  assert.equal(parsed.atoms.length, 0)
})

