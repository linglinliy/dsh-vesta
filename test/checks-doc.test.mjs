/**
 * 文档防漂移：docs/CHECKS.md 必须覆盖 inspectTask 里出现的每个检查项名称。
 *   node --test test/checks-doc.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CORE = join(ROOT, 'core.js')
const DOC = join(ROOT, 'docs', 'CHECKS.md')

/** 从 inspectTask 函数体里抽出 checks.push({ name: '…' }) 的名称。 */
const checkNames = () => {
  const text = readFileSync(CORE, 'utf8')
  const start = text.indexOf('export async function inspectTask')
  const end = text.indexOf('\n}\n', start)
  assert.ok(start > 0 && end > start, '找不到 inspectTask')
  const body = text.slice(start, end)
  return [...new Set([...body.matchAll(/name:\s*'([^']+)'/g)].map((match) => match[1]))]
}

test('CHECKS.md 覆盖全部检查项', () => {
  const names = checkNames()
  assert.ok(names.length >= 10, `检查项太少：${names.length}`)
  const doc = readFileSync(DOC, 'utf8')
  const missing = names.filter((name) => !doc.includes(name))
  assert.deepEqual(missing, [], `文档缺这些检查项：${missing.join('、')}`)
})

test('CHECKS.md 里写到的检查项都还在代码里', () => {
  const names = new Set(checkNames())
  const doc = readFileSync(DOC, 'utf8')
  // 只扫「检查项表」的行：4 列（检查项 | 数据来源 | 判据 | 失败含义）。
  // 汇总统计表是 2 列，不应被当成检查项。
  const documented = doc
    .split(/\r?\n/)
    .filter((line) => (line.match(/\|/g) ?? []).length >= 5)
    .map((line) => line.split('|')[1]?.trim())
    .filter((name) => name && name !== '检查项' && !/^-+$/.test(name))
  const stale = documented.filter((name) => !names.has(name))
  assert.deepEqual(stale, [], `文档里这些检查项已不存在：${stale.join('、')}`)
})
