# 更新记录

本项目在本地以 `2.x` 系列迭代过（内部开发版），**首次公开**从 `0.0.1` 重新开始编号。

## 0.0.2 — 2026-10-28（首个公开汇总版）

> 内部迭代构建号 0.0.2-internal–0.0.42 从未公开发布，全部汇总为本版；下文按当初构建号保留，便于追溯。

### 能力
- **VESTA 联动**：菜单命令（100 条）枚举与执行、对话框按标签填值、按钮/确认框投递点击；
  晶胞变换整链（`vesta_control(transform-cell)`）、结构层删原子（`delete-atom`）、
  固定几何自校验截图（`captureFullWindow`）。
- **结构处理**：POSCAR/CIF 读写、超胞、按空间群展开/约化、对称化、晶胞参数与分数坐标改写、
  元素替换、Wyckoff 位点归属、CIF 生成、结构 SVG/投影。
- **VASP 后处理**：OUTCAR/DOSCAR/EIGENVAL/CHGCAR 解析与体检、DOS/能带/PDOS、
  体积切片/剖面/峰搜索/∇²ρ、Bader 近似电荷、功函数、粉末衍射。

### 明确做不到（详见 docs/OFFICIAL-FEATURES.md）
- 画布点选/框选/拖拽旋转：本环境 `SendInput` 被系统拒绝（返回 0），只能人工点击；
- 左栏 wxToolBar 工具切换：自绘工具条，无命令 id、无按钮矩形；
- 状态栏与 wx 输入框取值：`SB_GETTEXT` / `WM_GETTEXT` 均返回空；
- 晶体形貌、体积数据算术/按物理量着色、结构因子与 Madelung 等计算未封装。

## 0.0.42 — 2026-10-27

- **纠错**：`wxDataView` 的行选中**不需要真实点击**。0.0.41 的失败是因为挑到了 `visible=false` 的隐藏表（6 个表里 5 个隐藏）。
- `deleteAtomInVesta` 改为**纯投递**（`clickat` 选行 + `clickpost` 点 Delete/Apply/OK），不再使用任何真实键鼠。
- 实测：同一窗口 16 → 15 → 14 → **13**，晶胞 `7.68059³` 不变；三个角度截图验证。
- 文档补对照实验表（投递 / 移动光标 / SendMessage / 投递按键 四种策略均可选中）。
## 0.0.41 — 2026-10-27

- **PostMessage 优先 / SendInput 兜底的边界摸清**：菜单、按钮、模态确认、对话框数值输入、提交全部可以纯消息完成；
  唯一必须真点击的是 `wxDataView`（原子列表）的**行选中**。
- 新增核心 `deleteAtomInVesta(pid, {row})` 与工具动作 `vesta_control(action="delete-atom", row=…)`：
  按 visible 过滤表格 → 真实点击选行（截图哈希自校验）→ 投递 Delete → &Apply / &OK。
- 新增宿主动作 `realclickat`（控件内坐标真点击，自动保存/还原光标与前台）与 `rect`（控件矩形+可见性）。
- 实测：同一窗口 pid=5744，扩胞到 7.68059³（2 位点）后删一行 → 位点 2→1；窗口保持打开。
- 新增 	est/gui-delete.test.mjs（真机用例，需 VESTA_GUI_TESTS=1 才运行，79 s）：重新加载 POSCAR → 扩胞 → 删一行 → 断言位点数减 1。\n- 三个坑写进文档：6 个 wxDataView 里 5 个隐藏；行选中不吃 PostMessage；删空结构会关窗。
## 0.0.40 — 2026-10-27

- **后台数值输入打通**：`WM_SETTEXT` 对**可见**输入框完全有效（0.0.38 的“无效”结论是因为打到了隐藏控件——
  `Edit Data` 里 80 个 Edit 只有 29 个 visible）。整条链路纯 PostMessage：不抢前台、不动光标、不占键盘。
- **晶胞变换提交链路查明**：点 Transform OK 后会连续弹 `Warning !`（问是否继续，选**是(&Y)**）与
  `Additional lattice point(s)…`（点 OK），最后还要在 Edit Data 点 `&Apply`、`&OK`。
- 新增核心函数 `transformCellInVesta(pid, matrix)` 与工具动作 `vesta_control(action="transform-cell", matrix=…)`；
  实测 2×2×2 扩胞：VESTA 文本区写下 `Transformation from standard setting 2a,b,c` / `2a ( 1a)`，视图变 16 原子。
