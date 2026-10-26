/**
 * POTCAR ZVAL 解析与 NELECT 自洽检查测试。
 *   node --test test/zval.test.mjs
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectTask, potcarZval } from '../core.js'

const POTCAR = [
  '  PAW_PBE Si 05Jan2001',
  '   ZVAL   =   4.000   mass and valence configuration',
  '   ENMAX  =  245.345; ENMIN  =  184.009 eV',
  '  PAW_PBE C 08Apr2002',
  '   ZVAL   =   4.000   mass and valence configuration',
  '   ENMAX  =  400.000; ENMIN  =  300.000 eV',
].join('\n')

test('potcarZval：按物种顺序读出 ZVAL', () => {
  const result = potcarZval(POTCAR)
  assert.deepEqual(result.values, [4, 4])
  assert.equal(result.total, 8)
})

test('potcarZval：没有 ZVAL 行时返回空数组', () => {
  assert.deepEqual(potcarZval('nothing here'), { values: [], total: 0 })
})

const OUTCAR = [
  ' vasp.6.3.0',
  '   ENCUT = 300',
  '   ISPIN  =      1    spin polarized calculation?',
  '   NELECT =       8.0000    total number of electrons',
  ' k-points           NKPTS =     35   k-points in BZ     NKDIM =     35   number of bands    NBANDS=      8',
  ' E-fermi :   5.7730',
  '  free  energy   TOTEN  =        -10.83910310 eV',
  '  energy  without entropy=      -10.83910310  energy(sigma->0) =      -10.83910310',
  ' ------------------------ aborting loop because EDIFF is reached ------------------------',
  ' General timing and accounting informations for this job:',
].join('\n')

const POSCAR = ['Si', '5.5', '0 0.5 0.5', '0.5 0 0.5', '0.5 0.5 0', 'Si', '2', 'Direct', '0 0 0', '0.25 0.25 0.25'].join('\n')

test('inspectTask：ZVAL 之和与 NELECT 一致时该项通过', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vesta-zval-'))
  writeFileSync(join(dir, 'OUTCAR'), OUTCAR)
  writeFileSync(join(dir, 'POSCAR'), POSCAR)
  writeFileSync(join(dir, 'POTCAR'), POTCAR.split('  PAW_PBE C 08Apr2002')[0])
  const report = await inspectTask(dir)
  const check = report.checks.find((item) => item.name === 'POTCAR ZVAL ↔ NELECT')
  assert.ok(check, '应该有 ZVAL 检查项')
  assert.equal(check.ok, true)
  assert.match(check.detail, /Si:4/)
  assert.match(check.detail, /8 e/)
})

test('inspectTask：ZVAL 与 NELECT 不符时该项失败', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vesta-zval-'))
  writeFileSync(join(dir, 'OUTCAR'), OUTCAR.replace('NELECT =       8.0000', 'NELECT =      12.0000'))
  writeFileSync(join(dir, 'POSCAR'), POSCAR)
  writeFileSync(join(dir, 'POTCAR'), POTCAR.split('  PAW_PBE C 08Apr2002')[0])
  const report = await inspectTask(dir)
  const check = report.checks.find((item) => item.name === 'POTCAR ZVAL ↔ NELECT')
  assert.ok(check)
  assert.equal(check.ok, false)
})
