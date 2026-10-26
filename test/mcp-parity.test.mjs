/**
 * 两个前端的一致性：MCP 服务器暴露的工具必须与 DSH 插件注册的完全一致。
 *   node --test test/mcp-parity.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply } from '../index.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** 插件注册的工具名。 */
const pluginTools = () => {
  const collected = []
  apply({
    tools: { register: (definition) => { collected.push(definition); return () => {} } },
    effect: (factory) => { factory() },
    get: () => undefined,
  }, {})
  return collected
}

/** 通过 stdio 向 MCP 服务器要一次 tools/list。 */
const mcpTools = () => {
  const request = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`
  const result = spawnSync('node', ['mcp/server.js'], { input: request, encoding: 'utf8', cwd: ROOT })
  const line = (result.stdout ?? '').trim().split(/\r?\n/)[0]
  assert.ok(line, `MCP 服务器没有输出；stderr：${(result.stderr ?? '').slice(0, 200)}`)
  return JSON.parse(line).result.tools
}

test('MCP 与插件暴露同一批工具', () => {
  const plugin = pluginTools().map((tool) => tool.name).sort()
  const mcp = mcpTools().map((tool) => tool.name).sort()
  assert.deepEqual(mcp, plugin)
  assert.equal(mcp.length, 20)
})

test('MCP 的 inputSchema 就是插件的 parameters', () => {
  const plugin = new Map(pluginTools().map((tool) => [tool.name, tool]))
  for (const tool of mcpTools()) {
    const definition = plugin.get(tool.name)
    assert.ok(definition, `MCP 多了插件里没有的工具：${tool.name}`)
    assert.deepEqual(tool.inputSchema, definition.parameters, `${tool.name} 的 schema 不一致`)
    assert.equal(tool.description, definition.description, `${tool.name} 的描述不一致`)
  }
})

test('MCP 的 serverInfo.version 与 package.json 一致，instructions 提到工具数', () => {
  const request = `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`
  const result = spawnSync('node', ['mcp/server.js'], { input: request, encoding: 'utf8', cwd: ROOT })
  const line = (result.stdout ?? '').trim().split(/\r?\n/)[0]
  const handshake = JSON.parse(line).result
  const manifest = JSON.parse(readFileSync(`${ROOT}/package.json`, 'utf8'))
  assert.equal(handshake.serverInfo.version, manifest.version)
  assert.match(handshake.instructions, /工具集/)
  assert.ok(!/只负责「打开」/.test(handshake.instructions), 'instructions 里还留着过时的描述')
})
