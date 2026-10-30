#!/usr/bin/env node
/**
 * vesta-mcp —— 把本机 VESTA 的能力暴露成 MCP stdio 服务器。
 *
 * 为什么手写协议而不是引官方 SDK：这个服务器要能被**任何** MCP 客户端直接拉起
 * （Claude Desktop / Cursor / DSH / 自己写的客户端），所以零依赖、零 install：
 * 只要有 Node ≥ 18 就能 `node mcp/server.js` 跑起来。MCP 的 stdio 传输就是
 * 「一行一个 JSON-RPC 消息」，协议面收窄到本工具需要的部分即可，验收由真实
 * SDK 客户端做（见 README 的验收记录）。
 *
 * 铁律：**stdout 只能写协议消息**，所有诊断写 stderr —— 往 stdout 打一行日志
 * 就会让客户端解析失败、整个连接报废。
 *
 * 能力实现与 DSH 原生插件共用 `../core.js`，不存在两套行为。
 * @module vesta-mcp
 */

import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import {
  DEFAULT_EXECUTABLE,
  DEFAULT_MAX_FILES,
  inspectInstall,
  inspectSummary,
  openFiles,
  openSummary,
} from '../core.js'
import { apply } from '../index.js'

/**
 * 复用 DSH 插件里的工具定义：MCP 服务器不再手写第二套清单，
 * 插件新增工具时这里自动跟上（inputSchema 用插件里的 parameters）。
 */
const PLUGIN_TOOLS = (() => {
  const collected = []
  const ctx = {
    tools: { register: (definition) => { collected.push(definition); return () => {} } },
    effect: (factory) => { factory() },
    get: () => undefined,
  }
  apply(ctx, {})
  return collected
})()

/** 拿插件工具的 execute 结果转成 MCP 的 CallTool 结果。 */
async function callPluginTool(name, args) {
  const definition = PLUGIN_TOOLS.find((tool) => tool.name === name)
  if (!definition) return null
  try {
    const result = await definition.execute(args ?? {}, {})
    const text = typeof result?.summary === 'string' ? result.summary : JSON.stringify(result ?? {})
    return {
      content: [{ type: 'text', text }],
      structuredContent: result ?? {},
      isError: result?.ok === false,
    }
  } catch (error) {
    return textResult(`错误：${error.message}`, true)
  }
}

