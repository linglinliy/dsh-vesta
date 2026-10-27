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

### 直接操作视图：鼠标/键盘注入（0.0.2）

之前只能「点菜单、点按钮、读文本区」，**转不了、缩不了、点不了原子**。0.0.2 补上了输入注入：
3D 视图是真正的 `wxGLCanvas` 子窗口，`PostMessage` 投递的鼠标消息与真实鼠标等价。

```bash
# 工具：vesta_input(action=drag|wheel|key|click|type, pid, …)
vesta_input(action="drag", pid=1234, dx=120)      # 旋转
vesta_input(action="wheel", pid=1234, delta=120, count=2)  # 放大
vesta_input(action="key", pid=1234, key="left", count=2)   # 方向键旋转（会先置前）
vesta_input(action="click", pid=1234, x=40, y=40)          # 点选
vesta_input(action="type", pid=1234, text="D:\\out.vesta", enter=true)  # 对话框打字
```

实测（Si 板层，视图 564×442）：

| 动作 | 消息 | 效果 |
|---|---|---|
| 拖拽 | `WM_LBUTTONDOWN 0x201` → `WM_MOUSEMOVE 0x200` → `WM_LBUTTONUP 0x202` | 视图旋转（前后截图哈希不同） |
| 滚轮 | `WM_MOUSEWHEEL 0x20A` | 放大/缩小 |
| 方向键 | `WM_KEYDOWN 0x100` / `WM_KEYUP 0x101` | 按 45° 步进旋转 |
| 点击 | 同拖拽的单点版本 | 点选/聚焦 |

**不需要窗口置前**（拖拽与滚轮），只有键盘需要 `SetForegroundWindow`。

#### 性能：常驻宿主（14 s → 137–294 ms）

最初每次动作都要新起 `powershell.exe` 并重新 `Add-Type` 编译 Win32 声明，实测**单次动作 14.7 s**——
完全谈不上「直接操作」。改成常驻宿主后：

| 阶段 | 实现 | 单次耗时 |
|---|---|---|
| 每次 spawn | 一进程一动作 | ~14 700 ms |
| 常驻宿主 | stdin/stdout 行 JSON，`Add-Type` 只编译一次 | 首包 ~4.2 s，之后 **137–294 ms** |
| 再加 viewport 缓存 | `viewport` 复合动作（主窗口+GL+客户区+DPI 一次拿到，缓存 10 s） | 拖拽 216 ms，滚轮 137 ms，按键 294 ms |

#### 两个必须记住的坑

1. PS 5.1 **只认 UTF-8 带 BOM** 的脚本，无 BOM 时中文直接语法错误；
2. `$Pid` 是只读自动变量，脚本参数必须换个名字（这里叫 `$ProcId`）。

#### DPI / 多屏

注入用**客户区坐标**，与屏幕缩放无关；但实测同一窗口的客户区会从 `564×442` 变成 `282×221`（2×），
所以尺寸**每次现取**（`viewport` 动作），坐标按比例（默认视图中心）计算，不缓存像素值。

### CLI 批量出图：`vesta_render`（0.0.2 / 0.0.3）

按「文本 + CLI」路线，出图完全不经过 GUI：

```bash
vesta_render(path="POSCAR", outDir="figs", scale=2, views=[
  {name="front"},
  {name="x30", rx=30},
  {name="y30", ry=30, scale=3},
])
```

每张图是一次 `VESTA.exe -open <结构> [-rotate_x N] [-rotate_y N] [-rotate_z N] -export_img scale=N <out.png> -close`，
跑完写 `manifest.json`：

```json
{
  "structure": "…/POSCAR",
  "structureSha256": "……（完整 64 位）",
  "executable": "…",
  "generatedAt": "…",
  "viewCount": 3,
  "renders": [{ "name": "x30", "out": "…/x30.png", "bytes": 373760, "scale": 2, "view": { "rx": 30 }, "ms": 1733 }]
}
```

本机实测（Si，窗口 706×553）：

| 视角 | 参数 | 产物 | 耗时 |
|---|---|---|---|
| 默认 | 无 | 237 KB（1412×1106） | 1.6 s |
| 绕 x 转 30° | `-rotate_x 30` | 365 KB | 1.7 s |
| 绕 y 转 30° | `-rotate_y 30` | 308 KB | 1.5 s |

**注意**：`-rotate_x/y/z` 不在官方手册第 17 章的命令表里，是实测可用的「非官方后门」。
换 VESTA 版本/平台前先跑一张小样确认；`viewToCliArgs` 只翻译非零角度，所以不传就与默认视图完全一致。

#### 已知瑕疵

`-export_img` 出的 PNG 偶尔底部有一条黑边（导出时窗口尚未完全布局完）。
批次出图时建议：① `scale>=2`；② 需要严格等尺寸时对产物做一次裁边或在 manifest 里记录实际像素。

### `.vesta` 场景模板（0.0.4）

`.vesta` 是 VESTA 的「文本剧本」：结构（`CELLP`/`STRUC`）、显示设置（`STYLE`/`ATOMT`/`BONDP`/`LIGHT*`/`BKGRC`）、
等值面设置（`ISURF`）、剖面（`SECTP`）全在同一个纯文本文件里。我们把这条链路做成了工具：

```bash
vesta_render(path="graphene.POSCAR", template="scene.vesta", outDir="figs", scale=2, views=[{name="front"},{name="x30", rx=30}])
```

流程：`parseVestaProject`（读模板）→ `buildVestaFromTemplate`（换结构、保留显示设置）→ CLI 出图 → `manifest.json`。

实测：用 Si 的 `scene.vesta` 当模板、换成石墨烯原胞，生成 `scene.vesta`（晶胞 2.46/2.46/15，γ=120°），
VESTA **直接接受**并输出 58 KB PNG；两个视角合计 3.3 s。

#### 纠正：`LMATRIX` 不是相机矩阵

`LMATRIX` 看起来像一个旋转矩阵（Si 立方晶胞时确实近乎正交），但**实测它不是视图朝向**：
把文件里的 `LMATRIX` 改成绕 x 轴旋转 30°（两种乘法顺序都试过），渲染结果与未修改时**逐字节相同**；
而命令行加 `-rotate_x 30` 才会改变视图。

结论：VESTA **不把相机存进 `.vesta`**，打开文件时总是用默认视角。所以：

- **视角**只能通过 CLI 的 `-rotate_x/-rotate_y/-rotate_z` 控制（确定性）；
- **样式/配色/边界/键参数**通过模板 `.vesta` 控制；
- 「固定视角的模板」= 同一份模板 + 同一组旋转参数。

#### 硬性要求：模板必须「完整」

用最小段集合手搓的 `.vesta`（只有 `CRYSTAL/CELLP/STRUC/STYLE`）VESTA **不接受**（不报错、也不出图）。
正确做法：先在 VESTA 里把样式调好、`File → Save As` 存一份完整 `.vesta` 当模板，之后只换结构。
测试里对应：`VESTA_SCENE_TEMPLATE=<模板路径> node --test test/scene.test.mjs`。

#### 已知限制

- 只支持 VASP 结构（`POSCAR/CONTCAR`）作为替换源；CIF 需先转换；
- `SBOND`（成键搜索）按新结构的元素对重新生成，键长范围沿用模板默认（0–2.6 Å）；
- 模板里的 `LMATRIX` 原样保留，因此所有批次图的初始视角一致——需要不同视角时用 `views[].rx/ry/rz`。

#### 确定性视角：靠 `-rotate_*`，不靠文件

实测（同一份模板、同一台机器）：

