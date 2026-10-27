# dsh-vesta 0.0.2

首个公开汇总版。内部迭代构建号 `0.0.2-internal` – `0.0.42` 从未单独发布，全部汇总为本版。

## 能做什么

**VESTA 联动（Win32 消息层，不抢前台）**

- 菜单命令：枚举 **100 条**并以 `WM_COMMAND` 执行（如 `Boundary…`=156、`Fit to Screen`=209）
- 对话框：按标签邻近关系定位输入框、`WM_SETTEXT` 填值、投递点击按钮（`OK` / `是(&Y)` / `&Apply`）
- 晶胞变换整链：`vesta_control(action="transform-cell", matrix=…)`，实测 2×2×2 → `7.68059³`
- 结构层删原子：`vesta_control(action="delete-atom", row=…)`，实测 16→15→14→13
- 固定几何自校验截图：`captureFullWindow`（`PrintWindow` + 着墨率校验，1280×882）

**结构处理**

- POSCAR / CIF 读写、超胞与亚晶格、按空间群展开/约化、对称化
- 晶胞参数与分数坐标改写、元素替换、Wyckoff 位点归属、CIF 生成、结构 SVG/投影

**VASP 后处理**

- OUTCAR / OSZICAR / DOSCAR / EIGENVAL / CHGCAR 解析与体检
- DOS / 能带 / PDOS、体积切片与线剖面、峰搜索与 ∫ρ、∇²ρ 派生量
- Bader 近似电荷、功函数、粉末衍射（结构因子 + 多重度 + LP 因子）

## 明确做不到（如实标注）

| 做不到 | 原因 |
|---|---|
| 画布上点选 / 框选 / 拖拽旋转 | 本环境 `SendInput` 返回 0（系统拒绝注入），`keybd_event` 亦无效 |
| 左栏工具条切换（Select / Rotate） | wxWidgets 自绘工具条：8 个按钮 `idCommand` 全 0，`TB_GETITEMRECT` 全 0 |
| 读状态栏文字 | wx 自绘，`SB_GETTEXT` 返回空 |
| 读 wx 输入框的值 | `WM_GETTEXT` 返回空，只能靠截图或 VESTA 文本输出 |
| 晶体形貌、体积数据算术/按物理量着色、结构因子与 Madelung | 未实现（有明确菜单路径，后续可补） |

替代方案：画布选择 → 用 `Edit Data` 结构层删除（纯投递、可验证）。

## 校验

- 文档一致性 18/18、工具/MCP 10/10、selfcheck 74/74
- 真机用例（需 `VESTA_GUI_TESTS=1`）：`test/gui-transform.test.mjs`、`test/gui-delete.test.mjs`

## 安装

```bash
git clone https://github.com/linglinliy/dsh-vesta.git
cd dsh-vesta && node scripts/selfcheck.mjs
```
