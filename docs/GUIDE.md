# 使用指南（按意图找命令）

> 本文件只回答"我想干 X，该敲什么"。原理与数值校验的细节见 [README](../README.md)。

## 0. 三条最常用的

```bash
# 看一个结构的立体图（单文件 HTML，双击就能开）
node scripts/make-viewer-gl.mjs <POSCAR> --out struct.html

# 一个目录下所有任务：结构 + DOS + 能带 + 收敛 + 索引页 + 表格
node scripts/make-all.mjs --root <任务根目录> --out <输出目录>

# 这批任务有没有问题（能量/费米能/带隙/输入参数/交叉核对）
node scripts/make-table.mjs --root <任务根目录>
```

在对话里也可以直接说要什么，插件工具会做同样的事（见文末对照表）。

## 1. 看结构

| 我想要 | 命令 | 需要文件 |
|---|---|---|
| 三维结构，可旋转缩放 | `make-viewer-gl.mjs <POSCAR>` | POSCAR / CONTCAR / CIF |
| 叠电荷密度等值面 | `make-viewer-gl.mjs <POSCAR> --vol CHGCAR --iso 20` | + CHGCAR 或 CUBE |
| 电荷密度差（正蓝负红） | `make-viewer-gl.mjs <POSCAR> --vol A --ref B` | 两份同网格体积文件 |
| 在真 VESTA 里打开 | 对话里说"用 VESTA 打开" | — |
| 抓 VESTA 窗口截图 | 对话里说"截个图" | — |`n| VESTA 高清导出 / 格式转换 | `vesta_capture(path=…, scale=3)` / `vesta-convert.mjs <入> <出>` | 本机装 VESTA |`n| 读 VESTA 自算的空间群/晶胞参数 | `vesta-structure-info.mjs <结构文件>` | 本机装 VESTA |`n| 让 VESTA 列键长/键角 | `vesta-geometry.mjs <结构文件> [--kind bond]` | 本机装 VESTA |`n| 让 VESTA 算 X 射线结构因子 | `vesta-calcf.mjs <结构文件>` | 本机装 VESTA |`n| X 射线粉末衍射峰（纯本地计算） | `xray-powder.mjs <结构文件> [--lambda 1.5406]` | 结构文件（+ POTCAR 定元素） |`n| 粉末衍射图谱（HTML，含展宽） | `make-powder.mjs <结构文件> [--fwhm 0.15]` | 同上 |`n| vasprun.xml 摘要与交叉核对 | `vasp-vasprun.mjs <vasprun.xml 或任务目录>` | vasprun.xml（+OUTCAR/CONTCAR） |
| 结构预检（越界/重合/过近/晶胞） | `check-structure.mjs <文件或目录>` | POSCAR/CONTCAR |
| 超胞构建 | `make-supercell.mjs <结构文件> --repeat 2,2,2` | POSCAR/CONTCAR |
| 每原子电荷（离散 Voronoi / Bader 近似） | `vasp-bader.mjs <CHGCAR 或任务目录>` | CHGCAR + POSCAR |
| 更新 README 目录 | `update-toc.mjs [--check]` | 无 |
| 功函数剖面图（HTML） | `make-workfunction.mjs <LOCPOT 或任务目录>` | 同上 |
| 功函数（LOCPOT 平面平均电势） | `vasp-workfunction.mjs <LOCPOT 或任务目录>` | LOCPOT + OUTCAR |
| 板层批量报表（位点/高度/真空） | `slab-report.mjs --root <目录> [--adsorbate Na] [--substrate C]` | POSCAR/CONTCAR 目录 |
| 采集新元素的散射因子系数 | `harvest-form-factors.mjs Si O Na …` | 本机装 VESTA |

## 2. 看电子结构

| 我想要 | 命令 | 需要文件 |
|---|---|---|
| 总态密度 | `make-dos.mjs <DOSCAR>` | DOSCAR |
| 能带/本征值 + 带隙 | `make-bands.mjs <EIGENVAL>` | EIGENVAL（+ POSCAR 用于距离轴） |
| 能带横轴用 2π/Å | `make-bands.mjs <EIGENVAL> --distance` | + POSCAR |
| line-mode 连线 | `make-bands.mjs <EIGENVAL> --connect` | KPOINTS 为 Line-mode 才有意义 |
| 收敛曲线（能量 + ΔE） | `make-conv.mjs <OSZICAR>` | OSZICAR（+ INCAR 读 EDIFF） |
| 投影态密度汇总 | `pdos.mjs --root <任务目录>` | LORBIT ≥ 11 的 DOSCAR |`n| 投影态密度曲线（按元素/轨道） | `make-pdos.mjs <DOSCAR>` | LORBIT ≥ 11 的 DOSCAR（+ POSCAR 定元素） |`n| 二维截面（VESTA 的 2D Data Display） | `make-slice.mjs <体积文件> [--plane xy] [--at 0.5]` | CHGCAR/CUBE/ELFCAR/LOCPOT |`n| 一维线剖面（Line Profile） | `vesta-lineprofile.mjs <体积文件> --from "0,0,0" --to "0.25,0.25,0.25"` | 同上 |`n| 峰搜索（每峰电荷与 Voronoi 体积） | `vesta-peaks.mjs <体积文件>` | 同上 |`n| 派生量（∇²ρ / 动能/能量密度） | `vesta-density-derived.mjs <体积文件>` | 电子密度 CHGCAR/CHG |