| 实验 | 结果 |
|---|---|
| 同样的 `-rotate_x 30` 跑两次 | 输出 PNG **哈希完全相同** `b0a8b21fd941` → 确定性 ✓ |
| `-rotate_x 30 -rotate_y 20` vs `-rotate_y 20 -rotate_x 30` | 两张图**不同** → 旋转按参数顺序依次作用，不可交换 |
| 改文件里的 `LMATRIX`（绕 x 30°，两种乘法顺序） | 与未修改**逐字节相同** → 该字段不影响视角 |

因此「可复现的视角」= **模板 + 固定顺序的旋转参数**。
`viewToCliArgs` 固定按 x→y→z 输出，所以同一个 `{rx, ry, rz}` 永远得到同一张图；
反过来，若手工拼参数，顺序不同就会得到不同视角——这点必须写死在调用层。

### 撤销与重做（0.0.6）

VESTA 自己没有 undo 栈，但视图操作可以被**精确反演**——这是实测结论：

| 操作 | 反向操作 | 结果 |
|---|---|---|
| 拖拽 `dx=+120` | `dx=-120` | 截图哈希回到基线（`379d9edf16ab`） |
| 滚轮 `delta=+120 ×2` | `delta=-120 ×2` | 回到基线 |
| 方向键 `left ×2` | `right ×2` | 回到基线 |

所以实现上不需要 VESTA 支持 undo：记录每次输入，撤销时重放逆动作即可。

```bash
vesta_input(action="undo", pid=1234)   # 撤销上一次 drag / wheel / key
vesta_input(action="redo", pid=1234)   # 重做
```

细节：
- 历史按 pid 分开存；`click` 与 `type` 不可逆（点选/文本输入没有反向动作），撤销时会跳过；
- 键必须记录**解析后的键码**——早期版本存的是键名（`"left"`），求逆拿到 `NaN` 后静默跳过，
  导致「撤销」实际撤销了上一步，这是本轮修掉的真 bug（有单元测试守着 `inverseInput`）；
- 实测三步：拖拽 → 滚轮 → 方向键，连续两次 undo 精确回到中间两态的哈希，redo 也能回到最新态。

### 只截 3D 视口：`captureViewport`

整窗截图里文本区/状态栏会变，做「操作是否生效 / 是否还原」的哈希比对时是噪声。
`captureViewport(target, out)` 只截 `wxGLCanvas`（实测 565×442 / 95 KB），供撤销与自检使用。

### GUI 文件对话框：结论是「不做」，用 CLI 替代

这一项花了两轮，结论明确：**VESTA 的文件对话框没法用消息级自动化驱动**。

已确认的事实：

| 尝试 | 结果 |
|---|---|
| 找到对话框 | ✅ 顶层 `#32770`，标题 `Save As`，768×480 |
| 枚举其控件 | ✅ `ComboBoxEx32 → ComboBox → Edit` + `保存(&S)` / `取消` |
| 真实鼠标点文件名框 | ✅ 截图证明获得焦点（框内有光标） |
| `WM_SETTEXT` 写到 ComboBox / ComboBoxEx32 / Edit（6 个候选都试） | ❌ 文件名不变，保存后无文件 |
| `SendKeys` 打字（宿主内，含特殊字符转义） | ❌ 字符未进入对话框 |
| `BM_CLICK` 点保存（SendMessage / PostMessage 两种） | ❌ SendMessage 会阻塞超时；PostMessage 无动作 |

原因判断：wxWidgets 的文件对话框把文件名保存在**自己的内部缓冲**，不读子控件的窗口文本；
而 `SendKeys` 需要目标进程持有前台焦点，我们的常驻宿主是 detached 子进程，注入的按键不落到对话框里。

**替代方案（已在用且可靠）**：保存场景用 `-open … -save out.vesta`，出图用 `-export_img`，
两者都是 CLI，不需要对话框。所以「保存」这件事**不需要 GUI**，对话框缺口不影响可用性。

保留的能力（本轮新增，对其它场景仍然有用）：
`clickControlCenter`（点控件中心）、`clickpost`（非阻塞 BM_CLICK）、`realmouse`（真实鼠标点击控件中心）、
`type`（宿主内 SendKeys，带 `+ ^ % ~ ( ) { } [ ]` 转义）。

### 结构编辑：扩胞与变换矩阵（0.0.8）

VESTA 的扩胞在 GUI 里是 `Edit > Edit Data > Structure Parameters… → Transform… → Unit Cell Transformation`，
里面是 `Rotation matrix (P)`（新基矢 = P·旧基矢，det(P)>1 即扩胞）+ `Translation vector (p)`。
这个对话框**无法用消息驱动**（见下节），所以我们自己实现同一套语义：

```bash
vesta_edit(path="POSCAR", repeat=[2,2,1])                    # 扩胞
vesta_edit(path="POSCAR", matrix=[[2,1,0],[0,2,0],[0,0,1]])   # 任意整数矩阵
vesta_edit(path="POSCAR", substitute={from:"Si", to:"C"})     # 同位置换
```

实现要点：`transformStructure` 用 P 生成新基矢，再对每个原子在旧晶格里枚举整数平移、
把笛卡尔坐标映射回新晶胞，去重后取 |det(P)| 个像。实测：

| 变换 | det | 原子数 | 体积比 |
|---|---|---|---|
| `[[2,0,0],[0,2,0],[0,0,1]]` | 4 | 2 → 8 | 4.000 |
| `[[2,0,0],[0,2,0],[0,0,2]]` | 8 | 2 → 16 | 8.000 |
| `[[1,1,0],[0,1,0],[0,0,1]]` | 1 | 2 → 2 | 1.000 |

端到端验证：`vesta_edit(path=POSCAR, repeat=[2,2,1], open=true)` → 写出 `POSCAR-2x2x1.vasp` →
VESTA 打开后**它自己的文本区**列出 **8 行 Si**（原胞 2 行）。

#### 踩到的坑：VESTA 按文件名判类型

把输出命名成 `POSCAR-扩胞-2×2×1.POSCAR` 时，VESTA 弹 **"Invalid data! This file type is not supported."**；
改成 `POSCAR-2x2x1.vasp` 就正常。规则：

- 可识别的名字：`POSCAR`、`CONTCAR`（精确名），扩展名 `.vasp` / `.cif` / `.vesta` / `.cube` 等；
- 不认：自造扩展名（`.POSCAR`）；
- 文件名避免中文与 `×` 等符号。

### GUI 对话框：实测边界

| 能力 | 结果 |
|---|---|
| 找到 / 枚举对话框与控件 | ✅ 顶层 #32770，控件带 hwnd 与 id |
| 点按钮（SendMessage BM_CLICK） | ⚠️ 遇模态会阻塞，超时 |
| 点按钮（PostMessage BM_CLICK） | ✅ 不阻塞 |
| AttachThreadInput + SetFocus | ✅ 后台宿主也能把焦点给指定控件 |
| WM_CHAR 写文本框 | ⚠️ 部分控件接受（能让对话框流程走完），wx 文本字段不生效 |
| WM_SETTEXT 写文本框 | ❌ 读回也是空（wx 自绘控件不把文本放在窗口文本里） |
| SendKeys 打字 | ❌ 需要前台焦点，后台进程受限 |
| WM_COMMAND + 按钮真实 id（如 5100=OK） | ✅ 能关闭 wx 对话框 |
| 文件对话框（Save As）写文件名 | ❌ ComboBox 内部缓冲，消息写不进 |

结论：**对话框能开、能关、能点，但"输入数值"这一步不通**。凡是需要填数值的功能
（Edit Data 全家、Preferences、Volumetric Data、Bonds/Vectors/Lattice Planes）都改由**自己算 + 写文件**。

### 功能覆盖矩阵（截至 0.0.8）

> 历史版本。**最新可核查的总表见 [COVERAGE.md](COVERAGE.md)**（28 个工具 + 每项验证证据）。

