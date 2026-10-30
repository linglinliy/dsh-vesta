/**
 * dsh-vesta —— DSH 原生 Host 插件前端（`ctx.tools`）。
 *
 * 这里只做三件 DSH 特有的事：
 *   1. 把工具定义成 registry-ready 的形状（`ctx.tools.register` 直接接受普通对象）；
 *   2. 补上入参校验（register 不校验模型入参，那是 defineTool 干的，本插件不依赖它）；
 *   3. 把「会话工作目录」交给核心层解析相对路径。
 *
 * 真正的 VESTA 能力在 `core.js`，与 `mcp/server.js` 共用，避免两个前端行为漂移。
 *
 * 约束（同机已装 dsh-sci-viz 的实测结论）：插件以 link: 装进 profile，
 * bare specifier 解析不到 profile 的 node_modules，因此不 import 任何 `@deepseek-ai/*`。
 * @module @local/dsh-vesta
 */

import {
  DEFAULT_EXECUTABLE,
  DEFAULT_MAX_FILES,
  captureWindow,
  exportStructureForViewer,
  resolveTarget,
  inspectInstall,
  inspectSummary,
  invokeCommand,
  listControls,
  listMenu,
  openFiles,
  openSummary,
  operateControl,
} from './core.js'
import { hideSelected, observeVesta, restoreVesta, selectVesta, sessionStructure } from './interact.js'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname as dirnamePath, join as joinPath } from 'node:path'

/** cordis 插件名（与 cordis.patch.yml 的 insert id 对应）。 */
export const name = 'vesta'

/** 需要 tools 服务才能注册工具。 */
export const inject = ['tools']

const DEFAULTS = {
  executable: DEFAULT_EXECUTABLE,
  maxFiles: DEFAULT_MAX_FILES,
}

/**
 * 最小 JSON Schema 校验（覆盖本插件用到的子集，错误信息写中文）。
 * @param {any} schema - 参数表。
 * @param {unknown} value - 模型传来的值。
 * @param {string} path - 校验位置，用于报错。
 * @returns {string[]} 违规说明；空数组表示通过。
 */
function validateAgainst(schema, value, path = '') {
  const out = []
  if (!schema || typeof schema !== 'object') return out
  const label = path || '参数'
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const ok = schema.oneOf.some((sub) => validateAgainst(sub, value, path).length === 0)
    if (!ok) out.push(`${label} 不满足任何一种允许的形式`)
    return out
  }
  const type = schema.type
  if (type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      out.push(`${label} 应为对象`)
      return out
    }
    const props = schema.properties ?? {}
    for (const key of schema.required ?? []) {
      if (value[key] === undefined || value[key] === null) out.push(`缺少必填参数 ${path ? `${path}.` : ''}${key}`)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(props, key)) out.push(`不认识的参数 ${path ? `${path}.` : ''}${key}`)
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (value[key] === undefined || value[key] === null) continue
      out.push(...validateAgainst(sub, value[key], path ? `${path}.${key}` : key))
    }
    return out
  }
  if (type === 'array') {
    if (!Array.isArray(value)) {
      out.push(`${label} 应为数组`)
      return out
    }
    if (schema.items) {
      value.forEach((item, index) => {
        out.push(...validateAgainst(schema.items, item, `${label}[${index}]`))
      })
    }
    return out
  }
  if (type === 'string') {
    if (typeof value !== 'string') {
      out.push(`${label} 应为字符串`)
      return out
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
      out.push(`${label} 只能是 ${schema.enum.join(' / ')}，收到 ${JSON.stringify(value)}`)
    }
    return out
  }
  if (type === 'number' || type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      out.push(`${label} 应为数字`)
      return out
    }
    if (type === 'integer' && !Number.isInteger(value)) out.push(`${label} 应为整数`)
    return out
  }
  if (type === 'boolean') {
    if (typeof value !== 'boolean') out.push(`${label} 应为 true / false`)
    return out
  }
  return out
}

/**
 * 本地 defineTool：包成 registry-ready 形状并补上入参校验。
 * @param {object} definition - name/description/parameters/output/execute/…
 * @returns {object} 可交给 ctx.tools.register 的定义。
 */
function localTool(definition) {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    output: definition.output,
    isConcurrencySafe: () => false,
    presentCall: definition.presentCall,
    async execute(args, exec) {
      const payload = args ?? {}
      const violations = validateAgainst(definition.parameters, payload)
      if (violations.length > 0) throw new Error(`vesta 参数不合法：${violations.slice(0, 6).join('；')}`)
      return definition.execute(payload, exec)
    },
  }
}

/** 会话工作目录；拿不到就退回进程当前目录（属于正常降级，不报错）。 */
function sessionDirectory(ctx, exec) {
  try {
    const service = ctx.get('workingDirectory')
    const session = exec?.agent?.session
    if (service && session) {
      const value = service.get(session)
      if (typeof value === 'string' && value.length > 0) return value
    }
  } catch {
    /* 没有会话上下文时按进程目录解析 */
  }
  return process.cwd()
}

const OPEN_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['paths'],
  properties: {
    paths: {
      type: 'array',
      items: { type: 'string' },
      description:
        '要打开的结构文件或任务目录（1–10 个）。绝对路径或相对当前工作目录；传目录时自动挑 POSCAR/CONTCAR/*.cif。'
        + '支持 CIF、POSCAR/CONTCAR、CUBE、XSF、PDB、XYZ、VESTA 场景等 VESTA 能读的格式。',
    },
  },
}

/**
 * `vesta_open`：在本机 VESTA 里打开结构文件。
 * @param {object} config - 合并后的配置。
 * @param {object} ctx - 插件上下文，只用来拿会话工作目录。
 * @returns {object} 工具定义。
 */
const openTool = (config, ctx) => localTool({
  name: 'vesta_open',
  description:
    '在本机安装的 VESTA 里打开一个或多个晶体结构/体积数据文件（POSCAR、CONTCAR、CIF、CUBE、XSF、PDB、XYZ 等）。'
    + '当用户想用 VESTA 看结构、对比几个构型、或查看某次 DFT 任务的 POSCAR 时调用它；'
    + '传目录会按 VASP 任务习惯自动挑主结构文件。'
    + '它只负责在 VESTA 窗口里打开文件并回报实际启动的进程，不做渲染、不导出图片（VESTA 没有命令行导出接口）。',
  parameters: OPEN_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'executable', 'files'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        executable: { type: 'string' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'format', 'pid'],
            properties: {
              path: { type: 'string' },
              format: { type: 'string' },
              pid: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
            },
          },
        },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Open in VESTA', kind: 'execute', rawInput: args }),
  async execute(args, exec) {
    const result = await openFiles(config, args.paths, sessionDirectory(ctx, exec))
    return { ok: true, summary: openSummary(result), executable: result.executable, files: result.files }
  },
})

const INFO_PARAMS = {
  type: 'object',
  additionalProperties: false,
  properties: {},
}

/**
 * `vesta_info`：回报安装位置、版本行、最近打开的结构、当前是否有 VESTA 在运行。
 * @param {object} config - 合并后的配置。
 * @returns {object} 工具定义。
 */
const infoTool = (config) => localTool({
  name: 'vesta_info',
  description:
    '检查本机 VESTA 安装状态：可执行文件是否存在、安装目录、VESTA.ini 里的版本标识、VESTA 自己记录的最近打开文件，'
    + '以及当前是否有 VESTA 进程在运行。'
    + '在打开结构前不确定路径、或用户问「VESTA 装在哪 / 我上次看的哪个结构」时用它。',
  parameters: INFO_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'executable', 'exists', 'root', 'versionLine', 'recent', 'running'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        executable: { type: 'string' },
        exists: { type: 'boolean' },
        root: { type: 'string' },
        versionLine: { type: 'string' },
        recent: { type: 'array', items: { type: 'string' } },
        running: {
          type: 'object',
          additionalProperties: false,
          required: ['supported', 'pids'],
          properties: {
            supported: { type: 'boolean' },
            pids: { type: 'array', items: { type: 'integer' } },
          },
        },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: () => ({ card: 'generic', title: 'Inspect VESTA install', kind: 'read' }),
  async execute() {
    const state = await inspectInstall(config)
    return {
      ok: state.exists,
      summary: inspectSummary(state),
      executable: state.executable,
      exists: state.exists,
      root: state.root,
      versionLine: state.versionLine,
      recent: state.recent,
      running: state.running,
    }
  },
})

/**
 * 挂载两个工具；析构时按注册顺序反向注销。
 * @param {object} ctx - cordis 上下文。
 * @param {object} [config] - 插件行配置。
 */
export function apply(ctx, config) {
  const merged = { ...DEFAULTS, ...(config ?? {}) }
  ctx.effect(() => {
    const disposers = [
      ctx.tools.register(openTool(merged, ctx)),
      ctx.tools.register(infoTool(merged)),
      ctx.tools.register(menuTool()),
      ctx.tools.register(captureTool(merged, ctx)),
      ctx.tools.register(analyzeTool(merged, ctx)),
      ctx.tools.register(volumeTool(ctx)),
      ctx.tools.register(powderTool(ctx)),
      ctx.tools.register(slabTool(ctx)),
      ctx.tools.register(checkStructureTool(ctx)),
      ctx.tools.register(workFunctionTool(ctx)),
      ctx.tools.register(controlTool()),
      ctx.tools.register(viewTool(ctx)),
      ctx.tools.register(dosTool(ctx)),
      ctx.tools.register(bandsTool(ctx)),
      ctx.tools.register(reportTool(ctx)),
      ctx.tools.register(batchTool(ctx)),
      ctx.tools.register(compareTool(ctx)),
      ctx.tools.register(tableTool(ctx)),
      ctx.tools.register(trajectoryTool(ctx)),
      ctx.tools.register(pdosTool(ctx)),
      ctx.tools.register(inputTool(ctx)),
      ctx.tools.register(renderTool(merged, ctx)),
      ctx.tools.register(editTool(merged, ctx)),
      ctx.tools.register(vectorTool(ctx)),
      ctx.tools.register(volumeExportTool(ctx)),
      ctx.tools.register(measureTool(ctx)),
      ctx.tools.register(volumeDisplayTool(ctx)),
      ctx.tools.register(styleTool(ctx)),
      ctx.tools.register(interactTool()),
    ]
    // 常驻宿主是一个 powershell 子进程：插件卸载时一起收掉，避免留下僵尸进程
    disposers.unshift(() => {
      import('./core.js').then((core) => core.stopUiHost?.()).catch(() => {})
    })
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }, 'dsh-vesta: tools')
}

// ---------------------------------------------------------------------------
// 界面控制工具（Win32 层，见 win/vesta-ui.ps1）
// ---------------------------------------------------------------------------

const MENU_PARAMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    list: { type: 'boolean', description: 'true = 列出 VESTA 全部菜单命令及其 id、是否可用；false/省略 = 执行 command' },
    command: { type: 'integer', description: '要执行的菜单命令 id（从 list 结果里取）' },
    window: { type: 'string', description: '目标窗口：main（默认）| dialog（当前对话框）| hwnd 数字' },
    pid: { type: 'integer', description: 'VESTA 进程 pid（多窗口时指定作用在哪个窗口；pid 见 vesta_open 返回）。' },
  },
}

/**
 * `vesta_menu`：列出或执行 VESTA 菜单命令。
 * @returns {object} 工具定义。
 */
const menuTool = () => localTool({
  name: 'vesta_menu',
  description:
    '列出或执行 VESTA 的菜单命令。list=true 返回「文件/编辑/视图/对象/工具/帮助」全部菜单项的 id 与可用性；'
    + '给 command 就等价于点该菜单项，例如 Fit to Screen、Antialiasing、Zoom In、Powder Diffraction Pattern、'
    + 'Geometrical Parameters、Structure Factors、Madelung Energy、Equivalent Positions。'
    + '用户想「点某个菜单 / 让 VESTA 做它自己的计算（Madelung、结构因子、粉末衍射）」时用它。'
    + 'VESTA 没有脚本接口，这是触达它计算与显示功能的唯一通道；需要 VESTA 正在运行（先用 vesta_open 打开结构）。'
    + '注意：会弹对话框的命令（导出图片、粉末衍射等）只负责把对话框打开，后续用 vesta_control 填参、点按钮。',
  parameters: MENU_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'window', 'sent', 'menu'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        window: { type: 'integer' },
        sent: { type: 'integer' },
        menu: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['path', 'id', 'kind', 'enabled'],
            properties: {
              path: { type: 'string' },
              id: { type: 'integer' },
              kind: { type: 'string' },
              enabled: { type: 'boolean' },
            },
          },
        },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: args.list ? 'List VESTA menu' : `VESTA command ${args.command ?? ''}`, kind: 'execute', rawInput: args }),
  async execute(args) {
    // pid 定向到某个 VESTA 进程（多窗口时用它区分 POSCAR 窗口与 CHGCAR 窗口）
    const window = Number.isInteger(args.pid) ? { pid: args.pid } : (typeof args.window === 'string' && args.window.length > 0 ? args.window : 'main')
    if (args.list === true) {
      const rows = await listMenu(window)
      const commands = rows.filter((row) => row.kind === 'command')
      const enabled = commands.filter((row) => row.enabled)
      const groups = [...new Set(commands.map((row) => row.path.split(' > ')[0]))]
      const lines = commands
        .slice(0, 120)
        .map((row) => `  id=${row.id}\t${row.path.replace(/&/g, '')}${row.enabled ? '' : '\t（当前不可用）'}`)
      return {
        ok: true,
        summary: `VESTA 菜单：${commands.length} 条命令、${groups.length} 个主菜单，当前可用 ${enabled.length} 条。\n${lines.join('\n')}`,
        window: 0,
        sent: -1,
        menu: rows,
      }
    }
    const result = await invokeCommand(args.command, window)
    return {
      ok: true,
      summary: `已执行 VESTA 菜单命令 id=${result.commandId}（窗口「${result.window.title}」）。若该命令会弹对话框，用 vesta_control 继续。`,
      window: result.window.hwnd,
      sent: result.commandId,
      menu: [],
    }
  },
})

const CAPTURE_PARAMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    out: { type: 'string', description: '输出图片路径；省略时：抓窗口写 ~/.dsh/vesta-captures/，导出模式写临时 png' },
    window: { type: 'string', description: 'main（默认）| dialog（当前对话框）| hwnd 数字' },
    pid: { type: 'integer', description: 'VESTA 进程 pid（多窗口时指定作用在哪个窗口；pid 见 vesta_open 返回）。' },
    path: { type: 'string', description: '给了结构/体积文件就走 VESTA 官方 CLI 高清导出（-open/-export_img），而不是抓窗口' },
    scale: { type: 'integer', description: '导出放大倍数（默认 2）。仅导出模式有效' },
  },
}

/**
 * `vesta_capture`：抓 VESTA 窗口图像。
 * @returns {object} 工具定义。
 */
