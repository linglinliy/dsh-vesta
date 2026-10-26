/**
 * VESTA 能力核心 —— 一份实现，两个前端共用：
 *   · `index.js`      DSH 原生 Host 插件（ctx.tools）
 *   · `mcp/server.js` 独立 MCP stdio 服务器（任何 MCP 客户端都能接）
 *
 * 两条路径若各写一份逻辑，迟早会漂移（一边加了目录解析、另一边没加）。所以
 * 这里只放**纯能力**：不 import cordis、不认识 MCP、不认识工具注册表，
 * 只接收普通参数、抛普通 Error。
 * @module vesta-core
 */

import { execFile, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ELEMENTS as VIEWER_ELEMENTS } from './viewer/scene.js'

/** VESTA 默认安装位置；`VESTA_EXE` 环境变量或配置项可覆盖。 */
/**
 * 默认候选可执行文件（按顺序尝试）：优先环境变量 VESTA_EXE，其次常见安装位置。
 * 非 Windows 或自定义安装请用 VESTA_EXE 或插件配置里的 executable 指定。
 */
export const DEFAULT_EXECUTABLE_CANDIDATES = [
  process.env.VESTA_EXE,
  'C:\\Program Files\\VESTA\\VESTA.exe',
  'C:\\Program Files (x86)\\VESTA\\VESTA.exe',
  'C:\\VESTA\\VESTA.exe',
  'D:\\VESTA-win64\\VESTA.exe',
].filter(Boolean)

/** 向后兼容：默认取候选列表里第一个存在的（找不到时为第一个候选）。 */
export const DEFAULT_EXECUTABLE = DEFAULT_EXECUTABLE_CANDIDATES.find((candidate) => {
  try {
    return existsSync(candidate)
  } catch {
    return false
  }
}) ?? DEFAULT_EXECUTABLE_CANDIDATES[0] ?? 'VESTA.exe'

/** 一次最多打开多少个文件。 */
export const DEFAULT_MAX_FILES = 10

/** 目录被传进来时，按这个顺序找主结构文件。 */
const PREFERRED_NAMES = ['POSCAR', 'CONTCAR', 'POSCAR.vasp', 'CONTCAR.vasp', 'structure.cif']

/** 扩展名 → 人类可读格式名。 */
const EXT_FORMATS = {
  '.cif': 'CIF',
  '.mcif': 'mmCIF',
  '.vesta': 'VESTA 场景',
  '.xsf': 'XSF',
  '.axsf': 'XSF 动画',
  '.cube': 'Gaussian CUBE',
  '.cub': 'Gaussian CUBE',
  '.pdb': 'PDB',
  '.ent': 'PDB',
  '.xyz': 'XYZ 坐标',
  '.mol': 'MOL',
  '.mol2': 'MOL2',
  '.vasp': 'VASP',
  '.ins': 'SHELX INS',
  '.res': 'SHELX RES',
  '.png': '位图图像',
  '.tif': '位图图像',
  '.tiff': '位图图像',
  '.bmp': '位图图像',
  '.jpg': '位图图像',
  '.jpeg': '位图图像',
  '.gif': '位图图像',
}

/** 去掉用户可能带上的成对引号。 */
function stripQuotes(text) {
  return String(text).replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1')
}

/**
 * 把用户给的路径变成绝对路径（相对路径按 base 解析）。
 * @param {unknown} raw - 原始路径值。
 * @param {string} base - 相对路径的基准目录。
 * @returns {string} 绝对路径（尚未校验存在性）。
 */
export function toAbsolute(raw, base) {
  let value = stripQuotes(String(raw ?? '').trim())
  if (value.length === 0) throw new Error('文件路径为空')
  if (value === '~' || value.startsWith('~/') || value.startsWith('~\\')) value = join(homedir(), value.slice(1))
  return isAbsolute(value) ? resolvePath(value) : resolvePath(base, value)
}

/** 按文件名/扩展名判断格式；只用于回报，不用来拒绝文件。 */
export function formatName(file) {
  const base = file.split(/[\\/]/).pop() ?? file
  const lower = base.toLowerCase()
  if (lower === 'poscar' || lower === 'poscar.vasp') return 'VASP POSCAR'
  if (lower === 'contcar' || lower === 'contcar.vasp') return 'VASP CONTCAR'
  return EXT_FORMATS[(extname(lower) || '').toLowerCase()] ?? '未知格式'
}

/**
 * 目录也能开：按 VASP 任务目录的习惯挑一个主结构文件。
 * @param {string} dir - 目录绝对路径。
 * @returns {string} 挑中的文件绝对路径。
 */
export function pickFromDirectory(dir) {
  for (const candidate of PREFERRED_NAMES) {
    const file = join(dir, candidate)
    if (existsSync(file) && statSync(file).isFile()) return file
  }
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(cif|vesta|cube|vasp|xsf)$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  if (entries.length === 0) {
    throw new Error(`目录里没找到可打开的结构文件（找过 ${PREFERRED_NAMES.join(' / ')} 与 *.cif/*.vesta/*.cube）：${dir}`)
  }
  return join(dir, entries[0])
}

/**
 * 解析一个路径参数：文件直接用，目录里挑主结构文件。
 * @param {unknown} raw - 原始参数值。
 * @param {string} base - 相对路径基准目录。
 * @returns {string} 可交给 VESTA 的绝对文件路径。
 */
export function resolveTarget(raw, base) {
  const absolute = toAbsolute(raw, base)
  if (!existsSync(absolute)) throw new Error(`文件或目录不存在：${absolute}`)
  const info = statSync(absolute)
  if (info.isDirectory()) return pickFromDirectory(absolute)
  if (!info.isFile()) throw new Error(`不是普通文件：${absolute}`)
  return absolute
}

/**
 * 解析可执行文件路径并校验存在性。
 * @param {object} [config] - `{ executable }`。
 * @returns {{ path: string, exists: boolean, problem?: string }} 探测结果，不抛错。
 */
export function probeExecutable(config = {}) {
  // 环境变量 > 配置项 > 默认安装位置（DEFAULT_EXECUTABLE）
  const raw = String(process.env.VESTA_EXE ?? config.executable ?? DEFAULT_EXECUTABLE ?? '').trim()
  if (raw.length === 0) return { path: '', exists: false, problem: '未配置可执行文件路径' }
  let candidate
  try {
    candidate = toAbsolute(raw, process.cwd())
  } catch (error) {
    return { path: raw, exists: false, problem: error.message }
  }
  if (!existsSync(candidate)) return { path: candidate, exists: false, problem: '路径不存在' }
  const info = statSync(candidate)
  if (!info.isFile()) return { path: candidate, exists: false, problem: '路径不是文件' }
  return { path: candidate, exists: true }
}

/**
 * 启动 VESTA。detached + unref：GUI 窗口必须活过调用方（会话 / MCP 子进程）。
 * @param {string} executable - 可执行文件绝对路径。
 * @param {string} file - 要打开的结构文件绝对路径。
 * @returns {Promise<number | null>} 子进程 pid（拿不到时为 null）。
 */
export function launch(executable, file) {
  return new Promise((resolvePromise, reject) => {
    let settled = false
    let child
    try {
      child = spawn(executable, [file], {
        cwd: dirname(executable),
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      })
    } catch (error) {
      reject(new Error(`启动 VESTA 失败：${error.message}`))
      return
    }
    child.once('error', (error) => {
      if (settled) return
      settled = true
      reject(new Error(`启动 VESTA 失败：${error.message}（可执行文件 ${executable}）`))
    })
    // 'spawn' 事件表示进程真的起来了：立刻结算，不要依赖定时器——
    // 定时器一旦 unref()，短命的 CLI 脚本会在它触发前退出（顶层 await 永远不结算）。
    child.once('spawn', () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolvePromise(typeof child.pid === 'number' ? child.pid : null)
    })
    child.unref()
    // 兜底：极少数情况下 'spawn' 不触发（旧 Node 或异常路径），900 ms 后仍返回 pid
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolvePromise(typeof child.pid === 'number' ? child.pid : null)
    }, 900)
  })
}

/** 读 VESTA.ini：UTF-8 为主，遇到替换字符再试 GBK（老机器区域设置不同）。 */
function readIni(root) {
  const file = join(root, 'VESTA.ini')
  if (!existsSync(file)) return null
  const bytes = readFileSync(file)
  let text = bytes.toString('utf8')
  if (text.includes('\uFFFD')) {
    try {
      text = new TextDecoder('gbk').decode(bytes)
    } catch {
      /* GBK 解码器不可用时保留 utf8 结果 */
    }
  }
  return text
}

/** 从 ini 文本里取版本行与最近文件列表。 */
export function parseIni(text) {
  const lines = text.split(/\r?\n/)
  const versionLine = lines[0]?.startsWith('#VESTA_INI_VER') ? lines[0].replace('#VESTA_INI_VER', '').trim() : ''
  const recent = []
  for (let index = 0; index < lines.length; index += 1) {
    const head = /^\s*(\d+)\s+4\s*\/\/\s*Recent files/i.exec(lines[index])
    if (!head) continue
    const count = Math.min(Number(head[1]), 20)
    for (let offset = 1; offset <= count; offset += 1) {
      const value = lines[index + offset]?.trim()
      if (value) recent.push(value)
    }
    break
  }
  return { versionLine, recent }
}

/** 统计正在运行的 VESTA 进程（非 Windows 或取不到时如实报告 supported=false）。 */
export function listVestaProcesses() {
  return new Promise((done) => {
    if (process.platform !== 'win32') {
      done({ supported: false, pids: [] })
      return
    }
    execFile('tasklist', ['/FI', 'IMAGENAME eq VESTA.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 4000 }, (error, stdout) => {
      if (error) {
        done({ supported: false, pids: [] })
        return
      }
      const pids = []
      for (const line of String(stdout).split(/\r?\n/)) {
        const match = /^"VESTA\.exe","(\d+)"/i.exec(line.trim())
        if (match) pids.push(Number(match[1]))
      }
      done({ supported: true, pids })
    })
  })
}

/**
 * 打开一批结构文件 / 任务目录。
 * @param {object} config - `{ executable?, maxFiles? }`。
 * @param {unknown} rawPaths - 模型或客户端给的路径数组。
 * @param {string} base - 相对路径基准目录。
 * @returns {Promise<{ executable: string, files: Array<{ path: string, format: string, pid: number | null }> }>}
 */
export async function openFiles(config, rawPaths, base) {
  const probe = probeExecutable(config)
  if (!probe.exists) {
    throw new Error(
      `找不到可用的 VESTA：${probe.path || '(未配置)'} — ${probe.problem ?? '未知原因'}。`
      + '请配置 executable（环境变量 VESTA_EXE 优先级最高）。',
    )
  }
  const raw = Array.isArray(rawPaths) ? rawPaths : []
  if (raw.length === 0) throw new Error('paths 至少要给一个文件或目录')
  const maxFiles = Number(config?.maxFiles ?? DEFAULT_MAX_FILES)
  if (raw.length > maxFiles) throw new Error(`一次最多打开 ${maxFiles} 个文件，收到 ${raw.length} 个`)

  const targets = []
  for (const item of raw) {
    const target = resolveTarget(item, base)
    if (!targets.includes(target)) targets.push(target)
  }

  const files = []
  for (const target of targets) {
    const pid = await launch(probe.path, target)
    files.push({ path: target, format: formatName(target), pid })
  }
  return { executable: probe.path, files }
}

/**
 * 探测安装状态：可执行文件、安装目录、ini 版本标识、最近文件、运行中的进程。
 * @param {object} config - `{ executable? }`。
 * @returns {Promise<object>} 结构化状态（键名与工具输出 schema 一一对应）。
 */
export async function inspectInstall(config = {}) {
  const probe = probeExecutable(config)
  const root = probe.exists ? dirname(probe.path) : ''
  let versionLine = ''
  let recent = []
  if (root) {
    const ini = readIni(root)
    if (ini) {
      const parsed = parseIni(ini)
      versionLine = parsed.versionLine
      recent = parsed.recent
    }
  }
  const running = await listVestaProcesses()
  return {
    executable: probe.path,
    exists: probe.exists,
    problem: probe.problem ?? '',
    root,
    versionLine,
    recent,
    running,
  }
}

/** 打开结果的统一措辞（两个前端共用，保证同一次操作说法一致）。 */
export function openSummary(result) {
  const lines = result.files.map((file) => `${file.path}（${file.format}，pid ${file.pid ?? '未知'}）`)
  return `已在 VESTA 中打开 ${result.files.length} 个文件：\n${lines.join('\n')}\nVESTA：${result.executable}`
}

/** 安装状态的统一措辞。 */
export function inspectSummary(state) {
  const parts = []
  parts.push(
    state.exists
      ? `VESTA 可执行文件：${state.executable}`
      : `没有找到可用的 VESTA：${state.executable || '(未配置)'}（${state.problem || '未知原因'}）`,
  )
  if (state.versionLine) parts.push(`VESTA.ini 版本标识：${state.versionLine}`)
  if (state.recent.length > 0) {
    parts.push(`最近打开（${state.recent.length} 条，来自 VESTA.ini）：\n${state.recent.map((file) => `  ${file}`).join('\n')}`)
  }
  parts.push(
    state.running.supported
      ? (state.running.pids.length > 0
        ? `当前 VESTA 进程：${state.running.pids.length} 个（pid ${state.running.pids.join(', ')}）`
        : '当前没有 VESTA 进程在运行')
      : '当前无法枚举 VESTA 进程（tasklist 不可用）',
  )
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Win32 控制面：VESTA 没有脚本接口，但它的菜单是 HMENU、控件是子窗口
// ---------------------------------------------------------------------------
/** 控制脚本路径（与 core.js 同目录的 win/ 下）。 */
const UI_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'win', 'vesta-ui.ps1')

/** 这台机器上能否驱动 VESTA 界面（目前只实现 Windows）。 */
export function uiSupported() {
  return process.platform === 'win32'
}

/**
 * 调一次控制脚本：只认最后一行 JSON，stdout 里的其它噪音一律丢掉。
 * @param {string[]} args - 传给 vesta-ui.ps1 的参数。
 * @returns {Promise<object>} 脚本返回的 JSON 对象。
 */
function runUiScript(args) {
  if (!uiSupported()) return Promise.reject(new Error('界面控制目前只支持 Windows'))
  return new Promise((resolvePromise, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', UI_SCRIPT, ...args],
      { windowsHide: true, timeout: 25000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`VESTA 控制脚本执行失败：${error.message}${stderr ? `（${String(stderr).trim().slice(0, 200)}）` : ''}`))
          return
        }
        const lines = String(stdout).trim().split(/\r?\n/).filter((line) => line.trim().length > 0)
        const last = lines[lines.length - 1]
        if (!last) {
          reject(new Error('VESTA 控制脚本没有输出'))
          return
        }
        let parsed
        try {
          parsed = JSON.parse(last)
        } catch {
          reject(new Error(`无法解析控制脚本输出：${last.slice(0, 200)}`))
          return
        }
        if (parsed.ok === false) {
          reject(new Error(parsed.error ?? '控制脚本返回失败'))
          return
        }
        resolvePromise(parsed)
      },
    )
  })
}

/**
 * 拿到所有 VESTA 进程的窗口清单。
 * @returns {Promise<Array<{ pid: number, windows: Array<object> }>>}
 */
export async function vestaWindows() {
  const running = await listVestaProcesses()
  if (running.supported === false) throw new Error('无法枚举 VESTA 进程（tasklist 不可用）')
  if (running.pids.length === 0) throw new Error('当前没有 VESTA 在运行：先用 vesta_open 打开一个结构')
  const out = []
  for (const pid of running.pids) {
    try {
      const result = await runUiScript(['-Action', 'windows', '-ProcId', String(pid)])
      out.push({ pid, windows: Array.isArray(result.windows) ? result.windows : [] })
    } catch {
      /* 单个进程取不到窗口不影响其它进程 */
    }
  }
  if (out.length === 0) throw new Error('VESTA 在运行，但枚举窗口失败')
  return out
}

/**
 * 选窗口：`main` 主窗口 / `dialog` 当前对话框 / 直接给 hwnd 数字。
 * @param {string|number} [target] - 目标窗口。
 * @returns {Promise<object>} `{ pid, hwnd, class, title, rect }`。
 */
export async function pickWindow(target = 'main') {
  const procs = await vestaWindows()
  const all = procs.flatMap((proc) => proc.windows.map((window) => ({ ...window, pid: proc.pid })))
  const named = all.filter((window) => window.title && window.visible)
  // { pid } 定向：只在该进程的窗口里挑
  if (target && typeof target === 'object' && Number.isFinite(target.pid)) {
    const owned = named.filter((window) => window.pid === target.pid)
    if (owned.length === 0) {
      throw new Error(`pid=${target.pid} 没有可见的 VESTA 窗口（进程可能已退出）`)
    }
    const isMainWindow = (window) => /- VESTA$/i.test(window.title)
    const mainWindow = owned.find(isMainWindow)
    if (target.kind === 'dialog') {
      const dialog = owned.find((window) => !isMainWindow(window) && (window.class === '#32770' || /^wx/.test(window.class)))
      if (!dialog) throw new Error(`pid=${target.pid} 当前没有对话框`)
      return dialog
    }
    return mainWindow ?? owned[0]
  }
  if (target !== undefined && target !== null && /^\d+$/.test(String(target))) {
    const hwnd = Number(target)
    const hit = all.find((window) => window.hwnd === hwnd)
    if (!hit) throw new Error(`找不到 hwnd=${hwnd} 对应的 VESTA 窗口`)
    return hit
  }
  const isMain = (window) => /- VESTA$/i.test(window.title) || /^VESTA/i.test(window.title)
  const main = named.find(isMain)
  if (target === 'dialog') {
    const dialog = named.find((window) => !isMain(window) && (window.class === '#32770' || /^wx/.test(window.class)))
    if (!dialog) throw new Error('当前没有打开的 VESTA 对话框（先用 vesta_menu 触发对应功能）')
    return dialog
  }
  if (main) return main
  if (named.length > 0) return named[0]
  throw new Error('找不到 VESTA 主窗口')
}

/**
 * 列出 VESTA 菜单命令（含 id）。
 * @param {string|number} [target] - 目标窗口。
 * @returns {Promise<Array<{ path: string, id: number, kind: string, enabled: boolean }>>}
 */
export async function listMenu(target) {
  const window = await pickWindow(target)
  const result = await runUiScript(['-Action', 'menu', '-Hwnd', String(window.hwnd)])
  const rows = Array.isArray(result.menu) ? result.menu : []
  return rows.map((row) => ({
    path: row.path,
    id: typeof row.id === 'number' ? row.id : -1,
    kind: row.kind,
    enabled: row.enabled === true,
  }))
}

/**
 * 投递一个菜单命令（等价于点菜单项）。
 * @param {number} commandId - 菜单项 id。
 * @param {string|number} [target] - 目标窗口。
 * @returns {Promise<{ window: object, commandId: number }>}
 */
export async function invokeCommand(commandId, target) {
  if (!Number.isInteger(commandId) || commandId <= 0) throw new Error('command 必须是正整数菜单 id（用 vesta_menu 的 list 查）')
  const window = await pickWindow(target)
  await runUiScript(['-Action', 'cmd', '-Hwnd', String(window.hwnd), '-CommandId', String(commandId)])
  return { window, commandId }
}

/**
 * 列出某个窗口里的子控件（按钮/输入框/勾选框）。
 * @param {string|number} [target] - 目标窗口；默认当前对话框。
 * @returns {Promise<{ window: object, controls: Array<object> }>}
 */
export async function listControls(target = 'dialog') {
  const window = await pickWindow(target)
  const result = await runUiScript(['-Action', 'controls', '-Hwnd', String(window.hwnd)])
  return { window, controls: Array.isArray(result.controls) ? result.controls : [] }
}

/**
 * 按 hwnd 或控件文字操作一个控件。
 * @param {'click'|'settext'|'check'} action - 操作类型。
 * @param {{ hwnd?: number, name?: string, text?: string, window?: string|number }} options - 目标与内容。
 * @returns {Promise<{ window: object, control: object, action: string }>}
 */
export async function operateControl(action, options = {}) {
  const { window, controls } = await listControls(options.window ?? 'dialog')
  let control = null
  if (Number.isInteger(options.hwnd) && options.hwnd > 0) {
    control = controls.find((item) => item.hwnd === options.hwnd) ?? null
    if (!control) throw new Error(`该窗口里没有 hwnd=${options.hwnd} 的控件`)
  } else if (typeof options.name === 'string' && options.name.length > 0) {
    const wanted = options.name.trim()
    control = controls.find((item) => String(item.text).trim() === wanted)
      ?? controls.find((item) => String(item.text).includes(wanted))
    if (!control) throw new Error(`找不到文字含「${wanted}」的控件`)
  } else {
    throw new Error('要么给 hwnd，要么给 name')
  }

  const args = ['-Action', action === 'settext' ? 'settext' : 'click', '-Hwnd', String(control.hwnd)]
  if (action === 'settext') {
    if (typeof options.text !== 'string') throw new Error('settext 需要 text')
    args.push('-Text', options.text)
  }
  const result = await runUiScript(args)
  return { window, control, action, result }
}

/**
 * 抓窗口图像（PrintWindow，遮挡也抓得到）。
 * @param {{ out?: string, window?: string|number }} options - 输出路径与目标窗口。
 * @returns {Promise<{ window: object, path: string, size: string }>}
 */
export async function captureWindow(options = {}) {
  const window = await pickWindow(options.window ?? 'main')
  const outDir = join(homedir(), '.dsh', 'vesta-captures')
  mkdirSync(outDir, { recursive: true })
  const out = options.out && String(options.out).trim().length > 0
    ? toAbsolute(options.out, process.cwd())
    : join(outDir, `vesta-${Date.now()}.png`)
  const result = await runUiScript(['-Action', 'capture', '-Hwnd', String(window.hwnd), '-Out', out])
  if (!existsSync(out)) throw new Error(`截图没有落盘：${out}`)
  return { window, path: out, size: result.size ?? '' }
}

// ---------------------------------------------------------------------------
// POSCAR/CONTCAR → 通用结构格式（喂给三维面板）
// ---------------------------------------------------------------------------
/** 三向量行列式。 */
function det3(a, b, c) {
  return a[0] * (b[1] * c[2] - b[2] * c[1])
    - a[1] * (b[0] * c[2] - b[2] * c[0])
    + a[2] * (b[0] * c[1] - b[1] * c[0])
}

/** 三向量夹角（度）。 */
function angleDeg(u, v) {
  const d = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v))
  return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI
}

/** 分数坐标 → 笛卡尔（Å）。 */
function fracToCart(frac, a1, a2, a3) {
  return [
    frac[0] * a1[0] + frac[1] * a2[0] + frac[2] * a3[0],
    frac[0] * a1[1] + frac[1] * a2[1] + frac[2] * a3[1],
    frac[0] * a1[2] + frac[1] * a2[2] + frac[2] * a3[2],
  ]
}

/** 笛卡尔 → 分数坐标：解 M f = c（M 的三列是 a1,a2,a3）。 */
function cartToFrac(cart, a1, a2, a3) {
  const m = [a1, a2, a3]
  const det = det3(a1, a2, a3)
  if (Math.abs(det) < 1e-12) throw new Error('晶格体积为 0，无法换算分数坐标')
  const solve = (col, v) => det3(
    [col === 0 ? v[0] : m[0][0], col === 0 ? v[1] : m[0][1], col === 0 ? v[2] : m[0][2]],
    [col === 1 ? v[0] : m[1][0], col === 1 ? v[1] : m[1][1], col === 1 ? v[2] : m[1][2]],
    [col === 2 ? v[0] : m[2][0], col === 2 ? v[1] : m[2][1], col === 2 ? v[2] : m[2][2]],
  ) / det
  return [solve(0, cart), solve(1, cart), solve(2, cart)]
}

/**
 * 解析 POSCAR / CONTCAR（VASP 4 与 5 写法、Selective dynamics、Direct/Cartesian 都支持）。
 * @param {string} text - 文件正文。
 * @param {string} [name] - 文件名，用于兜底标题。
 * @returns {{ comment: string, a1: number[], a2: number[], a3: number[], atoms: Array<{ symbol: string, frac: number[] }> }}
 */
/**
 * 从 POTCAR 里按顺序取元素符号（每个 PAW 数据集有一条 `VRHFIN =Si:`）。
 * 用于补 VASP 4 写法的 POSCAR（没有元素行）。
 * @param {string} text - POTCAR 文本。
 * @returns {string[]} 元素符号列表。
 */
export function potcarElements(text) {
  const lines = String(text).split(/\r?\n/)
  const symbols = []
  for (const line of lines) {
    const match = /VRHFIN\s*=\s*([A-Za-z]{1,2})\s*:/.exec(line)
    if (match) symbols.push(match[1])
  }
  if (symbols.length > 0) return symbols
  // 回退：部分 POTCAR 变体没有 VRHFIN，但每个物种块的第一行是 "PAW_PBE <El> ..."
  for (const line of lines) {
    const match = /^\s*(?:PAW|PAW_PBE|PAW_GGA|PAW_LDA|US)\s+([A-Za-z]{1,2})\s/.exec(line)
    if (match) symbols.push(match[1])
  }
  return symbols
}

export function parsePoscar(text, name = '', options = {}) {
  const lines = text.split(/\r?\n/)
  if (lines.length < 8) throw new Error('POSCAR 行数不足（至少需要 8 行）')
  const comment = lines[0].trim() || name
  const scale = Number((lines[1] ?? '').trim().split(/\s+/)[0])
  if (!Number.isFinite(scale) || scale === 0) throw new Error('POSCAR 第 2 行缩放因子无法解析')

  const readVec = (line, label) => {
    const parts = (line ?? '').trim().split(/\s+/).slice(0, 3).map(Number)
    if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) throw new Error(`POSCAR ${label} 行无法解析`)
    return parts
  }
  let a1 = readVec(lines[2], '第 3（晶格 a1）')
  let a2 = readVec(lines[3], '第 4（晶格 a2）')
  let a3 = readVec(lines[4], '第 5（晶格 a3）')

  // 官方 POSCAR 文档：第 2 行可以是 1 个数（统一缩放）、3 个数（分轴缩放），
  // 或负数（表示目标晶胞体积）。Cartesian 坐标也要乘这个缩放因子。
  const scaleTokens = (lines[1] ?? '').trim().split(/\s+/).map(Number).filter((v) => Number.isFinite(v))
  let scaleVec = [1, 1, 1]
  if (scaleTokens.length >= 3) {
    if (scaleTokens.slice(0, 3).some((v) => v <= 0)) throw new Error('POSCAR 分轴缩放因子必须为正数')
    scaleVec = scaleTokens.slice(0, 3)
  } else if (scaleTokens.length === 1) {
    let s = scaleTokens[0]
    if (s === 0) throw new Error('POSCAR 缩放因子为 0')
    if (s < 0) {
      const target = Math.abs(s)
      const current = Math.abs(det3(a1, a2, a3))
      if (current < 1e-12) throw new Error('POSCAR 晶格体积为 0，无法按体积缩放')
      s = Math.cbrt(target / current)
    }
    scaleVec = [s, s, s]
  } else {
    throw new Error('POSCAR 第 2 行缩放因子无法解析（应为 1 个或 3 个数）')
  }
  const applyScale = (vector) => vector.map((value, axis) => value * scaleVec[axis])
  a1 = applyScale(a1)
  a2 = applyScale(a2)
  a3 = applyScale(a3)

  const isIntLine = (tokens) => tokens.length > 0 && tokens.every((t) => /^\d+$/.test(t))
  let index = 5
  let symbols = []
  let counts
  const first = (lines[index] ?? '').trim()
  if (first === '') throw new Error('POSCAR 缺少元素/原子数行')
  const firstTokens = first.split(/\s+/)
  if (isIntLine(firstTokens)) {
    // VASP 4：没有元素行，只有原子数。元素从同目录 POTCAR 里取（调用方传进来）。
    const fallback = Array.isArray(options.symbols) ? options.symbols : []
    const countsV4 = firstTokens.map(Number)
    if (fallback.length !== countsV4.length) {
      throw new Error(
        'POSCAR 是 VASP 4 写法（没有元素行），而且读不到可用的 POTCAR 元素。'
        + '请把 POTCAR 放在同一目录，或手动补一行元素符号。',
      )
    }
    symbols = fallback.slice()
    counts = countsV4
    // 不在这里 index+=1：下面统一跳过原子数行，VASP4 的原子数行就是当前这行。
  } else {
    symbols = firstTokens
    index += 1
  }
  if (counts === undefined) {
    const countTokens = (lines[index] ?? '').trim().split(/\s+/)
    if (!isIntLine(countTokens)) throw new Error('POSCAR 原子数行无法解析')
    counts = countTokens.map(Number)
  }
  index += 1
  if (symbols.length !== counts.length) throw new Error('POSCAR 元素行与原子数个数不一致')

  let selective = false
  if (/^[sS]/.test((lines[index] ?? '').trim())) {
    selective = true
    index += 1
  }
  const modeLine = (lines[index] ?? '').trim()
  if (!/^[dDcCkK]/.test(modeLine)) throw new Error('POSCAR 缺少 Direct / Cartesian 坐标类型行')
  const direct = /^[dD]/.test(modeLine)
  index += 1

  const perAtom = []
  for (let s = 0; s < counts.length; s += 1) {
    for (let n = 0; n < counts[s]; n += 1) perAtom.push(symbols[s])
  }
  const atoms = []
  for (let k = 0; k < perAtom.length; k += 1) {
    const line = lines[index + k]
    if (line === undefined) throw new Error(`POSCAR 坐标行不足：期望 ${perAtom.length} 行，只读到 ${k} 行`)
    const values = line.trim().split(/\s+/).slice(0, 3).map(Number)
    if (values.length !== 3 || values.some((v) => !Number.isFinite(v))) throw new Error(`POSCAR 第 ${index + k + 1} 行坐标无法解析`)
    const frac = direct ? values : cartToFrac(values.map((value, axis) => value * scaleVec[axis]), a1, a2, a3)
    atoms.push({ symbol: perAtom[k], frac })
  }
  void selective
  return { comment, a1, a2, a3, atoms, scale: scaleVec, cursor: index + perAtom.length }
}