- 新增 `test/gui-transform.test.mjs`（真机用例，54 s，断言步骤日志与 VESTA 变换记录）。
- 文档修正：撤回 0.0.38 的两处错误结论，并说明“先按 visible 过滤控件”的教训。
## 0.0.39 — 2026-10-27

- **键鼠模拟的独立性评估**：结论是**不能独立**——必须置前、会移动真实光标、会占用键盘；
  实测单格填值 2.3 s，光标 `40,120 → 40,120`、前台窗口均已还原。
- 新增宿主动作 `saveenv` / `restoreenv`（记录并还原光标 + 前台窗口），`fillControlNumber` 与
  `fillDialogFieldsInTabOrder` 默认套用，尽量减少干扰。
- 验证两条后台路线都不可用：`PostMessage`（WM_CHAR/WM_SETTEXT/clickat）对 wx 数值框无效；
  UI Automation 全树搜到 154 个元素但 **0 个 Edit**（ValuePattern 无从下手）。
- 修一个会让宿主编译失败的 bug：新增 C# 用了 `GetCursorPos`/`GetForegroundWindow` 但漏了 `DllImport`。
## 0.0.38 — 2026-10-27

- **摸索 GUI 数值输入**：新增宿主动作 `foreground` / `chord` / `vk`，核心封装 `fillControlNumber(hwnd, value)`
  （置前 → 点两次 → Ctrl+A 和弦 → 虚拟键码逐位输入）。
- 证实：单字段能填（截图第一格 1→2、第二格 0→7，焦点逐格切换）；`WM_SETTEXT` 完全无效、SendKeys 会乱码、
  `WM_GETTEXT` 读不出 wx 字段的值。
- 未跑通：批量填 9 格矩阵时焦点错位，只有第 1 列生效，Unit Cell Transformation 没有发生（原子数仍 2）。
- 策略不变：数值需求继续「自算 + 写文件」；真点击输入作为单字段实验能力保留。
## 0.0.37 — 2026-10-27

- **修宿主进程泄漏**：热重载的 `import(core.js?rev=…)` 会造新模块实例，常驻宿主句柄只存实例里，
  导致 `stopUiHost()` 停不掉子进程、node 挂死不退。改为句柄放 `globalThis`、start/stop 每次直读全局，
  并加 `process.on(exit)` 兜底。
- 验证：`tools-smoke` 真实夹具 4/4 通过并正常退出；`tools-smoke2` 7/7；`tools-smoke4` 2 通过 1 跳过。
- 新增 `scripts/test-real-fixtures.mjs`：真实夹具套件逐个独立进程跑、每次清理 VESTA（并补进 GUIDE）。
- 记录两条教训：命令行匹配进程会匹配到自己（假阳性）；全量测试与 selfcheck 不能同时跑（都开 VESTA）。
## 0.0.36 — 2026-10-27

- **真实夹具支持环境变量**：`tools-smoke` / `tools-smoke2` / `tools-smoke4` 改为读 `VASP_FIXTURE_ROOT` /
  `VASP_ADSORPTION_ROOT`，设了就跑真实数据（原本只能跳过）。
- **修挂死**：`tools-smoke4` 真驱动 VESTA 时常驻宿主未停，node 进程一直挂着；加 `timeout: 180000` 并
  在 `finally` 里 `stopUiHost()`。修后 2 通过 / 1 跳过，不再挂。
## 0.0.35 — 2026-10-27

- **测试跑法**：全量测试改为串行（`--test-concurrency=1`）。并行时多个用例同时启动 VESTA，
  窗口/焦点/`PrintWindow`/`-export_img` 互相干扰，随机挂 1–2 条（拖拽哈希、`vesta_capture` CLI 导出 60 s 超时）。
- 结论写进 `docs/QUALITY.md`：共享全局 GUI 资源的测试不该并发；纯计算用例并行没问题。
## 0.0.34 — 2026-10-27

- **修并行测试冲突**：`tools-smoke4` 用 `taskkill /IM VESTA.exe /F`（按镜像名杀全部）清场，
  在并行全量跑时会打断别的用例的渲染，导致确定性用例 90 s 后报哈希不一致。
  改为只杀自己打开的 pid；`elements-ini` 干脆不杀（渲染进程带 `-close` 自行退出）。
- 验证：三个 VESTA 重负载套件一起跑全过；确定性用例从 90 s 失败 → 871 ms 通过。
- 顺带确认产品行为：core 的渲染/分析一直是按 pid 清理，**不会动用户自己开的 VESTA 窗口**。
## 0.0.33 — 2026-10-27

