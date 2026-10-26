/**
 * INCAR 差异对比脚本的端到端测试（临时目录 + 子进程）。
 *   node --test test/incar-diff.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SCRIPT = join(ROOT, 'scripts', 'make-incar-diff.mjs')

test('make-incar-diff：标出不同标签、忽略相同标签', () => {
  const root = mkdtempSync(join(tmpdir(), 'vesta-incar-'))
  for (const [name, incar] of Object.entries({
    taskA: 'ENCUT = 300\nSIGMA = 0.1\nISMEAR = 0',
    taskB: 'ENCUT = 520\nSIGMA = 0.1\nISMEAR = 0',
  })) {
    const dir = join(root, name)
    mkdirSync(dir)
    writeFileSync(join(dir, 'OUTCAR'), ' vasp.6.3.0 stub\n')
    writeFileSync(join(dir, 'INCAR'), incar)
  }

  const result = spawnSync(process.execPath, [SCRIPT, '--root', root, '--out', join(root, 'diff.html')], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const summary = JSON.parse(result.stdout)
  assert.equal(summary.tasks.length, 2)
  assert.ok(summary.differing.includes('ENCUT'))
  assert.ok(!summary.differing.includes('SIGMA'))
  assert.ok(existsSync(join(root, 'diff.html')))
})

test('make-incar-diff：没有 INCAR 时退出码非 0', () => {
  const root = mkdtempSync(join(tmpdir(), 'vesta-incar-'))
  const dir = join(root, 'taskA')
  mkdirSync(dir)
  writeFileSync(join(dir, 'OUTCAR'), 'stub\n')
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
})