const captureTool = (config, ctx) => localTool({
  name: 'vesta_capture',
  description:
    '把 VESTA 窗口抓成 PNG（PrintWindow，窗口被遮挡也能抓）。'
    + '用户要「看看 VESTA 现在显示成什么样 / 截个图」时用它。'
    + '返回文件路径和尺寸，随后可用 read_image 查看或写进文档。'
    + '抓的是屏幕像素（含界面控件），不是 VESTA 自己的高清导出——要高分辨率、白底无界面，走 vesta_menu 104（Export Raster Image）再用 vesta_control 完成保存。',
  parameters: CAPTURE_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'path', 'size', 'window'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        path: { type: 'string' },
        size: { type: 'string' },
        window: { type: 'integer' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: () => ({ card: 'generic', title: 'Capture VESTA window', kind: 'read' }),
  async execute(args, exec) {
    if (args.path) {
      // VESTA 官方命令行接口（手册第 17 章）：白底、无界面、可放大
      const core = await import(`./core.js?rev=${Date.now()}`)
      const base = sessionDirectory(ctx, exec)
      const input = core.toAbsolute(args.path, base)
      const fallback = joinPath(process.env.USERPROFILE ?? '.', '.dsh', 'vesta-captures', `vesta-export-${Date.now()}.png`)
      const out = args.out ? core.toAbsolute(args.out, base) : fallback
      const result = await core.exportVestaImage(config, input, out, { scale: args.scale })
      return {
        ok: true,
        summary: `VESTA 高清导出完成（${result.scale}×，${(result.bytes / 1024).toFixed(0)} KB，${result.ms} ms）→ ${result.out}`,
        path: result.out,
        size: `${(result.bytes / 1024).toFixed(0)} KB`,
        window: 0,
      }
    }
    const result = await captureWindow({ out: args.out, window: Number.isInteger(args.pid) ? { pid: args.pid } : args.window })
    return {
      ok: true,
      summary: `已抓取 VESTA 窗口（${result.size}）→ ${result.path}`,
      path: result.path,
      size: result.size,
      window: result.window.hwnd,
    }
  },
})

const CONTROL_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ['list', 'click', 'settext', 'transform-cell', 'delete-atom'],
      description: 'list=列出控件；click=点击；settext=写入文本（WM_SETTEXT，后台有效）；'
        + 'transform-cell=在 VESTA 里完成 Unit Cell Transformation（填矩阵并走完全部确认框）；'
        + 'delete-atom=在 Edit Data 里选中原子列表的一行并删除（行选中需真实点击兜底）',
    },
    row: { type: 'integer', description: 'delete-atom 用：要删除的原子行号（0 基），默认 0。', minimum: 0 },
    matrix: {
      type: 'array',
      description: 'transform-cell 用：3×3 整数变换矩阵，如 [[2,0,0],[0,2,0],[0,0,2]] 表示 2×2×2 扩胞。',
      items: { type: 'array', items: { type: 'integer' } },
    },
    window: { type: 'string', description: '目标窗口：dialog（默认，当前对话框）| main | hwnd 数字' },
    pid: { type: 'integer', description: 'VESTA 进程 pid（多窗口时指定作用在哪个窗口；pid 见 vesta_open 返回）。' },
    hwnd: { type: 'integer', description: '控件 hwnd（从 list 结果里取）' },
    name: { type: 'string', description: '用控件文字定位（精确优先，其次包含匹配），例如「保存(&S)」' },
    text: { type: 'string', description: 'settext 写入的内容' },
  },
}

/**
 * `vesta_control`：操作 VESTA 对话框里的控件。
 * @returns {object} 工具定义。
 */
const controlTool = () => localTool({
  name: 'vesta_control',
  description:
    '用户想「点某个按钮 / 往对话框里填内容 / 选某个选项」时用它。'
    + '操作 VESTA 当前对话框里的控件：列出全部控件（按钮/输入框/勾选框，含 hwnd、文字、勾选状态），'
    + '然后按 hwnd 或文字点击按钮、往输入框写字。配合 vesta_menu 使用：先执行会弹窗的菜单命令，再用本工具填参并点「确定/保存」。'
    + '没有对话框时默认作用在主窗口上（主窗口的控件多是面板按钮）。',
  parameters: CONTROL_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'window', 'controls', 'action'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        window: { type: 'integer' },
        action: { type: 'string' },
        controls: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['hwnd', 'class', 'id', 'text', 'enabled', 'visible', 'check'],
            properties: {
              hwnd: { type: 'integer' },
              class: { type: 'string' },
              id: { type: 'integer' },
              text: { type: 'string' },
              enabled: { type: 'boolean' },
              visible: { type: 'boolean' },
              check: { type: 'integer' },
            },
          },
        },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: `VESTA control: ${args.action ?? ''}`, kind: 'other', rawInput: args }),
  async execute(args) {
    const window = typeof args.window === 'string' && args.window.length > 0 ? args.window : 'dialog'
    if (args.action === 'delete-atom') {
      const target = Number.isInteger(args.pid) ? args.pid : (await listControls(window)).window.pid
      const result = await deleteAtomInVesta(target, { row: args.row })
      return {
        ok: true,
        summary: [
          '已在 VESTA 里删除一个原子行（PostMessage 优先 + 行选中用真实点击兜底）：',
          ...result.steps.map((step) => '  ' + step),
        ].join('\n'),
        window: 0,
        action: 'delete-atom',
        controls: [],
      }
    }
    if (args.action === 'transform-cell') {
      const target = Number.isInteger(args.pid) ? args.pid : (await listControls(window)).window.pid
      const result = await transformCellInVesta(target, args.matrix)
      return {
        ok: true,
        summary: [
          '已在 VESTA 里完成晶胞变换（纯 PostMessage，未抢焦点、未动光标）：',
          ...result.steps.map((step) => '  ' + step),
          '矩阵：' + result.matrix.map((row) => row.join(' ')).join(' / '),
        ].join('\n'),
        window: 0,
        action: 'transform-cell',
        controls: [],
      }
    }
    if (args.action === 'list') {
      // window 优先于 pid：同时给两者时应按 window 定位（曾经 pid 覆盖 window，指定 hwnd 却列到主窗口）
      const listTarget = args.window !== undefined && args.window !== null && String(args.window).length > 0
        ? args.window
        : (Number.isInteger(args.pid) ? { pid: args.pid } : window)
      const listed = await listControls(listTarget)
      const controls = listed.controls.map((item) => ({
        hwnd: item.hwnd,
        class: item.class ?? '',
        id: typeof item.id === 'number' ? item.id : 0,
        text: item.text ?? '',
        enabled: item.enabled === true,
        visible: item.visible === true,
        check: typeof item.check === 'number' ? item.check : -1,
      }))
      // 空输入框（Edit/ComboBox）同样要列出来 —— 对话框里最需要写的往往就是它们。
      const named = controls.filter((item) => item.text.length > 0
        || ['Edit', 'ComboBox', 'ComboBoxEx32', 'SysListView32', 'SysTreeView32'].includes(item.class))
      const lines = named
        .slice(0, 60)
        .map((item) => `  hwnd=${item.hwnd}\t${item.class}#${item.id}\t「${item.text || '（空）'}」${item.enabled ? '' : '（禁用）'}${item.check >= 0 ? `\t勾选=${item.check}` : ''}`)
      return {
        ok: true,
        summary: `窗口「${listed.window.title}」：${controls.length} 个控件，其中 ${named.length} 个有文字。\n${lines.join('\n')}`,
        window: listed.window.hwnd,
        action: 'list',
        controls,
      }
    }
    const result = await operateControl(args.action, {
      window,
      hwnd: args.hwnd,
      name: args.name,
      text: args.text,
    })
    const control = result.control
    return {
      ok: true,
      summary: args.action === 'settext'
        ? `已向控件「${control.text}」（hwnd ${control.hwnd}）写入：${args.text}`
        : `已点击控件「${control.text}」或 hwnd ${control.hwnd}。`,
      window: result.window.hwnd,
      action: args.action,
      controls: [{
        hwnd: control.hwnd,
        class: control.class ?? '',
        id: typeof control.id === 'number' ? control.id : 0,
        text: control.text ?? '',
        enabled: control.enabled === true,
        visible: control.visible === true,
        check: typeof control.check === 'number' ? control.check : -1,
      }],
    }
  },
})
const VIEW_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['paths'],
  properties: {
    paths: {
      type: 'array',
      items: { type: 'string' },
      description: '要查看的结构文件或任务目录（1–5 个）；绝对路径或相对当前工作目录，传目录会自动挑 POSCAR/CONTCAR。',
    },
    repeat: {
      type: 'array',
      items: { type: 'integer' },
      description: '扩胞倍数 [nx,ny,nz]，每项 1–6，默认 [1,1,1]。小单胞（如石墨烯 2.5 Å 胞）建议 [2,2,2] 才看得出立体网络。',
    },
    outDir: {
      type: 'string',
      description: '输出目录；省略则写到 ~/.dsh/vesta-views/<时间戳>/。',
    },
    volume: {
      type: 'string',
      description: '体积数据文件（CHGCAR / CHG / .cube）路径：给了就在 webgl 查看器里画等值面。配合 isoPercent 设阈值。',
    },
    volumeRef: {
      type: 'string',
      description: '参照体积文件（CHGCAR / .cube）：给了就画「volume − volumeRef」的差密度，正蓝负红。'
        + '典型用法：吸附前后的电荷密度差、两个自旋通道之差。要求两者网格维度一致。',
    },
    isoValue: {
      type: 'number',
      description: '等值面的精确密度阈值（与体积数据同单位，如 e/Å³）：内部换算成百分比再渲染，用来回答「等值面画在 0.05 e/Å³」这类精确要求（VESTA 的 GUI 只能按 +/- 步进）。',
    },
    isoPercent: {
      type: 'integer',
      description: '等值面阈值百分比（1–95，相对体积数据的最大/最小量程），默认 15。',
    },
    renderer: {
      type: 'string',
      enum: ['classic', 'webgl'],
      description: 'webgl = 额外生成「接近 VESTA 观感」的单文件 HTML（着色球/圆柱键/多面体/空间填充/晶胞/坐标轴，可旋转缩放，离线可开）；classic（默认）只出 PDB/CIF，供外部查看器或 VESTA 打开。',
    },
  },
}

/**
 * `vesta_view`：把 POSCAR/CONTCAR 转成面板能吃的 PDB/mmCIF（可扩胞），返回文件路径。
 * @param {object} ctx - 插件上下文，用来拿会话工作目录。
 * @returns {object} 工具定义。
 */