- **修测试隔离问题**：`input.test.mjs` 的拖拽用例原本复用「任意正在运行的 VESTA」，全量跑时被其它用例的
  进程开关干扰而失败。改为自己 `openFiles` 开窗口、取最新 pid、拖拽、`finally` 关掉；单文件重跑 18 s 真实通过。
- 能力冒烟 16/16：扩胞、变换矩阵、改晶胞、加/删原子、元素替换、空间群展开、对称约化、对称化+晶胞、CIF 输出、
  测量距离/角度、SVG、体数据切片、结构预检、结构查看。
## 0.0.32 — 2026-10-27

- **晶胞对称化**：`symmetrizeCell`（度规张量 G = A·Aᵀ 的 RᵀGR 平均投影 + Cholesky 还原），
  `vesta_edit` 新增 `refineCell`，与 `symmetrize` 配合把晶胞也射到对称约束上。
- 实测：完美立方/六方胞经 1/221/225/227/194 完全不变（偏差 <1e-9）；畸变 a=3.86/b=3.82/c=3.85、γ≈89.85°
  → a=b=c=3.8434、α=β=γ=90°。
- 修实现 bug：`G·R` 写成 `G·Rᵀ`（行列索引反），导致置换型操作贡献为 0、连完美立方胞都缩到 a/√3；
  用「完美晶胞必须原样不动」这条不变量才发现。deviation 也改为按平均对角元归一化（原来除 0 会爆）。
- 新增 2 条测试。
## 0.0.31 — 2026-10-27

- **工具参数自检** `test/tool-params.test.mjs`（7 条）：比对「执行体实际读的参数」与「schema 声明的参数」，
  专门守 0.0.16/0.0.30 那类「读了但没声明、additionalProperties:false 下被拒」的回归。
- 让 `localTool` 暴露 `executeSource`（原始 execute 源码）——否则工厂包装后拿不到真实执行体，静态比对无从谈起。
- 检查器同时支持解构写法 `execute({ path, out })` 与 `execute(args)`；并附**检测器自检**：
  故意构造不匹配的假定义，确认它真的会报错（否则「全部通过」毫无意义）。
- 全部 28 个工具当前无未声明参数、无死参数。
## 0.0.30 — 2026-10-27

- **显示边界 BOUND**：`readSceneBoundary` / `applySceneBoundary` + `vesta_render(boundary=…)`。
  实测四组边界产出四份不同渲染（16 374 / 8 874 / 10 318 / 8 059 非白像素）；
  范围变大时视图自动缩放，因此**像素数不能用来数原子**，文档里明确写了这一点。
- **修回归**：`vesta_render` 执行体读 `args.background`/`args.model`，但 schema 里没有它们，`additionalProperties: false`
  会让这两个参数直接被拒；现已补进 schema（连同 `boundary`），并用「背景红 → 角落像素 (255,0,0)」验证。
- 新增 2 条测试（BOUND 读写、非法边界）。
## 0.0.29 — 2026-10-27

- **文档与实现一致性审计**：新增 `test/docs-consistency.test.mjs`（8 条检查：工具数、工具存在性、
  文档覆盖、CHANGELOG 版本、COVERAGE 状态自洽、描述触发语、schema 合法性）。
- 首次运行抓到 **6 处漂移**：README 写 27 个工具、PROJECT 写 20 ×2、VESTA.md 写 27、`mcp/server.js` 写 20 ×2；
  全部改为实际的 28。
- 教训写进 `docs/QUALITY.md`：以后加工具先改代码，再跑这个测试看哪些文档没跟上。
## 0.0.28 — 2026-10-27

- **精确等值面阈值**：新增 `volumeValueAtPercent` / `volumePercentForValue` / `volumeAboveLevel`，
  `vesta_view` 增加 `isoValue` 参数（密度值 → 百分位 → 自渲染），并在摘要里写明换算过程。
- 实测：真实 CHGCAR 上分位往返 50% → 49.99%；取 90% 分位当阈值时阈值以上格点占 10.01%；
  `isoValue=0.1` → HTML `isoPercent: 36`（原始换算 35.71%）。
- 修一个小坑：`generateWebglViewer` 调用里 `isoPercent` 键重复，后一个 `undefined` 覆盖了换算结果。
- 新增 3 条测试（分位互反、阈值比例自洽、越界钳位）。
## 0.0.27 — 2026-10-27

- **元素配色与半径真正落地**：生效位置是 VESTA 的 `elements.ini`（不是 `.vesta` 的 `ATOMT`）。
  新增 `parseElementsIni` / `editElementsIni` 与工具 `vesta_style`（list / set / restore，自动备份）。