| VESTA 功能 | 我们的路径 | 状态 |
|---|---|---|
| 打开/切换结构、多窗口 | `vesta_open` + pid/hwnd 定向 | ✅ |
| 旋转/缩放/点选 3D 视图 | `vesta_input`（PostMessage 注入） | ✅ |
| 撤销/重做视图操作 | `vesta_input(undo/redo)` 逆动作 | ✅ |
| 样式切换（球棍/空间填充/多面体/线框/棍） | 菜单 139–143 | ✅ |
| 显示模型/仅不对称单元/点面/体数据开关 | 菜单 136–138、144–146 | ✅ |
| 导出位图（含 scale） | CLI `-export_img` | ✅ |
| 保存工程 / 格式转换 | CLI `-save` | ✅ |
| 键长/键角/多面体/结构因子 | CLI `-list` / `-calcf` + 文本区 | ✅ |
| 场景模板（样式固定） | `.vesta` 文本 + `buildVestaFromTemplate` | ✅ |
| 扩胞 / 变换矩阵 / 元素替换 | `vesta_edit` + `transformStructure` | ✅ |
| 修改晶胞参数（a,b,c,α,β,γ） | 标度矩阵可覆盖正交情形；六方等非整数变换暂缺 | ⚠️ 部分 |
| 加原子 / 删原子 | 未实现 | ❌ |
| 改空间群 / 对称操作 | 未实现（需要空间群表） | ❌ |
| Preferences（背景色、光照、字体…） | 部分可用 `.vesta` 文本（BKGRC/LIGHT*） | ⚠️ 部分 |
| 等值面/剖面参数 | `.vesta` 的 ISURF/SECTP 段（可读，改后需验证） | ⚠️ 部分 |
| 粉末衍射 / Madelung / 结构因子 | 计算侧有（powder/calcf），对话框参数不可填 | ⚠️ 部分 |
| 矢量图导出、Export Data | 无 CLI 等价物，对话框不可填 | ❌ |
| 交互式测量（距离/角度） | 只能给数值（`-list`） | ⚠️ 部分 |

### 结构编辑补全（0.0.9）

0.0.8 只有扩胞/矩阵/元素替换，这一版补齐 VESTA `Edit Data > Unit Cell` 与结构增删：

| 操作 | API | 实测 |
|---|---|---|
| 改晶胞参数（a,b,c,α,β,γ） | `setCellParameters` + `latticeFromCellParameters` | a=5.6 → a1=(5.6,0,0)，其余参数不变 |
| 追加原子（分数坐标自动折回） | `addAtoms` | `[1.5,-0.25,0.5]` → `(0.5,0.75,0.5)` |
| 删除原子（按索引或元素） | `removeAtoms` | 删 Si → 0 个；删索引 0 → 剩 1 个 |
| 六方晶胞构造 | `latticeFromCellParameters` | γ=120° → a2=(-1.23, 2.130, 0) |

端到端（一次调用组合三种编辑）：

```
vesta_edit(path=POSCAR, cell={a:5.6,b:5.6,c:5.6}, substitute={Si→C}, add=[{Na,(0.5,0.5,0.5)}], open=true)
→ 3 个原子（C/Na），a=5.600
→ VESTA 打开后其文本区：3 行原子，元素 C、Na   ✓
```

覆盖矩阵相应更新：**加原子 / 删原子 / 改晶胞参数** 从 ❌/⚠️ 变为 ✅。
仍未做的：改空间群与对称操作（需要空间群表）、矢量图导出、Export Data、交互式测量。

### 空间群与对称展开（0.0.10）

VESTA 的「Apply symmetry operations」现在有等价实现，数据源就是 VESTA 自带的 `spgra.dat`（230 个群）。

```bash
vesta_edit(path="POSCAR", spaceGroup=227)   # 按 Fd-3m 展开不对称单元
```

实现分三步：

1. `parseSpaceGroupTable` 读 `spgra.dat`：每块是「群号 设置 15 标志 操作数 符号」+ 一行代码 + N 条操作（如 `-x+1/2,y+1/2,-z`）；
2. `symmetryOperationToMatrix` 把操作字符串转 3×4 增广矩阵（支持负号、分数平移、行尾多余逗号）；
3. `applySymmetry` 对每个原子套用「点群操作 × 点阵平移」，折回晶胞并去重。

**关键坑**：`spgra.dat` 只存点群操作，**不含面心/体心平移**，必须按符号首字母补：

| 首字母 | 平移 |
|---|---|
| P | (0,0,0) |
| A | (0,0,0),(0,½,½) |
| B | (0,0,0),(½,0,½) |
| C | (0,0,0),(½,½,0) |
| I | (0,0,0),(½,½,½) |
| F | (0,0,0),(0,½,½),(½,0,½),(½,½,0) |
| R | (0,0,0),(⅔,⅓,⅓),(⅓,⅔,⅔) |

另一个坑：同一群号在表里有多套设置（P/A/B/C/I/F/R），早期实现让后面的覆盖前面，导致「群 1」变成 R 心、P1 展开出 3 个原子。现在保留第一块（标准设置）。

实测（立方 a=5.431 的晶胞）：

| 输入（不对称单元） | 空间群 | 展开后原子数 | 期望 |
|---|---|---|---|
| Si (0,0,0) | 225 Fm-3m | 4 | FCC 4 ✓ |
| Si (0,0,0) | 227 Fd-3m | 8 | 金刚石 8a ✓ |
| Si (½,½,½) | 227 Fd-3m | 8 | 8b ✓ |
| Mg (⅓,⅔,¼) | 194 P6₃/mmc | 2 | hcp 2c ✓ |
| X (0.1,0.2,0.3) | 1 P1 | 1 | 不变 ✓ |

端到端：`vesta_edit(path=POSCAR, spaceGroup=227, open=true)` → 8 个 Si，VESTA 打开后其文本区确认 8 行。

覆盖矩阵更新：**改空间群 / 对称展开** 从 ❌ 变为 ✅。
仍未做：按对称性约化（把完整晶胞反推回不对称单元）、矢量图导出、Export Data、交互式测量。

### 对称约化：完整晶胞 → 不对称单元（0.0.11）

与上一节的展开互逆。实现在 `symmetryOrbit`（单个原子的轨道）+ `reduceBySymmetryTable`（每个轨道保留一个代表并报告多重度）：

```bash
vesta_edit(path="POSCAR", reduceSpaceGroup=227)   # 按 Fd-3m 约化
```

验证方式是**往返恒等**：`expand(reduce(expand(X)))` 与 `expand(X)` 的原子集合逐项相同。

| 输入 | 空间群 | 展开 | 约化 | 轨道多重度 |
|---|---|---|---|---|
| Si | 225 Fm-3m | 4 | 1 | 4 |
| Si | 227 Fd-3m | 8 | 1 | 8 |
| NaCl | 225 Fm-3m | 8 | 2（Na,Cl） | 4, 4 |
| X (P1) | 1 | 1 | 1 | 1 |

端到端：`vesta_edit(spaceGroup=227, reduceSpaceGroup=227, open=true)` → 先展开 8 个 Si、再约化回 1 个，
输出 `POSCAR-sg227_red227.vasp`；VESTA 打开后其文本区确认 **1 行 Si**。

多重度的含义：它就是该原子所在 Wyckoff 位置的 multiplicity（例如 227 的 8a、225 的 4a）。
VESTA 还会显示 Wyckoff 字母（a/b/c…），那需要 `wyckoff.dat` 的坐标表，本轮未做。

### SVG 矢量图导出（0.0.12）

VESTA 的 `Export Vector Image…` 只有 GUI，没有 CLI 等价物。但矢量图本来就可以由结构数据直接算出来，
所以这一版自己实现：`structureToSvg`（核心）+ `vesta_vector`（工具）。

