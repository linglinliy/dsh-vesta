/**
 * 验证清单解析与判定（纯函数，无 GUI 依赖，便于无桌面环境回归测试）。
 *
 * 试次文件格式：JSONL（每行一个对象），允许 UTF-8 BOM、CRLF、空行。
 * 解析失败的行不会被悄悄丢弃，而是记录到 invalid 并让上层判定为基础设施失败。
 */

/** 去掉文件开头的 BOM（只去一次）。 */
export function stripBom(text) {
  const value = String(text ?? '')
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value
}

/**
 * 解析 JSONL 试次文件。
 * @param {string} text - 原始文本（可含 BOM / CRLF）。
 * @returns {{ rows: object[], invalid: {line:number, reason:string, raw:string}[] }}
 */
export function parseTrials(text) {
  const rows = []
  const invalid = []
  const lines = stripBom(text).split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim()
    if (!raw) continue
    try {
      const row = JSON.parse(raw)
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        invalid.push({ line: index + 1, reason: 'not-an-object', raw: raw.slice(0, 120) })
        continue
      }
      if (typeof row.phase !== 'string' || !row.phase) {
        invalid.push({ line: index + 1, reason: 'missing-phase', raw: raw.slice(0, 120) })
        continue
      }
      rows.push(row)
    } catch {
      invalid.push({ line: index + 1, reason: 'invalid-json', raw: raw.slice(0, 120) })
    }
  }
  return { rows, invalid }
}

/**
 * 从解析结果里取几何与正对照，并给出基础设施判定。
 * @param {{rows: object[], invalid: object[]}} parsed
 */
export function inspectTrials(parsed) {
  const rows = parsed.rows ?? []
  const geometry = rows.find((row) => row.phase === 'E1')?.geometry ?? null
  const controls = rows.filter((row) => row.phase === 'PC1' || row.phase === 'PC2')
  const trials = rows.filter((row) => row.phase === 'E2')
  const infraOk = Boolean(geometry) && parsed.invalid.length === 0
  return {
    geometry,
    controls,
    trials,
    infraOk,
    infraReason: geometry ? (parsed.invalid.length ? `invalid-lines:${parsed.invalid.length}` : '') : 'missing-E1',
  }
}

/**
 * 差异阈值判定：仅作为“候选”诊断，不驱动任何隐藏动作。
 * @param {object} row
 * @param {{diff?: number, yellowDelta?: number}} [thresholds]
 */
export function isCandidate(row, thresholds = {}) {
  const diffLimit = thresholds.diff ?? 0.05
  const yellowLimit = thresholds.yellowDelta ?? 40
  const stats = row?.stats ?? {}
  const diff = Number(stats.diffLocal ?? 0)
  const yellowDelta = Number(stats.yellowAfter ?? 0) - Number(stats.yellowBefore ?? 0)
  return diff > diffLimit || yellowDelta > yellowLimit
}