## 3. 比、查、导

| 我想要 | 命令 |
|---|---|
| 多个任务的 DOS 叠一张图 | `make-compare.mjs --root <目录> --kind dos` |
| 谁收敛得快 | `make-compare.mjs --root <目录> --kind conv` |
| 这批任务改了哪些参数 | `make-incar-diff.mjs --root <目录>` |
| 体检结果导成表格 | `make-table.mjs --root <目录> [--format csv]` |
| 整个目录一键出图 | `make-all.mjs --root <目录> --out <输出目录>` |

## 4. 轨迹

```bash
node scripts/make-trajectory.mjs <XDATCAR> [--oszicar OSZICAR]
```

滑块/空格播放逐帧，每帧重算成键；带 `--oszicar` 时同步高亮能量曲线上的当前离子步。

## 5. 自检与排错

体积文件体检（判断密度峰是否落在原子上、积分是否等于 NELECT）：

```bash
node scripts/check-volume.mjs <CHGCAR|CUBE|ELFCAR|LOCPOT>
```


```bash
node scripts/vesta-crosscheck.mjs <CHGCAR|CHG|PARCHG>   # 用 VESTA 导出文本体积逐点校验解析

node scripts/verify-vesta.mjs            # 交互验证（E1/E2 + 正对照，需 VESTA_GUI_TESTS=1）

node scripts/selfcheck.mjs          # 单测 + 冒烟 + 生成器端到端（19 项）

node scripts/test-real-fixtures.mjs # 真实夹具套件逐个独立进程跑（每个文件跑完清理 VESTA）
```

出错时脚本给一行中文提示 + 退出码 2（不会甩堆栈）。例如：

```
找不到文件：Z:\nope\DOSCAR
```

## 6. 数据依赖一览

| 产物 | 必需文件 | 缺失时的表现 |
|---|---|---|
| 结构图 | POSCAR / CONTCAR / CIF | 报"找不到文件" |
| 等值面 | CHGCAR 或 CUBE | 只画结构 |
| 差密度 | 两份同网格体积文件 | 维度不一致会明确报错 |
| DOS | DOSCAR | 跳过该任务 |
| 能带 | EIGENVAL | 跳过该任务 |
| 收敛 | OSZICAR | 跳过该任务 |
| 轨迹 | XDATCAR（≥ 2 帧） | 报"没有找到任何 Direct configuration 帧" |
| PDOS | LORBIT ≥ 11 的 DOSCAR | 退出码 2 并提示需要重算 |

## 7. 已知限制

1. **VESTA 导出**：用 `vesta_capture(path=..., out=..., scale=N)` 走官方 CLI 出图（白底、无界面）；只抓当前窗口时不传 `path`。
2. **能带距离轴**：IBZ 网格上顺序不是高对称路径，横轴只是累积距离；需 line-mode 计算才有物理意义。
3. **轨迹播放器**：目前只用合成 XDATCAR 验证过，尚未在真实 NSW>0 任务上复验。
4. **PDOS 画图**：解析与汇总已完成，图尚未做（等真实 LORBIT=11 数据再定样式）。
5. **差密度**：只做逐点相减，不做隐式重采样；网格必须一致。

## 8. 工具与脚本对照

| 对话里的工具 | 等价命令 |
|---|---|
| `vesta_open` / `vesta_menu` / `vesta_control` / `vesta_capture` / `vesta_info` | 无（直接驱动本机 VESTA） |
| `vesta_view` | `make-viewer-gl.mjs` |
| `vasp_dos` | `make-dos.mjs` |
| `vasp_bands` | `make-bands.mjs` |
| `vasp_report` | `make-table.mjs` + 体检（`inspectTask`） |
| `vasp_batch` | `make-all.mjs` |
| `vasp_compare` | `make-compare.mjs` |

> 表格类/轨迹/PDOS 目前只有命令行入口（`make-table` / `make-incar-diff` / `make-trajectory` / `pdos`），
> 需要的话可以让它们也变成工具。

## 9. 其它脚本（次要/内部）

| 脚本 | 用途 |
|---|---|
| `make-viewer.mjs` | 早期 Canvas 2D 渲染器（不带 three.js，文件更小；观感不如 WebGL 版） |
| `poscar2view.mjs` | 批量把若干 POSCAR 转成查看器 HTML（老入口，现由 `make-all` 覆盖） |
| `render-proof.mjs` | 用自写 PNG 编码器生成"结构渲染截图"，仅用于回归对比，不对外 |
| `_friendly-errors.mjs` | 内部：把未捕获异常转成一行中文提示 |
| `selfcheck.mjs` | 一键自检（见第 5 节） |
