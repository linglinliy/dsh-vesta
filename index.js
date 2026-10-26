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
    ]
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
    action: { type: 'string', enum: ['list', 'click', 'settext'], description: 'list=列出控件；click=点击；settext=写入文本' },
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
        const first = record.pdb
        const viewerPath = first.replace(/\.pdb$/i, '') + '-VESTA风.html'
        const generated = await core.generateWebglViewer(target, { repeat: args.repeat, out: viewerPath, volume: args.volume, volumeRef: args.volumeRef, isoPercent: args.isoPercent })
        record.viewer = generated.out
      }
      structures.push(record)
    }
    const lines = structures.map((item) => {
      const cell = item.cell
      const repeatText = item.repeat.join('×')
      const viewerLine = item.viewer ? `\n    HTML: ${item.viewer}` : ''
      return `  ${item.formula}（${item.atoms} 原子，${repeatText} 扩胞，a=${cell.a.toFixed(2)} b=${cell.b.toFixed(2)} c=${cell.c.toFixed(2)} Å）\n    PDB: ${item.pdb}\n    CIF: ${item.cif}${viewerLine}`
    })
    return {
      ok: true,
      summary: `已生成 ${structures.length} 个带晶胞参数的结构文件：\n${lines.join('\n')}\n下一步：需要交互查看时用 renderer="webgl" 生成离线 HTML 查看器（本 profile 里没有独立的三维面板工具）；也可以直接在 VESTA 里打开 PDB/CIF。`,
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