- 实测：只改 `elements.ini` 把 Si 改绿 → 绿色像素 26→**10568**、蓝色 13449→**39**；还原后回到 26 / 13449。
- 新增 `test/elements-ini.test.mjs`（6 例，含一次真实渲染验证，约 90 秒）。
- 覆盖矩阵：Preferences 类升级为 ✅（只剩对话框内精确数值不可达）。
## 0.0.26 — 2026-10-27

- **新增 `docs/COVERAGE.md` 功能覆盖总表**：27 个工具逐条列出覆盖的功能与证据；按 VESTA 面板组织
  （读取/显示/编辑/体数据/测量/导出/GUI 对话框），每条标 ✅/⚠️/❌ 并给实测数字或测试文件。
- 附「明确不可达清单」：对话框数值输入、精确等值面阈值、元素配色（`style.ini`）、`.vesta` 携带体积、
  相机持久化、最小二乘精修——每条都有实测证据与替代路径。
- 与 0.0.8 版矩阵对比：5 个 ❌ 清零（加删原子、改空间群、矢量图、Export Data、交互式测量）。
- 修正一处未经验证的断言：Madelung 能改为 ❌（菜单项不暴露标题；执行 164 无对话框也无文本输出）。
## 0.0.25 — 2026-10-27

- **WebGL 查看器占位率**：`buildScene`/`buildPeriodicScene` 原子带 `occupancy`，`make-viewer-gl` 透传到 `STRUCT`，
  查看器里半径乘 `occupancy^(1/3)`（体积∝占位率）。
- `make-viewer-gl.mjs` 现在也支持 CIF 输入（带占位率），此前只吃 POSCAR。
- 实测：γ-Fe2O3 生成的 HTML 里 `occupancy` 出现 131 次、取值 0.83333/1；headless Chrome 截图确认 56 原子正常渲染。
## 0.0.24 — 2026-10-27

- **对称化**：`symmetrizeStructure`（迭代投影：对每条操作找最近同种原子、用逆操作拉回参考系后平均）
  + `invertOperation`（3×4 对称操作求逆）；`vesta_edit` 新增 `symmetrize=<群号>`。
- 实测：金刚石加 ±0.004 噪声（最大偏离 0.0188 Å）→ 对称化后 **0.0000 Å**，与理想结构逐原子一致。
- 修：位移量原来乘了 5 凑量级（错误），改为分数坐标真实距离；默认容差 0.08 → 0.02。
- 新增 2 条测试，`test/symmetry.test.mjs` 共 13 条。
## 0.0.23 — 2026-10-27

- **占位率可视化**：`structureToSvg` 按占位率调不透明度（0.92×occ，下限 0.18）+ 虚线边框 + `occ=` 悬停提示，
  返回值新增 `partial` 计数；`vesta_vector` 支持 CIF 输入并报告部分占位数量。
- 实测 γ-Fe2O3：56 原子 / 125 键 / 16 个占位（低透明度、虚线、提示各 16 个）；满占位对照 0。
- 新增 2 条测试（占位率影响 SVG、满占位不带标记）。
## 0.0.22 — 2026-10-27

- **占位率导出**：`structureToCif` 写 `_atom_site_occupancy` 与 `_chemical_formula_sum`；
  `makeSupercell` / `transformStructure` 现在保留附加字段（以前只复制 symbol+frac，占位率会丢）。
- `vesta_edit` 写 POSCAR 时提示「N 个原子是部分占位，POSCAR 不支持占位率」。
- 实测：γ-Fe2O3 读入 16 个 0.83333 占位；扩胞 2×1×1 → 112 原子含 32 个占位；写 CIF 保留 32 行 0.8333。
- 新增 1 条测试（占位率在扩胞/矩阵/往返中保留）。
## 0.0.21 — 2026-10-27

- **修 CIF 展开少一半原子的 bug**：`spgra.dat` 对某些群只存一半操作（P21/c 只列 2 条，完整 4 条），
  导致 cod-1000000 展开出 70 而不是 140。修法：CIF 无自带 `_space_group_symop_operation_xyz` 时，
  交给 VESTA `-open x.cif -save tmp.vasp` 转换后再解析。
- 实测三个公开 CIF 全部与 VESTA 一致：140（P8 Al4 O32 H68 N8 C20）/ 64 / 56。
- `vesta_edit` 现在也支持「只给 out、不给编辑动作」的纯格式转换（CIF → POSCAR/CIF）。
- 顺手修：`applied` 变量在 CIF 分支里先用后声明（TDZ）。
## 0.0.20 — 2026-10-27

