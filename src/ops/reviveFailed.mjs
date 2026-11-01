// reviveFailed.mjs — 把摘要終態(summarize-failed)之文件重開回待摘要佇列(維運能力;終態保留原文可重開)
//
// 【為何需要】summarize-failed 是「試滿 maxTries 仍做不出合格摘要」之判定,前提是模型、提示詞與檢定標準不變;其一改變(換席位、
//   標準修正、修補呼叫開啟)或使用者判讀待判後,即應可重來。記錄永不刪,原文於終態瘦身前已另存(抓取套件之原文另存)。
// 【重開＝】status→raw、summarizeTries 歸零、faithTries 歸零、lastError 清空、原文自另存回填(docs 已瘦身者;回填之欄位由抓取套件定——
//   docTextRestoreOf,本檔不自列素材欄位)、revivedAt／revivedFrom(原失敗原因)可稽核;stdFeedback 與 summarizeProviders 保留
//   (下次提示詞仍附上次之回饋、末次重試仍避開曾產出不合格者)。該文件未結之待判(閘門標準與 SS14;stores/noteHolds)結案
//   「使用者重開」。依 FIFO 排隊(collectedAt 不動),不插隊。
// 【無原文者不重開】docs 與另存皆無原文 → 列出,不改狀態(重開也只會送空內文)。
// 【預設預演】cfg.apply 不為 true 時只統計與列出、不寫。

import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { docTextOf, docTextRestoreOf } from '../core/capturePackage.mjs'
import { resolveDocHolds } from '../stores/noteHolds.mjs'
import { SUMMARIZE_DOC_STATUS } from '../stores/docStatus.mjs'

/**
 * 重開 summarize-failed 之文件(依 match 篩選;預設預演)
 *
 * @param {Object} stores 輸入集合物件，需含 docs(select／get／patch);docTexts、holds 選填
 * @param {Object} cfg 輸入設定物件
 * @param {Function} cfg.match 輸入篩選函數 (doc) => Boolean，必填
 * @param {String} cfg.nowIso 輸入現在時刻(寫入 revivedAt、待判結案時刻)
 * @param {Boolean} [cfg.apply=false] 輸入 true 才寫入;否則只預演
 * @returns {Promise} 回傳 Promise，resolve 回傳 { failed:Integer(終態總數), matched, revived, holdsResolved, noText:[{ id, url }], sample:Array(前 5 筆 url), apply }
 * @throws {Error} stores.docs 缺方法、cfg.match 非函數、寫入後回驗不符時拋出
 * @example
 * let rows = new Map([['d1', { id: 'd1', status: 'summarize-failed', url: 'u1', text: '原文', lastError: '摘要不合格' }]])
 * let docs = {
 *     select: async (find) => [...rows.values()].filter((d) => d.status === find.status),
 *     get: async (id) => rows.get(id),
 *     patch: async (id, o) => Object.assign(rows.get(id), o),
 * }
 * let dry = await reviveFailedDocs({ docs }, { match: () => true, nowIso: 'T0' })
 * console.log(dry.matched, dry.revived, dry.apply, rows.get('d1').status)
 * // => 1 0 false summarize-failed
 *
 * let r = await reviveFailedDocs({ docs }, { match: () => true, nowIso: 'T0', apply: true })
 * console.log(r.revived, rows.get('d1').status, rows.get('d1').revivedFrom)
 * // => 1 raw 摘要不合格
 */
export async function reviveFailedDocs(stores, cfg = {}) {
    if (!isobj(stores) || !isfun(stores.docs?.select) || !isfun(stores.docs?.get) || !isfun(stores.docs?.patch)) throw new Error('reviveFailedDocs 需要 stores.docs(具 select／get／patch 方法)')
    if (!isfun(cfg?.match)) throw new Error('reviveFailedDocs 需要 match(doc) 函數')
    const apply = cfg.apply === true
    const failed = await stores.docs.select({ status: SUMMARIZE_DOC_STATUS.failed })
    const targets = failed.filter(cfg.match)
    const noText = []
    let revived = 0
    let holdsResolved = 0
    for (const d of targets) {
        const src = await docTextOf(stores, d.id)
        if (!src || !(src.text || src.feedText)) {
            noText.push({ id: d.id, url: d.url || '' })
            continue
        }
        if (!apply) continue
        const patch = {
            status: SUMMARIZE_DOC_STATUS.pending, summarizeTries: 0, faithTries: 0, lastError: '',
            revivedAt: String(cfg.nowIso || ''), revivedFrom: String(d.lastError || '').slice(0, 120),
            // 已瘦身者自另存回填原文(同一份:另存寫入時回讀比對過;欄位由抓取套件定)
            ...docTextRestoreOf(src),
        }
        await stores.docs.patch(d.id, patch)
        const back = await stores.docs.get(d.id)
        if (back?.status !== SUMMARIZE_DOC_STATUS.pending || (back.text || '') !== src.text || (back.feedText || '') !== (src.feedText || '')) throw new Error(`文件 ${d.id} 重開後回驗不符`)
        revived++
        if (stores.holds) holdsResolved += await resolveDocHolds(stores.holds, d.id, { how: `使用者重開（reviveFailedDocs）：狀態回 raw、tries 歸零${src.from === 'archive' ? '、原文自 docTexts 回填' : ''}`, nowIso: cfg.nowIso, withFaith: true })
    }
    return { failed: failed.length, matched: targets.length, revived, holdsResolved, noText, sample: targets.slice(0, 5).map((d) => d.url), apply }
}

export default { reviveFailedDocs }
