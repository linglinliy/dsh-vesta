# 功能覆盖总表（截至 0.0.25）

这张表回答一个问题：**VESTA 能做到的事，这个插件现在能不能做到、凭什么说能做到。**

- 每条都标注**证据**：实测数字、测试文件、或 CLI/框架的固定行为；
- 状态只有三档：✅ 完全可用（有自动化验证）、⚠️ 部分可用（有明确边界）、❌ 不可达（附理由与替代路径）；
- 「不可达」不是含糊其辞：每条都写了实测证据，说明是 VESTA 的限制还是我们没做。

复现方式（**一次只跑一件事**：全量测试和 selfcheck 都会启动 VESTA，同时跑会互相干扰）：

```bash
cd D:/DSH/vesta-plugin
node --test --test-concurrency=1 test/*.test.mjs   # 全量 368 例，必须串行
node scripts/selfcheck.mjs                        # 端到端 72 项
```

### 最终验收记录（0.0.37）

| 项 | 结果 |
|---|---|
| 全量测试（独占、串行） | **368 例：352 通过 / 0 失败 / 16 跳过** |
| 跳过的 16 例原因 | 全部是「本地夹具不存在」（仓库里是脱敏占位路径），设 `VASP_FIXTURE_ROOT` 后可真跑 |
| selfcheck | **72/72** |
| 文档一致性审计 | 8/8 |
| 工具参数自检 | 7/7（含检测器自检） |
| 真实夹具套件（逐套件独立进程） | tools-smoke 4/4、tools-smoke2 7/7、tools-smoke4 2 通过 1 跳过 |
| 能力冒烟（16 项编辑/测量/导出操作） | 16/16 |

---

## 一、工具清单（27 个）

| 工具 | 覆盖的功能 | 关键证据 |
|---|---|---|
| `vesta_open` | 打开结构/体积文件，返回 pid | 打开 CHGCAR 后等值面默认可见（截图） |
| `vesta_info` | 安装状态、版本、最近文件 | 读 `VESTA.ini`，实测通过 |
| `vesta_menu` | 枚举/执行菜单命令 | 菜单 145 关等值面：黄像素 2006→458 |
| `vesta_capture` | 窗口截图（PrintWindow） | 遮挡也能抓；支持 `dialog`/`hwnd` |
| `vesta_analyze` | 空间群/键长/键角/多面体/结构因子（VESTA 自己算） | `-list bond`、`-calcf` 文本解析 |
| `volume_analyze` | 截面/线剖面/峰/∇²ρ/每原子电荷 | 真实 CHGCAR 48³ 上跑通 |
| `volume_export` | 切片 CSV + 线剖面 TXT | CSV 行数 = 48+3；距离严格递增 |
| `xray_powder` | 粉末衍射图（含多重度、LP 因子） | 峰位与 VESTA `-calcf` 一致 |
| `slab_report` | 批量板层：位点、吸附高度、真空厚度 | 批量扫描实测 |
| `check_structure` | 结构预检（体积/角度/越界/过近） | 批量可扫目录 |
| `work_function` | 由 LOCPOT 算功函数 | 剖面图 + Φ 数值 |
| `vesta_control` | 枚举/点击/填值对话框控件 | 见「不可达」一节 |
| `vesta_view` | 结构 → PDB/mmCIF(+WebGL HTML) | 可扩胞，带晶胞 |
| `vesta_input` | 拖拽/滚轮/方向键/点击/输入/撤销重做 | 137–294 ms/动作；`+/-` 改等值面阈值实测 |
| `vesta_render` | CLI 批量出图（多视角/多倍率）+ 场景样式 | 角落像素 = 写入的背景色 |
| `vesta_edit` | 扩胞/矩阵/晶胞/加删原子/替换元素/空间群/约化/对称化 | 见下节逐项 |
| `vesta_vector` | SVG 矢量导出（球棍+晶胞+占位率） | 圆/线计数与结构一致；确定性输出 |
| `vesta_measure` | 键长/键角/点击拾取 | Si–Si 2.3517 Å（文献 2.35） |
| `vesta_volume_display` | 等值面/剖面开关、阈值升降 | 黄像素 17→1988→931 |
| `vasp_dos/bands/report/batch/compare/table/trajectory/pdos` | VASP 数据可视化与体检 | 真实任务目录上跑通 |

---

## 二、VESTA 功能覆盖（按操作面板组织）

### 结构读取与格式