```bash
vesta_vector(path="POSCAR", width=800, height=600, rx=20, ry=15, out="figure.svg")
```

实现要点：

1. 分数坐标 → 笛卡尔（用晶格矢量）；
2. 旋转矩阵按 **x→y→z** 顺序合成（与 CLI `-rotate_*` 的顺序一致，保证同一视角可复现）；
3. 正交投影到 xy 平面，缩放时**把晶胞角点一起纳入包围盒**（否则晶胞会跑出画布——这是第一版的 bug）；
4. 先画晶胞棱（12 条），再画键（按距离 + 元素半径判定，带容差），最后按深度排序画球；
5. 颜色与半径来自 `viewer/scene.js` 的 `ELEMENTS` 表（与 WebGL 查看器同一套，保证两种输出的配色一致）。

实测：

| 输入 | 原子 | 键 | 画布 |
|---|---|---|---|
| Si 原胞 | 2 | 1 | 800×600 |
| Si 2×2×1 超胞 | 8 | 8 | 900×700 |

验证方式：① 6 条单测（SVG 完整、圆/线计数、确定性、旋转改变输出但不改原子数、无 NaN、空结构不崩）；
② 用 headless Chrome 把 SVG 渲染成 PNG 做肉眼核对（见下图路径 `D:\calcf\si\supercell-vector.png`）。

覆盖矩阵更新：**矢量图导出** 从 ❌ 变为 ✅。

### Export Data 的等价实现：CIF 写出（0.0.13）

VESTA 的 `File > Export Data…` 也是对话框，但它要解决的问题（结构/数据落成文本）不需要 GUI：
结构可以用 `-save` 转格式（已有），也可以用我们自己的写出器，不依赖 VESTA 进程。

```bash
vesta_edit(path="POSCAR", repeat=[2,1,1], out="si-2x1x1.cif")   # 按扩展名写 CIF
vesta_edit(path="POSCAR", out="si.vasp")                        # 写 POSCAR
```

`structureToCif` 写出 P1 设置的 CIF：晶胞六个参数 + 体积、`_symmetry_space_group_name_H-M 'P 1'`、
逐原子的 `_atom_site_label/type_symbol/fract_x/y/z/occupancy`。

**验证方式是让 VESTA 自己读回来**：our.cif → `VESTA -open our.cif -save back.POSCAR` → 我们的解析器比对。

| 输入 | CIF 原子 | VESTA 转回 | 晶胞 | 体积 |
|---|---|---|---|---|
| Si 原胞 | 2 | 2 个 Si | a=3.840，α=60° | 40.05 ų |
| Si 2×1×1 | 4 | 4 个 Si | a=7.681 | 80.10 ų |

覆盖矩阵更新：**Export Data（结构侧）** 从 ❌ 变为 ✅；体数据侧的「导成文本/CSV」仍待做。

### 体数据导出（0.0.14）

VESTA 的 `Export Data…` 数据侧（把 2D 切片 / 线剖面导成数值）同样是对话框，所以自己实现：

```bash
volume_export(path="CHGCAR", kind="slice", plane="xy", at=0.5)    # → slice-xy.csv
volume_export(path="CHGCAR", kind="profile", from="0,0,0", to="0.5,0.5,0.5", points=50)  # → profile.txt
```

- `volumeSlice`：按 `xy/yz/zx` 取层（位置是分数坐标，四舍五入到最近的格点），返回 2D 数值网格；
- `volumeSliceCsv`：第一列行索引、首行列表头，另附 `# unit=` 与切面位置两行注释；
- `volumeProfileText`：两列（距离 Å + 数值），复用已有的 `lineProfile` 三线性插值。

实测（真实 CHGCAR，48×48×48）：

| 输出 | 规模 | 校验 |
|---|---|---|
| xy 切片 CSV | 48×48 = 2304 个数值 | CSV 行数 = 48 + 3（表头 + 2 行注释）✓ |
| 线剖面 TXT | 6 点（0,0,0→½,½,½） | 距离严格递增、数值有限 ✓ |

覆盖矩阵更新：**Export Data（数据侧）** 从 ❌ 变为 ✅。

### 测量：距离/角度/点击拾取（0.0.15）

VESTA 里量键长是「点两个原子看距离」，纯 GUI。等价实现：

```bash
vesta_measure(path="POSCAR", distance=[[0,1]])                  # 直接给原子索引
vesta_measure(path="POSCAR", angle=[[0,1,2]])                   # 量 ∠i-j-k（j 为顶点）
vesta_measure(path="POSCAR", clicks=[{x:156,y:412},{x:300,y:300}],
              view={rx:20, ry:15, width:800, height:600})        # 画布点击 → 拾取原子 → 量距离
```

实现分三层：

1. `structureProjection`：与 SVG 导出同一套数学（旋转 x→y→z、正交投影、把晶胞纳入包围盒），
   返回每个原子的屏幕坐标与绘制半径；
2. `pickAtom`：点击点落在「原子半径 × 容差」内才算命中，多个命中取最近；
3. `measureDistances` / `measureAngles`：用晶格矢量把分数坐标转成笛卡尔后算距离与夹角。

实测：

| 检查 | 结果 |
|---|---|
| 金刚石 Si 最近邻 | **2.3517 Å**（文献 2.35 Å）|
| 立方晶胞沿 a、b 的近邻夹角 | 90.000° |
| 点原子中心 | 命中 `index=0, symbol=Si` |
| 点空白 (2,2) | `null` |
| 点原子圆内偏 1 px | 命中该原子 |

覆盖矩阵更新：**交互式测量** 从 ⚠️ 变为 ✅（数值侧完全等价；差别是"点哪里"由我们自己的投影决定，
而不是 VESTA 窗口里的像素——因为 VESTA 的相机不落盘）。

### 哪些 `.vesta` 显示参数真的生效（0.0.16）

这一轮做了一次**逐项开关实验**：改一处参数 → 用 CLI 渲染 → 数像素。结论比猜靠谱：

| 字段 | 改法 | 结果 | 判定 |
|---|---|---|---|
| `BKGRC` | `255 255 255` → `255 0 0` | 渲染图角落像素变成 (255,0,0) | ✅ 生效 |
| `STYLE` 的 `MODEL` | `0` → `1` | 蓝色像素 11 912 → 45 011，球从球棍变大球 | ✅ 生效（1=空间填充）|
| `ATOMM` | `204 204 204 255` → `0 255 0 255` | 青色像素 1 → 854（有变化但不彻底） | ⚠️ 部分生效 |
| `ATOMT` 的颜色 | `27 59 250` → `0 200 0` | 绿/蓝像素数完全不变 | ❌ 被忽略 |
| `BONDP` 的颜色 | `127 127 127` → `255 0 255` | 品红像素始终 0 | ❌ 被忽略 |
| `ATOMP`/半径 | `1.18` → `3.50` | 像素数不变 | ❌ 被忽略 |

原因判断：VESTA 的**原子颜色与半径来自它自己的 `style.ini` 元素表**（全局配置），不是场景文件；
场景文件只保存"背景、显示模型、边界、等值面参数"这类状态。所以要改元素配色，得改 `style.ini`（会全局生效）
或走 GUI 的 Properties 对话框（已知不可驱动）。

因此工具里只暴露**确实生效**的两项：

```bash
vesta_render(path="POSCAR", template="scene.vesta", background=[255,0,0], model=1)
```

实现：`readSceneStyle` / `applySceneStyle` 只改 `BKGRC` 与 `MODEL` 两处，并在渲染后核对像素
（实测角落像素 = (255,0,0)，与写入一致）。

