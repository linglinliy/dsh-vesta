/**
 * INCAR / POTCAR / KPOINTS 输入参数解析测试。
 *   node --test test/inputs.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseIncar, potcarEnmax, parseKpoints } from '../core.js'

test('parseIncar：基本键值、行内多标签、注释', () => {
  const incar = parseIncar([
    'SYSTEM = test # 注释',
    'ENCUT = 300',
    'ISMEAR = 0 ; SIGMA = 0.05',
    '! 整行注释',
    'LREAL = .FALSE.',
  ].join('\n'))
  assert.equal(incar.ENCUT, '300')
  assert.equal(incar.ISMEAR, '0')
  assert.equal(incar.SIGMA, '0.05')
  assert.equal(incar.LREAL, '.FALSE.')
  assert.equal(incar.SYSTEM, 'test')
})

test('potcarEnmax：多元素取最大 ENMAX、最小 ENMIN', () => {
  const text = [
    '   ENMAX  =  245.345; ENMIN  =  184.009 eV',
    '   ENMAX  =  400.000; ENMIN  =  300.000 eV',
  ].join('\n')
  const result = potcarEnmax(text)
  assert.equal(result.enmax, 400)
  assert.equal(result.enmin, 184.009)
})

test('parseKpoints：Gamma 自动网格', () => {
  const kpoints = parseKpoints(['comment', '0', 'Gamma', '25 25 1', '0 0 0'].join('\n'))
  assert.equal(kpoints.mode, 'gamma')
  assert.deepEqual(kpoints.mesh, [25, 25, 1])
  assert.equal(kpoints.total, 625)
})

test('parseKpoints：Monkhorst 自动网格', () => {
  const kpoints = parseKpoints(['auto', '0', 'Monkhorst-Pack', '9 9 9', '0 0 0'].join('\n'))
  assert.equal(kpoints.mode, 'monkhorst')
  assert.deepEqual(kpoints.mesh, [9, 9, 9])
  assert.equal(kpoints.total, 729)
})

test('parseKpoints：line-mode 没有网格', () => {
  const kpoints = parseKpoints(['band', '20', 'Line-mode', 'reciprocal', '0 0 0', '0.5 0 0'].join('\n'))
  assert.equal(kpoints.mode, 'line')
  assert.equal(kpoints.mesh, null)
  assert.equal(kpoints.total, null)
})