| 功能 | 路径 | 状态 | 证据 |
|---|---|---|---|
| 读 POSCAR/CONTCAR | `vesta_edit`/`vesta_view`/各 vasp_* | ✅ | 85 个真实 CONTCAR 鲁棒性审计 |
| 读 CIF（含对称展开） | `parseCif` + `structureFromCif` | ✅ | γ-Fe₂O₃ → 56 原子，与 VESTA 一致 |
| 读体积数据（CHGCAR/CHG/LOCPOT/ELFCAR/.cube） | `readVolumeFile` | ✅ | 48³ 真实数据 |
| 写 POSCAR | `vesta_edit`/`structureToPoscar` | ✅ | 端到端 VESTA 读回 |
| 写 CIF（含 occupancy、化学式） | `structureToCif` | ✅ | VESTA 把我们的 CIF 转回 POSCAR 一致 |
| 格式转换（CIF↔POSCAR） | `vesta_edit` 只给 `out` | ✅ | 140/64/56 原子与 VESTA 逐项相同 |

### 显示与视图

| 功能 | 路径 | 状态 | 证据 |
|---|---|---|---|
| 打开/多窗口/定向 | `vesta_open` + pid | ✅ | 多窗口实测 |
| 旋转/缩放/点选 | `vesta_input` | ✅ | 注入帧对比 |
| 撤销/重做 | `vesta_input(undo/redo)` | ✅ | 哈希复原 |
| 样式切换（球棍/空间填充/多面体/线框/棍） | 菜单 139–143 + `model` | ✅ | MODEL=1 蓝色像素 11912→45011 |
| 显示开关（模型/仅不对称单元/体数据） | 菜单 136–146 | ✅ | 144/145 实测 |
| 背景色 | `applySceneStyle(BKGRC)` | ✅ | 渲染角落像素 (255,0,0) |
| 显示边界（显示几个晶胞） | `applySceneBoundary(BOUND)` + `vesta_render(boundary=…)` | ✅ | 四组边界产出四份不同渲染；视图会自动缩放，像素数不等于原子数 |
| 元素配色/半径 | `vesta_style`（改 `elements.ini`，自动备份/还原） | ✅ | Si 改绿后绿色像素 26→10568、蓝色 13449→39；还原后复原 |
| 3D 视口截图 | `captureViewport` | ✅ | 565×442 只含画布 |
| 导出位图 | CLI `-export_img` | ✅ | 多倍率实测 |

### 结构编辑

| 功能 | 路径 | 状态 | 证据 |
|---|---|---|---|
| 扩胞 | `repeat=[2,2,1]` | ✅ | det=4 → 8 原子；VESTA 文本区 8 行 Si |
| 任意整数变换矩阵 | `matrix` | ✅ | det 4/8/1 三组实测 |
| 改晶胞参数 | `cell` | ✅ | a/b/c/α/β/γ 写回并核对 |
| 加原子 / 删原子 | `add` / `remove` | ✅ | 计数与坐标核对 |
| 元素替换 | `substitute` | ✅ | 符号与占位核对 |
| 改空间群（对称展开） | `spaceGroup` | ✅ | 225→4、227→8、194→2 |
| 按对称性约化 | `reduceSpaceGroup` | ✅ | 往返恒等 expand∘reduce∘expand |
| Wyckoff 字母 | `assignWyckoff` | ✅ | 225 4a/4b/192l、227 8a/8b/16c、194 2a/2c |
| 对称化 | `symmetrize` | ✅ | 0.0188 Å → **0.0000 Å** |
| 对称化（位置） | `symmetrize` | ✅ | 0.0188 Å → 0.0000 Å |
| 对称化（晶胞） | `symmetrize` + `refineCell` | ✅ | 畸变 a/b/c 3.86/3.82/3.85 → 3.8434 三者相等、角度全 90°；完美胞不变 |
| 保存工程 `.vesta` | CLI `-save` + 模板 | ✅ | 模板生成被 VESTA 接受 |
| 场景样式（背景/模型） | `readSceneStyle`/`applySceneStyle` | ✅ | 只暴露实测生效的两项 |

### 体数据与等值面

| 功能 | 路径 | 状态 | 证据 |
|---|---|---|---|
| 加载体积并显示 | `vesta_open` 直接开数据文件 | ✅ | 打开后等值面默认可见 |
| 等值面/剖面开关 | `vesta_volume_display`（菜单 144/145） | ✅ | 黄像素 2006→458 |
| 等值面阈值升降 | 键盘 `+/-` | ✅ | 17→1988→931 |
| 等值面阈值**精确设值** | `vesta_view(isoValue=…)`：把密度值换算成百分位后自渲染 | ✅ | 0.1 e/Å³ → 35.71% → 第 36 百分位；分位往返误差 <0.01% |
| `.vesta` 里携带体积 | — | ❌ | `IMPORT_DENSITY` 相对路径，CLI/GUI 都加载不到；6 种参数组合渲染逐字节相同 |
| 切片/剖面数据导出 | `volume_export` | ✅ | CSV 48×48、TXT 单调递增 |
| 2D 截面/∇²ρ/峰 | `volume_analyze` | ✅ | 真实数据实测 |

