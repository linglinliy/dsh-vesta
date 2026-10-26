/**
 * scanTasks 的 marker 选项：只有输入文件的目录也能被识别为任务。
 *   node --test test/scantasks-marker.test.mjs
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'
import { scanTasks } from '../core.js'

const makeTree = () => {
  const root = mkdtempSync(join(tmpdir(), 'vesta-marker-'))
  for (const name of ['taskA', 'taskB']) {
    const dir = join(root, name)
    mkdirSync(dir)
    writeFileSync(join(dir, 'INCAR'), 'ENCUT = 520\nISPIN = 2\n')
    writeFileSync(join(dir, 'POSCAR'), ['x', '1', '1 0 0', '0 1 0', '0 0 1', 'H', '1', 'Direct', '0 0 0'].join('\n'))
  }
  mkdirSync(join(root, 'notATask'))
  return root
}

test('scanTasks：默认以 OUTCAR 识别，只有 INCAR 时扫不到任务', async () => {
  const root = makeTree()
  const scan = await scanTasks(root)
  assert.equal(scan.scanned, 0)
})

test('scanTasks：marker=INCAR 时能识别未跑过的任务目录', async () => {
  const root = makeTree()
  const scan = await scanTasks(root, { marker: 'INCAR' })
  assert.equal(scan.scanned, 2)
  assert.deepEqual(scan.tasks.map((task) => task.name).sort(), ['taskA', 'taskB'])
})

test('scanTasks：marker 也支持 OUTCAR 这种带后缀的文件名', async () => {
  const root = makeTree()
  writeFileSync(join(root, 'taskA', 'OUTCAR.gz'), '')
  const scan = await scanTasks(root, { marker: 'OUTCAR' })
  assert.equal(scan.scanned, 1)
  assert.equal(scan.tasks[0].name, 'taskA')
})