/**
 * 按 (nx,ny,nz) 扩胞，得到「原子已展开」的结构（面板不吃 PBC，只能把胞内原子铺出来）。
 * @param {ReturnType<typeof parsePoscar>} structure - 单胞结构。
 * @param {[number, number, number]} repeat - 三个方向重复次数。
 * @returns {{ comment: string, a1: number[], a2: number[], a3: number[], atoms: Array<{ symbol: string, cart: number[] }> }}
 */
export function buildSupercell(structure, repeat) {
  const [nx, ny, nz] = repeat
  const a1 = structure.a1.map((v) => v * nx)
  const a2 = structure.a2.map((v) => v * ny)
  const a3 = structure.a3.map((v) => v * nz)
  const atoms = []
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let k = 0; k < nz; k += 1) {
        for (const atom of structure.atoms) {
          const base = fracToCart(atom.frac, structure.a1, structure.a2, structure.a3)
          atoms.push({
            symbol: atom.symbol,
            cart: [
              base[0] + i * structure.a1[0] + j * structure.a2[0] + k * structure.a3[0],
              base[1] + i * structure.a1[1] + j * structure.a2[1] + k * structure.a3[1],
              base[2] + i * structure.a1[2] + j * structure.a2[2] + k * structure.a3[2],
            ],
          })
        }
      }
    }
  }
  return { comment: structure.comment, a1, a2, a3, atoms }
}

/** 结构摘要：化学式 + 晶胞参数。 */
export function structureSummary(structure) {
  const counts = new Map()
  for (const atom of structure.atoms) counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1)
  const formula = [...counts.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([symbol, count]) => `${symbol}${count > 1 ? count : ''}`)
    .join('')
  const { a1, a2, a3 } = structure
  const cell = {
    a: Math.hypot(...a1),
    b: Math.hypot(...a2),
    c: Math.hypot(...a3),
    alpha: angleDeg(a2, a3),
    beta: angleDeg(a1, a3),
    gamma: angleDeg(a1, a2),
  }
  return { formula, atoms: structure.atoms.length, cell }
}

/**
 * 输出 PDB（严格按列宽，sci-viz 的 PDB 解析器按列切片）。
 * @param {ReturnType<typeof parsePoscar>|ReturnType<typeof buildSupercell>} structure - 含笛卡尔坐标的结构。
 * @param {string} title - TITLE 行内容。
 * @returns {string} PDB 文本。
 */
export function toPdb(structure, title) {
  const { a1, a2, a3 } = structure
  const cell = structureSummary(structure).cell
  const f = (v) => v.toFixed(3).padStart(8)
  const lines = []
  lines.push(`TITLE     ${String(title).slice(0, 60)}`)
  lines.push(`CRYST1${cell.a.toFixed(3).padStart(9)}${cell.b.toFixed(3).padStart(9)}${cell.c.toFixed(3).padStart(9)}${cell.alpha.toFixed(2).padStart(7)}${cell.beta.toFixed(2).padStart(7)}${cell.gamma.toFixed(2).padStart(7)} P 1           1`)
  structure.atoms.forEach((atom, i) => {
    const cart = atom.cart ?? fracToCart(atom.frac, a1, a2, a3)
    const serial = String(i + 1).padStart(5)
    const name = `${atom.symbol}${i + 1}`.padEnd(4).slice(0, 4)
    const resName = atom.symbol.padStart(3)
    lines.push(
      `ATOM  ${serial} ${name} ${resName} A   1    ${f(cart[0])}${f(cart[1])}${f(cart[2])}  1.00  0.00          ${atom.symbol.padStart(2)}`,
    )
  })
  lines.push('END')
  return `${lines.join('\n')}\n`
}

/**
 * 输出 mmCIF（用 CIF2 的点号标签 + Cartn 列，sci-viz 的 CIF 解析器只认这种）。
 * @param {ReturnType<typeof parsePoscar>|ReturnType<typeof buildSupercell>} structure - 结构。
 * @param {string} title - data_ 名。
 * @returns {string} CIF 文本。
 */
export function toCif(structure, title) {
  const { a1, a2, a3 } = structure
  const cell = structureSummary(structure).cell
  const safeTitle = String(title).replace(/[^A-Za-z0-9_]+/g, '_').slice(0, 40) || 'structure'
  const lines = [
    `data_${safeTitle}`,
    `_cell_length_a ${cell.a.toFixed(4)}`,
    `_cell_length_b ${cell.b.toFixed(4)}`,
    `_cell_length_c ${cell.c.toFixed(4)}`,
    `_cell_angle_alpha ${cell.alpha.toFixed(3)}`,
    `_cell_angle_beta ${cell.beta.toFixed(3)}`,
    `_cell_angle_gamma ${cell.gamma.toFixed(3)}`,
    '_symmetry_space_group_name_H-M P1',
    'loop_',
    '_atom_site.group_PDB',
    '_atom_site.label_atom_id',
    '_atom_site.label_comp_id',
    '_atom_site.label_asym_id',
    '_atom_site.auth_seq_id',
    '_atom_site.type_symbol',
    '_atom_site.Cartn_x',
    '_atom_site.Cartn_y',
    '_atom_site.Cartn_z',
  ]
  structure.atoms.forEach((atom, i) => {
    const cart = atom.cart ?? fracToCart(atom.frac, a1, a2, a3)
    lines.push(`ATOM ${atom.symbol}${i + 1} ${atom.symbol} A 1 ${atom.symbol} ${cart[0].toFixed(4)} ${cart[1].toFixed(4)} ${cart[2].toFixed(4)}`)
  })
  return `${lines.join('\n')}\n`
}

/**
 * 把 POSCAR/CONTCAR 转成三维面板能吃的格式（PDB + mmCIF），可选扩胞。
 * 面板不吃周期性边界，所以扩胞是把原子真的铺出来。
 * @param {string} inputPath - 结构文件绝对路径。
 * @param {{ repeat?: number[], outDir?: string }} [options] - 扩胞倍数与输出目录。
 * @returns {{ input: string, pdb: string, cif: string, formula: string, atoms: number, repeat: number[], cell: object }}
 */
/** 读同目录 POTCAR 的元素列表；没有 POTCAR 就返回空数组。 */
function siblingPotcarSymbols(filePath) {
  try {
    const potcar = join(dirname(filePath), 'POTCAR')
    if (!existsSync(potcar)) return []
    return potcarElements(readFileSync(potcar, 'utf8'))
  } catch {
    return []
  }
}

export function exportStructureForViewer(inputPath, options = {}) {
  const base = String(inputPath).split(/[\\/]/).pop() ?? 'structure'
  if (/\.(cif|mcif)$/i.test(base)) {
    throw new Error('CIF 不需要转换：直接把原文件交给三维面板即可（sci_viz_structure）')
  }
  const text = readFileSync(inputPath, 'utf8')
  const parsed = parsePoscar(text, base, { symbols: siblingPotcarSymbols(inputPath) })
  const rawRepeat = Array.isArray(options.repeat) ? options.repeat : [1, 1, 1]
  const repeat = [0, 1, 2].map((i) => {
    const value = Number(rawRepeat[i] ?? 1)
    if (!Number.isInteger(value) || value < 1 || value > 6) throw new Error('repeat 必须是 1–6 的整数三元组')
    return value
  })
  const supercell = buildSupercell(parsed, repeat)
  if (supercell.atoms.length > 20000) {
    throw new Error(`扩胞后 ${supercell.atoms.length} 个原子，超过 20000 上限；把 repeat 调小`)
  }
  const outDir = options.outDir && String(options.outDir).trim().length > 0
    ? toAbsolute(options.outDir, process.cwd())
    : join(homedir(), '.dsh', 'vesta-views', String(Date.now()))
  mkdirSync(outDir, { recursive: true })
  // 名字必须能区分不同任务目录：POSCAR 到处都是同名，只用文件名会互相覆盖。
  const parent = dirname(inputPath).split(/[\\/]/).pop() ?? ''
  const stem = `${parent ? `${parent}_` : ''}${base.replace(/\.[^.]+$/, '')}`
    .replace(/[^\w.\-]+/g, '_')
    .slice(0, 60) || 'structure'
  const pdbPath = join(outDir, `${stem}.pdb`)
  const cifPath = join(outDir, `${stem}.cif`)
  writeFileSync(pdbPath, toPdb(supercell, `${parsed.comment} ${repeat.join('x')}`), 'utf8')
  writeFileSync(cifPath, toCif(supercell, stem), 'utf8')
  const summary = structureSummary(supercell)
  return {
    input: inputPath,
    pdb: pdbPath,
    cif: cifPath,
    formula: summary.formula,
    atoms: summary.atoms,
    repeat,
    cell: summary.cell,
  }
}

/**
 * 用子进程跑 WebGL 查看器生成脚本。
 *
 * 为什么不直接 import：生成器要读 1.3 MB 的 three.js 并拼 HTML，放在宿主进程里做会把
 * 插件上下文撑大；子进程还能绕开模块缓存。宿主是 Electron 时用 ELECTRON_RUN_AS_NODE=1
 * 让同一个可执行文件跑成 Node，不能假定 PATH 里有 node。
 *
 * @param {string} inputPath - 结构文件绝对路径。
 * @param {{ repeat?: number[], out?: string }} [options] - 扩胞与输出路径。
 * @returns {Promise<{ out: string, formula: string, atoms: number, bonds: number, bytes: number }>}
 */
/**
 * 起一个 node 子进程跑 scripts/ 下的生成器，并解析它输出的 JSON。
 * 五个 generate* 包装函数共用这一份实现（之前是五份几乎相同的 Promise 块）。
 * @param {string} scriptName - scripts/ 下的文件名。
 * @param {string[]} args - 传给脚本的参数。
 * @param {string} label - 出错信息里用的中文名。
 * @returns {Promise<any>} 脚本输出的 JSON。
 */
function runNodeScript(scriptName, args, label) {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'scripts', scriptName)
  return new Promise((resolvePromise, reject) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(process.execPath, [script, ...args], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(new Error(`启动${label}生成器失败：${error.message}`))
      return
    }
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => reject(new Error(`启动${label}生成器失败：${error.message}`)))
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`生成${label}失败（退出码 ${code}）：${stderr.trim().slice(0, 300)}`))
        return
      }
      try {
        resolvePromise(JSON.parse(stdout))
        return
      } catch {
        // 有些脚本先打印人类可读的摘要、最后一行才是 JSON：取最后一个 '{' 开头的行
        const start = stdout.lastIndexOf('\n{')
        if (start >= 0) {
          try {
            resolvePromise(JSON.parse(stdout.slice(start + 1)))
            return
          } catch { /* 落到下面的报错 */ }
        }
        reject(new Error(`无法解析${label}生成器的输出：${stdout.trim().slice(0, 200)}`))
      }
    })
  })
}

export function generateWebglViewer(inputPath, options = {}) {
  const args = [inputPath]
  if (Array.isArray(options.repeat) && options.repeat.length === 3) args.push('--repeat', options.repeat.join(','))
  if (options.out) args.push('--out', toAbsolute(String(options.out), process.cwd()))
  if (options.volume) args.push('--vol', toAbsolute(String(options.volume), process.cwd()))
  if (options.volumeRef) args.push('--ref', toAbsolute(String(options.volumeRef), process.cwd()))
  if (Number.isFinite(options.isoPercent)) args.push('--iso', String(options.isoPercent))
  return runNodeScript('make-viewer-gl.mjs', args, 'WebGL 查看器')
}

/**
 * 3×3 矩阵求逆（行向量为基矢）。用于把笛卡尔坐标换回分数坐标。
 * @param {number[][]} matrix - 3×3 矩阵。
 * @returns {number[][]} 逆矩阵。
 */
function invert3(matrix) {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) throw new Error('晶胞体积为零，无法换算笛卡尔坐标')
  const k = 1 / det
  return [
    [(e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k],
    [(f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k],
    [(d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k],
  ]
}

/** 原子序数 → 元素符号（CUBE 里原子用 Z 表示）。索引 0 是占位，越界返回 undefined。 */
const Z_SYMBOLS = ["","H","He","Li","Be","B","C","N","O","F","Ne","Na","Mg","Al","Si","P","S","Cl","Ar","K","Ca","Sc","Ti","V","Cr","Mn","Fe","Co","Ni","Cu","Zn","Ga","Ge","As","Se","Br","Kr","Rb","Sr","Y","Zr","Nb","Mo","Tc","Ru","Rh","Pd","Ag","Cd","In","Sn","Sb","Te","I","Xe","Cs","Ba","La","Ce","Pr","Nd","Pm","Sm","Eu","Gd","Tb","Dy","Ho","Er","Tm","Yb","Lu","Hf","Ta","W","Re","Os","Ir","Pt","Au","Hg","Tl","Pb","Bi","Po","At","Rn","Fr","Ra","Ac","Th","Pa","U","Np","Pu","Am","Cm","Bk","Cf","Es","Fm","Md","No","Lr","Rf","Db","Sg","Bh","Hs","Mt","Ds","Rg","Cn","Nh","Fl","Mc","Lv","Ts","Og"]

/**
 * 解析 Gaussian CUBE。坐标单位按文件里的 Bohr 原样保留（显示用，不做换算），
 * 只有晶格向量用于画晶胞框。
 * @param {string} text - CUBE 文本。
 * @returns {object} `{ title, dims, origin, steps, atoms, values }`
 */
export function parseCube(text) {
  const lines = text.split(/\r?\n/)
  if (lines.length < 7) throw new Error('CUBE 行数不足')
  const head = (lines[2] ?? '').trim().split(/\s+/).map(Number)
  const natoms = Math.abs(head[0] ?? 0)
  const origin = head.slice(1, 4)
  const axisLine = (index) => {
    const parts = (lines[index] ?? '').trim().split(/\s+/).map(Number)
    if (parts.length < 4 || parts.some((value) => !Number.isFinite(value))) throw new Error(`CUBE 第 ${index + 1} 行网格轴无法解析`)
    return { count: Math.round(parts[0]), step: parts.slice(1, 4) }
  }
  const axisX = axisLine(3)
  const axisY = axisLine(4)
  const axisZ = axisLine(5)
  const atoms = []
  for (let i = 0; i < natoms; i += 1) {
    const parts = (lines[6 + i] ?? '').trim().split(/\s+/).map(Number)
    if (parts.length < 5) throw new Error(`CUBE 第 ${7 + i} 行原子无法解析`)
    atoms.push({
      symbol: Z_SYMBOLS[Math.round(parts[0])] ?? 'X',
      cart: parts.slice(2, 5),
    })
  }
  const total = axisX.count * axisY.count * axisZ.count
  const values = new Float32Array(total)
  let filled = 0
  for (let line = 6 + natoms; line < lines.length && filled < total; line += 1) {
    for (const token of lines[line].trim().split(/\s+/)) {
      if (!token) continue
      values[filled] = Number(token)
      filled += 1
      if (filled >= total) break
    }
  }
  if (filled < total) throw new Error(`CUBE 数据不足：需要 ${total} 个点，只读到 ${filled} 个`)
  return {
    title: (lines[0] ?? '').trim() || 'CUBE',
    dims: [axisX.count, axisY.count, axisZ.count],
    origin,
    steps: [axisX.step, axisY.step, axisZ.step],
    atoms,
    values,
  }
}

/**
 * 解析 VASP CHGCAR/CHG：结构部分与 POSCAR 相同，后面接网格点数与 5 列一行的数据。
 * VASP 写出的数值是 ρ·V（V 为晶胞体积），这里统一除回 ρ（e/Å³）。
 * @param {string} text - CHGCAR 文本。
 * @returns {object} `{ title, dims, origin, steps, atoms, structure, values, unit }`
 */
export function parseChgcar(text, options = {}) {
  const structure = parsePoscar(text, 'CHGCAR', options)
  const lines = text.split(/\r?\n/)

  // 读一块网格：从 startLine 起按 x 最快、z 最慢读满 nx*ny*nz 个值
  const readGrid = (startLine) => {
    const header = (lines[startLine] ?? '').trim().split(/\s+/).map(Number)
    if (header.length < 3 || header.slice(0, 3).some((value) => !Number.isFinite(value))) {
      throw new Error('CHGCAR 里找不到网格维度行（NGXF NGYF NGZF）')
    }
    const [nx, ny, nz] = header.slice(0, 3).map((value) => Math.round(value))
    const total = nx * ny * nz
    const values = new Float32Array(total)
    let filled = 0
    let line = startLine + 1
    for (; line < lines.length && filled < total; line += 1) {
      for (const token of lines[line].trim().split(/\s+/)) {
        if (!token) continue
        const value = Number(token)
        if (!Number.isFinite(value)) break
        values[filled] = value
        filled += 1
        if (filled >= total) break
      }
    }
    if (filled < total) throw new Error(`CHGCAR 数据不足：需要 ${total} 个点，只读到 ${filled} 个`)
    return { dims: [nx, ny, nz], values, nextLine: line }
  }

  let cursor = structure.cursor
  while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1
  const first = readGrid(cursor)
  const block = options.block === 2 ? 2 : 1

  // ISPIN=2 的 CHGCAR 在电荷块之后是「磁化密度」块（官网页 Magnetic calculations）
  let chosen = first
  if (block === 2) {
    let found = null
    for (let line = first.nextLine; line < lines.length; line += 1) {
      const tokens = lines[line].trim().split(/\s+/)
      if (tokens.length !== 3) continue
      const numbers = tokens.map(Number)
      if (numbers.some((value) => !Number.isFinite(value)) || numbers.some((value) => !Number.isInteger(value))) continue
      try {
        const candidate = readGrid(line)
        if (candidate.dims[0] * candidate.dims[1] * candidate.dims[2] > 0) {
          found = candidate
          break
        }
      } catch {
        // 不是网格维度行，继续找
      }
    }
    if (!found) throw new Error('CHGCAR 里没有第二个网格块（只有 ISPIN=2 的 CHGCAR 才带磁化密度块）')
    chosen = found
  }

  const [nx, ny, nz] = chosen.dims
  const total = nx * ny * nz
  const values = chosen.values
  const divideByVolume = options.divideByVolume !== false
  if (divideByVolume) {
    const cellVolume = Math.abs(det3(structure.a1, structure.a2, structure.a3))
    if (cellVolume <= 0) throw new Error('CHGCAR 晶胞体积为 0，无法把 ρ·V 换算成 ρ')
    for (let i = 0; i < total; i += 1) values[i] /= cellVolume
  }

  const steps = [
    structure.a1.map((value) => value / nx),
    structure.a2.map((value) => value / ny),
    structure.a3.map((value) => value / nz),
  ]
  return {
    title: structure.comment || 'CHGCAR',
    dims: [nx, ny, nz],
    origin: [0, 0, 0],
    steps,
    atoms: structure.atoms.map((atom) => ({ symbol: atom.symbol, cart: fracToCart(atom.frac, structure.a1, structure.a2, structure.a3) })),
    structure,
    values,
    block,
    unit: options.unit ?? (block === 2 ? 'e/Å³（磁化）' : 'e/Å³'),
  }
}

/**
 * 把网格降采样并量化成 Uint8（嵌进 HTML 的体积要小），返回 base64 与量程。
 * @param {{ dims: number[], values: Float32Array }} volume - 原始网格。
 * @param {{ maxDim?: number }} [options] - 最长边上限，默认 56。
 * @returns {{ dims: number[], data: string, min: number, max: number, stride: number }}
 */
export function encodeVolume(volume, options = {}) {
  const maxDim = Number.isFinite(options.maxDim) ? options.maxDim : 56
  const [nx, ny, nz] = volume.dims
  const stride = Math.max(1, Math.ceil(Math.max(nx, ny, nz) / maxDim))
  const sx = Math.ceil(nx / stride)
  const sy = Math.ceil(ny / stride)
  const sz = Math.ceil(nz / stride)
  const values = volume.values
  let min = Infinity
  let max = -Infinity
  const sampled = new Float32Array(sx * sy * sz)
  let index = 0
  for (let k = 0; k < sz; k += 1) {
    const zIndex = Math.min(nz - 1, k * stride)
    for (let j = 0; j < sy; j += 1) {
      const yIndex = Math.min(ny - 1, j * stride)
      for (let i = 0; i < sx; i += 1) {
        const xIndex = Math.min(nx - 1, i * stride)
        const value = values[(zIndex * ny + yIndex) * nx + xIndex]
        sampled[index] = value
        index += 1
        if (value < min) min = value
        if (value > max) max = value
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    min = 0
    max = 1
  }
  const quantized = Buffer.alloc(sampled.length)
  const scale = 255 / (max - min)
  for (let i = 0; i < sampled.length; i += 1) {
    quantized[i] = Math.max(0, Math.min(255, Math.round((sampled[i] - min) * scale)))
  }
  return {
    dims: [sx, sy, sz],
    data: quantized.toString('base64'),
    min,
    max,
    stride,
  }
}

/**
 * 读一个体积文件（按扩展名分派）。
 * @param {string} path - 文件路径。
 * @returns {object} `parseCube` / `parseChgcar` 的结果。
 */
export function readVolumeFile(path, options = {}) {
  const block = options.block === 2 ? 2 : 1
  const base = String(path).split(/[\\/]/).pop() ?? ''
  // 空文件单独报错：LCHARG=.FALSE. 时 VASP 会生成 0 字节的 CHG/CHGCAR，
  // 直接往下解析只会得到「POSCAR 行数不足」这种误导性的信息。
  const size = existsSync(path) ? statSync(path).size : -1
  if (size < 0) throw new Error(`体积文件不存在：${path}`)
  if (size === 0) {
    throw new Error(`${base} 是空文件（0 字节）：VASP 在 LCHARG=.FALSE. 时不写电荷密度，`
      + '要画等值面请把 INCAR 改成 LCHARG=.TRUE. 重跑')
  }
  const text = readFileSync(path, 'utf8')
  const parseOptions = { symbols: siblingPotcarSymbols(path), block }
  if (/\.(cube|cub)$/i.test(base)) return parseCube(text)
  // CHG/CHGCAR/PARCHG：写的是 ρ·V，要除体积回到 e/Å³
  if (/^(CHG|PARCHG)/i.test(base)) return parseChgcar(text, parseOptions)
  // ELFCAR：ELF 无量纲（0–1），文件里没有乘体积
  if (/^ELFCAR/i.test(base)) return parseChgcar(text, { ...parseOptions, divideByVolume: false, unit: '无量纲（ELF）' })
  // LOCPOT：局域势，单位 eV，同样没有乘体积
  if (/^LOCPOT/i.test(base)) return parseChgcar(text, { ...parseOptions, divideByVolume: false, unit: 'eV（局域势）' })
  throw new Error(`不认识的体积文件：${base}（支持 .cube / .cub / CHG / CHGCAR / PARCHG / ELFCAR / LOCPOT）`)
}

// ---------------------------------------------------------------------------
// DOSCAR：总态密度（自旋向上/向下两列）
// ---------------------------------------------------------------------------
/**
 * 解析 VASP DOSCAR 的总态密度块（忽略逐原子 PDOS 块）。
 * 头部第 6 行是 `Emax Emin NEDOS E-fermi weight`（不同版本列数略有差异）。
 * @param {string} text - DOSCAR 文本。
 * @returns {{ natoms: number, nedos: number, efermi: number, emax: number, emin: number, energies: number[], up: number[], down: number[], spinPolarized: boolean }}
 */
export function parseDoscar(text) {
  const lines = text.split(/\r?\n/)
  const header = (lines[0] ?? '').trim().split(/\s+/).map(Number)
  const natoms = Number.isFinite(header[0]) ? header[0] : 1
  let cursor = -1
  for (let i = 1; i < Math.min(lines.length, 12); i += 1) {
    const parts = (lines[i] ?? '').trim().split(/\s+/).map(Number)
    // 头行特征：≥4 列、第 3 列是整数点数、且 Emax > Emin。
    if (parts.length >= 4 && Number.isInteger(parts[2]) && parts[2] >= 2
      && Number.isFinite(parts[3]) && parts[0] > parts[1]) {
      cursor = i
      break
    }
  }
  if (cursor < 0) throw new Error('DOSCAR：找不到 `Emax Emin NEDOS E-fermi` 头行')
  const head = (lines[cursor] ?? '').trim().split(/\s+/).map(Number)
  const nedos = Math.round(head[2])
  const efermi = head[3]
  const energies = []
  const up = []
  const down = []
  for (let i = cursor + 1; i < lines.length && energies.length < nedos; i += 1) {
    const parts = (lines[i] ?? '').trim().split(/\s+/)
    if (parts.length < 2) break
    const energy = Number(parts[0])
    if (!Number.isFinite(energy)) break
    energies.push(energy)
    up.push(Number(parts[1]) || 0)
    down.push(parts.length >= 3 ? Number(parts[2]) || 0 : 0)
  }
  if (energies.length < nedos) {
    throw new Error(`DOSCAR 数据行不足：期望 ${nedos} 行，只读到 ${energies.length} 行`)
  }
  // ISPIN=1 的 DOSCAR 是「E, DOS, 积分DOS」三列；ISPIN=2 才是「E, 上, 下」。
  // 积分列单调不减，自旋向下的 DOS 不是——用它来判别。
  // 判据：第三列若等于第二列的累积积分，就是 ISPIN=1 的积分 DOS 列。
  let cumulative = 0
  let maxGap = 0
  let maxCumulative = 0
  for (let i = 1; i < up.length; i += 1) {
    cumulative += 0.5 * (up[i] + up[i - 1]) * (energies[i] - energies[i - 1])
    maxCumulative = Math.max(maxCumulative, Math.abs(cumulative))
    maxGap = Math.max(maxGap, Math.abs(down[i] - cumulative))
  }
  const thirdIsIntegrated = maxCumulative > 0 && maxGap <= 0.05 * maxCumulative + 1e-6
  // ISPIN=2 的 DOSCAR 若带积分列（5 列），第 4/5 列就是上/下自旋的累积积分
  const integratedUp = []
  const integratedDown = []
  if (!thirdIsIntegrated) {
    for (let i = cursor + 1; i < lines.length && integratedUp.length < nedos; i += 1) {
      const parts = (lines[i] ?? '').trim().split(/\s+/)
      if (parts.length < 5) break
      const a = Number(parts[3])
      const b = Number(parts[4])
      if (!Number.isFinite(a) || !Number.isFinite(b)) break
      integratedUp.push(a)
      integratedDown.push(b)
    }
  }
  const integratedDos = thirdIsIntegrated ? down.slice() : []
  const spinPolarized = !thirdIsIntegrated && down.some((value) => Math.abs(value) > 1e-8)
  const spinDown = thirdIsIntegrated ? down.map(() => 0) : down
  return {
    natoms,
    nedos,
    efermi,
    emax: head[0],
    emin: head[1],
    energies,
    up,
    down: spinDown,
    spinPolarized,
    integratedDos,
    integratedUp,
    integratedDown,
  }
}

/**
 * 梯形积分总态密度到某个能量上限（默认费米能级），单位是电子数。
 * 对完整占据的系统，∫DOS dE (到 Ef) 应当等于 NELECT。
 * @param {ReturnType<typeof parseDoscar>} dos - 解析结果。
 * @param {number} [limit] - 积分上限，默认 `dos.efermi`。
 * @returns {number} 积分得到的电子数。
 */
export function integrateDos(dos, limit = dos.efermi) {
  let total = 0
  for (let i = 1; i < dos.energies.length; i += 1) {
    if (dos.energies[i] > limit) break
    const de = dos.energies[i] - dos.energies[i - 1]
    const a = dos.up[i - 1] + dos.down[i - 1]
    const b = dos.up[i] + dos.down[i]
    total += 0.5 * (a + b) * de
  }
  return total
}

/** 读 DOSCAR 文件。 */
export function readDoscarFile(path) {
  return parseDoscar(readFileSync(path, 'utf8'))
}

/**
 * 生成 DOS 曲线 HTML（子进程跑 scripts/make-dos.mjs，理由同 generateWebglViewer）。
 * @param {string} doscarPath - DOSCAR 绝对路径。
 * @param {{ out?: string, window?: number }} [options] - 输出路径与能量窗口。
 * @returns {Promise<object>} 生成器的 JSON 输出（含 out / nedos / efermi / integratedElectrons）。
 */
export function generateDosViewer(doscarPath, options = {}) {
  const args = [doscarPath]
  if (options.out) args.push('--out', toAbsolute(String(options.out), process.cwd()))
  if (Number.isFinite(options.window)) args.push('--window', String(options.window))
  return runNodeScript('make-dos.mjs', args, 'DOS 图')
}

// ---------------------------------------------------------------------------
// EIGENVAL：能带本征值（每个 k 点 × 每条带）与带隙
// ---------------------------------------------------------------------------
/**
 * 解析 VASP EIGENVAL。
 * 第 6 行是 `NELECT NKPTS NBANDS`，之后每个 k 点一行四列（kx ky kz 权重），
 * 紧跟 NBANDS 行（带序号、本征值 eV、占据数）。
 * @param {string} text - EIGENVAL 文本。
 * @returns {{ natoms: number, nelect: number, nkpts: number, nbands: number, kpoints: Array<{ k: number[], weight: number }>, energies: number[][], occupations: number[][] }}
 */
export function parseEigenval(text) {
  const lines = text.split(/\r?\n/)
  const header = (lines[0] ?? '').trim().split(/\s+/).map(Number)
  const natoms = Number.isFinite(header[0]) ? header[0] : 1
  let cursor = -1
  let counts = null
  for (let i = 1; i < Math.min(lines.length, 12); i += 1) {
    const parts = (lines[i] ?? '').trim().split(/\s+/).filter((t) => t.length > 0)
    if (parts.length !== 3) continue
    const nums = parts.map(Number)
    if (nums.every((v) => Number.isInteger(v)) && nums[1] >= 1 && nums[2] >= 1) {
      cursor = i
      counts = nums
      break
    }
  }
  if (cursor < 0) throw new Error('EIGENVAL：找不到 `NELECT NKPTS NBANDS` 行')
  const [nelect, nkpts, nbands] = counts
  const kpoints = []
  const energies = []
  const occupations = []
  const energiesDown = []
  const occupationsDown = []
  let spinPolarized = false
  let i = cursor + 1
  const nextNonEmpty = () => {
    while (i < lines.length && (lines[i] ?? '').trim() === '') i += 1
    return i < lines.length ? lines[i] : null
  }
  for (let k = 0; k < nkpts; k += 1) {
    if (nextNonEmpty() === null) throw new Error(`EIGENVAL：数据在 k=${k} 处提前结束`)
    const kparts = (lines[i] ?? '').trim().split(/\s+/).map(Number)
    if (kparts.length < 4 || kparts.slice(0, 3).some((v) => !Number.isFinite(v))) {
      throw new Error(`EIGENVAL：第 ${i + 1} 行不是 k 点行`)
    }
    kpoints.push({ k: kparts.slice(0, 3), weight: kparts[3] })
    i += 1
    const bands = []
    const occ = []
    const bandsDown = []
    const occDown = []
    for (let b = 0; b < nbands; b += 1) {
      const parts = (lines[i] ?? '').trim().split(/\s+/).map(Number)
      if (parts.length < 3 || !Number.isFinite(parts[1])) {
        throw new Error(`EIGENVAL：k=${k} 的第 ${b + 1} 条带读不到本征值`)
      }
      // ISPIN=2 时每行是 5 列：带号 E_up E_down occ_up occ_down；ISPIN=1 是 3 列。
      if (parts.length >= 5) {
        spinPolarized = true
        bands.push(parts[1])
        bandsDown.push(parts[2])
        occ.push(parts[3])
        occDown.push(parts[4])
      } else {
        bands.push(parts[1])
        occ.push(parts[2])
      }
      i += 1
    }
    energies.push(bands)
    occupations.push(occ)
    if (spinPolarized) {
      energiesDown.push(bandsDown)
      occupationsDown.push(occDown)
    }
  }
  return {
    natoms,
    nelect,
    nkpts,
    nbands,
    kpoints,
    energies,
    occupations,
    energiesDown: spinPolarized ? energiesDown : [],
    occupationsDown: spinPolarized ? occupationsDown : [],
    spinPolarized,
  }
}

export function bandGap(eigen) {
  let vbm = -Infinity
  let cbm = Infinity
  let vbmK = -1
  let cbmK = -1
  const consider = (energies, occupations) => {
    if (!Array.isArray(energies) || energies.length === 0) return
    for (let k = 0; k < eigen.nkpts; k += 1) {
      for (let b = 0; b < eigen.nbands; b += 1) {
        const energy = energies[k][b]
        const occupation = occupations[k][b]
        if (occupation > 0.5) {
          if (energy > vbm) {
            vbm = energy
            vbmK = k
          }
        } else if (energy < cbm) {
          cbm = energy
          cbmK = k
        }
      }
    }
  }
  consider(eigen.energies, eigen.occupations)
  // 自旋极化时两个自旋通道都要看：占据带取更高的，空带取更低的。
  consider(eigen.energiesDown, eigen.occupationsDown)
  const gap = cbm - vbm
  return { vbm, cbm, gap, direct: vbmK === cbmK, vbmK, cbmK, metallic: Number.isFinite(gap) && gap <= 1e-6 }
}

/** 读 EIGENVAL 文件。 */
export function readEigenvalFile(path) {
  return parseEigenval(readFileSync(path, 'utf8'))
}

/**
 * 生成能带图 HTML（子进程跑 scripts/make-bands.mjs）。
 * @param {string} eigenvalPath - EIGENVAL 绝对路径。
 * @param {{ out?: string, connect?: boolean }} [options] - 输出路径与是否按文件顺序连线。
 * @returns {Promise<object>} 生成器 JSON（含 out / nkpts / nbands / gap / direct）。
 */
export function generateBandsViewer(eigenvalPath, options = {}) {
  const args = [eigenvalPath]
  if (options.out) args.push('--out', toAbsolute(String(options.out), process.cwd()))
  if (options.connect) args.push('--connect')
  return runNodeScript('make-bands.mjs', args, '能带图')
}

// ---------------------------------------------------------------------------
// OUTCAR：任务体检（能量、电子步、力、告警、收尾）
// ---------------------------------------------------------------------------
/**
 * 解析 OUTCAR 的关键信息。注意：OUTCAR 每个电子步都会输出一次能量，
 * 这里的能量一律取**最后一次**（即最终值）。
 * @param {string} text - OUTCAR 文本。
 * @returns {object} 任务摘要。
 */
export function parseOutcar(text) {
  const lines = text.split(/\r?\n/)
  const lastMatch = (regex) => {
    let value = null
    let match
    while ((match = regex.exec(text)) !== null) value = match
    return value
  }
  const num = (regex) => {
    const match = lastMatch(regex)
    return match ? Number(match[1]) : null
  }
  const version = (lines[0] ?? '').trim()
  const encut = num(/ENCUT\s*=\s*([\d.]+)/g)
  const nelect = num(/NELECT\s*=\s*([\d.]+)/g)
  const ispin = num(/ISPIN\s*=\s*(\d+)/g)
  const nbands = num(/NBANDS=\s*(\d+)/g)
  const nkpts = num(/NKPTS\s*=\s*(\d+)/g)
  const efermi = num(/E-fermi\s*:\s*(-?[\d.]+)/g)
  const toten = num(/free\s+energy\s+TOTEN\s*=\s*(-?[\d.]+)/g)
  const sigma0 = num(/energy\(sigma->0\)\s*=\s*(-?[\d.]+)/g)
  const cpuSeconds = num(/Total CPU time used \(sec\):\s*([\d.]+)/g)

  // 最后一个 TOTAL-FORCE 块里的最大力
  let maxForce = null
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes('TOTAL-FORCE')) continue
    const forces = []
    for (let j = i + 2; j < lines.length; j += 1) {
      const line = lines[j]
      if (line.includes('---') || line.includes('total drift')) break
      const parts = line.trim().split(/\s+/).map(Number)
      if (parts.length < 6 || parts.some((v) => !Number.isFinite(v))) continue
      forces.push(Math.hypot(parts[3], parts[4], parts[5]))
    }
    if (forces.length > 0) maxForce = Math.max(...forces)
  }

  // 逐个原子的力（最后一个 TOTAL-FORCE 块），以及平均力
  const forceMagnitudes = []
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes('TOTAL-FORCE')) continue
    const block = []
    for (let j = i + 2; j < lines.length; j += 1) {
      const line = lines[j]
      if (line.includes('---') || line.includes('total drift')) break
      const parts = line.trim().split(/\s+/).map(Number)
      if (parts.length < 6 || parts.some((v) => !Number.isFinite(v))) continue
      block.push(Math.hypot(parts[3], parts[4], parts[5]))
    }
    if (block.length > 0) {
      forceMagnitudes.length = 0
      forceMagnitudes.push(...block)
    }
  }
  const meanForce = forceMagnitudes.length > 0
    ? forceMagnitudes.reduce((sum, value) => sum + value, 0) / forceMagnitudes.length
    : null

  // 应力张量（最后一条 "in kB" 行，单位 kB）
  let stress = null
  for (const line of lines) {
    const match = /in kB\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(line)
    if (match) {
      stress = {
        xx: Number(match[1]), yy: Number(match[2]), zz: Number(match[3]),
        xy: Number(match[4]), yz: Number(match[5]), zx: Number(match[6]),
      }
    }
  }

  const warnings = []
  const watch = [
    ['ZBRENT', '离子步没收敛（ZBRENT）'],
    ['EDDDAV', '电子步发散（EDDDAV）'],
    ['TOO FEW BANDS', 'NBANDS 不足（TOO FEW BANDS）'],
    ['BRMIX', '混合器告警（BRMIX）'],
    ['Error', '出现 Error 行'],
  ]
  for (const [token, label] of watch) {
    if (text.includes(token)) warnings.push(label)
  }

  return {
    version,
    nkpts,
    nbands,
    ispin,
    encut,
    nelect,
    efermi,
    toten,
    sigma0,
    maxForce,
    meanForce,
    forceCount: forceMagnitudes.length,
    stress,
    cpuSeconds,
    convergedScf: text.includes('aborting loop because EDIFF is reached'),
    finished: text.includes('General timing and accounting informations'),
    warnings,
  }
}