- **CIF 读取**：`parseCif`（标量标签/loop/引号/分号块/`?` 缺失值）+ `structureFromCif`（自带对称操作优先，
  否则按 IT 号回退 `spgra.dat`），每个原子保留 `occupancy`。`vesta_edit` 现在可直接吃 CIF。
- 三个真实 CIF 逼出来的坑：标准不确定度 `.55909(13)`（直接 Number 得 NaN）、多 `_atom_site` 循环要累加、
  标签 `Fe-oct` 的元素符号提取。
- 实测：γ-Fe2O3 → 56 原子（Fe24O32，16 个占位 0.833 的八面体铁）；cod-1010363 → 64 原子；cod-1000000 → 70 原子。
- 已知差异：cod-1000000 我们 70、VESTA 140（空间群设置不匹配导致只用到一半操作），下一步按符号精确匹配。
- 新增 `test/cif-read.test.mjs`（7 例）。
## 0.0.19 — 2026-10-27

- **公开测试夹具**：从 Crystallography Open Database 取 3 个真实结构（140 / 64 / 56 原子），
  CIF 与本机 VESTA 转出的 POSCAR 一起入库，来源/许可写在 `test/fixtures/public/PROVENANCE.md`。
- 网络探测：`raw.githubusercontent.com` DNS 不可达；`gh-proxy.com` / `ghproxy.net` / `ghfast.top` 可用；COD 可直连。
- 真实数据边界：`cod-9006316` 的 CIF 声明 Fe2O3，展开后是 Fe24O32（Fe3O4 比例）——占位率在转 POSCAR 时被忽略，已写成断言。
- 新增 `test/public-fixtures.test.mjs`（4 例：原子数/晶胞/组成/转 CIF 往返）。
## 0.0.18 — 2026-10-27

- **Wyckoff 字母**：`parseWyckoffTable` 读 VESTA 自带 `wyckoff.dat`（230 群）、`assignWyckoff` 解参数 + 生成轨道 + 取最小多重度；
  `vesta_edit` 约化时自动输出字母（如 `Si a(8)`）。
- 实测：225 → 4a / 4b / 192l；227 → 8a / 8b / 16c；194 → 2a / 2c，多重度与位点对称全部正确。
- 修两个坑：坐标列表不含点阵平移（227 的 8a 只两行，需 ×4 面心）；一般位置包含所有点（要取最小多重度）。
- 新增 3 条测试，`test/symmetry.test.mjs` 共 11 条。
## 0.0.17 — 2026-10-27

- **验证体积相关参数**：`.vesta` 的 `IMPORT_DENSITY` 用的是相对路径，CLI/GUI 打开都加载不到体积，
  `SURFS`/`SECTS`/`ISURF` 六种组合渲染**逐字节相同** → 场景文件这条线不通。
- **可用路径**：直接打开 CHGCAR（等值面默认开）；菜单 145/144 开关等值面与剖面；键盘 `+`/`-` 升降阈值
  （实测黄色像素 17 → 1988 → 931，哈希逐次变化）。
- 新增 `vesta_volume_display` 工具（isosurface-toggle / sections-toggle / level-up / level-down），
  动作前后自动截图比对，返回 `changed`。
## 0.0.16 — 2026-10-27

- **逐项验证 `.vesta` 显示参数**（改一处 → CLI 渲染 → 数像素）：`BKGRC`（背景）与 `STYLE/MODEL`（显示模型）**生效**；
  `ATOMT`/`BONDP` 的颜色、`ATOMP` 的半径**被忽略**（原子颜色/半径来自全局 `style.ini`）；`ATOMM` 部分生效。
- 新增 `readSceneStyle` / `applySceneStyle`（只改确实生效的两项），`vesta_render` 暴露 `background` 与 `model` 参数。
- 端到端：`vesta_render(..., background=[255,0,0])` → 渲染图角落像素实测 (255,0,0)。
- 新增 2 条测试（样式读写、参数校验），`test/scene.test.mjs` 共 8 条。
## 0.0.15 — 2026-10-27

- **交互式测量**：`structureProjection`（与 SVG 同套投影）、`pickAtom`（点击 → 原子，容差内取最近）、
  `measureDistances` / `measureAngles`；新增 `vesta_measure` 工具（distance / angle / clicks）。
