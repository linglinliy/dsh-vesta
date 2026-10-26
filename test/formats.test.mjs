/**
 * 按官方文档校验 KPOINTS line-mode 与 POSCAR 缩放规则。
 *   node --test test/formats.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseKpoints, parsePoscar, kpointsToFractional } from '../core.js'

const LINE_MODE = [
  'k points along high symmetry lines',
  ' 40',
  'line mode',
  'fractional',
  '  0    0    0    Gamma',
  '  0.5  0.5  0    X',
  '',
  '  0.5  0.5  0    X',
  '  0.5  0.75 0.25 W',
  '',
  '  0.5  0.75 0.25 W',
  '  0    0    0    Gamma',
].join('\n')

test('parseKpoints：line-mode 读成 3 段并带高对称点标签', () => {
  const kpoints = parseKpoints(LINE_MODE)
  assert.equal(kpoints.mode, 'line')
  assert.equal(kpoints.pointsPerSegment, 40)
  assert.equal(kpoints.coordinate, 'fractional')
  assert.equal(kpoints.segments.length, 3)
  assert.equal(kpoints.segments[0].from.label, 'Gamma')
  assert.equal(kpoints.segments[0].to.label, 'X')
  assert.deepEqual(kpoints.segments[1].to.k, [0.5, 0.75, 0.25])
  assert.equal(kpoints.segments[2].to.label, 'Gamma')
})

test('parseKpoints：line-mode 的 Cartesian 坐标系被识别', () => {
  const cartesian = LINE_MODE.replace('fractional', 'Cartesian')
  assert.equal(parseKpoints(cartesian).coordinate, 'cartesian')
})

test('parseKpoints：常规网格仍然返回 mesh', () => {
  const kpoints = parseKpoints(['auto', '0', 'Gamma', '4 4 4', '0 0 0'].join('\n'))
  assert.equal(kpoints.mode, 'gamma')
  assert.deepEqual(kpoints.mesh, [4, 4, 4])
})

const poscar = ({ scaleLine, cell, mode, coords }) => [
  'test',
  scaleLine,
  ...cell,
  'C',
  String(coords.length),
  mode,
  ...coords,
].join('\n')

test('parsePoscar：三个分轴缩放因子', () => {
  const structure = parsePoscar(poscar({
    scaleLine: '2 1 1',
    cell: ['1 0 0', '0 1 0', '0 0 1'],
    mode: 'Direct',
    coords: ['0 0 0'],
  }))
  assert.deepEqual(structure.a1, [2, 0, 0])
  assert.deepEqual(structure.a2, [0, 1, 0])
  assert.deepEqual(structure.a3, [0, 0, 1])
})

test('parsePoscar：负缩放因子按目标体积换算', () => {
  const structure = parsePoscar(poscar({
    scaleLine: '-8',
    cell: ['1 0 0', '0 1 0', '0 0 1'],
    mode: 'Direct',
    coords: ['0 0 0'],
  }))
  assert.deepEqual(structure.a1, [2, 0, 0])
  assert.deepEqual(structure.a3, [0, 0, 2])
})

test('parsePoscar：Cartesian 坐标乘缩放因子', () => {
  const structure = parsePoscar(poscar({
    scaleLine: '2',
    cell: ['1 0 0', '0 1 0', '0 0 1'],
    mode: 'Cartesian',
    coords: ['1 0 0'],
  }))
  // R = 2 × (1,0,0) = (2,0,0)，晶胞 a1 = (2,0,0) → 分数坐标 (1,0,0)
  assert.deepEqual(structure.atoms[0].frac, [1, 0, 0])
})

test('kpointsToFractional：fractional 端点原样返回，共享端点保留', () => {
  const kpoints = parseKpoints(LINE_MODE)
  const points = kpointsToFractional(kpoints, { a1: [1, 0, 0], a2: [0, 1, 0], a3: [0, 0, 1], scale: [1, 1, 1] })
  assert.equal(points.length, 6)
  assert.deepEqual(points[0].k, [0, 0, 0])
  assert.equal(points[0].label, 'Gamma')
  assert.deepEqual(points[1].k, [0.5, 0.5, 0])
})

test('kpointsToFractional：Cartesian 按 2π/a 约定换算（s=1 单位胞）', () => {
  const cartesian = ['k', '10', 'line mode', 'Cartesian', '0 0 0 Gamma', '0 0 1 X'].join('\n')
  const kpoints = parseKpoints(cartesian)
  const points = kpointsToFractional(kpoints, { a1: [1, 0, 0], a2: [0, 1, 0], a3: [0, 0, 1], scale: [1, 1, 1] })
  // a=1 时 (0,0,1) 就是 b3，分数坐标应为 (0,0,1)
  assert.deepEqual(points[1].k, [0, 0, 1])
})

test('kpointsToFractional：缩放因子 ≠ 1 时不再多除一次 s', () => {
  const cartesian = ['k', '10', 'line mode', 'Cartesian', '0 0 0 Gamma', '0 0 1 X'].join('\n')
  const kpoints = parseKpoints(cartesian)
  // 晶胞被缩放到 2 倍，raw = 单位胞；x_i = K·a_raw = (0,0,1)
  const points = kpointsToFractional(kpoints, { a1: [2, 0, 0], a2: [0, 2, 0], a3: [0, 0, 2], scale: [2, 2, 2] })
  assert.deepEqual(points[1].k, [0, 0, 1])
})