const viewTool = (ctx) => localTool({
  name: 'vesta_view',
  description:
    '把 POSCAR/CONTCAR/*.vasp 转成带晶胞的三维结构文件（PDB + mmCIF），可扩胞。'
    + '用户想「看结构 / 旋转缩放看看」时用它：renderer="webgl" 会额外生成一个离线可开的单文件 HTML 查看器'
    + '（着色球/圆柱键/晶胞/坐标轴，可旋转缩放），这条在本 profile 里最可靠；'
    + '只传 PDB/CIF 时适合交给外部三维查看器或 VESTA。'
    + '查看器不收周期性边界，所以扩胞会把原子真的铺出来；晶胞参数同时写在 CRYST1 与 mmCIF 的 _cell_ 里。',
  parameters: VIEW_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'structures'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        structures: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['input', 'pdb', 'cif', 'formula', 'atoms', 'repeat'],
            properties: {
              input: { type: 'string' },
              pdb: { type: 'string' },
              cif: { type: 'string' },
              formula: { type: 'string' },
              atoms: { type: 'integer' },
              repeat: { type: 'array', items: { type: 'integer' } },
              viewer: { type: 'string' },
              cell: {
                type: 'object',
                additionalProperties: false,
                required: ['a', 'b', 'c', 'alpha', 'beta', 'gamma'],
                properties: {
                  a: { type: 'number' },
                  b: { type: 'number' },
                  c: { type: 'number' },
                  alpha: { type: 'number' },
                  beta: { type: 'number' },
                  gamma: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Convert POSCAR for viewer', kind: 'read', rawInput: args }),
  async execute(args, exec) {
    const raw = Array.isArray(args.paths) ? args.paths : []
    if (raw.length === 0) throw new Error('paths 至少要给一个结构文件或目录')
    if (raw.length > 5) throw new Error(`一次最多转换 5 个结构，收到 ${raw.length} 个`)
    const base = sessionDirectory(ctx, exec)
    // 插件运行时缓存了上一次的 core.js；带版本号的动态 import 保证读到磁盘上的最新实现。
    const core = await import(`./core.js?rev=${Date.now()}`)
    const structures = []
    for (const item of raw) {
      const target = resolveTarget(item, base)
      const record = core.exportStructureForViewer(target, { repeat: args.repeat, outDir: args.outDir })
      if (args.renderer === 'webgl') {
        // 精确阈值：把目标密度值换算成百分比（我们自己的渲染器只认百分比）
        let isoSolved = null
        if (Number.isFinite(Number(args.isoValue))) {
          const volumePath = core.resolveTarget(String(args.volume ?? target), base)
          const volumeData = core.readVolumeFile(volumePath)
          const percent = core.volumePercentForValue(volumeData, Number(args.isoValue))
          const clamped = Math.max(1, Math.min(95, Math.round(percent)))
          isoSolved = { value: Number(args.isoValue), percent: clamped, raw: percent }
        }
        const first = record.pdb
        const viewerPath = first.replace(/\.pdb$/i, '') + '-VESTA风.html'
        const generated = await core.generateWebglViewer(target, {
          repeat: args.repeat,
          out: viewerPath,
          volume: args.volume,
          volumeRef: args.volumeRef,
          isoPercent: isoSolved ? isoSolved.percent : args.isoPercent,
        })
        if (isoSolved) {
          record.isoNote = '等值面阈值 ' + isoSolved.value + ' → 第 ' + isoSolved.percent + ' 百分位（原始换算 ' + isoSolved.raw.toFixed(2) + '%，渲染器限制 1–95%）'
        }
        record.viewer = generated.out
      }
      structures.push(record)
    }
    const isoNotes = structures.map((item) => item.isoNote).filter(Boolean)
    const lines = structures.map((item) => {
      const cell = item.cell
      const repeatText = item.repeat.join('×')
      const viewerLine = item.viewer ? `\n    HTML: ${item.viewer}` : ''
      return `  ${item.formula}（${item.atoms} 原子，${repeatText} 扩胞，a=${cell.a.toFixed(2)} b=${cell.b.toFixed(2)} c=${cell.c.toFixed(2)} Å）\n    PDB: ${item.pdb}\n    CIF: ${item.cif}${viewerLine}`
    })
    return {
      ok: true,
      summary: `已生成 ${structures.length} 个带晶胞参数的结构文件：\n${lines.join('\n')}${isoNotes.length > 0 ? '\n' + isoNotes.join('\n') : ''}\n下一步：需要交互查看时用 renderer="webgl" 生成离线 HTML 查看器（本 profile 里没有独立的三维面板工具）；也可以直接在 VESTA 里打开 PDB/CIF。`,
      structures,
    }
  },
})
// 热重载标记：2026-10-24 结构查看器（vesta_view）上线

const DOS_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', description: 'DOSCAR 文件路径，或包含 DOSCAR 的 VASP 任务目录。' },
    out: { type: 'string', description: '输出 HTML 路径；省略则与 DOSCAR 同目录，文件名 <DOSCAR>-dos.html。' },
    window: { type: 'integer', description: '能量窗口（eV），默认 8：纵轴范围取 E_f−window 到 E_f+window/2。' },
  },
}

/**
 * `vasp_dos`：DOSCAR → 交互式 DOS 曲线（自旋极化镜像、费米能级标线、缺口可见）。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const dosTool = (ctx) => localTool({
  name: 'vasp_dos',
  description:
    '把 VASP 的 DOSCAR 画成可交互的 DOS 曲线（单文件 HTML，离线可开）：自旋向上/向下镜像、费米能级标线、'
    + '悬停读数、滚轮缩放、存 PNG。返回 ∫DOS dE 到费米能级的电子数，可用来核对与 NELECT 是否一致。'
    + '当用户问「态密度 / DOS / 带隙 / 费米能级」时用它。',
  parameters: DOS_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'path', 'nedos', 'efermi', 'spinPolarized', 'electrons'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        path: { type: 'string' },
        nedos: { type: 'integer' },
        efermi: { type: 'number' },
        spinPolarized: { type: 'boolean' },
        electrons: { type: 'number' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Plot DOS', kind: 'read', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const base = sessionDirectory(ctx, exec)
    const core = await import(`./core.js?rev=${Date.now()}`)
    // 注意：不能先用 resolveTarget——它会把「任务目录」解析成里面的 POSCAR。
    const absolute = core.toAbsolute(args.path, base)
    if (!existsSync(absolute)) throw new Error(`路径不存在：${absolute}`)
    const doscar = statSync(absolute).isDirectory() ? joinPath(absolute, 'DOSCAR') : absolute
    if (!existsSync(doscar)) throw new Error(`找不到 DOSCAR：${doscar}`)
    const generated = await core.generateDosViewer(doscar, { out: args.out, window: args.window })
    const spin = generated.spinPolarized ? '自旋极化（上蓝下红）' : '非自旋极化'
    return {
      ok: true,
      summary: `DOS 图已生成：${generated.out}\nNEDOS ${generated.nedos} 点，E-fermi ${generated.efermi} eV，${spin}；`
        + `∫DOS dE 到 E_f = ${generated.integratedElectrons} e（应等于 NELECT）。`,
      path: generated.out,
      nedos: generated.nedos,
      efermi: generated.efermi,
      spinPolarized: generated.spinPolarized === true,
      electrons: generated.integratedElectrons,
    }
  },
})

const BANDS_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', description: 'EIGENVAL 文件路径，或包含 EIGENVAL 的 VASP 任务目录。' },
    out: { type: 'string', description: '输出 HTML 路径；省略则与 EIGENVAL 同目录。' },
    connect: { type: 'boolean', description: '按文件顺序把同一能带连成线（仅 line-mode 的 EIGENVAL 才有物理意义；默认只画点）。' },
  },
}

/**
 * `vasp_bands`：EIGENVAL → 本征值/能带图，并给出带隙（直接/间接）。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const bandsTool = (ctx) => localTool({
  name: 'vasp_bands',
  description:
    '用户问「能带长什么样 / 带隙多少 / 直接还是间接」时用它。'
    + '把 VASP 的 EIGENVAL 画成本征值/能带图（单文件 HTML）：占据带蓝、空带橙、带隙区间高亮，'
    + '并算出 VBM、CBM 与带隙（标出直接还是间接）。传任务目录会自动找 EIGENVAL。'
    + 'MP/IBZ 格点没有高对称路径顺序，默认只画散点；line-mode 计算可加 connect=true 连线。',
  parameters: BANDS_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'path', 'nkpts', 'nbands', 'gap', 'direct'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        path: { type: 'string' },
        nkpts: { type: 'integer' },
        nbands: { type: 'integer' },
        gap: { type: 'number' },
        direct: { type: 'boolean' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Plot bands', kind: 'read', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const base = sessionDirectory(ctx, exec)
    const core = await import(`./core.js?rev=${Date.now()}`)
    const absolute = core.toAbsolute(args.path, base)
    if (!existsSync(absolute)) throw new Error(`路径不存在：${absolute}`)
    const eigenval = statSync(absolute).isDirectory() ? joinPath(absolute, 'EIGENVAL') : absolute
    if (!existsSync(eigenval)) throw new Error(`找不到 EIGENVAL：${eigenval}`)
    const generated = await core.generateBandsViewer(eigenval, { out: args.out, connect: args.connect })
    return {
      ok: true,
      summary: `能带图已生成：${generated.out}\n${generated.nkpts} 个 k 点、${generated.nbands} 条带；`
        + `带隙 ${generated.gap} eV（${generated.direct ? '直接' : '间接'}）。`,
      path: generated.out,
      nkpts: generated.nkpts,
      nbands: generated.nbands,
      gap: generated.gap,
      direct: generated.direct === true,
    }
  },
})

const REPORT_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: {
      type: 'string',
      description: 'VASP 任务目录（含 OUTCAR）、OUTCAR 文件路径，或包含多个任务的根目录（自动批量体检）。',
    },
    maxDepth: { type: 'integer', description: '批量模式下递归深度，默认 3。' },
  },
}

const REPORT_TASKS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'ok', 'energy', 'gap', 'failed'],
    properties: {
      name: { type: 'string' },
      ok: { type: 'boolean' },
      energy: { oneOf: [{ type: 'number' }, { type: 'null' }] },
      gap: { oneOf: [{ type: 'number' }, { type: 'null' }] },
      failed: { type: 'array', items: { type: 'string' } },
    },
  },
}

/**
 * `vasp_report`：单任务体检；路径下没有 OUTCAR 时自动转为批量扫描。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const reportTool = (ctx) => localTool({
  name: 'vasp_report',
  description:
    '对一个 VASP 任务做只读体检：从 OUTCAR 取最终能量、E-fermi、NELECT、NBANDS、最大力、是否正常收尾与常见告警，'
    + '再用 OSZICAR / DOSCAR / EIGENVAL 交叉核对（能量是否一致、∫DOS 是否等于 NELECT、E-fermi 是否对得上）。'
    + '如果给的是一个含多个任务子目录的根目录，会自动批量体检并汇总成一张表。'
    + '用户问「这个作业跑完没 / 结果可信吗 / 有没有报错」，或想「把这一批任务都看一遍」时用它。',
  parameters: REPORT_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'mode', 'checks', 'tasks', 'energy', 'efermi', 'nelect', 'gap'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        mode: { type: 'string' },
        energy: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        efermi: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        nelect: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        gap: { oneOf: [{ type: 'number' }, { type: 'null' }] },
        tasks: REPORT_TASKS_SCHEMA,
        checks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'ok', 'detail'],
            properties: {
              name: { type: 'string' },
              ok: { type: 'boolean' },
              detail: { type: 'string' },
            },
          },
        },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Inspect VASP task', kind: 'read', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const base = sessionDirectory(ctx, exec)
    const core = await import(`./core.js?rev=${Date.now()}`)
    const absolute = core.toAbsolute(args.path, base)
    if (!existsSync(absolute)) throw new Error(`路径不存在：${absolute}`)
    const target = statSync(absolute).isDirectory() ? absolute : dirnamePath(absolute)

    if (existsSync(joinPath(target, 'OUTCAR'))) {
      const report = await core.inspectTask(target)
      const failed = report.checks.filter((item) => !item.ok)
      const lines = report.checks.map((item) => `${item.ok ? '✔' : '✖'} ${item.name}：${item.detail}`)
      // 综合判语：体系类型 + 结果能否直接用
      const verdict = core.summarizeTask(report)
      lines.push('')
      lines.push(`判语：${verdict.electronic}　${verdict.geometry}　${verdict.spin}`)
      lines.push(`      ${verdict.verdict}`)
      const actions = core.suggestActions(report)
      if (actions.length > 0) {
        lines.push('')
        lines.push('建议：')
        for (const action of actions) lines.push(`  · ${action}`)
      }
      const head = `任务 ${target.split(/[\\/]/).pop()}`
        + `　E = ${report.outcar.sigma0 ?? '?'} eV　E-fermi = ${report.outcar.efermi ?? '?'} eV`
        + `　最大力 ${report.outcar.maxForce === null ? '?' : report.outcar.maxForce.toExponential(2)} eV/Å`
        + (report.eigenval ? `　带隙 ${report.eigenval.gap.toFixed(3)} eV（${report.eigenval.direct ? '直接' : '间接'}）` : '')
      return {
        ok: failed.length === 0,
        summary: `${head}\n${lines.join('\n')}\n${failed.length === 0 ? '结论：各项交叉核对一致。' : `结论：${failed.length} 项需要人工确认。`}`,
        mode: 'single',
        checks: report.checks,
        tasks: [{
          name: target.split(/[\\/]/).pop() ?? '',
          ok: failed.length === 0,
          energy: report.outcar.sigma0,
          gap: report.eigenval ? report.eigenval.gap : null,
          failed: failed.map((item) => item.name),
        }],
        energy: report.outcar.sigma0,
        efermi: report.outcar.efermi,
        nelect: report.outcar.nelect,
        gap: report.eigenval ? report.eigenval.gap : null,
      }
    }

    const scan = await core.scanTasks(target, { maxDepth: args.maxDepth })
    if (scan.tasks.length === 0) throw new Error(`在 ${target} 下没有找到含 OUTCAR 的任务`)
    const lines = scan.tasks.map((task) => {
      const energy = task.energy === null ? '?' : task.energy.toFixed(4)
      const gap = task.gap === null ? '—' : task.gap.toFixed(3)
      const tail = task.failed.length > 0 ? `　⚠ ${task.failed.join('；')}` : ''
      return `${task.ok ? '✔' : '✖'} ${task.name}　E = ${energy} eV　带隙 ${gap}${tail}`
    })
    const bad = scan.tasks.filter((task) => !task.ok)
    return {
      ok: bad.length === 0,
      summary: `批量体检：${target}\n扫描到 ${scan.scanned} 个任务`
        + `${scan.skipped.length > 0 ? `，跳过 ${scan.skipped.length} 个目录` : ''}\n${lines.join('\n')}\n`
        + (bad.length === 0 ? '结论：全部任务交叉核对一致。' : `结论：${bad.length} 个任务需要人工确认。`),
      mode: 'scan',
      checks: [],
      tasks: scan.tasks.map((task) => ({
        name: task.name,
        ok: task.ok,
        energy: task.energy,
        gap: task.gap,
        failed: task.failed,
      })),
      energy: null,
      efermi: null,
      nelect: null,
      gap: null,
    }
  },
})

const BATCH_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', description: '任务根目录（下面可以有多个含 OUTCAR 的任务）。' },
    outDir: { type: 'string', description: '输出目录；省略则写到 <根目录>/_figures。' },
    repeat: { type: 'array', items: { type: 'integer' }, description: '结构图的扩胞倍数 [nx,ny,nz]，默认 [1,1,1]。' },
    maxDepth: { type: 'integer', description: '递归深度，默认 3。' },
  },
}

/**
 * `vasp_batch`：整批任务出图（结构/DOS/能带）+ 索引页。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const batchTool = (ctx) => localTool({
  name: 'vasp_batch',
  description:
    '对一个 VASP 任务根目录批量出图：每个任务生成结构（有 CHGCAR 时叠等值面）、DOS、能带三份单文件 HTML，'
    + '并在顶层写一个 index.html 索引页（带带隙与失败备注）。用户说「把这批任务都出图 / 都看一下」时用它。',
  parameters: BATCH_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'index', 'tasks'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        index: { type: 'string' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'structure', 'dos', 'bands', 'conv', 'gap'],
            properties: {
              name: { type: 'string' },
              structure: { type: 'boolean' },
              dos: { type: 'boolean' },
              bands: { type: 'boolean' },
              conv: { type: 'boolean' },
              gap: { oneOf: [{ type: 'number' }, { type: 'null' }] },
            },
          },
        },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Batch figures', kind: 'execute', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const base = sessionDirectory(ctx, exec)
    const core = await import(`./core.js?rev=${Date.now()}`)
    const root = core.toAbsolute(args.path, base)
    if (!existsSync(root)) throw new Error(`路径不存在：${root}`)
    if (!statSync(root).isDirectory()) throw new Error(`需要一个任务根目录，收到的是文件：${root}`)
    const result = await core.generateBatchAtlas(root, {
      outDir: args.outDir,
      repeat: args.repeat,
      maxDepth: args.maxDepth,
    })
    if (!Array.isArray(result.tasks) || result.tasks.length === 0) {
      throw new Error(`在 ${root} 下没有找到含 OUTCAR 的任务`)
    }
    const lines = result.tasks.map((task) => {
      const parts = [task.structure ? '结构' : null, task.dos ? 'DOS' : null, task.bands ? '能带' : null, task.conv ? '收敛' : null]
        .filter(Boolean).join('+')
      const gap = task.gap === null ? '—' : `${task.gap.toFixed(3)} eV`
      return `  ${task.name}：${parts || '无产物'}　带隙 ${gap}${task.error ? `　⚠ ${task.error}` : ''}`
    })
    const failed = result.tasks.filter((task) => task.error)
    return {
      ok: failed.length === 0,
      summary: `批量出图完成：${result.tasks.length} 个任务 → ${result.outDir}\n${lines.join('\n')}\n索引页：${result.index}`,
      index: result.index,
      tasks: result.tasks.map((task) => ({
        name: task.name,
        structure: task.structure === true,
        dos: task.dos === true,
        bands: task.bands === true,
        conv: task.conv === true,
        gap: task.gap === null || task.gap === undefined ? null : task.gap,
      })),
    }
  },
})

const COMPARE_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'kind'],
  properties: {
    path: { type: 'string', description: '任务根目录（下面可以有多个含 OUTCAR 的任务）。' },
    kind: { type: 'string', enum: ['dos', 'conv'], description: 'dos = 总态密度叠加；conv = 收敛曲线叠加（log 纵轴）。' },
    names: { type: 'array', items: { type: 'string' }, description: '只对比这些任务名（默认全部）。' },
    out: { type: 'string', description: '输出 HTML 路径；省略则写到根目录下 compare-<kind>.html。' },
    window: { type: 'integer', description: 'DOS 对比时相对 E_f 的能量窗口（eV），默认 6。' },
  },
}

/**
 * `vasp_compare`：把多个任务的 DOS 或收敛曲线叠到一张图。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const compareTool = (ctx) => localTool({
  name: 'vasp_compare',
  description:
    '把同一根目录下多个任务的曲线叠到一张图上对比：kind="dos" 比总态密度（横轴 E − E_f），'
    + 'kind="conv" 比收敛速度（纵轴 log10(E − E_final)）。用户问「这两个任务比比 DOS / 谁收敛得快」时用它。',
  parameters: COMPARE_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'path', 'tasks'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        path: { type: 'string' },
        tasks: { type: 'array', items: { type: 'string' } },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: args.kind === 'conv' ? 'Compare convergence' : 'Compare DOS', kind: 'read', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const base = sessionDirectory(ctx, exec)
    const core = await import(`./core.js?rev=${Date.now()}`)
    const root = core.toAbsolute(args.path, base)
    if (!existsSync(root)) throw new Error(`路径不存在：${root}`)
    if (!statSync(root).isDirectory()) throw new Error(`需要一个任务根目录，收到的是文件：${root}`)
    const result = await core.generateCompareViewer(root, {
      kind: args.kind,
      names: args.names,
      out: args.out,
      window: args.window,
    })
    return {
      ok: true,
      summary: `对比图已生成（${result.kind}）：${result.tasks.length} 个任务\n${result.tasks.join('、')}\n${result.out}`,
      path: result.out,
      tasks: result.tasks,
    }
  },
})

const TABLE_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', description: '任务根目录。' },
    out: { type: 'string', description: '输出文件路径；省略则直接把表格文本返回。' },
    format: { type: 'string', enum: ['md', 'csv'], description: '表格格式，默认 md。' },
  },
}

/** `vasp_table`：把一批任务的体检结果导成表格。 */
const tableTool = (ctx) => localTool({
  name: 'vasp_table',
  description:
    '把任务根目录下的体检结果导成 Markdown 或 CSV 表格（能量、E/atom、E-fermi、带隙、ENCUT/ENMAX、k 网格、真空层、未通过项）。'
    + '用户要「导个表 / 汇总一下」时用它。',
  parameters: TABLE_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'path', 'tasks'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        path: { type: 'string' },
        tasks: { type: 'integer' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Export table', kind: 'read', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const base = sessionDirectory(ctx, exec)
    const core = await import(`./core.js?rev=${Date.now()}`)
    const root = core.toAbsolute(args.path, base)
    if (!existsSync(root)) throw new Error(`路径不存在：${root}`)
    // 没给 out 时给一个默认路径：脚本只在有 --out 时写文件，否则拿不到表格文本
    const format = args.format === 'csv' ? 'csv' : 'md'
    const defaultOut = joinPath(root, `table.${format}`)
    const result = await core.generateTableFile(root, { out: args.out ?? defaultOut, format })
    const text = readFileSync(result.out, 'utf8')
    return {
      ok: true,
      summary: `表格已生成：${result.out}（${result.tasks} 个任务，${result.format}）\n\n${text.trim().slice(0, 1200)}`,
      path: result.out,
      tasks: result.tasks,
    }
  },
})

const TRAJ_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', description: 'XDATCAR 文件路径，或包含 XDATCAR 的任务目录。' },
    out: { type: 'string', description: '输出 HTML 路径；省略则与 XDATCAR 同目录。' },
    oszicar: { type: 'string', description: '可选：同任务的 OSZICAR，用于在图上画离子步能量。' },
  },
}

