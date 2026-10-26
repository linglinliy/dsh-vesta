/**
 * OUTCAR 体检与交叉核对测试。
 *   node --test test/outcar.test.mjs
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseOutcar, inspectTask, scanTasks } from '../core.js'

/** 两段电子步能量 + 一个力块 + 收尾段，用来验证「取最后一次」。 */
const OUTCAR = [
  ' vasp.6.3.0 27Jun23 (build Aug 01 2023 18:31:00) complex',
  '   ENCUT = 300',
  '   ISPIN  =      1    spin polarized calculation?',
  '   NELECT =       8.0000    total number of electrons',
  ' k-points           NKPTS =     35   k-points in BZ     NKDIM =     35   number of bands    NBANDS=      8',
  ' E-fermi :   5.7730     XC(G=0):  -9.2607     alpha+bet :-11.5327',
  '  free  energy   TOTEN  =        -10.50000000 eV',
  '  energy  without entropy=      -10.50000000  energy(sigma->0) =      -10.50000000',
  '  free  energy   TOTEN  =        -10.83910310 eV',
  '  energy  without entropy=      -10.83910310  energy(sigma->0) =      -10.83910310',
  ' POSITION                                       TOTAL-FORCE (eV/Angst)',
  ' -----------------------------------------------------------------------------------',
  '      0.00000      0.00000      0.00000         0.010000      0.020000      0.030000',
  '      1.37500      1.37500      1.37500         0.000000      0.000000      0.000000',
  ' -----------------------------------------------------------------------------------',
  '    total drift:                                0.010000      0.020000      0.030000',
  ' ------------------------ aborting loop because EDIFF is reached ----------------------------------------',
  ' General timing and accounting informations for this job:',
  '                  Total CPU time used (sec):        7.006',
].join('\n')

test('parseOutcar：能量取最后一次（最终值）', () => {
  const outcar = parseOutcar(OUTCAR)
  assert.equal(outcar.sigma0, -10.8391031)
  assert.equal(outcar.toten, -10.8391031)
})

test('parseOutcar：头部字段与收尾', () => {
  const outcar = parseOutcar(OUTCAR)
  assert.equal(outcar.encut, 300)
  assert.equal(outcar.ispin, 1)
  assert.equal(outcar.nelect, 8)
  assert.equal(outcar.nbands, 8)
  assert.equal(outcar.nkpts, 35)
  assert.equal(outcar.efermi, 5.773)
  assert.equal(outcar.convergedScf, true)
  assert.equal(outcar.finished, true)
  assert.equal(outcar.cpuSeconds, 7.006)
  assert.deepEqual(outcar.warnings, [])
})

test('parseOutcar：最大力取最后一个力块', () => {
  const outcar = parseOutcar(OUTCAR)
  assert.ok(Math.abs(outcar.maxForce - Math.hypot(0.01, 0.02, 0.03)) < 1e-9)
})

test('parseOutcar：识别常见告警', () => {
  const outcar = parseOutcar(`${OUTCAR}\n  TOO FEW BANDS`)
  assert.ok(outcar.warnings.some((text) => text.includes('NBANDS')))
})

test('parseOutcar：应力张量与平均力', () => {
  const outcar = parseOutcar(`${OUTCAR}\n  in kB   -15.75936   -15.75936   -15.75936     0.00000     0.00000    -0.00000`)
  assert.equal(outcar.stress.xx, -15.75936)
  assert.equal(outcar.stress.xy, 0)
  assert.equal(outcar.forceCount, 2)
  assert.ok(Math.abs(outcar.meanForce - Math.hypot(0.01, 0.02, 0.03) / 2) < 1e-9)
})

test('parseOutcar：没有应力行时 stress 为 null', () => {
  assert.equal(parseOutcar(OUTCAR).stress, null)
})

test('inspectTask：OUTCAR 与 OSZICAR 交叉核对', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vesta-task-'))
  writeFileSync(join(dir, 'OUTCAR'), OUTCAR)
  writeFileSync(join(dir, 'OSZICAR'), '   1 F= -.10839103E+02 E0= -.10839103E+02')
  const report = await inspectTask(dir)
  const energyCheck = report.checks.find((item) => item.name.includes('OSZICAR'))
  assert.ok(energyCheck)
  assert.equal(energyCheck.ok, true)
})

test('inspectTask：应力项附带静水压换算（1 kBar = 0.1 GPa）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vesta-task-'))
  // σ = (−15.76, −15.76, −15.76) → P = +1.58 GPa
  writeFileSync(join(dir, 'OUTCAR'), `${OUTCAR}\n  in kB   -15.75936   -15.75936   -15.75936     0.00000     0.00000    -0.00000`)
  const report = await inspectTask(dir)
  const check = report.checks.find((item) => item.name === '应力张量')
  assert.ok(check)
  assert.match(check.detail, /静水压 1\.58 GPa/)
})

test('inspectTask：应力与平均力进入检查项', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vesta-task-'))
  writeFileSync(join(dir, 'OUTCAR'), `${OUTCAR}\n  in kB   -10.0   -10.0   -10.0   0.0   0.0   0.0`)
  const report = await inspectTask(dir)
  const stress = report.checks.find((item) => item.name === '应力张量')
  const mean = report.checks.find((item) => item.name === '平均力')
  assert.ok(stress)
  assert.match(stress.detail, /-10\.00/)
  assert.ok(mean)
  assert.match(mean.detail, /eV/)
})

test('inspectTask：缺 OUTCAR 时报错', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vesta-task-'))
  await assert.rejects(() => inspectTask(dir), /没有 OUTCAR/)
})

test('scanTasks：批量找出任务并标出有告警的那个', async () => {
  const root = mkdtempSync(join(tmpdir(), 'vesta-scan-'))
  const good = join(root, 'taskA')
  const bad = join(root, 'taskB')
  const empty = join(root, 'empty')
  mkdirSync(good)
  mkdirSync(bad)
  mkdirSync(empty)
  writeFileSync(join(good, 'OUTCAR'), OUTCAR)
  writeFileSync(join(bad, 'OUTCAR'), `${OUTCAR}\n  TOO FEW BANDS`)
  const scan = await scanTasks(root)
  assert.equal(scan.scanned, 2)
  const a = scan.tasks.find((task) => task.name === 'taskA')
  const b = scan.tasks.find((task) => task.name === 'taskB')
  assert.equal(a.ok, true)
  assert.equal(b.ok, false)
  assert.ok(b.failed.some((item) => item.includes('告警')))
})
