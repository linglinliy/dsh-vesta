# VESTA 交互验证：一次性提交

> 日期：2026-10-28｜执行者：DSH｜范围：M0–M5 + `VESTA-INTERACTION-REVIEW.md` 的 E0–E6
> 环境：Windows，屏幕 **1536×864**（工作区 1536×824），DPI **120**，Node **v24.22.0**
> VESTA：**3.90.9a（64-bit，Build 2026-08-08）**，`D:\VESTA-win64\VESTA.exe`，夹具 `D:\calcf\si\POSCAR`（2 原子，28 渲染）
> 证据根目录：`D:/calcf/verify/`、`D:/calcf/m-report/`、`D:/calcf/clicktest*`、`D:/calcf/m0*`

## 0. 一句话结论

**静态与命令类操作全部可用**（样式、缩放、边界、删原子、去对称、另存工程、导出真 PNG）；
**唯一无法通过的是“选中原子 → 隐藏 → 恢复”**：32 组受控试次（8 个工具模式 × 4 种点击时序）下，点击原子对画面产生 **0.0000** 变化，而同批次正对照分别为 **13.33%**（投递缩放）与 **73.55%**（真实点击菜单），证明捕获灵敏、真实输入可达——**问题收敛在 VESTA 对“点原子”的响应语义**。

## 1. 验证矩阵

| 编号 | 验证项 | 结果 | 证据 |
|---|---|---|---|
| E1 | 几何/DPI/画布测量 | ✅ | `window 10,10,1200,760`、`dpi=120`、`canvas 905×474 @ (295,113)`（`trials.json` 的 `phase=E1`） |
| PC1 | 捕获灵敏度正对照（投递 Zoom In） | ✅ **13.33%** | `phase=PC1` |
| PC2 | 真实输入可达性正对照（点击菜单） | ✅ **73.55%** | `phase=PC2` |
| E2 | 8 模式 × 4 时序点击原子 | ❌ 全 **0.0000** | 32 条 `phase=E2`，`diffLocal=0, diffFull=0, hitInside=true` |
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