/** `vasp_trajectory`：XDATCAR → 逐帧播放器。 */
const trajectoryTool = (ctx) => localTool({
  name: 'vasp_trajectory',
  description:
    '把 VASP 的 XDATCAR 做成离子轨迹播放器（单文件 HTML）：滑块/空格逐帧、拖拽旋转、每帧重算成键；'
    + '给 oszicar 时同步显示离子步能量曲线。用户问「松弛过程怎么走的 / 看看轨迹」时用它。',
  parameters: TRAJ_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'path', 'frames'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        path: { type: 'string' },
        frames: { type: 'integer' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Trajectory', kind: 'read', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const base = sessionDirectory(ctx, exec)
    const core = await import(`./core.js?rev=${Date.now()}`)
    const absolute = core.toAbsolute(args.path, base)
    if (!existsSync(absolute)) throw new Error(`路径不存在：${absolute}`)
    const xdatcar = statSync(absolute).isDirectory() ? joinPath(absolute, 'XDATCAR') : absolute
    if (!existsSync(xdatcar)) throw new Error(`找不到 XDATCAR：${xdatcar}`)
    const result = await core.generateTrajectoryViewer(xdatcar, { out: args.out, oszicar: args.oszicar })
    return {
      ok: true,
      summary: `轨迹播放器已生成：${result.out}\n${result.frames} 帧、${result.atoms} 个原子（${result.symbols.join('/')}）。`,
      path: result.out,
      frames: result.frames,
    }
  },
})

const PDOS_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', description: 'DOSCAR 文件路径，或包含 DOSCAR 的任务目录。' },
    out: { type: 'string', description: '输出 HTML 路径；省略则与 DOSCAR 同目录。' },
    window: { type: 'integer', description: '能量窗口（eV），默认 8。' },
  },
}

/** `vasp_pdos`：PDOS 曲线（需要 LORBIT ≥ 11）。 */
const pdosTool = (ctx) => localTool({
  name: 'vasp_pdos',
  description:
    '用户问「PDOS / 各元素各轨道的贡献」时用它。'
    + '把 DOSCAR 的投影态密度（LORBIT ≥ 11）画成按元素/轨道分层的曲线：s/p/d 用实线/虚线/点线区分，'
    + '自旋极化时上正下负。没有 PDOS 块时会明确提示需要 LORBIT=11/12 重算。',
  parameters: PDOS_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'path', 'elements'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        path: { type: 'string' },
        elements: { type: 'array', items: { type: 'string' } },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'PDOS', kind: 'read', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const base = sessionDirectory(ctx, exec)
    const core = await import(`./core.js?rev=${Date.now()}`)
    const absolute = core.toAbsolute(args.path, base)
    if (!existsSync(absolute)) throw new Error(`路径不存在：${absolute}`)
    const doscar = statSync(absolute).isDirectory() ? joinPath(absolute, 'DOSCAR') : absolute
    if (!existsSync(doscar)) throw new Error(`找不到 DOSCAR：${doscar}`)
    const result = await core.generatePdosViewer(doscar, { out: args.out, window: args.window })
    return {
      ok: true,
      summary: `PDOS 图已生成：${result.out}\n元素 ${result.elements.join('/')}，轨道 ${result.orbitals.join('/')}${result.spinPolarized ? '，自旋极化' : ''}。`,
      path: result.out,
      elements: result.elements,
    }
  },
})

const ANALYZE_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'kind'],
  properties: {
    path: { type: 'string', description: '结构文件（POSCAR / CONTCAR / CIF …）。' },
    kind: { type: 'string', enum: ['structure', 'bond', 'angle', 'poly', 'calcf'], description: 'structure=空间群与晶胞参数；bond=键长；angle=键角；poly=配位多面体；calcf=X 射线结构因子（-calcf）' },
  },
}

