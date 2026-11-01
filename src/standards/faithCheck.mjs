// faithCheck.mjs — 檢定標準 SS14(筆記忠實於原文)之新進覆核:受檢文字、單票驗證、判定小組
//   (摘要忠實性:無據之結論、否定或方向翻錯、條件遺失而寫成普遍、證據等級失真)
//
// 【時機】摘要批次回來、項目過確定性納入閘(gateNoteItem)之後、寫筆記之前(core/stages/aiBatchStage 之 reviewItems):同一批之合格項
//   一次交判定小組(兩席並行、第三席補),材料＝該篇送給摘要 AI 之材料(原文標題＋送出之內文;與 SS4 同一材料)。
// 【裁決】faithful｜unfaithful(理由 ≥10 字,須指出筆記哪一欄與原文何處不符)｜unsure;不合格之票＝缺票。判定小組以裁決值成立(兩類)。
//   數字之紮根由 SS4(確定性)管,本標準管語意:無據之結論、否定與方向、條件遺失而寫成普遍、證據等級誇大。
// 【呼叫】由呼叫端注入 call(seatKey, seat, prompt)=>Promise<{ ok, data, providerId, skipped }>(摘要段用 ai.callJson);
//   任一席 skipped(預算／額度)→ 整個覆核中止(stopped;呼叫端本批不套用、不記 tries)。
// 【骨架在 core/standards/panelRun】兩席並行、第二席項序打亂、第三席只送未成立之項、逐項裁定皆由 runPanelPage 執行(各 AI 標準同一份);
//   本檔只給 SS14 之差異:提示詞之項、一席回覆之逐項票、相同之定義(裁決值)、打亂前綴 'ss14'、段名 first／second／third(即席位鍵)。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { textValueOf } from '../core/capturePackage.mjs'
import { PANEL_UNSURE } from '../core/standards/panel.mjs'
import { runPanelPage } from '../core/standards/panelRun.mjs'
import { NOTE_SECTION_TITLES, NOTE_QUALITY_LABELS } from '../core/md/noteContent.mjs'

/** 標準識別 */
export const SS14 = Object.freeze({ std: 'SS14', v: 1 })
/** 合法裁決值 */
export const FAITH_VERDICTS = Object.freeze(['faithful', 'unfaithful', PANEL_UNSURE])
/** 待判之物件種類(oid＝文件 id) */
export const SS14_OBJECT = 'doc'

const MIN_REASON = 10
// 文字值(字串去頭尾空白、數字轉字串、其餘為空;抓取套件之 textValueOf)之清單版
const strs = (v) => (isarr(v) ? v.map((x) => (isobj(x) ? '' : textValueOf(x))).filter(Boolean) : (textValueOf(v) ? [textValueOf(v)] : []))
const sameFaith = (a, b) => isobj(a) && isobj(b) && a.verdict === b.verdict

/**
 * 筆記之受檢文字(摘要項目之內容欄;概念、分類、線索不在其中——那是標注,不是對原文之陳述)
 *
 * @param {Object} it 輸入摘要項目(正規化後)
 * @returns {String} 回傳逐欄文字
 * @example
 * let it = { title: '星系旋轉曲線', summary: '外圍轉速趨於定值', key_points: ['可見質量不足以解釋'], concepts: ['星系'] }
 * console.log(JSON.stringify(faithNoteText(it)))
 * // => "標題：星系旋轉曲線\n一句話重點：外圍轉速趨於定值\n核心知識：\n- 可見質量不足以解釋"
 */
export function faithNoteText(it) {
    const lines = []
    const one = (label, v) => {
        if (textValueOf(v)) lines.push(`${label}：${textValueOf(v)}`)
    }
    const list = (label, v) => {
        const xs = strs(v)
        if (xs.length) lines.push(`${label}：`, ...xs.map((x) => `- ${x}`))
    }
    const T = NOTE_SECTION_TITLES
    one('標題', it?.title)
    one(T.summary, it?.summary)
    list(T.keyPoints, it?.key_points)
    list('方法', it?.methods)
    const params = (isarr(it?.parameters) ? it.parameters : []).filter(isobj).map((p) => `${textValueOf(p.name)}＝${textValueOf(p.value)}${textValueOf(p.note) ? `（${textValueOf(p.note)}）` : ''}`).filter((x) => x !== '＝')
    if (params.length) lines.push('參數：', ...params.map((x) => `- ${x}`))
    list(T.conditions, it?.conditions)
    list(T.verifiable, it?.verifiable)
    one(NOTE_QUALITY_LABELS.claimType, it?.claim_type)
    one(NOTE_QUALITY_LABELS.evidenceLevel, [textValueOf(it?.evidence_level), textValueOf(it?.evidence_note)].filter(Boolean).join('——'))
    one('樣本期間', it?.sample_period)
    list('品質疑慮', it?.caveats)
    list('利', it?.pros)
    list('弊', it?.cons)
    list(T.regime, it?.regime_dependency)
    list('反方觀點', it?.counter_views)
    return lines.join('\n')
}

/**
 * 單票驗證
 *
 * @param {*} raw 輸入 { verdict, reason }
 * @returns {Object|String|null} 回傳 { verdict, reason }、PANEL_UNSURE、或 null(不合格＝缺票)
 * @example
 * console.log(checkFaithVerdictOf({ verdict: 'FAITHFUL' }))
 * // => { verdict: 'faithful', reason: '' }
 *
 * console.log(checkFaithVerdictOf({ verdict: 'unfaithful', reason: '太短' }))
 * // => null
 *
 * console.log(checkFaithVerdictOf({ verdict: 'unsure' }))
 * // => unsure
 */
