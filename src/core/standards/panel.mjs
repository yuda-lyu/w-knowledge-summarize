// panel.mjs — AI 標準之判定小組:兩席獨立一致才成立、「不確定」為合法裁決、未成立可叫第三席、仍未成立＝未能判定
//
// 【成立】存在兩票:皆為明確裁決(非 unsure、非缺票)、same(v1, v2)、實際成交之供應者皆非空且不同 → 成立,裁決取先者。
//   同一供應者之兩票不算獨立(遞補鏈收斂到同一家時常見)。
// 【第三席】前兩票未成立、皆有回(非缺票)、且至少一票明確 → 第三席可與其中一票成立;第三席之供應者須與成對之那一票不同。
//   缺票＝呼叫失敗或未涵蓋 → 該項重試(記 tries),不叫第三席(第三席不是重試)。兩票皆 unsure → 第三席無從成立,不叫。
// 【未成立之原因】missing(缺票)、same-provider(有一致之明確兩票但供應者相同或不明)、unsure(有不確定)、disagree(明確而不一致)。
//   呼叫端據此分流:缺票重試;其餘依各標準之「未能判定」處置(新進不納入、存量隔離,入待判登錄)。面向使用者之字樣一律取 PANEL_WHY_LABELS。

/** 不確定之裁決值(各標準之提示詞皆以此字樣回覆「拿不準」) */
export const PANEL_UNSURE = 'unsure'

/** 未成立之原因 */
export const PANEL_WHY = Object.freeze({ MISSING: 'missing', SAME_PROVIDER: 'same-provider', UNSURE: 'unsure', DISAGREE: 'disagree' })

/** 未成立之原因之字樣(面向使用者:待判之原因、檢核紀錄之說明、日誌——本套件與下游工作同用,不另寫) */
export const PANEL_WHY_LABELS = Object.freeze({
    [PANEL_WHY.MISSING]: '缺票（呼叫失敗或回覆不合格）',
    [PANEL_WHY.SAME_PROVIDER]: '一致之兩票為同一供應者',
    [PANEL_WHY.UNSURE]: '有席位不確定',
    [PANEL_WHY.DISAGREE]: '各席裁決不一致',
})

const isMissing = (v) => v === null || v === undefined
const isExplicit = (v) => !isMissing(v) && v !== PANEL_UNSURE
const provOf = (x) => String(x?.provider ?? '').trim()
const defaultSame = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * 判定小組之裁定
 *
 * @param {Array} votes 輸入票 [{ seat, provider, verdict }](verdict:明確裁決(任意值)、PANEL_UNSURE、或 null／undefined＝缺票)
 * @param {Object} [o={}] 輸入 { same:(a, b)=>Boolean(兩明確裁決是否相同;預設 JSON 相等) }
 * @returns {Object} 回傳 { status:'decided'|'undetermined', verdict?, by?:[供應者, 供應者], seats?:[席, 席], why:''|PANEL_WHY 之一 }
 * @example
 * const first = { seat: 1, provider: 'A', verdict: 'yes' }
 * console.log(JSON.stringify(decidePanel([first, { seat: 2, provider: 'B', verdict: 'yes' }])))
 * // => {"status":"decided","verdict":"yes","by":["A","B"],"seats":[1,2],"why":""}
 *
 * console.log(JSON.stringify(decidePanel([first, { seat: 2, provider: 'A', verdict: 'yes' }])))
 * // => {"status":"undetermined","why":"same-provider"}
 *
 * console.log(JSON.stringify(decidePanel([first, { seat: 2, provider: 'B', verdict: 'unsure' }])))
 * // => {"status":"undetermined","why":"unsure"}
 */
export function decidePanel(votes, o = {}) {
    const same = typeof o.same === 'function' ? o.same : defaultSame
    const vs = (Array.isArray(votes) ? votes : []).filter((x) => x && typeof x === 'object')
    let sameProvider = false
    for (let i = 0; i < vs.length; i++) {
        for (let j = i + 1; j < vs.length; j++) {
            const a = vs[i]
            const b = vs[j]
            if (!isExplicit(a.verdict) || !isExplicit(b.verdict) || !same(a.verdict, b.verdict)) continue
            const pa = provOf(a)
            const pb = provOf(b)
            if (pa && pb && pa !== pb) return { status: 'decided', verdict: a.verdict, by: [pa, pb], seats: [a.seat, b.seat], why: '' }
            sameProvider = true
        }
    }
    const why = vs.some((x) => isMissing(x.verdict)) || vs.length < 2
        ? PANEL_WHY.MISSING
        : sameProvider ? PANEL_WHY.SAME_PROVIDER : vs.some((x) => x.verdict === PANEL_UNSURE) ? PANEL_WHY.UNSURE : PANEL_WHY.DISAGREE
    return { status: 'undetermined', why }
}

/**
 * 前兩票未成立時,是否值得叫第三席:未成立、無缺票、且至少一票明確
 *
 * @param {Array} votes 輸入前兩票
 * @param {Object} [o={}] 輸入 { same }(同 decidePanel)
 * @returns {Boolean} 回傳是否叫第三席
 * @example
 * console.log(needThird([{ provider: 'A', verdict: 'yes' }, { provider: 'B', verdict: 'no' }]))
 * // => true
 *
 * console.log(needThird([{ provider: 'A', verdict: 'yes' }, { provider: 'B', verdict: null }]))
 * // => false
 */
export function needThird(votes, o = {}) {
    const vs = (Array.isArray(votes) ? votes : []).filter((x) => x && typeof x === 'object')
    if (vs.length < 2 || vs.some((x) => isMissing(x.verdict))) return false
    if (decidePanel(vs, o).status === 'decided') return false
    return vs.some((x) => isExplicit(x.verdict))
}

/**
 * 票之供應者串(紀錄之 seats 欄;「供應者|供應者|…」,缺者記 '-')
 *
 * @param {Array} votes 輸入票
 * @returns {String} 回傳供應者串
 * @example
 * console.log(panelSeats([{ provider: 'A' }, { provider: ' B ' }, {}]))
 * // => A|B|-
 */
export function panelSeats(votes) {
    return (Array.isArray(votes) ? votes : []).filter(Boolean).map((x) => provOf(x) || '-').join('|')
}

export default { PANEL_UNSURE, PANEL_WHY, PANEL_WHY_LABELS, decidePanel, needThird, panelSeats }