/** 读 OUTCAR 文件。 */
export function readOutcarFile(path) {
  return parseOutcar(readFileSync(path, 'utf8'))
}

/**
 * 对一个任务目录做交叉体检：OUTCAR / OSZICAR / DOSCAR / EIGENVAL 互相印证。
 * 只读，不写任何文件。
 * @param {string} dir - 任务目录。
 * @returns {Promise<{ outcar: object, oszicar: object|null, doscar: object|null, eigenval: object|null, checks: Array<{ name: string, ok: boolean, detail: string }> }>}
 */
export async function inspectTask(dir) {
  const outcarPath = join(dir, 'OUTCAR')
  if (!existsSync(outcarPath)) throw new Error(`目录里没有 OUTCAR：${dir}`)
  const outcar = parseOutcar(readFileSync(outcarPath, 'utf8'))
  const checks = []

  checks.push({
    name: '计算收尾',
    ok: outcar.finished,
    detail: outcar.finished ? `正常收尾，CPU ${outcar.cpuSeconds ?? '?'} s` : '没有找到 General timing 段（可能中断）',
  })
  checks.push({
    name: 'SCF 收敛',
    ok: outcar.convergedScf,
    detail: outcar.convergedScf ? 'EDIFF 达标' : '未看到 EDIFF 收敛标记',
  })
  checks.push({
    name: '告警',
    ok: outcar.warnings.length === 0,
    detail: outcar.warnings.length === 0 ? '无常见告警' : outcar.warnings.join('；'),
  })

  // 输入参数体检：ENCUT 与 POTCAR ENMAX 的比值、k 网格密度
  let incar = null
  let potcar = null
  let potcarText = null
  let kpoints = null
  const incarPath = join(dir, 'INCAR')
  if (existsSync(incarPath)) incar = parseIncar(readFileSync(incarPath, 'utf8'))
  const potcarPath = join(dir, 'POTCAR')
  if (existsSync(potcarPath)) {
    potcarText = readFileSync(potcarPath, 'utf8')
    potcar = potcarEnmax(potcarText)
  }
  const kpointsPath = join(dir, 'KPOINTS')
  if (existsSync(kpointsPath)) kpoints = parseKpoints(readFileSync(kpointsPath, 'utf8'))

  const encut = incar && incar.ENCUT ? Number(incar.ENCUT) : outcar.encut
  if (encut && potcar && potcar.enmax) {
    const ratio = encut / potcar.enmax
    const recommended = Math.ceil(potcar.enmax * 1.3)
    checks.push({
      name: 'ENCUT vs ENMAX',
      ok: ratio >= 1.3 - 1e-9,
      detail: `${encut} eV = ${ratio.toFixed(2)}×ENMAX(${potcar.enmax})`
        + (ratio >= 1.3 - 1e-9 ? '' : `，常见建议 ≥ ${recommended} eV`),
    })
  }
  // 结构体检：板层模型的真空层厚度、每原子能量
  let poscar = null
  const poscarPath = join(dir, 'POSCAR')
  if (existsSync(poscarPath)) {
    try {
      const symbols = potcar ? potcarElements(readFileSync(join(dir, 'POTCAR'), 'utf8')) : undefined
      poscar = parsePoscar(readFileSync(poscarPath, 'utf8'), 'POSCAR', { symbols })
    } catch {
      poscar = null
    }
  }
  if (poscar) {
    const geometry = slabVacuum(poscar)
    if (geometry.slabLike) {
      checks.push({
        name: '真空层',
        ok: geometry.vacuum >= 10,
        detail: `${geometry.vacuum.toFixed(2)} Å（c = ${geometry.c.toFixed(2)}，层厚 ${geometry.thickness.toFixed(2)}）`,
      })
    }
    // ── vasprun.xml：可与 OUTCAR/CONTCAR 交叉核对，也能在 OUTCAR 截断时兜底 ──
    if (outcar.sigma0 === null) {
      const fallbackPath = join(dir, 'vasprun.xml')
      if (existsSync(fallbackPath) && statSync(fallbackPath).size < 200 * 1024 * 1024) {
        try {
          const parsed = parseVasprunXml(readFileSync(fallbackPath, 'utf8'))
          const finalEnergy = parsed.energies.length > 0 ? parsed.energies[parsed.energies.length - 1] : null
          if (finalEnergy !== null) {
            outcar.sigma0 = finalEnergy
            checks.push({
              name: '能量来源',
              ok: true,
              detail: 'OUTCAR 无能量（可能截断），改用 vasprun.xml 的终态 e_0_energy',
            })
          }
        } catch {
          /* 兜底失败就保持原状 */
        }
      }
    }
    if (outcar.sigma0 && poscar.atoms.length > 0) {
      checks.push({
        name: '每原子能量',
        ok: true,
        detail: `${(outcar.sigma0 / poscar.atoms.length).toFixed(4)} eV/atom（${poscar.atoms.length} 原子）`,
      })
    }
  }

  if (outcar.stress) {
    const components = [outcar.stress.xx, outcar.stress.yy, outcar.stress.zz, outcar.stress.xy, outcar.stress.yz, outcar.stress.zx]
    const maxStress = Math.max(...components.map((value) => Math.abs(value)))
    // VASP 的 "in kB" 是 kBar，1 kBar = 0.1 GPa；静水压 P = −(σxx+σyy+σzz)/3
    const hydroKbar = (outcar.stress.xx + outcar.stress.yy + outcar.stress.zz) / 3
    const pressureGPa = -hydroKbar / 10
    checks.push({
      name: '应力张量',
      ok: true,
      detail: `${components.map((value) => value.toFixed(2)).join(' / ')} kB`
        + `（最大 |σ| = ${maxStress.toFixed(2)}，静水压 ${pressureGPa.toFixed(2)} GPa）`,
    })
  }
  // 输入自洽：POTCAR 的 ZVAL × POSCAR 原子数 应等于 OUTCAR 的 NELECT
  if (potcarText && poscar && outcar.nelect !== null) {
    const zval = potcarZval(potcarText)
    const symbols = potcarElements(potcarText)
    const counts = new Map()
    for (const atom of poscar.atoms) counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1)
    let expected = 0
    for (let index = 0; index < symbols.length; index += 1) {
      expected += (zval.values[index] ?? 0) * (counts.get(symbols[index]) ?? 0)
    }
    if (expected > 0) {
      checks.push({
        name: 'POTCAR ZVAL ↔ NELECT',
        ok: Math.abs(expected - outcar.nelect) < 1e-3,
        detail: symbols.map((symbol, index) => `${symbol}:${zval.values[index] ?? '?'}`).join(' ')
          + ` × 原子数 → ${expected} e，OUTCAR NELECT ${outcar.nelect}`,
      })
    }
  }
  if (outcar.nelect && outcar.nbands) {
    // 相对判据：空带至少留 15%。原先的「NELECT/2 + 原子数」在 51 原子的真实板层里
    // 误报了 83/116 个任务（136 个真实任务审计的结论）。
    const occupied = outcar.nelect / 2
    const recommended = Math.ceil(occupied * 1.15)
    checks.push({
      name: 'NBANDS 下限',
      ok: outcar.nbands >= recommended,
      detail: `NBANDS ${outcar.nbands} vs 建议 ≥ ${recommended}（占据带 ${occupied} 的 1.15 倍）`,
    })
  }
  if (outcar.meanForce !== null) {
    checks.push({
      name: '平均力',
      ok: true,
      detail: `${outcar.meanForce.toExponential(2)} eV/Å（${outcar.forceCount} 个原子）`,
    })
  }

  if (kpoints && kpoints.mesh) {
    checks.push({
      name: 'k 网格',
      ok: true,
      detail: `${kpoints.mesh.join('×')} = ${kpoints.total} 点（${kpoints.mode}）`,
    })
  }
  // IBZKPT：不可约 k 点数与对称性约化倍数（权重之和 = 完整网格点数）
  const ibzkptPath = join(dir, 'IBZKPT')
  let ibzkpt = null
  if (existsSync(ibzkptPath) && statSync(ibzkptPath).size > 0) {
    try {
      ibzkpt = parseIbzkpt(readFileSync(ibzkptPath, 'utf8'))
      const ratio = ibzkpt.totalWeight / ibzkpt.count
      const consistent = outcar.nkpts === null || outcar.nkpts === ibzkpt.count
      checks.push({
        name: 'k 点约化',
        ok: consistent,
        detail: `IBZ ${ibzkpt.count} / 总 ${ibzkpt.totalWeight}（${ratio.toFixed(2)}×）`
          + (consistent ? '' : `，与 OUTCAR NKPTS=${outcar.nkpts} 不一致`),
      })
    } catch {
      ibzkpt = null
    }
  }

  let oszicar = null
  const oszicarPath = join(dir, 'OSZICAR')
  if (existsSync(oszicarPath)) {
    const lines = readFileSync(oszicarPath, 'utf8').trim().split(/\r?\n/)
    const last = lines[lines.length - 1] ?? ''
    const match = /F=\s*(-?[\d.E+-]+)/.exec(last)
    oszicar = { lastLine: last.trim(), energy: match ? Number(match[1]) : null }
    if (oszicar.energy !== null && outcar.toten !== null) {
      const delta = Math.abs(oszicar.energy - outcar.toten)
      checks.push({ name: 'OUTCAR↔OSZICAR 能量', ok: delta < 1e-4, detail: `Δ = ${delta.toExponential(2)} eV` })
    }
  }

  let doscar = null
  let doscarScaled = false
  const doscarPath = join(dir, 'DOSCAR')
  if (existsSync(doscarPath) && statSync(doscarPath).size >= 100) {
    let dos = null
    try {
      dos = parseDoscar(readFileSync(doscarPath, 'utf8'))
    } catch (error) {
      checks.push({ name: 'DOSCAR 可用性', ok: false, detail: `DOSCAR 读取失败：${error.message.slice(0, 80)}` })
    }
    if (dos) {
      const electrons = integrateDos(dos)
      doscar = { efermi: dos.efermi, electrons, nedos: dos.nedos, spinPolarized: dos.spinPolarized, parsed: dos }
    if (outcar.nelect !== null) {
      const delta = Math.abs(electrons - outcar.nelect)
      if (delta < 0.01) {
        checks.push({ name: 'DOSCAR 积分↔NELECT', ok: true, detail: `∫DOS = ${electrons.toFixed(3)} e，NELECT ${outcar.nelect}` })
      } else {
        // 用 DOSCAR 自带的积分列做交叉判断：两者一致 → 我们的梯形积分没错，是文件里的 DOS 值被缩放过
        let selfIntegral = null
        if (Array.isArray(dos.integratedUp) && dos.integratedUp.length > 0) {
          let atFermi = 0
          for (let index = 0; index < dos.energies.length; index += 1) {
            if (dos.energies[index] <= dos.efermi) atFermi = index
          }
          const upValue = dos.integratedUp[atFermi] ?? 0
          const downValue = Array.isArray(dos.integratedDown) && dos.integratedDown.length > 0
            ? dos.integratedDown[atFermi] ?? 0
            : 0
          selfIntegral = upValue + downValue
        }
        const selfConsistent = selfIntegral !== null && electrons > 0
          && Math.abs(electrons - selfIntegral) / electrons < 0.02
        const factor = electrons > 0 && outcar.nelect > 0 ? outcar.nelect / electrons : null
        doscarScaled = selfConsistent
        if (selfConsistent) {
          // 计算本身没问题，只是这份 DOSCAR 的 DOS 值被缩放/归一化过 → 单独一项，不参与「关键不一致」判定
          checks.push({
            name: 'DOSCAR 被缩放（非原始输出）',
            ok: false,
            detail: `∫DOS = ${electrons.toFixed(3)} e 与文件自带积分列 ${selfIntegral.toFixed(3)} 一致，但 NELECT = ${outcar.nelect}`
              + `（相差 ${factor === null ? '?' : factor.toFixed(1)} 倍）—— `
              + (factor !== null && outcar.nelect > 0 && Math.abs(factor - outcar.nelect) / outcar.nelect < 0.05
                ? 'DOS 值被归一化成「1 电子/胞」，建议从原始计算重新取 DOSCAR'
                : 'DOS 值被缩放过，建议核对后处理流程'),
          })
        }
        if (!selfConsistent) {
          checks.push({
            name: 'DOSCAR 积分↔NELECT',
            ok: false,
            detail: `∫DOS = ${electrons.toFixed(3)} e，NELECT ${outcar.nelect}`
              + (selfIntegral === null ? '' : `（文件自带积分列 ${selfIntegral.toFixed(3)}，与我们的积分不一致，可能是解析问题）`),
          })
        }
      }
    }
      if (outcar.efermi !== null) {
        const delta = Math.abs(doscar.efermi - outcar.efermi)
        checks.push({ name: 'DOSCAR↔OUTCAR E-fermi', ok: delta < 0.01, detail: `Δ = ${delta.toExponential(2)} eV` })
      }
    }
  }

  if (existsSync(doscarPath)) {
    const size = statSync(doscarPath).size
    if (size < 100) {
      checks.push({ name: 'DOSCAR 可用性', ok: false, detail: `DOSCAR 只有 ${size} 字节（空/不完整），跳过 DOS 相关核对` })
    }
  }

  // ── vasprun.xml：XML 输出，可与 OUTCAR / CONTCAR 交叉核对，也能在 OUTCAR 截断时兜底 ──
  let vasprun = null
  const vasprunPath = join(dir, 'vasprun.xml')
  if (existsSync(vasprunPath)) {
    const size = statSync(vasprunPath).size
    if (size > 200 * 1024 * 1024) {
      checks.push({ name: 'vasprun 可用性', ok: false, detail: `vasprun.xml 有 ${(size / 1048576).toFixed(0)} MB，跳过大文件解析` })
    } else {
      try {
        const parsed = parseVasprunXml(readFileSync(vasprunPath, 'utf8'))
        const finalEnergy = parsed.energies.length > 0 ? parsed.energies[parsed.energies.length - 1] : null
        vasprun = {
          version: parsed.version,
          ionicSteps: parsed.ionicSteps,
          energies: parsed.energies.length,
          energy: finalEnergy,
          efermi: parsed.efermi,
          nbands: parsed.nbands,
          nelect: parsed.nelect,
          maxForce: parsed.maxForce,
          types: parsed.types,
        }
        // 价电子自检：Σ(每物种原子数 × 价电子) 应等于 NELECT
        const zvalSum = parsed.types.reduce((sum, type) => sum + type.count * type.valence, 0)
        if (parsed.types.length > 0 && parsed.nelect !== null) {
          checks.push({
            name: 'vasprun 价电子 ↔ NELECT',
            ok: Math.abs(zvalSum - parsed.nelect) < 1e-3,
            detail: `Σ(原子数×ZVAL) = ${zvalSum} e，vasprun NELECT = ${parsed.nelect}`,
          })
        }
        if (finalEnergy !== null && outcar.sigma0 !== null) {
          const delta = Math.abs(finalEnergy - outcar.sigma0)
          checks.push({ name: 'vasprun↔OUTCAR 能量', ok: delta < 1e-4, detail: `Δ = ${delta.toExponential(2)} eV` })
        }
        if (parsed.efermi !== null && outcar.efermi !== null) {
          const delta = Math.abs(parsed.efermi - outcar.efermi)
          checks.push({ name: 'vasprun↔OUTCAR 费米能级', ok: delta < 0.01, detail: `Δ = ${delta.toExponential(2)} eV` })
        }
        // 终态坐标与 CONTCAR 对拍（注意：体检里的 poscar 是初始 POSCAR，不能用来比）
        const contcarPath = join(dir, 'CONTCAR')
        if (existsSync(contcarPath) && statSync(contcarPath).size > 0) {
          let contcar = null
          try {
            // CONTCAR 自带元素行；不能传外部 symbols（作用域不对会被内层 catch 静默吞掉）
            contcar = parsePoscar(readFileSync(contcarPath, 'utf8'), 'CONTCAR')
          } catch {
            contcar = null
          }
          if (parsed.finalStructure && contcar && parsed.finalStructure.positions.length === contcar.atoms.length) {
            let maxDiff = 0
            for (let index = 0; index < contcar.atoms.length; index += 1) {
              for (let axis = 0; axis < 3; axis += 1) {
                const a = parsed.finalStructure.positions[index][axis]
                const b = contcar.atoms[index].frac[axis]
                let diff = Math.abs(a - b)
                diff = Math.min(diff, Math.abs(diff - 1), Math.abs(diff + 1))
                if (diff > maxDiff) maxDiff = diff
              }
            }
            checks.push({
              name: 'vasprun↔CONTCAR 终态坐标',
              ok: maxDiff < 1e-3,
              detail: `最大分数坐标差 = ${maxDiff.toExponential(2)}`,
            })
          }
        }
      } catch (error) {
        checks.push({ name: 'vasprun 可用性', ok: false, detail: `vasprun.xml 解析失败：${String(error.message).slice(0, 80)}` })
      }
    }
  }

  let eigenval = null
  let eigen = null
  const eigenvalPath = join(dir, 'EIGENVAL')
  if (existsSync(eigenvalPath) && statSync(eigenvalPath).size > 0) {
    try {
      eigen = parseEigenval(readFileSync(eigenvalPath, 'utf8'))
    } catch (error) {
      // 真实数据里见过被截断的 EIGENVAL（例如 0.2 KB DOSCAR 的同一批任务）
      eigen = null
      checks.push({ name: 'EIGENVAL 可用性', ok: false, detail: `EIGENVAL 读取失败：${error.message.slice(0, 80)}` })
    }
  }
  if (eigen) {
    const gap = bandGap(eigen)
    eigenval = { nkpts: eigen.nkpts, nbands: eigen.nbands, gap: gap.gap, direct: gap.direct, natoms: eigen.natoms }
    if (outcar.nbands !== null && eigen.nbands !== outcar.nbands) {
      checks.push({ name: 'NBANDS 一致性', ok: false, detail: `EIGENVAL ${eigen.nbands} ≠ OUTCAR ${outcar.nbands}` })
    } else if (outcar.nbands !== null) {
      checks.push({ name: 'NBANDS 一致性', ok: true, detail: `${eigen.nbands} 条带` })
    }
    // 跨文件一致性：DOSCAR 判出的带隙 vs EIGENVAL 的带隙
    if (doscar && doscar.parsed && doscarScaled) {
      checks.push({
        name: '带隙一致性（DOS ↔ EIGENVAL）',
        ok: true,
        detail: '跳过：DOSCAR 的 DOS 值被缩放过，DOS 判带隙不可信，只以 EIGENVAL 为准',
      })
    } else if (doscar && doscar.parsed && outcar.efermi !== null) {
      const fromDos = dosGap(doscar.parsed)
      const energies = doscar.parsed.energies
      const grid = energies.length > 1 ? Math.abs(energies[1] - energies[0]) : 0
      if (fromDos.gap !== null && Number.isFinite(gap.gap)) {
        const delta = Math.abs(fromDos.gap - gap.gap)
        checks.push({
          name: '带隙一致性（DOS ↔ EIGENVAL）',
          // 容差 2 个格距：DOS 判带隙在 VBM/CBM 各有 ±1 格点的不确定度（真实数据实测结论）
          ok: delta <= Math.max(2 * grid, 0.05),
          detail: `DOS ${fromDos.gap.toFixed(3)} eV vs 能带 ${gap.gap.toFixed(3)} eV（Δ = ${delta.toFixed(3)}，能量格距 ${grid.toFixed(3)}）`,
        })
      }
    }
  }

  return { outcar, oszicar, doscar, eigenval, incar, potcar, kpoints, ibzkpt, vasprun, checks }
}

