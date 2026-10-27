/**
 * 工具参数自检：execute 实际读取的参数必须都在 parameters 里声明过。
 *
 * 背景：0.0.16 给 `vesta_render` 加了 background/model，执行体一直在读 `args.background`，
 * 但参数 schema 里没有它们——schema 是 additionalProperties: false，真调用时会被判成
 * 「不认识的参数」直接拒掉。这种「代码读、schema 没声明」的回归，文档审计和普通单元测试都抓不到。
 *
 * 做法：拿到工具的真实 execute 源码（由 localTool 暴露 executeSource），
 * 从函数签名（解构参数 `({ path, out })` 或 `(args, exec)`）与成员访问（`args.xxx`）里
 * 收集「实际读到的参数名」，再与 schema 的 properties 比对。
 *   node --test test/tool-params.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'

const TOOLS = (() => {
  const tools = new Map()
  apply({
    tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
    effect: (fn) => fn(),
  }, { executable: 'D:/VESTA-win64/VESTA.exe' })
  return tools
})()

const sourceOf = (definition) => definition.executeSource ?? definition.execute?.toString() ?? ''

/** 取函数签名里的第一个参数（对象解构或普通名字）。 */
const firstParam = (source) => {
  const start = source.indexOf('(')
  if (start < 0) return { destructured: [], names: [] }
  let depth = 0
  let end = -1
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if ('{[(<'.includes(char)) depth += 1
    if ('}])>'.includes(char)) {
      depth -= 1
      if (depth === 0 && char === ')') { end = index; break }
    }
  }
  const signature = source.slice(start + 1, end < 0 ? undefined : end)
  let depth2 = 0
  let cut = signature.length
  for (let index = 0; index < signature.length; index += 1) {
    const char = signature[index]
    if ('{[(<'.includes(char)) depth2 += 1
    if ('}])>'.includes(char)) depth2 -= 1
    if (char === ',' && depth2 === 0) { cut = index; break }
  }
  const first = signature.slice(0, cut).trim()
  if (first.startsWith('{')) {
    const inner = first.replace(/^\{/, '').replace(/\}$/, '')
    const destructured = inner.split(',')
      .map((piece) => piece.split('=')[0].trim())
      .map((piece) => piece.replace(/^\.\.\./, '').trim())
      .filter((piece) => /^[A-Za-z_$][\w$]*$/.test(piece))
    return { destructured, names: [] }
  }
  const name = first.split('=')[0].trim()
  return { destructured: [], names: /^[A-Za-z_$][\w$]*$/.test(name) ? [name] : [] }
}

/** 执行体实际读到的参数名。 */
const usedParams = (source) => {
  const { destructured, names } = firstParam(source)
  const used = new Set(destructured)
  for (const parameterName of names) {
    const pattern = new RegExp(`\\b${parameterName}\\.([A-Za-z_$][\\w$]*)`, 'g')
    for (const match of source.matchAll(pattern)) used.add(match[1])
    if (new RegExp(`\\b${parameterName}\\s*[,)]`).test(source)) used.add('*passthrough*')
  }
  return used
}

/** 找出「执行体读取、但 schema 未声明」的参数。 */
const findUndeclared = (definition) => {
  const source = sourceOf(definition)
  if (!source) return []
  const used = usedParams(source)
  if (used.has('*passthrough*')) return []
  const declared = new Set(Object.keys(definition.parameters?.properties ?? {}))
  return [...used].filter((key) => !declared.has(key))
}

/** 找出「schema 声明了、但执行体从没出现」的参数。 */
const findDead = (definition) => {
  const source = sourceOf(definition)
  if (!source) return []
  if (usedParams(source).has('*passthrough*')) return []
  return Object.keys(definition.parameters?.properties ?? {}).filter((key) => !new RegExp(`\\b${key}\\b`).test(source))
}

test('execute 实际读取的参数都在 schema 中声明过（0.0.16 那类回归的守门人）', () => {
  const offenders = []
  for (const [name, definition] of TOOLS) {
    for (const key of findUndeclared(definition)) offenders.push(`${name}.${key}`)
  }
  assert.deepEqual(offenders, [], '这些参数被执行体读取、但 schema 没声明（additionalProperties:false 下会被拒）')
})

test('每个声明的参数都在 execute 源码里出现过（没有死参数）', () => {
  const offenders = []
  for (const [name, definition] of TOOLS) {
    const source = sourceOf(definition)
    if (!source) continue
    if (usedParams(source).has('*passthrough*')) continue
    for (const key of Object.keys(definition.parameters?.properties ?? {})) {
      if (!new RegExp(`\\b${key}\\b`).test(source)) offenders.push(`${name}.${key}`)
    }
  }
  assert.deepEqual(offenders, [], '这些参数在 schema 里声明了、但 execute 里从没出现过（死参数）')
})

test('每个工具都有 parameters（对象类型）', () => {
  for (const [name, definition] of TOOLS) {
    assert.equal(definition.parameters?.type, 'object', `${name} 的 parameters 应为 object`)
    if (definition.parameters.properties !== undefined) {
      assert.equal(typeof definition.parameters.properties, 'object', `${name} 的 properties 类型不对`)
    }
  }
})

test('参数名不与 JSON Schema 保留字冲突', () => {
  const reserved = new Set(['type', 'properties', 'required', 'items', 'enum', 'description', 'additionalProperties'])
  for (const [name, definition] of TOOLS) {
    for (const key of Object.keys(definition.parameters?.properties ?? {})) {
      assert.ok(!reserved.has(key), `${name} 用了保留字作参数名：${key}`)
    }
  }
})

test('工具名都带已知前缀', () => {
  const prefixes = ['vesta_', 'vasp_', 'volume_', 'xray_', 'slab_', 'check_', 'work_']
  for (const name of TOOLS.keys()) {
    assert.ok(prefixes.some((prefix) => name.startsWith(prefix)), `工具名缺前缀：${name}`)
  }
})

test('输出 schema 的 required 都是 properties 的子集', () => {
  for (const [name, definition] of TOOLS) {
    const schema = definition.output?.schema
    if (!schema) continue
    const properties = Object.keys(schema.properties ?? {})
    for (const key of schema.required ?? []) {
      assert.ok(properties.includes(key), `${name} 的输出 required 里有不存在的字段：${key}`)
    }
  }
})
test('检测器自检：故意不匹配的定义必须被抓到（证明守门员有效）', () => {
  // 复现 0.0.16 的形态：执行体读 background，schema 里没有
  const bad = {
    name: 'fake_tool',
    parameters: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' } } },
    executeSource: 'async execute({ path, background }, exec) { return [path, background] }',
  }
  assert.deepEqual(findUndeclared(bad), ['background'], '应抓到未声明的 background')
  // 反例：声明了但没用
  const dead = {
    name: 'fake_tool2',
    parameters: { type: 'object', properties: { path: {}, unused: {} } },
    executeSource: 'async execute({ path }, exec) { return path }',
  }
  assert.deepEqual(findDead(dead), ['unused'], '应抓到死参数 unused')
  // 正常定义不应误报
  const good = {
    name: 'fake_tool3',
    parameters: { type: 'object', properties: { path: {}, out: {} } },
    executeSource: 'async execute({ path, out }, exec) { return [path, out] }',
  }
  assert.deepEqual(findUndeclared(good), [])
  assert.deepEqual(findDead(good), [])
})
