// noteHolds.mjs — 摘要之檢定標準待判(core/stores/holds 之摘要端用法:登錄、改判、結案、終態轉使用者)
//
// 【文件之待判(物件 doc,oid＝文件 id)】摘要納入閘判不納入(SS2／SS3／SS4／SS6／SS11)→ 登錄(負責者 pipeline,下一步「下輪附回饋重摘」);
//   同一文件同時只留一筆未結之閘門待判——改判他標準時舊者結案(記「重摘後改判 X」)。重試耗盡轉 summarize-failed → 該文件未結之待判
//   (閘門標準與 SS14)一律改由使用者處置(重開:ops/reviveFailed 之 reviveFailedDocs;或豁免:core/stores/holds 之 waiveHold＝確認不納入);
//   SS14 不忠實之終態另登錄(SS14 判不了之兩段式流程不變——每次不忠實不登錄,否則下一次判不了會被當成「再判不了」直接轉使用者)。
//   文件轉離 raw(納入、判非知識、素材退回抓取)→ 未結之閘門待判結案。
// 【筆記之待判(物件 note,oid＝筆記 id)】同步入口(ops/syncNotes)確定性修正後仍不合格或未能判定之標準 → 登錄(負責者 user);
//   之後該標準經判定合格 → 結案;筆記已不存在 → 結案。只處理經判定之標準(未判之標準——如無原文時之 SS4——不動其待判)。
// 【重標之待判(物件 note、標準 SS9)】退役類別之重判逾次未成 → 筆記仍在清單外之類別 → 登錄(負責者 user;只記日誌會使之無處可追)。
//   結案條件(重標子階段每輪檢查):筆記已不存在、或類別已在現行清單內。使用者要求重試(requestRetry)→ 重標子階段重排該退役類別之
//   重判工作(其範圍＝仍在該類別之筆記,即逾次未成者);再次未成 → 重新登錄(重試要求隨之失效)。
// 【期限】摘要之待判一律 NOTE_HOLD_DEADLINE_DAYS 天(noteHoldDeadlineOf——期限之機制為抓取套件之 holdDeadlineOf;摘要段之忠實性待判同讀此處);
//   刻意不開放設定。
// 【下一步之字樣】面向使用者:指本套件之處置 API(reviveFailedDocs、requestRetry、waiveHold),不指特定執行端之指令。

import isarr from 'wsemi/src/isarr.mjs'
import { putHold, resolveHold, holdKey, listHolds, holdDeadlineOf, retryRequestedOf } from '../core/capturePackage.mjs'
import { NOTE_STANDARDS } from '../standards/noteStandards.mjs'
import { shortText } from '../standards/noteNormalize.mjs'

/** 摘要納入閘之標準(文件待判之標準) */
const GATE_STDS = NOTE_STANDARDS.map((s) => s.id)
/** 文件待判涵蓋之標準(閘門＋忠實性 SS14) */
const DOC_STDS = [...GATE_STDS, 'SS14']

/** 待判之期限(天;摘要之全部待判同一期限) */
export const NOTE_HOLD_DEADLINE_DAYS = 30

/**
 * 摘要之待判之期限時刻(登錄時刻＋NOTE_HOLD_DEADLINE_DAYS 天;抓取套件之 holdDeadlineOf)
 *
 * @param {String} nowIso 輸入登錄時刻
 * @returns {String} 回傳期限時刻(ISO 8601,UTC)
 * @throws {RangeError} nowIso 不可解析時拋出
 * @example
 * console.log(noteHoldDeadlineOf('2026-10-05T10:00:00+08:00'))
 * // => 2026-11-04T02:00:00.000Z
 */
export function noteHoldDeadlineOf(nowIso) {
    return holdDeadlineOf(nowIso, NOTE_HOLD_DEADLINE_DAYS)
}

/** 文件待判之下一步 */
export const DOC_HOLD_NEXT = Object.freeze({
    retry: '下輪附回饋重摘',
    user: '使用者處置：重開（reviveFailedDocs：原文自 docTexts 回填、狀態回 raw、tries 歸零，下輪重摘）或豁免（waiveHold：確認不納入）',
})

