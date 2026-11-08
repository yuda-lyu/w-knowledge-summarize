// noteProduced.mjs — 筆記之產出鏈(produced):各寫入點組出「記錄欄」與「md front matter 純量鍵」之單一實作
//
// 規格:跨套件之產出鏈規格(結構 §2、位置 §3、stage 列舉 §4、共用件 §5);使用端需求見 Gitea #107。
//
// 【結構】記錄加三欄:produced(最後一筆)、producedHistory(每次寫入追加一筆,含最後一筆;上限 50,超出捨最舊)、producedHistoryDropped(累計捨去數)。
//   produced 一律由抓取套件之 makeProduced 組、producedHistory 一律由 appendProduced 追加(不自行拼物件)。
//   md front matter 只加純量鍵:produced_stamp、produced_stage、produced_provider(值為 null 者省略該鍵;物件不入 front matter——
//   現行 front matter 序列化只支援純量與字串陣列);真理源為記錄,front matter 之鍵僅供人與檔案搜尋,查詢(ops/notesByProvenance)一律讀記錄。
// 【寫入時機】本套件落筆記之各處(新建與改寫)皆經本檔組出:摘要新建(AI)、人工匯入、分類法重標(機械／AI)、同步入口與存量處置之確定性修正。
//   只把使用者之編修同步回記錄(ops/syncNotes 未做確定性修正者)、預篩只寫文件記錄、修補與覆核發生於新建之前者,皆不單獨寫既有筆記,故不在此列。
// 【stage】規格 §4 列舉之 summarize、ingest、retag、standards-fix;本套件各寫入點與之對照見 NOTE_WRITE_STAGE
//   (預篩只寫文件記錄不寫筆記;修補與覆核發生於新建之前,影響「新建」之內容但不單獨寫既有筆記——故不另列其 stage)。
// 【不呼叫 AI 之寫入】seat 與 provider 同時為 null(規格 §2.1);輪次外(手動 ops／CLI)之寫入 stamp 為 null;舊記錄不回填。
// 【provider 取該次呼叫結果之 providerId】遞補時為遞補者;無法得知(空字串,如覆寫之 callAI 未回 providerId)者不寫產出鏈(寧缺勿假)——該筆如同舊記錄。
// 【at】取 clock.iso8() 之值;非「YYYY-MM-DDTHH:mm:ss±hh:mm」形狀者(如測試之固定字串)改取機器本地現在(makeProduced 之預設)。

import isobj from 'wsemi/src/isobj.mjs'
import { makeProduced, appendProduced, pkgIdOf } from '../core/capturePackage.mjs'

/**
 * 本套件各筆記寫入點所用之 stage(規格 §4:summarize、ingest、retag、standards-fix)
 *
 * @type {Object}
 */
export const NOTE_WRITE_STAGE = Object.freeze({
    /** 摘要子階段新建筆記(AI;含修補與覆核之結果) */
    summarize: 'summarize',
    /** 人工／代理匯入(ops/ingestNotes;不呼叫 AI,seat／provider 皆 null) */
    ingest: 'ingest',
    /** 分類法重標之 AI 重判(stages/retagStage;seat 為重標所用之席位路徑、provider 為該批成交者、promptFp 為重標角色之指紋) */
    retag: 'retag',
    /** 分類法重標之機械改名與 categoryRaw 採納(stages/retagStage;不呼叫 AI,seat／provider 皆 null) */
    retagMech: 'standards-fix',
    /** 同步入口之確定性修正(ops/syncNotes;不呼叫 AI) */
    syncFix: 'standards-fix',
    /** 存量處置(standards/stockFix;不呼叫 AI) */
    stockFix: 'standards-fix',
})

/** md front matter 之產出鏈純量鍵(依序) */
export const PRODUCED_FRONT_KEYS = Object.freeze(['produced_stamp', 'produced_stage', 'produced_provider'])

/** 記錄之產出鏈欄位(依序) */
export const PRODUCED_RECORD_FIELDS = Object.freeze(['produced', 'producedHistory', 'producedHistoryDropped'])

const LOCAL_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/

/**
 * 由一筆 produced 取 md front matter 之純量鍵(值為 null 之鍵省略)
 *
 * @param {Object} produced 輸入 makeProduced 之產物
 * @returns {Object} 回傳 { produced_stamp?, produced_stage, produced_provider? };produced 非物件回 {}
 * @example
 * let p = { v: 1, stamp: '20261108200009', stage: 'summarize', seat: 'summarize.ai', provider: 'codex:gpt-6.1-terra', pkg: 'w-x@1.0.0', at: '2026-11-08T20:12:31+08:00' }
 * console.log(producedFrontOf(p))
 * // => {
 * //   produced_stamp: '20261108200009',
 * //   produced_stage: 'summarize',
 * //   produced_provider: 'codex:gpt-6.1-terra'
 * // }
 *
 * console.log(producedFrontOf({ ...p, stamp: null, seat: null, provider: null }))
 * // => { produced_stage: 'summarize' }
 */
export function producedFrontOf(produced) {
    if (!isobj(produced)) return {}
    const out = {}
    if (produced.stamp !== null && produced.stamp !== undefined) out.produced_stamp = produced.stamp
    if (produced.stage !== null && produced.stage !== undefined) out.produced_stage = produced.stage
    if (produced.provider !== null && produced.provider !== undefined) out.produced_provider = produced.provider
    return out
}

