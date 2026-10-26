/**
 * 真实数据驱动的检查项：空 DOSCAR、截断 EIGENVAL、被缩放的 DOSCAR、NBANDS 相对判据。
 *   node --test test/inspect-realdata.test.mjs
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectTask, summarizeTask } from '../core.js'

const OUTCAR = [
  ' vasp.6.3.0',
  '   ENCUT = 520',
  '   ISPIN  =      2    spin polarized calculation?',
  '   NELECT =       8.0000    total number of electrons',
  ' k-points           NKPTS =      3   k-points in BZ     NKDIM =      3   number of bands    NBANDS=      6',
  ' E-fermi :   0.0000',
  '  free  energy   TOTEN  =        -10.00000000 eV',
  '  energy  without entropy=      -10.00000000  energy(sigma->0) =      -10.00000000',
  ' POSITION                                       TOTAL-FORCE (eV/Angst)',
  ' -----------------------------------------------------------------------------------',
  '      0.00000      0.00000      0.00000         0.000000      0.000000      0.000000',
  ' -----------------------------------------------------------------------------------',
  ' ------------------------ aborting loop because EDIFF is reached ------------------------',
  ' General timing and accounting informations for this job:',
  '                  Total CPU time used (sec):        1.000',
].join('\n')

const POSCAR = ['x', '5', '0 0.5 0.5', '0.5 0 0.5', '0.5 0.5 0', 'Si', '2', 'Direct', '0 0 0', '0.25 0.25 0.25'].join('\n')

/** 手写一个 ISPIN=2、带积分列、整体缩放 factor 倍的 DOSCAR。 */
const makeDoscar = ({ nedos = 11, factor = 1, spin = true } = {}) => {
  const lines = ['  2  2   0   0', '  1.0 0.0 0.0 0.0 0.0', '  1.0E-4', 'CAR', ' test', `  5.000   -5.000  ${nedos}   0.000   1.0`]
  const step = 10 / (nedos - 1)
  for (let index = 0; index < nedos; index += 1) {
    const energy = -5 + index * step
    const dos = (energy > -1 && energy < 1 ? 1 : 0) * factor
    const integrated = (Math.min(Math.max((energy + 1) / 2, 0), 1)) * factor
    lines.push(spin ? `  ${energy.toFixed(3)}  ${dos.toFixed(6)}  ${dos.toFixed(6)}  ${integrated.toFixed(6)}  ${integrated.toFixed(6)}`
      : `  ${energy.toFixed(3)}  ${dos.toFixed(6)}  ${integrated.toFixed(6)}`)
  }
  return lines.join('\n')
}

const makeTask = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'vesta-real-'))
  writeFileSync(join(dir, 'OUTCAR'), OUTCAR)
  writeFileSync(join(dir, 'POSCAR'), POSCAR)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return dir
}

test('空 DOSCAR：降级为「DOSCAR 可用性」告警，不再抛错', async () => {
  const dir = makeTask({ DOSCAR: '  2  2   0   0\n' })
  const report = await inspectTask(dir)
  const check = report.checks.find((item) => item.name === 'DOSCAR 可用性')
  assert.ok(check, '应有 DOSCAR 可用性检查项')
  assert.equal(check.ok, false)
  assert.match(check.detail, /字节/)
  assert.equal(report.doscar, null)
})

test('截断 EIGENVAL：降级为「EIGENVAL 可用性」告警，其余检查继续', async () => {
  const dir = makeTask({ EIGENVAL: '  2  2  2  3\n  0.1 0.2 0.3 0.5\n' })
  const report = await inspectTask(dir)
  const check = report.checks.find((item) => item.name === 'EIGENVAL 可用性')
  assert.ok(check, '应有 EIGENVAL 可用性检查项')
  assert.equal(check.ok, false)
  assert.ok(report.checks.length >= 5, '其余检查不应被中断')
  assert.equal(report.eigenval, null)
})

test('被缩放的 DOSCAR：诊断出「与文件自带积分列一致但与 NELECT 差 N 倍」', async () => {
  // factor=0.01：积分远小于 NELECT，但与我们自己的梯形积分一致
  const dir = makeTask({ DOSCAR: makeDoscar({ factor: 0.01 }) })
  const report = await inspectTask(dir)
  const check = report.checks.find((item) => item.name === 'DOSCAR 被缩放（非原始输出）')
  assert.ok(check, '被缩放的 DOSCAR 应单列一项')
  assert.equal(check.ok, false)
  assert.match(check.detail, /文件自带积分列/)
  assert.match(check.detail, /NELECT/)
  // 这一项不应被当成「关键不一致」
  const summary = summarizeTask(report)
  assert.deepEqual(summary.critical, [])
  // 带隙一致性在 DOS 被缩放时应跳过
  const gapCheck = report.checks.find((item) => item.name.includes('带隙一致性'))
  if (gapCheck) assert.match(gapCheck.detail, /跳过|DOS/)
})

test('NBANDS 下限：改用「占据带 × 1.15」的相对判据', async () => {
  const dir = makeTask({})
  const report = await inspectTask(dir)
  const check = report.checks.find((item) => item.name === 'NBANDS 下限')
  assert.ok(check)
  // NELECT 8 → 占据带 4 → 建议 ≥ 5；实际 NBANDS 6 → 通过
  assert.match(check.detail, /1\.15 倍/)
  assert.equal(check.ok, true)
})
