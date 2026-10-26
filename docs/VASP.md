# VASP 解析与体检

> 从 README 拆出（v2.73.0）。文件格式、体检项、体积分析、吸附结构分析。

<!-- TOC -->
<details>
<summary>目录（28 节，点击展开）</summary>

- [任务体检（OUTCAR + 交叉核对）](#任务体检outcar-交叉核对)
- [批量出图（一个根目录 → 图集）](#批量出图一个根目录-图集)
- [收敛曲线（OSZICAR）](#收敛曲线oszicar)
- [多任务叠加对比](#多任务叠加对比)
- [INCAR 差异对比](#incar-差异对比)
- [任务表格导出（Markdown / CSV）](#任务表格导出markdown-csv)
- [体积文件格式（按 VESTA 手册 + VASP 文档补齐）](#体积文件格式按-vesta-手册-vasp-文档补齐)
- [一维线剖面（Line Profile，手册 14.13）](#一维线剖面line-profile手册-1413)
- [峰搜索（Peak Search，手册 14.14）](#峰搜索peak-search手册-1414)
- [电子密度派生量（手册 14.15）](#电子密度派生量手册-1415)
- [工具入口：volume_analyze](#工具入口volume_analyze)
- [OUTCAR 应力张量与逐原子受力](#outcar-应力张量与逐原子受力)
- [IBZKPT：不可约 k 点与对称性约化](#ibzkpt不可约-k-点与对称性约化)
- [跨文件带隙核对（DOS ↔ EIGENVAL）](#跨文件带隙核对dos-eigenval)
- [体检检查项文档化](#体检检查项文档化)
- [POTCAR ZVAL ↔ NELECT 自洽检查](#potcar-zval-nelect-自洽检查)
- [综合判语（体系类型 + 结果可用性）](#综合判语体系类型-结果可用性)
- [可执行建议（从体检结果直接给动作）](#可执行建议从体检结果直接给动作)
- [真实数据：未跑过的任务也能对比 INCAR](#真实数据未跑过的任务也能对比-incar)
- [板层分层与吸附高度（layerProfile / adsorbateHeight）](#板层分层与吸附高度layerprofile-adsorbateheight)
- [吸附位点自动判别（adsorbateSite）](#吸附位点自动判别adsorbatesite)
- [板层批量报表（slab-report）](#板层批量报表slab-report)
- [离散 Voronoi 电荷归属（Bader 近似）](#离散-voronoi-电荷归属bader-近似)
- [超胞构建（make-supercell）](#超胞构建make-supercell)
- [越界坐标与结构折叠（foldStructure）](#越界坐标与结构折叠foldstructure)
- [结构预检（check-structure）](#结构预检check-structure)
- [性能优化：voronoiCharges 快 8.8 倍](#性能优化voronoicharges-快-88-倍)
- [vasprun.xml 解析（VASP 的 XML 输出）](#vasprunxml-解析vasp-的-xml-输出)

</details>
<!-- /TOC -->

## 任务体检（OUTCAR + 交叉核对）

```
vasp_report(path="<任务目录>")
```

只读，从 OUTCAR 取最终能量（**取最后一次**：每个电子步都会打一次）、E-fermi、NELECT、
NBANDS、最大力、是否正常收尾、常见告警（ZBRENT/EDDDAV/TOO FEW BANDS/BRMIX/Error），
再用同目录文件交叉核对：

| 核对项 | 判据 |
|---|---|
| OUTCAR ↔ OSZICAR 能量 | 末行 `F=` 与 `free energy TOTEN` 差 < 1e-4 eV |
| DOSCAR 积分 ↔ NELECT | ∫DOS dE 到 E_f 与 OUTCAR `NELECT` 差 < 0.01 e |
| DOSCAR ↔ OUTCAR E-fermi | 差 < 0.01 eV |
| NBANDS | EIGENVAL 与 OUTCAR 一致 |

本机两个真实任务都是 7/7 通过（Si 的 CPU 7.0 s，C2 的 171.6 s）。

单元测试：`node --test test/outcar.test.mjs`（6/6：末值语义、头部、最大力、告警、交叉核对、缺文件报错）。

## 批量出图（一个根目录 → 图集）

```bash
node scripts/make-all.mjs --root <任务根目录> --out <输出目录> [--repeat 1,1,1] [--depth 3]
```

对每个含 `OUTCAR` 的任务生成三份 HTML（能生成什么取决于该任务有哪些文件）：

| 产物 | 来源 | 说明 |
|---|---|---|
| `structure.html` | `POSCAR`/`CONTCAR`（+ `CHGCAR`） | 三维结构；有电荷密度时自动叠等值面 |
| `dos.html` | `DOSCAR` | DOS 曲线（自旋极化镜像） |
| `bands.html` | `EIGENVAL` | 本征值/能带 + 带隙 |

顶层另写 `index.html`：按任务列出可点开的产物与带隙、以及生成失败时的错误摘要。

实测（`zzz` 根目录，2 个任务）：两份任务都是 结构 + DOS + 能带 三件齐全，带隙 0.657 / 0.774 eV，
index 页链接可点开。实现上是依次调用 `make-viewer-gl` / `make-dos` / `make-bands` 三个脚本，
不重复实现渲染逻辑；单个任务失败只记在该行「备注」里，不影响其它任务。

## 收敛曲线（OSZICAR）

```bash
node scripts/make-conv.mjs <OSZICAR> [--out conv.html] [--ediff 1e-6]
```

双面板：上图电子步能量（看是否走到平台），下图 `|ΔE|` 的对数刻度（看是否穿过 EDIFF）。
EDIFF 优先从同目录 `INCAR` 读，也可命令行指定；悬停显示步号/能量/ΔE，可存 PNG。

实测：`5.5` 11 个电子步，末步 ΔE = 6.6×10⁻⁷（EDIFF 1×10⁻⁵ 已穿过）；
`latticefine_C2` 34 个电子步，末步 ΔE = −8.6×10⁻⁹（EDIFF 1×10⁻⁸ 刚穿过）。

`make-all` / `vasp_batch` 现在每个任务多产一份 `conv.html`（4 件套：结构 / DOS / 能带 / 收敛）。

## 多任务叠加对比

```bash
node scripts/make-compare.mjs --root <根目录> --kind dos|conv --out compare.html [--names a,b] [--window 6]
```

- `--kind dos`：各任务总 DOS 叠在一张图（横轴 E − E_f），可切「归一化」比较形状；图例给出每个体系的 E_f 与是否自旋极化。
- `--kind conv`：各任务收敛曲线叠加，纵轴 `log10(E − E_final)`（默认对数——第一步常比终值高几十 eV，线性会把曲线压平），看谁收敛得快。

实测（`zzz` 根目录）：Si 11 个电子步收敛，C2 34 步；DOS 叠加能看到 Si 的带隙与 C2 在 E_f 附近的近零态密度。

曲线颜色固定轮转、图例常驻，便于两张图并排看。
### 对比视图的工具入口

```
vasp_compare(path="<根目录>", kind="dos"|"conv", names=[...], window=6)
```

与命令行 `make-compare.mjs` 同一实现；实测两者对同一输入产出的 HTML **逐字节一致**。

### 输入参数体检（INCAR / POTCAR / KPOINTS）

`vasp_report` 现在还会读同目录的输入文件，加三项检查：

| 检查 | 判据 | 说明 |
|---|---|---|
| ENCUT vs ENMAX | `ENCUT ≥ 1.3 × ENMAX(POTCAR)` | 常见经验阈值；不足时给出建议值 |
| k 网格 | 解析自动网格（Γ / Monkhorst） | 仅作信息展示，不判失败 |
| NBANDS 下限 | `NBANDS ≥ NELECT/2 + 原子数` | 低于此值可能少算空带 |

真实任务实测：

- `5.5`（Si）：ENCUT 300 eV = **1.22×ENMAX(245.345)** → 提示「常见建议 ≥ 319 eV」；
- `latticefine_C2`：ENCUT 520 eV = **1.30×ENMAX(400)** → 达标；k 网格 25×25×1 = 625 点。

单元测试：`node --test test/inputs.test.mjs`（5/5：INCAR 行内多标签与注释、POTCAR 多元素取极值、Γ/Monkhorst/line-mode 三种 KPOINTS）。

### 结构相关检查（板层 / 能量）

| 检查 | 内容 |
|---|---|
| 真空层 | 仅当 `c > 1.5·max(a,b)` 且真空 > 5 Å（判为板层模型）时给出；`≥ 10 Å` 视为合格 |
| 每原子能量 | `E(sigma→0) / 原子数`，便于跨体系粗比 |

实测：

- `5.5`（体相 Si）：不触发真空层检查，`-5.4196 eV/atom`；
- `latticefine_C2`（单层）：真空层 **25.00 Å**（c = 25.00，层厚 0.00），`-9.3146 eV/atom`。

单元测试：`node --test test/slab.test.mjs`（3/3：平板、体相、层厚计入真空）。

## INCAR 差异对比

```bash
node scripts/make-incar-diff.mjs --root <根目录> [--out incar-diff.html]
```

把根目录下多个任务的 INCAR 排成「标签 × 任务」表，取值不同的行高亮，顶部单独列出差异标签。
用于回答「这两个任务到底改了什么」。实测 `zzz` 根目录：30 个标签、26 个不同（ENCUT 300/520、
EDIFF 1E-5/1E-8、ISPIN 无/2、IVDW 无/12 等），ISIF 与 ISMEAR 相同则不标。

端到端测试：`node --test test/incar-diff.test.mjs`（临时目录 + 子进程，2/2）。

## 任务表格导出（Markdown / CSV）

```bash
node scripts/make-table.mjs --root <根目录> [--format md|csv] [--out table.md]
```

列：任务、E(sigma→0)、E/atom、E-fermi、带隙、直接/间接、ENCUT、ENCUT/ENMAX、k 网格、真空层、最大力、未通过项。
`make-all` / `vasp_batch` 现在会顺带在输出目录写 `table.md` 与 `table.csv`。

实测（`zzz`）：

| 任务 | E (eV) | E/atom | E-fermi | 带隙 | 类型 | ENCUT | ENCUT/ENMAX | k 网格 | 真空层 | 未通过项 |
|---|---|---|---|---|---|---|---|---|---|---|
| 5.5 | −10.8391 | −5.420 | 5.7730 | 0.657 | 间接 | 300 | 1.22 | 9×9×9 | | ENCUT vs ENMAX |
| latticefine_C2 | −18.6291 | −9.315 | −3.1586 | 0.774 | 直接 | 520 | 1.30 | 25×25×1 | 25.00 | |

## 体积文件格式（按 VESTA 手册 + VASP 文档补齐）

VESTA 手册 18.5.1 列出它支持的 VASP 体积文件：`CHG / CHGCAR / PARCHG / LOCPOT / ELFCAR`。
我们之前只认 `CHG / CHGCAR / .cube`，现已补齐并区分单位语义：

| 文件 | 数据含义 | 处理 |
|---|---|---|
| `CHG` / `CHGCAR` / `PARCHG` | ρ·V（电荷密度乘晶胞体积） | 除以晶胞体积 → e/Å³ |
| `ELFCAR` | 电子局域函数（无量纲，0–1） | **不除体积**，单位标「无量纲（ELF）」 |
| `LOCPOT` | 局域势（eV） | **不除体积**，单位标「eV（局域势）」 |

依据：VASP `CHGCAR` 页写明数据是 ρ·V 且「必须除以晶胞体积」；`LOCPOT` 页写明文件存的是局域势（eV）。
`ISPIN=2` 时 CHGCAR 的第二块是磁化密度，可用 `--vol-block 2` 查看（上一轮已加）。

**踩坑记录**：给测试文件补 import 时重复插入了 `mkdtempSync` 等三行，导致整个套件 `SyntaxError`。
已去重；现在 `volume` 套件 16/16。

单元测试：`node --test test/volume.test.mjs`（新增 4 条：PARCHG/ELFCAR/LOCPOT/陌生文件名）。

## 一维线剖面（Line Profile，手册 14.13）

```bash
node scripts/vesta-lineprofile.mjs <体积文件> --from "0,0,0" --to "0.25,0.25,0.25" \
     [--points 50] [--out profile.txt]
```

沿线段等步长采样（三线性插值 + 周期回绕），**输出格式与 VESTA 手册 14.13 一致**：

```
Si-fcc  line profile
Point 1:  0.00000  0.00000  0.00000
Point 2:  0.25000  0.25000  0.25000
50
 0.000000E+000  -1.845137E-001
 4.860347E-002  -1.663318E-001
 ...
```

第一列是距点 1 的**笛卡尔距离（Å）**，第二列是插值值。`5.5/CHGCAR` 沿 Si–Si 的实测：

- 线段长 **2.38157 Å**——与 VESTA `-list bond` 报的键长一致（距离列自洽）；
- 首尾值都是 −0.1845（原子上），最大值 0.5599 在 0.923 Å 处——与上一轮确认的"该 CHGCAR 峰位异常"一致。

单元测试：`node --test test/lineprofile.test.mjs`（4/4：线性插值、Si–Si 长度、VESTA 文本格式、点数回退）。

## 峰搜索（Peak Search，手册 14.14）

```bash
node scripts/vesta-peaks.mjs <体积文件> [--max 20] [--threshold 0.1] [--out peaks.txt]
```

流程：找网格局部极大（26 邻域）→ 每个体素归给最近的峰 → 按归属累加 ρ·dV 与体素数，
输出分数坐标、峰高、**积分电子数**、**Voronoi 体积**，版式与 VESTA 手册 14.14 的样例一致。

`5.5/CHGCAR` 实测：20 个峰，整胞积分 8.0000，各峰电子之和 8.0000（守恒差 3.8×10⁻¹⁴）。

**一个必须注意的离散化问题**：等距边界上的体素如果简单归给"第一个最近峰"，对称结构会被系统性偏置
（我第一版对两个对称高斯峰得到 320 vs 192 个体素）。现在遇到等距时**按并列数均分**，
两个对称峰各得一半，守恒仍然成立。

单元测试：`node --test test/peaks.test.mjs`（4/4：单峰守恒、双峰对称、maxPeaks、VESTA 版式）。

## 电子密度派生量（手册 14.15）

```bash
node scripts/vesta-density-derived.mjs <CHGCAR> [--out-he energy.ted] [--out-lap lap.led]
```

按手册给出的公式（原子单位 ℏ²/m = 1，λ = 1/72，k = 1/6）由 ρ 计算：

```
g   = (3/10)(3π²)^(2/3) ρ^(5/3) + λ|∇ρ|²/ρ + k·∇²ρ/2
ν   = (1/4)∇²ρ − 2g
h_e = g + ν
```

- ∇²ρ 用分数坐标的度量张量算：`∇²ρ = Σ_ij G^{ij} ∂²ρ/∂f_i∂f_j`，`G_ij = a_i·a_j`（立方胞退化为普通二阶差分）；
- 单位按手册表 14.1：**g / ν / h_e 为 E_h·a₀⁻³，∇²ρ 为 a₀⁻⁵**；
- `--out-he/--out-lap` 写 VESTA 的 general volumetric 文本格式（N+1 网格、z 最快），可直接在 VESTA 里打开。

`5.5/CHGCAR` 实测：

| 量 | min | max | mean |
|---|---|---|---|
| ∇²ρ | −0.867 | 1.620 | −0.0078 |
| g | −0.0319 | 0.172 | 0.00934 |
| ν | −0.158 | 0.112 | −0.0206 |
| h_e | −0.187 | 0.249 | −0.0113 |

解析校验：`ρ = 2 + cos(2πx)` 的 ∇²ρ 与 `−(2π)²cos(2πx)` 相对误差 **< 1%**（32³ 网格的离散误差）。

**两个已知边界**：ρ ≤ 0 的点（FFT 噪声）派生量置 0；h_e 的负值表示共享型（共价）相互作用、正值表示闭壳层型——但本机这份 CHGCAR 的峰位本就异常，数值不宜作物理结论。

单元测试：`node --test test/derived.test.mjs`（4/4：cos 波 Laplacian、均匀密度 TF 项、h_e 恒等、文本往返）。

## 工具入口：volume_analyze

```
volume_analyze(path="<体积文件>", kind="slice"|"profile"|"peaks"|"derived", ...)
```

实测（`5.5/CHGCAR`）：

| kind | 返回 |
|---|---|
| `peaks` | 整胞积分 8、峰位与每峰电荷（`maxPeaks=5` 时只列 5 个） |
| `profile` | 0,0,0 → 0.25,0.25,0.25：线段长 **2.38157 Å**，最大 0.5599 @ 0.9235 Å |
| `slice` | 生成 HTML；xy 面 @0.25 量程 −0.1845 → 0.5038，均值 0.2471 e/Å³ |
| `derived` | ∇²ρ −0.867 → 1.620；g −0.0319 → 0.172；h_e −0.187 → 0.249（E_h·a₀⁻³） |

**实现上补的一环**：`runNodeScript` 原来要求子进程 stdout 是**纯 JSON**；而 `vesta-peaks` / `vesta-lineprofile` /
`vesta-density-derived` 会先打印人类可读摘要。现在解析器会退一步取「最后一个 `{` 开头的块」，
并给这三个脚本补了结构化 JSON 输出（`peakCount`、`out`、`outHe/outLap`）。

### vesta_analyze：配位多面体（kind="poly"）

`-list poly` 的输出也在文本区，现已解析成结构化指标。`5.5/POSCAR` 实测：

```
VESTA 列出 1 个配位多面体
  Si1：配位数 4，平均键长 2.3816 Å
    体积 6.9323 Å³　畸变指数 0　二次伸长 1
    键角方差 0 deg²
```

这几项是标准的配位几何畸变指标（Robinson 等的 distortion index / quadratic elongation / bond angle variance）。
完美 Si 四面体的畸变指数 0、二次伸长 1.0，与实测一致。

单元测试：`node --test test/poly.test.mjs`（2/2）。

## OUTCAR 应力张量与逐原子受力

`parseOutcar` / `vasp_report` 现在还会读：

- **应力张量**：最后一条 `in kB` 行（6 个分量），以 `应力张量` 检查项列出，并给出最大 |σ|；
- **逐原子受力**：最后一个 `TOTAL-FORCE` 块的每个原子力大小，`平均力` 检查项同时给出原子数。

`5.5` 实测：

```
应力张量  -15.76 / -15.76 / -15.76 / 0.00 / 0.00 / 0.00 kB（最大 |σ| = 15.76）
平均力    0.00e+0 eV/Å（2 个原子）
```

（该任务是理想 Si-fcc 单点，受力严格为 0；静水压 −15.76 kB 来自 a=5.5 Å 略大于平衡晶格常数。）

**过程记录**：这轮给测试文件追加用例时踩到编码往返问题——追加的中文变成了乱码，导致 `SyntaxError`。
已把 `test/outcar.test.mjs` 整个重写为干净的 UTF-8，10/10 通过；并用脚本扫描了全部测试文件确认没有残留乱码。

单元测试：`node --test test/outcar.test.mjs`（10/10，新增应力张量、平均力、检查项三条）。

## IBZKPT：不可约 k 点与对称性约化

`inspectTask` 现在会读同目录 `IBZKPT`，新增检查项 `k 点约化`：IBZ 点数、权重和（= 完整网格点数）、
约化倍数，并与 OUTCAR 的 `NKPTS` 交叉核对。

两个真实任务：

| 任务 | IBZ 点 | 权重和 | 约化倍数 | 与 NKPTS |
|---|---|---|---|---|
| `5.5`（9×9×9） | 35 | 729 | 20.83× | 一致（35） |
| `latticefine_C2`（25×25×1） | 313 | 625 | 2.00× | 一致（313） |

729 = 9³、625 = 25×25×1，与我们解析的 KPOINTS 网格完全对得上——这是一条不依赖外部工具的**内部一致性**校验。

单元测试：`node --test test/ibzkpt.test.mjs`（3/3：权重和、行数不足、非法点数）。

## 跨文件带隙核对（DOS ↔ EIGENVAL）

`inspectTask` 新增检查项 `带隙一致性（DOS ↔ EIGENVAL）`：用 DOSCAR 判带隙（Ef 以下最后一个有态点 → Ef 以上第一个有态点，阈值取 DOS 峰值的 2%），
与 EIGENVAL 的带隙比较，容差取 1.5 倍能量格距（或至少 0.05 eV）。

| 任务 | DOS 带隙 | 能带带隙 | Δ | 能量格距 | 判定 |
|---|---|---|---|---|---|
| `5.5`（Si） | 0.615 eV | 0.657 eV | 0.042 | 0.077 | ✅ 一致 |
| `latticefine_C2` | 0.759 eV | 0.774 eV | 0.015 | 0.126 | ✅ 一致 |

两份**独立文件**用不同算法得到的带隙在格距内吻合——这比单看一份文件更能说明解析没有系统性偏差。

单元测试：`node --test test/dosgap.test.mjs`（4/4）。

## 体检检查项文档化

`docs/CHECKS.md` 现在是体检项的**唯一清单**：16 个检查项按「运行与告警 / 输入参数 / 结构 / 跨文件一致性」分组，
每项写明数据来源、判据与失败含义。`test/checks-doc.test.mjs` 做双向防漂移：

- 代码里新增了 `checks.push({ name })` 但文档没写 → 测试失败；
- 文档里写了某个检查项但代码里已删 → 测试失败。

两个真实任务的实际计数（与文档一致）：

| 任务 | 检查项 | 通过 | 失败 |
|---|---|---|---|
| `5.5` | 15 | 14 | `ENCUT vs ENMAX`（1.22×，建议 ≥ 319 eV） |
| `latticefine_C2` | 16 | 16 | — |

（`5.5` 少一项是因为它不是板层结构，不触发「真空层」检查。）

## POTCAR ZVAL ↔ NELECT 自洽检查

`inspectTask` 新增检查项：从 POTCAR 读每个物种的价电子数 `ZVAL`，乘 POSCAR 里的原子数，
与 OUTCAR 的 `NELECT` 比较（容差 1e-3）。这条能抓出「POTCAR 与 POSCAR 物种/顺序不匹配」这类常见错误。

两个真实任务：`Si:4 × 2 = 8`、`C:4 × 2 = 8`，都与 `NELECT = 8` 一致。

顺带补了 `potcarElements` 的回退：部分 POTCAR 变体没有 `VRHFIN` 行，此时退而从 `PAW_PBE <元素>` 行取符号
（真实文件仍优先走 `VRHFIN`，实测 5.5 → `["Si"]`、C2 → `["C"]` 不变）。

## 综合判语（体系类型 + 结果可用性）

`vasp_report` 在逐项检查之后给出三行判语：电子结构、几何类型、自旋，以及一句「能不能直接用」。

分类是**启发式**（带隙 ≤0.05 eV 金属性、<2 eV 半导体、否则绝缘体量级），只用于快速判断，不作物理结论；
「关键项」包括收尾、SCF、能量、NELECT、E-fermi、NBANDS、ZVAL 这几类一致性检查。

两个真实任务的输出：

| 任务 | 电子结构 | 几何 | 自旋 | 判语 |
|---|---|---|---|---|
| `5.5` | 半导体（0.657 eV） | 体相/分子 | 非自旋 | 结果自洽；另有 1 项可复核（ENCUT vs ENMAX） |
| `latticefine_C2` | 半导体（0.774 eV） | 板层（含真空层） | 自旋极化 | **结果自洽，可直接使用** |

单元测试：`node --test test/summary.test.mjs`（8/8：金属/半导体/绝缘体、板层判定、自旋判定、三种判语分支）。

## 可执行建议（从体检结果直接给动作）

`vasp_report` 在判语之后列出「建议」，把检查项翻译成「改哪个参数、改成多少」：

| 触发项 | 建议内容 |
|---|---|
| ENCUT vs ENMAX | 把 ENCUT 提到至少 ⌈1.3×ENMAX⌉ eV |
| 真空层 | 板层真空不足 10 Å：加长 c 轴后重跑 |
| NBANDS 下限 | 把 NBANDS 提到至少 ⌈NELECT/2 + 原子数⌉ |
| POTCAR ZVAL ↔ NELECT | 检查 POTCAR 元素顺序是否与 POSCAR 物种行一致 |
| 带隙一致性（DOS ↔ EIGENVAL） | 确认两份文件同一次计算，或检查 NEDOS |
| k 点约化 | 确认目录没混入别的任务输出 |
| 计算收尾 / SCF 收敛 | 检查作业是否中断，必要时加大 NELM |
| 告警 | 按告警类型分别排查 |
| k 点密度（<20 点/原子，且非金属） | 建议加密网格后复核带隙与能量 |

`5.5` 实测只触发一条：`把 ENCUT 提到至少 319 eV（当前 1.3×ENMAX 规则）后重跑`；`latticefine_C2` 无建议。

单元测试：`node --test test/suggest.test.mjs`（7/7）。

## 真实数据：未跑过的任务也能对比 INCAR

用你 `<本地 pilot 数据集>\adsorption_tasks` 的 **32 个真实任务**跑了一遍：

```
任务数: 32　标签数: 27　差异标签: MAGMOM, NBANDS, NCORE
```

**过程中发现一个真实缺陷**：`scanTasks` 原来只用 `OUTCAR` 识别任务，而这批目录只有输入文件（INCAR/KPOINTS/POSCAR），
所以扫到 0 个任务、直接报「没有找到任何 INCAR」。现在 `scanTasks` 支持 `marker` 选项：

- 默认仍是 `OUTCAR`（保持既有行为）；
- `marker: 'INCAR'` 可识别「只有输入、还没跑」的任务目录，`make-incar-diff` 已改用它；
- marker 也匹配带后缀的名字（`OUTCAR.gz` 之类）。

差异结果本身也有信息量：32 个任务只有 `MAGMOM` / `NBANDS` / `NCORE` 三处不同，其余 24 个标签完全一致——
说明这批任务的参数控制是干净的。

单元测试：`node --test test/scantasks-marker.test.mjs`（3/3）。

## 板层分层与吸附高度（layerProfile / adsorbateHeight）

```js
layerProfile(structure, { axis: 'c', gap: 0.6 })        // 沿轴的层：z、成分、原子数、厚度
adsorbateHeight(structure, { adsorbate: 'Na', substrate: ['C'] })  // 吸附物到最近基底层的距离
```

用你 `adsorption_tasks` 里 **32 个含 Na+C 的真实构型**验证：

| 任务名标称 | 构型数 | 实测均值 | 极差 |
|---|---|---|---|
| h2.3 | 16 | **2.300 Å** | 0.000 |
| h3.0 | 16 | **3.000 Å** | 0.000 |

与任务名里的标称高度**最大偏差 0.000 Å**——包括 B/N 取代、单空位重构、bridge/hollow/top 等各种构型。

开发过程中被真实数据抓出的两个错误（都已写成回归测试）：

1. 最初用「层里只含基底元素」判据，**掺杂体系（碳层含 B/N）的层被整个排除**，于是 h2.3 组有一半返回 null，
   平均值算成 1.15 Å。改成「层里含至少一种基底元素、且不含吸附物」。
2. 吸附物与基底距离小于分层阈值（0.6 Å）时会被**并成同一层**，高度算成 9.3 Å。
   改成基底与吸附物**各自分层**，再取最近层。

单元测试：`node --test test/layer.test.mjs`（5/5）。

## 吸附位点自动判别（adsorbateSite）

```js
adsorbateSite(structure, { adsorbate: 'Na', substrate: ['C'], tolerance: 0.3 })
// → { sites: [{ site: 'hollow', neighbors: 6, distance: 1.42, … }], summary: 'hollow×1' }
```

判据：取最近基底原子的面内距离 d_min，统计距离 < d_min + tolerance 的原子数 —— 1 个 top、2 个 bridge、≥3 个 hollow。
面内距离按晶胞周期性取最小镜像。

用你 `adsorption_tasks` 里**任务名自带位点标签的 12 个构型**验证：

| 标签 | 判别 | 近邻数 | 最近距离 |
|---|---|---|---|
| top ×2 | top | 1 | 0.00 Å |
| bridge ×2 | bridge | 2 | 0.71 Å（= C–C 键长 1.42 的一半） |
| hollow ×8 | hollow | 6 | 1.42 Å（六元环中心；空位重构后 1.38 Å） |

**12/12 与任务名一致**——说明任务命名与几何是自洽的，也说明这个判别在真实掺杂/缺陷体系上可用。

单元测试：`node --test test/site.test.mjs`（5/5）。

## 板层批量报表（slab-report）

```bash
node scripts/slab-report.mjs --root <目录> [--adsorbate Na] [--substrate C] [--marker POSCAR] [--out table.md]
```

每个任务目录读一个 POSCAR/CONTCAR，输出一行：成分、原子数、位点、吸附高度、最近面内距离、真空厚度、c 轴。
默认同时写 Markdown 与同名 CSV。

对你 `adsorption_tasks` 的 32 个构型实测：

```
任务 32 个，含吸附物 32 个
位点统计：hollow 20，top 8，bridge 4
吸附高度：h2.3 组全部 2.300 Å，h3.0 组全部 3.000 Å
真空厚度：22.00 – 22.70 Å（c = 25 Å）
```

### 一个数据层面的观察（不是工具 bug）

12 个带 `top / bridge / hollow / hollow_control` 标签的构型与几何判别 **12/12 一致**；
但 8 个 `local_bond_midpoint` 构型几何上都是 **top 型**（最近碳 0.741 Å，次近 1.876 Å），
并不是「两个碳的中点」（真正的 bridge 会是两个 0.71 Å 等距近邻）。
这条留在报表里供你核对——可能是标签指的是「改性位置」而非「吸附位置」。

### 工具入口：slab_report

```
slab_report(path="<任务根目录或结构文件>", adsorbate="Na", substrate="C", marker="POSCAR", depth=2, out="…")
```

工具调用实测（你的 `adsorption_tasks`）：

```
板层报表：32 个任务，其中 32 个含吸附物
位点分布：hollow×20，top×8，bridge×4
已写出：<输出目录>\\tool-slab.md（同名 .csv 一并生成）
```

产物：Markdown 33 行（表头 + 32 行）、CSV 同样 33 行。

## 离散 Voronoi 电荷归属（Bader 近似）

```bash
node scripts/vasp-bader.mjs <CHGCAR 或任务目录> [--poscar POSCAR] [--out charges.csv]
```

做法：每个体素归给**最近的原子**（周期镜像下取最小距离，等距时按并列数均分），积分得每原子电荷与体积。
这是离散 Voronoi 近似，与真 Bader（用零通量面划分）会有小差异，但**总和必须等于 NELECT**，可作自检。

真实 `5.5/CHGCAR` 实测：

```
网格 48×48×48　原子 2
总电荷 8.0000 e　NELECT 8 e（差 7.45e-09）
元素     原子数   总电荷(e)     每原子(e)
Si          2       8.0000       4.0000
```

单个原子分别是 **3.9632 / 4.0368 e**（体积 20.17 / 21.42 Å³）——两者不完全相等，正是前面几轮查明的
「该 CHGCAR 峰位偏移」导致的；理想 Si-fcc 应当完全对称。

单元测试：`node --test test/bader.test.mjs`（5/5：守恒、对称原子等分、密度集中在某原子、缺原子报错、按元素汇总）。

### 工具入口：volume_analyze 的 charges

```
volume_analyze(path="<CHGCAR>", kind="charges", out="charges.csv")
```

工具调用实测（5.5/CHGCAR）：

```
每原子电荷（离散 Voronoi 近似）
总电荷 8 e，NELECT 8 e
  Si：2 个原子，每原子 4 e
已写出：<输出目录>\tool-charges.csv
```

CSV 内容：

```csv
index,symbol,charge_e,volume_A3
1,Si,3.963248,20.1735
2,Si,4.036752,21.4203
```

两种原子的差异（3.963 vs 4.037）来自该 CHGCAR 的峰位偏移，不是工具误差。

**一个被冒烟测试抓到的小缺陷**：`vasp-bader.mjs` 的 JSON 输出原本没有 `out` 字段，
于是工具拿不到路径、不报「已写出」。补上后恢复正常。

### 与 VESTA「Voronoi Integration of Densities」的语义差异

VESTA 的 Utilities → Voronoi Integration 弹的对话框是「Max. number of peaks」，
也就是说它**先找密度峰、再对每个峰的 Voronoi 胞积分**（手册 14.16），单位是「峰」；
我们的 `voronoiCharges` 是**以原子为中心**把体素归给最近原子，单位是「原子」。
两者都可以给出电荷归属，但**划分对象不同**，数值不可直接逐项比较：

- VESTA：峰的积分电荷 + 峰体积（适合分析成键/孤对电子的密度峰）；
- 我们：每原子电荷 + 原子体积（接近 Bader 的常用做法，适合电荷转移分析）。

若要做「同口径」对照，应当比较「按元素汇总的总电荷」——两边都满足「总和 = NELECT」这个守恒约束。

## 超胞构建（make-supercell）

```bash
node scripts/make-supercell.mjs <结构文件> --repeat 2,2,1 [--out SUPER.vasp]
```

分数坐标按 `(i+x)/n` 重排、晶胞向量按倍数放大，写出 VASP5 写法（带元素行）。

真实 `5.5/POSCAR` 实测：

```
原结构：2 原子，V = 41.594 Å³
超胞：16 原子（2×2×2），V = 332.750 Å³     ← 体积正好 8 倍
已写出：<输出目录>\si-222.vasp
```

回读校验：16 原子、体积 332.7500、**唯一坐标 16 个**（没有重复或丢失）、无越界坐标。

单元测试：`node --test test/supercell.test.mjs`（5/5：倍数增长、坐标范围与唯一性、物种顺序、非法倍数、往返一致）。

**为什么先做这个而不是结合能**：写输入文件是纯几何操作，可以用「原子数、体积、坐标唯一性、往返一致」四条硬指标验证；
而结合能依赖「孤立原子参考能量」，没有集群跑单原子就算不对——上一轮已经因此放弃过那条路。

## 越界坐标与结构折叠（foldStructure）

真实数据审计：85 个 CONTCAR 里有 **8 个含越界坐标**（共 34 个，最大偏离 −0.0021 ≈ −0.05 Å）——
VASP 允许原子跑出胞外，这类结构交给「按分数坐标投影」的分析会略偏。

`foldStructure(structure, { tolerance: 0.3, keepSymbol: true })`：

- 把分数坐标绕回 `[0,1)`（统计 `wrapped`）；
- 合并周期等价的重复原子（统计 `merged`，默认只合并同元素）。

`layerProfile` / `adsorbateSite` 内部已自行绕回，因此这类输入不会算到相邻周期。
回归测试覆盖：`1.515 → 0.515` 与直接写 `0.515` 得到**完全相同**的吸附高度。

单元测试：`node --test test/fold.test.mjs`（5/5）。

## 结构预检（check-structure）

```bash
node scripts/check-structure.mjs <结构文件 | 任务根目录> [--marker POSCAR] [--min-distance 0.5]
```

检查：晶胞体积与角度、原子数、坐标越界、原子重合（error）、原子过近（warning）。
有 error 时退出码为 1，可直接接进流水线。

真实数据实测：

| 数据 | 结果 |
|---|---|
| `5.5/POSCAR` | ✔ Si2，2 原子，V=41.59 Å³，最近原子 **2.382 Å**（= Si–Si 键长） |
| 85 个真实 CONTCAR | **85 个通过，0 个 error**；8 个带「坐标越界」提示 |

85 个结构的最近原子距离在 **1.367–1.420 Å**（石墨烯 C–C 键），物理上正确。
越界提示对应的正是上一轮查到的 34 个 −0.002 量级坐标。

单元测试：`node --test test/health.test.mjs`（5/5：正常、重合、过近、越界、零体积胞）。

### 工具入口：check_structure

```
check_structure(path="<结构文件或目录>", marker="POSCAR", minDistance=0.5)
```

工具调用实测：

```
# 单个结构
结构预检：1 个结构，0 个有 error
未发现问题

# 扫真实目录（marker=CONTCAR）
结构预检：3 个结构，0 个有 error
  bridge_relax\CONTCAR：5 个原子的分数坐标越界（VASP 可接受，但分析前建议 foldStructure）
  hollow_relax\CONTCAR：5 个原子的分数坐标越界（VASP 可接受，但分析前建议 foldStructure）
```

注意 `ok` 的语义：**只有 error 才让它为 false**，warning（越界/过近）不会——这与
`vasp_report` 的 `ok`（所有检查项都通过）不同，因为预检里的 warning 是"可接受但要留意"。

工具数现在 **20 个**，装配测试清单已同步（`tools.test.mjs` 会守住这一点）。

## 性能优化：voronoiCharges 快 8.8 倍

真实用例（51 原子板层 × 48³ 网格）实测：

| 版本 | 耗时 | 总电荷 |
|---|---|---|
| 原始（每体素构建数组、`Math.hypot`） | 2178 ms | 32.7552 |
| 中间版（8³ 分箱 + 字符串键 Map） | 2277 ms（更慢） | 32.7552 |
| 最终版（标量三遍扫描 + Float64Array） | **260 ms** | 32.7552 |

**分箱为什么没加速**：板层体系的原子集中在一层，8³ 分箱后 27 个邻格里几乎包含全部原子，
再加上 Map 字符串键的开销，反而更慢。真正的瓶颈是内层每对原子都 `new` 一个数组、再调 `Math.hypot`。

最终实现改成：
- 原子分数坐标预取到 `Float64Array`；
- 内层只用标量算术（`dx/dy/dz` → 三个笛卡尔分量 → `Math.sqrt`）；
- 三遍扫描：先求最小距离，再数并列，最后分摊（避免每体素构造候选数组）。

正确性保障：`test/bader-equivalence.test.mjs` 用一份**朴素全扫描参考实现**逐原子对比
（14 个原子 × 10³ 网格，含并列均分），电荷与体积差 < 1e-9；真实 CHGCAR 的 3.963248 / 4.036752 也未变。

### 峰搜索性能与一个单位 bug

`peakSearch` 也从「每体素构造候选数组」重写为标量扫描（环绕索引表 + Float64Array）：

| 用例 | 优化前 | 优化后 |
|---|---|---|
| 48³ CHGCAR，27 个峰 | 1340 ms | **132 ms** |

**优化过程中引入过一个真 bug**：`voxels` 累加时误用了「体积」而不是「体素个数」，
于是 4707 个体素显示成 1.7。真实数据一跑就暴露（体素之和 1.7 vs 应为 110592）。
修正后：**各峰体素之和 = 110592**（正好是网格总数）、电子之和 = 8.000000。

这条不变量已写成测试：`peakSearch` 的 `Σvoxels` 必须等于 `nx×ny×nz`——以后再改实现，单位错了会立刻红。

顺带说明：现在每峰电子数与早期记录（0.3488 / 4707）不同，是因为**并列体素均分**是后来加的；
总和仍是 8.000000，所以在总量口径上两版一致。

## vasprun.xml 解析（VASP 的 XML 输出）

之前我们只读 OUTCAR 等文本输出；`vasprun.xml`（[vasp.at/wiki/Vasprun.xml](https://vasp.at/wiki/Vasprun.xml)）一直是空白。这批 136 个真实任务每个都带它，于是补上。

```bash
node scripts/vasp-vasprun.mjs <vasprun.xml 或任务目录> [--out summary.json]
```

覆盖字段：版本、`<incar>`（只含显式设置项）、`<atominfo>`（物种/原子数/价电子）、k 点（scheme/divisions/列表长度）、每步 `e_0_energy`、`efermi`、`NBANDS`/`NELECT`、最后一个 `forces` 的**最大力**、最后一个 `stress` 张量、`finalpos` 的晶胞与分数坐标。

真实任务实测（51 原子 C₅₀Na₁）：

```
VASP 版本：6.1.1 19Jun20
价电子之和 207 e　NELECT 207　NBANDS 144
k 点：Gamma 3×3×1（列表 5 点）
能量块 306 个　离子步 18　终态能量 -466.47337299 eV
E-fermi -1.7280579 eV　最大力 1.910e-2 eV/Å
交叉核对：能量 Δ=0.00e+0　E-fermi Δ=4.21e-5 eV　终态坐标 Δ=4.90e-9（分数坐标）
```

### 体检里新增 4 项交叉核对

| 检查项 | 判据 | 116 个真实任务 |
|---|---|---|
| `vasprun 价电子 ↔ NELECT` | Σ(原子数×ZVAL) = NELECT | **116/116 通过** |
| `vasprun↔OUTCAR 能量` | \|Δe_0_energy\| < 1e-4 eV | **116/116 通过** |
| `vasprun↔OUTCAR 费米能级` | \|ΔE_F\| < 0.01 eV | 106/106 通过（其余任务无 E-fermi） |
| `vasprun↔CONTCAR 终态坐标` | 最大分数坐标差 < 1e-3 | 106/106 通过（其余任务无 CONTCAR） |

另有兜底：**OUTCAR 被截断、没有能量时，用 vasprun 的终态 `e_0_energy` 顶上**，并标注「能量来源」。

### 两个实现坑（都已写进测试）

1. 真实文件的标签在 `>` 前**有空格**（`<varray name="forces" >`），第一版正则写成 `name="forces">`，结果离子步数、物种、终态结构全为空；
2. 终态坐标必须和 **CONTCAR** 比，不能和体检里的 `poscar`（初始 POSCAR）比——第一版比错了对象，误报 2.9e-3 的偏差。

单元测试：`node --test test/vasprun.test.mjs`（5/5，含一份真实文件守门）。
