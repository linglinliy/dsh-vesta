# 体检检查项清单（vasp_report / inspectTask）

代码：`core.js` 的 `inspectTask()`；本文件与代码一一对应，`test/checks-doc.test.mjs` 会在两者不一致时报错。

## 运行与告警

| 检查项 | 数据来源 | 判据 | 失败含义 |
|---|---|---|---|
| 计算收尾 | OUTCAR | 出现 `General timing and accounting informations` | 任务可能被中断 |
| SCF 收敛 | OUTCAR | 出现 `aborting loop because EDIFF is reached` | 电子步未收敛 |
| 告警 | OUTCAR | 不含 `ZBRENT` / `EDDDAV` / `TOO FEW BANDS` / `BRMIX` / `Error` | 对应告警存在 |

## 输入参数

| 检查项 | 数据来源 | 判据 | 失败含义 |
|---|---|---|---|
| ENCUT vs ENMAX | INCAR + POTCAR | `ENCUT ≥ 1.3 × ENMAX` | 截断能偏低（给出建议值） |
| k 网格 | KPOINTS | 自动网格（Γ / Monkhorst）→ 仅信息项 | 不判失败 |
| k 点约化 | IBZKPT | 权重和 = 完整网格点数；IBZ 点数 = OUTCAR `NKPTS` | 与 OUTCAR 不一致 |`n| POTCAR ZVAL ↔ NELECT | POTCAR + POSCAR + OUTCAR | Σ ZVAL × 原子数 = OUTCAR `NELECT`（容差 1e-3） | 输入文件不匹配（POTCAR 与 POSCAR 物种/顺序不符） |
| NBANDS 下限 | OUTCAR | `NBANDS ≥ 1.15 × (NELECT/2)`（相对判据；原「+原子数」在 51 原子板层里误报 83/116） | 空带偏少 |

## 结构

| 检查项 | 数据来源 | 判据 | 失败含义 |
|---|---|---|---|
| 真空层 | POSCAR | 仅当 `c > 1.5·max(a,b)` 且真空 > 5 Å 时检查；`真空 ≥ 10 Å` 视为合格 | 板层真空不足 |
| 每原子能量 | OUTCAR + POSCAR | `E(sigma→0) / 原子数`（信息项） | 不判失败 |
| 应力张量 | OUTCAR | 最后一条 `in kB` 行；给出最大 \|σ\| 与静水压（1 kBar = 0.1 GPa，信息项） | 不判失败 |
| 平均力 | OUTCAR | 最后一个 `TOTAL-FORCE` 块的平均力（信息项） | 不判失败 |

## 跨文件一致性

| 检查项 | 数据来源 | 判据 | 失败含义 |
|---|---|---|---|
| OUTCAR↔OSZICAR 能量 | OUTCAR + OSZICAR | 末行 `F=` 与 `free energy TOTEN` 差 < 1e-4 eV | 两处能量不一致 |
| DOSCAR 可用性 | DOSCAR | 文件 ≥ 100 字节且能被解析 | 任务未算完或被截断（真实数据里有 167 字节的 DOSCAR） |
| DOSCAR 积分↔NELECT | DOSCAR + OUTCAR | ∫DOS dE 到 Ef 与 `NELECT` 差 < 0.01 e；不一致时会与 DOSCAR 自带的积分列交叉判断 | 积分/单位有误，或文件里的 DOS 值被缩放 |
| EIGENVAL 可用性 | EIGENVAL | 能被完整解析 | 文件被截断（真实数据里有 10 个） |
| vasprun 可用性 | vasprun.xml | 文件 < 200 MB 且能被解析 | 文件过大（MD 轨迹）或解析失败 |
| 能量来源 | OUTCAR + vasprun | OUTCAR 无能量时改用 vasprun 的终态 e_0_energy | 不判失败（说明用的哪一份） |
| vasprun 价电子 ↔ NELECT | vasprun.xml | Σ(每物种原子数 × 价电子) = `NELECT` | 与 POTCAR 不一致 |
| vasprun↔OUTCAR 能量 | vasprun + OUTCAR | \|Δe_0_energy\| < 1e-4 eV | 两者不同源或被改写 |
| vasprun↔OUTCAR 费米能级 | vasprun + OUTCAR | \|ΔE_F\| < 0.01 eV | 同上 |
| vasprun↔CONTCAR 终态坐标 | vasprun + CONTCAR | 最大分数坐标差 < 1e-3 | 终态结构不一致 |
| DOSCAR 被缩放（非原始输出） | DOSCAR + OUTCAR | ∫DOS 与文件自带积分列一致、但与 `NELECT` 相差甚远 | DOS 值被缩放/归一化过（数据流程问题，计算本身没问题） |
| DOSCAR↔OUTCAR E-fermi | DOSCAR + OUTCAR | 差 < 0.01 eV | 费米能级不一致 |
| NBANDS 一致性 | EIGENVAL + OUTCAR | 两处 `NBANDS` 相同 | 文件来自不同任务 |
| 带隙一致性（DOS ↔ EIGENVAL） | DOSCAR + EIGENVAL | \|DOS 带隙 − 能带带隙\| ≤ max(2×能量格距, 0.05 eV) | 带隙判定有系统偏差 |

## 两个真实任务的结果

`5.5`（Si-fcc）与 `latticefine_C2_a2p464_k25`（单层 C2）在最近一次运行中：

- `5.5`：**16 项中 15 项通过**，唯一失败是 `ENCUT vs ENMAX`（300 eV = 1.22×ENMAX(245)，建议 ≥ 319 eV；该项在 Si 上通常可接受）；
- `latticefine_C2`：**17 项全部通过**（含真空层 25.00 Å、带隙 DOS 0.759 vs 能带 0.774）。

## 维护方式

新增检查项时，请在 `inspectTask()` 里用 `checks.push({ name: '…', ok, detail })`，
并同步在本文件对应小节加一行——`test/checks-doc.test.mjs` 会核对代码里出现的每个 `name` 都在本文档中出现。

## 真实数据审计（136 个任务）

对 `<pilot 数据集>` 的 136 个任务跑批量体检（116 个在 4 层深度内被扫到）：

| 结果 | 数量 |
|---|---|
| 解析失败（抛错中断） | **0**（修复前 10） |
| 全部检查项通过 | 18 / 116 |
| `DOSCAR 积分↔NELECT` 失败 | 82（DOS 值被归一化成「1 电子/胞」，文件自身积分列与我们的积分一致 → 数据问题不是解析问题） |
| `计算收尾` 失败 | 10（任务被截断） |
| `DOSCAR 可用性` / `EIGENVAL 可用性` 失败 | 各 10（空 DOSCAR / 截断 EIGENVAL，现降级为告警不中断） |
| `SCF 收敛` 失败 | 4（确实没收敛） |

这轮据此改了三处判据：NBANDS 下限改成相对判据、空/截断文件降级为告警、DOS 被缩放时跳过带隙交叉核对并给出诊断。