const PACKAGE_VERSION = (() => {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

const SERVER_INFO = { name: 'vesta-mcp', title: 'VESTA / VASP toolkit', version: PACKAGE_VERSION }

/** 支持的协议版本；客户端请求列表里排他地取一个能对上的。 */
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const LATEST_PROTOCOL = PROTOCOLS[0]

const INSTRUCTIONS =
  '本机 VESTA 与 VASP 后处理工具集，共 29 个工具，与 DSH 插件共用同一份实现。'
  + '结构：vesta_open / vesta_info / vesta_view / vesta_analyze / check_structure / slab_report；'
  + 'VESTA 控制：vesta_menu / vesta_control / vesta_capture（可指定 pid 定向到某个窗口）；'
  + 'VASP 解析与体检：vasp_report / vasp_table / vasp_batch / vasp_compare / vasp_incar 差异走 vasp_table；'
  + '可视化：vasp_dos / vasp_bands / vasp_pdos / vasp_trajectory / xray_powder；'
  + '体积分析：volume_analyze（slice / profile / peaks / derived / charges）与 work_function。'
  + '所有图形输出都是可离线打开的单文件 HTML；写文件类工具在给 out 时会回报实际路径。'

/**
 * 解析命令行与配置。
 * @param {string[]} argv - 进程参数（不含 node 与脚本名）。
 * @returns {{ executable: string, maxFiles: number }} 配置。
 */
function parseArgs(argv) {
  const config = { executable: DEFAULT_EXECUTABLE, maxFiles: DEFAULT_MAX_FILES }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--exe') config.executable = argv[(index += 1)]
    else if (arg.startsWith('--exe=')) config.executable = arg.slice('--exe='.length)
    else if (arg === '--max-files') config.maxFiles = Number(argv[(index += 1)])
    else if (arg.startsWith('--max-files=')) config.maxFiles = Number(arg.slice('--max-files='.length))
  }
  if (process.env.VESTA_EXE) config.executable = process.env.VESTA_EXE
  if (process.env.VESTA_MAX_FILES) config.maxFiles = Number(process.env.VESTA_MAX_FILES)
  if (!Number.isFinite(config.maxFiles) || config.maxFiles < 1) config.maxFiles = DEFAULT_MAX_FILES
  return config
}

const CONFIG = parseArgs(process.argv.slice(2))

/** 两个老工具保留可读的 title；其余用工具名。 */
const titleOf = {
  vesta_open: 'Open in VESTA',
  vesta_info: 'Inspect VESTA install',
}

/** 模型/客户端看到的工具清单（inputSchema 保持纯 JSON Schema，不用 DSL 方言）。 */
const TOOLS = PLUGIN_TOOLS.map((tool) => ({
  name: tool.name,
  title: titleOf[tool.name] ?? tool.name,
  description: tool.description,
  inputSchema: tool.parameters ?? { type: 'object', additionalProperties: true, properties: {} },
}))

/**
 * 执行一次工具调用。
 * 插件的 29 个工具都走 callPluginTool；只有 vesta_open/vesta_info 保留专门实现，
 * 因为它们要回填 structuredContent（保持老客户端兼容）。
 * @param {string} name - 原始 MCP 工具名。
 * @param {unknown} args - 客户端参数。
 * @returns {Promise<object | null>} MCP CallTool 结果；未知工具返回 null。
 */
async function callTool(name, args) {
  const payload = args !== null && typeof args === 'object' ? args : {}
  if (name === 'vesta_open') {
    const paths = payload.paths
    if (!Array.isArray(paths) || paths.length === 0) {
      return textResult('错误：paths 必须是非空字符串数组（要打开的文件或目录）。', true)
    }
    try {
      const result = await openFiles(CONFIG, paths, process.cwd())
      return {
        content: [{ type: 'text', text: openSummary(result) }],
        structuredContent: { ok: true, executable: result.executable, files: result.files },
        isError: false,
      }
    } catch (error) {
      return textResult(`错误：${error.message}`, true)
    }
  }
  if (name === 'vesta_info') {
    try {
      const state = await inspectInstall(CONFIG)
      return {
        content: [{ type: 'text', text: inspectSummary(state) }],
        structuredContent: {
          ok: state.exists,
          executable: state.executable,
          exists: state.exists,
          root: state.root,
          versionLine: state.versionLine,
          recent: state.recent,
          running: state.running,
        },
        isError: false,
      }
    } catch (error) {
      return textResult(`错误：${error.message}`, true)
    }
  }
  // 其余工具统一走插件实现
  return callPluginTool(name, payload)
}

/** 纯文本结果。 */
function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], isError }
}

/** JSON-RPC 错误对象。 */
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

/**
 * 处理一条已解析的 JSON-RPC 消息。
 * @param {any} message - 解析后的消息。
 * @returns {Promise<object | object[] | null>} 需要回写的响应；通知返回 null。
 */
async function handle(message) {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) {
    return rpcError(null, -32600, 'Invalid Request')
  }
  const { id, method } = message
  // 客户端对我们请求的响应、以及纯通知（无 id）都不回写。
  if (typeof method !== 'string') return null
  if (id === undefined) return null

  if (method === 'initialize') {
    const requested = typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : ''
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: PROTOCOLS.includes(requested) ? requested : LATEST_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      },
    }
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } }
  if (method === 'tools/call') {
    const name = message.params?.name
    if (typeof name !== 'string' || name.length === 0) {
      return rpcError(id, -32602, 'tools/call 缺少 params.name')
    }
    const result = await callTool(name, message.params?.arguments)
    if (result === null) return rpcError(id, -32602, `未知工具：${name}`)
    return { jsonrpc: '2.0', id, result }
  }
  return rpcError(id, -32601, `不支持的方法：${method}`)
}

/** 回写一行协议消息（stdout 只走这里）。 */
function respond(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

/** 顺序处理，保证同一连接上的消息不交错。 */
let chain = Promise.resolve()

const reader = createInterface({ input: process.stdin, crlfDelay: Infinity })
reader.on('line', (line) => {
  const text = line.trim()
  if (text.length === 0) return
  chain = chain.then(async () => {
    let message
    try {
      message = JSON.parse(text)
    } catch {
      respond(rpcError(null, -32700, 'Parse error'))
      return
    }
    const reply = await handle(message)
    if (reply !== null) respond(reply)
  }).catch((error) => {
    process.stderr.write(`vesta-mcp: 未捕获错误 ${error?.message ?? error}\n`)
  })
})

reader.on('close', () => {
  chain.finally(() => process.exit(0))
})

process.stderr.write(`vesta-mcp ${SERVER_INFO.version} 已启动（VESTA: ${CONFIG.executable ?? '默认路径'}）\n`)