### 体数据显示：能开、能关、能调阈值（0.0.17）

上一轮验证了 `.vesta` 的背景色与显示模型，这一轮验证**体积相关**的参数，结论分两半：

**坏消息：`.vesta` 里的体积设置不起作用。** 把 CHGCAR 用 `-save` 存成场景后，
`IMPORT_DENSITY` 写的是相对路径（`../../../C:/…/CHGCAR`），命令行与 GUI 打开时都**加载不到体积**——
GUI 里 "Volumetric data" 整块是灰的；把 `SURFS`、`SECTS`、`ISURF` 的六个组合逐个改过再渲染，**输出逐字节相同**。

**好消息：直接用「打开数据文件 + 菜单/键盘」完全够用。**

| 操作 | 途径 | 实测 |
|---|---|---|
| 加载体数据 | `vesta_open` 直接打开 CHGCAR | 打开后 "Show isosurfaces" 默认勾选，等值面立刻可见 |
| 开关等值面 | 菜单 `145` | 黄色像素 2006 → 458（关掉） |
| 开关剖面 | 菜单 `144` | 同族开关 |
| 升降等值面阈值 | 键盘 `+` / `-` | 黄色像素 **17 → 1988**（+×3）→ **931**（-×6），画面哈希每次都变 |

因此新增工具：

```bash
vesta_volume_display(action="isosurface-toggle", pid=1234)
vesta_volume_display(action="level-up", pid=1234, count=3)
vesta_volume_display(action="sections-toggle", pid=1234)
```

每次动作前后各截一张 3D 视口，用**哈希是否变化**告诉用户「这次操作到底有没有生效」。

覆盖矩阵更新：**等值面/剖面显示控制** 从 ⚠️ 变为 ✅（阈值只能按键盘步进，精确设值仍需 GUI 对话框）。

### Wyckoff 字母（0.0.18）

VESTA 的结构表里会显示每个原子所在的 Wyckoff 位置（4a、8c…）。这一版从 VESTA 自带的
`wyckoff.dat` 解析出来并做指派：

- `parseWyckoffTable`：群头 → 每个位置「多重度 字母 位点对称」→ 坐标表达式列表；
- `assignWyckoff`：解出位置表达式里的自由参数，生成整个轨道（**含点阵平移**），
  判断原子是否落在轨道里；多个位置同时包含该点时取**多重度最小**（对称性最高）的那个。

实测（立方 a=5.431）：

| 空间群 | 坐标 | 指派 | 多重度 | 位点对称 |
|---|---|---|---|---|
| 225 Fm-3m | (0,0,0) | **4a** | 4 | m-3m |
| 225 | (½,½,½) | **4b** | 4 | m-3m |
| 225 | (0.1,0.2,0.3) | **192l** | 192 | 1 |
| 227 Fd-3m | (0,0,0) | **8a** | 8 | -43m |
| 227 | (½,½,½) | **8b** | 8 | -43m |
| 227 | (⅛,⅛,⅛) | **16c** | 16 | .-3m |
| 194 P6₃/mmc | (0,0,0) | **2a** | 2 | -3m |
| 194 | (⅓,⅔,¼) | **2c** | 2 | -6m2 |

两个关键坑：

1. `wyckoff.dat` 的坐标列表**只列点群轨道**（227 的 8a 只给 `(0,0,0)` 与 `(¾,¼,¾)` 两行，8 = 2×4 面心平移），
   所以生成轨道时必须乘上点阵平移；
2. 一般位置包含所有点，直接「坐标相等」会全判成一般位置——必须**在命中的位置里取多重度最小者**。

约化时自动带上字母：`vesta_edit(spaceGroup=227, reduceSpaceGroup=227)` → 输出
`约化 空间群 227 F d -3 m → 1 原子（Si a(8)）`。

### 公开测试数据（0.0.19）

之前的夹具都是自己合成的（Si 原胞等）。这一轮补了**公开数据库的真实结构**：

- 来源：**Crystallography Open Database（COD）**，文件头明确写着
  *"may be used within the scientific community so long as proper attribution is given"*；
- 三个样本：cod-1000000（C5H17AlN2O8P2，140 原子）、cod-1010363（C6H8CuFeN8，64 原子）、
  cod-9006316（声明 Fe2O3，实际展开 Fe24O32）；
- 原始 CIF 与本机 VESTA 转出的 POSCAR 都放在 `test/fixtures/public/`，
  来源与许可写在 `PROVENANCE.md`（含下载 URL 与 COD ID，引用要求随 CIF 头部文献）。

网络这条也摸清了：`raw.githubusercontent.com` **DNS 层面不可达**（ENOENT），
但 `gh-proxy.com` / `ghproxy.net` / `ghfast.top` 三个 GitHub 代理可用，COD 站点可直连。
以后要加公开夹具，走 COD 或这些代理。

测试里有个意外收获：cod-9006316 的 CIF 声明 Fe2O3，但转成 POSCAR 后是 **Fe24O32（Fe3O4 比例）**——
因为 CIF 里的占位率（occupancy）在转换时被忽略。这条差异被写成了断言，防止以后误以为解析错了。

### CIF 读取与占位率（0.0.20）

之前只会写 CIF、不会读。这一版补上 `parseCif` / `structureFromCif`，并把公开夹具真正用起来：

```bash
vesta_edit(path="cod-9006316.cif", out="maghemite.vasp")   # 直接读 CIF
```

实现要点（都是真实 CIF 逼出来的）：

1. **标准不确定度**：COD 坐标写成 `.55909(13)`，直接 `Number()` 会得到 `NaN` 并整行被丢；
   必须剥掉括号里的不确定度，还要支持 `.5` 这种省略前导零的写法；
2. **多个 `_atom_site` 循环**：cod-1000000 把 H 与重原子分成两个循环，早期实现只保留最后一个
   （结果只有 17 个 H）；现在累加，得到 35 个不对称单元原子；
3. **元素符号**：标签可能是 `Fe-oct`/`H1A`，要只取前导元素字母（含两字母元素），否则会得到 `Feoct`；
4. **对称操作来源**：CIF 自带 `_space_group_symop_operation_xyz` 时直接用（cod-9006316 有 192 条）；
   没有时按 `_space_group_IT_number` 回退到 `spgra.dat`；
5. **占位率**：每个展开后的原子保留 `occupancy`（cod-9006316 的 Fe-oct 是 0.83333，展开成 16 个八面体铁）。

实测（公开 COD 夹具）：

| CIF | 不对称单元 | 展开 | 组成 | 部分占位原子 |
|---|---|---|---|---|
| cod-9006316（γ-Fe₂O₃） | 3 | **56** | Fe24 O32 | 16（占位 0.833） |
| cod-1010363 | 6 | **64** | Cu4 Fe4 C24 N32 | 0 |
| cod-1000000 | 35 | **70** | P4 Al2 O16 H34 N4 C10 | 0 |

**（0.0.21 已修）** 早期 cod-1000000 只展开出 70 个原子，VESTA 转出的 POSCAR 是 140（正好 2 倍）。
根因是 `spgra.dat` 对某些群**只存了一半操作**（例如 P21/c 只列 2 条，完整群有 4 条），
所以「自己展开」会少一半原子。

修法：**CIF 没有自带 `_space_group_symop_operation_xyz` 时，交给 VESTA 自己转一次**
（`-open x.cif -save tmp.vasp`，再解析结果）。这样 `vesta_edit` 读 CIF 的原子数与 VESTA 完全一致：

| CIF | 转换后原子数 | 组成 |
|---|---|---|
| cod-1000000 | **140** | P8 Al4 O32 H68 N8 C20（与 VESTA 一致） |
| cod-1010363 | 64 | Cu4 Fe4 C24 N32 |
| cod-9006316 | 56 | Fe24 O32（含 16 个 0.833 占位） |

