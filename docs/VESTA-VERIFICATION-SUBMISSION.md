# VESTA 交互验证：一次性提交

> 最新复核（2026-10-30）：[VESTA-LATEST-REVIEW.md](VESTA-LATEST-REVIEW.md)。选中及局部变淡/恢复已有截图证据；E3 当前实际投递主窗口，尚不能推断后台画布能力；E4 自动成功判据与 PNG 完整解码仍需补齐。以下各轮报告保留为历史，冲突状态以最新复核为准。

> **第二轮复核入口**：[VESTA-VERIFICATION-REVIEW.md](VESTA-VERIFICATION-REVIEW.md)。已有 PNG 产物已独立查看并确认可显示；PC2 的对应截图为 DSH 界面，不能证明 VESTA 菜单输入可达。均分工具条未证明八种模式，命中画布未证明命中原子；E1 清单还存在 BOM 解析失败。下文保留 DSH 原始提交，结论与证据边界以第二轮复核为准。复核未重新运行 GUI。

> 日期：2026-10-28｜执行者：DSH｜范围：M0–M5 + `VESTA-INTERACTION-REVIEW.md` 的 E0–E6
> 环境：Windows，屏幕 **1536×864**（工作区 1536×824），DPI **120**，Node **v24.22.0**
> VESTA：**3.90.9a（64-bit，Build 2026-08-08）**，`D:\VESTA-win64\VESTA.exe`，夹具 `D:\calcf\si\POSCAR`（2 原子，28 渲染）
> 证据根目录：`D:/calcf/verify/`、`D:/calcf/m-report/`、`D:/calcf/clicktest*`、`D:/calcf/m0*`

## 0. 一句话结论

**第三轮（2026-10-29）：找到根因，结论翻转。**

- **根因：工具侧 DPI 虚拟化**。PowerShell 未声明 DPI 感知时拿到的是逻辑像素，而截图与鼠标用的是物理像素；本机 120 DPI 下差 **1.25 倍**（窗口 `1550×838` vs `1938×1048`，画布 `1255×553` vs `1569×691`）。此前“点原子无反馈”的 32 次试次，点击位置整体偏了约 25%，根本没落在球上。
- **修正后（宿主/脚本统一声明 Per-Monitor DPI）**：选中**成功**——单击球出现黄色 ⊕ 标记（局部黄色像素 `0 → 669`）；文本区输出 `Atom: 2 Si2 Si 1.25000 0.25000 0.25000`、`Bond: l(Si1-Si2) = 2.35169(0) Å`；状态栏输出 `Si2 ( Si ) 1.25000 0.25000 0.25000 Occ.=1.000`。
- **E4 隐藏/恢复通过**：选中后 `Del` 使该球变为半透明（隐藏），`Esc` 后恢复为实体；结构行数始终 **2**，未被修改。
- **撤回**：P1“点击原子无反馈”、P7“状态栏不可读、Text Area 不记录拾取”均由 DPI 坐标错误导致，不成立；PC1/PC2 两个正对照仍作废（屏幕捕获未校验归属）。

**仍未知**：左栏 8 个候选位置各自对应哪个语义模式（选择行为已可用，但模式名未确认）。

## 0.1 当前能力表（唯一权威，2026-10-30）

> 其余章节按日期保留为历史记录；与本节冲突时以本节为准。状态机读副本见 `docs/capability-status.json`。

