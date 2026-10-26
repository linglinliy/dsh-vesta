/**
 * 命令行错误处理：输入文件不存在时应给出一行中文提示 + 退出码 2（而不是 Node 堆栈）。
 *   node --test test/cli-errors.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SCRIPTS = join(ROOT, 'scripts')
const MISSING = 'Z:/definitely/missing/file'

const run = (script) => spawnSync(process.execPath, [join(SCRIPTS, script), MISSING], { encoding: 'utf8' })

const cases = ['make-dos.mjs', 'make-bands.mjs', 'make-conv.mjs', 'make-trajectory.mjs']

for (const script of cases) {
  test(`${script}：输入不存在时给出中文提示且不打印堆栈`, () => {
    const result = run(script)
    const output = `${result.stdout}\n${result.stderr}`
    assert.equal(result.status, 2)
    assert.match(output, /找不到文件/)
    assert.ok(!/\n\s+at /.test(output), '不应包含堆栈')
  })
}
