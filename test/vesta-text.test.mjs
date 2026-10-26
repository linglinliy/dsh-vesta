/**
 * VESTA 文本摘要解析 与 晶胞参数换算 的单元测试。
 *   node --test test/vesta-text.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { cellParameters, parseVestaStructureText } from '../core.js'

const SUMMARY = [
  'Si-fcc',
  'Space Group: P 1  (#1-1)',
  'a =  3.88909 Å      α = 60.0000°',
  'b =  3.88909 Å      β = 60.0000°',
  'c =  3.88909 Å      γ = 60.0000°',
  'V = 41.5937 Å^3',
].join('\n')

test('parseVestaStructureText：读出空间群、六个参数与体积', () => {
  const parsed = parseVestaStructureText(SUMMARY)
  assert.equal(parsed.comment, 'Si-fcc')
  assert.equal(parsed.spaceGroup, 'P 1')
  assert.equal(parsed.spaceGroupNumber, '1-1')
  assert.equal(parsed.a, 3.88909)
  assert.equal(parsed.alpha, 60)
  assert.equal(parsed.volume, 41.5937)
})

test('parseVestaStructureText：格式不符时返回 null', () => {
  assert.equal(parseVestaStructureText('hello world'), null)
  assert.equal(parseVestaStructureText(''), null)
})

test('cellParameters：立方胞', () => {
  const params = cellParameters([[2, 0, 0], [0, 2, 0], [0, 0, 2]])
  assert.equal(params.a, 2)
  assert.equal(params.volume, 8)
  assert.ok(Math.abs(params.alpha - 90) < 1e-9)
})

test('cellParameters：fcc 原胞（60°）与体积', () => {
  // 5.5/POSCAR：scale 5.5 × (0,0.5,0.5) 等
  const params = cellParameters([[0, 2.75, 2.75], [2.75, 0, 2.75], [2.75, 2.75, 0]])
  assert.ok(Math.abs(params.a - 2.75 * Math.SQRT2) < 1e-9)
  assert.ok(Math.abs(params.alpha - 60) < 1e-9)
  assert.ok(Math.abs(params.volume - 41.59375) < 1e-6)
})
test('parseVestaStructureText：兼容 -open 完整报告的表格格式', () => {
  const report = [
    'Title               Si-fcc',
    '',
    'Lattice type        P',
    'Space group name    P 1',
    'Space group number  1',
    '',
    'Lattice parameters',
    '',
    '   a        b        c       alpha    beta     gamma',
    ' 3.88909  3.88909  3.88909  60.0000  60.0000  60.0000',
    '',
    'Unit-cell volume = 41.593747 Å^3',
  ].join('\n')
  const parsed = parseVestaStructureText(report)
  assert.equal(parsed.comment, 'Si-fcc')
  assert.equal(parsed.spaceGroup, 'P 1')
  assert.equal(parsed.spaceGroupNumber, '1')
  assert.equal(parsed.a, 3.88909)
  assert.equal(parsed.gamma, 60)
  assert.ok(Math.abs(parsed.volume - 41.593747) < 1e-9)
})