| 能力 | 状态 | 依据（runId / 证据） | 限制 |
|---|---|---|---|
| DPI 感知观测（物理像素） | supported | `2026-10-29T15-15-35` | 宿主/脚本启动时声明；失败不得当成功 |
| 前台真实点击选中球 | supported | `2026-10-30T06-53-28-2icn`（passed） | 需 Select 模式 + 目标无遮挡 |
| 后台消息选中球（向画布投递） | supported | `D:/calcf/verify/e3/e3b.json`（黄色 0→880，PostMessage=True） | 必须是 `wxGLCanvas` 句柄 + 客户端坐标 |
| 读取选中身份（Atom/Bond/状态栏） | supported | 同 e4 runId | 文本区可能滚动，需按“本次新增行”判定 |
| Del 使目标变淡（faded） | supported | `e4-verify` effectVerified，区域差异 0.1476 | **未验证“完全不可见”** |
| Esc 恢复到操作前画面 | supported | `restorationVerified`，区域差异 0 | 仅验证本次单目标场景；已有隐藏对象未测 |
| 结构不变 | supported | 完整快照（位点行+晶胞参数）一致 | 不覆盖“结构删除”类操作 |
| PNG 导出（唯一路径+哈希+尺寸） | experimental | `export-2026-10-29T15-53-50`（64,042 B，831×403，png-verified） | 尺寸来自 PNG 头，尚未做真实解码校验 |
| `vesta_interact` observe（会话+几何版本） | supported | `35524-mvuogkv5` | 几何变化后旧 session 被拒绝 |
| `vesta_interact` select（选中+身份+token） | supported | 同上（`Atom: 2 Si2 …`） | 需先处于 Select 模式（调用方一次点击切换） |
| `vesta_interact` hide（Del→faded） | supported | 同上，区域差异 0.1476 | 只证明变淡，不证明完全不可见 |
| `vesta_interact` restore（Esc→基线） | supported | 同上，区域差异 0 | 单目标、无既有隐藏对象 |
| 候选位置 → 模式语义 | unknown | `map.jsonl` | 只知 3/4 可选中，模式名称未确认 |

## 1. 验证矩阵

| 编号 | 验证项 | 结果 | 证据 |
|---|---|---|---|
| E1 | 几何/DPI/画布测量 | ✅ | `window 10,10,1200,760`、`dpi=120`、`canvas 905×474 @ (295,113)`（`trials.json` 的 `phase=E1`） |
| PC1 | 捕获灵敏度正对照（投递 Zoom In） | ⚠️ **作废** | 屏幕捕获未校验前台归属，可能是 DSH 界面变化 |
| PC2 | 真实输入可达性正对照（点击菜单） | ❌ **无效** | 点击点 `(6,70)` 在 VESTA 窗口外，`pc-menu-after.png` 是 DSH 界面 |
| E2 | 32 次**候选位置**点击（4 种时序） | ❌ 全 **0.0000** | 32 条 `phase=E2`；位置为截图估算，语义未知；`hitInside=true` 只证明命中画布 |
| E3 | 后台消息替代真实输入 | ⛔ 阻塞 | E2 无成功基线，按复核 §4 不执行 |
| E4 | 选中后图形区 Delete 隐藏 | ⛔ 阻塞 | 同上 |
| E5 | 隐藏恢复与重复 | ⛔ 阻塞 | 同上 |
| E6 | 泛化（多标签/几何/遮挡） | ◐ 部分 | 多标签 ✅（`cod-9006316.cif`，`Fd-3m 8.33³`）；最大化越界 `-7,-7 1550×838`；单实例瞬态第二进程 |
| S1 | 样式切换 139–143 | ✅ | Space-filling **29.41%**、Polyhedral 16.58%、Wireframe 8.13%、还原 **0.00%** |
| S2 | 缩放 5137 / 209 | ✅ | Zoom In ×3 **15.93%**，Fit 还原 **0.00%** |
| S3 | 边界显示 `[0,1]³↔[0,2]³` | ✅ | 渲染 **28 ↔ 81**，结构恒 **2 原子** |
| S4 | Edit Data 删原子 | ✅ | **2 → 1**，含删前/删后行数独立比对 |
| S5 | Remove symmetry | ✅ | `Fd-3m`（3 位点）→ `P 1`（**56 原子**） |
| S6 | Save As 到指定路径 | ✅ | `uia-final.vesta` 4172 字节，`#VESTA_FORMAT_VERSION 3.5.4` + `CELLP/STRUC` |
| S7 | 导出真 PNG | ✅ | `export-real-png.png` **109,083 字节**，头 `89504E470D0A1A0A`，**1131×593** |

## 2. 问题清单（一次性提交）

### P1 点击原子无任何视觉反馈（未解决，但已收敛）

- **现象**：8 个工具模式 × 单击 40ms / 单击保持 200ms / 双击间隔 60ms / 双击间隔 120ms，共 **32 次**，`diffLocal` 与 `diffFull` 全部为 **0.0000**，黄色像素前后均为 0。
- **已排除**（同批次受控对照）：
  - 坐标错：`hitInside=true`，`WindowFromPoint` 命中画布 hwnd；
  - 捕获不灵：PC1 投递 Zoom In 得 **13.33%**；
  - 真实输入不可达：PC2 真实点击菜单得 **73.55%**；
  - 窗口不在前台：每次点击前 `SetForegroundWindow`，宿主回报 `fgIsTarget=true`；
  - 输入结构体错误：改用 `SetCursorPos` + `mouse_event`（不经过 `INPUT`），仍为 0。