export function checkFaithVerdictOf(raw) {
    if (!isobj(raw)) return null
    const v = textValueOf(raw.verdict).toLowerCase()
    const reason = String(raw.reason ?? '').replace(/\s+/g, ' ').trim()
    if (v === PANEL_UNSURE) return PANEL_UNSURE
    if (v === 'faithful') return { verdict: v, reason }
    if (v === 'unfaithful') return reason.length >= MIN_REASON ? { verdict: v, reason } : null
    return null
}

/**
 * 一席之回覆({ checks:[{ index, verdict, reason }] })→ 逐項票;同編號矛盾者作廢為缺票
 *
 * @param {*} data 輸入回覆
 * @param {Set} [indices] 輸入本席所見之項編號(未給不限)
 * @returns {Map} 回傳 Map(項編號 → 票|PANEL_UNSURE|null)
 * @example
 * let data = { checks: [{ index: 1, verdict: 'faithful' }, { index: 2, verdict: 'unsure' }, { index: 2, verdict: 'faithful' }, { index: 9, verdict: 'faithful' }] }
 * console.log([...seatFaithVotesOf(data, new Set([1, 2]))])
 * // => [ [ 1, { verdict: 'faithful', reason: '' } ], [ 2, null ] ]
 */
export function seatFaithVotesOf(data, indices) {
    const out = new Map()
    const bad = new Set()
    for (const it of isarr(data?.checks) ? data.checks : []) {
        const i = Number(it?.index)
        if (!Number.isInteger(i) || (indices instanceof Set && !indices.has(i))) continue
        const v = checkFaithVerdictOf(it)
        if (!out.has(i)) out.set(i, v)
        else if (!(out.get(i) === v || sameFaith(out.get(i), v))) bad.add(i)
    }
    for (const i of bad) out.set(i, null)
    return out
}

/**
 * 覆核席回覆之形狀檢查(作為 AI 呼叫之 check):回覆須為物件且 checks 為陣列
 *
 * @param {*} d 輸入覆核席之回覆
 * @returns {Boolean} 回傳形狀是否合格
 * @example
 * console.log(checkFaithChecks({ checks: [] }), checkFaithChecks({}), checkFaithChecks(null))
 * // => true false false
 */
export const checkFaithChecks = (d) => isobj(d) && isarr(d.checks)

/**
 * 判定小組之執行(一批為一頁,交 runPanelPage:第一、二席並行,第二席項序打亂、編號不變;未成立而可成立者叫第三席,只送該些項;
 *   任一席 skipped 即整個覆核中止)
 *
 * @param {Object} o 輸入 { items:[{ key, title, material, note(項目) }], buildPrompt(domain.buildFaithCheckPrompt),
 *   call:(seatKey, seat, prompt)=>Promise<{ ok, data, providerId, skipped }>, seats:{ first, second, third? } }
 * @returns {Promise<Object>} 回傳 { decisions:Map(key → decidePanel 之結果＋votes), calls, stopped };無項目、缺 call 或缺 buildPrompt → 不呼叫(calls 0)
 * @example
 * let domain = createSummarizeDomain({})
 * let items = [{ key: 'a', title: '甲', material: '原文甲', note: { title: '甲', summary: '重點' } }]
 * let call = async (seatKey, seat) => ({ ok: true, providerId: `p-${seat.use}`, data: { checks: [{ index: 1, verdict: 'faithful', reason: '' }] } })
 * let r = await runFaithCheck({ items, buildPrompt: domain.buildFaithCheckPrompt, call, seats: { first: { use: 'x' }, second: { use: 'y' } } })
 * console.log(r.calls, r.stopped, [...r.decisions].map(([key, d]) => [key, d.status, d.verdict.verdict]))
 * // => 2 false [ [ 'a', 'decided', 'faithful' ] ]
 */
export async function runFaithCheck(o) {
    const items = isarr(o.items) ? o.items : []
    const seats = isobj(o.seats) ? o.seats : {}
    if (!items.length || !isfun(o.call) || !isfun(o.buildPrompt)) return { decisions: new Map(), calls: 0, stopped: false }
    const r = await runPanelPage({
        local: items.map((it, j) => ({ index: j + 1, key: it.key, it })),
        buildPrompt: (xs) => o.buildPrompt({ items: xs.map((x) => ({ index: x.index, title: textValueOf(x.it.title), material: String(x.it.material ?? ''), noteText: faithNoteText(x.it.note) })) }),
        shufflePrefix: 'ss14',
        stages: ['first', 'second', 'third'],
        // 調度層之回傳 → 執行器之形狀(skipped＝中止);不包成 async:同步拋出者原樣拋出,第二席不被呼叫
        call: (seatKey, seat, prompt) => Promise.resolve(o.call(seatKey, seat, prompt)).then((x) => ({ ok: x?.ok, data: x?.data, providerId: x?.providerId, stop: x?.skipped })),
        seats,
        votesOf: seatFaithVotesOf,
        same: sameFaith,
    })
    return { decisions: r.decisions, calls: r.calls, stopped: r.stopped }
}

export default { SS14, FAITH_VERDICTS, SS14_OBJECT, faithNoteText, checkFaithVerdictOf, seatFaithVotesOf, checkFaithChecks, runFaithCheck }