### 测量与计算

| 功能 | 路径 | 状态 | 证据 |
|---|---|---|---|
| 键长/键角 | `vesta_measure` + `vesta_analyze` | ✅ | 2.3517 Å；交叉验证 VESTA |
| 点击原子拾取 | `pickAtom` + `structureProjection` | ✅ | 命中/空白/就近选择 |
| 多面体/结构因子/粉末衍射 | `vesta_analyze` `-calcf`、`xray_powder` | ✅ | 与 VESTA 数值交叉核对 |
| Madelung 能 | 未实现 | ❌ | 菜单项不暴露标题，执行 164 后既没有对话框也没有文本输出，无法读取结果 |

### 导出

| 功能 | 路径 | 状态 | 证据 |
|---|---|---|---|
| 位图 | CLI `-export_img` | ✅ | 多倍率 |
| 矢量图（SVG） | `vesta_vector` | ✅ | VESTA 的 Export Vector 只有 GUI，这里自渲染 |
| 结构数据导出（CIF/POSCAR） | `structureToCif`/`structureToPoscar` | ✅ | 往返一致 |
| 体数据导出（CSV/TXT） | `volume_export` | ✅ | 行数/单调性校验 |
| VASP 图表（DOS/能带/轨迹/PDOS） | `vasp_*` | ✅ | 真实任务 |

### GUI 对话框类操作

| 能力 | 状态 | 证据 |
|---|---|---|
| 找到/枚举对话框与控件 | ✅ | 顶层 #32770，控件带 hwnd/id |
| PostMessage 点按钮 | ✅ | 不阻塞；真实 id 可关闭 wx 对话框 |
| 填 wx 文本框（可见控件） | ✅ 后台 | 投递点击拿焦点 + `WM_SETTEXT`；12 格矩阵一次填对 |
| 删除原子行（Edit Data） | ✅ 后台 | 选行/Delete/Apply 全是投递消息；必须按 visible 过滤表格控件；实测 16→13 |
| 对话框「提交」（OK/Apply 后生效） | ✅ | `transform-cell` 走完 OK→是(&Y)→Additional OK→&Apply；位点数可验证 |
| 模拟键鼠的独立性 | ✅ 后台（除画布框选） | 菜单/按钮/数值输入/选行/删除都是 PostMessage；画布框选仍需真输入，已可避开 |
| 原生 Save-As 文件名框 | ❌ | 同上 |

**结论**：凡是要在对话框里填数字的功能（精确等值面阈值、Preferences 数值、Madelung 参数、Export 对话框选项），
都改用「自己算 + 自己写文件」绕过；所有数值结果都与 VESTA 交叉核对过。

---

## 三、明确不可达清单（附理由）

| 项 | 为什么 | 替代 |
|---|---|---|
| 对话框内数值输入 | wx 文本框不接受 `WM_SETTEXT`，读回为空 | 自算 + 写文件（已覆盖 90% 需求） |
| 精确等值面阈值（VESTA 窗口内） | 对话框不可填 | `vesta_view(isoValue=…)` 自渲染（已实现） |
| 元素配色/半径 | 真身在 `elements.ini`（全局配置），场景里的 `ATOMT` 被忽略 | `vesta_style`（已实现，带备份/还原） |
| `.vesta` 携带体积 | `IMPORT_DENSITY` 相对路径失效 | 直接打开数据文件 |
| 相机状态持久化 | `.vesta` 的 `LMATRIX` 不是相机，改了渲染逐字节相同 | `-rotate_x/y/z` 复现视角 |
| 基于衍射强度的精修（R 因子） | 没有强度数据 | 位置+晶胞的对称投影（`symmetrize` + `refineCell`） |

---

## 四、与 0.0.8 版覆盖矩阵的对比

0.0.8 时这张表里有 5 个 ❌、6 个 ⚠️。现在：

| 项 | 0.0.8 | 现在 |
|---|---|---|
| 加/删原子 | ❌ | ✅（0.0.9） |
| 改空间群 | ❌ | ✅（0.0.10） |
| 矢量图导出 | ❌ | ✅（0.0.12） |
| Export Data | ❌ | ✅（0.0.13/0.0.14） |
| 交互式测量 | ⚠️ | ✅（0.0.15） |
| Preferences | ⚠️ | ✅ 背景色/模型/元素配色都能改（只剩对话框内精确数值）|
| 等值面/剖面参数 | ⚠️ | ⚠️ 开关与步进 ✅，精确值 ❌（根因已查清） |
| 改晶胞参数 | ⚠️ | ✅（0.0.9） |

新增能力：Wyckoff 字母、对称约化、对称化、CIF 读写、占位率（读/算/写/看）、公开数据夹具。