/**
 * 把產出鏈之純量鍵併入既有之 front matter(不改輸入):既有之 produced_* 鍵原位更新、新值為 null 者刪除、尚無者附於最後;其餘鍵原樣
 *
 * @param {Object} front 輸入 front matter 物件，非物件視為{}
 * @param {Object} produced 輸入 makeProduced 之產物
 * @returns {Object} 回傳新 front matter 物件
 * @example
 * let front = { title: 'T', produced_stamp: '20261108100000', produced_provider: 'a:b', created: 'c' }
 * let p = { v: 1, stamp: '20261108110000', stage: 'standards-fix', seat: null, provider: null, pkg: 'w-x@1.0.0', at: '2026-11-08T11:00:00+08:00' }
 * console.log(withProducedFront(front, p))
 * // => {
 * //   title: 'T',
 * //   produced_stamp: '20261108110000',
 * //   created: 'c',
 * //   produced_stage: 'standards-fix'
 * // }
 */
export function withProducedFront(front, produced) {
    const out = { ...(isobj(front) ? front : {}) }
    const add = producedFrontOf(produced)
    for (const k of PRODUCED_FRONT_KEYS) {
        if (!(k in out)) continue
        if (k in add) out[k] = add[k]
        else delete out[k]
    }
    for (const k of PRODUCED_FRONT_KEYS) {
        if (k in add && !(k in out)) out[k] = add[k]
    }
    return out
}

/**
 * 組一次寫入之產出鏈:produced(makeProduced)、追加歷史(appendProduced)、md front matter 之純量鍵
 *
 * - o.ai 未給或為 null＝不呼叫 AI 之寫入(seat、provider 同時 null);給了 { seat, provider, promptFp? } 者為 AI 呼叫之產出
 * - o.ai.provider 非非空字串(無法得知實際成交條目)→ 回 null:該筆不寫產出鏈(寧缺勿假;呼叫端照舊寫入筆記)
 * - 套件版取自本套件 package.json(pkgIdOf);取不到(非 file: 位置之 UMD)回 null
 *
 * @param {Object} cur 輸入現值記錄(取 producedHistory、producedHistoryDropped;新筆記傳 {})，非物件視為{}
 * @param {Object} o 輸入設定物件
 * @param {String} o.stage 輸入 stage(NOTE_WRITE_STAGE 之值)
 * @param {String|null} [o.stamp=null] 輸入輪次 stamp(段內之 ctx.stamp;輪次外為 null)
 * @param {Object|null} [o.ai] 輸入 AI 呼叫之產出 { seat(設定路徑,如 'summarize.ai'), provider(實際成交條目 id), promptFp?(16 碼指紋;null 視同未給) };未給或 null＝不呼叫 AI
 * @param {String} [o.nowIso] 輸入寫入時刻(clock.iso8();形狀不合者取機器本地現在)
 * @returns {Object|null} 回傳 { produced, patch:{ produced, producedHistory, producedHistoryDropped }, front:{ produced_* 純量鍵 } };不寫產出鏈時回 null
 * @throws {Error} o 非物件、stage／stamp 不合規格、cur.producedHistory 形狀不合時拋出(訊息見 makeProduced、appendProduced)
 * @example
 * let r = noteProducedOf({}, { stage: 'summarize', stamp: '20261108200009', ai: { seat: 'summarize.ai', provider: 'codex:gpt-6.1-terra' }, nowIso: '2026-11-08T20:12:31+08:00' })
 * console.log(r.produced.provider, r.patch.producedHistory.length, r.front)
 * // => codex:gpt-6.1-terra 1 {
 * //   produced_stamp: '20261108200009',
 * //   produced_stage: 'summarize',
 * //   produced_provider: 'codex:gpt-6.1-terra'
 * // }
 *
 * let r2 = noteProducedOf(r.patch, { stage: 'standards-fix', nowIso: '2026-11-08T21:00:00+08:00' })
 * console.log(r2.produced.seat, r2.patch.producedHistory.map((x) => x.stage))
 * // => null [ 'summarize', 'standards-fix' ]
 *
 * console.log(noteProducedOf({}, { stage: 'summarize', ai: { seat: 'summarize.ai', provider: '' } }))
 * // => null
 */
export function noteProducedOf(cur, o) {

    //check
    if (!isobj(o)) {
        throw new Error('noteProducedOf 需要設定物件 { stage, stamp?, ai?, nowIso? }')
    }
    if (!isobj(cur)) {
        cur = {}
    }

    const ai = isobj(o.ai) ? o.ai : null
    if (ai && !(typeof ai.provider === 'string' && ai.provider.trim() !== '')) return null
    const pkg = pkgIdOf(import.meta.url)
    if (!pkg) return null

    const base = {
        stamp: o.stamp ?? null,
        stage: o.stage,
        seat: ai ? ai.seat : null,
        provider: ai ? ai.provider : null,
        ...(ai && ai.promptFp ? { promptFp: ai.promptFp } : {}),
        pkg,
    }
    let produced
    if (typeof o.nowIso === 'string' && LOCAL_ISO_RE.test(o.nowIso)) {
        try {
            produced = makeProduced({ ...base, at: o.nowIso })
        }
        catch (e) {
            // 形狀合而日期不真(如不存在之日、25 時):時鐘字串不合格不拖垮寫入,改取機器本地現在;其餘不合(stage、stamp 等)照拋
            if (!/^invalid o\.at:/.test(String(e?.message))) throw e
        }
    }
    if (!produced) produced = makeProduced(base)
    const patch = appendProduced({ producedHistory: cur.producedHistory, producedHistoryDropped: cur.producedHistoryDropped }, produced)
    return { produced: patch.produced, patch, front: producedFrontOf(patch.produced) }
}

export default { NOTE_WRITE_STAGE, PRODUCED_FRONT_KEYS, PRODUCED_RECORD_FIELDS, producedFrontOf, withProducedFront, noteProducedOf }