### 占位率导出（0.0.22）

0.0.20 能读占位率，但写出去就丢了。这一版补上：

- `structureToCif` 现在写 `_atom_site_occupancy` 列与 `_chemical_formula_sum`；
- 结构操作（`makeSupercell`、`transformStructure`）**保留原子上的附加字段**（占位率、标签），
  以前它们只复制 `{symbol, frac}`；
- `vesta_edit` 写 POSCAR 时会提示：*有 N 个原子是部分占位，POSCAR 不支持占位率，写出时已按满占位处理（写 .cif 可保留）*。

实测（γ-Fe₂O₃ 夹具）：

| 操作 | 结果 |
|---|---|
| 读 CIF | 16 个占位 0.83333 的八面体铁 |
| 扩胞 2×1×1 | 112 原子，其中 **32** 个带 0.83333 |
| 写 CIF | `_atom_site_occupancy` 列 + 32 行 0.8333 + `_chemical_formula_sum 'Fe48 O64'` |
| 写 POSCAR | 56 原子，但摘要明确提示占位率按满占位处理 |

### 占位率可视化（0.0.23）

占位率这条数据链最后一环是「看得见」。现在 SVG 导出会按占位率画：

- 满占位（≥0.999）：正常不透明度 0.92；
- 部分占位：不透明度 = 0.92 × 占位率（下限 0.18），并加**虚线边框**；
- 悬停提示里写明 `Fe occ=0.833`；返回值多一个 `partial` 计数。

`vesta_vector` 现在也能直接吃 CIF（之前只吃 POSCAR），所以 γ-Fe₂O₃ 这类带占位的结构可以一步出图。

实测（cod-9006316，γ-Fe₂O₃）：

| 指标 | 值 |
|---|---|
| 原子 / 键 | 56 / 125 |
| 部分占位 | **16**（低透明度圆 16 个、虚线 16 个、带 `occ=` 提示 16 个）|
| 对照（满占位 Si） | 低透明度 0、虚线 0 |

视觉核对：SVG 用 headless Chrome 渲染成 PNG（`D:\calcf\si\maghemite.png`），结构、晶胞、球棍都正常。

### 对称化：把近似对称的结构投射到理想位置（0.0.24）

DFT 弛豫后的结构常常「差不多」满足某个空间群，但坐标有 0.01–0.05 Å 的偏差。
VESTA 里有对称化功能，这一版自己实现：

```bash
vesta_edit(path="CONTCAR", symmetrize=227, out="ideal.vasp")
```

算法是**迭代投影**：对每个原子、每条对称操作 g，在当前结构里找 g(x) 最近的同种原子；
若距离在容差内，就用 g⁻¹ 把它拉回当前原子的参考系并累加，最后取平均。重复几轮，偏差被平均掉，
结构落到群的不动子空间上。

实测（金刚石 227，8 个 Si）：

| 阶段 | 与理想结构的最大偏离 | 说明 |
|---|---|---|
| 人工加噪声（±0.004 分数坐标） | 0.0188 Å | 模拟弛豫后的轻微畸变 |
| 对称化（4 轮） | **0.0000 Å** | 与理想结构逐原子完全一致（`toFixed(4)` 逐项相等）|

`maxShift` 报告的是最后一轮的最大位移（分数坐标），`iterations` 是实际轮数。

注意：这是**投影**而不是最小二乘精修——它保证结果严格满足对称性，但不会像精修那样同时优化晶胞参数。

### WebGL 查看器的占位率（0.0.25）

SVG 侧上一轮就按占位率调了透明度；这一轮把同一份数据接到 WebGL 查看器：

- `viewer/scene.js` 的 `buildScene` / `buildPeriodicScene` 原子对象带 `occupancy`；
- `scripts/make-viewer-gl.mjs` 把 `occupancy` 透传到 HTML 里的 `STRUCT`，并支持**直接读 CIF**（之前只吃 POSCAR）；
- `viewer/webgl-viewer.js` 里半径乘 `occupancy^(1/3)`——体积正比于占位率，等价于 VESTA 的「分数球」。

实测（cod-9006316，γ-Fe₂O₃）：

| 检查 | 结果 |
|---|---|
| 生成的 HTML 里 `occupancy` | 出现 **131** 次，取值 `0.83333` 与 `1` |
| 渲染 | 56 原子、Fe/O 双色、晶胞与坐标轴正常（截图核对）|
| 半径缩放 | 0.83333^(1/3) = 0.941，八面体铁比满占位的略小 |

说明：0.833 只让半径缩 6%，肉眼不显眼；这是「体积∝占位率」的必然结果。
要更醒目可以再叠加透明度（SVG 侧已这么做），WebGL 侧需要拆成两个 InstancedMesh，留作后续。

### 元素配色与半径：真正的开关是 `elements.ini`（0.0.27）

0.0.16 已经证明：改 `.vesta` 里的 `ATOMT`/`BONDP`/`ATOMP` **渲染结果不变**。
这一轮找到了真正生效的地方——VESTA 安装目录下的 **`elements.ini`**：

```
 14 Si  1.18  2.10  0.260    0.10596    0.23226    0.98096
    ↑Z ↑符号 ↑半径  ↑半径2 ↑半径3   ↑R(0–1)    ↑G        ↑B
```

`0.10596×255 = 27`、`0.23226×255 = 59`、`0.98096×255 = 250`——正好就是场景文件里 `ATOMT` 的 `27 59 250`。
也就是说：**场景里的 `ATOMT` 只是「抄」了一份元素表的值，VESTA 读场景时并不会采纳它。**

实测（只改 `elements.ini`，不动任何输入文件）：

| 阶段 | 绿色像素 | 蓝色像素 |
|---|---|---|
| 改前（默认 Si 蓝） | 26 | 13 449 |
| 把 Si 改成 `0 200 0` | **10 568** | **39** |
| 还原后 | 26 | 13 449 |

工具：`vesta_style`（list / set / restore）

```bash
vesta_style(action="list", symbols=["Si","Fe"])
vesta_style(action="set", symbol="Si", color=[0,200,0], radius=1.4)
vesta_style(action="restore")
```

安全约定：**第一次修改前自动备份**到 `elements.ini.dsh-backup`，`restore` 直接还原。
这是全局配置，改完要重启 VESTA 才生效（我们每次渲染都是新进程，所以立即看到）。

### 精确等值面阈值（0.0.28）

0.0.17 的结论是：VESTA 的等值面阈值只能用键盘 `+/-` 步进，GUI 对话框填不了数字。
但「精确阈值」这个需求本身可以被满足——只要有体积数据，就能把目标密度换算成渲染器要的百分比：

```bash
vesta_view(paths=["POSCAR"], volume="CHGCAR", isoValue=0.1, renderer="webgl")
# → 等值面阈值 0.1 → 第 36 百分位（原始换算 35.71%，渲染器限制 1–95%）
```

实现：`volumeValueAtPercent`（百分比 → 数值）、`volumePercentForValue`（数值 → 百分比，二分 + 线性插值）、
`volumeAboveLevel`（阈值以上的格点比例，回答「这个面大概包住多少体积」）。

实测（真实 CHGCAR 48³）：

| 检查 | 结果 |
|---|---|
| 分位往返 | 50% → 0.15694 → **49.99%** |
| 自洽性 | 取 90% 分位当阈值，阈值以上格点占 **10.01%** |
| 端到端 | `isoValue=0.1` → HTML 里 `isoPercent: 36`，摘要写明换算过程 |

边界说清楚：**VESTA 窗口里的等值面仍然只能步进**（那是 GUI 对话框的限制）；
要在 VESTA 里看到精确值做不到，但「按精确阈值出图」已经可以——用自己的渲染器。

