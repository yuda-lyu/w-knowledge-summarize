// notesByProvenance.mjs — 依產出鏈選件(純讀):自筆記記錄之 produced／producedHistory 取回符合條件之筆記
//
// 規格:跨套件之產出鏈規格 §6(summarize:notesByProvenance);使用端需求見 Gitea #107。
//
// 【用途】出問題時依「哪一輪(stamp)、哪個階段(stage)、哪個席位(seat)、實際成交條目(provider)、何時(since／until)」選出筆記,
//   交呼叫端走各自既有之路徑重處理或撤出(重摘要、稽核撤出等;本檔不新增任何寫入路徑)。
// 【純讀】只讀 stores.notes.select(),不寫記錄、不讀 md、不呼叫 AI。
// 【條件皆為「且」】未給之條件不限;stamp／seat／provider 給 null 者選「該欄為 null」之寫入(輪次外之手動寫入、不呼叫 AI 之寫入);
//   since／until 比對 produced.at(以時刻比較,含邊界;時區偏移不同亦可比);給了而不合者拋錯(不靜默忽略——條件被丟掉會選出整庫)。
// 【預設只比對 produced(最後一筆)】history:true 時比對 producedHistory 任一筆(同一筆須滿足全部條件);此時回傳之 produced 為
//   該筆記「最近一筆符合條件者」(不一定是最後一筆)。
// 【舊記錄不出現】無 produced 者(舊記錄不回填;或成交條目未知而未寫產出鏈者)不出現在任何結果。
// 【排序】依 slug(記錄 id)升冪,結果與集合之讀序無關。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'

/** 條件之可用鍵 */
const COND_KEYS = Object.freeze(['stamp', 'stage', 'provider', 'seat', 'since', 'until', 'history'])

/**
 * 時刻條件轉毫秒(ISO 字串;無法解析即拋)
 *
 * @param {*} v 輸入時刻條件
 * @param {String} name 輸入條件名(訊息用)
 * @returns {Number} 回傳毫秒
 * @throws {Error} 非字串或無法解析時拋出
 */
function msOf(v, name) {
    const ms = typeof v === 'string' ? Date.parse(v) : NaN
    if (!Number.isFinite(ms)) throw new Error(`notesByProvenance 之 cond.${name} 須為可解析之時刻字串（如 2026-11-08T20:00:00+08:00）`)
    return ms
}

/**
 * 文字條件檢核(非空字串或 null)
 *
 * @param {*} v 輸入條件值
 * @param {String} name 輸入條件名
 * @returns {String|null} 回傳條件值
 * @throws {Error} 非非空字串亦非 null 時拋出
 */
function textCondOf(v, name) {
    if (v === null) return null
    if (typeof v === 'string' && v.trim() !== '') return v
    throw new Error(`notesByProvenance 之 cond.${name} 須為非空字串或 null`)
}