/**
 * `vesta_analyze`：让 VESTA 自己算，再读它的文本区（-list bond/angle）。
 * @param {object} config - 插件配置（含可执行文件路径）。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const analyzeTool = (config, ctx) => localTool({
  name: 'vesta_analyze',
  description:
    '用户问「VESTA 说这个结构的空间群 / 键长 / 配位多面体是多少」时用它。'
    + '用 VESTA 自己的计算做交叉验证：kind="structure" 读它报告的空间群与 a/b/c/α/β/γ/V 并与我们的解析对照；'
    + 'kind="bond" 读它列出的键长（-list bond）；kind="angle" 读键角；kind="poly" 原样返回多面体输出。'
    + '需要本机安装 VESTA（会临时打开一个窗口，读完自动关闭）。',
  parameters: ANALYZE_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'kind'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        kind: { type: 'string' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'VESTA analyze', kind: 'read', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const core = await import(`./core.js?rev=${Date.now()}`)
    const base = sessionDirectory(ctx, exec)
    const file = core.toAbsolute(args.path, base)
    if (!existsSync(file)) throw new Error(`路径不存在：${file}`)
    if (args.kind === 'calcf') {
      // 结构因子走脚本（它负责把输入复制到无点目录、补 VASP4 元素行）
      const result = await core.generateCalcf(file)
      const lines = [`结构因子：${result.count} 条反射　d 范围 ${result.dRange[0].toFixed(4)} → ${result.dRange[1].toFixed(4)} Å`]
      lines.push('最强的 5 条：')
      for (const item of result.strongest.slice(0, 5)) {
        lines.push(`  (${item.hkl.join(' ')})　d = ${item.d.toFixed(4)} Å　|F| = ${item.abs.toFixed(3)}`)
      }
      return { ok: true, summary: lines.join('\n'), kind: 'calcf' }
    }
    const result = await core.analyzeWithVesta(config, file, args.kind)
    const lines = []
    if (result.kind === 'structure' && result.structure) {
      const their = result.structure
      const potcar = joinPath(dirnamePath(file), 'POTCAR')
      const symbols = existsSync(potcar) ? core.potcarElements(readFileSync(potcar, 'utf8')) : undefined
      const ours = core.parsePoscar(readFileSync(file, 'utf8'), 'file', { symbols })
      const params = core.cellParameters([ours.a1, ours.a2, ours.a3])
      const fmt = (value) => (value === null || value === undefined ? '—' : value.toFixed(5))
      lines.push(`VESTA：空间群 ${their.spaceGroup ?? '?'}（#${their.spaceGroupNumber ?? '?'}）`)
      lines.push(`  a = ${fmt(their.a)}  b = ${fmt(their.b)}  c = ${fmt(their.c)}`)
      lines.push(`  α = ${fmt(their.alpha)}  β = ${fmt(their.beta)}  γ = ${fmt(their.gamma)}  V = ${fmt(their.volume)}`)
      lines.push(`我们：a = ${fmt(params.a)}  V = ${fmt(params.volume)}`)
      const delta = their.volume === null ? null : Math.abs(their.volume - params.volume)
      lines.push(delta !== null && delta < 1e-3 ? '结论：晶胞参数与体积一致。' : '结论：存在差异，需要检查。')
    } else if (result.kind === 'bond' && result.bonds) {
      const pairs = result.bonds.pairs
      if (pairs.length === 0) lines.push('VESTA 没有列出任何键')
      else {
        const shortest = Math.min(...pairs.map((item) => item.length))
        lines.push(`VESTA 列出 ${pairs.length} 对键，最短 ${shortest.toFixed(5)} Å`)
        for (const item of pairs.slice(0, 8)) lines.push(`  ${item.pair}　${item.length.toFixed(5)} Å`)
        // 同一判据下我们自己的键表（查看器用 1.25×(r_i+r_j)，上限 2.6 Å）
        const potcar = joinPath(dirnamePath(file), 'POTCAR')
        const symbols = existsSync(potcar) ? core.potcarElements(readFileSync(potcar, 'utf8')) : undefined
        const ours = core.bondList(core.parsePoscar(readFileSync(file, 'utf8'), 'file', { symbols }))
        lines.push(`我们（同一判据）：${ours.length} 对`)
        for (const bond of ours.slice(0, 8)) lines.push(`  ${bond.symbols}　${bond.length.toFixed(5)} Å`)
      }
    } else if (result.kind === 'angle' && result.angles) {
      const triples = result.angles.triples
      lines.push(`VESTA 列出 ${triples.length} 个键角（条目 ${result.angles.count} 条，含对称像）`)
      for (const item of triples.slice(0, 8)) lines.push(`  ${item.triple}　${item.angle.toFixed(4)}°`)
    } else if (result.kind === 'poly' && result.poly) {
      const polyhedra = result.poly.polyhedra
      lines.push(`VESTA 列出 ${polyhedra.length} 个配位多面体`)
      for (const item of polyhedra.slice(0, 6)) {
        const center = item.center ? item.center.label : '?'
        lines.push(`  ${center}：配位数 ${item.effectiveCoordination ?? '—'}，平均键长 ${item.averageBond?.toFixed(4) ?? '—'} Å`)
        lines.push(`    体积 ${item.volume?.toFixed(4) ?? '—'} Å³　畸变指数 ${item.distortionIndex ?? '—'}　二次伸长 ${item.quadraticElongation ?? '—'}`)
        lines.push(`    键角方差 ${item.bondAngleVariance ?? '—'} deg²`)
      }
    } else {
      lines.push(result.text.slice(-1200))
    }
    return { ok: true, summary: lines.join('\n'), kind: result.kind }
  },
})

const VOLUME_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'kind'],
  properties: {
    path: { type: 'string', description: '体积文件路径（CHGCAR / CHG / PARCHG / ELFCAR / LOCPOT / .cube）或所在任务目录。' },
    kind: { type: 'string', enum: ['slice', 'profile', 'peaks', 'derived', 'charges'], description: 'slice=二维截面；profile=一维线剖面；peaks=峰搜索与每峰电荷；derived=∇²ρ 与动能/能量密度；charges=每原子电荷（离散 Voronoi / Bader 近似）' },
    plane: { type: 'string', enum: ['xy', 'yz', 'zx'], description: 'slice 用：截面方向，默认 xy。' },
    at: { type: 'number', description: 'slice 用：截面位置（分数坐标 0–1），默认 0.5。' },
    from: { type: 'string', description: 'profile 用：起点分数坐标 "x,y,z"，默认 "0,0,0"。' },
    to: { type: 'string', description: 'profile 用：终点分数坐标，默认 "0.5,0.5,0.5"。' },
    points: { type: 'integer', description: 'profile 用：采样点数，默认 50。' },
    maxPeaks: { type: 'integer', description: 'peaks 用：最多列出多少个峰，默认 20。' },
    threshold: { type: 'number', description: 'peaks 用：峰阈值（低于此值不算峰），单位与体积文件一致（CHGCAR 为 e/Å³）；默认取峰值的 20%。' },
    out: { type: 'string', description: '输出文件路径，按 kind 决定类型：slice=HTML、profile=TXT、peaks=TXT、derived=TED 体积文本、charges=CSV；不给时 slice 写同目录 HTML，其余只返回统计。' },
  },
}

/**
 * `volume_analyze`：体积数据的四种分析（截面 / 线剖面 / 峰搜索 / 派生量）。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const volumeTool = (ctx) => localTool({
  name: 'volume_analyze',
  description:
    '用户问「这个 CHGCAR 的截面 / 线剖面 / 峰在哪 / ∇²ρ 长什么样」时用它。'
    + '对 VASP 体积文件（CHGCAR/CHG/PARCHG/ELFCAR/LOCPOT/.cube）做分析：'
    + 'kind="slice" 画二维截面（可切 xy/yz/zx、拖动位置）；kind="profile" 沿线段取样（VESTA 线剖面格式）；'
    + 'kind="peaks" 找峰并给出每峰积分电荷与 Voronoi 体积；kind="derived" 算 ∇²ρ 与动能/能量密度（手册 14.15）。',
  parameters: VOLUME_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'kind'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        kind: { type: 'string' },
        path: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: `Volume ${args.kind}`, kind: 'read', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const core = await import(`./core.js?rev=${Date.now()}`)
    const base = sessionDirectory(ctx, exec)
    const absolute = core.toAbsolute(args.path, base)
    if (!existsSync(absolute)) throw new Error(`路径不存在：${absolute}`)
    const volumePath = statSync(absolute).isDirectory() ? joinPath(absolute, 'CHGCAR') : absolute
    if (!existsSync(volumePath)) throw new Error(`找不到体积文件：${volumePath}`)
    if (args.kind === 'slice') {
      const result = await core.generateSliceViewer(volumePath, { plane: args.plane, at: args.at, out: args.out })
      return {
        ok: true,
        kind: 'slice',
        path: result.out,
        summary: `截面图已生成：${result.out}\n方向 ${result.plane}　位置 ${result.at}　网格 ${result.dims.join('×')}\n`
          + `该面量程 ${result.stats.min.toExponential(3)} → ${result.stats.max.toExponential(3)}，均值 ${result.stats.mean.toExponential(3)} ${result.unit}`,
      }
    }
    if (args.kind === 'profile') {
      const result = await core.generateLineProfile(volumePath, { from: args.from, to: args.to, points: args.points, out: args.out })
      return {
        ok: true,
        kind: 'profile',
        path: result.out ?? null,
        summary: `线剖面：${args.from ?? '0,0,0'} → ${args.to ?? '0.5,0.5,0.5'}，线段长 ${result.total} Å，${result.points} 点\n`
          + `最大值 ${result.max?.value} @ ${result.max?.distance} Å；最小值 ${result.min?.value} @ ${result.min?.distance} Å`
          + (result.out ? `\n已写出：${result.out}` : ''),
      }
    }
    if (args.kind === 'peaks') {
      const result = await core.generatePeakSearch(volumePath, { maxPeaks: args.maxPeaks, threshold: args.threshold, out: args.out })
      const peaks = (result.peaks ?? []).slice(0, 6)
      const lines = peaks.map((peak) => `  (${peak.frac.map((value) => value.toFixed(3)).join(', ')})　${peak.value.toExponential(3)}　${peak.electrons.toExponential(3)} e`)
      return {
        ok: true,
        kind: 'peaks',
        path: result.out ?? null,
        summary: `峰搜索：整胞积分 ${result.total}，峰数 ${result.peakCount ?? (result.peaks ?? []).length}\n${lines.join('\n')}`
          + (result.out ? `\n已写出：${result.out}` : ''),
      }
    }
    if (args.kind === 'charges') {
      const result = await core.generateChargePartition(volumePath, { out: args.out })
      const rows = Object.entries(result.byElement ?? {})
        .map(([symbol, entry]) => `  ${symbol}：${entry.count} 个原子，每原子 ${entry.perAtom} e`)
      return {
        ok: true,
        kind: 'charges',
        path: result.out ?? null,
        summary: `每原子电荷（离散 Voronoi 近似）`
          + `\n总电荷 ${result.total} e` + (result.nelect === null ? '' : `，NELECT ${result.nelect} e`)
          + `\n${rows.join('\n')}`
          + (result.out ? `\n已写出：${result.out}` : ''),
      }
    }
    const result = await core.generateDensityDerived(volumePath, { outHe: args.out })
    return {
      ok: true,
      kind: 'derived',
      path: result.outHe ?? null,
      summary: `派生量（${result.unit}）：∇²ρ ${result.laplacian.min} → ${result.laplacian.max}\n`
        + `g ${result.kinetic.min} → ${result.kinetic.max}　h_e ${result.energy.min} → ${result.energy.max}`
        + (result.outHe ? `\n已写出 h_e：${result.outHe}` : ''),
    }
  },
})

const POWDER_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', description: '结构文件（POSCAR / CONTCAR / CIF）。' },
    lambda: { type: 'number', description: 'X 射线波长（Å），默认 1.5406（Cu Kα1）。' },
    twoThetaMax: { type: 'number', description: '2θ 上限（度），默认 90。' },
    fwhm: { type: 'number', description: '高斯展宽的 FWHM（度），默认 0.15；填 0 只画棒图。' },
    out: { type: 'string', description: '输出 HTML 路径；省略则与结构文件同目录。' },
  },
}

/**
 * `xray_powder`：由结构算 X 射线粉末衍射图谱（本地计算，不需要 VASP/VESTA 运行）。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const powderTool = (ctx) => localTool({
  name: 'xray_powder',
  description:
    '由结构文件算 X 射线粉末衍射图谱并生成单文件 HTML：棒图 + 高斯展宽、峰标 hkl、悬停读数。'
    + '用户问「这个结构的 XRD / 粉末衍射峰在哪些角度」时用它。强度已含多重度与 Lorentz–偏振因子。',
  parameters: POWDER_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'path', 'peaks'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        path: { type: 'string' },
        peaks: { type: 'integer' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'XRD powder pattern', kind: 'read', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const core = await import(`./core.js?rev=${Date.now()}`)
    const base = sessionDirectory(ctx, exec)
    const file = core.toAbsolute(args.path, base)
    if (!existsSync(file)) throw new Error(`路径不存在：${file}`)
    const result = await core.generatePowderViewer(file, {
      lambda: args.lambda,
      twoThetaMax: args.twoThetaMax,
      fwhm: args.fwhm,
      out: args.out,
    })
    return {
      ok: true,
      summary: `粉末图谱已生成：${result.out}\nλ = ${result.lambda} Å，${result.peaks} 个峰`
        + (result.strongest ? `；最强峰 2θ = ${result.strongest.twoTheta}°，d = ${result.strongest.d} Å` : ''),
      path: result.out,
      peaks: result.peaks,
    }
  },
})

const SLAB_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', description: '任务根目录（含多个 POSCAR/CONTCAR 子目录），或单个结构文件。' },
    adsorbate: { type: 'string', description: '吸附物元素，默认 Na。' },
    substrate: { type: 'string', description: '基底元素，多个用逗号分隔，默认 C。' },
    marker: { type: 'string', description: '任务标志文件，默认 POSCAR；也可用 CONTCAR。' },
    depth: { type: 'integer', description: '递归深度，默认 2。' },
    out: { type: 'string', description: '输出 Markdown 路径；同目录会另写一份 CSV。' },
  },
}

/**
 * `slab_report`：批量分析板层/吸附体系，出「位点 / 吸附高度 / 最近距离 / 真空厚度」表。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const slabTool = (ctx) => localTool({
  name: 'slab_report',
  description:
    '批量分析板层/吸附体系：每个任务目录读一个 POSCAR/CONTCAR，输出位点（top/bridge/hollow）、'
    + '吸附高度、最近面内距离、真空厚度，并写成 Markdown + CSV 表。用户问「这批吸附构型的位点和高度」时用它。',
  parameters: SLAB_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'tasks', 'path'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        tasks: { type: 'integer' },
        path: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Slab report', kind: 'read', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const core = await import(`./core.js?rev=${Date.now()}`)
    const base = sessionDirectory(ctx, exec)
    const absolute = core.toAbsolute(args.path, base)
    if (!existsSync(absolute)) throw new Error(`路径不存在：${absolute}`)
    const root = statSync(absolute).isDirectory() ? absolute : joinPath(absolute, '..')
    const result = await core.generateSlabReport(root, {
      adsorbate: args.adsorbate,
      substrate: args.substrate,
      marker: args.marker,
      depth: args.depth,
      out: args.out,
    })
    const sites = Object.entries(result.sites ?? {}).map(([site, count]) => `${site}×${count}`).join('，')
    return {
      ok: true,
      tasks: result.tasks,
      path: result.out ?? null,
      summary: `板层报表：${result.tasks} 个任务，其中 ${result.withAdsorbate} 个含吸附物`
        + (sites ? `\n位点分布：${sites}` : '')
        + (result.out ? `\n已写出：${result.out}（同名 .csv 一并生成）` : ''),
    }
  },
})

const WORKFUNCTION_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', description: 'LOCPOT 文件，或包含 LOCPOT 与 OUTCAR 的任务目录。' },
    axis: { type: 'string', enum: ['a', 'b', 'c'], description: '板层法向轴，默认 c。' },
    efermi: { type: 'number', description: '费米能级（eV）；省略时从同目录 OUTCAR 读。' },
    out: { type: 'string', description: '输出 HTML 路径；省略则写到 LOCPOT 同目录。' },
  },
}

/**
 * `work_function`：由 LOCPOT 的平面平均电势算功函数，并出剖面图。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const workFunctionTool = (ctx) => localTool({
  name: 'work_function',
  description:
    '由 LOCPOT 的平面平均静电势算功函数 Φ = E_vac − E_F，并生成剖面图 HTML（标出真空平台、E_F、Φ）。'
    + '用户问「功函数多少 / 真空能级在哪」时用它；费米能级默认从同目录 OUTCAR 读。',
  parameters: WORKFUNCTION_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'path', 'workFunction'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        path: { type: 'string' },
        workFunction: { type: 'number' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Work function', kind: 'read', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const core = await import(`./core.js?rev=${Date.now()}`)
    const base = sessionDirectory(ctx, exec)
    const absolute = core.toAbsolute(args.path, base)
    if (!existsSync(absolute)) throw new Error(`路径不存在：${absolute}`)
    const result = await core.generateWorkFunctionViewer(absolute, {
      axis: args.axis, efermi: args.efermi, out: args.out,
    })
    return {
      ok: true,
      path: result.out,
      workFunction: result.workFunction,
      summary: `功函数 Φ = ${result.workFunction.toFixed(3)} eV`
        + `\n真空能级 E_vac = ${result.vacuumLevel.toFixed(3)} eV，费米能级 E_F = ${result.efermi.toFixed(3)} eV`
        + `\n真空平台：${result.plateau.start.toFixed(2)} → ${result.plateau.end.toFixed(2)} Å（长 ${result.plateau.length.toFixed(2)} Å）`
        + `\n剖面图：${result.out}`,
    }
  },
})

const CHECK_STRUCTURE_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', description: '结构文件（POSCAR/CONTCAR），或含多个结构的任务根目录。' },
    marker: { type: 'string', description: '批量时的文件名，默认 POSCAR；也可用 CONTCAR。' },
    minDistance: { type: 'number', description: '过近阈值（Å），默认 0.5；小于它的原子对给出提示。' },
  },
}

/**
 * `check_structure`：跑 VASP 之前的结构预检（晶胞/越界/重合/过近）。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const checkStructureTool = (ctx) => localTool({
  name: 'check_structure',
  description:
    '结构预检：检查晶胞体积/角度、原子数、坐标越界、原子重合与过近，批量可扫整个目录。'
    + '用户问「这个结构有没有问题 / 能不能直接拿去算」时用它。',
  parameters: CHECK_STRUCTURE_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'files', 'errors'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        files: { type: 'integer' },
        errors: { type: 'integer' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Structure check', kind: 'read', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const core = await import(`./core.js?rev=${Date.now()}`)
    const base = sessionDirectory(ctx, exec)
    const target = core.toAbsolute(args.path, base)
    if (!existsSync(target)) throw new Error(`路径不存在：${target}`)
    const result = await core.generateStructureCheck(target, {
      marker: args.marker, minDistance: args.minDistance,
    })
    const problems = result.problems ?? []
    const lines = problems.flatMap((item) => [`  ${item.file}：${item.issues.join('；')}`])
    return {
      ok: (result.errors ?? 0) === 0,
      files: result.files,
      errors: result.errors,
      summary: `结构预检：${result.files} 个结构，${result.errors} 个有 error`
        + (lines.length > 0 ? `\n${lines.join('\n')}` : '\n未发现问题'),
    }
  },
})

// ---------------------------------------------------------------------------
// 输入注入工具（鼠标/键盘直接操作 3D 视图，见 win/vesta-ui.ps1 的 drag/wheel/key/clickat/type）
// ---------------------------------------------------------------------------

const INPUT_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ['drag', 'wheel', 'key', 'click', 'type', 'undo', 'redo'],
      description: 'drag=拖拽旋转；wheel=滚轮缩放；key=按键；click=视图内点击；type=打字；undo=撤销上一次拖拽/缩放/按键；redo=重做',
    },
    pid: { type: 'integer', description: 'VESTA 进程 pid（多窗口时指定作用在哪个窗口；取自 vesta_open 返回）。' },
    dx: { type: 'number', description: 'drag：水平位移，像素，正数向右（默认 120）。' },
    dy: { type: 'number', description: 'drag：垂直位移，正数向下（默认 0）。' },
    x: { type: 'number', description: '起点或点击点的客户区 X；省略取视图中心。' },
    y: { type: 'number', description: '同上，Y。' },
    delta: { type: 'number', description: 'wheel：滚动量，正数放大（默认 120，一格）。' },
    count: { type: 'integer', description: 'wheel/key：重复次数（默认 1）。' },
    key: { type: 'string', description: 'key：键名 left/right/up/down/pageup/pagedown/home/end/plus/minus（也可给虚拟键码数字）。' },
    ctrl: { type: 'boolean', description: 'key：是否按住 Ctrl。' },
    text: { type: 'string', description: 'type：要输入的文本。' },
    enter: { type: 'boolean', description: 'type：输入前后各按一次回车（用于确认对话框）。' },
    verify: { type: 'boolean', description: 'true = 自动前后截图对比，返回 verified/hash，用来确认操作真的生效。' },
  },
}

/**
 * `vesta_input`：向 VESTA 的 3D 视图注入鼠标/键盘（等价于直接操作）。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const inputTool = (ctx) => localTool({
  name: 'vesta_input',
  description:
    '直接操作 VESTA 的 3D 视图，等价于用鼠标键盘：拖拽旋转（drag）、滚轮缩放（wheel）、方向键旋转（key）、'
    + '在视图里点击（click）、向对话框打字（type）。当用户说「转一下/换个角度/放大缩小/点一下/把视图摆正」时用它；'
    + '支持 undo/redo：拖拽、滚轮、按键都可以精确撤销（实测反向操作能回到逐字节相同的画面）。'
    + '给 verify=true 会前后截图对比，确认这次操作真的改变了画面。它是 Win32 消息注入，不需要窗口在前台。',
  parameters: INPUT_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'action', 'ms'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        action: { type: 'string' },
        pid: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
        client: { type: 'string' },
        ms: { type: 'integer' },
        verified: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
        beforeHash: { type: 'string' },
        afterHash: { type: 'string' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'VESTA input', kind: 'execute', rawInput: { action: args.action } }),
  async execute(args, exec) {
    const core = await import(`./core.js?rev=${Date.now()}`)
    const base = sessionDirectory(ctx, exec)
    const target = Number.isInteger(args.pid) ? { pid: args.pid } : 'main'
    const action = String(args.action)

    // 可选：操作前后各截一张图，用哈希判断画面是否真的变了
    let beforeHash = ''
    let beforePath = ''
    if (args.verify) {
      beforePath = core.toAbsolute(`.dsh-vesta-input-${Date.now()}-before.png`, base)
      const shot = await core.captureWindow({
        ...(Number.isInteger(args.pid) ? { pid: args.pid } : { window: 'main' }),
        out: beforePath,
      })
      beforeHash = core.hashFile(shot.path)
    }

    if (action === 'undo' || action === 'redo') {
      const outcome = action === 'undo' ? await core.undoInput(target) : await core.redoInput(target)
      const moved = action === 'undo' ? outcome.undone : outcome.redone
      const history = core.getInputHistory(Number.isInteger(args.pid) ? args.pid : 0)
      if (!moved) {
        return {
          ok: true,
          summary: action === 'undo' ? '没有可撤销的视图操作（只记录拖拽/滚轮/按键）' : '没有可重做的操作',
          action,
          pid: Number.isInteger(args.pid) ? args.pid : null,
          client: '',
          ms: 0,
          verified: null,
          beforeHash: '',
          afterHash: '',
        }
      }
      return {
        ok: true,
        summary: (action === 'undo' ? '已撤销 ' : '已重做 ')
          + moved.action + JSON.stringify(moved.options)
          + '（剩余可撤销 ' + history.undo.length + ' 步，可重做 ' + history.redo.length + ' 步）',
        action,
        pid: Number.isInteger(args.pid) ? args.pid : null,
        client: '',
        ms: 0,
        verified: null,
        beforeHash: '',
        afterHash: '',
      }
    }

    const result = await core.injectInput(target, action, {
      dx: args.dx, dy: args.dy, x: args.x, y: args.y,
      delta: args.delta, count: args.count, key: args.key, ctrl: args.ctrl,
      text: args.text, enter: args.enter,
    })

    let afterHash = ''
    let verified = null
    if (args.verify) {
      const afterPath = core.toAbsolute(`.dsh-vesta-input-${Date.now()}-after.png`, base)
      const shot = await core.captureWindow({
        ...(Number.isInteger(args.pid) ? { pid: args.pid } : { window: 'main' }),
        out: afterPath,
      })
      afterHash = core.hashFile(shot.path)
      verified = beforeHash !== afterHash
    }

    const describe = {
      drag: `拖拽 ${result.from?.x},${result.from?.y} → ${result.to?.x},${result.to?.y}`,
      wheel: `滚轮 ${result.delta} × ${result.count}`,
      key: `按键 vk=${result.vk} × ${result.count}${result.ctrl ? '（Ctrl）' : ''}`,
      click: `点击 ${result.at?.x},${result.at?.y}`,
      type: `输入 ${result.typed} 个字符${result.enter ? '（带回车）' : ''}`,
    }[action] ?? action

    const verifiedText = verified === null ? '' : (verified ? '，画面已变化 ✓' : '，画面未变化（可能已到边界或该动作无视觉影响）')
    return {
      ok: true,
      summary: `${describe}（视图 ${result.client ?? '未知'}，耗时 ${result.ms} ms）${verifiedText}`,
      action,
      pid: result.pid ?? null,
      client: result.client ?? '',
      ms: result.ms ?? 0,
      verified,
      beforeHash,
      afterHash,
    }
  },
})

// ---------------------------------------------------------------------------
// CLI 批量出图（.vesta 模板 + -rotate_* + -export_img，见 docs/VESTA.md）
// ---------------------------------------------------------------------------

const RENDER_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', description: '结构/体积文件（POSCAR、CIF、CUBE…），或含结构的任务目录。' },
    outDir: { type: 'string', description: '输出目录；省略则写 <结构所在目录>/vesta-render。' },
    scale: { type: 'integer', description: '放大倍数（1–6），默认 2；scale=2 时 706×553 的窗口导出 1412×1106。' },
    template: { type: 'string', description: '场景模板 .vesta 路径：给了就先用模板的显示设置包住该结构，再出图（批量风格一致）。' },
    background: {
      type: 'array',
      description: '背景色 [r,g,b]（0–255）。实测 VESTA 认场景文件里的 BKGRC（渲染后角落像素会变）。',
      items: { type: 'integer' },
    },
    model: { type: 'integer', description: '显示模型：0=球棍（默认）、1=空间填充。实测 VESTA 认 STYLE 的 MODEL 字段。' },
    boundary: {
      type: 'array',
      description: '显示边界：三个方向各一对 [起, 止]，如 [[-1,2],[-1,2],[-1,2]] 显示 3×3×3 个晶胞。只对给了 template 的场景生效。',
      items: { type: 'array', items: { type: 'integer' } },
    },
    views: {
      type: 'array',
      description: '视角列表；每项 {name, rx, ry, rz, scale}。省略则只出默认视角一张。',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: '文件名（不含扩展名）。' },
          rx: { type: 'number', description: '绕 x 轴旋转角度（度）。' },
          ry: { type: 'number', description: '绕 y 轴旋转角度（度）。' },
          rz: { type: 'number', description: '绕 z 轴旋转角度（度）。' },
          scale: { type: 'integer', description: '该视角的放大倍数（覆盖全局 scale）。' },
        },
      },
    },
  },
}

/**
 * `vesta_render`：用 VESTA 命令行批量出图（不用 GUI 交互），每张图可追溯。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const renderTool = (merged, ctx) => localTool({
  name: 'vesta_render',
  description:
    '用 VESTA 的命令行接口批量出图：同一结构、同一套渲染设置，只换视角（-rotate_x/y/z）与放大倍数（-export_img scale=N），'
    + '跑完写一份 manifest.json（输入文件 sha256、参数、输出、大小、耗时），保证每张图可追溯。'
    + '当用户要「批量出图 / 统一风格的图 / 高分辨率导出 / 多角度看同一个结构」时用它；不需要打开 GUI、不需要点菜单。',
  parameters: RENDER_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'outDir', 'manifest', 'renders'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        outDir: { type: 'string' },
        manifest: { type: 'string' },
        renders: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'out', 'bytes', 'ms'],
            properties: {
              name: { type: 'string' },
              out: { type: 'string' },
              bytes: { type: 'integer' },
              ms: { type: 'integer' },
            },
          },
        },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Render with VESTA CLI', kind: 'execute', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const core = await import(`./core.js?rev=${Date.now()}`)
    const base = sessionDirectory(ctx, exec)
    const target = core.resolveTarget(args.path, base)
    const result = await core.renderViewsWithCli(merged, {
      structure: target,
      outDir: args.outDir ? core.toAbsolute(args.outDir, base) : undefined,
      scale: args.scale,
      template: args.template ? core.toAbsolute(args.template, base) : undefined,
      sceneStyle: (args.background || args.model !== undefined || args.boundary)
        ? { background: args.background, model: args.model, boundary: args.boundary } : undefined,
      views: args.views,
    })
    const lines = result.renders.map((item) => {
      const angles = [item.view.rx ? 'rx=' + item.view.rx : '', item.view.ry ? 'ry=' + item.view.ry : '', item.view.rz ? 'rz=' + item.view.rz : '']
        .filter(Boolean).join(' ')
      return `  ${item.name}.png（${Math.round(item.bytes / 1024)} KB，scale=${item.scale}${angles ? '，' + angles : ''}，${item.ms} ms）`
    })
    return {
      ok: true,
      summary: `VESTA CLI 批量出图：${result.renders.length} 张，输出目录 ${result.outDir}`
    + (args.template ? `\n模板：${args.template}` : '')
    + `\n${lines.join('\n')}\n清单：${result.manifest}`,
      outDir: result.outDir,
      manifest: result.manifest,
      renders: result.renders.map((item) => ({ name: item.name, out: item.out, bytes: item.bytes, ms: item.ms })),
    }
  },
})

// ---------------------------------------------------------------------------
// 结构编辑（替代 VESTA 的 Edit Data 对话框：扩胞、任意整数矩阵、元素替换）
// ---------------------------------------------------------------------------

const EDIT_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', description: '输入结构：POSCAR/CONTCAR 或 CIF，或包含它的任务目录。' },
    repeat: {
      type: 'array',
      description: '扩胞倍数 [nx, ny, nz]（正整数），等价于 P = diag(nx,ny,nz)。',
      items: { type: 'integer' },
    },
    matrix: {
      type: 'array',
      description: '任意 3×3 整数变换矩阵（VESTA 的 Rotation matrix (P)：新基矢 = P·旧基矢）。',
      items: { type: 'array', items: { type: 'integer' } },
    },
    substitute: {
      type: 'object',
      description: '同位置换元素，例如 {from:"Si", to:"C"}。',
      additionalProperties: false,
      required: ['from', 'to'],
      properties: {
        from: { type: 'string', description: '被替换的元素符号。' },
        to: { type: 'string', description: '替换成的新元素符号。' },
      },
    },
    cell: {
      type: 'object',
      description: '修改晶胞参数（只给要改的项）：{a,b,c,alpha,beta,gamma}，长度 Å、角度度。',
      additionalProperties: false,
      properties: {
        a: { type: 'number', description: 'a 轴长度（Å）。' },
        b: { type: 'number', description: 'b 轴长度（Å）。' },
        c: { type: 'number', description: 'c 轴长度（Å）。' },
        alpha: { type: 'number', description: 'α 角（度）。' },
        beta: { type: 'number', description: 'β 角（度）。' },
        gamma: { type: 'number', description: 'γ 角（度）。' },
      },
    },
    add: {
      type: 'array',
      description: '追加原子：[{symbol:"C", frac:[x,y,z]}]，分数坐标会自动折回 [0,1)。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['symbol', 'frac'],
        properties: {
          symbol: { type: 'string', description: '元素符号。' },
          frac: { type: 'array', items: { type: 'number' }, description: '分数坐标 [x,y,z]。' },
        },
      },
    },
    remove: {
      type: 'object',
      description: '删除原子：按索引（0 基）或按元素。',
      additionalProperties: false,
      properties: {
        indexes: { type: 'array', items: { type: 'integer' }, description: '要删除的原子索引（0 基）。' },
        species: { type: 'string', description: '要删除的元素符号（删除该元素全部原子）。' },
      },
    },
    refineCell: {
      type: 'boolean',
      description: '配合 symmetrize 使用：同时把晶胞投射到该空间群的对称约束上（度规张量最小二乘投影），默认 false。',
    },
    symmetrize: {
      type: 'integer',
      description: '按空间群编号做对称化（把近似满足该群的结构投射到严格对称位置），1–230。',
      minimum: 1,
      maximum: 230,
    },
    reduceSpaceGroup: {
      type: 'integer',
      description: '按空间群编号把完整晶胞约化为不对称单元（与 spaceGroup 互逆），并给出每个轨道的多重度。',
      minimum: 1,
      maximum: 230,
    },
    spaceGroup: {
      type: 'integer',
      description: '按空间群编号（1–230）把当前结构当作不对称单元展开成完整晶胞（等价于 VESTA 的 Apply symmetry operations）。',
      minimum: 1,
      maximum: 230,
    },
    out: { type: 'string', description: '输出路径；扩展名 .cif 写 CIF，其余写 POSCAR。省略则写在输入同目录，文件名带变换后缀。' },
    open: { type: 'boolean', description: 'true = 生成后立刻在 VESTA 里打开（返回 pid）。' },
  },
}

/**
 * `vesta_edit`：结构编辑（扩胞 / 变换矩阵 / 元素替换），不依赖 VESTA 的对话框。
 * @param {object} merged - 配置。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const editTool = (merged, ctx) => localTool({
  name: 'vesta_edit',
  description:
    '直接编辑晶体结构并写出新的 POSCAR：扩胞（repeat=[2,2,1]）、任意整数变换矩阵（matrix，语义同 VESTA 的 Unit Cell Transformation）、'
    + '同位置换元素（substitute）。当用户说「扩胞 / 超胞 / 换成 2×2×1 / 把 Si 换成 C」时用它；'
    + '它自己算原子，不依赖 VESTA 的对话框（VESTA 的 wx 对话框无法被外部消息驱动）。',
  parameters: EDIT_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'out', 'atoms', 'cell'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        out: { type: 'string' },
        atoms: { type: 'integer' },
        cell: {
          type: 'object',
          additionalProperties: false,
          required: ['a', 'b', 'c', 'alpha', 'beta', 'gamma'],
          properties: {
            a: { type: 'number' }, b: { type: 'number' }, c: { type: 'number' },
            alpha: { type: 'number' }, beta: { type: 'number' }, gamma: { type: 'number' },
          },
        },
        elements: { type: 'array', items: { type: 'string' } },
        pid: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Edit structure', kind: 'execute', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const core = await import(`./core.js?rev=${Date.now()}`)
    const base = sessionDirectory(ctx, exec)
    const input = core.resolveTarget(args.path, base)
    const { readFileSync: readText, writeFileSync: writeText } = await import('node:fs')
    const rawText = readText(input, 'utf8')
    // 记录实际做了哪些编辑（CIF 回退转换也会写进来，所以先声明）
    const applied = []
    // 输入可以是 POSCAR 也可以是 CIF（CIF 用自带对称操作或回退 spgra.dat 展开）
    let structure
    if (/\.cif$/i.test(input)) {
      // CIF 自带 _space_group_symop_operation_xyz 就自己展开；没有的话交给 VESTA 转一次更稳：
      // spgra.dat 里有些群只存了一半操作（如 P21/c 只有 2 条，完整群有 4 条），自己展开会少一半原子
      const parsedCif = core.parseCif(rawText)
      if (parsedCif.ops.length > 0) {
        const fromCif = core.structureFromCif(rawText)
        structure = { a1: fromCif.a1, a2: fromCif.a2, a3: fromCif.a3, atoms: fromCif.atoms }
      } else {
        const { mkdtempSync } = await import('node:fs')
        const { tmpdir } = await import('node:os')
        const { join: joinPath } = await import('node:path')
        const tempDir = mkdtempSync(joinPath(tmpdir(), 'dsh-cif-'))
        const tempPoscar = joinPath(tempDir, 'converted.vasp')
        await core.convertWithVesta(merged, input, tempPoscar, { timeoutMs: 90000 })
        const parsedPoscar = core.parsePoscar(readText(tempPoscar, 'utf8'), tempPoscar)
        structure = {
          a1: parsedPoscar.a1, a2: parsedPoscar.a2, a3: parsedPoscar.a3,
          atoms: parsedPoscar.atoms.map((atom) => ({ symbol: atom.symbol, frac: atom.frac })),
        }
        applied.push('CIF 无自带对称操作，已用 VESTA 转换')
      }
    } else {
      const parsed = core.parsePoscar(rawText, input)
      structure = {
        a1: parsed.a1, a2: parsed.a2, a3: parsed.a3,
        atoms: parsed.atoms.map((atom) => ({ symbol: atom.symbol, frac: atom.frac })),
      }
    }

    if (Array.isArray(args.repeat)) {
      if (args.repeat.length !== 3) throw new Error('repeat 必须是三个正整数')
      structure = core.makeSupercell(structure, args.repeat)
      applied.push('扩胞 ' + args.repeat.join('×'))
    }
    if (args.cell) {
      const changed = core.setCellParameters(structure, args.cell)
      structure = changed.structure
      applied.push('晶胞 ' + Object.entries(args.cell).map(([key, value]) => key + '=' + value).join(' '))
    }
    let matrixDet = null
    if (Array.isArray(args.matrix)) {
      const transformed = core.transformStructure(structure, args.matrix)
      matrixDet = transformed.determinant
      structure = { a1: transformed.a1, a2: transformed.a2, a3: transformed.a3, atoms: transformed.atoms }
      applied.push('矩阵 det=' + transformed.determinant)
    }
    if (Number.isInteger(args.spaceGroup)) {
      const { dirname } = await import('node:path')
      const tablePath = core.toAbsolute('spgra.dat', dirname(String(merged.executable ?? '')))
      const expanded = core.expandBySpaceGroup(structure, args.spaceGroup, tablePath)
      structure = expanded.structure
      applied.push('空间群 ' + args.spaceGroup + ' ' + expanded.symbol + ' → ' + expanded.unique + ' 原子')
    }
    if (Number.isInteger(args.reduceSpaceGroup)) {
      const { dirname } = await import('node:path')
      const tablePath = core.toAbsolute('spgra.dat', dirname(String(merged.executable ?? '')))
      const reduced = core.reduceBySpaceGroup(structure, args.reduceSpaceGroup, tablePath)
      structure = reduced.structure
      // Wyckoff 字母：同一个 VESTA 安装目录下的 wyckoff.dat
      let letters = []
      try {
        const wyckoffPath = core.toAbsolute('wyckoff.dat', dirname(String(merged.executable ?? '')))
        const wyckoffTable = core.loadWyckoffTable(wyckoffPath)
        letters = core.assignWyckoff(structure, args.reduceSpaceGroup, wyckoffTable, null)
      } catch {
        letters = []
      }
      const letterText = letters.length > 0
        ? letters.map((item) => item.symbol + ' ' + (item.ok ? item.letter + '(' + item.multiplicity + ')' : '?')).join(', ')
        : reduced.orbits.map((orbit) => orbit.multiplicity).join('/')
      applied.push('约化 空间群 ' + args.reduceSpaceGroup + ' ' + reduced.symbol
        + ' → ' + reduced.structure.atoms.length + ' 原子（' + letterText + '）')
    }
    if (Number.isInteger(args.symmetrize)) {
      const { dirname: dirOfSym } = await import('node:path')
      const tablePath = core.toAbsolute('spgra.dat', dirOfSym(String(merged.executable ?? '')))
      const table = core.loadSpaceGroupTable(tablePath)
      // 先按需对称化晶胞（度规张量投影），再整理原子位置
      if (args.refineCell) {
        const cellResult = core.symmetrizeCell(structure, args.symmetrize, table)
        structure = cellResult.structure
        applied.push('对称化晶胞 a=' + cellResult.after.a.toFixed(4) + ' b=' + cellResult.after.b.toFixed(4)
          + ' c=' + cellResult.after.c.toFixed(4) + '（偏差 ' + cellResult.deviation.toExponential(1) + '）')
      }
      const result = core.symmetrizeStructure(structure, args.symmetrize, table)
      structure = result.structure
      applied.push('对称化 空间群 ' + args.symmetrize + '（最大位移 '
        + result.maxShift.toFixed(4) + ' 分数坐标，迭代 ' + result.iterations + ' 轮）')
    }
    if (args.substitute) {
      const result = core.substituteElement(structure, args.substitute.from, args.substitute.to)
      structure = result.structure
      applied.push('替换 ' + args.substitute.from + '→' + args.substitute.to + ' ×' + result.replaced)
    }
    if (Array.isArray(args.add)) {
      const added = core.addAtoms(structure, args.add)
      structure = added.structure
      applied.push('加原子 ×' + added.added)
    }
    if (args.remove) {
      const removed = core.removeAtoms(structure, args.remove)
      structure = removed.structure
      applied.push('删原子 ×' + removed.removed)
    }
    // 只给 out、不给任何编辑动作时允许「纯格式转换」（例如 CIF → POSCAR）
    const convertOnly = applied.length === 0 && args.out
    if (applied.length === 0 && !convertOnly) throw new Error('至少给一个编辑操作：repeat / matrix / cell / spaceGroup / substitute / add / remove')

    const params = core.cellParameters([structure.a1, structure.a2, structure.a3])
    // VESTA 按文件名/扩展名判断类型：`.POSCAR` 会被拒绝（Invalid data!），必须用 `.vasp` 或裸文件名；
    // 文件名里也不要用中文与 ×，否则部分版本会解析失败
    const asciiOps = [
      Array.isArray(args.repeat) ? args.repeat.join('x') : '',
      Array.isArray(args.matrix) ? 'det' + String(matrixDet ?? '') : '',
      Number.isInteger(args.spaceGroup) ? 'sg' + args.spaceGroup : '',
      Number.isInteger(args.reduceSpaceGroup) ? 'red' + args.reduceSpaceGroup : '',
      Number.isInteger(args.symmetrize) ? 'sym' + args.symmetrize : '',
      args.substitute ? 'sub-' + args.substitute.from + '2' + args.substitute.to : '',
    ].filter(Boolean).join('_')
    const suffix = asciiOps.replace(/[^0-9a-zA-Zx_.-]+/g, '-').slice(0, 40) || 'edited'
    const out = core.toAbsolute(args.out ?? `${input.replace(/\.(vasp|poscar|contcar)$/i, '')}-${suffix}.vasp`, base)
    // 按扩展名选写出格式：.cif → CIF；其余（默认 .vasp）→ POSCAR
    const text = /\.cif$/i.test(out)
      ? core.structureToCif(structure, { title: applied.join(' ') || 'structure' })
      : core.structureToPoscar(structure, applied.join('; '))
    writeText(out, text, 'utf8')

    let pid = null
    if (args.open) {
      const opened = await core.openFiles(merged, [out], base)
      pid = opened.files?.[0]?.pid ?? null
    }
    const elements = [...new Set(structure.atoms.map((atom) => atom.symbol))]
    // POSCAR 没有占位率字段：写 POSCAR 时部分占位的原子会变成满占位，要在摘要里说明
    const partialOccupancy = structure.atoms.filter(
      (atom) => typeof atom.occupancy === 'number' && Number.isFinite(atom.occupancy) && atom.occupancy < 0.999,
    ).length
    const occupancyNote = partialOccupancy > 0 && !/\.cif$/i.test(out)
      ? `\n注意：有 ${partialOccupancy} 个原子是部分占位，POSCAR 不支持占位率，写出时已按满占位处理（写 .cif 可保留）`
      : ''
    return {
      ok: true,
      summary: `已${applied.length > 0 ? '编辑结构（' + applied.join('，') + '）' : '转换格式'}：${structure.atoms.length} 个原子（${elements.join('/')}），`
        + `晶胞 a=${params.a.toFixed(3)} b=${params.b.toFixed(3)} c=${params.c.toFixed(3)} Å\n输出：${out}`
        + occupancyNote
        + (pid ? `\n已在 VESTA 打开（pid ${pid}）` : ''),
      out,
      atoms: structure.atoms.length,
      cell: {
        a: params.a, b: params.b, c: params.c,
        alpha: params.alpha, beta: params.beta, gamma: params.gamma,
      },
      elements,
      pid,
    }
  },
})

// ---------------------------------------------------------------------------
// 矢量图导出（SVG）：VESTA 只有 GUI 的「Export Vector Image」，这里用结构数据直接渲染
// ---------------------------------------------------------------------------

const VECTOR_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', description: '结构文件（POSCAR/CONTCAR/CIF）或包含它的任务目录。' },
    out: { type: 'string', description: '输出 SVG 路径；省略则写在输入同目录，文件名 <结构名>-vector.svg。' },
    width: { type: 'integer', description: '画布宽（像素），默认 800。' },
    height: { type: 'integer', description: '画布高（像素），默认 600。' },
    rx: { type: 'number', description: '绕 x 轴旋转（度），默认 0。' },
    ry: { type: 'number', description: '绕 y 轴旋转（度），默认 0。' },
    rz: { type: 'number', description: '绕 z 轴旋转（度），默认 0。' },
    showCell: { type: 'boolean', description: '是否画晶胞边框，默认 true。' },
    showBonds: { type: 'boolean', description: '是否画化学键，默认 true。' },
    background: { type: 'string', description: '背景色（CSS 颜色），默认 #ffffff。' },
  },
}

/**
 * `vesta_vector`：把结构导出为 SVG 矢量图。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const vectorTool = (ctx) => localTool({
  name: 'vesta_vector',
  description:
    '把晶体结构导出成 SVG 矢量图（正交投影 + 球棍 + 晶胞边框）：坐标是真实几何算出来的，'
    + '所以可以无限放大、可被 Illustrator/Inkscape 编辑。当用户要「矢量图 / 投稿插图 / 可编辑的图」时用它；'
    + '它是 VESTA 的 Export Vector Image 的等价实现（VESTA 没有矢量导出的命令行）。',
  parameters: VECTOR_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'out', 'atoms', 'bonds', 'width', 'height'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        out: { type: 'string' },
        atoms: { type: 'integer' },
        bonds: { type: 'integer' },
        width: { type: 'integer' },
        height: { type: 'integer' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Export SVG', kind: 'execute', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const core = await import(`./core.js?rev=${Date.now()}`)
    const { readFileSync: readText, writeFileSync: writeText } = await import('node:fs')
    const base = sessionDirectory(ctx, exec)
    const input = core.resolveTarget(args.path, base)
    const rawText = readText(input, 'utf8')
    // 支持 POSCAR 与 CIF：CIF 带占位率，SVG 里会按占位率调透明度
    let structure
    if (/\.cif$/i.test(input)) {
      const fromCif = core.structureFromCif(rawText)
      structure = { a1: fromCif.a1, a2: fromCif.a2, a3: fromCif.a3, atoms: fromCif.atoms }
    } else {
      const parsed = core.parsePoscar(rawText, input)
      structure = {
        a1: parsed.a1, a2: parsed.a2, a3: parsed.a3,
        atoms: parsed.atoms.map((atom) => ({ symbol: atom.symbol, frac: atom.frac })),
      }
    }
    const rendered = core.structureToSvg(structure, {
      width: args.width, height: args.height,
      rx: args.rx, ry: args.ry, rz: args.rz,
      showCell: args.showCell, showBonds: args.showBonds, background: args.background,
    })
    const out = core.toAbsolute(args.out ?? `${input.replace(/\.(vasp|poscar|contcar)$/i, '')}-vector.svg`, base)
    writeText(out, rendered.svg, 'utf8')
    return {
      ok: true,
      summary: `已导出 SVG 矢量图：${rendered.atoms} 个原子、${rendered.bonds} 条键、`
        + (rendered.partial ? `${rendered.partial} 个部分占位（按占位率调了透明度）、` : '')
        + `${rendered.width}×${rendered.height} 像素画布\n${out}`,
      out,
      atoms: rendered.atoms,
      bonds: rendered.bonds,
      width: rendered.width,
      height: rendered.height,
    }
  },
})

// ---------------------------------------------------------------------------
// 体数据导出（切片 CSV / 线剖面 TXT）：VESTA 的 Export Data 数据侧等价物
// ---------------------------------------------------------------------------

const VOLUME_EXPORT_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', description: '体积文件（CHGCAR/CHG/PARCHG/ELFCAR/LOCPOT/.cube），或含它的任务目录。' },
    kind: {
      type: 'string',
      enum: ['slice', 'profile'],
      description: 'slice=二维切片导出 CSV；profile=沿线段取样导出 TXT。默认 slice。',
    },
    plane: { type: 'string', enum: ['xy', 'yz', 'zx'], description: 'slice 用：切面方向，默认 xy。' },
    at: { type: 'number', description: 'slice 用：切面位置（分数坐标 0–1），默认 0.5。' },
    from: { type: 'string', description: 'profile 用：起点分数坐标 "x,y,z"，默认 "0,0,0"。' },
    to: { type: 'string', description: 'profile 用：终点分数坐标，默认 "0.5,0.5,0.5"。' },
    points: { type: 'integer', description: 'profile 用：采样点数，默认 50。' },
    out: { type: 'string', description: '输出路径（.csv 或 .txt）；省略则写在体积文件同目录。' },
  },
}

/**
 * `volume_export`：把体数据的切片或线剖面导成文本。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const volumeExportTool = (ctx) => localTool({
  name: 'volume_export',
  description:
    '把体积数据（CHGCAR/CHG/LOCPOT/ELFCAR/.cube）导出成文本：slice 导出某个切面的 CSV（48×48 网格逐点数值），'
    + 'profile 导出一条线剖面的 TXT（距离 + 数值）。当用户要「把电荷密度数据导出来 / 切片数据 / 剖面数据」时用它；'
    + '这是 VESTA 的 Export Data 在数据侧的等价物（GUI 对话框不可驱动）。',
  parameters: VOLUME_EXPORT_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'out', 'kind', 'points'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        out: { type: 'string' },
        kind: { type: 'string' },
        points: { type: 'integer' },
        dims: { type: 'array', items: { type: 'integer' } },
        unit: { type: 'string' },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Export volume data', kind: 'export', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const core = await import(`./core.js?rev=${Date.now()}`)
    const { readFileSync: readText, writeFileSync: writeText } = await import('node:fs')
    const { dirname } = await import('node:path')
    const base = sessionDirectory(ctx, exec)
    const input = core.resolveTarget(args.path, base)
    const volume = core.readVolumeFile(input)
    const kind = args.kind === 'profile' ? 'profile' : 'slice'
    const parsePoint = (raw, fallback) => {
      if (typeof raw !== 'string' || raw.trim() === '') return fallback
      const parts = raw.split(',').map(Number)
      if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) {
        throw new Error('坐标要写成 "x,y,z" 三个数字：' + raw)
      }
      return parts
    }
    if (kind === 'slice') {
      const csv = core.volumeSliceCsv(volume, { plane: args.plane, at: args.at })
      const slice = core.volumeSlice(volume, { plane: args.plane, at: args.at })
      const out = core.toAbsolute(args.out ?? `${input.replace(/\.[^.]+$/, '')}-slice-${slice.plane}.csv`, base)
      writeText(out, csv, 'utf8')
      return {
        ok: true,
        summary: `切片导出：${slice.plane} 面（${slice.axisLabels[2]}）${slice.rows}×${slice.columns} 网格，单位 ${volume.unit ?? '未知'}\n${out}`,
        out,
        kind,
        points: slice.rows * slice.columns,
        dims: volume.dims,
        unit: volume.unit ?? '',
      }
    }
    const from = parsePoint(args.from, [0, 0, 0])
    const to = parsePoint(args.to, [0.5, 0.5, 0.5])
    const text = core.volumeProfileText(volume, { from, to, points: args.points })
    const out = core.toAbsolute(args.out ?? `${input.replace(/\.[^.]+$/, '')}-profile.txt`, base)
    writeText(out, text, 'utf8')
    const sampleCount = text.split('\n').filter((line) => line && !line.startsWith('#')).length
    return {
      ok: true,
      summary: `线剖面导出：${from.join(',')} → ${to.join(',')}，${sampleCount} 个采样点，单位 ${volume.unit ?? '未知'}\n${out}`,
      out,
      kind,
      points: sampleCount,
      dims: volume.dims,
      unit: volume.unit ?? '',
    }
  },
})

// ---------------------------------------------------------------------------
// 测量（距离/角度 + 点击拾取）：VESTA 里靠点两个原子完成，这里用投影+索引算
// ---------------------------------------------------------------------------

const MEASURE_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: { type: 'string', description: '结构文件（POSCAR/CONTCAR）或任务目录。' },
    distance: {
      type: 'array',
      description: '要量的原子对：[[i,j]]，索引从 0 开始（与 POSCAR 中原子顺序一致）。',
      items: { type: 'array', items: { type: 'integer' } },
    },
    angle: {
      type: 'array',
      description: '要量的角度：[[i,j,k]]，j 是顶点。',
      items: { type: 'array', items: { type: 'integer' } },
    },
    clicks: {
      type: 'array',
      description: '点击拾取：画布坐标 [{x,y}]，配合 view 使用；命中后与上一个点组成距离。',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y'],
        properties: {
          x: { type: 'number', description: '画布 X（像素）。' },
          y: { type: 'number', description: '画布 Y（像素）。' },
        },
      },
    },
    view: {
      type: 'object',
      description: 'clicks 用的投影参数（与 vesta_vector 相同的 rx/ry/rz/width/height）。',
      additionalProperties: false,
      properties: {
        rx: { type: 'number', description: '绕 x 轴旋转（度）。' },
        ry: { type: 'number', description: '绕 y 轴旋转（度）。' },
        rz: { type: 'number', description: '绕 z 轴旋转（度）。' },
        width: { type: 'integer', description: '画布宽（像素）。' },
        height: { type: 'integer', description: '画布高（像素）。' },
      },
    },
  },
}

/**
 * `vesta_measure`：量原子间距离/角度，或把画布点击映射成原子并测量。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const measureTool = (ctx) => localTool({
  name: 'vesta_measure',
  description:
    '测量晶体结构里的键长与键角：给原子索引（distance=[[i,j]]、angle=[[i,j,k]]）直接算，'
    + '或用 clicks 给画布坐标（配合 view 的 rx/ry/rz 与 width/height）先拾取原子再算——相当于 VESTA 里点两个原子量距离。'
    + '当用户问「这两根键多长 / 这个角多少度 / 帮我量一下」时用它。',
  parameters: MEASURE_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'distances', 'angles'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        distances: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['i', 'j', 'distance'],
            properties: {
              i: { type: 'integer' }, j: { type: 'integer' }, distance: { type: 'number' },
            },
          },
        },
        angles: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['i', 'j', 'k', 'angle'],
            properties: {
              i: { type: 'integer' }, j: { type: 'integer' }, k: { type: 'integer' }, angle: { type: 'number' },
            },
          },
        },
        picked: { type: 'array', items: { type: 'integer' } },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Measure', kind: 'read', rawInput: { path: args.path } }),
  async execute(args, exec) {
    const core = await import(`./core.js?rev=${Date.now()}`)
    const { readFileSync: readText } = await import('node:fs')
    const base = sessionDirectory(ctx, exec)
    const input = core.resolveTarget(args.path, base)
    const parsed = core.parsePoscar(readText(input, 'utf8'), input)
    const structure = {
      a1: parsed.a1, a2: parsed.a2, a3: parsed.a3,
      atoms: parsed.atoms.map((atom) => ({ symbol: atom.symbol, frac: atom.frac })),
    }

    const pairs = Array.isArray(args.distance) ? args.distance : []
    const triples = Array.isArray(args.angle) ? args.angle : []
    const clicks = Array.isArray(args.clicks) ? args.clicks : []
    const picked = []

    if (clicks.length > 0) {
      const view = args.view ?? {}
      for (const click of clicks) {
        const hit = core.pickAtom(structure, { x: Number(click.x), y: Number(click.y), ...view })
        picked.push(hit ? hit.index : -1)
      }
      const hits = picked.filter((index) => index >= 0)
      for (let index = 1; index < hits.length; index += 1) pairs.push([hits[index - 1], hits[index]])
    }
    if (pairs.length === 0 && triples.length === 0 && clicks.length === 0) {
      throw new Error('至少给一种测量：distance / angle / clicks')
    }

    const distances = core.measureDistances(structure, pairs)
    const angles = core.measureAngles(structure, triples)
    const lines = []
    for (const item of distances) {
      lines.push(`  ${structure.atoms[item.i].symbol}${item.i}–${structure.atoms[item.j].symbol}${item.j}: ${item.distance.toFixed(4)} Å`)
    }
    for (const item of angles) {
      lines.push(`  ∠${item.i}-${item.j}-${item.k}: ${item.angle.toFixed(2)}°`)
    }
    if (picked.length > 0) {
      lines.push('  拾取: ' + picked.map((index) => (index >= 0 ? '#' + index : '未命中')).join(', '))
    }
    return {
      ok: true,
      summary: `测量结果（${structure.atoms.length} 原子）:\n${lines.join('\n')}`,
      distances: distances.map((item) => ({ i: item.i, j: item.j, distance: item.distance })),
      angles: angles.map((item) => ({ i: item.i, j: item.j, k: item.k, angle: item.angle })),
      picked,
    }
  },
})

// ---------------------------------------------------------------------------
// 体数据显示控制（等值面 / 剖面开关 + 阈值升降）
// 实测：菜单 144/145 是开关；键盘 +/- 改等值面阈值；.vesta 的 SURFS/SECTS/ISURF 在 CLI 打开时无效
// ---------------------------------------------------------------------------

const VOLUME_DISPLAY_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ['isosurface-toggle', 'sections-toggle', 'level-up', 'level-down'],
      description: 'isosurface-toggle=显示/隐藏等值面；sections-toggle=显示/隐藏剖面；level-up/level-down=升高/降低等值面阈值',
    },
    pid: { type: 'integer', description: 'VESTA 进程 pid（多窗口时指定；取自 vesta_open 返回）。' },
    count: { type: 'integer', description: 'level-up/level-down 的步数，默认 3。' },
  },
}

/**
 * `vesta_volume_display`：控制 VESTA 里体数据的显示（等值面/剖面开关、阈值升降）。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const volumeDisplayTool = (ctx) => localTool({
  name: 'vesta_volume_display',
  description:
    '控制 VESTA 里体数据（CHGCAR/LOCPOT 等）的显示：用菜单 145/144 开关等值面与剖面，'
    + '用键盘 +/- 升降等值面阈值。当用户说「打开/关掉等值面」「把等值面调大/调小」「显示剖面」时用它；'
    + '这是实测可行的路径（.vesta 里的 SURFS/SECTS/ISURF 在命令行打开时不会生效）。',
  parameters: VOLUME_DISPLAY_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'action'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        action: { type: 'string' },
        changed: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Volume display', kind: 'execute', rawInput: { action: args.action } }),
  async execute(args, exec) {
    const core = await import(`./core.js?rev=${Date.now()}`)
    const target = Number.isInteger(args.pid) ? { pid: args.pid } : 'main'
    const action = String(args.action)
    const count = Math.max(1, Math.min(30, Math.round(Number(args.count ?? 3))))

    // 前后各截一张 3D 视口，用哈希判断是否真的变了
    const stamp = Date.now()
    const base = sessionDirectory(ctx, exec)
    const before = await core.captureViewport(target, `${base}/.dsh-vol-${stamp}-a.png`)
    const beforeHash = core.hashFile(before.path)

    if (action === 'isosurface-toggle') {
      await core.invokeCommand(145, target)
    } else if (action === 'sections-toggle') {
      await core.invokeCommand(144, target)
    } else if (action === 'level-up') {
      await core.injectInput(target, 'key', { key: 'plus', count })
    } else if (action === 'level-down') {
      await core.injectInput(target, 'key', { key: 'minus', count })
    } else {
      throw new Error('不认识的 action：' + action)
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1200))

    const after = await core.captureViewport(target, `${base}/.dsh-vol-${stamp}-b.png`)
    const afterHash = core.hashFile(after.path)
    const changed = beforeHash !== afterHash
    const describe = {
      'isosurface-toggle': '切换等值面显示（菜单 145）',
      'sections-toggle': '切换剖面显示（菜单 144）',
      'level-up': `等值面阈值升高 ${count} 步（键盘 +）`,
      'level-down': `等值面阈值降低 ${count} 步（键盘 -）`,
    }[action]
    return {
      ok: true,
      summary: `${describe}；画面${changed ? '已变化 ✓' : '未变化（可能体数据未加载，或已经到边界）'}`,
      action,
      changed,
    }
  },
})

// ---------------------------------------------------------------------------
// 元素配色/半径（VESTA 的 elements.ini）：`style.ini` 的场景字段不生效，真正生效的是这个全局表
// ---------------------------------------------------------------------------

const STYLE_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['action'],
  properties: {
    action: {
      type: 'string',
      enum: ['list', 'set', 'restore'],
      description: 'list=列出元素配色与半径；set=改指定元素；restore=从备份还原 elements.ini',
    },
    symbols: { type: 'array', items: { type: 'string' }, description: 'list 用：只列这些元素（默认全部）。' },
    symbol: { type: 'string', description: 'set 用：要改的元素符号，如 "Si"。' },
    color: { type: 'array', items: { type: 'integer' }, description: 'set 用：颜色 [r,g,b]（0–255）。' },
    radius: { type: 'number', description: 'set 用：原子半径（Å，0–10）。' },
    executable: { type: 'string', description: 'VESTA 可执行文件路径；省略用默认安装位置定位 elements.ini。' },
  },
}

/**
 * `vesta_style`：读写 VESTA 的元素配色与半径（elements.ini）。
 * @param {object} ctx - 插件上下文。
 * @returns {object} 工具定义。
 */