- 实测：金刚石 Si 最近邻 **2.3517 Å**（文献 2.35）、立方晶胞近邻夹角 90.000°、点击命中/空白不命中都正确。
- 新增 `test/measure.test.mjs`（6 例：距离、越界、角度、投影范围、拾取、就近选择）。
## 0.0.14 — 2026-10-27

- **体数据导出**：`volumeSlice`（xy/yz/zx 取层）、`volumeSliceCsv`（CSV + 单位注释）、`volumeProfileText`（距离/数值两列），
  并新增 `volume_export` 工具（kind=slice|profile）——补上 VESTA「Export Data」的数据侧等价物。
- 实测（真实 CHGCAR 48³）：xy 切片 CSV 行数 = 48+3、值逐点正确；线剖面 6 点距离严格递增。
- 新增 `test/volume-export.test.mjs`（6 例：三切面取值、错误路径、CSV 结构、剖面单调性、真实 CHGCAR 网格）。
## 0.0.13 — 2026-10-27

- **CIF 写出**：`structureToCif`（P1、晶胞六参数 + 体积、逐原子分数坐标），`vesta_edit` 按输出扩展名选格式
  （`.cif` → CIF，其余 → POSCAR）——补上 VESTA「Export Data」的结构侧等价物，且不需要起 VESTA 进程。
- 验证：把写出的 CIF 交给 **VESTA 自己** `-open … -save back.POSCAR`，再解析比回：Si 原胞 2 原子/a=3.840/α=60°、
  Si 2×1×1 4 原子/a=7.681/体积 80.10 ų，全部一致。
- 新增 `test/cif.test.mjs`（4 例：字段完整性、标题清洗、空结构、真实 VESTA 往返）。
## 0.0.12 — 2026-10-27

- **SVG 矢量图导出**：`structureToSvg`（正交投影 + 球棍 + 晶胞棱 + 深度排序）+ `vesta_vector` 工具，
  补齐 VESTA 只有 GUI 的「Export Vector Image」。颜色/半径取自 `viewer/scene.js` 的 ELEMENTS 表，与 WebGL 查看器一致。
- 修第一版的 bug：缩放只按原子包围盒算，导致晶胞跑出画布（现在把晶胞角点也纳入，并复用同一次旋转结果避免错位）。
- 实测：Si 原胞 2 原子/1 键；Si 2×2×1 超胞 8 原子/8 键；headless Chrome 渲染核对通过。
- 新增 `test/svg.test.mjs`（6 例：完整性、计数、确定性、旋转、无 NaN、空结构）。
## 0.0.11 — 2026-10-27

- **对称约化**：`symmetryOrbit`（单原子轨道）+ `reduceBySymmetryTable` / `reduceBySpaceGroup`（完整晶胞 → 不对称单元），
  `vesta_edit` 新增 `reduceSpaceGroup` 参数，并报告每个轨道的多重度（≈ Wyckoff multiplicity）。
- 验证方式：`expand(reduce(expand(X))) == expand(X)`（原子集合逐项相同）——225、227 均通过。
- 实测：225 4→1（多重度 4）、227 8→1（8）、NaCl 225 8→2（4,4）、P1 1→1。
- 端到端：`spaceGroup=227 + reduceSpaceGroup=227` → 8 展开、1 约化，VESTA 文本区确认 1 行 Si。
- 新增 3 条测试（往返恒等、NaCl 多重度、P1 轨道），`test/symmetry.test.mjs` 共 8 条全过。
## 0.0.10 — 2026-10-27

- **空间群对称展开**：`parseSpaceGroupTable` 读 VESTA 自带的 `spgra.dat`（230 群）、`symmetryOperationToMatrix`
  解析操作字符串、`applySymmetry`/`expandBySpaceGroup` 做「点群操作 × 点阵平移」展开；`vesta_edit` 新增 `spaceGroup` 参数。
- 修两个解析坑：`spgra.dat` 不含面心/体心平移（需按符号首字母补）；同号多设置时后面的会覆盖前面（群 1 曾被覆盖成 R 心）。
- 实测：225 Si(0,0,0) → 4（FCC）；227 Si(0,0,0) → 8（金刚石）；227 Si(½,½,½) → 8；194 Mg(⅓,⅔,¼) → 2（hcp）；P1 → 1。
- 端到端：`vesta_edit(spaceGroup=227, open=true)` → 8 个 Si，VESTA 文本区确认 8 行。
- 新增 `test/symmetry.test.mjs`（5 例），覆盖表解析、点阵平移、已知结构原子数与错误路径。
## 0.0.9 — 2026-10-27