/**
 * 两个体积网格相减（例如 A − A_ref 得到电荷密度差）。
 * 要求网格维度一致（VASP 的 CHGCAR 通常可以直接对减；维度不同就要先重采样，这里直接报错）。
 * @param {{ dims: number[], origin: number[], steps: number[][], values: Float32Array }} base - 被减数。
 * @param {{ dims: number[], values: Float32Array }} ref - 减数。
 * @returns {{ dims: number[], origin: number[], steps: number[][], values: Float32Array }} 差值网格（可正可负）。
 */
export function differenceVolume(base, ref) {
  const [ax, ay, az] = base.dims
  const [bx, by, bz] = ref.dims
  if (ax !== bx || ay !== by || az !== bz) {
    throw new Error(`两个体积网格维度不一致：${base.dims.join('×')} vs ${ref.dims.join('×')}，无法相减`)
  }
  const values = new Float32Array(base.values.length)
  for (let i = 0; i < values.length; i += 1) values[i] = base.values[i] - ref.values[i]
  return { dims: base.dims.slice(), origin: base.origin.slice(), steps: base.steps.map((s) => s.slice()), values }
}

/**
 * 在一个根目录下递归找 VASP 任务（含 OUTCAR 的目录），逐个跑交叉体检。
 * 只读；遇到读不了的文件/目录直接跳过，不会让整次扫描失败。
 * @param {string} root - 根目录。
 * @param {{ maxDepth?: number, limit?: number }} [options] - 递归深度与任务数上限。
 * @returns {Promise<{ root: string, tasks: object[], scanned: number, skipped: string[] }>}
 */
export async function scanTasks(root, options = {}) {
  const maxDepth = Number.isInteger(options.maxDepth) ? options.maxDepth : 3
  const limit = Number.isInteger(options.limit) ? options.limit : 60
  const dirs = []
  const skipped = []
  const walk = (dir, depth) => {
    if (dirs.length >= limit) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      skipped.push(`${dir}（${error.code ?? "读取失败"}）`)
      return
    }
    const marker = options.marker ? new RegExp(`^${String(options.marker)}(\\.|$)`, 'i') : /^OUTCAR/i
    if (entries.some((entry) => entry.isFile() && marker.test(entry.name))) {
      dirs.push(dir)
      return
    }
    if (depth >= maxDepth) return
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith(".") || entry.name.startsWith("__")) continue
      walk(join(dir, entry.name), depth + 1)
    }
  }
  walk(root, 0)

  const tasks = []
  for (const dir of dirs) {
    try {
      const report = await inspectTask(dir)
      const failed = report.checks.filter((check) => !check.ok)
      tasks.push({
        name: dir.split(/[\\/]/).pop(),
        dir,
        ok: failed.length === 0,
        energy: report.outcar.toten,
        efermi: report.outcar.efermi,
        gap: report.eigenval ? report.eigenval.gap : null,
        maxForce: report.outcar.maxForce,
        cpuSeconds: report.outcar.cpuSeconds,
        warnings: report.outcar.warnings,
        failed: failed.map((check) => check.name),
      })
    } catch (error) {
      tasks.push({
        name: dir.split(/[\\/]/).pop(),
        dir,
        ok: false,
        energy: null,
        efermi: null,
        gap: null,
        maxForce: null,
        cpuSeconds: null,
        warnings: [],
        failed: [`体检失败：${error.message}`],
      })
    }
  }
  return { root, tasks, scanned: dirs.length, skipped }
}

/**
 * 对一个根目录做批量出图（结构 / DOS / 能带 + 索引页），子进程跑 scripts/make-all.mjs。
 * @param {string} root - 任务根目录。
 * @param {{ outDir?: string, repeat?: number[], maxDepth?: number }} [options] - 输出目录、扩胞、递归深度。
 * @returns {Promise<{ root: string, outDir: string, index: string, tasks: object[] }>}
 */
export function generateBatchAtlas(root, options = {}) {
  const args = ['--root', root]
  if (options.outDir) args.push('--out', toAbsolute(String(options.outDir), process.cwd()))
  if (Array.isArray(options.repeat) && options.repeat.length === 3) args.push('--repeat', options.repeat.join(','))
  if (Number.isInteger(options.maxDepth)) args.push('--depth', String(options.maxDepth))
  return runNodeScript('make-all.mjs', args, '批量图集')
}

// ---------------------------------------------------------------------------
// OSZICAR：电子步/离子步收敛序列
// ---------------------------------------------------------------------------
/**
 * 解析 OSZICAR。电子步行形如 `DAV: 24  E  dE  dE2  NCG  rms  rms2`，
 * 离子步汇总行形如 `1 F= -18.6 E0= -18.6 d E =... mag=...`。
 * @param {string} text - OSZICAR 文本。
 * @returns {{ steps: Array<{ iter: number, energy: number, dE: number, dE2: number }>, ions: Array<{ step: number, energy: number, e0: number }> }}
 */
export function parseOszicar(text) {
  const steps = []
  const ions = []
  for (const line of text.split(/\r?\n/)) {
    const electronic = /^\s*(?:DAV|RMM):\s*(\d+)\s+(-?[\d.Ee+-]+)\s+(-?[\d.Ee+-]+)\s+(-?[\d.Ee+-]+)/.exec(line)
    if (electronic) {
      steps.push({
        iter: Number(electronic[1]),
        energy: Number(electronic[2]),
        dE: Number(electronic[3]),
        dE2: Number(electronic[4]),
      })
      continue
    }
    const ionic = /^\s*(\d+)\s+F=\s*(-?[\d.Ee+-]+)\s+E0=\s*(-?[\d.Ee+-]+)/.exec(line)
    if (ionic) {
      ions.push({ step: Number(ionic[1]), energy: Number(ionic[2]), e0: Number(ionic[3]) })
    }
  }
  if (steps.length === 0 && ions.length === 0) {
    throw new Error('OSZICAR：没有找到 DAV/RMM 电子步行或离子步汇总行')
  }
  return { steps, ions }
}

/** 读 OSZICAR 文件。 */
export function readOszicarFile(path) {
  return parseOszicar(readFileSync(path, 'utf8'))
}

/**
 * 生成多任务叠加对比图（子进程跑 scripts/make-compare.mjs）。
 * @param {string} root - 任务根目录。
 * @param {{ kind?: "dos"|"conv", names?: string[], out?: string, window?: number }} [options] - 对比类型与筛选。
 * @returns {Promise<{ out: string, kind: string, tasks: string[] }>}
 */
export function generateCompareViewer(root, options = {}) {
  const args = ['--root', root, '--kind', options.kind === 'conv' ? 'conv' : 'dos']
  if (options.out) args.push('--out', toAbsolute(String(options.out), process.cwd()))
  if (Array.isArray(options.names) && options.names.length > 0) args.push('--names', options.names.join(','))
  if (Number.isFinite(options.window)) args.push('--window', String(options.window))
  return runNodeScript('make-compare.mjs', args, '对比图')
}

// ---------------------------------------------------------------------------
// INCAR / POTCAR / KPOINTS：输入参数体检
// ---------------------------------------------------------------------------
/**
 * 解析 INCAR 成 `{ 键: 原始值字符串 }`。支持行内 `;` 分隔的多标签与 `#`/`!` 注释。
 * @param {string} text - INCAR 文本。
 * @returns {Record<string, string>} 标签值表（键大写）。
 */
export function parseIncar(text) {
  const tags = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').replace(/!.*$/, '')
    for (const segment of line.split(';')) {
      const match = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/.exec(segment)
      if (match) tags[match[1].toUpperCase()] = match[2].trim()
    }
  }
  return tags
}

/**
 * 从 POTCAR 取 ENMAX（多元素时取最大值）与 ENMIN。
 * @param {string} text - POTCAR 文本。
 * @returns {{ enmax: number|null, enmin: number|null }}
 */
export function potcarEnmax(text) {
  let enmax = null
  let enmin = null
  for (const line of text.split(/\r?\n/)) {
    const match = /ENMAX\s*=\s*([\d.]+).*?ENMIN\s*=\s*([\d.]+)/.exec(line)
    if (!match) continue
    const max = Number(match[1])
    const min = Number(match[2])
    if (Number.isFinite(max)) enmax = enmax === null ? max : Math.max(enmax, max)
    if (Number.isFinite(min)) enmin = enmin === null ? min : Math.min(enmin, min)
  }
  return { enmax, enmin }
}

/**
 * 从 KPOINTS 取网格。自动网格（第 2 行为 0）返回 mesh 与总点数；line-mode 返回 mesh=null。
 * @param {string} text - KPOINTS 文本。
 * @returns {{ mode: string, mesh: number[]|null, total: number|null }}
 */
export function parseKpoints(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const count = Number((lines[1] ?? '').split(/\s+/)[0])
  const modeLine = (lines[2] ?? '').toLowerCase()
  if (/^[Ll]/.test(modeLine)) {
    // line mode（官方 KPOINTS 文档）：第 2 行是每段点数，第 4 行指定坐标系，
    // 之后每两行一段，行末可以带高对称点标签。
    const pointsPerSegment = Number((lines[1] ?? '').trim().split(/\s+/)[0]) || 0
    const coordinateLine = (lines[3] ?? '').trim()
    const coordinate = /^[CcKk]/.test(coordinateLine) ? 'cartesian' : 'fractional'
    const segments = []
    for (let i = 4; i + 1 < lines.length; i += 1) {
      const firstLine = (lines[i] ?? '').trim()
      if (firstLine === '' || /^(reciprocal|fractional|cartesian)$/i.test(firstLine)) continue
      const endLine = (lines[i + 1] ?? '').trim()
      if (endLine === '' || /^(reciprocal|fractional|cartesian)$/i.test(endLine)) continue
      const parsePoint = (line) => {
        const tokens = line.split(/\s+/)
        const k = tokens.slice(0, 3).map(Number)
        if (k.length !== 3 || k.some((value) => !Number.isFinite(value))) return null
        return { k, label: tokens.length > 3 ? tokens.slice(3).join(' ') : '' }
      }
      const from = parsePoint(firstLine)
      const to = parsePoint(endLine)
      if (!from || !to) continue
      segments.push({ from, to })
      i += 1
    }
    if (segments.length > 0) {
      return { mode: 'line', mesh: null, total: null, coordinate, pointsPerSegment, segments }
    }
    return { mode: 'line', mesh: null, total: null, coordinate, pointsPerSegment, segments }
  }
  if (count === 0) {
    const mesh = (lines[3] ?? '').split(/\s+/).map(Number).filter((value) => Number.isFinite(value))
    if (mesh.length === 3) {
      return {
        mode: /gamma/.test(modeLine) ? 'gamma' : 'monkhorst',
        mesh,
        total: mesh[0] * mesh[1] * mesh[2],
      }
    }
  }
  return { mode: count > 0 ? 'explicit' : 'unknown', mesh: null, total: null }
}

/**
 * 判断结构是不是带真空层的板层（c 远大于 a/b），并给出层厚与真空厚度。
 * 只对 c 轴垂直于 ab 面的常见板层模型有意义；体相结构会返回 `slabLike: false`。
 * @param {{ a1: number[], a2: number[], a3: number[], atoms: Array<{ frac: number[] }> }} structure - parsePoscar 的结果。
 * @returns {{ c: number, thickness: number, vacuum: number, slabLike: boolean }}
 */
export function slabVacuum(structure) {
  const norm = (vector) => Math.hypot(vector[0], vector[1], vector[2])
  const a = norm(structure.a1)
  const b = norm(structure.a2)
  const c = norm(structure.a3)
  const zs = structure.atoms.map((atom) => atom.frac[2])
  const spread = zs.length > 0 ? Math.max(...zs) - Math.min(...zs) : 0
  const thickness = spread * c
  const vacuum = c - thickness
  const slabLike = c > 1.5 * Math.max(a, b) && vacuum > 5
  return { c, thickness, vacuum, slabLike }
}

// ---------------------------------------------------------------------------
// XDATCAR：离子步轨迹（多帧）
// ---------------------------------------------------------------------------
/**
 * 解析 VASP XDATCAR。头部与 POSCAR 相同，之后每帧以 `Direct configuration= N` 开头，
 * 紧跟每个原子的分数坐标。
 * @param {string} text - XDATCAR 文本。
 * @returns {{ comment: string, scale: number, cell: number[][], symbols: string[], counts: number[], frames: Array<{ index: number, frac: number[][] }> }}
 */
export function parseXdatcar(text) {
  const lines = text.split(/\r?\n/)
  const comment = (lines[0] ?? '').trim()
  const scale = Number((lines[1] ?? '').trim().split(/\s+/)[0])
  if (!Number.isFinite(scale) || scale === 0) throw new Error('XDATCAR：第 2 行缩放因子无法解析')
  const cell = [2, 3, 4].map((index) => {
    const parts = (lines[index] ?? '').trim().split(/\s+/).map(Number)
    if (parts.length < 3 || parts.slice(0, 3).some((value) => !Number.isFinite(value))) {
      throw new Error(`XDATCAR：第 ${index + 1} 行晶胞向量无法解析`)
    }
    return parts.slice(0, 3).map((value) => value * scale)
  })
  const symbols = (lines[5] ?? '').trim().split(/\s+/).filter(Boolean)
  const counts = (lines[6] ?? '').trim().split(/\s+/).map(Number)
  if (symbols.length === 0 || counts.length === 0 || counts.some((value) => !Number.isInteger(value))) {
    throw new Error('XDATCAR：元素行或原子数行无法解析')
  }
  const natoms = counts.reduce((sum, value) => sum + value, 0)
  const frames = []
  let cursor = 7
  while (cursor < lines.length) {
    const line = (lines[cursor] ?? '').trim()
    if (line === '') { cursor += 1; continue }
    if (!/^(Direct|Cartesian) configuration/i.test(line)) { cursor += 1; continue }
    const index = Number(/configuration\s*=\s*(\d+)/.exec(line)?.[1] ?? frames.length + 1)
    const isCartesian = /cartesian/i.test(line)
    cursor += 1
    const frac = []
    for (let i = 0; i < natoms; i += 1) {
      const parts = (lines[cursor + i] ?? '').trim().split(/\s+/).map(Number)
      if (parts.length < 3 || parts.slice(0, 3).some((value) => !Number.isFinite(value))) {
        throw new Error(`XDATCAR：第 ${index} 帧的第 ${i + 1} 个原子坐标无法解析`)
      }
      frac.push(parts.slice(0, 3))
    }
    let normalized = frac
    if (isCartesian) {
      const inverse = invert3(cell)
      normalized = frac.map((vector) => [
        vector[0] * inverse[0][0] + vector[1] * inverse[1][0] + vector[2] * inverse[2][0],
        vector[0] * inverse[0][1] + vector[1] * inverse[1][1] + vector[2] * inverse[2][1],
        vector[0] * inverse[0][2] + vector[1] * inverse[1][2] + vector[2] * inverse[2][2],
      ])
    }
    frames.push({ index, frac: normalized, cartesian: isCartesian })
    cursor += natoms
  }
  if (frames.length === 0) throw new Error('XDATCAR：没有找到任何 Direct / Cartesian configuration 帧')
  return { comment, scale, cell, symbols, counts, frames }
}

/** 读 XDATCAR 文件。 */
export function readXdatcarFile(path) {
  return parseXdatcar(readFileSync(path, 'utf8'))
}

// ---------------------------------------------------------------------------
// 倒格子与 k 路径距离
// ---------------------------------------------------------------------------
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * 由实空间晶胞向量算倒格子向量（含 2π）：b₁ = 2π (a₂×a₃)/V 等。
 * @param {number[][]} cell - 三个实空间晶胞向量（Å）。
 * @returns {number[][]} 三个倒格子向量（1/Å，含 2π）。
 */
export function reciprocalLattice(cell) {
  const [a1, a2, a3] = cell
  const volume = dot(a1, cross(a2, a3))
  if (!Number.isFinite(volume) || Math.abs(volume) < 1e-12) throw new Error('晶胞体积为零，无法计算倒格子')
  const scale = (2 * Math.PI) / volume
  return [cross(a2, a3).map((value) => value * scale), cross(a3, a1).map((value) => value * scale), cross(a1, a2).map((value) => value * scale)]
}

/**
 * 把 EIGENVAL 的 k 点序列换算成路径距离（累积 |Δk|，2π/Å）。
 * 只有 k 点是按高对称路径排列时才有物理意义；IBZ 网格上仅作可视化用。
 * @param {Array<{ k: number[] }>} kpoints - EIGENVAL 的 k 点（分数坐标）。
 * @param {number[][]} cell - 实空间晶胞向量。
 * @returns {{ distances: number[], total: number }}
 */
export function bandPathDistances(kpoints, cell) {
  const reciprocal = reciprocalLattice(cell)
  const toCart = (k) => [0, 1, 2].map((axis) => k[0] * reciprocal[0][axis] + k[1] * reciprocal[1][axis] + k[2] * reciprocal[2][axis])
  const distances = [0]
  for (let i = 1; i < kpoints.length; i += 1) {
    const previous = toCart(kpoints[i - 1].k)
    const current = toCart(kpoints[i].k)
    const step = Math.hypot(current[0] - previous[0], current[1] - previous[1], current[2] - previous[2])
    distances.push(distances[i - 1] + step)
  }
  return { distances, total: distances[distances.length - 1] ?? 0 }
}

// ---------------------------------------------------------------------------
// PDOS：DOSCAR 的逐原子/逐轨道块（LORBIT >= 11）
// ---------------------------------------------------------------------------
/**
 * 解析 DOSCAR 里逐原子的 PDOS 块。
 * 总态密度块之后的每个原子块：一行 `Emax Emin NEDOS Efermi weight`，
 * 再跟 NEDOS 行 `E s [p d f]`（ISPIN=1）或 `E s↑ s↓ p↑ p↓ d↑ d↓`（ISPIN=2）。
 * 列数按「E 之后有几列」判断：3 → s,p,d；7 → s,p,d 双自旋；4 → s,p,d,f。
 * @param {string} text - DOSCAR 文本。
 * @returns {{ natoms: number, atoms: Array<{ index: number, efermi: number, weight: number, energies: number[], orbitals: Record<string, { up: number[], down: number[] }> }> }}
 */
export function parseDoscarPdos(text) {
  const lines = text.split(/\r?\n/)
  const header = (lines[0] ?? '').trim().split(/\s+/).map(Number)
  const natoms = Number.isFinite(header[0]) ? Math.abs(Math.round(header[0])) : 0
  // 头部第 3 个数：0 = 无 partial DOS，1 = 含（官方 DOSCAR 格式）
  const hasPartial = header.length >= 3 ? header[2] === 1 : true
  // 找总 DOS 的头行（Emax Emin NEDOS Efermi weight）
  let cursor = -1
  let totalLines = 0
  for (let i = 1; i < Math.min(lines.length, 12); i += 1) {
    const parts = (lines[i] ?? '').trim().split(/\s+/).map(Number)
    if (parts.length >= 4 && Number.isInteger(parts[2]) && parts[2] >= 2 && parts[0] > parts[1]) {
      cursor = i
      totalLines = Math.round(parts[2])
      break
    }
  }
  if (cursor < 0) throw new Error('DOSCAR：找不到 `Emax Emin NEDOS E-fermi` 头行')
  // 头部的 partial 标志只作参考：文件里若确实有逐原子块，仍然解析（容忍不自洽的文件）
  const atoms = []
  let i = cursor + 1 + totalLines
  const nextNonEmpty = () => {
    while (i < lines.length && (lines[i] ?? '').trim() === '') i += 1
    return i < lines.length
  }
  for (let atom = 0; atom < natoms; atom += 1) {
    if (!nextNonEmpty()) break
    const head = (lines[i] ?? '').trim().split(/\s+/).map(Number)
    if (head.length < 4) break
    const nedos = Math.round(head[2])
    const efermi = head[3]
    const weight = Number.isFinite(head[4]) ? head[4] : 1
    i += 1
    const energies = []
    const rows = []
    for (let row = 0; row < nedos && i < lines.length; row += 1, i += 1) {
      const parts = (lines[i] ?? '').trim().split(/\s+/).map(Number)
      if (parts.length < 2 || !Number.isFinite(parts[0])) break
      energies.push(parts[0])
      rows.push(parts.slice(1))
    }
    const width = rows[0]?.length ?? 0
    const orbitals = {}
    const sumColumns = (indexes) => rows.map((r) => indexes.reduce((sum, index) => sum + (r[index] ?? 0), 0))
    if (width >= 18) {
      // lm 分辨 + 双自旋：s↑ s↓ 之后是每个 p/d 分量的 (↑,↓) 对
      orbitals.s = { up: rows.map((r) => r[0] ?? 0), down: rows.map((r) => r[1] ?? 0) }
      orbitals.p = { up: sumColumns([2, 4, 6]), down: sumColumns([3, 5, 7]) }
      orbitals.d = { up: sumColumns([8, 10, 12, 14, 16]), down: sumColumns([9, 11, 13, 15, 17]) }
    } else if (width >= 9) {
      // lm 分辨、单自旋：s, p_y p_z p_x, d_xy d_yz d_z2 d_xz d_x2-y2
      orbitals.s = { up: rows.map((r) => r[0] ?? 0), down: [] }
      orbitals.p = { up: sumColumns([1, 2, 3]), down: [] }
      orbitals.d = { up: sumColumns([4, 5, 6, 7, 8]), down: [] }
    } else if (width >= 6) {
      orbitals.s = { up: rows.map((r) => r[0] ?? 0), down: rows.map((r) => r[1] ?? 0) }
      orbitals.p = { up: rows.map((r) => r[2] ?? 0), down: rows.map((r) => r[3] ?? 0) }
      orbitals.d = { up: rows.map((r) => r[4] ?? 0), down: rows.map((r) => r[5] ?? 0) }
      if (width >= 8) orbitals.f = { up: rows.map((r) => r[6] ?? 0), down: rows.map((r) => r[7] ?? 0) }
    } else if (width >= 5) {
      orbitals.s = { up: rows.map((r) => r[0] ?? 0), down: [] }
      orbitals.p = { up: rows.map((r) => r[1] ?? 0), down: [] }
      orbitals.d = { up: rows.map((r) => r[2] ?? 0), down: [] }
      orbitals.f = { up: rows.map((r) => r[3] ?? 0), down: [] }
    } else if (width >= 3) {
      orbitals.s = { up: rows.map((r) => r[0] ?? 0), down: [] }
      orbitals.p = { up: rows.map((r) => r[1] ?? 0), down: [] }
      orbitals.d = { up: rows.map((r) => r[2] ?? 0), down: [] }
    } else {
      throw new Error(`DOSCAR：第 ${atom + 1} 个原子块的列数不够（${width + 1} 列）`)
    }
    atoms.push({ index: atom + 1, efermi, weight, energies, orbitals })
  }
  return { natoms, atoms, hasPartial }
}

/**
 * PDOS 汇总：按元素把轨道 DOS 积分到费米能级，并算 d 带中心。
 * @param {ReturnType<typeof parseDoscarPdos>} pdos - PDOS 解析结果。
 * @param {{ symbols: string[], counts: number[] }} [structure] - 元素与每元素原子数（来自 POSCAR）。
 * @returns {Array<{ element: string, orbital: string, electrons: number, center: number|null }>}
 */