const styleTool = (ctx) => localTool({
  name: 'vesta_style',
  description:
    '读写 VESTA 的元素配色与原子半径：list 列出现值，set 改某个元素（颜色 [r,g,b] 与半径 Å），restore 从备份还原。'
    + '当用户说「把这个元素改成红色 / 原子画大一点 / 恢复默认配色」时用它。'
    + '注意这会改 VESTA 的全局配置文件（会先自动备份，restore 可还原）——实测这是唯一真正生效的配色途径，'
    + '场景文件 .vesta 里的 ATOMT/BONDP 不会被 VESTA 采用。',
  parameters: STYLE_PARAMS,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'summary', 'action'],
      properties: {
        ok: { type: 'boolean' },
        summary: { type: 'string' },
        action: { type: 'string' },
        path: { type: 'string' },
        elements: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.summary }],
  },
  presentCall: (args) => ({ card: 'generic', title: 'Element style', kind: 'execute', rawInput: { action: args.action } }),
  async execute(args, exec) {
    const core = await import(`./core.js?rev=${Date.now()}`)
    const { copyFileSync, existsSync, readFileSync: readText, writeFileSync: writeText } = await import('node:fs')
    const { dirname: dirOf, join: joinPath } = await import('node:path')
    const base = sessionDirectory(ctx, exec)
    const executable = core.toAbsolute(String(args.executable ?? mergedExecutable(ctx) ?? 'D:/VESTA-win64/VESTA.exe'), base)
    const iniPath = joinPath(dirOf(executable), 'elements.ini')
    if (!existsSync(iniPath)) throw new Error('找不到 VESTA 的 elements.ini：' + iniPath)
    const backupPath = iniPath + '.dsh-backup'

    if (args.action === 'list') {
      const table = core.parseElementsIni(readText(iniPath, 'utf8'))
      const wanted = Array.isArray(args.symbols) && args.symbols.length > 0 ? args.symbols : [...table.keys()]
      const rows = wanted.filter((symbol) => table.has(symbol)).map((symbol) => table.get(symbol))
      const lines = rows.slice(0, 40).map((row) => `  ${row.symbol.padEnd(3)} r=${row.radius.toFixed(2)} ${row.color} rgb(${row.rgb.join(',')})`)
      return {
        ok: true,
        summary: `elements.ini 共 ${table.size} 个元素${rows.length > 40 ? '，下列前 40 个' : ''}：\n${lines.join('\n')}`,
        action: 'list',
        path: iniPath,
        elements: rows.map((row) => ({ symbol: row.symbol, radius: row.radius, color: row.color, rgb: row.rgb })),
      }
    }

    if (args.action === 'restore') {
      if (!existsSync(backupPath)) throw new Error('没有备份文件可还原：' + backupPath)
      copyFileSync(backupPath, iniPath)
      const table = core.parseElementsIni(readText(iniPath, 'utf8'))
      return {
        ok: true,
        summary: `已从备份还原 elements.ini（${table.size} 个元素）：${iniPath}`,
        action: 'restore',
        path: iniPath,
      }
    }

    // set
    const symbol = String(args.symbol ?? '').trim()
    if (!symbol) throw new Error('set 需要 symbol（元素符号）')
    const original = readText(iniPath, 'utf8')
    const table = core.parseElementsIni(original)
    if (!table.has(symbol)) throw new Error(`elements.ini 里没有元素 ${symbol}`)
    if (!existsSync(backupPath)) copyFileSync(iniPath, backupPath)
    const changes = { [symbol]: {} }
    if (args.color !== undefined) changes[symbol].color = args.color
    if (args.radius !== undefined) changes[symbol].radius = args.radius
    if (Object.keys(changes[symbol]).length === 0) throw new Error('set 至少要给 color 或 radius')
    const edited = core.editElementsIni(original, changes)
    if (!edited.changed.includes(symbol)) throw new Error('没能定位到元素行：' + symbol)
    writeText(iniPath, edited.text, 'utf8')
    const after = core.parseElementsIni(edited.text).get(symbol)
    return {
      ok: true,
      summary: `已改 ${symbol}：半径 ${table.get(symbol).radius.toFixed(2)} → ${after.radius.toFixed(2)}，`
        + `颜色 ${table.get(symbol).color} → ${after.color}\n`
        + `已备份到 ${backupPath}；用 action="restore" 可还原。注意 VESTA 需要重新启动才读到新配色。`,
      action: 'set',
      path: iniPath,
      elements: [{ symbol, radius: after.radius, color: after.color, rgb: after.rgb }],
    }
  },
})