- 结构编辑补全：`setCellParameters`（改 a/b/c/α/β/γ，保持分数坐标）、`addAtoms`（坐标自动折回 [0,1)）、
  `removeAtoms`（按索引或元素）、`latticeFromCellParameters`（含六方 120° 构造）。
- `vesta_edit` 参数新增 `cell` / `add` / `remove`，可一次组合多种编辑。
- 端到端：`cell={a:5.6,b:5.6,c:5.6}` + `substitute Si→C` + `add Na(0.5,0.5,0.5)` → 3 原子（C/Na），
  VESTA 打开后其文本区确认为 3 行、元素 C 与 Na。
- 新增 6 条单测（add/remove/cell/六方构造/非法参数），`test/edit.test.mjs` 共 13 条全过。
## 0.0.8 — 2026-10-27

- **vesta_edit（新工具）**：扩胞（repeat）、任意整数变换矩阵（matrix，语义同 VESTA 的 Unit Cell Transformation）、
  元素替换（substitute）。核心是 transformStructure（P·旧基矢 + 原子像枚举）与 structureToPoscar。
- 实测：2×2×1 → 8 原子 / det 4 / 体积 ×4；2×2×2 → 16 原子 / det 8；[[2,1,0],[0,2,0],[0,0,1]] 的分数坐标全部落在 [0,1)。
- 端到端：vesta_edit(repeat=[2,2,1], open=true) 写出 .vasp，VESTA 打开后其自身文本区列出 8 行 Si。
- 发现：VESTA 按文件名/扩展名判类型，.POSCAR 会被拒绝（"Invalid data!"），必须 .vasp 或精确的 POSCAR；文件名避免中文与 ×。
- GUI 对话框边界：AttachThreadInput 可夺焦点、WM_CHAR 部分控件可用、WM_COMMAND（真实按钮 id）可关闭 wx 对话框，
  但 wx 文本字段仍写不进 —— 所有"填数值"的功能改由自算 + 写文件实现。
## 0.0.7 — 2026-10-27

- **GUI 文件对话框：结论「不做」**（详见 docs/VESTA.md）。对话框能找到（顶层 `#32770` "Save As"）、控件能枚举、
  真实鼠标点击能让文件名框获得焦点（截图可证），但 `WM_SETTEXT`（6 个候选控件）与 `SendKeys` 都无法写入、
  `SendMessage(BM_CLICK)` 会阻塞超时。根本原因：wx 的文件对话框用自己的内部缓冲，不读子控件文本。
  → 保存/导出改走 CLI（`-save` / `-export_img`），不再依赖对话框。
- 新增底层能力（对其它 GUI 场景仍有用）：`clickControlCenter`、`clickpost`（非阻塞点击）、
  `realmouse`（真实鼠标点控件中心）、宿主内 `type`（SendKeys + 特殊字符转义）。
## 0.0.6 — 2026-10-27

- **撤销/重做**：`vesta_input(action="undo"|"redo")`。视图操作可精确反演（拖拽/滚轮/方向键往返后截图哈希回到基线），
  所以不需要 VESTA 有 undo 栈：记录输入、重放逆动作即可。`click`/`type` 不可逆，撤销时跳过。
- 修 bug：按键历史曾记录键名（`"left"`）而不是键码，求逆得到 `NaN` 后静默跳过，导致「撤销」实际撤销了上一步。
- 新增 `captureViewport()`：只截 `wxGLCanvas`（565×442），避免整窗截图里文本区/状态栏带来的哈希噪声。
- 常驻宿主新增 `capture` 动作（不再为每次截图起新进程）。
## 0.0.5 — 2026-10-27

- **纠正 0.0.4 的错误结论**：`LMATRIX` **不是**相机矩阵。把文件里的矩阵旋转 30°（两种乘法顺序）后渲染结果逐字节不变，
  只有 CLI 的 `-rotate_x/y/z` 会改变视角——VESTA 不把相机写进 `.vesta`。
- **确定性视角**：同一组 `-rotate_*` 参数两次出图 **哈希一致**；但旋转**按参数顺序作用、不可交换**，
  所以 `viewToCliArgs` 固定按 x→y→z 输出，保证同一 `{rx,ry,rz}` 永远得到同一张图。新增对应回归测试。
- 测试夹具：把 Si 的完整 `.vesta` 作为 `test/fixtures/scene-template.vesta` 入库（4 KB），
  真实 VESTA 的「接受模板生成场景」用例因此**默认运行**（9.7 s，已通过）。
## 0.0.4 — 2026-10-27