export function pdosSummary(pdos, structure) {
  const symbols = []
  if (structure && Array.isArray(structure.symbols) && Array.isArray(structure.counts)) {
    structure.symbols.forEach((symbol, index) => {
      for (let n = 0; n < structure.counts[index]; n += 1) symbols.push(symbol)
    })
  }
  const buckets = new Map()
  for (const atom of pdos.atoms) {
    const element = symbols[atom.index - 1] ?? `#${atom.index}`
    for (const [orbital, channels] of Object.entries(atom.orbitals)) {
      const energies = atom.energies
      const limit = atom.efermi
      let electrons = 0
      let firstMoment = 0
      let total = 0
      for (let i = 1; i < energies.length; i += 1) {
        if (energies[i] > limit) break
        const de = energies[i] - energies[i - 1]
        const upA = channels.up[i - 1] ?? 0
        const upB = channels.up[i] ?? 0
        const downA = channels.down[i - 1] ?? 0
        const downB = channels.down[i] ?? 0
        const average = 0.5 * (upA + upB + downA + downB)
        const energyMid = 0.5 * (energies[i - 1] + energies[i])
        electrons += average * de
        firstMoment += energyMid * average * de
        total += average * de
      }
      const key = `${element}|${orbital}`
      const bucket = buckets.get(key) ?? { element, orbital, electrons: 0, moment: 0, mass: 0 }
      bucket.electrons += electrons
      bucket.moment += firstMoment
      bucket.mass += total
      buckets.set(key, bucket)
    }
  }
  return [...buckets.values()]
    .map((bucket) => ({ element: bucket.element, orbital: bucket.orbital, electrons: bucket.electrons, center: bucket.mass > 1e-9 ? bucket.moment / bucket.mass : null }))
    .sort((a, b) => (a.element === b.element ? a.orbital.localeCompare(b.orbital) : a.element.localeCompare(b.element)))
}

/** 生成体检汇总表（Markdown/CSV），子进程跑 scripts/make-table.mjs。
 * @param {string} root - 任务根目录。
 * @param {{ out?: string, format?: "md"|"csv" }} [options] - 输出路径与格式。
 * @returns {Promise<{ out: string, format: string, tasks: number }>}
 */
export function generateTableFile(root, options = {}) {
  const args = ['--root', root, '--format', options.format === 'csv' ? 'csv' : 'md']
  if (options.out) args.push('--out', toAbsolute(String(options.out), process.cwd()))
  return runNodeScript('make-table.mjs', args, '汇总表')
}

/** 生成轨迹播放器 HTML，子进程跑 scripts/make-trajectory.mjs。
 * @param {string} xdatcarPath - XDATCAR 绝对路径。
 * @param {{ out?: string, oszicar?: string }} [options] - 输出路径与能量文件。
 * @returns {Promise<object>} 生成器 JSON。
 */
export function generateTrajectoryViewer(xdatcarPath, options = {}) {
  const args = [xdatcarPath]
  if (options.out) args.push('--out', toAbsolute(String(options.out), process.cwd()))
  if (options.oszicar) args.push('--oszicar', toAbsolute(String(options.oszicar), process.cwd()))
  return runNodeScript('make-trajectory.mjs', args, '轨迹播放器')
}

/** 生成 PDOS 曲线 HTML，子进程跑 scripts/make-pdos.mjs。
 * @param {string} doscarPath - DOSCAR 绝对路径。
 * @param {{ out?: string, window?: number }} [options] - 输出路径与能量窗口。
 * @returns {Promise<object>} 生成器 JSON。
 */
export function generatePdosViewer(doscarPath, options = {}) {
  const args = [doscarPath]
  if (options.out) args.push('--out', toAbsolute(String(options.out), process.cwd()))
  if (Number.isFinite(options.window)) args.push('--window', String(options.window))
  return runNodeScript('make-pdos.mjs', args, 'PDOS 图')
}

/**
 * 把 KPOINTS line-mode 的端点换算成分数坐标，供能带图标高对称点。
 * Cartesian 坐标的单位是 2π/a（a 为 POSCAR 第 2 行的缩放因子）；
 * 用 b_i·a_j = 2πδ_ij 可推出 x_i = (K · a_i_raw) / a，其中 a_i_raw = a_i / s。
 * @param {{ coordinate: string, segments: Array<{ from: object, to: object }> }} kpoints - parseKpoints 的 line-mode 结果。
 * @param {{ a1: number[], a2: number[], a3: number[], scale?: number[] }} structure - parsePoscar 的结果。
 * @returns {Array<{ k: number[], label: string }> | null} 换算后的端点（无法换算时返回 null）。
 */
export function kpointsToFractional(kpoints, structure) {
  if (!kpoints || kpoints.mode !== 'line' || !Array.isArray(kpoints.segments)) return null
  const points = []
  const push = (point) => {
    if (!point) return
    points.push({ k: point.k.slice(), label: point.label ?? '' })
  }
  if (kpoints.coordinate !== 'cartesian') {
    for (const segment of kpoints.segments) {
      push(segment.from)
      push(segment.to)
    }
    return points
  }
  const scale = Array.isArray(structure.scale) ? structure.scale : [1, 1, 1]
  if (Math.abs(scale[0] - scale[1]) > 1e-9 || Math.abs(scale[1] - scale[2]) > 1e-9) return null
  const s = scale[0]
  if (!(s > 0)) return null
  const cell = [structure.a1, structure.a2, structure.a3].map((vector) => vector.map((value) => value / s))
  const convert = (point) => {
    const K = point.k
    const k = cell.map((vector) => K[0] * vector[0] + K[1] * vector[1] + K[2] * vector[2])
    return { k, label: point.label }
  }
  for (const segment of kpoints.segments) {
    push(convert(segment.from))
    push(convert(segment.to))
  }
  return points
}

/**
 * 在体积网格上取一个二维截面（对应 VESTA 的 "2D Data Display"）。
 * 坐标系用分数坐标：xy 面即固定 z=at，x/y 在 [0,1) 内均匀取样，周期性回绕。
 * @param {{ dims: number[], values: Float32Array }} volume - 体积网格（x 最快、z 最慢）。
 * @param {{ plane?: "xy"|"yz"|"zx", at?: number, size?: number }} [options] - 截面与分辨率。
 * @returns {{ plane: string, at: number, size: number, pixels: Float32Array, min: number, max: number, mean: number }}
 */
export function sampleSlice(volume, options = {}) {
  const plane = ['xy', 'yz', 'zx'].includes(options.plane) ? options.plane : 'xy'
  const at = Number.isFinite(options.at) ? Math.min(Math.max(options.at, 0), 1 - 1e-9) : 0.5
  const size = Number.isInteger(options.size) && options.size > 1 ? options.size : 128
  const [nx, ny, nz] = volume.dims
  const values = volume.values

  const wrap = (value, count) => {
    const scaled = value * count
    const base = Math.floor(scaled)
    const frac = scaled - base
    return { lo: ((base % count) + count) % count, hi: (((base + 1) % count) + count) % count, frac }
  }
  const sample = (x, y, z) => {
    const fx = wrap(x, nx)
    const fy = wrap(y, ny)
    const fz = wrap(z, nz)
    const value = (i, j, k) => values[(k * ny + j) * nx + i]
    const c00 = value(fx.lo, fy.lo, fz.lo) * (1 - fx.frac) + value(fx.hi, fy.lo, fz.lo) * fx.frac
    const c10 = value(fx.lo, fy.hi, fz.lo) * (1 - fx.frac) + value(fx.hi, fy.hi, fz.lo) * fx.frac
    const c01 = value(fx.lo, fy.lo, fz.hi) * (1 - fx.frac) + value(fx.hi, fy.lo, fz.hi) * fx.frac
    const c11 = value(fx.lo, fy.hi, fz.hi) * (1 - fx.frac) + value(fx.hi, fy.hi, fz.hi) * fx.frac
    const bottom = c00 * (1 - fy.frac) + c10 * fy.frac
    const top = c01 * (1 - fy.frac) + c11 * fy.frac
    return bottom * (1 - fz.frac) + top * fz.frac
  }

  const pixels = new Float32Array(size * size)
  let min = Infinity
  let max = -Infinity
  let sum = 0
  for (let row = 0; row < size; row += 1) {
    const v = row / size
    for (let col = 0; col < size; col += 1) {
      const u = col / size
      const value = plane === 'xy' ? sample(u, v, at)
        : plane === 'yz' ? sample(at, u, v)
          : sample(v, at, u)
      pixels[row * size + col] = value
      if (value < min) min = value
      if (value > max) max = value
      sum += value
    }
  }
  return { plane, at, size, pixels, min, max, mean: sum / pixels.length }
}

/**
 * 体积文件体检：量程、积分、密度峰位置与最近原子的距离（含周期性）。
 * 用于判断「密度峰是否落在原子上」这类问题（例如 CHGCAR 与结构不匹配时）。
 * @param {object} volume - readVolumeFile 的结果（需带 structure）。
 * @returns {object} 诊断结果。
 */
export function volumeDiagnostics(volume) {
  const [nx, ny, nz] = volume.dims
  const values = volume.values
  let min = Infinity
  let max = -Infinity
  let peakIndex = 0
  let sum = 0
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value < min) min = value
    if (value > max) { max = value; peakIndex = index }
    sum += value
  }
  const mean = sum / values.length
  const k = Math.floor(peakIndex / (nx * ny))
  const j = Math.floor((peakIndex % (nx * ny)) / nx)
  const i = peakIndex % nx
  const peakFrac = [i / nx, j / ny, k / nz]

  const structure = volume.structure
  if (!structure) {
    return { dims: volume.dims, min, max, mean, peakFrac, peakValue: max, atoms: [], nearest: null, integral: null }
  }
  const cell = [structure.a1, structure.a2, structure.a3]
  const volumeCell = Math.abs(det3(structure.a1, structure.a2, structure.a3))
  const fracToCart = (frac) => [0, 1, 2].map((axis) =>
    frac[0] * cell[0][axis] + frac[1] * cell[1][axis] + frac[2] * cell[2][axis])
  const peakCart = fracToCart(peakFrac)
  const sampleValue = (frac) => {
    const index = [0, 1, 2].map((axis) => {
      const scaled = Math.round(frac[axis] * [nx, ny, nz][axis])
      return ((scaled % [nx, ny, nz][axis]) + [nx, ny, nz][axis]) % [nx, ny, nz][axis]
    })
    return values[(index[2] * ny + index[1]) * nx + index[0]]
  }
  const atoms = structure.atoms.map((atom) => ({
    symbol: atom.symbol,
    frac: atom.frac.slice(),
    value: sampleValue(atom.frac),
  }))

  let nearest = null
  for (const atom of atoms) {
    for (let da = -1; da <= 1; da += 1) {
      for (let db = -1; db <= 1; db += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const shifted = fracToCart([atom.frac[0] + da, atom.frac[1] + db, atom.frac[2] + dc])
          const distance = Math.hypot(shifted[0] - peakCart[0], shifted[1] - peakCart[1], shifted[2] - peakCart[2])
          if (!nearest || distance < nearest.distance) nearest = { symbol: atom.symbol, distance, frac: atom.frac.slice() }
        }
      }
    }
  }

  return {
    dims: volume.dims,
    min,
    max,
    mean,
    peakFrac,
    peakValue: max,
    atoms,
    nearest,
    integral: mean * volumeCell,
    unit: volume.unit,
  }
}

/**
 * 用 VESTA 自己的命令行接口导出高清图（手册第 17 章：-open / -export_img / -close）。
 * 比 PrintWindow 截图更干净：白底、无界面控件、可按 scale 放大。
 * VESTA 是 GUI 程序，导出后不会自动退出，这里轮询产物出现后再按进程树结束它。
 * @param {object} config - `{ executable }`（或环境变量 VESTA_EXE）。
 * @param {string} inputPath - 要打开的结构/体积文件。
 * @param {string} outPath - 输出图片路径（扩展名决定格式）。
 * @param {{ scale?: number, timeoutMs?: number }} [options] - 放大倍数与超时。
 * @returns {Promise<{ out: string, bytes: number, scale: number, ms: number }>}
 */
// exportVestaImage 复用 runVestaOutput（同一套轮询 + 结束进程逻辑）
export function exportVestaImage(config, inputPath, outPath, options = {}) {
  const scale = Number.isFinite(options.scale) && options.scale >= 1 ? Math.round(options.scale) : 2
  const out = toAbsolute(String(outPath), process.cwd())
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 60000
  return runVestaOutput(
    config,
    ['-open', inputPath, '-export_img', `scale=${scale}`, out, '-close'],
    out,
    { timeoutMs, minBytes: 1024 },
  ).then((result) => ({ ...result, scale }))
}
/**
 * 跑一次 VESTA 命令行并等待它写出目标文件，然后结束进程树。
 * VESTA 是 GUI 程序：命令执行完不会退出，只能靠轮询产物判断完成。
 * @param {object} config - `{ executable }`。
 * @param {string[]} args - 传给 VESTA 的参数（不含可执行文件本身）。
 * @param {string} outPath - 期望产出的文件。
 * @param {{ timeoutMs?: number, minBytes?: number }} [options] - 超时与最小体积。
 * @returns {Promise<{ out: string, bytes: number, ms: number }>}
 */
function runVestaOutput(config, args, outPath, options = {}) {
  const probe = probeExecutable(config)
  if (!probe.exists) throw new Error(`找不到 VESTA 可执行文件：${probe.problem ?? probe.path}`)
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 60000
  const minBytes = Number.isFinite(options.minBytes) ? options.minBytes : 64
  const out = toAbsolute(String(outPath), process.cwd())
  if (existsSync(out)) unlinkSync(out)
  mkdirSync(dirname(out), { recursive: true })
  return new Promise((resolvePromise, reject) => {
    let child
    try {
      child = spawn(probe.path, args, { cwd: dirname(probe.path), windowsHide: false, stdio: 'ignore' })
    } catch (error) {
      reject(new Error(`启动 VESTA 失败：${error.message}`))
      return
    }
    const started = Date.now()
    const stop = () => {
      try {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      } catch {
        try { child.kill() } catch { /* 忽略 */ }
      }
    }
    const timer = setInterval(() => {
      if (existsSync(out) && statSync(out).size >= minBytes) {
        clearInterval(timer)
        stop()
        resolvePromise({ out, bytes: statSync(out).size, ms: Date.now() - started })
        return
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer)
        stop()
        reject(new Error(`VESTA 在 ${Math.round(timeoutMs / 1000)} s 内没有写出文件：${out}`))
      }
    }, 250)
  })
}

/**
 * 用 VESTA 的 `-open ... -save` 做结构格式转换（CIF / VASP / PDB / XYZ…）。
 * @param {object} config - `{ executable }`。
 * @param {string} inputPath - 源结构文件。
 * @param {string} outPath - 目标文件，扩展名决定格式。
 * @param {{ timeoutMs?: number }} [options] - 超时。
 * @returns {Promise<{ out: string, bytes: number, ms: number }>}
 */
export function convertWithVesta(config, inputPath, outPath, options = {}) {
  const out = toAbsolute(String(outPath), process.cwd())
  return runVestaOutput(config, ['-open', inputPath, '-save', out], out, { ...options, minBytes: 32 })
}

/**
 * 解析 VESTA 导出的文本体积数据（*.?ed，例如 *.3ed）。
 * 格式（手册 18.5.1）：标题 / 6 个晶胞参数 / N1+1 N2+1 N3+1 / 数据。
 * 数据是 Fortran 顺序 `(((D(I1,I2,I3), I3=1,N3+1), I2=1,N2+1), I1=1,N1+1)`，即 **z 最快**。
 * 注意：VESTA 把电子密度写成 bohr⁻³；乘 `BOHR3_TO_A3` 换成 Å⁻³。
 * @param {string} text - 文本体积文件内容。
 * @returns {{ title: string, cell: number[], dims: number[], values: Float32Array }}
 */
export function parseVestaVolumeText(text) {
  const lines = text.split(/\r?\n/)
  const title = (lines[0] ?? '').trim()
  const cell = (lines[1] ?? '').trim().split(/\s+/).map(Number).filter((value) => Number.isFinite(value))
  const dims = (lines[2] ?? '').trim().split(/\s+/).map(Number).filter((value) => Number.isFinite(value))
  if (cell.length < 6) throw new Error('VESTA 体积文件：第 2 行不是 6 个晶胞参数')
  if (dims.length < 3) throw new Error('VESTA 体积文件：第 3 行不是 3 个网格维度')
  const [nx, ny, nz] = dims.slice(0, 3).map((value) => Math.round(value))
  const total = nx * ny * nz
  const values = new Float32Array(total)
  let filled = 0
  for (let line = 3; line < lines.length && filled < total; line += 1) {
    for (const token of lines[line].trim().split(/\s+/)) {
      if (!token) continue
      const value = Number(token)
      if (!Number.isFinite(value)) continue
      values[filled] = value
      filled += 1
      if (filled >= total) break
    }
  }
  if (filled < total) throw new Error(`VESTA 体积文件数据不足：需要 ${total} 个点，只读到 ${filled} 个`)
  return { title, cell, dims: [nx, ny, nz], values }
}

/** 1 bohr⁻³ 等于多少 Å⁻³（VESTA 文本体积用 bohr⁻³）。 */
export const BOHR3_TO_A3 = 1 / 0.148184711

/**
 * 解析 VESTA 文本区里的结构摘要（Space Group / a,b,c,α,β,γ / V）。
 * 文本形如：
 *   Si-fcc
 *   Space Group: P 1  (#1-1)
 *   a =  3.88909 Å      α = 60.0000°
 *   ...
 *   V = 41.5937 Å^3
 * @param {string} text - VESTA 文本区内容。
 * @returns {{ comment: string, spaceGroup: string|null, spaceGroupNumber: string|null, a: number, b: number, c: number, alpha: number, beta: number, gamma: number, volume: number } | null}
 */
export function parseVestaStructureText(text) {
  const raw = String(text ?? '')
  const pick = (pattern) => {
    const match = pattern.exec(raw)
    return match ? Number(match[1]) : null
  }

  // 格式一（侧栏/简表）：a = 3.88909 Å  α = 60.0000°
  let a = pick(/a\s*=\s*([\d.]+)\s*Å/)
  let b = pick(/b\s*=\s*([\d.]+)\s*Å/)
  let c = pick(/c\s*=\s*([\d.]+)\s*Å/)
  let alpha = pick(/α\s*=\s*([\d.]+)/)
  let beta = pick(/β\s*=\s*([\d.]+)/)
  let gamma = pick(/γ\s*=\s*([\d.]+)/)
  let volume = pick(/V\s*=\s*([\d.]+)\s*Å/)

  // 格式二（-open 完整报告）：表头后一行是 6 个数
  if ([a, b, c, alpha, beta, gamma].some((value) => value === null)) {
    const tableMatch = /a\s+b\s+c\s+alpha\s+beta\s+gamma\s*\r?\n\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(raw)
    if (tableMatch) {
      a = Number(tableMatch[1])
      b = Number(tableMatch[2])
      c = Number(tableMatch[3])
      alpha = Number(tableMatch[4])
      beta = Number(tableMatch[5])
      gamma = Number(tableMatch[6])
    }
  }
  if (volume === null) {
    volume = pick(/Unit-cell volume\s*=\s*([\d.]+)\s*Å/)
  }
  if ([a, b, c, alpha, beta, gamma].some((value) => value === null)) return null

  // 空间群：兼容 "Space Group: P 1  (#1-1)" 与 "Space group name    P 1" + "Space group number  1"
  let spaceGroup = null
  let spaceGroupNumber = null
  const compact = /Space Group:\s*(.+?)\s*\(#([^)]+)\)/.exec(raw)
  if (compact) {
    spaceGroup = compact[1].trim()
    spaceGroupNumber = compact[2].trim()
  } else {
    const nameMatch = /Space group name\s+([^\r\n]+)/.exec(raw)
    const numberMatch = /Space group number\s+(\S+)/.exec(raw)
    if (nameMatch) spaceGroup = nameMatch[1].trim()
    if (numberMatch) spaceGroupNumber = numberMatch[1].trim()
  }

  const titleMatch = /Title\s+([^\r\n]+)/.exec(raw)
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const comment = titleMatch ? titleMatch[1].trim() : (lines[0] ?? '')

  return {
    comment,
    spaceGroup,
    spaceGroupNumber,
    a, b, c, alpha, beta, gamma,
    volume,
  }
}
/**
 * 由三个晶胞向量算 a,b,c,α,β,γ 与体积（用于和 VESTA 报告的数值对照）。
 * @param {number[][]} cell - 三个晶胞向量。
 * @returns {{ a: number, b: number, c: number, alpha: number, beta: number, gamma: number, volume: number }}
 */
export function cellParameters(cell) {
  const [a1, a2, a3] = cell
  const norm = (vector) => Math.hypot(vector[0], vector[1], vector[2])
  const angle = (u, v) => {
    const cosine = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (norm(u) * norm(v))
    return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
  }
  const cross = [a2[1] * a3[2] - a2[2] * a3[1], a2[2] * a3[0] - a2[0] * a3[2], a2[0] * a3[1] - a2[1] * a3[0]]
  const volume = Math.abs(a1[0] * cross[0] + a1[1] * cross[1] + a1[2] * cross[2])
  return {
    a: norm(a1), b: norm(a2), c: norm(a3),
    alpha: angle(a2, a3), beta: angle(a1, a3), gamma: angle(a1, a2),
    volume,
  }
}

/**
 * 读 VESTA 当前打开文件的结构摘要：找主窗口 → 读文本区 → 解析。
 * @param {number} pid - VESTA 进程号。
 * @returns {Promise<object|null>} 解析结果（找不到返回 null）。
 */
export async function readVestaStructureSummary(pid) {
  const windows = await runUiScript(['-Action', 'windows', '-ProcId', String(pid)])
  const main = (windows.windows ?? []).find((window) => window.visible && String(window.title).includes('VESTA'))
  if (!main) return null
  const areas = await runUiScript(['-Action', 'text', '-Hwnd', String(main.hwnd)])
  for (const control of areas.controls ?? []) {
    const parsed = parseVestaStructureText(control.text)
    if (parsed) return parsed
  }
  return null
}

/**
 * 解析 VESTA 文本区里的键长列表（来自命令行 `-list bond`）。
 * 每条形如：`Bond: l(Si1-Si2) =  2.38157(0) Å`；同一对原子会因周期像重复出现，这里按对去重取最小值。
 * @param {string} text - VESTA 文本区内容。
 * @returns {{ pairs: Array<{ pair: string, length: number }>, count: number }}
 */
export function parseVestaBondList(text) {
  const raw = String(text ?? '')
  const pattern = /Bond:\s*l\(([^)]+)\)\s*=\s*(-?[\d.]+)(?:\((\d+)\))?\s*Å/g
  const byPair = new Map()
  let match
  let count = 0
  while ((match = pattern.exec(raw)) !== null) {
    count += 1
    const pair = match[1].trim()
    const length = Number(match[2])
    if (!Number.isFinite(length)) continue
    const current = byPair.get(pair)
    if (current === undefined || length < current) byPair.set(pair, length)
  }
  return {
    pairs: [...byPair.entries()].map(([pair, length]) => ({ pair, length })).sort((a, b) => a.pair.localeCompare(b.pair)),
    count,
  }
}

/**
 * 我们的最短原子间距（含周期性），用于和 VESTA 报的键长对照。
 * @param {{ a1: number[], a2: number[], a3: number[], atoms: Array<{ frac: number[] }> }} structure - parsePoscar 结果。
 * @returns {number|null} 最短距离（Å），原子数 < 2 时返回 null。
 */
export function shortestAtomDistance(structure) {
  const cell = [structure.a1, structure.a2, structure.a3]
  const cart = (frac) => [0, 1, 2].map((axis) =>
    frac[0] * cell[0][axis] + frac[1] * cell[1][axis] + frac[2] * cell[2][axis])
  let best = null
  for (let i = 0; i < structure.atoms.length; i += 1) {
    for (let j = i + 1; j < structure.atoms.length; j += 1) {
      for (let da = -1; da <= 1; da += 1) {
        for (let db = -1; db <= 1; db += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            const a = cart([
              structure.atoms[j].frac[0] + da,
              structure.atoms[j].frac[1] + db,
              structure.atoms[j].frac[2] + dc,
            ])
            const b = cart(structure.atoms[i].frac)
            const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
            if (best === null || distance < best) best = distance
          }
        }
      }
    }
  }
  return best
}

/**
 * 读 VESTA 当前进程的文本区（取最长的那块，VESTA 把日志与几何参数都写在那里）。
 * @param {number} pid - VESTA 进程号。
 * @returns {Promise<string|null>}
 */
export async function readVestaText(pid) {
  const windows = await runUiScript(['-Action', 'windows', '-ProcId', String(pid)])
  const main = (windows.windows ?? []).find((window) => window.visible && String(window.title).includes('VESTA'))
  if (!main) return null
  const areas = await runUiScript(['-Action', 'text', '-Hwnd', String(main.hwnd)])
  const controls = (areas.controls ?? []).filter((control) => typeof control.text === 'string')
  if (controls.length === 0) return null
  controls.sort((a, b) => b.text.length - a.text.length)
  return controls[0].text
}

/**
 * 解析 VESTA 文本区里的键角列表（来自 `-list angle`）。
 * 每条形如：`phi(Si1-Si2-Si1) = 109.4712(0) deg.`；按三元组去重取最小值。
 * @param {string} text - VESTA 文本区内容。
 * @returns {{ triples: Array<{ triple: string, angle: number }>, count: number }}
 */
export function parseVestaAngleList(text) {
  const raw = String(text ?? '')
  const pattern = /(?:phi|theta)\(([^)]+)\)\s*=\s*(-?[\d.]+)(?:\((\d+)\))?\s*deg/gi
  const byTriple = new Map()
  let match
  let count = 0
  while ((match = pattern.exec(raw)) !== null) {
    count += 1
    const triple = match[1].trim()
    const angle = Number(match[2])
    if (!Number.isFinite(angle)) continue
    const current = byTriple.get(triple)
    if (current === undefined || angle < current) byTriple.set(triple, angle)
  }
  return {
    triples: [...byTriple.entries()].map(([triple, angle]) => ({ triple, angle })).sort((a, b) => a.triple.localeCompare(b.triple)),
    count,
  }
}

/**
 * 用 VESTA 的命令行接口打开结构、跑 `-list <kind>`，读文本区并解析。
 * @param {object} config - `{ executable }`。
 * @param {string} filePath - 结构文件绝对路径。
 * @param {"structure"|"bond"|"angle"|"poly"} kind - 查询类型。
 * @returns {Promise<{ kind: string, text: string, structure?: object, bonds?: object, angles?: object }>}
 */
export async function analyzeWithVesta(config, filePath, kind = 'structure') {
  const probe = probeExecutable(config)
  if (!probe.exists) throw new Error(`找不到 VESTA 可执行文件：${probe.problem ?? probe.path}`)
  const args = kind === 'structure' ? ['-open', filePath] : ['-open', filePath, '-list', kind]
  const child = spawn(probe.path, args, { cwd: dirname(probe.path), stdio: 'ignore' })
  const pid = child.pid
  const stop = () => {
    try {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch {
      try { process.kill(pid) } catch { /* 忽略 */ }
    }
  }
  const deadline = Date.now() + 25000
  let text = null
  let structure = null
  let bonds = null
  let angles = null
  let poly = null
  while (Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 700))
    try {
      text = await readVestaText(pid)
    } catch {
      text = null
      continue
    }
    if (!text) continue
    if (kind === 'structure') {
      structure = parseVestaStructureText(text)
      if (structure) break
    } else if (kind === 'bond') {
      bonds = parseVestaBondList(text)
      if (bonds.pairs.length > 0) break
    } else if (kind === 'angle') {
      angles = parseVestaAngleList(text)
      if (angles.triples.length > 0) break
    } else if (kind === 'poly') {
      if (text.includes('POLYHEDRON:')) {
        poly = parseVestaPolyList(text)
        if (poly.count > 0) break
      }
    } else if (text.length > 200) {
      break
    }
  }
  stop()
  if (!text) throw new Error('没能读到 VESTA 文本区（窗口未出现或被单实例接管）')
  const result = { kind, text }
  if (structure) result.structure = structure
  if (bonds) result.bonds = bonds
  if (angles) result.angles = angles
  if (poly) result.poly = poly
  return result
}

/**
 * 按与查看器相同的判据列键：距离 ≤ min(maxCutoff, scale×(r_i+r_j))，周期性取最小像。
 * 半径取自 viewer/scene.js 的元素表（未收录元素按 0.85 Å）。
 * @param {{ a1: number[], a2: number[], a3: number[], atoms: Array<{ symbol: string, frac: number[] }> }} structure - parsePoscar 结果。
 * @param {{ scale?: number, maxCutoff?: number }} [options] - 判据参数（默认 1.25 / 2.6 Å，与查看器一致）。
 * @returns {Array<{ i: number, j: number, symbols: string, length: number }>} 唯一的原子对（i<j）。
 */
