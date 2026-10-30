# dsh-vesta

> **⚠️ 先读 [DISCLAIMER.md](DISCLAIMER.md)**（个人非官方项目、无担保、结果需自行核对、
> 与 VESTA / VASP 无隶属关系、不重分发 VESTA 文件与 POTCAR、VESTA/VASP 许可证义务在你身上）。
> 版本 **0.0.2**，仅供研究与个人使用。许可：[MIT](LICENSE)；第三方组件（VESTA / VASP / three.js）见 [THIRD_PARTY.md](THIRD_PARTY.md)。

在对话里打开并**驱动**本机 VESTA，并对 VASP 输出做后处理。一份能力核心（[`core.js`](core.js)），两个前端：
DSH 原生插件（[`index.js`](index.js)）与零依赖 MCP 服务器（[`mcp/server.js`](mcp/server.js)）。


<!-- TOC -->
<details>
<summary>目录（3 节，点击展开）</summary>

- [分册导航](#分册导航)
- [快速开始](#快速开始)
- [工具一览（插件）](#工具一览插件)

</details>
<!-- /TOC -->

## 分册导航

README 只留简介、安装入口与工具清单；详细内容按主题分册：

| 分册 | 内容 |
|---|---|
| [项目与安装](docs/PROJECT.md) | 能力、为什么走 Win32、MCP 服务器、插件配置、边界、内部结构、命令行错误处理 |
| [可视化](docs/VIZ.md) | 结构查看器、等值面、DOS、能带、轨迹、PDOS、粉末衍射、功函数剖面 |
| [VASP 解析与体检](docs/VASP.md) | 文件格式、体检 16 项、体积分析（截面/线剖面/峰搜索/派生量）、吸附结构分析 |
| [VESTA 联动](docs/VESTA.md) | CLI 导出与转换、文本区解析（结构/键长/键角/多面体）、结构因子 |
| [质量与测试](docs/QUALITY.md) | 装配测试、真实调用冒烟、描述与参数审计、文档维护 |
| [检查项清单](docs/CHECKS.md) | 体检 16 项的判据与失败含义 |
| [用法索引](docs/GUIDE.md) | 按意图查「该用哪个脚本」 |
| [官方能力对照](docs/OFFICIAL-FEATURES.md) | VESTA 官网上列出的全部功能 ↔ 本项目覆盖 ↔ 明确做不到的地方 |
| [功能覆盖总表](docs/COVERAGE.md) | 29 个工具逐条对应 VESTA 功能、状态与验证证据、不可达清单 |
| [状态与验证](docs/STATUS.md) | 规模、能力矩阵、交叉验证证据、已知限制 |

## 快速开始

```bash
node scripts/selfcheck.mjs          # 一键自检：测试套件 + 冒烟 + 生成器
node scripts/selfcheck.mjs --list   # 只列出会跑什么
```

插件安装（DSH profile）：把 `<插件目录>` 作为 bundle 安装后，18+ 个 `vesta_*` / `vasp_*` 工具直接可用；
详见 [项目与安装](docs/PROJECT.md)。

## 工具一览（插件）

| 工具 | 用途 |
|---|---|
| `vesta_open` | 在本机 VESTA 里打开结构文件/任务目录 |
| `vesta_info` | VESTA 安装位置、版本标识、最近文件、运行中的进程 |
| `vesta_menu` | 列出/执行 VESTA 菜单命令（84 条，含 id） |
| `vesta_control` | 列出/点击 VESTA 对话框控件、写输入框 |
| `vesta_capture` | 抓 VESTA 窗口 PNG；给 `path` + `scale` 时改用 VESTA 官方 CLI 高清导出 |`n| `vesta_analyze` | 让 VESTA 自算并读文本区：`kind="structure"`（空间群/晶胞参数）、`"bond"`（键长）、`"angle"`（键角）、`"poly"`（配位多面体）、`"calcf"`（X 射线结构因子） |
| `vesta_view` | POSCAR/CIF → 三维查看器（`renderer="webgl"`；可带 `volume` / `volumeRef` 画等值面或差密度） |
| `vasp_dos` | DOSCAR → DOS 曲线 |
| `vasp_bands` | EIGENVAL → 能带/本征值 + 带隙 |
| `vasp_report` | 单任务体检；给根目录时自动批量体检 |
| `vasp_batch` | 根目录批量出图（结构/DOS/能带/收敛 + 索引页） |`n| `vasp_compare` | 多任务叠加对比（`kind="dos"` 总 DOS / `kind="conv"` 收敛曲线） |`n| `vasp_table` | 体检结果导出 Markdown / CSV 表格 |`n| `vasp_trajectory` | XDATCAR → 轨迹播放器 |`n| `vasp_pdos` | PDOS 曲线（需要 LORBIT ≥ 11） |`n| `work_function` | 由 LOCPOT 算功函数 Φ = E_vac − E_F，出剖面图 HTML |
| `check_structure` | 结构预检：晶胞/越界/重合/过近，可批量扫目录 |
| `slab_report` | 批量板层报表：位点（top/bridge/hollow）、吸附高度、真空厚度，写 Markdown + CSV |
| `xray_powder` | 由结构算 X 射线粉末衍射图谱（HTML，峰标 hkl、含多重度与 LP 因子） |
| `volume_analyze` | 体积文件分析：`kind="slice"`（二维截面）/`"profile"`（线剖面）/`"peaks"`（峰搜索）/`"derived"`（∇²ρ 与能量密度）、`"charges"`（每原子电荷，Bader 近似） |

`vasp_batch` 实测（`zzz` 根目录）：2 个任务 → 6 份 HTML + `index.html`，与命令行 `make-all.mjs` 的产物逐字节一致。