- **仍未确定**：是“该版本不把左键点击当选择”（例如需要 Select 工具的确切入口），还是“选择的视觉反馈不在这条路径上”。
- **证据**：`D:/calcf/verify/2026-10-28T13-05-24/trials.json`、`manifest.json`、`summary.md`

### P2 工具模式确实会切换，但无法证明切换到了 Select

- **现象**：点左栏图标后把鼠标移出左栏，左栏区域哈希仍改变（`EEC7C832 → 30974C84`）。
- **真实原因**：哈希只证明**画面状态**变化，不能给出模式语义；wxToolBar 自绘、8 个按钮 `idCommand` 全为 0，`TB_GETITEMRECT` 亦全 0，没有语义出口。
- **状态**：未解决；需要工具提示/可访问名称或“对已知球的行为”交叉验证，而后者被 P1 阻塞。

### P3 文件对话框（DirectUI）不接受消息式写入，只能用真实键盘

- **现象**：`WM_SETTEXT` 与 `WM_CHAR` 写入文件名均无效；保存仍用默认名/默认路径。
- **真实原因**：Windows 新版 DirectUI 文件对话框（`DirectUIHWND`/`DUIViewWndClassName`）不接受投递消息。
- **有效路径**：真实点击文件名框 → `Ctrl+A` → **`SendInput` + `KEYEVENTF_UNICODE`** 键入 → `Enter`，实测 `typed=35/35` 成功。
- **证据**：`uia-final.vesta`；`D:/calcf/verify/export-png2.json`

### P4 `SendInput` 返回 0 的真因是 `INPUT` 结构体尺寸不对（本机 x64 应为 40 字节）

- **现象**：`SendInput` 返回 0，`GetLastError=87`。
- **真实原因**：自写结构体实际 **48 字节**（`Marshal.SizeOf` 实测），系统按 `cbSize` 校验直接拒绝。
- **注意**：40 是**本机 x64 实测值**，不是跨架构常量；跨架构应校验 `cbSize` 与偏移。
- **状态**：已修正并验证（键盘键入成功）。

### P5 `SendMessage(WM_COMMAND)` 打开模态对话框会阻塞调用线程

- **现象**：脚本用 `SendMessage` 触发另存为时整段卡死，直到对话框关闭。
- **真实原因**：同步消息等待目标窗口过程返回，而模态循环在其内部。
- **有效路径**：`PostMessage`；生产代码的 `Cmd`/`ClickPost` **本来就是 `PostMessage`**，阻塞只发生在实验脚本。

### P6 导出 PNG 需要完整状态机，且格式下拉框必须用“真实点击 + 键盘”选择

- **现象 1**：用 `CB_SETCURSEL` + `WM_COMMAND` 选 PNG 无效——该下拉框 `GetDlgCtrlID` 返回 **0**，`CBN_SELCHANGE` 通知不到宿主。
- **现象 2**：只改扩展名不改格式，导出的 `.png` 实际是 **TIFF**（头 `4D4D002A`）。
- **有效路径**（实测通过）：
  1. `PostMessage WM_COMMAND(104)` → 对话框 `Export Raster Image`；
  2. **真实点击**格式下拉框（10 项，默认 index 9 = TIFF）→ `Home` + `Down×4` → `Enter`，`CB_GETCURSEL` 确认 **cur=4 (PNG)**；
  3. 真实点击文件名框 → `Ctrl+A` → Unicode 键入路径 → `Enter`；
  4. 后续 `Export Graphics` → OK；`确认另存为` → 是；`Export image` → OK；
  5. 校验：头 `89504E470D0A1A0A`、尺寸 **1131×593**。
- **证据**：`D:/calcf/verify/export-real-png.png`、`export-png2.json`

### P7 状态栏定位不到，`Atom:` 读数不可用

- **现象**：1200×760 与最大化（1550×838）两种几何下抓窗口底部条带，只见文本区表头，无状态栏。
- **结论**：**不能**把“状态栏读身份”作为实现路径；此前见过的 `Atom:` 行来源存疑（可能属于 Text Area 输出）。

### P8 窗口几何的三个陷阱