/** 取插件配置里的 VESTA 可执行文件路径。 */
function mergedExecutable(ctx) {
  const config = ctx?.config ?? {}
  return config.executable ?? config.vestaPath ?? null
}

/**
 * `vesta_interact`：正式的单球交互入口（观测 → 选择 → 隐藏 → 恢复）。
 *
 * 与实验脚本的区别：返回 sessionId / geometryRevision / selectionToken，
 * 几何一变旧坐标直接拒绝；隐藏与恢复都带区域差异判定，信息不足返回 unknown。
 * @returns {object} 工具定义。
 */
function interactTool() {
  return localTool({
    name: 'vesta_interact',
    description:
      '当用户想在 VESTA 里选中某个原子、隐藏刚选中的球或把它恢复时调用它；'
      + '对已打开的 VESTA 窗口做单球级交互：'
      + 'observe 建立会话（返回 sessionId、几何版本、画布矩形）；'
      + 'select 选中一个球（默认自动挑最大的球，也可给画布坐标 x/y，返回 selectionToken 与本次身份）；'
      + 'hide 对当前选中项执行 Del 并判定是否变淡；restore 执行 Esc 并与选中前基线比较。'
      + '几何变化后旧 sessionId/selectionToken 会被拒绝，需要重新 observe。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: { type: 'string', enum: ['observe', 'select', 'hide', 'restore'], description: 'observe=建立会话；select=选中球；hide=隐藏选中；restore=恢复' },
        pid: { type: 'integer', description: 'VESTA 进程 pid（多窗口时指定；省略取第一个）' },
        sessionId: { type: 'string', description: 'observe 返回的会话 id（select/hide/restore 必填）' },
        x: { type: 'number', description: 'select 用的画布坐标 X（物理像素）；省略则自动挑最大的球' },
        y: { type: 'number', description: 'select 用的画布坐标 Y（物理像素）' },
        selectionToken: { type: 'string', description: 'select 返回的选择令牌（hide/restore 必填）' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['ok', 'summary'],
        properties: {
          ok: { type: 'boolean' },
          summary: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
    },
    presentCall: (args) => ({ card: 'generic', title: `VESTA interact: ${args.action}`, kind: 'execute', rawInput: args }),
    async execute(args) {
      if (args.action === 'observe') {
        const result = await observeVesta({ pid: args.pid })
        const canvas = result.canvasRect
        return {
          ...result,
          summary: `会话 ${result.sessionId}｜文档 ${result.document}｜画布 ${canvas?.width ?? '?'}×${canvas?.height ?? '?'} @ (${canvas?.left ?? '?'},${canvas?.top ?? '?'})｜几何版本 ${result.geometryRevision}`,
        }
      }
      if (args.action === 'select') {
        const result = await selectVesta(args.sessionId, { x: args.x, y: args.y })
        const identity = result.identityLine ? `身份 ${result.identityLine}` : '未取得身份输出'
        return { ...result, summary: `选中点 (${result.point.x},${result.point.y})｜${identity}｜token ${result.selectionToken ?? '-'}` }
      }
      if (args.action === 'hide') {
        const result = await hideSelected(args.sessionId, args.selectionToken)
        const structure = await sessionStructure(args.sessionId)
        return { ...result, structure, summary: `隐藏：${result.effect}（区域差异 ${result.regionDiff}）｜结构${structure.unchanged ? '未变' : '已变'}` }
      }
      if (args.action === 'restore') {
        const result = await restoreVesta(args.sessionId, args.selectionToken)
        return { ...result, summary: `恢复：${result.restored ? '已回到选中前基线' : '未完全恢复'}（区域差异 ${result.regionDiff ?? '-'}）` }
      }
      throw new Error(`未知 action：${args.action}`)
    },
  })
}