/** 筆記待判(同步入口)之下一步 */
export const NOTE_HOLD_NEXT = '使用者修正 md 後由筆記同步重驗（合格即結案；改標題／概念／一句話重點以外之章亦會重驗），或豁免（waiveHold：確認維持）'

/**
 * 某文件未結之待判
 *
 * @param {Object} holds 輸入 holds 集合
 * @param {String} docId 輸入文件 id
 * @param {Array} [stds] 輸入標準(預設閘門＋SS14)
 * @returns {Promise} 回傳 Promise，resolve 回傳未結案之登錄陣列
 */
async function openDocHolds(holds, docId, stds = DOC_STDS) {
    const out = []
    for (const s of stds) {
        const h = await holds.get(holdKey('doc', docId, s))
        if (h?.status === 'open') out.push(h)
    }
    return out
}

/**
 * 登錄文件之不納入(閘門標準:每次;SS14:只在終態);終態時該文件其餘未結待判一併轉使用者
 *
 * @param {Object} holds 輸入 holds 集合
 * @param {Object} doc 輸入文件記錄(取 id、title)
 * @param {Object} o 輸入 { std:不納入之主要標準, why:原因, terminal:Boolean(已轉 summarize-failed), tries:Integer, nowIso }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { held:Integer, resolved:Integer, escalated:Integer }
 * @example
 * let rows = new Map()
 * let holds = { get: async (id) => rows.get(id) ?? null, replace: async (r) => { rows.set(r.id, r) }, select: async () => [...rows.values()] }
 * let nowIso = new Date().toISOString()
 * let doc = { id: 'd1', title: '恆星分類' }
 * console.log(await putDocHold(holds, doc, { std: 'SS6', why: '概念擠一標籤', nowIso }), rows.get('doc:d1:SS6').owner)
 * // => { held: 1, resolved: 0, escalated: 0 } pipeline
 * console.log(await putDocHold(holds, doc, { std: 'SS2', why: '缺標題', terminal: true, tries: 3, nowIso }), rows.get('doc:d1:SS6').status, rows.get('doc:d1:SS2').owner)
 * // => { held: 1, resolved: 1, escalated: 0 } resolved user
 */
export async function putDocHold(holds, doc, o = {}) {
    const out = { held: 0, resolved: 0, escalated: 0 }
    const std = String(o.std || '')
    const gate = GATE_STDS.includes(std)
    if (gate) {
        // 同一文件只留一筆未結之閘門待判:改判他標準 → 舊者結案
        for (const h of await openDocHolds(holds, doc.id, GATE_STDS.filter((s) => s !== std))) {
            if (await resolveHold(holds, h.id, { how: `重摘後改判 ${std}`, at: o.nowIso })) out.resolved++
        }
    }
    if (gate || (std && o.terminal)) {
        await putHold(holds, {
            object: 'doc', oid: doc.id, std,
            reason: `摘要未達檢定標準（${std}）：〈${shortText(doc.title, 40)}〉${shortText(o.why, 300)}${o.terminal ? `——已試 ${o.tries ?? '?'} 次，轉 summarize-failed` : ''}`,
            next: o.terminal ? DOC_HOLD_NEXT.user : DOC_HOLD_NEXT.retry,
            owner: o.terminal ? 'user' : 'pipeline',
            deadline: noteHoldDeadlineOf(o.nowIso),
            ctx: { title: String(doc.title || ''), tries: String(o.tries ?? '') },
        }, o.nowIso)
        out.held++
    }
    if (o.terminal) out.escalated += await escalateDocHolds(holds, doc, { why: o.why, nowIso: o.nowIso, except: std })
    return out
}

