# 可视化

> 从 README 拆出（v2.73.0）。结构 / DOS / 能带 / 轨迹 / PDOS / 粉末 / 功函数。

<!-- TOC -->
<details>
<summary>目录（12 节，点击展开）</summary>

- [看 POSCAR 立体结构（三条路）](#看-poscar-立体结构三条路)
- [WebGL 查看器（主力，观感接近 VESTA）](#webgl-查看器主力观感接近-vesta)
- [等值面（CHGCAR / CUBE）](#等值面chgcar-cube)
- [DOS 曲线（DOSCAR）](#dos-曲线doscar)
- [能带 / 本征值（EIGENVAL）](#能带-本征值eigenval)
- [电荷密度差（两个 CHGCAR 相减）](#电荷密度差两个-chgcar-相减)
- [离子轨迹播放器（XDATCAR）](#离子轨迹播放器xdatcar)
- [PDOS（投影态密度，需要 LORBIT ≥ 11）](#pdos投影态密度需要-lorbit-11)
- [能带图上的高对称点标签](#能带图上的高对称点标签)
- [二维截面（对应 VESTA 的 2D Data Display）](#二维截面对应-vesta-的-2d-data-display)
- [X 射线粉末衍射（本地计算，无需 VESTA）](#x-射线粉末衍射本地计算无需-vesta)
- [功函数（LOCPOT）](#功函数locpot)

</details>
<!-- /TOC -->

## 看 POSCAR 立体结构（三条路）

| 路径 | 怎么用 | 状态 |
| --- | --- | --- |
| **交互式 HTML**（推荐，最完整） | `node scripts/make-viewer.mjs <POSCAR> --repeat 2,2,2 --out viewer.html`，双击打开：拖拽旋转、滚轮缩放、右键平移、双击复位，带晶胞框/成键/元素配色/标签/存 PNG | 已用无头 Chrome 截图验收（默认视角与旋转+放大各一张） |
| **DSH 三维面板** | `node scripts/poscar2view.mjs <POSCAR> --repeat 2,2,2` 生成 PDB，再把该路径交给 `sci_viz_structure` | 已验收：52 原子 / 16 原子与解析结果逐一对应，面板内可旋转缩放 |
| **真 VESTA** | `vesta_open` 打开，再用 `vesta_capture` 抓图；或 `vesta_menu` 执行任意菜单命令 | 已验收（见上） |

参数：`--repeat 2,2,2` 是扩胞（面板与 HTML 都不吃周期性边界，扩胞是把原子真的铺出来）；
HTML 查看器还支持 URL 参数 `?rx=45&ry=-25&zoom=2&fit=cell&labels=off`，便于分享固定视角。

无头渲染（不打开窗口、直接出 PNG，用于贴文档）：

```bash
node scripts/render-proof.mjs <POSCAR> --repeat 2,2,2 --rx 18 --ry 22 --out structure.png
```

> 注意：插件里的 `vesta_view` 工具做的是同一件事，但当前会话的插件模块缓存了旧版
> `core.js`，热重载不会重入依赖模块——**重启 DSH 后该工具即可正常使用**；
> 在此之前用上面的脚本（每次都是新进程，永远读最新代码）。

## WebGL 查看器（主力，观感接近 VESTA）

```bash
node scripts/make-viewer-gl.mjs <POSCAR> --repeat 3,3,1 --out 结构.html
```

单文件、离线（three.js r160 内联，MIT）、双击即开：

| 能力 | 说明 |
| --- | --- |
| 渲染 | 着色球（镜面高光）+ 圆柱键 + 两点光照 + 抗锯齿，与 VESTA 默认观感接近 |
| 五种模式 | 球棍 / 空间填充（vdW 半径）/ 棒 / **多面体**（配位凸包 + 棱线）/ 线框 |
| 结构信息 | 晶胞框、a/b/c 坐标轴（画在晶胞角上，带字母）、元素图例、原子标签开关 |
| 交互 | 拖拽旋转（turntable）、滚轮缩放、右键/Shift 拖拽平移、双击复位 |
| 出图 | 「存 PNG」按 2× 像素比渲染导出；URL 参数 `?rx=&ry=&zoom=&mode=&labels=&axes=` 可固定视角分享 |
| 扩胞 | `--repeat nx,ny,nz`，原子真的铺出来（不做周期性成键） |

> **板状结构别用 3,3,3**：如果晶胞 c 方向是真空层（如石墨烯 25 Å），沿 c 扩胞只会堆出几层孤立的片。用 `--repeat 3,3,1` 在面内扩。

已知差距（相对 VESTA）：没有等值面/体积数据、晶体形貌、空间群工具与周期性成键；多面体只给非 C/H 且配位数 4–12 的原子生成。轻量场景仍可用 2D 版
`scripts/make-viewer.mjs`（纯 Canvas、不支持着色与多面体，但文件更小）。

### 周期性成键（已补齐）

查看器现在按 VESTA 的方式处理边界：把跨晶胞的邻居作为 ghost 原子补进来，边界原子不再断键。
`make-viewer-gl` 的 JSON 输出里有 `ghostAtoms` 字段；原子数 > 1200 时自动退化为非周期（生成时间考虑）。

### 一次调用出 HTML（插件工具）

```
vesta_view(paths=[...], repeat=[3,3,1], renderer="webgl")
```

返回 PDB / CIF / **HTML** 三个路径。`renderer="webgl"` 时用子进程跑生成器
（Electron 宿主用 `ELECTRON_RUN_AS_NODE=1`，不依赖 PATH 里的 node），避免把 1.3 MB 的
three.js 塞进插件进程。`renderer` 省略时只出 PDB/CIF 供 `sci_viz_structure` 面板用。

## 等值面（CHGCAR / CUBE）

```bash
# 命令行
node scripts/make-viewer-gl.mjs <POSCAR> --vol CHGCAR --iso 12 --out 密度.html

# 或一次工具调用（插件）
vesta_view(paths=[...], volume="CHGCAR", isoPercent=12, renderer="webgl")
```

- **格式**：VASP `CHGCAR` / `CHG`（数值是 ρ·V，已除以晶胞体积换算成 e/Å³）、Gaussian `.cube` / `.cub`（保持文件原单位）。
- **网格**：按最长边降到 ≤56（CHGCAR 48×48×96 → 24×24×48），量化成 Uint8 后 base64 内嵌；HTML 仍是单文件。
- **算法**：marching tetrahedra（每个立方体切 6 个四面体，逐边线性插值），浏览器里实时重建，滑杆拖动有 160 ms 防抖。
- **交互**：滑杆同时显示百分比与绝对阈值（如 `12% (0.380 e/Å³)`）；`?iso=35` 可固定阈值分享；「等值面」按钮可临时关掉。
- **实测**：同一份 CHGCAR，8% 时等值面连成片，60% 时只剩极小残余——阈值方向正确；截图逐张核对。

- **双向等值面**：正值面蓝色、负值面红色（CUBE 的 2p 形/自旋密度这类有符号数据要靠它）；阈值取量程绝对值最大的一侧为 100%，标签显示 `25% ±0.111`。
- **单元测试**：`node --test test/volume.test.mjs` 锁住 CUBE/CHGCAR 解析与网格量化（4/4）。

已知限制：单阈值（正负共用同一幅度）；CUBE 坐标按文件原单位（Bohr）画，未换算成 Å；没有截面（slice）与沿线的 1D profile。

## DOS 曲线（DOSCAR）

```bash
node scripts/make-dos.mjs <DOSCAR> --out dos.html
# 或插件工具
vasp_dos(path="<任务目录或 DOSCAR>", out="dos.html")
```

- 单文件 HTML，离线可开：自旋向上蓝、向下红（镜像），费米能级虚线，占据区填充；
- 交互：滚轮缩放（Shift+滚轮缩纵轴）、拖拽平移、双击复位、悬停读数、存 PNG；
- URL 参数固定视角：`?xmin=-8&xmax=6&log=1&abs=1`。

**列语义要小心**：`ISPIN=1` 的 DOSCAR 是「E, DOS, 积分DOS」三列，`ISPIN=2` 才是
「E, 上, 下」。插件用「第三列是否等于第二列的累积积分」来判别，而不是看单调性。

**数值自检**：`∫DOS dE`（到费米能级）应等于 NELECT。本机两个真实任务的结果：

| 任务 | 体系 | NEDOS | E-fermi | 积分电子数 | NELECT |
|---|---|---|---|---|---|
| `5.5` | Si（ISPIN=1） | 301 | 5.773 eV | 7.999 | 8 |
| `latticefine_C2_a2p464_k25` | C2（ISPIN=2） | 301 | −3.159 eV | 8.000 | 8 |

单元测试：`node --test test/doscar.test.mjs`（4/4：单自旋/自旋极化列判别、梯形积分、行数不足报错）。

## 能带 / 本征值（EIGENVAL）

```bash
node scripts/make-bands.mjs <EIGENVAL> --out bands.html     # 或 --connect 连线
vasp_bands(path="<任务目录或 EIGENVAL>", out="bands.html", connect=false)
```

- 占据带蓝点、空带橙点，带隙区间黄色高亮，VBM/CBM 位置标出；
- 顶部直接给出带隙与「直接/间接」判断（VBM 与 CBM 是否同一 k 点）；
- 纵轴默认以 VBM 为 0 且只看 ±2.5 eV（否则带隙会被压成一条线），可切绝对能量；
- `ISPIN=2` 时两个自旋通道分别解析：EIGENVAL 每条带是 **5 列**（带号、E_up、E_down、occ_up、occ_down），`ISPIN=1` 是 3 列。

**真实任务结果**（都是 PBE，网格不同）：

| 任务 | 体系 | k 点 | 带数 | VBM | CBM | 带隙 | 类型 |
|---|---|---|---|---|---|---|---|
| `5.5` | Si | 35 | 8 | 5.449 | 6.107 | 0.657 eV | 间接 |
| `latticefine_C2_a2p464_k25` | C2 | 313 | 12 | −3.425 | −2.650 | 0.774 eV | 直接 |

> C2 的 0.774 eV 不是石墨烯的"真"带隙：25×25×1 的 Γ 中心网格没有正好落在 K 点，
> 这是网格分辨率造成的表观带隙。要测狄拉克点必须用含 K 的高对称路径。

单元测试：`node --test test/bands.test.mjs`（4/4：3 列/5 列解析、带隙、双通道取极值）。

## 电荷密度差（两个 CHGCAR 相减）

```bash
# 命令行
node scripts/make-viewer-gl.mjs <POSCAR> --vol CHGCAR_A --ref CHGCAR_A_ref --iso 25 --out diff.html
# 插件工具
vesta_view(paths=[...], volume="CHGCAR_A", volumeRef="CHGCAR_A_ref", isoPercent=25, renderer="webgl")
```

差值网格可正可负，所以自动切到**双向**等值面：正蓝、负红。要求两份体积网格维度一致
（不一致直接报错，不做隐式重采样）。渲染端不需要改——CUBE 的双向能力直接复用。

验证方式：用同体系、第二个原子位移 0.02 分数坐标的两份 CHGCAR 相减，得到围绕位移原子的
正负一对瓣——方向与位移一致，截图核对通过。

单元测试：`node --test test/diffvolume.test.mjs`（4/4：逐点相减、保留网格几何、维度不一致报错、不改输入）。

### 批量体检

`vasp_report(path="<根目录>")`：当路径下没有 OUTCAR、但子目录里有多个任务时，自动转为批量模式——
递归找回含 OUTCAR 的目录（默认深度 3、最多 60 个），逐个跑同样的交叉核对，输出一张表：

```
批量体检：...\zzz
扫描到 2 个任务
✔ 5.5　E = -10.8391 eV　带隙 0.657
✔ latticefine_C2_a2p464_k25　E = -18.6291 eV　带隙 0.774
结论：全部任务交叉核对一致。
```

扫描遇到读不了的目录会记进 `skipped` 而不是整次失败；单个任务体检异常也只标记该任务。
单元测试见 `test/outcar.test.mjs`（含批量扫描用例）。

## 离子轨迹播放器（XDATCAR）

```bash
node scripts/make-trajectory.mjs <XDATCAR> [--out traj.html] [--oszicar OSZICAR]
```

- 逐帧播放：滑块 / 播放按钮 / 空格 / 左右方向键；`?frame=N` 可直接跳到某帧；
- 每帧按当前坐标重算成键（距离判据 1.25×(r_i+r_j)，上限 2.6 Å），所以拉伸、断键都能看到；
- 拖拽旋转、滚轮缩放；取景按**原子分布**而不是整个晶胞（否则 20 Å 真空层会把原子压成一点）；
- 给了 `--oszicar` 时左下角画离子步能量曲线，并在播放时同步高亮当前帧。

验证用合成轨迹（30 帧，C₂ 二聚体拉伸 0.06→0.32 分数坐标）：第 1 帧两原子重叠、第 30 帧分开，
能量曲线随帧推进。**注意：这条链路目前只用合成数据验证过，尚无真实 NSW>0 任务。**

单元测试：`node --test test/xdatcar.test.mjs`（4/4：头部/多帧、缩放因子、无帧报错、坐标不足报错）。

### 能带横轴：k 路径距离

`make-bands.mjs ... --distance` 会把横轴从「k 点序号」换成**倒空间路径距离（2π/Å）**：
用同目录 `POSCAR` 算倒格子，逐点累积 |Δk|。`vasp_bands(connect=true)` 配合 line-mode 的 EIGENVAL 时，
这就是标准的能带横轴。

实测量级：Si 的 35 个 IBZ 点累积路径 23.0 2π/Å；立方晶胞 a=1 的 Γ→X 正好 π。

> 只有在 k 点沿高对称路径排列（line-mode）时，这个横轴才有物理意义；
> MP/IBZ 网格上顺序是 VASP 给的、不代表路径，此时横轴只是"累积距离"的可视化。

单元测试：`node --test test/kpath.test.mjs`（5/5：立方/正交倒格子、退化晶胞报错、Γ→X→M 解析值）。

## PDOS（投影态密度，需要 LORBIT ≥ 11）

```bash
node scripts/pdos.mjs --root <任务目录> [--format md|csv] [--out pdos.md]
```

从 DOSCAR 的逐原子块里读 `E s p d`（ISPIN=1）或 `E s↑ s↓ p↑ p↓ d↑ d↓`（ISPIN=2），
按元素汇总：**轨道电子数（积分到 E_f）** 与 **带中心**（∫E·DOS dE / ∫DOS dE，常用于 d 带分析）。
元素归属来自同目录 `POSCAR`（VASP4 写法用 `POTCAR` 补）。

实测（合成 DOSCAR，2 个 C，s/p/d 各一个高斯）：

| 元素 | 轨道 | 电子数（到 E_f） | 带中心 (eV) |
|---|---|---|---|
| C | d | 0.0378 | −0.5071 |
| C | p | 3.3550 | −1.5214 |
| C | s | 4.3731 | −3.9573 |

对没有 PDOS 块的真实 DOSCAR（本机两个任务都是），程序退出码 2 并提示
「需要 LORBIT = 11 或 12 重算」，不会给出空表。

单元测试：`node --test test/pdos.test.mjs`（4/4：跳过总 DOS 块、s 轨道积分 10、零态轨道、无 PDOS 块）。

## 能带图上的高对称点标签

`make-bands.mjs <EIGENVAL> --distance` 现在会自动读同目录 `KPOINTS`：若是 line-mode，
把每段端点换算成分数坐标、与 EIGENVAL 的 k 点匹配，在距离轴上画出竖线与标签（Gamma 显示为 Γ）。

- 换算规则来自官方 KPOINTS 页：**Cartesian 坐标单位是 2π/a**（`a` 为 POSCAR 第 2 行缩放因子）。
  推一遍：`x_i = K_actual·a_i / 2π = (K·a_i)/s = K·a_raw`。
- 实现时多除了一个 `s`，导致缩放因子 ≠ 1 时标签位置全偏；单测（`formats` 里的「不再多除一次 s」）把它钉住了。
- 相邻两段共享端点（X 会出现两次），同一距离只保留一个标签。

合成验证（立方胞 a=2，Γ–X–M）：标签位置 `Gamma@0.000 / X@1.571 / M@3.142`，
与倒格子长度 π 的手算值一致（X 距 Γ 半程、M 一个 b 长度）。

单元测试：`node --test test/formats.test.mjs`（9/9）。

## 二维截面（对应 VESTA 的 2D Data Display）

```bash
node scripts/make-slice.mjs <CHGCAR|CUBE|ELFCAR|LOCPOT> [--plane xy|yz|zx] [--at 0.5]
```

截面按分数坐标周期采样（双线性插值），可切 xy/yz/zx、拖动截面位置、悬停读数、底部颜色条；
有符号数据用「负红–白–正蓝」，全正数据用「白→深蓝」；原子按面内位置投影成标记。

`sampleSlice` 的索引正确性有单测（2×2×2 网格、yz 面、插值、统计量，共 4 条）。

### 待查：真实 CHGCAR 的密度峰不在原子上

用 `5.5/CHGCAR`（Si-fcc，48³）验证时发现：

- 结构段写的是原子在 (0,0,0) 与 (0.25,0.25,0.25)；
- 但网格上 **z=0 面的密度峰在 (i,j)=(6,6)**（分数 0.125,0.125），而不是 (0,0)；
- 原子位置上 ρ = **−0.185 e/Å³**（负值），全局最大 0.561 出现在 (5,4,4) 附近；
- 电荷积分仍为 8.000 e（与 NELECT 一致）。

也就是说「总量对得上、峰位对不上」。可能是该 CHGCAR 与 POSCAR 并非同一次计算、或网格原点约定与我们假设不同。
**已用 VESTA 作为独立参照仲裁**：见下方「与 VESTA 的逐点交叉校验」。

### 体积文件体检（check-volume）

```bash
node scripts/check-volume.mjs <CHGCAR|CUBE|ELFCAR|LOCPOT>
```

输出：网格、单位、量程、均值、积分（电荷密度应等于 NELECT）、**密度峰位置**、峰到最近原子的距离（含周期性）、
以及各原子处的取值。峰离最近原子 > 0.5 Å 时会明确提示「确认体积文件与结构是否来自同一次计算」。

本机 `5.5/CHGCAR` 的体检结果（供溯源，未定性）：

| 项 | 值 |
|---|---|
| 网格 / 单位 | 48³ / e/Å³ |
| 量程 / 均值 | −0.1845 → 0.5613 / 0.1923 |
| 积分 | 8.000（= NELECT ✓） |
| 密度峰 | 分数 (0.104, 0.083, 0.083) |
| 峰到最近 Si 原子 | **0.861 Å** |
| 两个 Si 原子处取值 | 都是 **−0.1845**（全局最小） |

另证伪了一个假设：把数据整体偏移 48 个 token（一个 x 行）后「峰看似回到原子附近」是假象——
那里读到的是 augmentation 整数（0.793×V≈33），fractional 位置也对不上。所以不是起点偏移问题。

单元测试：`node --test test/volume.test.mjs`（24/24，新增 4 条体检用例：峰在原子处、峰偏移、周期性最近邻、无结构）。

## X 射线粉末衍射（本地计算，无需 VESTA）

```bash
node scripts/xray-powder.mjs <结构文件> [--lambda 1.5406] [--two-theta-max 90] [--out peaks.csv]
```

思路：枚举 hkl 球 → 按 d 分组（同组即对称等价反射，**多重度自动计入**）→
强度 = `Σ|F|² × LP(2θ)`（LP = (1+cos²2θ)/(sin²θ·cosθ)）→ 归一到 100。

真实 Si（a = 5.431 Å，Cu Kα1 λ = 1.5406 Å）实测：

| 2θ (°) | d (Å) | I (%) | 对应 | 文献相对强度 |
|---|---|---|---|---|
| 28.442 | 3.1356 | 100.0 | (111) | 100 |
| 32.958 | 2.7155 | 0.0 | (200) 系统消光 | 0 |
| 47.302 | 1.9201 | 52.2 | (220) | ~55 |
| 56.122 | 1.6375 | 31.1 | (311) | ~30 |
| 69.129 | 1.3577 | 9.5 | (400) | ~6 |

峰位满足 `sinθ = λ/2d`（单测逐峰断言），禁戒反射（200/222/420）强度为浮点零，
(220)/(111) 强度比 0.52 对文献 ~0.55。

**这一轮踩的坑**：用 PowerShell 做中文字符串替换时把测试文件写坏了（两次），
最后整体用 write 工具重写才干净。以后凡是含中文的文件改动，一律走 write/edit 工具。

单元测试：`node --test test/powder.test.mjs`（5/5）。

### 粉末图谱（HTML）

```bash
node scripts/make-powder.mjs <结构文件> [--lambda 1.5406] [--two-theta-max 90] [--fwhm 0.15]
```

棒图 + 高斯展宽曲线，只标注强度 ≥5 的峰，悬停显示最近峰的 hkl/2θ/d/强度，可存 PNG。

真实 Si（a = 5.431）实测：最强峰 2θ = **28.442°**、d = 3.1356 Å、I = 100%；
次强 47.302°（I = 52.2%）。坐标标签用的是**原胞基矢下的 hkl**（fcc 原胞里 (111) 显示为 (0 1 0) 一类），
页面副标题已注明，避免误读。

## 功函数（LOCPOT）

```bash
node scripts/vasp-workfunction.mjs <LOCPOT 或任务目录> [--axis c] [--efermi 2.0] [--out profile.csv]
```

做法：沿轴做**平面平均**（对平面内所有格点求平均）→ 取平均电势里最长的近水平段作为真空能级 →
`Φ = E_vac − E_F`。费米能级默认从同目录 `OUTCAR` 的 `E-fermi` 读，可用 `--efermi` 覆盖。

合成校验（电势平台 5.0 eV、板层 15–24 Å 有起伏、E_F = 2.0 eV）：

```
网格 4×4×40　轴 c（长 40.00 Å）
费米能级 E_F = 2.0000 eV（来自 OUTCAR）
真空能级 E_vac = 5.0000 eV（平台段 25.00 → 13.00 Å，长 28.00 Å）
功函数 Φ = 3.000 eV        ← 期望 3.000
```

平台检测是**环形**的（跨周期边界也算连续），所以 25 → 13 Å 这种跨 0 的平台能被正确识别。

单元测试：`node --test test/workfunction.test.mjs`（5/5：平面平均、功函数数值、平台高度变化、无平坦段回退、非法 efermi）。

**局限**：本机没有真实 LOCPOT，只有合成数据验证了算法本身；真实板层的真空平台判定阈值（默认 0.01 eV/格）
可能需按体系调整，参数已开放为 `tolerance` 与 `minRun`。

### 功函数剖面图（HTML）

```bash
node scripts/make-workfunction.mjs <LOCPOT 或任务目录> [--axis c] [--efermi 2.0] [--out wf.html]
```

![功函数剖面](<输出目录>/wf-synthetic.png)

图上同时标出：真空平台（浅蓝阴影，跨周期边界时分成两段）、`E_vac` 虚线、`E_F` 虚线，
以及中线的 `Φ` 标注；悬停显示任意位置的电势，可存 PNG。

合成数据实测：`E_vac = 5.000`、`E_F = 2.000`、`Φ = 3.000 eV`，平台段 25 → 13 Å（长 28 Å）。

### 工具入口：work_function

```
work_function(path="<LOCPOT 或任务目录>", axis="c", efermi=2.0, out="…")
```

工具调用实测（合成夹具 `<合成 LOCPOT 目录>`）：

```
功函数 Φ = 3.000 eV
真空能级 E_vac = 5.000 eV，费米能级 E_F = 2.000 eV
真空平台：25.00 → 13.00 Å（长 28.00 Å）
剖面图：<输出目录>\tool-wf.html
```

显式给 `efermi` 会覆盖 OUTCAR（测试里把 E_F 设成 4.0 → Φ 变成 1.000 eV，验证覆盖生效）。

工具数现在是 **19 个**，装配测试的清单已同步——这正是那个集成测试存在的意义：
新增工具如果忘了登记，`tools.test.mjs` 会立刻变红。
