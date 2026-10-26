# 第三方组件与许可

本项目自身代码按 [MIT](LICENSE) 发布，但**不含**以下软件的代码或数据。

## VESTA（Visualization for Electronic and STructural Analysis）

- 版权归其作者所有，采用独立的 **VESTA 许可证**；
- 本项目**不重分发** VESTA 的任何文件（可执行文件、`MADELUNG`、`STRUCTURE_TIDY`、样式/元素数据等均不包含）；
- 运行 `vesta_*` 工具时，本插件只调用**用户自行安装**的 VESTA，并通过 Win32 消息驱动其窗口；
- 使用者必须自行遵守 VESTA 许可证（包含其引用/致谢要求）。

## VASP

- 本项目**不包含** VASP 代码、赝势（POTCAR）或任何许可数据；
- 解析 VASP 输出文件（`OUTCAR` / `DOSCAR` / `EIGENVAL` / `vasprun.xml` 等）本身不需要 VASP 许可证；
- 但**运行 VASP、使用 POTCAR 需要**你持有有效的 VASP 许可证。仓库不含任何真实计算数据。

## three.js（`vendor/`）

- MIT 许可，许可证文本见 [`vendor/THREE-LICENSE.txt`](vendor/THREE-LICENSE.txt)；
- `vendor/ConvexHull.js`、`vendor/ConvexGeometry.js` 来自 three.js examples（同为 MIT）。

## 其它

- 测试中出现的结构/输出数据均为**合成**或**已脱敏**的占位内容；
- 仓库不含任何个人信息、集群凭据或第三方数据集的原始文件。