### 显示边界 `BOUND`（0.0.30）

`.vesta` 的 `BOUND` 段控制「显示多少个晶胞」：

```
BOUND
0 1 0 1 0 1        ← 三个方向各一对 [起, 止]
```

实测（只改这 6 个数，其它都不动）：

| 边界 | 非白像素 | 文件大小 |
|---|---|---|
| `0 1 0 1 0 1`（默认） | 16 374 | 95 KB |
| `-1 2 -1 2 -1 2` | 8 874 | 87 KB |
| `0 2 0 2 0 2` | 10 318 | 86 KB |
| `-2 3 -2 3 -2 3` | 8 059 | 92 KB |

**结论要小心**：三组取值确实产出三份不同的图，说明 BOUND 被 VESTA 采纳；但范围变大时视图会自动缩小以装下更多晶胞，
所以「非白像素变少」并不代表原子变少——**像素数不能用来数原子**。这也是为什么这里只声称「字段生效」，不声称「原子数增加」。

工具入口（`vesta_render`）：

```bash
vesta_render(path="POSCAR", template="scene.vesta", boundary=[[-1,2],[-1,2],[-1,2]])
```

同时修掉一个**回归**：`vesta_render` 的执行体早就在读 `args.background`/`args.model`，但参数 schema 里没有这两项，
在 `additionalProperties: false` 下会被判为「不认识的参数」。现在 `background`/`model`/`boundary` 都在 schema 里，
并用「背景色改成红 → 渲染图角落像素 = (255,0,0)」重新验证通过。

### 最小二乘对称精修：连晶胞一起（0.0.32）

0.0.24 的对称化只处理**原子位置**（迭代投影）。但真实弛豫过的结构，**晶胞**往往也不满足对称约束
（比如立方体系 a/b/c 差 0.02 Å、γ 差 0.2°）。这一版补上晶胞侧的对称化：

```bash
vesta_edit(path="CONTCAR", symmetrize=227, refineCell=true)
```

做法是**度规张量投影**：晶格必须满足 `G = Rᵀ·G·R`（R 是每条操作的旋转部分，G = A·Aᵀ），
把所有操作的 `Rᵀ·G·R` 取平均，就是把 G **最小二乘投影**到对称不变子空间；再由 G 用 Cholesky 还原晶格矢量。

实测：

| 输入 | 结果 |
|---|---|
| 完美立方（a=3.84）经 1/221/225/227 | **完全不变**，偏差 < 1e-9 |
| 完美六方（a=2.95, c=4.68, γ=120°）经 194 | **完全不变** |
| 畸变立方 a=3.86 / b=3.82 / c=3.85、γ≈89.85° | → **a=b=c=3.8434**、α=β=γ=90°，偏差 1.2e-2 |

3.8434 正好在三者平均（3.8433）附近，符合最小二乘投影的预期。工具输出会写明晶胞改动与偏差量级。

**实现时踩的坑**：第一版把 `G·R` 写成了 `G·Rᵀ`（列行索引写反），结果置换型操作贡献全是 0——
连完美立方胞都被缩到 a/√3。这个 bug 只有用「完美晶胞必须原样不动」这条不变量才能发现，
用畸变胞测反而看不出（它也会“变小”）。

### 数值输入：真点击 + 虚拟键码（0.0.38）

目标：让「对话框里填数字」这类只有 GUI 的操作也能自动化。这一轮把**输入**这一半打通了，**提交**那一半还没通。

#### 已经证实的

| 手段 | 结果 | 证据 |
|---|---|---|
| `WM_SETTEXT` 写 wx 数值框 | ❌ 完全无效 | 工具栏区域像素差 0 |
| `WM_CHAR` 逐字符 | ❌ 无效 | 界面不变 |
| SendKeys 打文字 | ⚠️ 乱码 | 截图出现 `1......嗅`（`^a` 被当字面字符） |
| **真鼠标点击 + Ctrl+A 和弦 + 虚拟键码** | ✅ 能填 | 截图：第一格 `1`→`2`，第二格 `0`→`7` |
| **按 Tab 顺序连续填** | ✅ 能填整张表 | 填 1..9 后截图显示 `1 2 3 / 5 6 7 / 9 0 1`、p=`(4,8,0)` |
| `WM_GETTEXT` 读 wx 字段的值 | ❌ 读不出 | 字段里明明有值，读回始终 `""` |

关键细节（都是踩出来的）：

1. **窗口必须先置前**：不在前台时第一次点击只「激活窗口」，不会传给控件；所以先 `foreground`，再**点两次**。
2. **Ctrl+A 必须是和弦**：按下 Ctrl → 按 A → 抬 A → 抬 Ctrl。分成两次会把 `a` 当文字打进去。
3. **字符用虚拟键码**（0-9 = 48-57、`-` = 0xBD、`.` = 0xBE），布局无关；SendKeys 的文字映射不可靠。
4. **Unit Cell Transformation 的焦点顺序是交错的**：`P11, P12, P13, p1, P21, P22, P23, p2, P31, P32, P33, p3`
   （每个矩阵行后跟一个平移分量）。按这个顺序填，矩阵落到正确位置；
   之前按「前 9 个是 P」的假设填，就出现「只有第一列变成 2」的错位。

工具封装：宿主新增 `foreground` / `chord` / `vk` 三个动作；核心侧 `fillControlNumber(hwnd, value)`（单格）
与 `fillDialogFieldsInTabOrder(firstHwnd, values)`（按 Tab 顺序整表）。

#### 0.0.40 修正：之前两个结论都是错的

**错一：`WM_SETTEXT` 无效。** 实际上它对**可见**的矩阵输入框完全有效。0.0.38 那次之所以失败，是因为打到了
`Edit Data` 对话框里 80 个 Edit 中的**隐藏控件**（只有 29 个 visible）。教训：**先按 `visible` 过滤再动手**。

**错二：点 OK 后「提交链路不明」。** 其实 VESTA 会连续弹两个框，之前都没回答：

1. `Warning !` —— "The matrix you have given changes the unit cell volume. Are you sure you want to continue?" → 点 **是(&Y)**
2. `Additional lattice point(s) are included in the new unit-cell` → 点 **OK**

之后还要在 `Edit Data` 对话框点 **&Apply**（让改动落到结构上）和 **&OK**（关闭对话框）。

#### 0.0.40 的完整方案（纯 PostMessage，后台执行）

```bash
vesta_control(action="transform-cell", matrix=[[2,0,0],[0,2,0],[0,0,2]], pid=1234)
```

核心实现 `transformCellInVesta(pid, matrix)`，步骤固定且可复现：

1. 菜单 117 打开 Edit Data → 点 `Transform…`；
2. 用 **`WM_SETTEXT`** 按焦点顺序写 12 个字段（`P11,P12,P13,p1, P21,P22,P23,p2, P31,P32,P33,p3`）；
3. 点 `OK` → 点 **`是(&Y)`**（Warning）→ 点 `OK`（Additional lattice points）；
4. 点 `&Apply` → 点 `&OK`；
5. 返回每一步的日志。

**验证（VESTA 自己写的记录，最硬的证据）**：文本区出现

```
Transformation from standard setting 2a,b,c; 0,0,0
Transformation to standard setting   1/2a,b,c; 0,0,0
2a ( 1a)
```

以及 3D 视图从稀疏原胞变成 2×2×2 的 16 个原子（屏幕截图对比）。
整条链路**全程 PostMessage**：不抢前台、不移动光标、不占用键盘，用户可以在同一台机器上继续做别的事。

注意：`WM_GETTEXT` 仍然读不出这些 wx 输入框的值（读回始终为空），所以校验只能靠
**对话框截图**或**VESTA 自己的输出记录**，不要指望读取控件文本。
### 键鼠模拟的独立性（0.0.39）

