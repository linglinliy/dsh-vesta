# VESTA 官方能力清单与我们的覆盖情况

> 依据：VESTA 官网 <https://jp-minerals.org/vesta/en/>（Introduction / New features in VESTA 3 /
> Supported file formats / Change Log，最后核对版本 3.5.8）与 VESTA 自带手册。
>
> 本文件回答两件事：**官方到底有哪些功能**，以及**这个项目现在覆盖到哪、明确做不到什么**。

## 一、官方功能全景（按官网分类）

### 1. 结构模型

| 官方能力 | 我们的状态 | 说明 |
|---|---|---|
| 3D 结构可视化（球棍/空间填充/多面体/线框/棒状） | ✅ | 菜单命令 + `.vesta` 样式字段 |
| 同一窗口多个结构/体积数据/晶体形貌 | ⚠️ | 能打开多文件（多 tab），但“叠加”未封装 |
| 多 tab、多窗口 | ✅ | 单实例多 tab 已实测 |
| 晶格变换矩阵（常规↔非常规、超晶格、亚晶格） | ✅ | `vesta_control(transform-cell)`，纯投递 |
| 原子选择与删除 | ⚠️ | 结构层删除 ✅（纯投递）；**画布点选/框选 ❌** |
| 键长、键角、多面体信息 | ✅ | 解析 VESTA 文本输出 |
| 逐站点/逐键类型样式、标签、对称操作定制 | ⚠️ | `.vesta` 字段可写，GUI 面板未全接 |
| Undo/Redo | ⚠️ | 菜单 5007/5008 可调用，未做验证用例 |

### 2. 体积数据（Volumetric data）

| 官方能力 | 我们的状态 |
|---|---|
| 等值面（多级）、截面、切片 | ✅ 解析 CHGCAR/CHG/LOCPOT/ELF 等，生成交互图与切片 |
| 线剖面、峰搜索、∇²ρ 与能量密度派生量 | ✅ |
| Voronoi 积分（每原子电荷） | ✅（离散近似，已在文档标注为近似） |
| 等值面按另一物理量着色 | ❌ 未实现 |
| 多体积数据算术运算 | ❌ 未实现 |
| 电子/核密度建模、Patterson 函数 | ❌ 未封装（可经菜单 166–169 触发，未验证） |

### 3. 晶体形貌（Crystal morphology）

| 官方能力 | 我们的状态 |
|---|---|
| 晶面（hkl）、晶习可视化、STL 导出 | ❌ 完全未覆盖 |

### 4. 计算类

| 官方能力 | 我们的状态 |
|---|---|
| 粉末衍射模拟（RIETAN-FP） | ✅ 自研 `xray_powder`（结构因子 + 多重度 + LP 因子） |
| 结构因子 / Madelung 能 / 位势 | ❌ 未封装（VESTA 菜单里有，未接测试） |
| 各向异性热振动主轴与均值 | ❌ 未实现 |
| 最佳平面（best plane for selected atoms） | ❌ 依赖画布选择，未实现 |
| 电子/核密度与 Patterson（见上） | ❌ |

### 5. 文件格式

| 官方能力 | 我们的状态 |
|---|---|
| 输入 46 种格式（CIF/POSCAR/XYZ/PDB/ICSF/…） | ⚠️ 核心覆盖 POSCAR/CONTCAR、CIF、CHGCAR、CHG、LOCPOT、ELFCAR、DOSCAR、EIGENVAL、vasprun.xml、XSF（部分） |
| 输出 21 种（`.vesta`/CIF/PDB/XYZ/POSCAR/stl/…） | ⚠️ 覆盖 `.vesta`、CIF、POSCAR、PDB（部分）、SVG/PNG 自绘 |
| 图形格式：BMP/EPS/JPEG/PNG/TIFF/EPS/PDF/PS/SVG | ⚠️ 我们离线生成 SVG/PNG；VESTA 原生高分辨率导出未接 |

## 二、现在**做不到**的地方（明确清单）

以下不是“还没做”，而是**当前技术路径下做不到或需要你手动**：

| # | 做不到 | 原因 | 可行的替代 |
|---|---|---|---|
| 1 | 画布上**点选/框选原子** | 需要 Select 工具 + 真实鼠标；本环境 `SendInput` **返回 0**（系统拒绝注入），`keybd_event` 也无效果 | 结构层删除（`Edit Data`，纯投递、可验证） |
| 2 | 画布上**拖拽旋转/缩放** | 同上（真实输入被拒） | 投递方向键旋转（已验证可行）、`Zoom In/Out/Fit` 菜单 |
| 3 | **左栏工具条切换**（Select/Rotate/…） | wxWidgets 自绘工具条：8 个按钮 `idCommand` 全 0、`TB_GETITEMRECT` 全 0 | 只能由你点一下；或后续做“授权助手进程” |
| 4 | 读**状态栏文字** | wx 自绘，`SB_GETTEXT` 返回空 | 截图后用眼睛/OCR 判断 |
| 5 | 读 **wx 输入框的值** | `WM_GETTEXT` 返回空 | 截图或 VESTA 文本输出 |
| 6 | **晶体形貌**全部功能 | 未实现 | 需要时可后续补（有明确的菜单路径） |
| 7 | 体积数据**算术/按物理量着色/多级等值面** | 未实现 | 可先用 Python/自研后处理 |
| 8 | **原生高分辨率导出**（Export Raster/Vector） | 文件对话框未接 | 用我们自绘 SVG/PNG（矢量、可放大） |

## 三、已经验证能后台完成的能力（可直接依赖）

| 能力 | 手段 | 证据 |
|---|---|---|
| 菜单 **100 条命令**枚举与执行 | `WM_COMMAND` | `Boundary…`=156、`Fit to Screen`=209 等 |
| 按钮/确认框点击（含模态） | `BM_CLICK` 投递 | `OK` / `是(&Y)` / `&Apply` |
| 对话框数值输入 | 投递点击拿焦点 + `WM_SETTEXT` | 12 格变换矩阵一次填对 |
| 晶胞变换整链 | 填矩阵→OK→是→附加格点 OK→Apply→OK | 2×2×2 → `7.68059³` |
| 删原子（结构层） | `Edit Data` 选行 + Delete + Apply | 16→15→14→13、13→8 |
| 读结构/位点/晶胞/变换记录 | 文本区 `WM_GETTEXT` | 多轮实测 |
| 固定几何截图 + 自校验 | `PrintWindow(PW_RENDERFULLCONTENT)` | 1280×882、`ink` 值 |

## 四、官方链接

- VESTA 官网：<https://jp-minerals.org/vesta/en/>
- 手册（PDF）：<https://jp-minerals.org/vesta/en/doc.html>
- 本项目的覆盖总表：[COVERAGE.md](COVERAGE.md)
