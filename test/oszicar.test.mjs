/**
 * OSZICAR 收敛序列解析测试。
 *   node --test test/oszicar.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOszicar } from '../core.js'

const OSZICAR = [
  'DAV:   1   0.3106689E+01  -0.12345E+01  -0.10000E-01  1000  0.500E-01  0.900E-02',
  'DAV:   2  -0.1000000E+02  -0.40000E-01  -0.20000E-03  1200  0.300E-02  0.700E-04',
  'DAV:   3  -0.1083910E+02  -0.86040E-05  -0.33750E-08  1400  0.938E-06',
  '   1 F= -.10839103E+02 E0= -.10839103E+02  d E =-.140562E-15  mag=     0.0000',
].join('\n')

test('parseOszicar：电子步行与离子步汇总', () => {
  const parsed = parseOszicar(OSZICAR)
  assert.equal(parsed.steps.length, 3)
  assert.equal(parsed.ions.length, 1)
  assert.equal(parsed.steps[0].iter, 1)
  assert.ok(Math.abs(parsed.steps[2].energy - -10.8391) < 1e-6)
  assert.ok(Math.abs(parsed.steps[2].dE - -8.604e-6) < 1e-9)
  assert.ok(Math.abs(parsed.ions[0].energy - -10.839103) < 1e-6)
})

test('parseOszicar：RMM 行也能识别', () => {
  const parsed = parseOszicar('RMM:   1   -0.5000000E+01  -0.10000E+00  -0.10000E-02  500  0.100E-01')
  assert.equal(parsed.steps.length, 1)
  assert.equal(parsed.steps[0].energy, -5)
})

test('parseOszicar：没有可识别行时报错', () => {
  assert.throws(() => parseOszicar('hello\nworld'), /没有找到/)
})
