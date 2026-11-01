// docStatus.mjs — 本套件讀寫之文件欄位值(單一來源):文件狀態、略過類別(skipKind)、預篩判定(triage 欄)
//
// 【狀態之值域屬抓取套件】文件之狀態機(new → raw → noted／skip;raw → summarize-failed)由抓取套件定義(其 DOC_STATUS／DOC_STATUSES);本套件只讀寫
//   其中四個狀態,由抓取套件之 DOC_STATUS 組成(不另寫字面),預篩、摘要、人工匯入與重開一律取此處之常數。
// 【略過類別】轉 skip 時之 skipKind:素材壞了而未能換法重抓者取抓取套件之 SKIP_KIND_MATERIAL(抓取套件之來源統計據以不計為已判定);
//   預篩判無關(triage)與摘要判非知識(not-knowledge)為本套件對內容之判定(抓取套件計為已判定)。
// 【預篩判定】文件之 triage 欄:未設＝待預篩;relevant＝放行(摘要只取此類);irrelevant＝攔下;reject-pending＝攔下待第二席確認。
//   預篩段寫、摘要段讀,兩段取同一常數。

import { SKIP_KIND_MATERIAL, DOC_STATUS } from '../core/capturePackage.mjs'

/**
 * 本套件讀寫之文件狀態(值取抓取套件之 DOC_STATUS):pending 待預篩／待摘要(raw)、failed 摘要試滿仍做不出合格筆記之終態、noted 已成筆記、skip 已判定無筆記
 *
 * @type {Object}
 */
export const SUMMARIZE_DOC_STATUS = Object.freeze({ pending: DOC_STATUS.raw, failed: DOC_STATUS.summarizeFailed, noted: DOC_STATUS.noted, skip: DOC_STATUS.skip })

/**
 * 本套件轉 skip 時之 skipKind:triage 預篩判無關、notKnowledge 摘要判非知識、material 素材壞了而未能換法重抓(抓取套件之值)
 *
 * @type {Object}
 */
export const SUMMARIZE_SKIP_KIND = Object.freeze({ triage: 'triage', notKnowledge: 'not-knowledge', material: SKIP_KIND_MATERIAL })

/**
 * 文件之預篩判定(triage 欄之值;未設＝待預篩)
 *
 * @type {Object}
 */
export const TRIAGE_STATE = Object.freeze({ relevant: 'relevant', irrelevant: 'irrelevant', rejectPending: 'reject-pending' })

/**
 * 預篩攔下者之 skipReason 字首(可稽核;skipKind 未記之舊記錄以之辨認預篩攔下)
 *
 * @type {String}
 */
export const TRIAGE_SKIP_PREFIX = '預篩：'

/**
 * 預篩放行(摘要只取此類;預篩停用時摘要不看此欄)
 *
 * @param {Object} doc 輸入文件記錄
 * @returns {Boolean} 回傳是否已放行
 * @example
 * console.log(triageReadyOf({ triage: 'relevant' }), triageReadyOf({}))
 * // => true false
 */
export function triageReadyOf(doc) {
    return doc?.triage === TRIAGE_STATE.relevant
}

/**
 * 待預篩(含攔下待第二席確認):未放行亦未攔下
 *
 * @param {Object} doc 輸入文件記錄
 * @returns {Boolean} 回傳是否待預篩
 * @example
 * console.log(triagePendingOf({}), triagePendingOf({ triage: 'reject-pending' }), triagePendingOf({ triage: 'relevant' }))
 * // => true true false
 */
export function triagePendingOf(doc) {
    return !doc?.triage || doc.triage === TRIAGE_STATE.rejectPending
}

/**
 * raw 池依預篩之分法(兩關容量不同,合計會誤判塞在哪一關):已放行待摘要 ready、待預篩 untriaged(含待確認)——與摘要選池同一判準
 *
 * @param {Array} rawDocs 輸入 raw 文件陣列
 * @returns {Object} 回傳 { ready:Integer, untriaged:Integer }
 * @example
 * console.log(rawPoolSplitOf([{ triage: 'relevant' }, {}, { triage: 'reject-pending' }]))
 * // => { ready: 1, untriaged: 2 }
 */
export function rawPoolSplitOf(rawDocs) {
    let ready = 0
    let untriaged = 0
    for (const d of Array.isArray(rawDocs) ? rawDocs : []) {
        if (triageReadyOf(d)) ready++
        else if (triagePendingOf(d)) untriaged++
    }
    return { ready, untriaged }
}

export default { SUMMARIZE_DOC_STATUS, SUMMARIZE_SKIP_KIND, TRIAGE_STATE, TRIAGE_SKIP_PREFIX, triageReadyOf, triagePendingOf, rawPoolSplitOf }
