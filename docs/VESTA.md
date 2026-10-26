# VESTA 联动

> 从 README 拆出（v2.73.0）。CLI 驱动、文本区解析、结构因子。

<!-- TOC -->
<details>
<summary>目录（12 节，点击展开）</summary>

- [按官方文档校正的三处（VASP wiki）](#按官方文档校正的三处vasp-wiki)
- [按官方文档校正（第二轮：KPOINTS / POSCAR）](#按官方文档校正第二轮kpoints-poscar)
- [VESTA 命令行导出（手册第 17 章）](#vesta-命令行导出手册第-17-章)
- [用 VESTA 做结构格式转换（-open / -save）](#用-vesta-做结构格式转换-open--save)
- [与 VESTA 的逐点交叉校验（体积解析）](#与-vesta-的逐点交叉校验体积解析)
- [读 VESTA 自己算的结构摘要（文本区）](#读-vesta-自己算的结构摘要文本区)
- [让 VESTA 算几何参数（-list bond）](#让-vesta-算几何参数-list-bond)
- [工具入口：vesta_analyze](#工具入口vesta_analyze)
- [成键判据与 VESTA 键表对照](#成键判据与-vesta-键表对照)
- [结构因子（-calcf）：终于打通，并找到两个坑](#结构因子-calcf终于打通并找到两个坑)
- [自己的结构因子实现（与 VESTA 表逐条对照）](#自己的结构因子实现与-vesta-表逐条对照)
- [散射因子元素扩展（自带采集器）](#散射因子元素扩展自带采集器)

</details>
<!-- /TOC -->

## 按官方文档校正的三处（VASP wiki）

参考 `DOSCAR`、`CHGCAR` 两个官方格式页：

1. **PDOS 的 lm 分辨格式**（`LORBIT=11`）：单自旋每行是 9 列
   `E s p_y p_z p_x d_xy d_yz d_z2 d_xz d_x2-y2`，双自旋 18 列。
   之前按 6 列判自旋的规则会把它错判成自旋 DOS，现已按分量求和归到 s/p/d，
   新增 9 列与 18 列两条单测。
2. **DOSCAR 头部第 3 个数**是 "0 = 无 partial DOS / 1 = 含"，解析结果里以 `hasPartial` 返回；
   该标志只作参考——文件里若确实有逐原子块，仍然解析（容忍不自洽文件）。
3. **CHGCAR 的磁化密度块**：`ISPIN=2` 时第二块是「自旋向上 − 向下」的磁化密度。
   `parseChgcar(text, { block: 2 })` 会跳过第一块与 augmentation 行，读到第二块；
   查看器加 `--vol-block 2` 即可画磁化等值面，信息栏会标注「磁化密度块」。

单元测试：`volume` 12/12（新增 3 条 CHGCAR 双块）、`pdos` 9/9（新增 3 条 lm/标志位）。

## 按官方文档校正（第二轮：KPOINTS / POSCAR）

参考 `KPOINTS`、`POSCAR` 两页：

1. **KPOINTS line-mode**：第 2 行是「每段点数」而不是总点数；第 3 行首字符 `L/l` 激活；
   第 4 行指定坐标系（`C/c/K/k` 为 Cartesian）；之后每两行一段，行末可带高对称点标签（如 `0.5 0.5 0 X`）。
   `parseKpoints` 现在返回 `segments`（含 `from/to` 的 k 与标签）、`coordinate`、`pointsPerSegment`。
2. **POSCAR 第 2 行缩放因子**：可以是 **3 个数**（分轴缩放），也可以是**负数**（表示目标晶胞体积，
   先按未缩放体积求 `s = cbrt(|s|/V)`）。
3. **Cartesian 坐标要乘缩放因子**：官方写明 `R = s·(x1,x2,x3)`，之前直接把数值当 Å 用，缩放因子≠1 时会整体偏。

单元测试：`node --test test/formats.test.mjs`（6/6：line-mode 分段与标签、Cartesian 坐标系、
常规网格不受影响、分轴缩放、负缩放、Cartesian×s）。

## VESTA 命令行导出（手册第 17 章）

VESTA 手册第 17 章列出了命令行接口，其中三个正好解决我们之前用 Win32 对话框没搞定的问题：

```
VESTA.exe -open <结构文件> -export_img scale=3 <输出.png> -close
```

实测（`5.5/POSCAR`）：**2118×1659 像素、白底、无界面控件、带 a/b/c 轴标**，1.8 s 出图。

实现要点：
- 用 `-open` 打开、`-export_img scale=N` 导出、`-close` 关标签页；
- VESTA 是 GUI 程序，导出后不会自己退出，`exportVestaImage` 轮询产物出现（>1 KB）后按进程树 `taskkill /T /F` 结束；
- 工具入口：`vesta_capture(path="<结构>", out="<png>", scale=3)`；不传 `path` 时仍是原来的窗口截图。

至此「VESTA 导出图片写盘未打通」这条已知限制**已解除**。

## 用 VESTA 做结构格式转换（-open / -save）

```bash
node scripts/vesta-convert.mjs <源文件> <目标文件>   # 扩展名决定格式：.cif / .vasp / .pdb / .xyz …
```

`-i`（无界面读入）**不会写文件**，必须用 `-open`（带 GUI）配合 `-save`。

往返实测（`5.5/POSCAR` → CIF 1076 B → VASP 343 B）：

| 检查 | 结果 |
|---|---|
| 晶胞体积 | 41.593750 → 41.593739 Å³（差 1.1×10⁻⁵，即 CIF 的 6 位有效数字） |
| 原子分数坐标 | 2 个原子，最大差 **0** |
| 晶胞向量 | 被 VESTA 旋转到标准取向（差 3.89 Å 是旋转，不是形变） |
| 元素符号 | 变成 `Xx`——源 POSCAR 是 VASP 4 写法（没有元素行），VESTA 只能写占位符 |

结论：**几何保真（体积/分数坐标），但取向会被标准化、元素标签可能丢失**，适合做格式互换，不适合当作"无损拷贝"。

顺带修了一个真 bug：`probeExecutable` 之前没有回退到 `DEFAULT_EXECUTABLE`，导致命令行脚本在未设 `VESTA_EXE` 时报「未配置可执行文件路径」。

## 与 VESTA 的逐点交叉校验（体积解析）

```bash
node scripts/vesta-crosscheck.mjs <CHGCAR|CHG|PARCHG>
```

做法：让 VESTA 用官方 CLI 把同一份 CHGCAR 导出成文本体积（`*.3ed`，bohr⁻³、z 最快），
再与我们 `readVolumeFile` 的结果**逐点比较**。

`5.5/CHGCAR` 实测：

| 项 | 结果 |
|---|---|
| 网格 | 我们 48³，VESTA 49³（差 1 是 VESTA 的周期冗余面） |
| 比较点数 | 110592（全部） |
| 最大偏差 | **1.08×10⁻⁷ e/Å³**（VESTA 文本只有 6 位有效数字，这就是精度地板） |
| 结论 | 两边数组一致，**我们的解析正确** |

### 由此定性的 CHGCAR 异常

之前发现「密度峰不在原子上、两个 Si 处的 ρ 都是 −0.1845」。既然 VESTA 导出的数组与我们逐点一致
（连最大值也同在 (5,4,4)），可以确定：

- **不是我们的解析问题**（顺序、原点、单位换算都经 VESTA 独立验证）；
- 是**这份 CHGCAR 自身的数据**如此，它与同一目录的 POSCAR 所描述的理想 Si-fcc 不一致。

建议核对这份文件的来源（是否被别的计算覆盖过）。

## 读 VESTA 自己算的结构摘要（文本区）

```bash
node scripts/vesta-structure-info.mjs <结构文件>
```

在 VESTA 里打开文件后读它的 Text Area（`WM_GETTEXT`），取出 **空间群 + a/b/c + α/β/γ + V**，
再与我们的 `parsePoscar` + `cellParameters` 逐项对照。`5.5/POSCAR` 实测：

```
VESTA 报告：空间群 P 1（#1-1）
  a/b/c    VESTA 3.88909    我们 3.889087    差 2.7e-6（显示位数）
  α/β/γ    VESTA 60         我们 60.000000   差 7e-15
  V        VESTA 41.5937    我们 41.593750   差 5e-5
```

### 这一轮修的两个真 bug

1. **`vesta-ui.ps1` 丢了 UTF-8 BOM**：被 node 补丁重写后变成无 BOM 的 UTF-8，
   PowerShell 5.1 按 ANSI 解码中文注释，导致 `param()` 解析错位（报 5 个语法错误）。补回 BOM 即恢复。
2. **`launch()` 的兜底定时器被 `unref()`**：短命的 CLI 脚本会在 900 ms 定时器触发前退出，
   顶层 `await launch(...)` 永远不结算（Node 报 "Detected unsettled top-level await"）。
   改为监听 `spawn` 事件立即结算，定时器只作兜底。

另外记一条环境注意：**VESTA 存在单实例行为**——若已有窗口在运行，新启动的进程会把文件转交给它并退出，
于是「按新 pid 找窗口」会一无所获。做自动化前先清理残留的 `VESTA.exe`。

单元测试：`node --test test/vesta-text.test.mjs`（4/4）。

## 让 VESTA 算几何参数（-list bond）

```bash
node scripts/vesta-geometry.mjs <结构文件> [--kind bond|angle|poly]
```

`-list bond` 的输出**确实写进 VESTA 的文本区**（不是 stdout），现在文本区能读了，于是可以拿 VESTA 当几何对照实现：

```
VESTA 列出 2 对键（原始条目 8 条，含周期像）
  Si1-Si2   2.38157 Å
  Si2-Si1   2.38157 Å
最短键长：VESTA 2.38157 Å　我们 2.38157 Å
结论：与我们的最短原子间距一致。
```

`angle` / `poly` 目前只把 VESTA 的输出原样打印（格式还没建模）。

单元测试：`node --test test/vesta-geometry.test.mjs`（4/4：去重取最小、空输入、fcc Si 最短间距、单原子返回 null）。

## 工具入口：vesta_analyze

```
vesta_analyze(path="<结构文件>", kind="structure"|"bond"|"angle"|"poly")
```

实测（`5.5/POSCAR`）：

```
kind=structure → VESTA：空间群 P 1（#1）；a=b=c=3.88909；α=β=γ=60；V=41.59375
                 我们：a=3.88909；V=41.59375 → 一致
kind=bond      → 2 对键，最短 2.38157 Å（与我们一致）
kind=angle     → Si1-Si2-Si1 = Si2-Si1-Si2 = 109.4712°（金刚石结构应有的四面体角）
```

**踩坑记录**：`-open` 打开后文本区是「完整报告」格式（`Lattice parameters` 表格 + `Unit-cell volume =`），
与侧栏的紧凑格式（`a = … Å  α = …°`）不同；第一版只认后者，工具于是落到了"原样返回"分支。
已让解析器同时支持两种格式，并补了对应单测。

## 成键判据与 VESTA 键表对照

`bondList(structure, { scale = 1.25, maxCutoff = 2.6 })` 用的是**查看器同一套判据**：
距离 ≤ min(2.6 Å, 1.25×(r_i+r_j))，半径取自 `viewer/scene.js`，周期性取最小像。

`vesta_analyze(kind="bond")` 现在同时给两边的结果：

| 结构 | VESTA（含两个方向） | 我们（i<j 去重） | 键长 |
|---|---|---|---|
| Si-fcc（5.5） | 2 对 | 1 对 | 2.38157 Å（两边一致） |
| 单层 C2 | 2 对 | 1 对 | 1.42259 Å（两边一致） |

差异只在**记法**：VESTA 把 A–B 与 B–A 各列一次，我们按 `i<j` 只留一条。

单元测试：`node --test test/bond.test.mjs`（4/4：金刚石 Si、石墨烯 C–C、判据收紧后不算键、单原子无键）。

## 结构因子（-calcf）：终于打通，并找到两个坑

```bash
node scripts/vesta-calcf.mjs <结构文件>
```

`5.5/POSCAR`（补上元素行）实测：**530 条反射**，d 范围 0.7160 → 3.1754 Å，最强 (−1 −2 −1) |F| = 17.674。

### 两个坑（本轮定位）

1. **输出文件名取 POSCAR 的第一行（标题）**，不是输入文件名：`Si-fcc` → `Si-fcc.txt`，写在**当前工作目录**。
   之前看到 `Failed to write structure factors to 5/POSCAR.txt` 就是因为标题/路径推导与预期不符。
2. **路径里不能有点**：`.tmp`、`5.5` 这类含点的目录会让 VESTA 截断输出路径（`<临时目录>` 被写成 `tmp\…`），
   于是永远写不出文件。脚本因此把输入复制到无点的临时目录、以它为 cwd 运行。
3. 附带：VASP 4 写法（无元素行）的 POSCAR 会得到元素 `Xx`，散射因子全 0——必须补元素行或让 VESTA 能识别物种。

### 物理自检（用产出的真实表）

| 检查 | 结果 |
|---|---|
| 我们算的 d(111)（由倒格子） | 3.1754 Å |
| VESTA 表里的 d(111) | 3.1754 Å（差 4.8×10⁻⁷） |
| 金刚石结构的禁戒反射 (0 1 1) | \|F\| = 1.24×10⁻¹⁵ ≈ 0 ✅ |

禁戒反射接近 0、允许反射 (111) = 15.078，说明解析与 VESTA 的计算都自洽。

单元测试：`node --test test/calcf.test.mjs`（3/3）。

## 自己的结构因子实现（与 VESTA 表逐条对照）

`structureFactor(structure, {h,k,l})` 用 Waasmaier–Kirfel 五高斯系数算 f0(sinθ/λ)，
再对原子求和得 F(h)（仅 f0，忽略色散与 Debye–Waller）。系数取自 VESTA `-calcf` 时打印的同一组值。

与 VESTA 表的对比：

| 体系 | 比较反射数 | 最大相对偏差 | 说明 |
|---|---|---|---|
| Si-fcc | 530 | **1.7%** | VESTA 含 Si 的色散修正（f′ ≈ +0.08），我们只用 f0 |
| C2 | 1642 | **0.11%** | C 的色散修正极小（f′ ≈ 0.003），几乎完全吻合 |

d 值逐条精确一致（(111) 3.175426、C2 (100) 2.1339）。

**一个被测试抓住的错误**：我最初硬编码的 C 系数有两位写错（`a4` 符号、`c` 数值），`f0(0)` 得到 10.19 而不是 6。
现在单测直接断言 `f0(0) == 原子序数`——这类系数错误以后不会再溜过去。

单元测试：`node --test test/xray.test.mjs`（5/5）。

### 色散修正（f′/f″）后与 VESTA 几乎完全一致

`structureFactorDispersive(structure, {h,k,l})` 在每个原子贡献上加 `(f0 + f′ + f_NT) + i·f″`，
系数取自 VESTA 在 λ = 0.070932 nm 时打印的值（`XRAY_DISPERSION`）。

| 体系 | 反射数 | \|F\| 最大相对偏差 | Re(F) 最大相对偏差 |
|---|---|---|---|
| Si-fcc | 414 | **3.3×10⁻⁶** | 8.5×10⁻⁸ |
| C2 | 1642 | **3.3×10⁻⁶** | 6.8×10⁻⁷ |

也就是说：不加色散时 Si 差 ~1.7%（正是 f′ ≈ 0.08 的影响），加上后偏差落到 VESTA 打印精度的量级——
这既验证了我们的相位求和，也验证了「残差确实来自色散」这个解释。

单元测试：`node --test test/xray.test.mjs`（7/7）。

### 工具入口：vesta_analyze(kind="calcf")

`VESTA -calcf` 的两处限制已由脚本处理：把输入复制到**无点临时目录**、并给 VASP4 写法的 POSCAR **自动补元素行**（否则 VESTA 只看到 `Xx`、散射因子全 0）。

实测（工具调用）：

| 体系 | 反射数 | d 范围 | 最强反射 |
|---|---|---|---|
| Si-fcc | 530 | 0.716 – 3.175 Å | (−1 −2 −1) \|F\| = 17.674 |
| 单层 C2 | 1642 | 0.701 – 25.000 Å | (0 0 ±1) \|F\| = 11.916（对应 25 Å 周期的层间距） |

C2 的最强反射是 (00l)，与「薄膜 + 大真空层」的层状结构一致——是个合理的物理自检。

## 散射因子元素扩展（自带采集器）

```bash
node scripts/harvest-form-factors.mjs Si O Na …
```

做法：为每个元素造一个最小立方单原子 POSCAR，让 VESTA 跑 `-calcf`，从它的文本区读 a1..a5 / c / b1..b5
（系数只取决于元素，与结构无关）。输出可直接粘进 `XRAY_FORM_FACTORS`。

当前表内 **19 个元素**：Si、C、H、B、N、O、Na、Mg、Al、P、S、Cl、K、Ti、Fe、Cu、Zn、Br、I。
每个都通过 `f0(0) == 原子序数` 的断言（Si 13.999/14、C 5.997/6、O 8.000/8、Fe 25.995/26 …）。

**过程中的一个坑**：PowerShell 的 `>` 重定向默认写 UTF-16LE，把采集结果保存成文件后再用 node 读会解析失败
（`SyntaxError: Expected property name`）。改成先收集到变量、再用 `UTF8Encoding($false)` 写文件。

### 工具入口：xray_powder

```
xray_powder(path="<结构文件>", lambda=1.5406, twoThetaMax=90, fwhm=0.15, out="…")
```

工具调用实测（真实 Si，a = 5.431）：

```
粉末图谱已生成：<输出目录>\tool-powder.html
λ = 1.5406 Å，9 个峰；最强峰 2θ = 28.442°，d = 3.1356 Å
```

页面内容：棒图 + 高斯展宽、只标注 I ≥ 5 的峰、悬停显示 hkl/2θ/d/强度、可存 PNG。

### 真实数据鲁棒性审计（85 个 CONTCAR）

用 `<本地 pilot 数据集>` 下的 **85 个真实 CONTCAR**（Na/B/C/N 体系）跑了一遍：

| 检查 | 结果 |
|---|---|
| 结构解析 | **85/85** 成功 |
| 体系组成 | C+Na 31、C 27、Na 8、B+C 6、C+N 5、B+C+Na 5、C+N+Na 2、B 1 |
| 原子数 | 1 – 98 |
| c 轴 | 4.076 – 30.000 Å |
| 散射因子覆盖 | **85/85**（补上 B 之后） |
| 粉末图计算 | **85/85** 成功 |

起初表里缺 **B**，含硼的 12 个结构无法算 XRD；用采集器补了 B、P、S、K、Ti、Zn、Br、I 后覆盖到 100%。

### 多窗口定向（pid 参数）

VESTA 每个文件一个窗口（各自一个进程）。`vesta_menu` / `vesta_control` / `vesta_capture` 现在支持 `pid`，
把命令精确作用到某个窗口——之前默认取「第一个主窗口」，多文件时容易错打到没有体积数据的那个窗口。

实测：只打开 `5.5/CHGCAR`（pid 4756）→ `vesta_menu(command=179, pid=4756)` 执行 Voronoi Integration →
该窗口文本区出现结果（此前对 POSCAR 窗口执行时文本区什么都没有）：

```
Integrated value of volumetric data over the unit cell: 1.187066, -0.001588
```

**这个数已经解释清楚**：VESTA 报的是**按 bohr³ 归一化**的积分，换算关系是

```
电子数 = VESTA 的积分值 × 6.748334        （6.748334 = 1/a₀³，即 1 Å³ = 6.748 bohr³）
```

两例交叉验证：

| 文件 | 我们的 ∫ρdV | VESTA 报 | VESTA × 6.748334 | 偏差 |
|---|---|---|---|---|
| 合成常密度（ρ=1/64，V=64 Å³） | 1.0000 e | 0.148185 | 1.0000 | 0.0002% |
| `5.5/CHGCAR`（真实） | 8.0000 e | 1.187066 | 8.0107 | 0.13% |

真实那份的 0.13% 来自 VESTA 自己的网格积分（它在边界处用插值/截断），量级可接受。
工具函数：`vestaIntegralToElectrons(value)`。

已知限制：`vesta_menu` 的 `window=dialog` 在多进程下仍可能落到别的窗口；此时请显式给 `pid`。
