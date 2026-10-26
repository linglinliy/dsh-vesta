# 项目与安装

> 从 README 拆出（v2.73.0）。安装、边界、MCP 与内部结构。

<!-- TOC -->
<details>
<summary>目录（10 节，点击展开）</summary>

- [能力](#能力)
- [为什么走 Win32](#为什么走-win32)
- [MCP 服务器](#mcp-服务器)
- [DSH 原生插件配置](#dsh-原生插件配置)
- [边界](#边界)
- [为什么这么写](#为什么这么写)
- [用真实 VASP 任务自检](#用真实-vasp-任务自检)
- [一键自检](#一键自检)
- [内部结构（重构记录）](#内部结构重构记录)
- [命令行错误处理](#命令行错误处理)

</details>
<!-- /TOC -->

## 能力

| 工具 | 作用 | 通道 |
| --- | --- | --- |
| `vesta_open` | 打开 1–10 个结构文件；传目录按 `POSCAR → CONTCAR → *.cif` 自动挑主结构 | 启动进程 |
| `vesta_info` | 安装位置、`VESTA.ini` 版本标识、最近文件、运行中的进程 | 读文件 |
| `vesta_menu` | 列出全部菜单命令（id/路径/可用性）或执行某一条 | Win32 `WM_COMMAND` |
| `vesta_control` | 列出对话框控件（按钮/输入框/勾选态），按 hwnd 或文字点击、写文本 | Win32 子窗口消息 |
| `vesta_capture` | 把窗口/对话框抓成 PNG（`PrintWindow`，被遮挡也能抓） | GDI |

## 为什么走 Win32

VESTA 闭源、GUI-only、没有脚本接口：我扫过 `VESTA.exe` 的字符串，没有任何命令行开关（只有文件参数）。但它是 wxWidgets 程序：

- 菜单是真正的 `HMENU` → 能递归枚举 84 条命令并用 `WM_COMMAND` 触发；
- 面板与对话框控件是真正的子窗口 HWND → 能 `BM_CLICK`、`WM_SETTEXT`、读取勾选态；
- 窗口能用 `PrintWindow` 抓图。

[`win/vesta-ui.ps1`](win/vesta-ui.ps1) 只做这只「手」（stdout 只输出一行 JSON），语义判断留在 Node 侧。全流程零原生依赖。

### 已验证（本机实测）

| 操作 | 结果 |
| --- | --- |
| 枚举菜单 | 6 个主菜单、84 条命令，含 id 与可用性 |
| 执行 `Fit to Screen`(209)、`Antialiasing`(132) | 画面随之变化 |
| 点击面板样式按钮 `Space-filling` | 渲染切换为空间填充 |
| `Powder Diffraction Pattern`(163) → 点 `Calculate` | VESTA 实际算出衍射图（峰强 + 布拉格位置） |
| 抓窗口 / 抓对话框 | 860×728、640×480 PNG，图像已核对 |

### 尚未打通

- **`Export Raster Image`(104) 的最终落盘**：能打开系统的“保存”对话框、能列出并点击「保存(&S)」，但 VESTA 没写出文件——文件名输入框（`Edit#1001`）写入后未生效，下一步要试 `CDM_SETCONTROLTEXT` 或对文件名 ComboBox 用 UI Automation 的 `ValuePattern`。
- **复杂对话框的参数映射**：每个 VESTA 对话框的控件 id 不统一（`wxWindowNR#-31949` 这类负数 id 是 wx 自己生成的），需要逐个摸一遍才能写成语义化的高层工具（如「按 2θ=10–80° 出图」）。

## MCP 服务器

```bash
node mcp/server.js                 # 默认 VESTA 路径
VESTA_EXE=<VESTA 安装目录>/VESTA.exe node mcp/server.js
node test/smoke.mjs                # 零依赖冒烟测试
```

客户端配置见 [`examples/`](examples/claude-desktop.json)。MCP 侧目前只暴露 `vesta_open` / `vesta_info`（Win32 控制未搬过去——它依赖 PowerShell 与桌面会话，跨平台意义不大）。

## DSH 原生插件配置

```yaml
config:
  executable: '<VESTA 安装目录>/VESTA.exe'   # 换安装位置改这里；VESTA_EXE 环境变量优先
  maxFiles: 10
```

## 边界

- **只驱动界面，不重写 VESTA。** VESTA 闭源（LICENSE 明说源码不开放，且 space group / Wyckoff 表禁止再分发），所以「自己实现 VESTA 全部功能」不现实；这里做的是**驱动真 VESTA**——它的计算（粉末衍射、结构因子、Madelung、等效位置…）都是它自己算的。
- 控制依赖**当前桌面会话**：需要 VESTA 窗口在本机可见会话里；远程/无头环境不可用。
- 一次只驱动一个实例；窗口被其它窗口完全遮挡时抓图仍可，但 `BM_CLICK` 对某些自绘控件可能无效。
- 打开是 `detached + unref` 的独立进程：窗口活过会话与插件重载。
- 入参校验是自带的（`ctx.tools.register` 不校验模型入参），只覆盖本包用到的 JSON Schema 子集。

## 为什么这么写

插件以 `link:` 装进 profile，bare specifier 解析不到 profile 的 `node_modules`，所以不 import 任何 `@deepseek-ai/*`，只依赖 `node:` 内置模块；`ctx.tools.register()` 接受 registry-ready 的普通对象。

## 用真实 VASP 任务自检

一个跑完的静态计算目录（如 `latticefine_C2_a2p464_k25`）可以直接当 fixture：

```bash
node test/volume.test.mjs                                   # 解析层单元测试
node scripts/make-viewer-gl.mjs <任务目录>/POSCAR --repeat 3,3,1 --out 看结构.html
```

可核对的三件事：POSCAR 与 CONTCAR 的分数坐标（静态计算应当只差浮点误差）、
OUTCAR 末个 `free energy TOTEN` 与 OSZICAR 末行 `F=` 是否一致、以及 `EDIFF` 收敛标记。

> **CHGCAR 为空不一定是跑挂**：`INCAR` 里 `LCHARG = .FALSE.` 时 VASP 会留下 0 字节的
> `CHG`/`CHGCAR`（`LWAVE = .FALSE.` 同理作用于 `WAVECAR`）。要画等值面必须改成
> `LCHARG = .TRUE.` 重跑；插件遇到 0 字节体积文件会直接给出这句提示，而不会报
> 「POSCAR 行数不足」这种误导信息。

### 真实 CHGCAR 的数值校验

以 Si-fcc 任务（`5.5`）为例，用「积分电荷 = NELECT」验证解析链：

```
CHGCAR 网格 48 × 48 × 48，晶胞体积 41.594 Å³
∫ρ dV = 8.0000 e，OUTCAR NELECT = 8 → 相对误差 0.000%
```

这条比「图看起来对」硬：它同时钉住了 ρ·V → ρ 的换算、网格点数与单位。
另外补了两条单元测试：`CHGCAR` 的 x 最快网格顺序、VASP 4 写法（无元素行）用同目录
`POTCAR` 的 `VRHFIN` 补元素。

> **CHGCAR 的负值**：总电荷密度在真空间隙出现的负值只是 FFT 噪声，查看器**不画**
> 负值面（`signed: false`）；只有 CUBE 这类可能是差密度/自旋密度的数据才画红色负值面。

## 一键自检

```bash
node scripts/selfcheck.mjs [--fixture <任务根目录>] [--keep]
```

依次跑：全部单测（9 个套件）、MCP 冒烟、以及各生成器的端到端（`make-all` / `make-compare dos|conv` /
`make-table` / `make-incar-diff`），每个生成器都在临时目录里真跑一次并检查产物。退出码 0 = 全过。

本机最近一次结果：**15/15 项通过**（40 个单测 + 5 项冒烟 + 5 个生成器）。

改了 `core.js` 或任何脚本后，跑这一条就能确认没有回归；`--keep` 会保留临时产物便于查看。

## 内部结构（重构记录）

`core.js` 里五个 `generate*` 包装函数（WebGL 查看器 / DOS / 能带 / 批量图集 / 对比图）
原先各自复制了一份「起子进程 → 收 JSON」的 Promise 块；现已合并为一个 `runNodeScript(script, args, label)`，
每个包装函数只剩参数拼装（10 行左右）。

> 重构时误删了 `parseCube` 依赖的 `Z_SYMBOLS` 常量，`node scripts/selfcheck.mjs` 立刻报
> `Z_SYMBOLS is not defined`。已补回（118 个元素），并新增一条单测断言「原子序数 → 元素符号」，
> 避免再次丢失。这也是保留自检脚本的直接收益。

## 命令行错误处理

各生成器脚本统一装了 `scripts/_friendly-errors.mjs`：未捕获异常与未处理的 Promise 拒绝都会变成**一行中文提示 + 退出码 2**，不再甩 Node 堆栈。

```
$ node scripts/make-dos.mjs Z:/nope/DOSCAR
找不到文件：Z:\nope\DOSCAR          # 退出码 2
```

巡检覆盖 13 个脚本 × {无参数, 路径不存在} 共 26 种情况：全部是单行提示，8 个原先会崩脚本已修。
单元测试：`node --test test/cli-errors.test.mjs`（4/4）断言退出码 2、含「找不到文件」、不含堆栈。

### PDOS 画图

```bash
node scripts/make-pdos.mjs <DOSCAR> [--out pdos.html] [--window 8]
```

按元素聚合，`s/p/d(/f)` 各一条曲线（实线/虚线/点线区分），图例可逐条勾选隐藏；
`ISPIN=2` 时向上为自旋向上、向下为自旋向下（镜像）。元素归属同上，取同目录 POSCAR。

**列数判别**（踩过一次坑）：DOSCAR 的 PDOS 每行是 `E` + N 列。N=3 → s,p,d；N=5 → s,p,d,f；
**N=6 → 自旋极化的 s↑ s↓ p↑ p↓ d↑ d↓**；N=8 → 再加 f 的双自旋。

合成数据验证：s 峰 −4.5、p 峰 −2.0、d 峰 +0.8（自旋向上）与 −4.4/−1.6/+1.4（向下），
镜像显示与峰位一致。真实 LORBIT=11 数据尚未到手。

### XDATCAR 的 Cartesian 帧

有的轨迹按笛卡尔坐标写帧（`Cartesian configuration= N`）。解析器现在两种都认：
遇到 Cartesian 帧会先算出晶胞矩阵的逆，再换成分数坐标，后续渲染与 Direct 帧完全一致。
错误信息也改成「没有找到任何 Direct / Cartesian configuration 帧」。

单元测试：`node --test test/xdatcar.test.mjs`（6/6，新增 Cartesian 换算与 Direct/Cartesian 混合多帧）。

### MCP 前端跟上全部工具

MCP 服务器原来只暴露 `vesta_open` / `vesta_info` 两个工具，而插件已经有 20 个——两个前端能力脱节。
现在 `mcp/server.js` 直接复用插件的工具定义：

```js
import { apply } from '../index.js'
const PLUGIN_TOOLS = (() => {
  const collected = []
  apply({ tools: { register: (d) => { collected.push(d); return () => {} } }, effect: (f) => f(), get: () => undefined }, {})
  return collected
})()
const TOOLS = PLUGIN_TOOLS.map((tool) => ({
  name: tool.name,
  title: titleOf[tool.name] ?? tool.name,
  description: tool.description,
  inputSchema: tool.parameters ?? { type: 'object', additionalProperties: true, properties: {} },
}))
```

未专门实现的老工具统一走 `callPluginTool`（把 `execute` 的结果转成 MCP 的 `content` / `structuredContent`），
`vesta_open` / `vesta_info` 仍保留专门实现以维持老客户端兼容。

实测：

```
tools/list → 20 个工具（与插件完全一致）
tools/call check_structure → "结构预检：1 个结构，0 个有 error\n未发现问题"
```

`test/mcp-parity.test.mjs` 守住这条：**MCP 的工具清单、inputSchema、描述都必须与插件逐项一致**，
插件新增工具而 MCP 没跟上（或反过来）都会红。

过程中修掉两个自己造成的问题：`titleOf` 定义在 `TOOLS` 之后导致 TDZ 报错；补丁把注释块截断。

### MCP 元信息同步

- `serverInfo.version` 直接读 `package.json`：之前硬编码 `1.0.0`，而插件早已到 2.x，客户端看到的版本是错的；
- `instructions` 之前还写着「只负责打开，不渲染、不导出图片」——在 MCP 只暴露 2 个工具时是对的，
  现在 20 个工具都可用，描述已改为按类别列出能力。

`test/mcp-parity.test.mjs` 增加一条：握手返回的版本必须等于 `package.json`，
且 instructions 不能再出现过时措辞。

**这次补丁把 `parseArgs` 的函数头吃掉了**（按字符偏移替换 600 字，越界），
`node --check` 立刻报 `Unexpected token 'else'`；已根据残留代码重建函数头并跑通冒烟。
教训：替换常量时用精确的起止锚点，不要用「起点 + 固定长度」。