/**
 * 文件轉 summarize-failed(終態)時,其未結之待判一律改由使用者處置
 *
 * @param {Object} holds 輸入 holds 集合
 * @param {Object} doc 輸入文件記錄
 * @param {Object} o 輸入 { why:終態原因, nowIso, except:不處理之標準(已由呼叫端登錄者) }
 * @returns {Promise} 回傳 Promise，resolve 回傳轉使用者之筆數
 * @example
 * let rows = new Map()
 * let holds = { get: async (id) => rows.get(id) ?? null, replace: async (r) => { rows.set(r.id, r) }, select: async () => [...rows.values()] }
 * let nowIso = new Date().toISOString()
 * let doc = { id: 'd1', title: '恆星分類' }
 * await putDocHold(holds, doc, { std: 'SS6', why: '概念擠一標籤', nowIso })
 * console.log(rows.get('doc:d1:SS6').owner, await escalateDocHolds(holds, doc, { why: '重試耗盡', nowIso }), rows.get('doc:d1:SS6').owner)
 * // => pipeline 1 user
 * console.log(await escalateDocHolds(holds, doc, { why: '重試耗盡', nowIso }))
 * // => 0
 */
export async function escalateDocHolds(holds, doc, o = {}) {
    let n = 0
    for (const h of await openDocHolds(holds, doc.id, DOC_STDS.filter((s) => s !== o.except))) {
        // 已轉使用者者不重複:以 owner 判,不比 next 字樣(既有之登錄可能為他版字樣——比字樣會重轉並重複附加原因)
        if (h.owner === 'user') continue
        await putHold(holds, { object: h.object, oid: h.oid, std: h.std, reason: `${shortText(h.reason, 400)}｜其後轉 summarize-failed（${shortText(o.why, 120)}）`, next: DOC_HOLD_NEXT.user, owner: 'user', deadline: noteHoldDeadlineOf(o.nowIso), ctx: h.ctx || {} }, o.nowIso)
        n++
    }
    return n
}

/**
 * 結案文件之未結待判(文件已納入、判非知識、退回抓取,或使用者重開)
 *
 * @param {Object} holds 輸入 holds 集合
 * @param {String} docId 輸入文件 id
 * @param {Object} o 輸入 { how:處置方式, nowIso, withFaith:Boolean(連同 SS14;預設只閘門標準) }
 * @returns {Promise} 回傳 Promise，resolve 回傳結案筆數
 * @example
 * let rows = new Map()
 * let holds = { get: async (id) => rows.get(id) ?? null, replace: async (r) => { rows.set(r.id, r) }, select: async () => [...rows.values()] }
 * let nowIso = new Date().toISOString()
 * await putDocHold(holds, { id: 'd1', title: '恆星分類' }, { std: 'SS6', why: '概念擠一標籤', nowIso })
 * console.log(await resolveDocHolds(holds, 'd1', { how: '已納入', nowIso }), rows.get('doc:d1:SS6').status)
 * // => 1 resolved
 */
export async function resolveDocHolds(holds, docId, o = {}) {
    let n = 0
    for (const h of await openDocHolds(holds, docId, o.withFaith ? DOC_STDS : GATE_STDS)) {
        if (await resolveHold(holds, h.id, { how: String(o.how || ''), at: o.nowIso })) n++
    }
    return n
}

/**
 * 筆記之待判依判定結果更新(同步入口):不合格／未能判定 → 登錄(使用者);經判定合格且有未結者 → 結案
 *
 * @param {Object} holds 輸入 holds 集合
 * @param {Object} note 輸入筆記記錄(取 id、title、file)
 * @param {Array} results 輸入 checkNote 之結果
 * @param {Object} o 輸入 { nowIso, via:String(登錄來源說明,如「筆記同步」) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { held:Array(標準), resolved:Array(標準) }
 * @example
 * let rows = new Map()
 * let holds = { get: async (id) => rows.get(id) ?? null, replace: async (r) => { rows.set(r.id, r) }, select: async () => [...rows.values()] }
 * let nowIso = new Date().toISOString()
 * let note = { id: 'n1', title: '恆星分類', file: 'n1.md' }
 * let bad = [{ std: 'SS6', status: 'violation', detail: '計數尾碼「主序星(12)」' }, { std: 'SS2', status: 'pass' }]
 * console.log(await syncNoteHolds(holds, note, bad, { nowIso }))
 * // => { held: [ 'SS6' ], resolved: [] }
 * console.log(await syncNoteHolds(holds, note, [{ std: 'SS6', status: 'pass' }], { nowIso }), rows.get('note:n1:SS6').how)
 * // => { held: [], resolved: [ 'SS6' ] } 筆記同步重驗合格
 */
