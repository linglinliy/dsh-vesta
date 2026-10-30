/**
 * E4 判定的反例测试（无 GUI）。
 *   node --test test/e4-lib.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { e4Verdict, newAtomLines, structureEqual, structureSnapshot } from '../scripts/e4-lib.mjs'

const textWithAtom = [
  'Structure parameters',
  ' a b c alpha beta gamma',
  ' 5.4300 5.4300 5.4300 90.0000 90.0000 90.0000',
  ' Atom  1  Si1  Si  0.00000  0.00000  0.00000',
  ' Atom  2  Si2  Si  0.25000  0.25000  0.25000',
].join('\n')

test('历史 Atom 行不能当作本次选中证据', () => {
  const added = newAtomLines(textWithAtom, textWithAtom)
  assert.deepEqual(added, [])
  const verdict = e4Verdict({
    yellowBefore: 0, yellowAfter: 0, addedAtomLines: added,
    delSent: true, regionDiffDel: 0.2, regionDiffRestore: 0.0, structureUnchanged: true,
  })
  assert.equal(verdict.selectionObserved, false)
  assert.equal(verdict.identityResolved, false)
})

test('本次新增 Atom 行才算身份解析成功', () => {
  const added = newAtomLines(textWithAtom, `${textWithAtom}\nAtom:  2  Si2  Si  0.25 0.25 0.25`)
  assert.equal(added.length, 1)
  const verdict = e4Verdict({
    yellowBefore: 0, yellowAfter: 669, addedAtomLines: added,
    delSent: true, regionDiffDel: 0.2, regionDiffRestore: 0.0, structureUnchanged: true,
  })
  assert.equal(verdict.selectionObserved, true)
  assert.equal(verdict.identityResolved, true)
})

test('只有黄色没有身份输出时，selectionObserved 仍为 false', () => {
  const verdict = e4Verdict({
    yellowBefore: 0, yellowAfter: 669, addedAtomLines: [],
    delSent: true, regionDiffDel: 0.2, regionDiffRestore: 0.0, structureUnchanged: true,
  })
  assert.equal(verdict.selectionObserved, false)
})

test('故意不执行 Del 时 effectVerified 必须为 false', () => {
  const verdict = e4Verdict({
    yellowBefore: 0, yellowAfter: 669, addedAtomLines: ['Atom:  2  Si2'],
    delSent: false, regionDiffDel: 0.2, regionDiffRestore: 0.0, structureUnchanged: true,
  })
  assert.equal(verdict.effectVerified, false)
  assert.equal(verdict.restorationVerified, false)
})

test('发了 Del 但目标区域没变化时 effectVerified 为 false', () => {
  const verdict = e4Verdict({
    yellowBefore: 0, yellowAfter: 669, addedAtomLines: ['Atom:  2  Si2'],
    delSent: true, regionDiffDel: 0.0, regionDiffRestore: 0.0, structureUnchanged: true,
  })
  assert.equal(verdict.effectVerified, false)
})

test('结构快照比较看完整字段，不是只看行数', () => {
  const a = structureSnapshot(textWithAtom)
  const b = structureSnapshot(textWithAtom.replace('0.25000  0.25000  0.25000', '0.25000  0.25000  0.26000'))
  assert.equal(a.rows.length, b.rows.length)
  assert.equal(structureEqual(a, b), false)
  assert.equal(structureEqual(a, structureSnapshot(textWithAtom)), true)
})

test('恢复后区域差异过大会判恢复失败', () => {
  const verdict = e4Verdict({
    yellowBefore: 0, yellowAfter: 669, addedAtomLines: ['Atom:  2  Si2'],
    delSent: true, regionDiffDel: 0.2, regionDiffRestore: 0.2, structureUnchanged: true,
  })
  assert.equal(verdict.restorationVerified, false)
})
