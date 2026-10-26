# 更新记录

本项目在本地以 `2.x` 系列迭代过（内部开发版），**首次公开**从 `0.0.1` 重新开始编号。

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
