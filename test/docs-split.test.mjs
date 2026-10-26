/**
 * 文档拆分守护：README + 分册必须覆盖全部 64 个专题节，README 保持精简。
 *   node --test test/docs-split.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const FILES = ['README.md', 'docs/PROJECT.md', 'docs/VIZ.md', 'docs/VASP.md', 'docs/VESTA.md', 'docs/QUALITY.md']

/** 拆分前的 64 个专题标题（顺序即原 README 顺序）。 */
const CANONICAL = [
  '能力', '为什么走 Win32', 'MCP 服务器', 'DSH 原生插件配置', '边界', '为什么这么写',
  '看 POSCAR 立体结构（三条路）', 'WebGL 查看器（主力，观感接近 VESTA）', '等值面（CHGCAR / CUBE）',
  '用真实 VASP 任务自检', 'DOS 曲线（DOSCAR）', '能带 / 本征值（EIGENVAL）', '任务体检（OUTCAR + 交叉核对）',
  '电荷密度差（两个 CHGCAR 相减）', '批量出图（一个根目录 → 图集）', '工具一览（插件）', '收敛曲线（OSZICAR）',
  '多任务叠加对比', 'INCAR 差异对比', '任务表格导出（Markdown / CSV）', '一键自检', '内部结构（重构记录）',
  '离子轨迹播放器（XDATCAR）', 'PDOS（投影态密度，需要 LORBIT ≥ 11）', '命令行错误处理',
  '按官方文档校正的三处（VASP wiki）', '按官方文档校正（第二轮：KPOINTS / POSCAR）', '能带图上的高对称点标签',
  '体积文件格式（按 VESTA 手册 + VASP 文档补齐）', '二维截面（对应 VESTA 的 2D Data Display）',
  'VESTA 命令行导出（手册第 17 章）', '用 VESTA 做结构格式转换（-open / -save）',
  '与 VESTA 的逐点交叉校验（体积解析）', '读 VESTA 自己算的结构摘要（文本区）', '让 VESTA 算几何参数（-list bond）',
  '工具入口：vesta_analyze', '成键判据与 VESTA 键表对照', '一维线剖面（Line Profile，手册 14.13）',
  '峰搜索（Peak Search，手册 14.14）', '电子密度派生量（手册 14.15）', '工具入口：volume_analyze',
  'OUTCAR 应力张量与逐原子受力', 'IBZKPT：不可约 k 点与对称性约化', '跨文件带隙核对（DOS ↔ EIGENVAL）',
  '体检检查项文档化', 'POTCAR ZVAL ↔ NELECT 自洽检查', '综合判语（体系类型 + 结果可用性）',
  '可执行建议（从体检结果直接给动作）', '结构因子（-calcf）：终于打通，并找到两个坑',
  '自己的结构因子实现（与 VESTA 表逐条对照）', 'X 射线粉末衍射（本地计算，无需 VESTA）',
  '散射因子元素扩展（自带采集器）', '真实数据：未跑过的任务也能对比 INCAR',
  '板层分层与吸附高度（layerProfile / adsorbateHeight）', '吸附位点自动判别（adsorbateSite）',
  '板层批量报表（slab-report）', '装配集成测试（tools.test.mjs）', '真实调用冒烟测试（tools-smoke.test.mjs）',
  '第二批冒烟测试（tools-smoke2.test.mjs）与一处描述错误', '第三、四批冒烟：VESTA 进程类工具与轨迹播放器',
  '功函数（LOCPOT）', '工具描述审计（触发语）', '参数描述审计（单位 / 范围）', 'README 目录（自动生成 + 测试守护）',
]

const headingsOf = (file) => readFileSync(`${ROOT}/${file}`, 'utf8')
  .split(/\r?\n/)
  .filter((line) => /^## /.test(line))
  .map((line) => line.slice(3).trim())

test('分册与 README 合起来覆盖全部 64 个专题节', () => {
  const present = new Set(FILES.flatMap(headingsOf))
  const missing = CANONICAL.filter((title) => !present.has(title))
  assert.deepEqual(missing, [], `这些节丢了：${missing.join(' / ')}`)
  assert.equal(CANONICAL.length, 64)
})

test('README 保持精简（导航 + 工具清单）', () => {
  const lines = readFileSync(`${ROOT}/README.md`, 'utf8').split(/\r?\n/).length
  assert.ok(lines < 120, `README 又变长了：${lines} 行`)
  const text = readFileSync(`${ROOT}/README.md`, 'utf8')
  for (const file of ['docs/PROJECT.md', 'docs/VIZ.md', 'docs/VASP.md', 'docs/VESTA.md', 'docs/QUALITY.md']) {
    assert.ok(text.includes(file), `README 缺少到 ${file} 的链接`)
    assert.ok(statSync(`${ROOT}/${file}`).size > 1000, `${file} 太小，可能没写进去`)
  }
})
