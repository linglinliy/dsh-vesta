# 公开测试数据来源

这些文件用于测试解析与转换，**不是**本项目自创数据。来源均为公开数据库，使用时请遵守其许可与引用要求。

## Crystallography Open Database (COD)

- 站点：https://www.crystallography.net/
- 许可声明（COD 文件头原文）：*"The file may be used within the scientific community so long as proper attribution is given to
  the journal article from which the data were derived."*
- **使用要求：引用原始文献**。每条 CIF 的头部注释里带有 `_journal_*` 字段，请以该文献为准。

| 文件 | COD ID | 化学式（CIF 声明） | 下载 URL |
|---|---|---|---|
| `cod-1000000.cif` | 1000000 | C5 H17 Al N2 O8 P2 | https://www.crystallography.net/cod/1000000.cif |
| `cod-1010363.cif` | 1010363 | C6 H8 Cu Fe N8 | https://www.crystallography.net/cod/1010363.cif |
| `cod-9006316.cif` | 9006316 | Fe2 O3 | https://www.crystallography.net/cod/9006316.cif |

## 派生文件 `*.POSCAR`

用本机 VESTA 3.x 把上面的 CIF 转成 VASP 格式（`VESTA.exe -open x.cif -save x.POSCAR`），
用于测试我们的 POSCAR 解析与结构操作。转换结果（实测）：

| 文件 | 原子数 | 组成 | a / c（Å） |
|---|---|---|---|
| `cod-1000000.POSCAR` | 140 | P8 Al4 O32 H68 N8 C20 | 7.878 / 16.068 |
| `cod-1010363.POSCAR` | 64 | Cu4 Fe4 C24 N32 | 10.050 / 10.050 |
| `cod-9006316.POSCAR` | 56 | Fe24 O32 | 8.330 / 8.330 |

注意：`cod-9006316` 的 CIF 声明是 Fe2O3，但展开后的原子数是 Fe24O32（Fe3O4 的比例）——
CIF 里的占位率（occupancy）在转 POSCAR 时被忽略了。这条差异本身就是个值得测的边界。
