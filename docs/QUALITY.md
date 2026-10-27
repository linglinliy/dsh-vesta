# 质量与测试

> 从 README 拆出（v2.73.0）。装配/冒烟/描述审计与文档维护。

<!-- TOC -->
<details>
<summary>目录（7 节，点击展开）</summary>

- [装配集成测试（tools.test.mjs）](#装配集成测试toolstestmjs)
- [真实调用冒烟测试（tools-smoke.test.mjs）](#真实调用冒烟测试tools-smoketestmjs)
- [第二批冒烟测试（tools-smoke2.test.mjs）与一处描述错误](#第二批冒烟测试tools-smoke2testmjs与一处描述错误)
- [第三、四批冒烟：VESTA 进程类工具与轨迹播放器](#第三四批冒烟vesta-进程类工具与轨迹播放器)
- [工具描述审计（触发语）](#工具描述审计触发语)
- [参数描述审计（单位 / 范围）](#参数描述审计单位-范围)
- [README 目录（自动生成 + 测试守护）](#readme-目录自动生成-测试守护)

</details>
<!-- /TOC -->

## 装配集成测试（tools.test.mjs）

`apply(ctx, config)` 里一次注册全部工具，多次打补丁后很容易漏掉某个工具或写坏 schema。
`test/tools.test.mjs` 用 mock ctx 跑一遍装配，断言：

- 注册的工具名与清单**逐项一致**（当前 **18 个**）；
- 每个工具都有描述（>10 字符）、`parameters`（type=object）与 `execute`；
- `parameters.required` 里的每个键都真的在 `properties` 中；
- 输出 schema 的 `required` 字段都有对应定义；
- 插件名 `vesta`、依赖 `['tools']` 不变。

**一次自查纠正**：此前我在对话里说过「19 / 20 个工具」，那是按 README 表格行数估的；
实际注册数是 **18**（`vesta_open/info/menu/control/capture/analyze`、`volume_analyze`、`xray_powder`、
`slab_report`、`vesta_view`、`vasp_dos/bands/report/batch/compare/table/trajectory/pdos`）。
现在这个清单由测试固定，不会再随口估错。

## 真实调用冒烟测试（tools-smoke.test.mjs）

除装配测试外，还有一组**真跑工具**的冒烟测试（夹具是 `5.5` 的真实 VASP 输出）：

| 工具 | 断言 |
|---|---|
| `vasp_report` | 能量 −10.8391031 eV、带隙 0.657 eV、判语与建议都在 |
| `vasp_table` | 不给 `out` 也能导出（见下方回归） |
| `vasp_dos` | 产物 HTML 存在 |
| `vesta_analyze` | 读出 3.88909 / 41.59 等晶胞参数 |

### 抓到的一个真 bug

`vasp_table` 原来把 `args.out` 直接传给脚本；脚本**只在给了 `--out` 时才写文件**，
于是工具拿不到表格文本，报「无法解析汇总表生成器的输出」。现在没给 `out` 时默认写
`<任务目录>/table.md|.csv`，并且 `make-table.mjs` 无论写不写文件都会在末尾打印结构化 JSON。

### 一个语义约定（已写进测试）

`vasp_report` 的 `ok` 表示**「所有检查项都通过」**，不是「工具调用成功」：
`5.5` 有 ENCUT 告警，所以 `ok = false` 而工具本身工作正常。
`vasp_batch` 的 `ok` 才是「没有任务失败」。

## 第二批冒烟测试（tools-smoke2.test.mjs）与一处描述错误

补充 7 个真实调用用例，覆盖此前没跑过的工具：

| 工具 | 结果 |
|---|---|
| `vasp_bands` | 从 EIGENVAL 出图，带隙正确 |
| `vasp_compare` | 两个真实任务的收敛曲线对比 |
| `vasp_batch` | 父目录批量出图 + 索引页（1.8 s / 2 任务） |
| `volume_analyze` | slice / profile / peaks / derived **四种全通**（profile 复现 2.3815 Å） |
| `xray_powder` | 真实 Si 出 9 个峰 |
| `vesta_view` | 生成 PDB + CIF，公式与原子数正确 |
| `vasp_pdos` | 没有 LORBIT 数据时抛明确错误（断言报错信息含 LORBIT） |

### 修掉的一处描述错误

`vesta_view` 的描述与返回文案原来让模型「把 PDB 路径传给 `sci_viz_structure`」，
但**本 profile 里并没有这个工具**——模型照做只会失败。现已改为：
需要交互查看时用 `renderer="webgl"` 生成离线 HTML 查看器，或直接在 VESTA 里打开 PDB/CIF。

这类「描述里引用了不存在的工具」比代码 bug 更隐蔽，因为它不会让测试变红，只会让对话走错路。

## 第三、四批冒烟：VESTA 进程类工具与轨迹播放器

| 工具 | 用例 | 结果 |
|---|---|---|
| `vasp_trajectory` | 合成 3 帧 XDATCAR → 播放器 HTML | ✅ frames = 3 |
| `vasp_trajectory` | 路径不存在 | ✅ 抛明确错误 |
| `vesta_capture`（path 模式） | CLI 高清导出 PNG | ✅ >10 KB |
| `vesta_info` | 可执行文件与版本标识 | ✅ |
| `vesta_open` + `vesta_menu` + `vesta_control` | 真实驱动：打开 → 列 86 条菜单 → 列 74 个控件 | ✅ |
| `slab_report` | 32 个真实构型出表 | ✅ |

VESTA 那个用例会在结束时 `taskkill` 清理，避免单实例进程影响后续测试。

### 又修掉一个同类问题：slab_report 默认输出

`slab_report` 不给 `out` 时，Markdown 不写、CSV 却落到**当前工作目录**，工具回报的 `path` 还是 `null`。
现在默认写 `<任务目录>/slab-report.md` 与同名 `.csv`，并回报路径——与 `vasp_table` 的修法一致。

### 一个我自己造成的问题（已清理）

新的 `slab_report` 测试最初没传 `out`，于是把 `slab-report.md/.csv` 写进了**你的真实数据目录**
`<本地 pilot 数据集>`。已删除那两个文件，测试改为写临时目录并断言路径等于显式传入的 `out`。
教训：测试里涉及写文件的工具，一律显式给临时输出路径。

## 工具描述审计（触发语）

工具描述里必须写清**「什么时候该用它」**，否则模型只能靠工具名猜。审计发现 7 个工具缺触发语
（`vesta_menu`、`vesta_capture`、`vesta_analyze`、`vesta_control`、`volume_analyze`、`vasp_bands`、`vasp_pdos`），已全部补上，例如：

- `vasp_bands` → 「用户问『能带长什么样 / 带隙多少 / 直接还是间接』时用它。」
- `volume_analyze` → 「用户问『这个 CHGCAR 的截面 / 线剖面 / 峰在哪 / ∇²ρ 长什么样』时用它。」
- `work_function` → 「用户问『功函数多少 / 真空能级在哪』时用它。」

`tools.test.mjs` 新增了一条断言：每个工具的 `description` 必须匹配 `用户…` 或 `当…时`，
并且不得引用不存在的工具（上一轮 `sci_viz_structure` 的教训）。

**一个正则的教训**：我自己写的审计脚本用 `/用户|当.*时/`，`vesta_control` 的「当前对话框」里的「当」
配合后文任意「时」就误判为通过；测试里收紧成 `/用户|当[^。]{0,20}时/` 才真正抓到。
审计脚本的宽松正则会让人误以为已经合规。

## 参数描述审计（单位 / 范围）

工具层 73 个参数里只有 1 处缺单位：`volume_analyze.threshold` 原来只写「峰阈值」，
没说是 e/Å³、也没说默认值。现在写明：

> 峰阈值（低于此值不算峰），单位与体积文件一致（CHGCAR 为 e/Å³）；默认取峰值的 20%。

`tools.test.mjs` 增加断言：**每个参数都要有描述**；`at / scale / points / window / twoThetaMax /
fwhm / lambda / efermi / repeat / tolerance / maxPeaks / threshold / depth` 这些参数必须写明
`° / Å / eV / % / 0–1 / 倍数 / 范围 / 默认` 之一。

这样做的原因很实际：模型不知道 `at` 是 0–1 还是 Å，就会填错；写清单位比反复解释便宜。

## README 目录（自动生成 + 测试守护）

README 现在有 63 个二级标题、1450+ 行。顶部加了一个折叠目录：

```bash
node scripts/update-toc.mjs          # 重新生成
node scripts/update-toc.mjs --check  # 只检查是否过期（过期退出码 1）
```

`test/docs-toc.test.mjs` 做两件事：

1. **同步检查**：把当前 README 的二级标题重新生成一遍目录，与文件里的目录块逐字比较，
   不一致就报「目录已过期：运行 node scripts/update-toc.mjs」；
2. **锚点检查**：目录里每个链接的锚点都必须能在标题里找到。

锚点规则按 GitHub 的方式：小写、去标点、**保留下划线**、空格转连字符
（`工具入口：vesta_analyze` → `#工具入口vesta_analyze`）。

**过程中的一个修正**：第一版正则把下划线也删了，锚点变成 `#工具入口vestaanalyze`，
测试立刻抓到——这正是把「文档格式」也纳入测试的好处。

### 文档与实现的一致性审计（0.0.29）

工具一多，最容易出的不是代码 bug，而是**文档漂移**：README 写 27 个工具、实际 28 个；
MCP 说明写 20 个；某节引用了已经改名/删除的工具。这类问题人工看不出来，所以做成测试：

`test/docs-consistency.test.mjs` 的 8 条检查：

| 检查 | 抓什么问题 |
|---|---|
| 工具数与 `mcp/server.js` 说明一致 | MCP 自述的工具数过期 |
| 文档里写的工具数与实际一致 | README / PROJECT 里的「N 个工具」过期 |
| 文档提到的 `vesta_*` 工具真实存在 | 引用了不存在的工具 |
| 每个工具都在文档里出现过 | 新工具忘了写文档 |
| CHANGELOG 最新版本 == package.json | 忘了改版本号 |
| COVERAGE 工具清单里没有「未实现」 | 状态标注自相矛盾 |
| 每个 `vesta_*` 工具描述都有触发语 | 模型无法判断何时该用 |
| 工具必填参数的 schema 合法 | 参数定义写坏 |

首次运行就抓到 **6 处漂移**（README 27、PROJECT 20 ×2、VESTA.md 27、server.js 20 ×2），
全部改为实际的 28 后通过。

教训记在这里：**新的工具或版本，先改代码、再跑这个测试，让测试告诉你哪些文档还没跟上。**

### 工具参数自检（0.0.31）

0.0.30 抓到一个很隐蔽的回归：`vesta_render` 的执行体一直在读 `args.background` / `args.model`，
但参数 schema 里没有这两项。因为 schema 是 `additionalProperties: false`，**真调用时这两个参数会被直接拒掉**，
而单元测试只测了 `renderViewsWithCli`（核心函数），根本没经过 schema 校验。

`test/tool-params.test.mjs` 就是为了让这类问题不可能再溜过去：

| 检查 | 抓什么问题 |
|---|---|
| 执行体读的参数都在 schema 里声明过 | **0.0.16 那类回归**（读了但没声明） |
| 声明的参数都在执行体里出现过 | 死参数（声明了但没用，用户传了也没效果） |
| 每个工具都有 object 类型的 parameters | 定义写坏 |
| 参数名不与 schema 保留字冲突 | 结构性错误 |
| 工具名带已知前缀 | 命名漂移 |
| 输出 required 是 properties 子集 | 输出契约不一致 |
| **检测器自检** | 故意构造「读了 background 但没声明」的假定义，确认检查器真的能抓到 |

做法上有个关键改动：工具是 `localTool({...})` 工厂包出来的，`definition.execute.toString()` 只能拿到包装器，
看不到真实执行体。所以让 `localTool` 额外暴露 `executeSource`（原始函数源码），静态比对才有意义。

参数既有解构写法 `execute({ path, out })`、也有 `execute(args)`，检查器两种都解析。

### 测试隔离：别让用例互相抢 VESTA 窗口（0.0.33）

全量跑测试时抓到一个**用例互相干扰**的问题：`input.test.mjs` 里那条「拖拽后画面哈希变化」的用例，
原本的做法是「找当前正在运行的任意一个 VESTA 并拖它」——

- 单独跑时能过；
- 全量跑时，别的用例（场景渲染、elements.ini 渲染）会同时开关 VESTA 进程，它可能连到一个正在退出的窗口，
  拖拽自然没反应，于是报 `拖拽之后画面应该变化` 失败。

这不是产品 bug，是**测试设计 bug**。修法：用例自己开一个只含本用例结构的窗口（`openFiles` → 取最新进程 pid → 拖拽 → 关掉），
并用 `finally` 保证进程被清理。修完后该用例耗时从 14 s（失败）变成 18 s（真实通过）。

这条的普适教训：**凡是「找当前正在运行的进程」的测试，都会在并行/全量运行时变脆**；应该改成「自己创建、自己销毁」。

### 不要按镜像名全局杀进程（0.0.34）

0.0.33 修了「拖拽用例连错窗口」，但全量跑仍有 1 条失败：
`真实 VESTA：同一组旋转参数两次出图哈希一致（确定性）` 耗 90 秒后报哈希不一致。

**根因**：有两个测试用 `taskkill /IM VESTA.exe /F`（按镜像名杀全部）在渲染前后清场。
全量跑是并行的，于是它们在别的用例渲染途中把那个 VESTA 干掉，出图自然不一致。
单独跑这两个文件时都过，只有并行才炸——典型的**共享资源冲突**。

修法：

| 位置 | 原来 | 现在 |
|---|---|---|
| `tools-smoke4.test.mjs` | `taskkill /IM VESTA.exe /F` | 只杀自己 `vesta_open` 返回的 pid（`taskkill /PID <pid> /T /F`） |
| `elements-ini.test.mjs` | 渲染前后各全局杀一次 | 干脆不杀：每次渲染都是 `-export_img … -close` 的新进程，自己会退出 |

修完后把三个 VESTA 重负载套件放一起跑：全部通过，确定性用例从「90 s 失败」变成 **871 ms 通过**。

core 里的 `renderViewsWithCli` / `analyzeWithVesta` 本来就是按 pid 清理（`taskkill /PID … /T /F`），
所以产品代码没有这个问题——**只是测试写坏了**。但这也确认了一件产品行为：
我们的工具不会去动用户自己开着的 VESTA 窗口。

### 全量测试要串行跑（0.0.35）

并行跑（Node 默认按 CPU 核数并发）时，多个用例会同时启动 VESTA：窗口抢焦点、`PrintWindow` 抓到别人的窗口、
`-export_img` 互相拖慢甚至超时。表现为「单独跑都过、全量跑随机挂 1–2 条」。

正确命令（串行）：

```bash
node --test --test-concurrency=1 test/*.test.mjs
```

并行时实测：368 例里随机会挂 2 条（拖拽哈希、`vesta_capture` 的 CLI 高清导出，后者 60 s 超时）。
串行后这两条都稳定通过。

判断依据很简单：**这类测试共享一个全局 GUI 资源（VESTA 进程/窗口）**，就不该并发。
只跑纯计算用例（解析、几何、对称）时并行没问题，也快得多。

### 真实夹具用环境变量驱动（0.0.36）

仓库里的真实数据路径是**脱敏占位**（`<本地任务根目录>`），所以那些用例默认跳过。
这样发布干净，但也意味着「跳过」不等于「没跑过」。现在补上环境变量入口：

```bash
VASP_FIXTURE_ROOT=<你的 VASP 任务根目录> \
  node --test --test-concurrency=1 test/*.test.mjs
```

- `VASP_FIXTURE_ROOT`：VASP 任务根目录（下面要有 `5.5/` 等任务）；
- `VASP_ADSORPTION_ROOT`：吸附任务目录（`slab_report` 用）。

设了之后，`tools-smoke` / `tools-smoke2` / `tools-smoke4` 里原本跳过的用例会**真跑**：
`vasp_report`、`vasp_table`、`vasp_dos`、`vesta_analyze`、`vasp_batch`、`xray_powder`、`volume_analyze`、
`vesta_open`+`vesta_menu`+`vesta_control` 全部由 skip 变成实跑。

**顺带修了一个会拖死整套的坑**：`tools-smoke4` 真去驱动 VESTA 时，常驻 PowerShell 宿主没被停掉，
node 进程就一直挂着（表现为「卡住」而不是「失败」）。修法：给该用例加 `timeout: 180000`，
并在 `finally` 里显式 `stopUiHost()`。修完 2 通过 / 1 跳过（缺吸附数据），不再挂。

### 常驻宿主句柄必须跨模块实例共享（0.0.37）

现象：`tools-smoke` 在真实夹具下**挂死不退**——测试全跑完了，node 进程却一直不走。

诊断靠进程树，不靠猜：

```
node --test …  →  node (child)  →  powershell.exe -File …/vesta-ui.ps1 -Action host
```

**根因**：插件为了热重载用 `import('./core.js?rev=' + Date.now())`，每次都是**新的模块实例**；
宿主的 `uiHostState` 只存在那个实例里。测试里另 `import('../core.js')` 调 `stopUiHost()` 时，
那份实例的 `uiHostState` 是 `null`，什么都没停，PowerShell 子进程一直在，node 也就不退出。

修法：

1. 宿主句柄放到 `globalThis`；
2. `startUiHost` / `stopUiHost` **每次都直接读 globalThis**（不能只在模块加载时读一次）；
3. 再加 `process.on('exit')` 兜底清理。

修完后 `tools-smoke` 真实夹具 **4/4 通过**、进程正常退出。

### 一次假阳性：过滤字符串把当前 shell 也算进去了

验证「有没有残留宿主」时，我用 `CommandLine -like '*vesta-ui.ps1*'` 数进程，结果总是 1 个。
真相是**当前这条 pwsh 命令自己的命令行**里就包含 `vesta-ui.ps1` 这几个字，匹配到了自己。
改成运行时拼接模式（`'vesta-ui' + '.ps1'`）并排除 `$PID` 之后：0 个残留。

教训：**用命令行做进程匹配时，先排除「检查器自己」**，否则会得到一个永远为真的“证据”。

### 最终验收怎么跑（一次只跑一件事）

全量测试与 `selfcheck.mjs` 都会启动 VESTA，**不能同时跑**：实测同时跑会出现 1–3 条真 VESTA 用例失败
（拖拽哈希、模板渲染），单独跑又全过。所以验收顺序是：

```bash
node --test --test-concurrency=1 test/*.test.mjs   # 先跑全量，跑完再跑下一句
node scripts/selfcheck.mjs
```
