#!/usr/bin/env node
/**
 * 零依赖冒烟测试：不需要 MCP SDK，直接按 stdio 传输的「一行一个 JSON-RPC」说话。
 *
 *   node test/smoke.mjs            # 用默认 VESTA 路径
 *   VESTA_EXE=... node test/smoke.mjs
 *
 * 只验证协议面与只读工具（vesta_info）——**不会**打开 VESTA 窗口。
 * 真开窗口的验收见 README「验收记录」。
 */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = join(HERE, '..', 'mcp', 'server.js')

const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] })
const replies = new Map()
const lines = createInterface({ input: child.stdout })
lines.on('line', (line) => {
  const message = JSON.parse(line)
  replies.set(message.id, message)
})

const send = (payload) => child.stdin.write(`${JSON.stringify(payload)}\n`)
const waitFor = async (id, timeoutMs = 8000) => {
  const started = Date.now()
  while (!replies.has(id)) {
    if (Date.now() - started > timeoutMs) throw new Error(`等不到 id=${id} 的响应`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return replies.get(id)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

try {
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } })
  const init = await waitFor(1)
  check('initialize 握手', init.result?.serverInfo?.name === 'vesta-mcp', JSON.stringify(init.result?.serverInfo))

  send({ jsonrpc: '2.0', method: 'notifications/initialized' })
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  const list = await waitFor(2)
  const names = (list.result?.tools ?? []).map((tool) => tool.name)
  // MCP 复用插件定义，数量应与插件一致（21 个），且必须包含两个基础工具
  check('tools/list 返回插件的全部工具',
    names.length === 28 && names.includes('vesta_open') && names.includes('vesta_info') && names.includes('check_structure'),
    `${names.length} 个：${names.join(',')}`)

  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'vesta_info', arguments: {} } })
  const info = await waitFor(3)
  check('vesta_info 可调用', info.result?.isError === false && typeof info.result?.structuredContent?.executable === 'string',
    info.result?.structuredContent?.executable)

  send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'vesta_open', arguments: { paths: ['D:/绝对不存在的路径/POSCAR'] } } })
  const bad = await waitFor(4)
  check('错误路径返回 isError', bad.result?.isError === true && /不存在/.test(bad.result?.content?.[0]?.text ?? ''),
    bad.result?.content?.[0]?.text)

  send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } })
  const unknown = await waitFor(5)
  check('未知工具返回 -32602', unknown.error?.code === -32602, unknown.error?.message)
} finally {
  child.stdin.end()
  child.kill()
}

const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed === 0 ? 0 : 1)