问：这些模拟键鼠的操作能不能**独立**运行（不打扰用户、不要求 VESTA 在前台）？

答：**不能独立**。它走的是 Windows 的真实输入队列，因此有三个硬约束：

| 约束 | 具体表现 | 实测 |
|---|---|---|
| 必须置前 | 不在前台时第一次点击只激活窗口，输入不落到控件 | 加 `foreground` + 点两次才成功 |
| 会移动真实光标 | `SetCursorPos` + `mouse_event` | 操作期间光标跳到控件位置 |
| 会占用键盘 | `keybd_event` 是全局按键 | 按键期间用户打字会串进来 |

**已做的降干扰处理**（`saveenv` / `restoreenv`）：每次填值前记录**光标坐标 + 前台窗口**，结束后还原。
实测：光标 `40,120 → 40,120`、前台窗口原样返回；单格填一个数耗时约 **2.3 秒**。

**为什么不能真后台**（两条路都验过）：

| 后台方案 | 结果 | 证据 |
|---|---|---|
| `PostMessage`（WM_LBUTTONDOWN / WM_CHAR / WM_KEYDOWN） | ❌ 无效 | wx 数值框对 `WM_CHAR`/`WM_SETTEXT` 无反应；`clickat` 不产生真实焦点 |
| UI Automation 的 `ValuePattern`（真正后台设值） | ❌ 不可用 | 全树搜到该进程 **154** 个 UIA 元素，但 **0 个 Edit** —— 这个 wx 构建没把文本框暴露给 UIA |

所以「填数值」只能**独占式**执行：执行期间会抢前台、动光标、占键盘。
需要无人值守/并行的场景，仍然走**自算 + 写文件**（`vesta_edit` 的扩胞/矩阵/晶胞、`volume_export`、等值面精确阈值等）。

#### 一次值得记的坑

给 `saveenv` 加 `GetCursorPos` / `GetForegroundWindow` 时，只写了调用、**漏了 `DllImport` 声明**，
导致宿主脚本 `Add-Type` 编译失败 → 整个常驻宿主起不来（表现为「VESTA 在运行，但枚举窗口失败」）。
判据：直接跑 `powershell -File win/vesta-ui.ps1 -Action host` 喂一行 `{"action":"ping"}`，
应当返回 `{"ok":true,"ready":true}`；不返回就是脚本自身坏了。

### 后台数值输入与晶胞变换（0.0.40）

| 能力 | 手段 | 是否后台（不抢焦点） | 证据 |
|---|---|---|---|
| 往可见输入框写值 | `WM_SETTEXT`（PostMessage） | ✅ | 矩阵 12 格截图逐个正确 |
| 读输入框的值 | `WM_GETTEXT` | — | ❌ 对 wx 字段无效，读回恒为空 |
| 提交对话框 | `clickpost`（BM_CLICK 的 PostMessage 版） | ✅ | 菜单/按钮点击均已验证 |
| 完整晶胞变换 | `vesta_control(action="transform-cell")` | ✅ | 文本区出现 `2a ( 1a)`，视图变 16 原子 |
| 兜底输入（真键鼠） | `fillControlNumber` / `fillDialogFieldsInTabOrder` | ❌ 需前台 | 单格 2.3 s，光标/前台已做还原 |

**先试 PostMessage，不行再降级到真键鼠**——这与「四层模型」的建议一致：应用层最省事但会抢焦点，
系统消息层（PostMessage）对 VESTA 这类传统 Win32/wx 程序足够可靠，驱动层与硬件层完全不需要。

### PostMessage 优先、SendInput 兜底：实测边界（0.0.41）

按「能用 PostMessage 就用，不行才真键鼠」的策略，把 VESTA 的 GUI 操作逐类测了一遍，边界很清楚：

| 操作 | 手段 | 是否抢前台 | 结果 |
|---|---|---|---|
| 菜单命令 | `WM_COMMAND` | 否 | ✅ 100 条命令可枚举可执行 |
| 按钮点击（含模态确认框） | `BM_CLICK` 投递 | 否 | ✅ `OK` / `是(&Y)` / `&Apply` 都能点 |
| 对话框数值输入 | 投递点击拿焦点 + `WM_SETTEXT` | 否 | ✅ 12 格矩阵一次填对 |
| 读结构数据 | `WM_GETTEXT` 读文本区 | 否 | ✅ 晶胞参数、位点、变换记录都能读 |
| **表格行选中**（原子列表 `wxDataView`） | **投递点击**（`clickat`） | **否** | ✅ 选中后 `No.: 1/N`、行高亮 |
| 表格里的 Delete / 提交 | 投递点击 | 否 | ✅ 位点数 2 → 1 |

#### 三个必须记住的坑

1. **`Edit Data` 里有 6 个 `wxDataView`，5 个是 `visible=false`。** 不按 `visible` 过滤就会点到隐藏表，
   表现是「点了完全没反应」——我为此白试了好几轮。
2. **`wxDataView` 的行选中不吃 PostMessage。** 投递鼠标（多组坐标）、投递方向键、投递空格都试过，
   界面哈希一模一样；只有真实点击能选中。所以这是「SendInput 兜底」唯一必须用到的地方。
3. **删空结构会把 VESTA 窗口关掉。** 把最后一个位点也删掉时，窗口直接消失（曾让你看到「突然关闭」）。
   所以删之前先确认位点数 ≥ 2。

#### 固化的两个动作

```bash
vesta_control(action="transform-cell", matrix=[[2,0,0],[0,2,0],[0,0,2]], pid=…)   # 扩胞（纯消息）
vesta_control(action="delete-atom", row=0, pid=…)                               # 删一行（行选中用真点击兜底）
```

两者都做了**自我校验**：选行后比对对话框截图哈希，Delete 后也比对；没变化就换坐标/换按钮重试，
不靠“看起来应该成功了”下结论。真点击前会保存光标与前台窗口，结束后还原。

实测（同一窗口、全程不重开）：

```
窗口 pid=5744 | 初始 a=3.8403（2 位点）
扩胞 → a=b=c=7.68059（2 位点，16 原子）
deleteAtomInVesta(row=0) → 原子列表 hwnd=18162884(top=312) → 真实点击选中第 1 行(y=14)
                          → Delete(top=318) 生效 → &Apply → &OK
结果：位点数 2 → 1（8 原子）
```
### 0.0.42 更正：行选中**不需要**真点击

0.0.41 里我写“`wxDataView` 行选中必须真实点击”，**这是错的**。真正的原因是：

- `Edit Data` 里有 6 个 `wxDataView`，其中 **5 个 `visible=false`**；
- 我之前按“面积最大”挑表，挑到的全是隐藏表，投递点击自然毫无反应；
- 换成 **`visible=true` 且宽度 > 400** 的那个表后，**投递点击（`clickat`）直接就能选中行**（`No.: 1/16`、行高亮）。

对照实验（同一对话框、同一个可见表）：

| 策略 | 是否真实输入 | 选中结果 |
|---|---|---|
| `clickat` 纯投递 | 否 | ✅ 选中第 1 行 |
| 移动光标 + 投递点击 | 仅移动光标 | ✅（移动光标非必需） |
| 移动光标 + `SendMessage` 点击 | 仅移动光标 | ✅ |
| 投递 `Down` 键 | 否 | ✅（也能改选中） |

结论：**删原子、选行、Apply/OK 全部可以在后台完成**；真键鼠只剩“画布框选”这一类真正涉及 GL 拾取的操作才可能需要。

实测（纯投递，窗口 pid=11456）：16 → 15 → 14 → **13**，晶胞 `7.68059³` 不变。

