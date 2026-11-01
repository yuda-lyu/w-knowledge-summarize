// knownConcepts.mjs — 既有概念之判定(檢定標準 SS6「多概念擠一標籤,各段皆為既有概念才拆」之拆分條件)
//
// 【來源】全庫筆記之合格概念標籤(conceptLabelProblem 無問題者)＋核心集合(cores,選讀;下游工作所擁有之主題)之概念,比對以分群鍵
//   (normalizeConcept:字形折疊、改名、別名)——新進(摘要段、人工匯入)、同步(ops/syncNotes)與存量處置判同一集合。
// 【時點】呼叫端於處理前讀一次(全表讀筆記與核心);同一輪中新寫入之筆記之概念不在本次集合內——下一輪才算既有(保守:不拆即不合格、
//   交重試,不會錯拆)。

import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { normalizeConcept } from '../core/capturePackage.mjs'
import { conceptLabelProblem } from '../standards/noteStandards.mjs'

/**
 * 讀既有概念集合,回傳判定函數
 *
 * @param {Object} stores 輸入集合(notes 必要;cores 選填,缺則只取筆記)
 * @returns {Promise} 回傳 Promise，resolve 回傳 (標籤) => Boolean(其分群鍵是否為既有概念)
 * @throws {Error} stores.notes 缺 select 方法時拋出
 * @example
 * const stores = {
 *     notes: { select: async () => [{ concepts: ['太陽黑子'] }] },
 *     cores: { select: async () => [{ concept: '日冕' }] },
 * }
 * const known = await knownConceptOf(stores)
 * console.log(known('太陽黑子'), known('日冕'), known('彗星'))
 * // => true true false
 */
export async function knownConceptOf(stores) {
    if (!isfun(stores?.notes?.select)) throw new Error('knownConceptOf 需要 stores.notes(具 select 方法)')
    const keys = new Set()
    for (const n of await stores.notes.select()) {
        for (const c of isarr(n?.concepts) ? n.concepts : []) if (typeof c === 'string' && !conceptLabelProblem(c)) keys.add(normalizeConcept(c))
    }
    for (const c of isfun(stores?.cores?.select) ? await stores.cores.select() : []) if (c?.concept) keys.add(normalizeConcept(c.concept))
    return (label) => keys.has(normalizeConcept(label))
}

export default { knownConceptOf }