- **越界**：屏幕 1536×864，最大化后窗口 `-7,-7 1550×838`（宽出 14px、左上为负）；
- **裁切**：默认 `1280×900` 超过工作区 824，底部被裁；
- **判据**：负坐标也可能来自最大化外扩/多显示器，不能一律当“窗口失效”。

### P9 单实例转交会短暂出现第二个进程

- **现象**：`openFiles` 后 `findRunningVesta()` 曾同时返回 `pid=1796` 与 `pid=3976`（空标题），数秒后 3976 自动退出。
- **结论**：不是多窗口；按 PID 计数判多窗口会误判，需排除空标题/短生命周期进程。

### P10 测试基础设施的两个坑

- **MCP 一致性测试**：`spawnSync('node', …)` 依赖 PATH，精简 PATH 下 3 项全红；改 `process.execPath` 后 **3/3 通过**。
- **脚本化改 `core.js`**：函数体替换后遗留多余 `}`，`node --check` 立即报错；已修。

### P11 `wininfo` 首次实现是“假校验”

- **现象**：删除日志显示 `pid=?` 却继续执行，归属校验形同虚设。
- **原因**：宿主未声明 `GetWindow`、PowerShell 无法把 `out uint` 绑定到 `int`，异常被 `.catch(() => null)` 吞掉。
- **修复**：新增 `PidOf`/`GetWindow`；**拿不到归属直接抛错**，不再静默跳过。

## 3. 与复核文档的对应

| 复核要求 | 状态 | 说明 |
|---|---|---|
| §2.1 版本差异只是线索 | ✅ | 文档已改为“未复现”，不归因版本 |
| §2.2 哈希不等于 Select | ✅ | 见 P2，已写明局限 |
| §2.3 行数/黄色非充分判据 | ✅ | 改用 diff + 正对照 + 命中校验 |
| §2.4 SendInput 与 WM_SETTEXT 分开 | ✅ | 见 P3/P4，两条独立成因 |
| §2.5 坐标不夹紧、记录裁剪原点 | ◐ | 代码无夹紧；但 `shot.ps1` 仍不校验工作区、不记录裁剪原点 |
| §2.6 导出按状态识别 | ✅ | 见 P6，已按标题/控件/格式项识别并实测通过 |
| §3 P0 双击时序 / 置顶恢复 / 删除归属与复验 | ✅ | 报告第 8 节 |
| §3 P0 统一事务 | ◐ | 有命中校验与置顶还原，仍是逐动作而非单事务 |
| §3 P1 探针进正式工具入口 | ❌ | 仍是 28 个工具，无 select/hide 工具 |
| §4 E0–E6 | ◐ | E1/PC1/PC2 完成；E2 失败；E3–E5 阻塞；E6 部分 |
| §5 JSON 清单 | ✅ | `scripts/verify-vesta.mjs` 输出 `manifest.json`（含 `inputSent/selectionObserved/identityResolved/effectVerified`） |

## 4. 复现方式

```powershell
# 交互验证（E1/E2 + 正对照）
$env:VESTA_GUI_TESTS=1
node scripts/verify-vesta.mjs

# 导出真 PNG（状态机）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/vesta-export-png2.ps1 `
  -Target D:\calcf\verify\export-real-png.png -OutJson D:\calcf\verify\export-png2.json

