/**
 * E4（选中 → 显示操作 → 恢复）的判定逻辑：纯函数，便于无 GUI 反例测试。
 *
 * 设计要点（对应 VESTA-LATEST-REVIEW.md N2）：
 * - 不读取“历史上存在过的 Atom 行”，只看本次动作**新增**的 Atom 行；
 * - 没执行 Del 时 effectVerified 必须为 false；
 * - 结构是否变化用完整字段快照比较，而不是只看行数；
 * - 信息不足返回 unknown，不把“行数相同”补成 true。
 */

/** 从 VESTA 文本区摘出结构快照：位点行 + 晶胞参数。 */
export function structureSnapshot(text) {
  const body = String(text ?? '')
  const block = body.split(/={20,}/).filter((part) => part.includes('Structure parameters')).pop() ?? ''
  // 兼容两种行首：结构表 "1  Si1  Si ..." 与摘要 "Atom  1  Si1  Si ..."
  const rows = block
    .split(/\r?\n/)
    .filter((line) => /^\s*(\d+|Atom\s+\d+)\s+\S+\s+\S+\s+-?\d/.test(line))
    .map((line) => line.trim().replace(/\s+/g, ' '))
  const cell = (/a\s+b\s+c\s+alpha\s+beta\s+gamma\r?\n\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(block) ?? [])
    .slice(1, 7)
    .map(Number)
  return { rows, cell }
}

/** 两个快照是否完全一致（行内容 + 晶胞参数）。 */
export function structureEqual(a, b) {
  if (!a || !b) return false
  if (a.rows.length !== b.rows.length) return false
  if (a.rows.some((row, index) => row !== b.rows[index])) return false
  if (a.cell.length !== b.cell.length) return false
  return a.cell.every((value, index) => value === b.cell[index])
}

/** 本次动作**新增**的 Atom 行（按出现次数做多重集差，避免历史行冒充）。 */
export function newAtomLines(beforeText, afterText) {
  const count = (text) => {
    const map = new Map()
    for (const line of String(text ?? '').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!/^Atom:\s/.test(trimmed)) continue
      map.set(trimmed, (map.get(trimmed) ?? 0) + 1)
    }
    return map
  }
  const before = count(beforeText)
  const added = []
  for (const [line, times] of count(afterText)) {
    const delta = times - (before.get(line) ?? 0)
    for (let i = 0; i < delta; i += 1) added.push(line)
  }
  return added
}

/**
 * 综合判定。
 * @param {object} input
 * @param {number} input.yellowBefore - 选中前目标区域黄色像素
 * @param {number} input.yellowAfter - 选中后目标区域黄色像素
 * @param {string[]} input.addedAtomLines - 本次新增的 Atom 行
 * @param {boolean} input.delSent - 是否真的发了 Del
 * @param {number} input.regionDiffDel - Del 前后目标区域差异比例
 * @param {number} input.regionDiffRestore - 恢复后与选中态的目标区域差异比例
 * @param {boolean} input.structureUnchanged
 * @param {{diff?: number, restore?: number, yellow?: number}} [thresholds]
 */
export function e4Verdict(input, thresholds = {}) {
  const diffLimit = thresholds.diff ?? 0.02
  const restoreLimit = thresholds.restore ?? 0.01
  const yellowLimit = thresholds.yellow ?? 50
  const yellowDelta = Number(input.yellowAfter ?? 0) - Number(input.yellowBefore ?? 0)

  // 两类独立反馈：视觉标记（黄色）+ 本次新增身份输出
  const selectionObserved = yellowDelta >= yellowLimit && (input.addedAtomLines?.length ?? 0) > 0
  const identityResolved = (input.addedAtomLines?.length ?? 0) > 0
  const effectVerified = Boolean(input.delSent) && Number(input.regionDiffDel ?? 0) > diffLimit
  const restorationVerified = Boolean(input.delSent) && Number(input.regionDiffRestore ?? 1) < restoreLimit
  const structureUnchanged = input.structureUnchanged === true

  return {
    selectionObserved,
    identityResolved,
    effectVerified,
    restorationVerified,
    structureUnchanged,
    yellowDelta,
    details: {
      delSent: Boolean(input.delSent),
      regionDiffDel: Number(input.regionDiffDel ?? 0),
      regionDiffRestore: Number(input.regionDiffRestore ?? 1),
      addedAtomLines: input.addedAtomLines ?? [],
    },
  }
}