- **`.vesta` 场景模板**：`parseVestaProject`（段/行内参数/结构/晶胞/`LMATRIX`）+ `buildVestaFromTemplate`
  （换结构、保留显示设置）+ `vesta_render(template=…)`，批量出图风格一致且带 `manifest.json`。
- 发现并验证：`LMATRIX` 就是视图取向矩阵，随 `.vesta` 保存/恢复（此前以为「相机拿不到」）。
- 实测：Si 模板 + 石墨烯结构 → VESTA 直接接受，58 KB PNG；两视角 3.3 s。
- 限制：模板必须是 VESTA 自己保存的**完整** `.vesta`；最小段集合会被静默拒绝。
## 0.0.3 — 2026-10-27

- **`vesta_render`（新工具）**：用 VESTA 命令行批量出图——`-open` + `-rotate_x/y/z` + `-export_img scale=N`，
  跑完写 `manifest.json`（输入 sha256、参数、输出、大小、耗时），同一结构多视角风格一致、可复现。
- 实测：`-rotate_x/y/z` 在本机 VESTA 3.x 有效（非官方手册命令）；单张 1.5–1.7 s，1412×1106（scale=2）。
- 已知瑕疵：导出 PNG 偶有底部黑边（窗口未完全布局），批次出图建议 scale>=2。

## 0.0.2-internal — 2026-10-27

- **`vesta_input`（新工具）**：直接操作 VESTA 的 3D 视图——拖拽旋转、滚轮缩放、方向键旋转、视图内点击、向对话框打字。
  走 Win32 `PostMessage`（`WM_LBUTTONDOWN/MOUSEMOVE/MOUSEWHEEL`），**不需要窗口置前**；键盘会先 `SetForegroundWindow`。
- **常驻宿主**：`win/vesta-ui.ps1 -Action host` 用 stdin/stdout 行 JSON 提供服务，`Add-Type` 只编译一次——
  单次动作从 **14.7 s** 降到 **137–294 ms**（`viewport` 复合动作 + 10 s 缓存后：拖拽 216 ms、滚轮 137 ms、按键 294 ms）。
- 新增 `packMousePoint` / `viewToCliArgs` / `findViewport` / `injectInput` / `renderViewsWithCli`，
  以及 `clearViewportCache`、`startUiHost` / `callUiHost` / `stopUiHost`。
- 修掉：宿主首行 `ready` 被当成响应导致后续全部错位一格；键名校验应早于连接 VESTA。

## 0.0.1 — 2026-10-26

首个公开版本。能力概览（详见 [docs/STATUS.md](docs/STATUS.md)）：

- **20 个模型可调用工具**，DSH 原生插件与 MCP 服务器**同源同版**（清单由 `test/mcp-parity.test.mjs` 守着）；
- **VESTA 控制**：打开文件、列菜单、执行命令、操作对话框控件、窗口截图 / CLI 高清导出、多窗口 `pid` 定向；
- **VESTA 自算**：空间群与晶胞、键长、键角、配位多面体（含畸变指标）、X 射线结构因子；
- **VASP 解析**：POSCAR / KPOINTS / IBZKPT / INCAR / POTCAR / OUTCAR / OSZICAR / DOSCAR（含 PDOS 与自带积分列）/ EIGENVAL / CHGCAR 系 / ELFCAR / LOCPOT / CUBE / XDATCAR / **vasprun.xml**；
- **体检 26 项**：能量/力/应力/费米/带隙/NBANDS/k 点约化/真空层/价电子自洽，以及 `vasprun ↔ OUTCAR ↔ CONTCAR` 三向交叉核对；
- **体积分析**：二维截面、一维线剖面、峰搜索（VESTA 手册 14.14）、∇²ρ 与动能/能量密度（14.15）、逐原子电荷（离散 Voronoi）、功函数；
- **结构分析**：超胞、结构预检、层分离/吸附高度/位点判别、板层批量报表；
- **可视化**：结构（WebGL）、DOS、能带、收敛、多任务对比、轨迹播放器、PDOS、X 射线粉末衍射、功函数剖面——全部单文件 HTML、离线可开；
- **质量**：自检 58 项（52 个测试文件 / 252 个用例 + MCP 冒烟 + 生成器端到端）、文档目录与检查项清单防漂移。

已知限制（同样见 STATUS.md）：功函数/PDOS/line-mode 能带缺真实数据验证；VESTA `-save option=pcell/reduced` 在该版本无效果；
`-calcf` 输出文件名取 POSCAR 标题且路径含点会截断（脚本已规避）。
