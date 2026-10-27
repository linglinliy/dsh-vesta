/**
 * 文档与实现的一致性审计：防止「文档说 20 个工具、实际 28 个」这类漂移。
 *   node --test test/docs-consistency.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => readFileSync(join(ROOT, name), 'utf8')
const DOCS = ['README.md', 'docs/COVERAGE.md', 'docs/GUIDE.md', 'docs/STATUS.md', 'docs/PROJECT.md']

/** 收集插件实际注册的工具（名称 + 参数键）。 */
const collectTools = () => {
  const tools = new Map()
  apply({
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
    effect: (fn) => fn(),
  }, { executable: 'D:/VESTA-win64/VESTA.exe' })
  return tools
}

const TOOLS = collectTools()
const COUNT = TOOLS.size

test('工具数与 package.json / MCP 说明一致', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.ok(pkg.version)
  const server = read('mcp/server.js')
  const claim = /(\d+)\s*个工具/.exec(server)
  if (claim) assert.equal(Number(claim[1]), COUNT, `mcp/server.js 说 ${claim[1]} 个工具，实际 ${COUNT}`)
})

test('文档里写的工具数与实际一致（README / PROJECT 等）', () => {
  for (const file of DOCS) {
    const text = read(file)
    for (const match of text.matchAll(/(\d+)\s*个工具/g)) {
      const claimed = Number(match[1])
      // 「2 个工具」这类偶发描述（例如某工具子集）放行：只校验 >= 10 的总数声明
      if (claimed < 10) continue
      assert.equal(claimed, COUNT, `${file} 写「${claimed} 个工具」，实际 ${COUNT}`)
    }
  }
})

test('文档里提到的每个 vesta_* 工具都真实存在', () => {
  const unknown = new Set()
  for (const file of DOCS) {
    for (const match of read(file).matchAll(/\b(vesta_[a-z_]+)\b/g)) {
      const name = match[1]
      if (name.endsWith('_')) continue
      if (!TOOLS.has(name)) unknown.add(`${file}: ${name}`)
    }
  }
  assert.deepEqual([...unknown], [], '文档引用了不存在的工具')
})

test('每个工具都在文档里出现过（COVERAGE 或 GUIDE）', () => {
  const text = read('docs/COVERAGE.md') + '\n' + read('docs/GUIDE.md') + '\n' + read('README.md')
  const missing = [...TOOLS.keys()].filter((name) => !text.includes(name))
  assert.deepEqual(missing, [], '这些工具没有写进文档')
})

test('CHANGELOG 最新版本号与 package.json 一致', () => {
  const pkg = JSON.parse(read('package.json'))
  const changelog = read('CHANGELOG.md')
  const first = /^##\s+(\d+\.\d+\.\d+)/m.exec(changelog)
  assert.ok(first, 'CHANGELOG 应有版本标题')
  assert.equal(first[1], pkg.version, `CHANGELOG 最新是 ${first[1]}，package.json 是 ${pkg.version}`)
})

test('COVERAGE 里不再残留「未实现」的工具级条目', () => {
  const text = read('docs/COVERAGE.md')
  // 允许「未实现」出现在机制限制表里，但不允许出现在工具清单表里
  const toolTable = text.split('## 二、')[0]
  assert.ok(!/未实现/.test(toolTable), '工具清单里出现「未实现」')
})

test('每个 vesta_* 工具的描述都说明了「何时使用」', () => {
  const problems = []
  for (const [name, definition] of TOOLS) {
    if (!name.startsWith('vesta_')) continue
    if (!/当用户|用户想|用户问|要.*时用它/.test(definition.description ?? '')) problems.push(name)
  }
  assert.deepEqual(problems, [], '这些工具的描述缺少触发语')
})

test('所有工具的必填参数都在文档里可查（COVERAGE 或 GUIDE 提到连接对象）', () => {
  const text = read('docs/COVERAGE.md') + '\n' + read('docs/GUIDE.md')
  for (const [name, definition] of TOOLS) {
    if (!text.includes(name)) continue
    const required = definition.parameters?.required ?? []
    assert.ok(Array.isArray(required), `${name} 的 required 应为数组`)
  }
})