export async function syncNoteHolds(holds, note, results, o = {}) {
    const held = []
    const resolved = []
    for (const r of isarr(results) ? results : []) {
        if (!GATE_STDS.includes(r?.std)) continue
        const id = holdKey('note', note.id, r.std)
        if (r.status === 'violation' || r.status === 'undetermined') {
            await putHold(holds, {
                object: 'note', oid: note.id, std: r.std,
                reason: `${o.via || '筆記同步'}後${r.status === 'undetermined' ? '未能判定' : '未達檢定標準'}（${r.std}）：〈${shortText(note.title, 40)}〉${shortText(r.detail, 300)}`,
                next: NOTE_HOLD_NEXT,
                owner: 'user',
                deadline: noteHoldDeadlineOf(o.nowIso),
                ctx: { title: String(note.title || ''), file: String(note.file || '') },
            }, o.nowIso)
            held.push(r.std)
        }
        else if (r.status === 'pass') {
            const h = await holds.get(id)
            if (h?.status === 'open' && await resolveHold(holds, id, { how: `${o.via || '筆記同步'}重驗合格`, at: o.nowIso })) resolved.push(r.std)
        }
    }
    return { held, resolved }
}

/**
 * 筆記已不存在者,其未結之筆記待判結案
 *
 * @param {Object} holds 輸入 holds 集合
 * @param {String} noteId 輸入筆記 id
 * @param {Object} o 輸入 { nowIso, how?:處置方式(預設「筆記已不存在」) }
 * @returns {Promise} 回傳 Promise，resolve 回傳結案筆數
 * @example
 * let rows = new Map()
 * let holds = { get: async (id) => rows.get(id) ?? null, replace: async (r) => { rows.set(r.id, r) }, select: async () => [...rows.values()] }
 * let nowIso = new Date().toISOString()
 * await syncNoteHolds(holds, { id: 'n1', title: '恆星分類' }, [{ std: 'SS2', status: 'undetermined', detail: '缺標題' }], { nowIso })
 * console.log(await resolveNoteHolds(holds, 'n1', { nowIso }), rows.get('note:n1:SS2').how)
 * // => 1 筆記已不存在
 */
export async function resolveNoteHolds(holds, noteId, o = {}) {
    let n = 0
    for (const s of GATE_STDS) {
        const h = await holds.get(holdKey('note', noteId, s))
        if (h?.status === 'open' && await resolveHold(holds, h.id, { how: String(o.how || '筆記已不存在'), at: o.nowIso })) n++
    }
    return n
}

/** 重標待判之標準(檔頭【重標之待判】) */
export const RETAG_HOLD_STD = 'SS9'
/**
 * 重標待判之下一步(面向使用者的處置字樣:要求重試或豁免;putRetagHold 登錄時寫入 next)
 *
 * @type {String}
 */
export const RETAG_HOLD_NEXT = '使用者處置：要求重試（requestRetry：重排該退役類別之重判；類別改到清單內即自動結案）或豁免（waiveHold：確認維持）'

/** 同一筆記於同一重標工作 AI 重判至多幾次未成即略過之(退役類別者登錄待判);重標子階段與待判之原因同讀此值 */
export const RETAG_MAX_FAILS = 2

/**
 * 登錄重標待判:退役類別之重判逾次未成(筆記仍在清單外之類別)
 *
 * @param {Object} holds 輸入 holds 集合
 * @param {Object} note 輸入筆記記錄(取 id、title)
 * @param {Object} o 輸入 { category:退役之類別, why:未成原因, fails:Integer, nowIso }
 * @returns {Promise} 回傳 Promise，resolve 回傳 undefined
 * @example
 * let rows = new Map()
 * let holds = { get: async (id) => rows.get(id) ?? null, replace: async (r) => { rows.set(r.id, r) }, select: async () => [...rows.values()] }
 * let nowIso = new Date().toISOString()
 * await putRetagHold(holds, { id: 'n1', title: '恆星分類' }, { category: '舊分類', why: '回覆不在清單', fails: 2, nowIso })
 * console.log(rows.get('note:n1:SS9').reason)
 * // => 退役類別「舊分類」之重判 2 次未成（回覆不在清單）：〈恆星分類〉仍在已退役之類別
 * console.log(rows.get('note:n1:SS9').owner, rows.get('note:n1:SS9').next === RETAG_HOLD_NEXT)
 * // => user true
 */