/**
 * 依產出鏈選件(純讀;檔頭)
 *
 * @param {Object} deps 輸入依賴物件
 * @param {Object} deps.stores 輸入集合物件，需含 notes(具 select 方法)
 * @param {Object} [cond={}] 輸入條件物件(皆選填;皆為「且」)
 * @param {String|null} [cond.stamp] 輸入輪次 stamp(14 碼;null＝輪次外之寫入)
 * @param {String} [cond.stage] 輸入階段(summarize、triage-confirm、repair、review、standards-fix)
 * @param {String|null} [cond.provider] 輸入實際成交條目 id(null＝不呼叫 AI 之寫入)
 * @param {String|null} [cond.seat] 輸入席位(設定路徑,如 'summarize.ai';null＝不呼叫 AI 之寫入)
 * @param {String} [cond.since] 輸入起始時刻(含;比對 produced.at;ISO 字串)
 * @param {String} [cond.until] 輸入結束時刻(含;比對 produced.at;ISO 字串)
 * @param {Boolean} [cond.history=false] 輸入是否比對 producedHistory 任一筆(預設只比對 produced)
 * @returns {Promise} 回傳 Promise，resolve 回傳 [{ slug, produced }](依 slug 升冪;produced 為符合條件之那一筆——預設即記錄之 produced,history:true 時為最近一筆符合者)
 * @throws {Error} deps.stores.notes 缺 select 方法、cond 非物件、含不認得之鍵、或條件之型別不合(文字須非空字串或 null、since／until 須可解析之時刻、history 須布林)時拋出
 * @example
 * let rows = [
 *     { id: 'a', produced: { v: 1, stamp: '20261108100000', stage: 'summarize', seat: 'summarize.ai', provider: 'x:one', pkg: 'w-x@1.0.0', at: '2026-11-08T10:00:00+08:00' } },
 *     { id: 'b', produced: { v: 1, stamp: '20261108110000', stage: 'summarize', seat: 'summarize.ai', provider: 'x:two', pkg: 'w-x@1.0.0', at: '2026-11-08T11:00:00+08:00' } },
 *     { id: 'old' },
 * ]
 * let deps = { stores: { notes: { select: async () => rows } } }
 * console.log((await notesByProvenance(deps, { provider: 'x:two' })).map((x) => x.slug))
 * // => [ 'b' ]
 *
 * console.log((await notesByProvenance(deps, { since: '2026-11-08T10:30:00+08:00' })).map((x) => x.slug))
 * // => [ 'b' ]
 *
 * console.log((await notesByProvenance(deps)).map((x) => x.slug))
 * // => [ 'a', 'b' ]
 */
export async function notesByProvenance(deps, cond = {}) {

    //check
    const notes = deps?.stores?.notes
    if (!isobj(notes) || !isfun(notes.select)) {
        throw new Error('notesByProvenance 需要 deps.stores.notes（具 select 方法）')
    }
    if (cond === undefined) {
        cond = {}
    }
    if (!isobj(cond) || isarr(cond)) {
        throw new Error('notesByProvenance 之 cond 須為物件')
    }
    for (const k of Object.keys(cond)) {
        if (!COND_KEYS.includes(k)) throw new Error(`notesByProvenance 之 cond 含不認得之鍵：${k}（可用：${COND_KEYS.join('、')}）`)
    }
    const want = {}
    if (cond.stamp !== undefined) want.stamp = textCondOf(cond.stamp, 'stamp')
    if (cond.stage !== undefined) want.stage = textCondOf(cond.stage, 'stage')
    if (cond.provider !== undefined) want.provider = textCondOf(cond.provider, 'provider')
    if (cond.seat !== undefined) want.seat = textCondOf(cond.seat, 'seat')
    const since = cond.since !== undefined ? msOf(cond.since, 'since') : null
    const until = cond.until !== undefined ? msOf(cond.until, 'until') : null
    if (cond.history !== undefined && typeof cond.history !== 'boolean') throw new Error('notesByProvenance 之 cond.history 須為布林')
    const history = cond.history === true

    /**
     * 一筆 produced 是否符合全部條件
     * @param {Object} p 輸入 produced
     * @returns {Boolean} 回傳是否符合
     */
    const fits = (p) => {
        if (!isobj(p) || isarr(p)) return false
        for (const [k, v] of Object.entries(want)) {
            if (v === null ? (p[k] !== null && p[k] !== undefined) : p[k] !== v) return false
        }
        if (since !== null || until !== null) {
            const at = typeof p.at === 'string' ? Date.parse(p.at) : NaN
            if (!Number.isFinite(at)) return false
            if (since !== null && at < since) return false
            if (until !== null && at > until) return false
        }
        return true
    }

    const out = []
    for (const n of await notes.select()) {
        if (!isobj(n) || !isobj(n.produced)) continue
        let hit = null
        if (history) {
            const hs = isarr(n.producedHistory) && n.producedHistory.length ? n.producedHistory : [n.produced]
            for (let i = hs.length - 1; i >= 0; i--) {
                if (fits(hs[i])) {
                    hit = hs[i]
                    break
                }
            }
        }
        else if (fits(n.produced)) {
            hit = n.produced
        }
        if (hit) out.push({ slug: String(n.id), produced: structuredClone(hit) })
    }
    return out.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
}

export default { notesByProvenance }