export function bondList(structure, options = {}) {
  const scale = Number.isFinite(options.scale) ? options.scale : 1.25
  const maxCutoff = Number.isFinite(options.maxCutoff) ? options.maxCutoff : 2.6
  const cell = [structure.a1, structure.a2, structure.a3]
  const cart = (frac) => [0, 1, 2].map((axis) =>
    frac[0] * cell[0][axis] + frac[1] * cell[1][axis] + frac[2] * cell[2][axis])
  const radiusOf = (symbol) => (VIEWER_ELEMENTS[symbol]?.radius ?? 0.85)
  const bonds = []
  for (let i = 0; i < structure.atoms.length; i += 1) {
    for (let j = i + 1; j < structure.atoms.length; j += 1) {
      const cutoff = Math.min(maxCutoff, scale * (radiusOf(structure.atoms[i].symbol) + radiusOf(structure.atoms[j].symbol)))
      let best = Infinity
      for (let da = -1; da <= 1; da += 1) {
        for (let db = -1; db <= 1; db += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            const a = cart([
              structure.atoms[j].frac[0] + da,
              structure.atoms[j].frac[1] + db,
              structure.atoms[j].frac[2] + dc,
            ])
            const b = cart(structure.atoms[i].frac)
            const distance = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
            if (distance < best) best = distance
          }
        }
      }
      if (best <= cutoff) {
        bonds.push({
          i: i + 1,
          j: j + 1,
          symbols: `${structure.atoms[i].symbol}${i + 1}-${structure.atoms[j].symbol}${j + 1}`,
          length: best,
        })
      }
    }
  }
  return bonds
}

/**
 * 沿一条线段对体积数据做等步长采样（对应 VESTA 手册 14.13 的 Line Profile）。
 * 端点用分数坐标，距离用笛卡尔距离（Å）；采样用与截面相同的三线性插值 + 周期回绕。
 * @param {{ dims: number[], values: Float32Array, structure?: { a1: number[], a2: number[], a3: number[] } }} volume - 体积网格。
 * @param {number[]} start - 起点分数坐标。
 * @param {number[]} end - 终点分数坐标。
 * @param {{ points?: number }} [options] - 采样点数（默认 50，与 VESTA 默认一致）。
 * @returns {{ distances: number[], values: number[], total: number, points: number }}
 */
export function lineProfile(volume, start, end, options = {}) {
  const points = Number.isInteger(options.points) && options.points > 1 ? options.points : 50
  const [nx, ny, nz] = volume.dims
  const values = volume.values
  const cell = volume.structure
    ? [volume.structure.a1, volume.structure.a2, volume.structure.a3]
    : [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const cart = (frac) => [0, 1, 2].map((axis) =>
    frac[0] * cell[0][axis] + frac[1] * cell[1][axis] + frac[2] * cell[2][axis])

  const wrap = (value, count) => {
    const scaled = value * count
    const base = Math.floor(scaled)
    return { lo: ((base % count) + count) % count, hi: (((base + 1) % count) + count) % count, frac: scaled - base }
  }
  const sample = (x, y, z) => {
    const fx = wrap(x, nx)
    const fy = wrap(y, ny)
    const fz = wrap(z, nz)
    const value = (i, j, k) => values[(k * ny + j) * nx + i]
    const c00 = value(fx.lo, fy.lo, fz.lo) * (1 - fx.frac) + value(fx.hi, fy.lo, fz.lo) * fx.frac
    const c10 = value(fx.lo, fy.hi, fz.lo) * (1 - fx.frac) + value(fx.hi, fy.hi, fz.lo) * fx.frac
    const c01 = value(fx.lo, fy.lo, fz.hi) * (1 - fx.frac) + value(fx.hi, fy.lo, fz.hi) * fx.frac
    const c11 = value(fx.lo, fy.hi, fz.hi) * (1 - fx.frac) + value(fx.hi, fy.hi, fz.hi) * fx.frac
    const bottom = c00 * (1 - fy.frac) + c10 * fy.frac
    const top = c01 * (1 - fy.frac) + c11 * fy.frac
    return bottom * (1 - fz.frac) + top * fz.frac
  }

  const startCart = cart(start)
  const endCart = cart(end)
  const total = Math.hypot(endCart[0] - startCart[0], endCart[1] - startCart[1], endCart[2] - startCart[2])
  const distances = []
  const samples = []
  for (let i = 0; i < points; i += 1) {
    const t = i / (points - 1)
    const frac = [
      start[0] + (end[0] - start[0]) * t,
      start[1] + (end[1] - start[1]) * t,
      start[2] + (end[2] - start[2]) * t,
    ]
    distances.push(total * t)
    samples.push(sample(frac[0], frac[1], frac[2]))
  }
  return { distances, values: samples, total, points }
}

/**
 * 按 VESTA 手册 14.13 的格式生成 Line Profile 文本。
 * @param {{ title: string, start: number[], end: number[], distances: number[], values: number[] }} profile - lineProfile 结果 + 标题与端点。
 * @returns {string} 文本内容。
 */
export function formatLineProfileText(profile) {
  // VESTA 写成 0.000000E+000：大写 E、带符号、三位指数
  const fmt = (value) => {
    const match = /^(-?[\d.]+)e([+-])(\d+)$/.exec(value.toExponential(6))
    return match ? `${match[1]}E${match[2]}${match[3].padStart(3, '0')}` : value.toExponential(6).toUpperCase()
  }
  const lines = [profile.title]
  lines.push(`Point 1:  ${profile.start.map((value) => value.toFixed(5)).join('  ')}`)
  lines.push(`Point 2:  ${profile.end.map((value) => value.toFixed(5)).join('  ')}`)
  lines.push(String(profile.distances.length))
  profile.distances.forEach((distance, index) => {
    lines.push(` ${fmt(distance)}  ${fmt(profile.values[index])}`)
  })
  return `${lines.join('\n')}\n`
}

/**
 * 峰搜索 + Voronoi 式电荷归属（对应 VESTA 手册 14.14 的 Peak Search）。
 * 做法：
 *   1. 找网格上的局部极大（26 邻域），可选阈值；
 *   2. 每个体素按「分数坐标环绕差 → 笛卡尔距离」归给最近的峰；
 *   3. 按归属累加 ρ·dV 得到每个峰的积分电子数与体素数（Voronoi 体积的离散近似）。
 * 注意：这里用最近峰近似 Voronoi 胞，非正交晶胞下与真 Voronoi 略有差别。
 * @param {{ dims: number[], values: Float32Array, structure?: { a1: number[], a2: number[], a3: number[] } }} volume - 体积网格。
 * @param {{ threshold?: number, maxPeaks?: number }} [options] - 峰阈值与上限。
 * @returns {{ total: number, peaks: Array<{ frac: number[], value: number, electrons: number, voxels: number }>, voxelVolume: number }}
 */
export function peakSearch(volume, options = {}) {
  const [nx, ny, nz] = volume.dims
  const values = volume.values
  const cell = volume.structure
    ? [volume.structure.a1, volume.structure.a2, volume.structure.a3]
    : [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  const a1 = cell[0], a2 = cell[1], a3 = cell[2]
  const det = a1[0] * (a2[1] * a3[2] - a2[2] * a3[1])
    - a1[1] * (a2[0] * a3[2] - a2[2] * a3[0])
    + a1[2] * (a2[0] * a3[1] - a2[1] * a3[0])
  const cellVolume = Math.abs(det)
  const voxelVolume = cellVolume / (nx * ny * nz)

  // 环绕索引表：避免内层反复取模
  const ix = new Int32Array(nx + 2)
  const iy = new Int32Array(ny + 2)
  const iz = new Int32Array(nz + 2)
  for (let i = 0; i < nx + 2; i += 1) ix[i] = ((i - 1) % nx + nx) % nx
  for (let j = 0; j < ny + 2; j += 1) iy[j] = ((j - 1) % ny + ny) % ny
  for (let k = 0; k < nz + 2; k += 1) iz[k] = ((k - 1) % nz + nz) % nz
  const strideY = nx
  const strideZ = nx * ny
  const valueAt = (i, j, k) => values[iz[k + 1] * strideZ + iy[j + 1] * strideY + ix[i + 1]]

  let globalMax = -Infinity
  let total = 0
  for (let n = 0; n < values.length; n += 1) {
    if (values[n] > globalMax) globalMax = values[n]
    total += values[n] * voxelVolume
  }
  const threshold = Number.isFinite(options.threshold) ? options.threshold : null
  const floor = threshold === null ? globalMax * 0.2 : threshold

  const peakFrac = []
  const peakValue = []
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const value = valueAt(i, j, k)
        if (value < floor) continue
        let isMax = true
        for (let dk = -1; dk <= 1 && isMax; dk += 1) {
          for (let dj = -1; dj <= 1 && isMax; dj += 1) {
            for (let di = -1; di <= 1; di += 1) {
              if (di === 0 && dj === 0 && dk === 0) continue
              if (valueAt(i + di, j + dj, k + dk) > value) {
                isMax = false
                break
              }
            }
          }
        }
        if (isMax) {
          peakFrac.push([i / nx, j / ny, k / nz])
          peakValue.push(value)
        }
      }
    }
  }

  // 按值排序并按 maxPeaks 截断
  const order = peakValue.map((value, index) => index).sort((a, b) => peakValue[b] - peakValue[a])
  const limit = Number.isInteger(options.maxPeaks) && options.maxPeaks > 0
    ? Math.min(options.maxPeaks, order.length)
    : order.length
  const chosen = order.slice(0, limit)
  const count = chosen.length
  const pfx = new Float64Array(count)
  const pfy = new Float64Array(count)
  const pfz = new Float64Array(count)
  const pv = new Float64Array(count)
  for (let index = 0; index < count; index += 1) {
    const source = chosen[index]
    pfx[index] = peakFrac[source][0]
    pfy[index] = peakFrac[source][1]
    pfz[index] = peakFrac[source][2]
    pv[index] = peakValue[source]
  }

  const charges = new Float64Array(count)
  const voxels = new Float64Array(count)
  const tied = new Int32Array(count)
  const tolerance = 1e-9

  for (let k = 0; k < nz; k += 1) {
    const kk = k / nz
    for (let j = 0; j < ny; j += 1) {
      const jj = j / ny
      for (let i = 0; i < nx; i += 1) {
        if (count === 0) continue
        const value = values[(k * ny + j) * nx + i]
        const ii = i / nx
        let nearest = Infinity
        for (let p = 0; p < count; p += 1) {
          let dx = ii - pfx[p]
          let dy = jj - pfy[p]
          let dz = kk - pfz[p]
          dx -= Math.round(dx)
          dy -= Math.round(dy)
          dz -= Math.round(dz)
          const sx = dx * a1[0] + dy * a2[0] + dz * a3[0]
          const sy = dx * a1[1] + dy * a2[1] + dz * a3[1]
          const sz = dx * a1[2] + dy * a2[2] + dz * a3[2]
          const distance = Math.sqrt(sx * sx + sy * sy + sz * sz)
          if (distance < nearest) nearest = distance
        }
        let tieCount = 0
        for (let p = 0; p < count; p += 1) {
          let dx = ii - pfx[p]
          let dy = jj - pfy[p]
          let dz = kk - pfz[p]
          dx -= Math.round(dx)
          dy -= Math.round(dy)
          dz -= Math.round(dz)
          const sx = dx * a1[0] + dy * a2[0] + dz * a3[0]
          const sy = dx * a1[1] + dy * a2[1] + dz * a3[1]
          const sz = dx * a1[2] + dy * a2[2] + dz * a3[2]
          const distance = Math.sqrt(sx * sx + sy * sy + sz * sz)
          if (distance <= nearest + tolerance) {
            tied[tieCount] = p
            tieCount += 1
          }
        }
        const share = (value * voxelVolume) / tieCount
        // 注意：voxels 记的是体素「个数」，不是体积
        const voxelShare = 1 / tieCount
        for (let t = 0; t < tieCount; t += 1) {
          const p = tied[t]
          charges[p] += share
          voxels[p] += voxelShare
        }
      }
    }
  }

  const peaks = []
  for (let index = 0; index < count; index += 1) {
    peaks.push({
      frac: [pfx[index], pfy[index], pfz[index]],
      value: pv[index],
      electrons: charges[index],
      voxels: voxels[index],
    })
  }
  return { total, voxelVolume, peaks }
}

export function formatPeakSearchText(result, options = {}) {
  const voxelVolume = Number.isFinite(options.voxelVolume) ? options.voxelVolume : null
  const fmt = (value) => {
    const match = /^(-?[\d.]+)e([+-])(\d+)$/.exec(value.toExponential(5))
    return match ? `${match[1]}E${match[2]}${match[3].padStart(3, '0')}` : value.toExponential(5).toUpperCase()
  }
  const lines = []
  if (options.title) lines.push(options.title)
  lines.push(`Integrated value of volumetric data over the unit cell: ${result.total.toFixed(6)}, 0.000000`)
  lines.push('')
  lines.push(`Number of peaks in the volumetric data = ${result.peaks.length}`)
  lines.push('            x         y         z     Peak value     Integrated         Volume')
  result.peaks.forEach((peak, index) => {
    const volume = voxelVolume === null ? null : peak.voxels * voxelVolume
    lines.push(
      `${String(index + 1).padStart(4)}`
      + `${peak.frac[0].toFixed(5).padStart(10)}`
      + `${peak.frac[1].toFixed(5).padStart(10)}`
      + `${peak.frac[2].toFixed(5).padStart(10)}`
      + `${fmt(peak.value).padStart(15)}`
      + `${fmt(peak.electrons).padStart(15)}`
      + `${(volume === null ? '—' : fmt(volume)).padStart(15)}`,
    )
  })
  return `${lines.join('\n')}\n`
}

/** 玻尔半径（Å），用于把 Å⁻³ 换算成 a₀⁻³。 */
export const BOHR_RADIUS_A = 0.529177210903

/**
 * 3×3 求逆（行向量）。用于把分数坐标导数换成笛卡尔量。
 * @param {number[][]} matrix - 3×3。
 * @returns {number[][]} 逆矩阵。
 */
function invertMatrix3(matrix) {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (!Number.isFinite(det) || Math.abs(det) < 1e-14) throw new Error('晶胞矩阵不可逆')
  const k = 1 / det
  return [
    [(e * i - f * h) * k, (c * h - b * i) * k, (b * f - c * e) * k],
    [(f * g - d * i) * k, (a * i - c * g) * k, (c * d - a * f) * k],
    [(d * h - e * g) * k, (b * g - a * h) * k, (a * e - b * d) * k],
  ]
}

/**
 * 由电子密度算 ∇²ρ、动能密度 g、势能密度 ν、能量密度 h_e（手册 14.15）。
 * 公式（原子单位，ℏ²/m = 1，λ = 1/72，k = 1/6）：
 *   g = (3/10)(3π²)^{2/3} ρ^{5/3} + λ|∇ρ|²/ρ + k·∇²ρ/2
 *   ν = (1/4)∇²ρ − 2g
 *   h_e = g + ν
 * 分数坐标下用度量张量：∇²ρ = Σ_ij G^{ij} ∂²ρ/∂f_i∂f_j，G_ij = a_i·a_j。
 * @param {{ dims: number[], values: Float32Array, structure: { a1: number[], a2: number[], a3: number[] } }} volume - 体积网格（e/Å³）。
 * @returns {{ laplacian: Float32Array, kinetic: Float32Array, potential: Float32Array, energy: Float32Array, unit: string }}
 */
export function densityDerived(volume) {
  const [nx, ny, nz] = volume.dims
  const values = volume.values
  const cell = [volume.structure.a1, volume.structure.a2, volume.structure.a3]
  const metric = [0, 1, 2].map((i) => [0, 1, 2].map((j) =>
    cell[i][0] * cell[j][0] + cell[i][1] * cell[j][1] + cell[i][2] * cell[j][2]))
  const invMetric = invertMatrix3(metric)
  const counts = [nx, ny, nz]
  const at = (i, j, k) => values[
    ((((k % nz) + nz) % nz) * ny + (((j % ny) + ny) % ny)) * nx + (((i % nx) + nx) % nx)]

  // ρ 换算到 a₀⁻³
  const toAU = BOHR_RADIUS_A ** 3
  const total = nx * ny * nz
  const laplacian = new Float32Array(total)
  const kinetic = new Float32Array(total)
  const potential = new Float32Array(total)
  const energy = new Float32Array(total)
  const TF = (3 * Math.PI * Math.PI) ** (2 / 3)

  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const n = (k * ny + j) * nx + i
        const rho = Math.max(values[n], 0) * toAU
        if (rho <= 0) {
          laplacian[n] = 0
          kinetic[n] = 0
          potential[n] = 0
          energy[n] = 0
          continue
        }
        // 一阶、二阶差分（分数坐标）
        const first = [0, 1, 2].map((axis) => {
          const step = 1 / counts[axis]
          const forward = axis === 0 ? at(i + 1, j, k) : axis === 1 ? at(i, j + 1, k) : at(i, j, k + 1)
          const backward = axis === 0 ? at(i - 1, j, k) : axis === 1 ? at(i, j - 1, k) : at(i, j, k - 1)
          return ((forward - backward) * toAU) / (2 * step)
        })
        const second = [0, 1, 2].map((axis) => {
          const step = 1 / counts[axis]
          const center = at(i, j, k)
          const forward = axis === 0 ? at(i + 1, j, k) : axis === 1 ? at(i, j + 1, k) : at(i, j, k + 1)
          const backward = axis === 0 ? at(i - 1, j, k) : axis === 1 ? at(i, j - 1, k) : at(i, j, k - 1)
          return ((forward - 2 * center + backward) * toAU) / (step * step)
        })
        // 混合项：∂²ρ/∂f_i∂f_j（i≠j）用四角差分
        const mixed = (axisA, axisB) => {
          const stepA = 1 / counts[axisA]
          const stepB = 1 / counts[axisB]
          const sample = (signA, signB) => {
            const di = axisA === 0 ? signA : axisB === 0 ? signB : 0
            const dj = axisA === 1 ? signA : axisB === 1 ? signB : 0
            const dk = axisA === 2 ? signA : axisB === 2 ? signB : 0
            return at(i + di, j + dj, k + dk)
          }
          return ((sample(1, 1) - sample(1, -1) - sample(-1, 1) + sample(-1, -1)) * toAU) / (4 * stepA * stepB)
        }
        let lap = 0
        for (let a = 0; a < 3; a += 1) {
          for (let b = 0; b < 3; b += 1) {
            const value = a === b ? second[a] : mixed(a, b)
            lap += invMetric[a][b] * value
          }
        }
        const gradient = [0, 1, 2].map((axis) =>
          invMetric[axis][0] * first[0] + invMetric[axis][1] * first[1] + invMetric[axis][2] * first[2])
        const gradSquared = gradient[0] ** 2 + gradient[1] ** 2 + gradient[2] ** 2

        const g = (3 / 10) * TF * Math.pow(rho, 5 / 3)
          + (1 / 72) * gradSquared / rho
          + (1 / 12) * lap
        laplacian[n] = lap
        kinetic[n] = g
        potential[n] = (1 / 4) * lap - 2 * g
        energy[n] = g + potential[n]
      }
    }
  }
  return { laplacian, kinetic, potential, energy, unit: 'E_h·a₀⁻³' }
}

/**
 * 把体积写成 VESTA 可读的文本格式（手册 18.3 的「general volumetric」：N+1 网格、z 最快）。
 * @param {{ dims: number[], values: Float32Array, structure: { a1: number[], a2: number[], a3: number[] } }} volume - 体积网格。
 * @param {{ title?: string }} [options] - 标题。
 * @returns {string} 文本内容。
 */
export function formatVolumeText(volume, options = {}) {
  const [nx, ny, nz] = volume.dims
  const cell = volume.structure
    ? cellParameters([volume.structure.a1, volume.structure.a2, volume.structure.a3])
    : { a: 1, b: 1, c: 1, alpha: 90, beta: 90, gamma: 90 }
  const lines = []
  lines.push((options.title ?? 'volumetric data').slice(0, 80))
  lines.push([cell.a, cell.b, cell.c, cell.alpha, cell.beta, cell.gamma]
    .map((value) => value.toFixed(6)).join(' '))
  lines.push(`${nx + 1} ${ny + 1} ${nz + 1}`)
  // VESTA 的 general grid：z 最快，并在 N 处重复 0 的周期像
  for (let i = 0; i <= nx; i += 1) {
    for (let j = 0; j <= ny; j += 1) {
      const row = []
      for (let k = 0; k <= nz; k += 1) {
        const ii = i % nx
        const jj = j % ny
        const kk = k % nz
        row.push(volume.values[(kk * ny + jj) * nx + ii].toExponential(6))
      }
      lines.push(row.join(' '))
    }
  }
  return `${lines.join('\n')}\n`
}

/** 生成二维截面查看器 HTML（scripts/make-slice.mjs）。 */
export function generateSliceViewer(volumePath, options = {}) {
  const args = [volumePath, '--plane', options.plane === 'yz' || options.plane === 'zx' ? options.plane : 'xy']
  if (Number.isFinite(options.at)) args.push('--at', String(options.at))
  if (options.out) args.push('--out', toAbsolute(String(options.out), process.cwd()))
  return runNodeScript('make-slice.mjs', args, '截面图')
}

/** 一维线剖面（scripts/vesta-lineprofile.mjs）。 */
export function generateLineProfile(volumePath, options = {}) {
  const args = [volumePath]
  if (options.from) args.push('--from', String(options.from))
  if (options.to) args.push('--to', String(options.to))
  if (Number.isFinite(options.points)) args.push('--points', String(options.points))
  if (options.out) args.push('--out', toAbsolute(String(options.out), process.cwd()))
  return runNodeScript('vesta-lineprofile.mjs', args, '线剖面')
}

/** 峰搜索（scripts/vesta-peaks.mjs）。 */
export function generatePeakSearch(volumePath, options = {}) {
  const args = [volumePath]
  if (Number.isInteger(options.maxPeaks)) args.push('--max', String(options.maxPeaks))
  if (Number.isFinite(options.threshold)) args.push('--threshold', String(options.threshold))
  if (options.out) args.push('--out', toAbsolute(String(options.out), process.cwd()))
  return runNodeScript('vesta-peaks.mjs', args, '峰搜索')
}

/** 派生量（scripts/vesta-density-derived.mjs）。 */
export function generateDensityDerived(volumePath, options = {}) {
  const args = [volumePath]
  if (options.outHe) args.push('--out-he', toAbsolute(String(options.outHe), process.cwd()))
  if (options.outLap) args.push('--out-lap', toAbsolute(String(options.outLap), process.cwd()))
  return runNodeScript('vesta-density-derived.mjs', args, '密度派生量')
}

/**
 * 解析 VESTA 文本区里的配位多面体摘要（来自 `-list poly`）。
 * 每块以 `POLYHEDRON:` 开头，末尾给平均键长、多面体体积、畸变指数、二次伸长、键角方差、有效配位数。
 * @param {string} text - VESTA 文本区内容。
 * @returns {{ polyhedra: Array<object>, count: number }}
 */
export function parseVestaPolyList(text) {
  const raw = String(text ?? '')
  const blocks = raw.split(/POLYHEDRON:/).slice(1)
  const number = (pattern) => {
    const match = pattern.exec(raw)
    return match ? Number(match[1]) : null
  }
  void number
  const pick = (block, pattern) => {
    const match = pattern.exec(block)
    return match ? Number(match[1]) : null
  }
  const polyhedra = blocks.map((block) => {
    // 中心原子：块内第一条原子行
    const centerMatch = /^\s*(\d+)\s+(\S+)\s+(\S+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/m.exec(block)
    const bonds = [...block.matchAll(/l\(([^)]+)\)\s*=\s*([\d.]+)/g)].map((match) => ({
      pair: match[1],
      length: Number(match[2]),
    }))
    return {
      center: centerMatch ? { label: centerMatch[2], element: centerMatch[3], index: Number(centerMatch[1]) } : null,
      bonds,
      averageBond: pick(block, /Average bond length\s*=\s*([\d.]+)/),
      volume: pick(block, /Polyhedral volume\s*=\s*([\d.]+)/),
      distortionIndex: pick(block, /Distortion index \(bond length\)\s*=\s*([\d.]+)/),
      quadraticElongation: pick(block, /Quadratic elongation\s*=\s*([\d.]+)/),
      bondAngleVariance: pick(block, /Bond angle variance\s*=\s*([\d.]+)/),
      effectiveCoordination: pick(block, /Effective coordination number\s*=\s*([\d.]+)/),
    }
  })
  return { polyhedra, count: polyhedra.length }
}

/**
 * 解析 IBZKPT（VASP 写出的不可约 k 点及其对称多重度）。
 * 格式：注释行 / IBZ 点数 / "Reciprocal lattice" / 每行 kx ky kz 权重。
 * 权重之和等于完整网格的 k 点总数，因此可以算出对称性约化倍数。
 * @param {string} text - IBZKPT 文本。
 * @returns {{ comment: string, count: number, weights: number[], totalWeight: number, kpoints: Array<{ k: number[], weight: number }> }}
 */
export function parseIbzkpt(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  const comment = (lines[0] ?? '').trim()
  const count = Number((lines[1] ?? '').trim().split(/\s+/)[0])
  if (!Number.isInteger(count) || count <= 0) throw new Error('IBZKPT：第 2 行不是有效的 k 点个数')
  const kpoints = []
  for (let i = 3; i < lines.length && kpoints.length < count; i += 1) {
    const parts = (lines[i] ?? '').trim().split(/\s+/).map(Number)
    if (parts.length < 4 || parts.slice(0, 4).some((value) => !Number.isFinite(value))) continue
    kpoints.push({ k: parts.slice(0, 3), weight: parts[3] })
  }
  if (kpoints.length < count) throw new Error(`IBZKPT 数据行不足：期望 ${count} 个 k 点，只读到 ${kpoints.length} 个`)
  const weights = kpoints.map((point) => point.weight)
  const totalWeight = weights.reduce((sum, value) => sum + value, 0)
  return { comment, count, weights, totalWeight, kpoints }
}

/** 读 IBZKPT 文件。 */
export function readIbzkptFile(path) {
  return parseIbzkpt(readFileSync(path, 'utf8'))
}

/**
 * 由总态密度估计带隙：以费米能级为界，找两侧 DOS 超过阈值的最低/最高能量。
 * 与 EIGENVAL 的带隙互相独立（不同文件、不同算法），可用来交叉核对。
 * @param {ReturnType<typeof parseDoscar>} dos - parseDoscar 结果。
 * @param {{ threshold?: number }} [options] - DOS 阈值（states/eV），默认取峰值的 0.5%（2% 对 2D 体系偏高，会漏掉带边态）。
 * @returns {{ vbm: number|null, cbm: number|null, gap: number|null, threshold: number }}
 */
export function dosGap(dos, options = {}) {
  const total = dos.energies.map((energy, index) => dos.up[index] + dos.down[index])
  const peak = Math.max(...total, 0)
  const threshold = Number.isFinite(options.threshold) ? options.threshold : Math.max(peak * 0.005, 1e-6)
  let vbm = null
  let cbm = null
  for (let i = 0; i < dos.energies.length; i += 1) {
    const energy = dos.energies[i]
    if (total[i] <= threshold) continue
    if (energy <= dos.efermi) {
      if (vbm === null || energy > vbm) vbm = energy
    } else if (cbm === null || energy < cbm) {
      cbm = energy
    }
  }
  return {
    vbm,
    cbm,
    gap: vbm === null || cbm === null ? null : cbm - vbm,
    threshold,
  }
}

/**
 * 从 POTCAR 读每个物种的价电子数 ZVAL（与 potcarElements 的顺序一致）。
 * 用于与 OUTCAR 的 NELECT 交叉核对：NELECT 应等于 Σ ZVAL × 该物种原子数。
 * @param {string} text - POTCAR 文本。
 * @returns {{ values: number[], total: number }} 每个物种的 ZVAL 与它们的和（未乘原子数）。
 */