# 回归
node --test test/tools.test.mjs test/mcp-parity.test.mjs test/tool-params.test.mjs test/docs-consistency.test.mjs test/docs.test.mjs
node scripts/selfcheck.mjs
```

## 5. 阻塞项（需要外部输入）

| 阻塞 | 需要什么 |
|---|---|
| E2 选中 | **E0 原生手动基线**：同一结构/布局，用真实键鼠点一个清楚的球，记录“哪个入口 + 什么点击方式 + 反馈长什么样” |
| E3 后台消息 | E2 成功后再替换后端 |
| E4/E5 隐藏与恢复 | 同上 |
| 身份解析 | 需要可读的选择反馈（P7 已排除状态栏路径） |

## 6. 交付状态

| 项 | 状态 |
|---|---|
| 代码与文档提交 | ✅ 本地提交 **90b0bd3**（16 个文件，+2517/-36） |
| 推送到 GitHub | ❌ 阻塞：`github.com:443` 不可达（curl 返回 `000`），`api.github.com` 正常（`200`）；`git push` 报 `Failed to connect to github.com:443` |
| 回归 | ✅ 单测 **28/28**，selfcheck **74/74** |

## 7. 第二轮复核处理（R1–R6）

| 编号 | 复核意见 | 本轮处理 |
|---|---|---|
| R1 | PC2 无效正对照 | ✅ 已撤回结论；矩阵标注 PC2❌/PC1⚠️；原因定位到点击点在窗口外 |
| R2 | 命中画布 ≠ 命中球 | ◐ 已承认；尚未实现“球面内 + 无遮挡”的判定，需保存目标标注图与坐标变换 |
| R3 | “8 个模式”未被证明 | ✅ 脚本改为**候选位置列表**（`candidateYs`），字段改为 `candidateIndex` 并注明“语义未知” |
| R4 | E1 解析失败被吞 | ✅ 新增 `scripts/verify-lib.mjs`（BOM 安全解析 + schema 校验 + infra 判定），试次文件改 JSONL 无 BOM；新增 `test/verify-lib.test.mjs` **7/7**；用旧证据复读：36 行、0 非法、geometry 正常 |
| R5 | 历史候选触发 Delete | ✅ 已移除自动 Delete；E4 改为“需先有唯一确认的选中试次，再由独立步骤执行” |
| R6 | 无隔离/失败信号 | ◐ 已加：文档绑定校验（标题须含 POSCAR）、`fgIsTarget` 逐条记录、退出码 0/1/2、顶层 `try/finally` 清理宿主、相对模块导入；**未完成**：专用临时副本、完整产物 SHA-256 绑定 |

### 7.1 仍未做的（按复核 §5 排序）

1. 全窗口（PrintWindow）取证 + 主窗口/菜单可见性校验，替换屏幕捕获；
2. 单个无遮挡球的坐标核对（保存标注图），再谈“命中球面”；
3. E0 原生选择基线（需一次示范）；
4. PNG 导出脚本的 PID/owner 绑定、唯一输出路径、SHA-256 与解码尺寸记录；
5. 专用临时副本 + 每轮 runId 绑定的完整产物清单。

## 8. 第三轮：DPI 根因与 E4 通过（2026-10-29）

### 8.1 根因证据：同一窗口两种坐标

| 进程 DPI 声明 | 主窗口 | 画布 |
|---|---|---|
| 未声明（默认） | `-7,-7 1550×838` | `278,95 1255×553` |
| Per-Monitor（`SetProcessDpiAwareness(2)`） | `-9,-9 1938×1048` | `347,119 **1569×691**` |

比值 **1938/1550 = 1.2503**、**1569/1255 = 1.2502**，即 120/96。
修正后宿主 `rect` 返回物理像素（`-9,-9 1938×1048`），与鼠标/截图坐标系一致。

### 8.2 选中与身份读取（修正后实测）

- 单击球：局部黄色像素 **0 → 669**（`D:/calcf/verify/e4/e4-before.png` / `e4-selected.png`）；
- 文本区：`Atom:  2  Si2  Si   1.25000   0.25000   0.25000  ( 1  0  0)+ x, y, z`；
- 文本区：`Bond: l(Si1-Si2) =  2.35169(0) Å`；
- 状态栏：`Si2 ( Si ) 1.25000 0.25000 0.25000 Occ.=1.000 1a 1`。

### 8.3 E4：隐藏与恢复

| 步骤 | 画面 | 结构 |
|---|---|---|
| 选中 | 黄色 ⊕ 标记 | 2 行 |
| `Del` | 该球变半透明（隐藏） | 2 行（未变） |
| `Esc` | 恢复实体 | 2 行 |

图像差异：选中→Del **0.0014**、Del→Esc **0.0010**、选中→Esc **0.0014**；
证据：`D:/calcf/verify/e4/e4-1-selected.png`、`e4-2-after-del.png`、`e4-3-after-esc.png`、`e4-manifest.json`。

### 8.4 问题状态更新

| 原编号 | 原结论 | 更新 |
|---|---|---|
| P1 | 点击原子无反馈（未解决） | ❌ **撤回**：根因是 DPI 坐标差 1.25，修正后选中正常 |
| P2 | 无法证明切到 Select | ◐ 选择行为已可用；模式名仍未确认 |
| P7 | 状态栏不可读 | ❌ **撤回**：状态栏与文本区都能读到选中信息 |
| PC1/PC2 | 正对照 | ❌ 仍作废（屏幕捕获未校验归属） |

## 9. 第四轮：剩余项验证（2026-10-29 深夜）

### 9.1 PC1 正对照重做（PrintWindow，不依赖屏幕未被遮挡）

- 动作：`WM_COMMAND 5137`（Zoom In）**×3**，前后各用 `captureFullWindow`（PrintWindow）抓整窗；
- 结果：`ink 0.1406 → 0.1615`，整窗差异 **7.32%**，结论 **capture-sensitive-confirmed**；
- 证据：`D:/calcf/verify/pc1/pc1-manifest.json`、`pc1-before.png`、`pc1-after.png`；
- 说明：这是**有效**正对照（不依赖前台/遮挡），与已作废的 PC2 不同。

### 9.2 候选位置 → 选中能力（部分可判）

每次先尝试清空状态，再点候选图标、单击检测到的球、量黄色像素：

| 候选 | y | 清空后黄色 | 点击后 | 判定 |
|---|---|---|---|---|
| 0 | 126 | 669 | 669 | 状态未清掉，**不确定** |
| 1 | 186 | 669 | 669 | 不确定 |
| 2 | 236 | 669 | 669 | 不确定 |
| 3 | 281 | 0 | **669** | ✅ 具备选中能力 |
| 4 | 326 | 0 | **669** | ✅ 具备选中能力 |
| 5 | 371 | 0 | 0 | ❌ 不产生选中 |
| 6 | 416 | 0 | 0 | ❌ 不产生选中 |
| 7 | 461 | 0 | 0 | ❌ 不产生选中 |

- 证据：`D:/calcf/verify/map/map.jsonl`、`cand3.png`、`cand4.png`；
- 限制：**无法可靠清除已有选中状态**（见 P12），前三个候选无法从干净状态判定。

### 9.3 PNG 导出：唯一路径 + SHA-256 + 解码尺寸（端到端自动）

`scripts/export-png.mjs` 分工：PS 只做保存对话框（选 PNG + 填路径 + 回车），后续对话框由 Node 点击。

最近一次运行（`D:/calcf/verify/export-2026-10-29T15-53-50/`）：

| 项 | 值 |
|---|---|
| 后续对话框 | `Export image:OK`、`Export Graphics:OK` ×3 |
| 文件 | `export.png`，**64,042 字节** |
| 签名 | `89504E470D0A1A0A`（PNG） |
| 解码尺寸 | **831×403** |
| SHA-256 | `cfc065c8d0ce802caeafba436c413351503a6ad3b5cc1bcb44dcaf549e5a2122` |
| 结论 | **png-verified** |

### 9.4 本轮新发现的问题

#### P12 选中状态无法可靠清除（阻塞候选映射的前半段）

- 尝试过：点击画布空白处、投递 `Esc`；两者都不能把已有选中标记清掉（`yellowBefore` 仍为 669）；
- 影响：候选 0–2 是否具备选中能力**无法判定**；
- 可能原因：VESTA 的取消选择需要特定入口（如 Select 工具下点空白、或菜单命令），尚未定位。
- 补充尝试（2026-10-30 00:20）：真实 `Esc`、画布空白处单击、空白处双击——该次窗口处于**最大化**状态，候选图标坐标失效、连“选中”本身都没成功（`yellow=0`），因此**这组尝试不可作为结论**，只说明脚本必须固定窗口几何后再测；
- 另经菜单枚举确认：VESTA 菜单里**没有**含 `select` 的命令项（`含 select 的菜单项: 0`），无法用菜单代替取消选择。

#### P13 PS 内部枚举后续对话框按钮失败

- 现象：PS 里 `Find('Export image')` 找到窗口后，`Buttons()` 枚举不到 `OK`；日志 `no-button in <hwnd>`；
- 原因：找到的是外层包装窗口，`OK` 在其子窗口链更深处；同一时刻 Node 的 `listControls` 能枚举到；
- 处理：后续对话框改由 Node 侧 `dismissFollowups()` 处理，PS 只负责保存框。

#### P14 按钮文本带行尾符导致匹配失败

- 现象：`^OK$` 匹配不到 `OK`；
- 原因：`GetWindowText` 结果带 `\r`；
- 处理：`([string]$parts[1]).Trim()` 后再比较（PS 侧已修）。

#### P16 `checks-doc` 测试假设 LF，遇到 CRLF 误报

- 现象：`selfcheck` 报 `checks-doc.test.mjs` 失败，错误为“找不到 inspectTask”，但 `core.js` 里该函数确实存在；
- 原因：测试用 `text.indexOf('\n}\n', start)` 找函数结尾，而文件是 **CRLF**，匹配不到；
- 处理：读取后先 `.replace(/\r\n/g, '\n')` 再切分；修复后 `checks-doc` **2/2**、selfcheck **75/75**。

#### P15 导出日志 JSON 带 BOM

- 现象：Node `JSON.parse` 报 `Unexpected token \uFEFF`；
- 处理：读取后 `.replace(/^\uFEFF/, '')`；已在 `export-png.mjs` 落地。

### 9.5 状态汇总（本轮后）

| 项 | 状态 |
|---|---|
| 选中原子（单击/双击） | ✅ 实测可选中，出现黄色 ⊕ |
| 身份读取 | ✅ `Atom:` / `Bond:` / 状态栏均可读 |
| E4 隐藏 + 恢复 | ✅ `Del` 变半透明、`Esc` 恢复，结构不变 |
| PC1 捕获灵敏度 | ✅ PrintWindow 下 7.32% |
| 候选→模式映射 | ◐ 3/4 可选中；5–7 不可；0–2 因状态清不掉未定 |
| PNG 导出 | ✅ 唯一路径 + SHA-256 + 尺寸，自动完成 |
| 后台消息（E3） | ⛔ 未测（需 E2 基线，现已具备，可下一轮做） |

### 9.6 E3：后台消息 vs 真实点击（同一目标、同一模式）

候选 3（已验证具备选中能力）下，对同一个球分别用两种方式点击：

| 方式 | 黄色像素 | 结论 |
|---|---|---|
| 后台投递 `WM_LBUTTONDOWN/UP` 到画布 | `0 → 0` | ❌ 不产生选中 |
| 真实鼠标点击（`SetCursorPos` + `mouse_event`） | `0 → 669` | ✅ 选中 |

- 证据：`D:/calcf/verify/e3/e3.json`；
- **2026-10-30 修正（原结论作废）**：上一版脚本把消息投递给了**根窗口**而不是画布（`PostedClick($h, …)`，`$h` 是根窗口），所以“后台无效”是投错句柄造成的假结论。
- 修正后（向 `wxGLCanvas` hwnd=8528002 投递客户端坐标 238,325）：`PostMessage` 的 down/up 均返回 True，黄色像素 **0 → 880**；随后真实点击 880 → 880（已选中，无变化）。
- 新结论：**后台投递在画布上可以完成选中**，前提是句柄必须是 `wxGLCanvas`、坐标必须是客户端坐标、且当前处于 Select 模式。
- 证据：`D:/calcf/verify/e3/e3b.json`、`e3-after-posted.png`。

## 10. 工作包 1 交付（按 VESTA-LATEST-REVIEW N1/N2/N4）

### 10.1 E3：投递目标修正

- `scripts/vesta-e3-background.ps1`：`Layout` 现在返回 **canvasHwnd**；投递走 `ScreenToClient(canvas)` 一次换算后 `PostMessage(canvas, …)`；
- 记录：根/画布/工具栏的 hwnd、类名、PID、可见性、矩形；`postMove/postDown/postUp` 返回值；前台状态；
- 结果见 §9.6 修正：后台投递**可以**选中，旧结论作废。

### 10.2 E4：判定器重写 + 反例

- 新增 `scripts/e4-lib.mjs`：`structureSnapshot`/`structureEqual`/`newAtomLines`/`e4Verdict`，**纯函数**；
- 新增 `test/e4-lib.test.mjs` **7/7**：历史 Atom 行不算选中、不发 Del 必失败、区域无变化必失败、结构按完整字段比较、恢复差异过大判失败；
- `scripts/e4-verify.mjs`：先探测“哪个工具栏位置具备选中能力”（逐个候选点 → 点球 → 看是否新增 Atom 行），再在同一事务里选中→截图→Del→截图→Esc→截图→判定；
- 截图改用 `scripts/capture-window.ps1`：**只 PrintWindow，不恢复/不移动/不置前**，坐标不再失效；
- 恢复基线改为“选中前画面”，因为 Esc 会连黄色标记一起清掉；
- 退出码：0 全部成立 / 1 有判定为假 / 2 基础设施失败。

### 10.3 实跑结果

| 场景 | 命令 | 结果 |
|---|---|---|
| 正例 | `node scripts/e4-verify.mjs` | **passed**（selectionObserved/identityResolved/effectVerified/restorationVerified/structureUnchanged 全 true；区域差异 0.1476；恢复 0） |
| 反例（不发 Del） | `node scripts/e4-verify.mjs --skip-del` | **failed**（`effectVerified:false`，exit 1）——证明判据不会假阳性 |

- 证据：`D:/calcf/verify/e4-2026-10-30T06-53-28-2icn/`、`e4-2026-10-30T06-55-34-gmmu/`。

### 10.4 仍未解决

| 项 | 说明 |
|---|---|
| “完全不可见” | 现在只证明“变淡（faded）”，未验证渲染中完全不可见（N3） |
| 已有隐藏对象时的 Esc 范围 | 未测（N3） |
| 真实图像解码 | PNG 校验仍只读文件头，未做像素解码（N5） |
| 正式工具入口 | `index.js` 尚未接入 observe/select/hide（N6 之后的 §3） |
| 混合 DPI / 遮挡回退 | 未测（N4 的屏幕回退路径） |

## 11. 工作包 3：正式工具入口 `vesta_interact`（2026-10-30）

### 11.1 接口

| action | 参数 | 返回 |
|---|---|---|
| `observe` | `pid?` | `sessionId`、`geometryRevision`、`canvasRect`、`document`、结构行数/晶胞 |
| `select` | `sessionId`、`x?`、`y?` | `point`、`selectionToken`、`identityLine`（本次新增 Atom 行） |
| `hide` | `sessionId`、`selectionToken` | `effect`（faded/unknown）、`regionDiff`、`structure.unchanged` |
| `restore` | `sessionId`、`selectionToken` | `restored`、`regionDiff`（对选中前基线） |

- 实现：`interact.js`（会话表 + 几何版本 + token）；工具定义在 `index.js`（`vesta_interact`）；
- 工具总数 28 → **29**，MCP 自述、README、PROJECT、COVERAGE、tools 测试已同步；
- 几何一变，旧 `sessionId`/`selectionToken` 会被拒绝（`staleObservation`）。

### 11.2 实跑（同一进程内连续四次工具调用）

| 步骤 | 结果 |
|---|---|
| observe | `sessionId=35524-mvuogkv5`，画布 881×518，几何版本 `ae68f445c41c59d3` |
| select | `point=(238,325)`，身份 `Atom: 2 Si2 Si 1.25000 0.25000 -0.75000 (1 0 -1)`，token 生成 |
| hide | `effect=faded`，区域差异 **0.1476**，结构 **未变** |
| restore | `restored=true`，区域差异 **0** |

- 证据：`D:/calcf/verify/tool-workflow2.mjs` 的输出（本机终端）与临时截图目录。

### 11.3 已知限制（诚实边界）

1. **Select 模式需调用方切换**：工具不遍历工具栏猜模式（探测会误点 Properties 等按钮而卡住），所以工作流里先做一次显式点击；
2. `hide` 的语义是 **faded（变淡）**，不是“渲染中完全不可见”；
3. `restore` 只验证本次单目标、且事先没有隐藏对象；
4. `select` 的自动取球依赖屏幕抓取（需要窗口在前台），显式 `x/y` 更稳。

### 11.4 本轮新遇到的问题

#### P17 被杀掉的任务会留下常驻宿主，阻塞后续调用

- 现象：`job_kill` 之后新的工具调用在 `observe` 阶段直接卡住，无输出；
- 原因：`core` 的常驻 PowerShell 宿主（stdin/stdout 管道）属于被杀的 node 进程，孤儿宿主仍占着资源；新进程再次启动宿主时被拖慢/阻塞；
- 处理：清理孤儿 `powershell` 进程后恢复正常（**注意不要用 `Get-Process node | Kill`**，会把正在跑的命令一起杀掉，本轮已踩过一次）；
- 建议：所有 GUI 脚本在 `finally` 里调用 `stopUiHost()`，任务被杀时至少让宿主进程随父进程退出。

#### P18 `select` 的基线截图时序错误

- 现象：`restore` 一直 `restored=false`（区域差异 0.1399）；
- 原因：基线截图拍在了**点击之后**，带黄色选中标记；而 Esc 后标记消失，两者必然不同；
- 处理：基线移到点击前，恢复差异变为 **0**。
