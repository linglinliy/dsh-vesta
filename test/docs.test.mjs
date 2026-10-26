/**
 * 校验 docs/GUIDE.md 里提到的每个 scripts/*.mjs 都真实存在（防止文档漂移）。
 *   node --test test/docs.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

test('GUIDE.md 里引用的脚本都存在', () => {
  const guide = readFileSync(`${ROOT}/docs/GUIDE.md`, 'utf8')
  const scripts = readdirSync(`${ROOT}/scripts`).filter((name) => name.endsWith('.mjs'))
  const mentioned = [...guide.matchAll(/([A-Za-z0-9_-]+\.mjs)/g)].map((match) => match[1])
  const unique = [...new Set(mentioned)]
  assert.ok(unique.length >= 8, `提到的脚本太少：${unique.length}`)
  for (const name of unique) {
    assert.ok(existsSync(`${ROOT}/scripts/${name}`), `GUIDE 提到但不存在：${name}`)
  }
})

test('GUIDE.md 覆盖了所有对外脚本', () => {
  const guide = readFileSync(`${ROOT}/docs/GUIDE.md`, 'utf8')
  const publicScripts = readdirSync(`${ROOT}/scripts`)
    .filter((name) => name.endsWith('.mjs'))
    .filter((name) => !name.startsWith('_') && name !== 'selfcheck.mjs')
  const missing = publicScripts.filter((name) => !guide.includes(name))
  assert.deepEqual(missing, [], `GUIDE 漏掉的脚本：${missing.join(', ')}`)
})

test('README 与 GUIDE 都提到 selfcheck', () => {
  for (const file of ['README.md', 'docs/GUIDE.md']) {
    const text = readFileSync(`${ROOT}/${file}`, 'utf8')
    assert.ok(text.includes('selfcheck'), `${file} 没有提到 selfcheck`)
  }
})