export function potcarZval(text) {
  const values = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = /ZVAL\s*=\s*([\d.]+)/.exec(line)
    if (match) {
      const value = Number(match[1])
      if (Number.isFinite(value)) values.push(value)
    }
  }
  return { values, total: values.reduce((sum, value) => sum + value, 0) }
}

/**
 * 把体检结果汇总成一句话判语：体系类型 + 结果可信度。
 * 分类阈值是**启发式**（带隙 ≤0.05 eV 视为金属性；<2 eV 半导体；否则绝缘体），
 * 只用于快速判断「这份结果大体是什么、能不能直接用」，不作为物理结论。
 * @param {object} report - inspectTask 的返回值。
 * @returns {{ electronic: string, geometry: string, spin: string, verdict: string, failed: string[], critical: string[] }}
 */
export function summarizeTask(report) {
  const gap = report.eigenval?.gap ?? null
  let electronic = '未知（缺 EIGENVAL）'
  if (gap !== null && Number.isFinite(gap)) {
    if (gap <= 0.05) electronic = `金属性（带隙 ${gap.toFixed(3)} eV）`
    else if (gap < 2) electronic = `半导体（带隙 ${gap.toFixed(3)} eV）`
    else electronic = `绝缘体量级（带隙 ${gap.toFixed(3)} eV）`
  }
  const checks = report.checks ?? []
  const geometry = checks.some((check) => check.name === '真空层') ? '板层（含真空层）' : '体相/分子'
  const spin = report.doscar?.spinPolarized || report.outcar?.ispin === 2 ? '自旋极化' : '非自旋'
  const failed = checks.filter((check) => !check.ok).map((check) => check.name)
  const criticalPattern = /收尾|SCF 收敛|能量|NELECT|E-fermi|NBANDS|ZVAL/
  const critical = failed.filter((name) => criticalPattern.test(name))
  let verdict = '结果自洽，可直接使用'
  if (critical.length > 0) verdict = `存在关键不一致（${critical.join('、')}），建议先排查再使用`
  else if (failed.length > 0) verdict = `结果自洽；另有 ${failed.length} 项提示可复核（${failed.join('、')}）`
  return { electronic, geometry, spin, verdict, failed, critical }
}

/**
 * 把体检里的失败/提示项翻译成可执行建议（改哪个参数、改成多少）。
 * 只在证据明确时给建议；没有发现问题时返回空数组。
 * @param {object} report - inspectTask 的返回值。
 * @returns {string[]} 建议列表。
 */
export function suggestActions(report) {
  const actions = []
  const checks = report.checks ?? []
  const failed = checks.filter((check) => !check.ok)
  const names = failed.map((check) => check.name)

  if (names.includes('ENCUT vs ENMAX')) {
    const enmax = report.potcar?.enmax
    if (Number.isFinite(enmax)) actions.push(`把 ENCUT 提到至少 ${Math.ceil(enmax * 1.3)} eV（当前 1.3×ENMAX 规则）后重跑`)
  }
  if (names.includes('真空层')) {
    actions.push('板层真空不足 10 Å：把 c 轴加长（可保持原子层厚不变）后重跑')
  }
  if (names.includes('NBANDS 下限')) {
    const nelect = report.outcar?.nelect
    const natoms = report.eigenval?.natoms
    if (Number.isFinite(nelect) && Number.isFinite(natoms)) {
      actions.push(`把 NBANDS 提到至少 ${Math.ceil(nelect / 2 + natoms)} 后重跑，避免空带不足`)
    }
  }
  if (names.includes('POTCAR ZVAL ↔ NELECT')) {
    actions.push('检查 POTCAR 的元素顺序是否与 POSCAR 的物种行一致（ZVAL 之和与 NELECT 不符）')
  }
  if (names.includes('DOSCAR 被缩放（非原始输出）')) {
    actions.push('这份 DOSCAR 的 DOS 值被缩放/归一化过：从原始计算重新取 DOSCAR，或按 NELECT/∫DOS 反缩放后再做 DOS 分析')
  }
  if (names.includes('带隙一致性（DOS ↔ EIGENVAL）')) {
    actions.push('DOS 与 EIGENVAL 的带隙不一致：确认两份文件来自同一次计算，或检查 NEDOS 是否过小')
  }
  if (names.includes('k 点约化')) {
    actions.push('IBZKPT 与 OUTCAR 的 k 点数不一致：确认目录里没有混入别的任务的输出')
  }
  if (names.includes('计算收尾') || names.includes('SCF 收敛')) {
    actions.push('任务可能未正常结束或未收敛：检查作业是否被中断，必要时加大 NELM 重跑')
  }
  if (names.includes('告警')) {
    actions.push('OUTCAR 里有常见告警（ZBRENT/EDDDAV/TOO FEW BANDS 等）：按告警类型分别排查')
  }

  const gap = report.eigenval?.gap
  const total = report.kpoints?.total
  const atoms = report.eigenval?.natoms
  if (Number.isFinite(gap) && Number.isFinite(total) && Number.isFinite(atoms) && atoms > 0) {
    const perAtom = total / atoms
    if (perAtom < 20 && /半导体|绝缘体/.test(String(gap >= 2 ? '绝缘体' : gap > 0.05 ? '半导体' : '金属性'))) {
      actions.push(`k 点密度偏低（${total} 点 / ${atoms} 原子）：建议加密网格后复核带隙与能量`)
    }
  }
  return actions
}

/**
 * 解析 VESTA `-calcf` 写出的结构因子文件（*.txt）。
 * 表头为 `h k l d(Å) F(real) F(imag) |F| 2θ I M`，之后每行一条反射。
 * 注意文件是本地编码（含 Å、θ 等字符），这里只依赖数字列，不依赖表头文字。
 * @param {string} text - 文件内容。
 * @returns {{ reflections: Array<{ h: number, k: number, l: number, d: number, real: number, imag: number, abs: number, twoTheta: number, intensity: number, multiplicity: number }>, count: number }}
 */
export function parseVestaStructureFactors(text) {
  const reflections = []
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/)
    if (tokens.length < 8) continue
    const numbers = tokens.map(Number)
    if (numbers.slice(0, 3).some((value) => !Number.isInteger(value))) continue
    if (numbers.slice(3, 8).some((value) => !Number.isFinite(value))) continue
    reflections.push({
      h: numbers[0], k: numbers[1], l: numbers[2],
      d: numbers[3],
      real: numbers[4], imag: numbers[5], abs: numbers[6],
      twoTheta: numbers[7],
      intensity: Number.isFinite(numbers[8]) ? numbers[8] : null,
      multiplicity: Number.isFinite(numbers[9]) ? numbers[9] : null,
    })
  }
  return { reflections, count: reflections.length }
}

/**
 * 常用元素的 X 射线原子散射因子系数（Waasmaier–Kirfel 五高斯 + 常数），
 * 数值取自 VESTA 在 `-calcf` 时打印的同一组系数（Si 与 C）。
 * f0(s) = Σ a_i exp(-b_i s²) + c，其中 s = sinθ/λ（Å⁻¹）。
 */
export const XRAY_FORM_FACTORS = {
  Si: {
    a: [5.275329, 3.191038, 1.511514, 1.356849, 2.519114],
    b: [2.631338, 33.730728, 0.081119, 86.288640, 1.170087],
    c: 0.145073,
  },
  C: {
    a: [2.657506, 1.078079, 1.490909, -4.241070, 0.713791],
    b: [14.780758, 0.776775, 42.086843, -0.000294, 0.239535],
    c: 4.297983,
  },
  H: {
    a: [0.413048, 0.294953, 0.187491, 0.080701, 0.023736],
    b: [15.569946, 32.398468, 5.711404, 61.889874, 1.334118],
    c: 0.000049,
  },
  O: {
    a: [2.960427, 2.508818, 0.637853, 0.722838, 1.142756],
    b: [14.182259, 5.936858, 0.112726, 34.958481, 0.39024],
    c: 0.027014,
  },
  N: {
    a: [11.89378, 3.277479, 1.858092, 0.858927, 0.912985],
    b: [0.000158, 10.232723, 30.34469, 0.656065, 0.217287],
    c: -11.804902,
  },
  Na: {
    a: [4.910127, 3.081783, 1.262067, 1.098938, 0.560991],
    b: [3.281434, 9.119178, 0.102763, 132.013942, 0.405878],
    c: 0.079712,
  },
  Mg: {
    a: [4.708971, 1.194814, 1.558157, 1.170413, 3.239403],
    b: [4.875207, 108.506079, 0.111516, 48.292407, 1.928171],
    c: 0.126842,
  },
  Al: {
    a: [4.730796, 2.313951, 1.54198, 1.117564, 3.154754],
    b: [3.628931, 43.051166, 0.09596, 108.932389, 1.555918],
    c: 0.139509,
  },
  Cl: {
    a: [1.446071, 6.870609, 6.151801, 1.750347, 0.634168],
    b: [0.052357, 1.193165, 18.343416, 46.398394, 0.401005],
    c: 0.146773,
  },
  Fe: {
    a: [12.311098, 1.876623, 3.066177, 2.070451, 6.975185],
    b: [5.009415, 0.014461, 18.743041, 82.767874, 0.346506],
    c: -0.304931,
  },
  Cu: {
    a: [14.014192, 4.784577, 5.056806, 1.457971, 6.932996],
    b: [3.73828, 0.003744, 13.034982, 72.554793, 0.265666],
    c: -3.254477,
  },
  B: {
    a: [2.085185, 1.06458, 1.062788, 0.140515, 0.641784],
    b: [23.494069, 1.137894, 61.238975, 0.114886, 0.399036],
    c: 0.003823,
  },
  P: {
    a: [1.950541, 4.14693, 1.49456, 1.522042, 5.729711],
    b: [0.908139, 27.044953, 0.07128, 67.52019, 1.981173],
    c: 0.155233,
  },
  S: {
    a: [6.372157, 5.154568, 1.473732, 1.635073, 1.209372],
    b: [1.514347, 22.092528, 0.061373, 55.445176, 0.646925],
    c: 0.154722,
  },
  K: {
    a: [8.163991, 7.146945, 1.07014, 0.877316, 1.486434],
    b: [12.816323, 0.808945, 210.327009, 39.597651, 0.052821],
    c: 0.253614,
  },
  Ti: {
    a: [9.818524, 1.522646, 1.703101, 1.768774, 7.082555],
    b: [8.001879, 0.029763, 39.885423, 120.158, 0.532405],
    c: 0.102473,
  },
  Zn: {
    a: [14.741002, 6.907748, 4.642337, 2.191766, 38.424042],
    b: [3.388232, 0.243315, 11.903689, 63.31213, 0.000397],
    c: -36.915828,
  },
  Br: {
    a: [17.55057, 5.411882, 3.93718, 3.880645, 6.707793],
    b: [2.119226, 16.557185, 0.002481, 42.164009, 0.162121],
    c: -2.492088,
  },
  I: {
    a: [19.884502, 6.736593, 8.110516, 1.170953, 17.548715],
    b: [4.628591, 0.027754, 31.849096, 84.406391, 0.46355],
    c: -0.448811,
  },
}

/**
 * 单个原子的 X 射线散射因子 f0(sinθ/λ)。
 * @param {number} s - sinθ/λ（Å⁻¹）。
 * @param {{ a: number[], b: number[], c: number }} coefficients - 元素系数。
 * @returns {number} f0。
 */
export function xrayFormFactor(s, coefficients) {
  let value = coefficients.c
  for (let index = 0; index < coefficients.a.length; index += 1) {
    value += coefficients.a[index] * Math.exp(-coefficients.b[index] * s * s)
  }
  return value
}

/**
 * 按 hkl 计算 X 射线结构因子（仅 f0，忽略色散与 Debye-Waller）。
 * F(h) = Σ_j f0_j(s) · exp(2πi(h·x_j + k·y_j + l·z_j))
 * @param {{ a1: number[], a2: number[], a3: number[], atoms: Array<{ symbol: string, frac: number[] }> }} structure - 结构。
 * @param {{ h: number, k: number, l: number }} hkl - 衍射指数。
 * @param {Record<string, object>} [table] - 散射因子表，默认 XRAY_FORM_FACTORS。
 * @returns {{ d: number, real: number, imag: number, abs: number } | null}
 */
export function structureFactor(structure, hkl, table = XRAY_FORM_FACTORS) {
  const { h, k, l } = hkl
  const reciprocal = reciprocalLattice([structure.a1, structure.a2, structure.a3])
  const g = [0, 1, 2].map((axis) => h * reciprocal[0][axis] + k * reciprocal[1][axis] + l * reciprocal[2][axis])
  const gLength = Math.hypot(g[0], g[1], g[2])
  if (!(gLength > 0)) return null
  const d = (2 * Math.PI) / gLength
  const s = gLength / (4 * Math.PI) // sinθ/λ = |G| / (4π)
  let real = 0
  let imag = 0
  for (const atom of structure.atoms) {
    const coefficients = table[atom.symbol]
    if (!coefficients) return null
    const f = xrayFormFactor(s, coefficients)
    const phase = 2 * Math.PI * (h * atom.frac[0] + k * atom.frac[1] + l * atom.frac[2])
    real += f * Math.cos(phase)
    imag += f * Math.sin(phase)
  }
  return { d, real, imag, abs: Math.hypot(real, imag) }
}

/**
 * 特征 X 射线的色散修正系数（f′、f″），取自 VESTA `-calcf` 在 λ = 0.070932 nm 时的输出。
 * 注意：色散随波长变化，换靶（Cu/Mo/…）时应重新取值。
 */
export const XRAY_DISPERSION = {
  wavelengthNm: 0.070932,
  Si: { fp: 8.01582e-2, fpp: 6.91583e-2, fnt: -3.82840e-3 },
  C: { fp: 3.25775e-3, fpp: 1.59417e-3, fnt: -1.64420e-3 },
}

/**
 * 带色散修正的结构因子：每个原子贡献 (f0 + f′ + f_NT) + i·f″。
 * @param {{ a1: number[], a2: number[], a3: number[], atoms: Array<{ symbol: string, frac: number[] }> }} structure - 结构。
 * @param {{ h: number, k: number, l: number }} hkl - 衍射指数。
 * @param {{ table?: Record<string, object>, dispersion?: Record<string, object> }} [options] - 系数表与色散表。
 * @returns {{ d: number, real: number, imag: number, abs: number } | null}
 */
export function structureFactorDispersive(structure, hkl, options = {}) {
  const table = options.table ?? XRAY_FORM_FACTORS
  const dispersion = options.dispersion ?? XRAY_DISPERSION
  const { h, k, l } = hkl
  const reciprocal = reciprocalLattice([structure.a1, structure.a2, structure.a3])
  const g = [0, 1, 2].map((axis) => h * reciprocal[0][axis] + k * reciprocal[1][axis] + l * reciprocal[2][axis])
  const gLength = Math.hypot(g[0], g[1], g[2])
  if (!(gLength > 0)) return null
  const d = (2 * Math.PI) / gLength
  const s = gLength / (4 * Math.PI)
  let real = 0
  let imag = 0
  for (const atom of structure.atoms) {
    const coefficients = table[atom.symbol]
    if (!coefficients) return null
    const extra = dispersion[atom.symbol] ?? { fp: 0, fpp: 0, fnt: 0 }
    const f0 = xrayFormFactor(s, coefficients)
    const amplitude = f0 + (extra.fp ?? 0) + (extra.fnt ?? 0)
    const imaginary = extra.fpp ?? 0
    const phase = 2 * Math.PI * (h * atom.frac[0] + k * atom.frac[1] + l * atom.frac[2])
    real += amplitude * Math.cos(phase) - imaginary * Math.sin(phase)
    imag += amplitude * Math.sin(phase) + imaginary * Math.cos(phase)
  }
  return { d, real, imag, abs: Math.hypot(real, imag) }
}

/** 让 VESTA 算结构因子并解析结果（scripts/vesta-calcf.mjs）。
 * @param {string} structurePath - 结构文件绝对路径。
 * @returns {Promise<{ count: number, dRange: number[], strongest: object[] }>}
 */
export function generateCalcf(structurePath) {
  return runNodeScript('vesta-calcf.mjs', [structurePath], '结构因子')
}

/**
 * 由结构因子算 X 射线粉末衍射峰位与相对强度（Bragg–Brentano 几何）。
 * 做法：枚举 hkl 球 → 按 d 分组（同组即对称等价反射，自动含多重度）→
 * 强度 = Σ|F|² × LP(2θ)，LP = (1+cos²2θ)/(sin²θ·cosθ)，最后归一到 100。
 * 默认只用 f0（不引入色散），因为色散系数与波长强相关。
 * @param {{ a1: number[], a2: number[], a3: number[], atoms: Array<{ symbol: string, frac: number[] }> }} structure - 结构。
 * @param {{ lambda?: number, twoThetaMax?: number, maxIndex?: number, table?: Record<string, object> }} [options] - 波长（Å）、2θ 上限、hkl 半径、散射因子表。
 * @returns {{ lambda: number, peaks: Array<{ d: number, twoTheta: number, intensity: number, hkls: number[][] }>, strongest: object|null }}
 */
export function powderPattern(structure, options = {}) {
  const lambda = Number.isFinite(options.lambda) ? options.lambda : 1.5406 // Cu Kα1
  const twoThetaMax = Number.isFinite(options.twoThetaMax) ? options.twoThetaMax : 90
  const maxIndex = Number.isInteger(options.maxIndex) ? options.maxIndex : 6
  const table = options.table ?? XRAY_FORM_FACTORS
  const thetaMax = (twoThetaMax / 2) * (Math.PI / 180)
  const groups = new Map()
  for (let h = 0; h <= maxIndex; h += 1) {
    for (let k = -maxIndex; k <= maxIndex; k += 1) {
      for (let l = -maxIndex; l <= maxIndex; l += 1) {
        if (h === 0 && k === 0 && l === 0) continue
        const factor = structureFactor(structure, { h, k, l }, table)
        if (!factor || !(factor.d > 0)) continue
        const s = lambda / (2 * factor.d)
        if (s >= 1) continue // 该反射超出 2θ 上限可观测范围
        const twoTheta = 2 * Math.asin(s) * (180 / Math.PI)
        if (twoTheta > twoThetaMax) continue
        const key = factor.d.toFixed(4)
        const group = groups.get(key) ?? { d: factor.d, twoTheta, sum: 0, hkls: [] }
        group.sum += factor.abs ** 2
        group.hkls.push([h, k, l])
        groups.set(key, group)
      }
    }
  }
  const radians = (degrees) => (degrees / 2) * (Math.PI / 180)
  const peaks = [...groups.values()].map((group) => {
    const theta = radians(group.twoTheta)
    const sin = Math.sin(theta)
    const cos = Math.cos(theta)
    const lp = (1 + Math.cos(2 * theta) ** 2) / Math.max(sin * sin * cos, 1e-12)
    return {
      d: group.d,
      twoTheta: group.twoTheta,
      raw: group.sum * lp,
      hkls: group.hkls,
    }
  })
  const maxRaw = Math.max(...peaks.map((peak) => peak.raw), 1e-12)
  const scaled = peaks
    .map((peak) => ({ d: peak.d, twoTheta: peak.twoTheta, intensity: (peak.raw / maxRaw) * 100, hkls: peak.hkls }))
    .sort((a, b) => a.twoTheta - b.twoTheta)
  const strongest = scaled.reduce((best, peak) => (!best || peak.intensity > best.intensity ? peak : best), null)
  void thetaMax
  return { lambda, peaks: scaled, strongest }
}

/** 生成 X 射线粉末衍射图谱 HTML（scripts/make-powder.mjs）。
 * @param {string} structurePath - 结构文件绝对路径。
 * @param {{ lambda?: number, twoThetaMax?: number, fwhm?: number, out?: string }} [options] - 波长、2θ 上限、展宽与输出路径。
 * @returns {Promise<object>} 生成器 JSON（含 out / peaks / strongest）。
 */
export function generatePowderViewer(structurePath, options = {}) {
  const args = [structurePath]
  if (Number.isFinite(options.lambda)) args.push('--lambda', String(options.lambda))
  if (Number.isFinite(options.twoThetaMax)) args.push('--two-theta-max', String(options.twoThetaMax))
  if (Number.isFinite(options.fwhm)) args.push('--fwhm', String(options.fwhm))
  if (options.out) args.push('--out', toAbsolute(String(options.out), process.cwd()))
  return runNodeScript('make-powder.mjs', args, '粉末图谱')
}

/**
 * 沿指定轴把原子投影成层（用于板层/吸附体系：找每层的 z 位置与成分）。
 * @param {{ a1: number[], a2: number[], a3: number[], atoms: Array<{ symbol: string, frac: number[] }> }} structure - 结构。
 * @param {{ axis?: 'a'|'b'|'c', gap?: number }} [options] - 投影轴与分层阈值（Å，默认 0.6）。
 * @returns {{ positions: Array<{ symbol: string, z: number }>, layers: Array<{ z: number, count: number, elements: Record<string, number>, thickness: number }>, axisLength: number }}
 */
export function layerProfile(structure, options = {}) {
  const axisIndex = { a: 0, b: 1, c: 2 }[options.axis ?? 'c']
  const gap = Number.isFinite(options.gap) ? options.gap : 0.6
  const cell = [structure.a1, structure.a2, structure.a3]
  const axisLength = Math.hypot(...cell[axisIndex])
  const allowed = Array.isArray(options.elements) ? options.elements : null
  // CONTCAR/MD 的坐标可能略微越界（实测最大 −0.002），投影前先绕回胞内
  const wrap = (value) => value - Math.floor(value)
  const positions = structure.atoms
    .filter((atom) => allowed === null || allowed.includes(atom.symbol))
    .map((atom) => ({
      symbol: atom.symbol,
      z: wrap(atom.frac[0]) * cell[0][axisIndex] + wrap(atom.frac[1]) * cell[1][axisIndex] + wrap(atom.frac[2]) * cell[2][axisIndex],
    }))
  const sorted = [...positions].sort((a, b) => a.z - b.z)
  const layers = []
  for (const atom of sorted) {
    const current = layers[layers.length - 1]
    if (current && atom.z - current.maxZ <= gap) {
      current.atoms.push(atom)
      current.maxZ = atom.z
    } else {
      layers.push({ atoms: [atom], maxZ: atom.z })
    }
  }
  const summarized = layers.map((layer) => {
    const zValues = layer.atoms.map((atom) => atom.z)
    const elements = {}
    for (const atom of layer.atoms) elements[atom.symbol] = (elements[atom.symbol] ?? 0) + 1
    return {
      z: zValues.reduce((sum, value) => sum + value, 0) / zValues.length,
      count: layer.atoms.length,
      elements,
      thickness: Math.max(...zValues) - Math.min(...zValues),
    }
  })
  return { positions, layers: summarized, axisLength }
}

/**
 * 计算吸附物到基底最近一层的高度（沿指定轴）。
 * 基底层的中心取「只含基底元素、且离吸附物最近」的那一层。
 * @param {{ atoms: Array<{ symbol: string, frac: number[] }> }} structure - 结构。
 * @param {{ adsorbate: string, substrate: string|string[], axis?: 'a'|'b'|'c', gap?: number }} options - 吸附物与基底元素。
 * @returns {{ heights: Array<{ z: number, height: number, layerZ: number }>, mean: number|null }}
 */
export function adsorbateHeight(structure, options) {
  const substrate = Array.isArray(options.substrate) ? options.substrate : [options.substrate]
  // 基底与吸附物分别分层：否则吸附物离基底很近（小于分层阈值）时会并成一层
  const substrateProfile = layerProfile(structure, {
    axis: options.axis ?? 'c', gap: options.gap, elements: substrate,
  })
  const substrateLayers = substrateProfile.layers.filter((layer) =>
    Object.keys(layer.elements).some((element) => substrate.includes(element)))
  const adsorbateProfile = layerProfile(structure, {
    axis: options.axis ?? 'c', gap: options.gap, elements: [options.adsorbate],
  })
  const adsorbatePositions = adsorbateProfile.positions
  if (substrateLayers.length === 0 || adsorbatePositions.length === 0) return { heights: [], mean: null }
  const heights = adsorbatePositions.map((atom) => {
    let nearest = substrateLayers[0]
    for (const layer of substrateLayers) {
      if (Math.abs(layer.z - atom.z) < Math.abs(nearest.z - atom.z)) nearest = layer
    }
    return { z: atom.z, height: Math.abs(atom.z - nearest.z), layerZ: nearest.z }
  })
  return { heights, mean: heights.reduce((sum, item) => sum + item.height, 0) / heights.length }
}

/**
 * 判别吸附物落在基底的哪种位点上（top / bridge / hollow），只看面内（xy）近邻。
 * 做法：取最近基底原子的面内距离 d_min，统计距离 < d_min + tolerance 的原子个数：
 * 1 个 → top；2 个 → bridge；3 个及以上 → hollow（石墨烯六元环中心是 6 个）。
 * 面内距离按晶胞周期性取最小镜像。
 * @param {{ a1: number[], a2: number[], a3: number[], atoms: Array<{ symbol: string, frac: number[] }> }} structure - 结构。
 * @param {{ adsorbate: string, substrate: string|string[], axis?: 'a'|'b'|'c', tolerance?: number }} options - 吸附物、基底与容差（Å）。
 * @returns {{ sites: Array<{ z: number, site: string, neighbors: number, distance: number, distances: number[] }>, summary: string }}
 */
export function adsorbateSite(structure, options) {
  const substrate = Array.isArray(options.substrate) ? options.substrate : [options.substrate]
  const axisIndex = { a: 0, b: 1, c: 2 }[options.axis ?? 'c']
  const planeAxes = [0, 1, 2].filter((index) => index !== axisIndex)
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 0.3
  const cell = [structure.a1, structure.a2, structure.a3]
  const cart = (frac) => [0, 1, 2].map((axis) =>
    frac[0] * cell[0][axis] + frac[1] * cell[1][axis] + frac[2] * cell[2][axis])
  const wrap = (value) => value - Math.floor(value)
  const wrappedFrac = (frac) => frac.map(wrap)
  const substrateAtoms = structure.atoms.filter((atom) => substrate.includes(atom.symbol)).map((atom) => cart(wrappedFrac(atom.frac)))
  const adsorbates = structure.atoms.filter((atom) => atom.symbol === options.adsorbate).map((atom) => cart(wrappedFrac(atom.frac)))
  const sites = adsorbates.map((position) => {
    const distances = substrateAtoms.map((atom) => {
      // 面内最小镜像：遍历 ±1 个晶胞平移
      let best = Infinity
      for (let i = -1; i <= 1; i += 1) {
        for (let j = -1; j <= 1; j += 1) {
          for (let k = -1; k <= 1; k += 1) {
            const shift = [0, 1, 2].map((axis) => i * cell[0][axis] + j * cell[1][axis] + k * cell[2][axis])
            const dx = position[planeAxes[0]] - (atom[planeAxes[0]] + shift[planeAxes[0]])
            const dy = position[planeAxes[1]] - (atom[planeAxes[1]] + shift[planeAxes[1]])
            const d = Math.hypot(dx, dy)
            if (d < best) best = d
          }
        }
      }
      return best
    }).sort((a, b) => a - b)
    const minimum = distances[0] ?? Infinity
    const neighbors = distances.filter((value) => value < minimum + tolerance).length
    const site = neighbors <= 1 ? 'top' : neighbors === 2 ? 'bridge' : 'hollow'
    return { z: position[axisIndex], site, neighbors, distance: minimum, distances: distances.slice(0, 6) }
  })
  const counts = new Map()
  for (const item of sites) counts.set(item.site, (counts.get(item.site) ?? 0) + 1)
  const summary = [...counts.entries()].map(([site, count]) => `${site}×${count}`).join('，')
  return { sites, summary }
}

