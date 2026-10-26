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