export async function putRetagHold(holds, note, o = {}) {
    await putHold(holds, {
        object: 'note', oid: note.id, std: RETAG_HOLD_STD,
        reason: `退役類別「${o.category}」之重判 ${o.fails ?? RETAG_MAX_FAILS} 次未成（${shortText(o.why, 120)}）：〈${shortText(note.title, 40)}〉仍在已退役之類別`,
        next: RETAG_HOLD_NEXT,
        owner: 'user',
        deadline: noteHoldDeadlineOf(o.nowIso),
        ctx: { title: String(note.title || ''), category: String(o.category || '') },
    }, o.nowIso)
}

/**
 * 重標待判之結案與重試(重標子階段每輪):筆記不在 → 結案;類別已在清單內 → 結案;使用者要求重試(抓取套件之 retryRequestedOf:要求晚於
 *   登錄之最後更新)→ 回傳該筆記現所在之退役類別(呼叫端重排其重判工作)
 *
 * @param {Object} holds 輸入 holds 集合
 * @param {Map} notesById 輸入筆記 id → 記錄
 * @param {Array} categories 輸入現行類別清單
 * @param {Object} o 輸入 { nowIso }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { resolved:Integer, open:Integer, retry:Array(類別;去重) }
 * @example
 * let rows = new Map()
 * let holds = { get: async (id) => rows.get(id) ?? null, replace: async (r) => { rows.set(r.id, r) }, select: async () => [...rows.values()] }
 * let nowIso = new Date().toISOString()
 * for (let id of ['n1', 'n2', 'n3']) await putRetagHold(holds, { id, title: `筆記 ${id}` }, { category: '舊分類', why: '回覆不在清單', nowIso })
 * rows.get('note:n1:SS9').retryRequestedAt = new Date(Date.now() + 60000).toISOString() // 模擬使用者要求重試(requestRetry)之紀錄
 * let notes = new Map([['n1', { id: 'n1', category: '舊分類' }], ['n3', { id: 'n3', category: '恆星' }]])
 * console.log(await settleRetagHolds(holds, notes, ['恆星', '其他'], { nowIso }))
 * // => { resolved: 2, open: 1, retry: [ '舊分類' ] }
 * console.log(rows.get('note:n2:SS9').how, rows.get('note:n3:SS9').how)
 * // => 筆記已不存在 類別已在清單內（恆星）
 */
export async function settleRetagHolds(holds, notesById, categories, o = {}) {
    const out = { resolved: 0, open: 0, retry: [] }
    const list = isarr(categories) ? categories : []
    for (const h of await listHolds(holds, { status: 'open', object: 'note', std: RETAG_HOLD_STD })) {
        const n = notesById instanceof Map ? notesById.get(h.oid) : null
        const how = !n ? '筆記已不存在' : (list.includes(n.category) ? `類別已在清單內（${n.category}）` : '')
        if (how) {
            if (await resolveHold(holds, h.id, { how, at: o.nowIso })) out.resolved++
            continue
        }
        out.open++
        if (retryRequestedOf(h) && !out.retry.includes(n.category)) out.retry.push(n.category)
    }
    return out
}

export default {
    NOTE_HOLD_DEADLINE_DAYS, noteHoldDeadlineOf, DOC_HOLD_NEXT, NOTE_HOLD_NEXT,
    putDocHold, escalateDocHolds, resolveDocHolds, syncNoteHolds, resolveNoteHolds, RETAG_HOLD_STD, RETAG_HOLD_NEXT, RETAG_MAX_FAILS, putRetagHold, settleRetagHolds,
}