/** 批量板层报表（scripts/slab-report.mjs）。
 * @param {string} root - 任务根目录（或单个结构文件所在目录）。
 * @param {{ adsorbate?: string, substrate?: string, marker?: string, depth?: number, out?: string }} [options]
 * @returns {Promise<object>} 生成器 JSON（tasks / withAdsorbate / sites / out）。
 */
export function generateSlabReport(root, options = {}) {
  const args = ['--root', root]
  if (options.adsorbate) args.push('--adsorbate', String(options.adsorbate))
  if (options.substrate) args.push('--substrate', String(options.substrate))
  if (options.marker) args.push('--marker', String(options.marker))
  if (Number.isInteger(options.depth)) args.push('--depth', String(options.depth))
  if (options.out) args.push('--out', toAbsolute(String(options.out), process.cwd()))
  return runNodeScript('slab-report.mjs', args, '板层报表')
}

/**
 * 沿某轴做平面平均（对平面内所有格点求平均），用于 LOCPOT 的宏观平均电势剖面。
 * @param {{ dims: number[], values: Float32Array, structure: { a1: number[], a2: number[], a3: number[] } }} volume - 体积网格。
 * @param {{ axis?: 'a'|'b'|'c' }} [options] - 投影轴，默认 c。
 * @returns {{ axis: string, positions: number[], values: number[], length: number }} 位置为沿轴的笛卡尔坐标（Å）。
 */
export function planarAverage(volume, options = {}) {
  const axis = options.axis ?? 'c'
  const axisIndex = { a: 0, b: 1, c: 2 }[axis]
  const [nx, ny, nz] = volume.dims
  const counts = [nx, ny, nz]
  const planeAxes = [0, 1, 2].filter((index) => index !== axisIndex)
  const cell = [volume.structure.a1, volume.structure.a2, volume.structure.a3]
  const length = Math.hypot(...cell[axisIndex])
  const steps = counts[axisIndex]
  const values = new Array(steps).fill(0)
  const countsPerStep = new Array(steps).fill(0)
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let k = 0; k < nz; k += 1) {
        const index = [i, j, k]
        const step = index[axisIndex]
        values[step] += volume.values[(k * ny + j) * nx + i]
        countsPerStep[step] += 1
      }
    }
  }
  void planeAxes
  const averaged = values.map((sum, step) => sum / Math.max(countsPerStep[step], 1))
  return {
    axis,
    length,
    positions: averaged.map((_, step) => (step / steps) * length),
    values: averaged,
  }
}

/**
 * 从 LOCPOT 的宏观平均电势估功函数：WF = V_vacuum − E_Fermi。
 * 真空能级取平均电势里**最长的近水平段**（斜率接近 0）的均值——板层中间的真空区。
 * @param {{ dims: number[], values: Float32Array, structure: object }} volume - LOCPOT 体积（eV）。
 * @param {{ efermi: number, axis?: 'a'|'b'|'c', tolerance?: number, minRun?: number }} options - 费米能级、轴与平台判据。
 * @returns {{ efermi: number, vacuumLevel: number|null, workFunction: number|null, plateau: { start: number, end: number, length: number }|null, profile: { positions: number[], values: number[] } }}
 */
export function workFunction(volume, options) {
  const efermi = Number(options.efermi)
  if (!Number.isFinite(efermi)) throw new Error('workFunction 需要有限值的 efermi')
  const average = planarAverage(volume, { axis: options.axis ?? 'c' })
  const values = average.values
  const n = values.length
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 0.01
  const minRun = Number.isInteger(options.minRun) ? options.minRun : Math.max(3, Math.round(n * 0.05))
  const slopes = values.map((value, index) => values[(index + 1) % n] - value)
  // 找最长的「斜率都小于 tolerance」的连续段（环形）
  let best = null
  let start = -1
  for (let offset = 0; offset < n * 2; offset += 1) {
    const index = offset % n
    const flat = Math.abs(slopes[index]) <= tolerance
    if (flat && start < 0) start = offset
    if ((!flat || offset === n * 2 - 1) && start >= 0) {
      const length = offset - start
      if (length >= minRun && (best === null || length > best.length)) best = { start, length }
      start = -1
    }
  }
  if (best === null) {
    // 退化情形：用整条曲线的最大值（真空势通常最高）
    const maxIndex = values.indexOf(Math.max(...values))
    return {
      efermi,
      vacuumLevel: values[maxIndex],
      workFunction: values[maxIndex] - efermi,
      plateau: { start: maxIndex, end: maxIndex, length: 1 },
      profile: average,
    }
  }
  const indices = []
  for (let offset = best.start; offset < best.start + Math.min(best.length, n); offset += 1) indices.push(offset % n)
  const vacuumLevel = indices.reduce((sum, index) => sum + values[index], 0) / indices.length
  return {
    efermi,
    vacuumLevel,
    workFunction: vacuumLevel - efermi,
    plateau: {
      start: average.positions[indices[0]],
      end: average.positions[indices[indices.length - 1]],
      length: ((indices.length - 1) * average.length) / n,
    },
    profile: average,
  }
}

/** 功函数剖面图（scripts/make-workfunction.mjs）。
 * @param {string} locpotPath - LOCPOT 绝对路径（或含它的任务目录）。
 * @param {{ axis?: string, efermi?: number, out?: string }} [options] - 轴、费米能级覆盖与输出路径。
 * @returns {Promise<object>} 生成器 JSON（out / efermi / vacuumLevel / workFunction / plateau）。
 */
export function generateWorkFunctionViewer(locpotPath, options = {}) {
  const args = [locpotPath]
  if (options.axis) args.push('--axis', String(options.axis))
  if (Number.isFinite(options.efermi)) args.push('--efermi', String(options.efermi))
  if (options.out) args.push('--out', toAbsolute(String(options.out), process.cwd()))
  return runNodeScript('make-workfunction.mjs', args, '功函数图')
}

/**
 * 按「最近原子」把每个体素归给原子，积分得到每原子电荷（离散 Voronoi / Bader 近似）。
 * 与真 Voronoi 的区别：这里是按体素归属，属于离散近似；等距体素按并列数均分。
 * @param {{ dims: number[], values: Float32Array, structure: { a1: number[], a2: number[], a3: number[], atoms: Array<{ symbol: string, frac: number[] }> } }} volume - 电子密度体积（e/Å³）。
 * @param {{ structure?: object }} [options] - 可选结构覆盖（默认用 volume.structure）。
 * @returns {{ atoms: Array<{ index: number, symbol: string, frac: number[], charge: number, volume: number }>, byElement: Record<string, { count: number, charge: number, perAtom: number }>, total: number }}
 */
export function voronoiCharges(volume, options = {}) {
  const structure = options.structure ?? volume.structure
  if (!structure || !Array.isArray(structure.atoms) || structure.atoms.length === 0) {
    throw new Error('voronoiCharges 需要带原子的结构（POSCAR 或 volume.structure）')
  }
  const [nx, ny, nz] = volume.dims
  const a1 = structure.a1, a2 = structure.a2, a3 = structure.a3
  const det = a1[0] * (a2[1] * a3[2] - a2[2] * a3[1])
    - a1[1] * (a2[0] * a3[2] - a2[2] * a3[0])
    + a1[2] * (a2[0] * a3[1] - a2[1] * a3[0])
  const voxelVolume = Math.abs(det) / (nx * ny * nz)
  const atoms = structure.atoms
  const count = atoms.length

  // 预取原子分数坐标到扁平数组，避免内层反复取属性
  const fx = new Float64Array(count)
  const fy = new Float64Array(count)
  const fz = new Float64Array(count)
  for (let index = 0; index < count; index += 1) {
    fx[index] = atoms[index].frac[0]
    fy[index] = atoms[index].frac[1]
    fz[index] = atoms[index].frac[2]
  }
  const charge = new Float64Array(count)
  const cellVolumeOfAtom = new Float64Array(count)

  const values = volume.values
  const tolerance = 1e-9
  for (let k = 0; k < nz; k += 1) {
    const kk = k / nz
    for (let j = 0; j < ny; j += 1) {
      const jj = j / ny
      for (let i = 0; i < nx; i += 1) {
        const density = values[(k * ny + j) * nx + i]
        if (density === 0) continue
        const ii = i / nx
        let nearest = Infinity
        let tieCount = 0
        // 第一遍：找最小距离
        for (let index = 0; index < count; index += 1) {
          let dx = ii - fx[index]
          let dy = jj - fy[index]
          let dz = kk - fz[index]
          dx -= Math.round(dx)
          dy -= Math.round(dy)
          dz -= Math.round(dz)
          const sx = dx * a1[0] + dy * a2[0] + dz * a3[0]
          const sy = dx * a1[1] + dy * a2[1] + dz * a3[1]
          const sz = dx * a1[2] + dy * a2[2] + dz * a3[2]
          const distance = Math.sqrt(sx * sx + sy * sy + sz * sz)
          if (distance < nearest) nearest = distance
        }
        // 第二遍：统计并列（含 1e-9 容差），等距按并列数均分
        for (let index = 0; index < count; index += 1) {
          let dx = ii - fx[index]
          let dy = jj - fy[index]
          let dz = kk - fz[index]
          dx -= Math.round(dx)
          dy -= Math.round(dy)
          dz -= Math.round(dz)
          const sx = dx * a1[0] + dy * a2[0] + dz * a3[0]
          const sy = dx * a1[1] + dy * a2[1] + dz * a3[1]
          const sz = dx * a1[2] + dy * a2[2] + dz * a3[2]
          const distance = Math.sqrt(sx * sx + sy * sy + sz * sz)
          if (distance <= nearest + tolerance) tieCount += 1
        }
        const share = (density * voxelVolume) / tieCount
        const volumeShare = voxelVolume / tieCount
        for (let index = 0; index < count; index += 1) {
          let dx = ii - fx[index]
          let dy = jj - fy[index]
          let dz = kk - fz[index]
          dx -= Math.round(dx)
          dy -= Math.round(dy)
          dz -= Math.round(dz)
          const sx = dx * a1[0] + dy * a2[0] + dz * a3[0]
          const sy = dx * a1[1] + dy * a2[1] + dz * a3[1]
          const sz = dx * a1[2] + dy * a2[2] + dz * a3[2]
          const distance = Math.sqrt(sx * sx + sy * sy + sz * sz)
          if (distance <= nearest + tolerance) {
            charge[index] += share
            cellVolumeOfAtom[index] += volumeShare
          }
        }
      }
    }
  }

  const result = atoms.map((atom, index) => ({
    index: index + 1,
    symbol: atom.symbol,
    frac: atom.frac,
    charge: charge[index],
    volume: cellVolumeOfAtom[index],
  }))
  const byElement = {}
  for (const item of result) {
    const entry = byElement[item.symbol] ?? { count: 0, charge: 0, perAtom: 0 }
    entry.count += 1
    entry.charge += item.charge
    byElement[item.symbol] = entry
  }
  for (const entry of Object.values(byElement)) entry.perAtom = entry.charge / entry.count
  return {
    atoms: result,
    byElement,
    total: result.reduce((sum, item) => sum + item.charge, 0),
  }
}

export function generateChargePartition(volumePath, options = {}) {
  const args = [volumePath]
  if (options.poscar) args.push('--poscar', toAbsolute(String(options.poscar), process.cwd()))
  if (options.out) args.push('--out', toAbsolute(String(options.out), process.cwd()))
  return runNodeScript('vasp-bader.mjs', args, '电荷归属')
}

/**
 * 把 VESTA 文本区里「Integrated value of volumetric data over the unit cell」的数值换算成电子数。
 * 实测（两份密度文件交叉验证）：VESTA 的数值 × 6.748334 = 电子数，6.748334 即 1/a₀³（每 Å³ 等于 6.748 bohr³）。
 * 也就是说 VESTA 报的是「按 bohr³ 归一化」的积分；我们自己的 ∫ρdV 直接就是电子数。
 * @param {number} value - VESTA 报出的积分值。
 * @returns {number} 电子数。
 */
export function vestaIntegralToElectrons(value) {
  return Number(value) * BOHR3_TO_A3
}

/**
 * 把结构扩成超胞（按 a/b/c 方向重复）。
 * 分数坐标 x' = (i + x)/nx，保持原子顺序（先按原顺序，再按平移字典序），晶胞向量按倍数放大。
 * @param {{ a1: number[], a2: number[], a3: number[], atoms: Array<{ symbol: string, frac: number[] }> }} structure - 原结构。
 * @param {[number, number, number]} repeat - 三个方向的重复倍数（正整数）。
 * @returns {{ a1: number[], a2: number[], a3: number[], atoms: Array<{ symbol: string, frac: number[] }>, repeat: number[] }}
 */
export function makeSupercell(structure, repeat) {
  if (!Array.isArray(repeat) || repeat.length !== 3) throw new Error('repeat 必须是三个正整数')
  const [nx, ny, nz] = repeat.map((value) => Math.trunc(Number(value)))
  if (![nx, ny, nz].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('repeat 的每个分量都必须是正整数')
  }
  if (nx * ny * nz > 1000) throw new Error('扩胞倍数过大（最多 1000 倍）')
  const scale = [nx, ny, nz]
  const a1 = structure.a1.map((value) => value * nx)
  const a2 = structure.a2.map((value) => value * ny)
  const a3 = structure.a3.map((value) => value * nz)
  const atoms = []
  // 保持物种顺序：外层遍历平移，内层遍历原原子；这样同一物种的原子仍然连续
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let k = 0; k < nz; k += 1) {
        for (const atom of structure.atoms) {
          atoms.push({
            symbol: atom.symbol,
            frac: [
              (atom.frac[0] + i) / nx,
              (atom.frac[1] + j) / ny,
              (atom.frac[2] + k) / nz,
            ],
          })
        }
      }
    }
  }
  return { a1, a2, a3, atoms, repeat: scale }
}

/**
 * 把结构「折叠」回晶胞：分数坐标取模到 [0,1)，并合并间距小于 tolerance 的重复原子。
 * 用于清理 CONTCAR / MD 轨迹里跑出胞外或重复的坐标。
 * @param {{ a1: number[], a2: number[], a3: number[], atoms: Array<{ symbol: string, frac: number[] }> }} structure - 原结构。
 * @param {{ tolerance?: number, keepSymbol?: boolean }} [options] - 去重阈值（Å，默认 0.3）与是否要求同元素才算重复。
 * @returns {{ a1: number[], a2: number[], a3: number[], atoms: Array<{ symbol: string, frac: number[] }>, wrapped: number, merged: number }}
 */
export function foldStructure(structure, options = {}) {
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 0.3
  const keepSymbol = options.keepSymbol !== false
  const cell = [structure.a1, structure.a2, structure.a3]
  const cart = (frac) => [0, 1, 2].map((axis) =>
    frac[0] * cell[0][axis] + frac[1] * cell[1][axis] + frac[2] * cell[2][axis])
  let wrapped = 0
  const folded = structure.atoms.map((atom) => {
    const frac = atom.frac.map((value) => {
      const wrappedValue = value - Math.floor(value)
      if (Math.abs(wrappedValue - value) > 1e-9) wrapped += 1
      return wrappedValue
    })
    return { symbol: atom.symbol, frac }
  })

  // 去重：同一元素、距离 < tolerance 视为重复（周期性距离）
  const kept = []
  let merged = 0
  for (const atom of folded) {
    const position = cart(atom.frac)
    let duplicate = false
    for (const existing of kept) {
      if (keepSymbol && existing.symbol !== atom.symbol) continue
      const other = cart(existing.frac)
      let best = Infinity
      for (let i = -1; i <= 1; i += 1) {
        for (let j = -1; j <= 1; j += 1) {
          for (let k = -1; k <= 1; k += 1) {
            const shift = [0, 1, 2].map((axis) => i * cell[0][axis] + j * cell[1][axis] + k * cell[2][axis])
            const distance = Math.hypot(
              position[0] - (other[0] + shift[0]),
              position[1] - (other[1] + shift[1]),
              position[2] - (other[2] + shift[2]),
            )
            if (distance < best) best = distance
          }
        }
      }
      if (best < tolerance) {
        duplicate = true
        break
      }
    }
    if (duplicate) merged += 1
    else kept.push(atom)
  }

  return { a1: structure.a1, a2: structure.a2, a3: structure.a3, atoms: kept, wrapped, merged }
}

/**
 * 结构预检：跑 VASP 之前检查常见问题。
 * 检查项：晶胞体积/角度合法、原子数非零、坐标越界、周期等价重复、最近原子间距过近。
 * @param {{ a1: number[], a2: number[], a3: number[], atoms: Array<{ symbol: string, frac: number[] }> }} structure - 结构。
 * @param {{ minDistance?: number }} [options] - 过近阈值（Å，默认 0.5）。
 * @returns {{ ok: boolean, issues: Array<{ level: 'error'|'warning', message: string }>, minDistance: number|null, cellVolume: number, atoms: number, formula: string }}
 */
export function structureHealth(structure, options = {}) {
  const minDistanceLimit = Number.isFinite(options.minDistance) ? options.minDistance : 0.5
  const issues = []
  const cell = [structure.a1, structure.a2, structure.a3]
  const det = cell[0][0] * (cell[1][1] * cell[2][2] - cell[1][2] * cell[2][1])
    - cell[0][1] * (cell[1][0] * cell[2][2] - cell[1][2] * cell[2][0])
    + cell[0][2] * (cell[1][0] * cell[2][1] - cell[1][1] * cell[2][0])
  const cellVolume = Math.abs(det)
  if (!(cellVolume > 1e-6)) issues.push({ level: 'error', message: `晶胞体积异常：${cellVolume.toExponential(2)} Å³` })

  const lengths = cell.map((vector) => Math.hypot(...vector))
  for (const [index, length] of lengths.entries()) {
    if (!(length > 1e-6)) issues.push({ level: 'error', message: `晶胞向量 ${'abc'[index]} 长度为 0` })
  }
  const angles = [
    [1, 2], [0, 2], [0, 1],
  ].map(([i, j]) => {
    const dot = cell[i][0] * cell[j][0] + cell[i][1] * cell[j][1] + cell[i][2] * cell[j][2]
    return (Math.acos(Math.max(-1, Math.min(1, dot / (lengths[i] * lengths[j])))) * 180) / Math.PI
  })
  for (const [index, angle] of angles.entries()) {
    if (!(angle > 1 && angle < 179)) {
      issues.push({ level: 'error', message: `晶胞角 ${'αβγ'[index]} = ${angle.toFixed(2)}° 不合理` })
    }
  }

  const atoms = structure.atoms ?? []
  if (atoms.length === 0) issues.push({ level: 'error', message: '结构里没有原子' })

  const counts = new Map()
  let outOfRange = 0
  for (const atom of atoms) {
    counts.set(atom.symbol, (counts.get(atom.symbol) ?? 0) + 1)
    if (atom.frac.some((value) => value < -1e-6 || value >= 1 + 1e-6)) outOfRange += 1
  }
  if (outOfRange > 0) {
    issues.push({ level: 'warning', message: `${outOfRange} 个原子的分数坐标越界（VASP 可接受，但分析前建议 foldStructure）` })
  }

  const cart = (frac) => [0, 1, 2].map((axis) =>
    frac[0] * cell[0][axis] + frac[1] * cell[1][axis] + frac[2] * cell[2][axis])
  let minDistance = null
  let duplicates = 0
  let tooClose = 0
  for (let i = 0; i < atoms.length; i += 1) {
    for (let j = i + 1; j < atoms.length; j += 1) {
      const a = cart(atoms[i].frac)
      const b = cart(atoms[j].frac)
      let best = Infinity
      for (let x = -1; x <= 1; x += 1) {
        for (let y = -1; y <= 1; y += 1) {
          for (let z = -1; z <= 1; z += 1) {
            const shift = [0, 1, 2].map((axis) => x * cell[0][axis] + y * cell[1][axis] + z * cell[2][axis])
            const distance = Math.hypot(
              a[0] - (b[0] + shift[0]),
              a[1] - (b[1] + shift[1]),
              a[2] - (b[2] + shift[2]),
            )
            if (distance < best) best = distance
          }
        }
      }
      if (minDistance === null || best < minDistance) minDistance = best
      if (best < 1e-4) duplicates += 1
      else if (best < minDistanceLimit) tooClose += 1
    }
  }
  if (duplicates > 0) issues.push({ level: 'error', message: `${duplicates} 对原子完全重合（同一周期位置）` })
  if (tooClose > 0) issues.push({ level: 'warning', message: `${tooClose} 对原子距离 < ${minDistanceLimit} Å` })

  const formula = [...counts.entries()].map(([symbol, count]) => `${symbol}${count}`).join('')
  return {
    ok: !issues.some((issue) => issue.level === 'error'),
    issues,
    minDistance,
    cellVolume,
    atoms: atoms.length,
    formula,
  }
}

/** 结构预检（scripts/check-structure.mjs）。
 * @param {string} target - 结构文件或任务根目录。
 * @param {{ marker?: string, minDistance?: number }} [options] - 标志文件名与过近阈值（Å）。
 * @returns {Promise<object>} JSON（files / errors / problems）。
 */
export function generateStructureCheck(target, options = {}) {
  const args = [target]
  if (options.marker) args.push('--marker', String(options.marker))
  if (Number.isFinite(options.minDistance)) args.push('--min-distance', String(options.minDistance))
  return runNodeScript('check-structure.mjs', args, '结构预检')
}

/**
 * 解析 vasprun.xml（VASP 的 XML 输出，文档见 vasp.at/wiki/Vasprun.xml）。
 * 只依赖正则做定点提取（与项目其它解析器一致，不引入 XML 依赖），覆盖最常用的字段：
 * 版本、INCAR、原子/物种/价电子、k 点、每离子步能量、费米能级、力/应力、终态结构。
 * @param {string} text - vasprun.xml 内容。
 * @returns {{ version: string|null, incar: Record<string,string>, natoms: number|null, types: Array<{ element: string, count: number, valence: number, pseudopotential: string }>, kpoints: { scheme: string|null, divisions: number[]|null, count: number }, energies: number[], ionicSteps: number, efermi: number|null, nbands: number|null, nelect: number|null, maxForce: number|null, stress: number[]|null, finalStructure: { basis: number[][], positions: number[][] }|null }}
 */
export function parseVasprunXml(text) {
  const source = String(text ?? '')
  const number = (pattern) => {
    const match = pattern.exec(source)
    if (!match) return null
    const value = Number(match[1])
    return Number.isFinite(value) ? value : null
  }

  // 版本
  const versionMatch = /<i[^>]*name="version"[^>]*>\s*([^<]+?)\s*<\/i>/.exec(source)
  const subversionMatch = /<i[^>]*name="subversion"[^>]*>\s*([^<]+?)\s*<\/i>/.exec(source)
  const version = versionMatch
    ? `${versionMatch[1]}${subversionMatch ? ` ${subversionMatch[1]}` : ''}`.trim()
    : null

  // INCAR（只含用户显式设置项）
  const incar = {}
  const incarBlock = /<incar>([\s\S]*?)<\/incar>/.exec(source)
  if (incarBlock) {
    for (const match of incarBlock[1].matchAll(/<i[^>]*name="([^"]+)"[^>]*>\s*([^<]*?)\s*<\/i>/g)) {
      incar[match[1]] = match[2].trim()
    }
  }

  // 原子与物种
  const natoms = number(/<atoms>\s*(\d+)\s*<\/atoms>/)
  const types = []
  const atomtypes = /<array name="atomtypes"\s*>([\s\S]*?)<\/array>/.exec(source)
  if (atomtypes) {
    for (const row of atomtypes[1].matchAll(/<rc>([\s\S]*?)<\/rc>/g)) {
      const cells = [...row[1].matchAll(/<c[^>]*>\s*([^<]*?)\s*<\/c>/g)].map((item) => item[1].trim())
      if (cells.length < 5) continue
      types.push({
        count: Number(cells[0]),
        element: cells[1],
        mass: Number(cells[2]),
        valence: Number(cells[3]),
        pseudopotential: cells[4],
      })
    }
  }

  // k 点
  const schemeMatch = /<generation[^>]*param="([^"]+)"/.exec(source)
  const divisionsMatch = /<v[^>]*name="divisions"[^>]*>\s*([^<]+?)\s*<\/v>/.exec(source)
  const divisions = divisionsMatch ? divisionsMatch[1].trim().split(/\s+/).map(Number) : null
  const kpointBlock = /<varray name="kpointlist"[^>]*>([\s\S]*?)<\/varray>/.exec(source)
  const kpointCount = kpointBlock ? [...kpointBlock[1].matchAll(/<v[^>]*>/g)].length : 0

  // 能量：每个电子步一个 <energy> 块；取每步最后的 e_0_energy 作为该离子步能量
  const energies = []
  for (const block of source.matchAll(/<energy>([\s\S]*?)<\/energy>/g)) {
    const match = /<i[^>]*name="e_0_energy"[^>]*>\s*(-?[\d.eE+-]+)\s*<\/i>/.exec(block[1])
    if (match) energies.push(Number(match[1]))
  }
  const ionicSteps = (source.match(/<varray name="forces"\s*>/g) ?? []).length
  const efermi = number(/<i[^>]*name="efermi"[^>]*>\s*(-?[\d.eE+-]+)\s*<\/i>/)
  const nbands = number(/<i[^>]*name="NBANDS"[^>]*>\s*(\d+)\s*<\/i>/)
  const nelect = number(/<i[^>]*name="NELECT"[^>]*>\s*(-?[\d.eE+-]+)\s*<\/i>/)

  // 最后一个力的 varray
  let maxForce = null
  for (const block of source.matchAll(/<varray name="forces"\s*[^>]*>([\s\S]*?)<\/varray>/g)) {
    const vectors = [...block[1].matchAll(/<v[^>]*>\s*([^<]+?)\s*<\/v>/g)]
      .map((item) => item[1].trim().split(/\s+/).map(Number))
      .filter((vector) => vector.length >= 3 && vector.slice(0, 3).every((value) => Number.isFinite(value)))
    if (vectors.length > 0) {
      const magnitudes = vectors.map((vector) => Math.hypot(vector[0], vector[1], vector[2]))
      maxForce = Math.max(...magnitudes)
    }
  }

  // 最后一个应力张量（3×3 → 6 个分量，kB）
  let stress = null
  for (const block of source.matchAll(/<varray name="stress"[^>]*>([\s\S]*?)<\/varray>/g)) {
    const rows = [...block[1].matchAll(/<v[^>]*>\s*([^<]+?)\s*<\/v>/g)]
      .map((item) => item[1].trim().split(/\s+/).map(Number))
      .filter((row) => row.length >= 3 && row.slice(0, 3).every((value) => Number.isFinite(value)))
    if (rows.length >= 3) {
      stress = [rows[0][0], rows[1][1], rows[2][2], rows[0][1], rows[1][2], rows[0][2]]
    }
  }

  // 终态结构（finalpos）
  let finalStructure = null
  const finalBlock = /<structure name="finalpos"\s*>([\s\S]*?)<\/structure>/.exec(source)
  if (finalBlock) {
    const basisBlock = /<varray name="basis"[^>]*>([\s\S]*?)<\/varray>/.exec(finalBlock[1])
    const positionBlock = /<varray name="positions"[^>]*>([\s\S]*?)<\/varray>/.exec(finalBlock[1])
    const basis = basisBlock
      ? [...basisBlock[1].matchAll(/<v[^>]*>\s*([^<]+?)\s*<\/v>/g)].map((item) => item[1].trim().split(/\s+/).map(Number))
      : []
    const positions = positionBlock
      ? [...positionBlock[1].matchAll(/<v[^>]*>\s*([^<]+?)\s*<\/v>/g)].map((item) => item[1].trim().split(/\s+/).map(Number))
      : []
    if (basis.length === 3 && positions.length > 0) finalStructure = { basis, positions }
  }

  return {
    version,
    incar,
    natoms,
    types,
    kpoints: { scheme: schemeMatch ? schemeMatch[1] : null, divisions, count: kpointCount },
    energies,
    ionicSteps,
    efermi,
    nbands,
    nelect,
    maxForce,
    stress,
    finalStructure,
  }
}
