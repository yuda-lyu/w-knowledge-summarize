// noteRepair.mjs — 欄位定向修補呼叫之純函數(檢定標準 SS2／SS4「先修正、修不了才不納入」:先以定向修補呼叫指出未紮根之行或不合之欄位,
//   要求依原文更正或刪去數字 → 仍不合格才逐條移除／不納入;summarize.standards.repair.enabled)
//
// 【指出什麼】正規化後之項目:SS2 硬性欄位問題(noteNormalize.noteItemFieldProblems)＋SS4 含原文沒有之數字之欄位與行(noteGate.ungroundedLinesOf)
//   ——與納入閘同一判定,修補呼叫不另立標準。概念欄整欄不足時,個別概念之數字問題併入整欄(整欄重給即涵蓋)。
// 【回覆】{"repairs":[{"no":編號,"value":…}]};只取被指出之編號,依該處之形狀驗值(文字欄與清單之一行為字串、概念整欄為字串陣列、
//   參數列為 {name,value,note}、刪除為 null 或空字串);形狀不合、編號重複而值不同者不採(該處維持原值,再過閘時照既有規則處置)。
//   未被指出之欄位一律不動(模型多給之欄位不採)。
// 【之後】呼叫端以同一閘(noteGate.gateNoteItem)重判修補後之項目;仍不合格者照既有規則逐條移除／不納入。一輪為限。
// 【指出處之稱呼】fieldPlaceOf 為單一實作:修補紀錄與修補提示詞之「欄位(第 N 行／列／個)」同一寫法、同一編號。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import { textValueOf } from '../core/capturePackage.mjs'
import { noteItemFieldProblems, shortText } from './noteNormalize.mjs'
import { ungroundedLinesOf } from './noteGate.mjs'
import { standardsVocabOf } from './noteStandards.mjs'
import { NOTE_SECTION_TITLES, NOTE_QUALITY_LABELS } from '../core/md/noteContent.mjs'

/** 欄位之中文名(提示詞與修正紀錄用;章名與標注行首取版型常數——同一字樣一份) */
export const NOTE_FIELD_LABELS = Object.freeze({
    title: '標題', summary: NOTE_SECTION_TITLES.summary, key_points: NOTE_SECTION_TITLES.keyPoints, methods: NOTE_SECTION_TITLES.methods, conditions: NOTE_SECTION_TITLES.conditions, verifiable: NOTE_SECTION_TITLES.verifiable,
    pros: '利', cons: '弊', regime_dependency: NOTE_SECTION_TITLES.regime, counter_views: NOTE_SECTION_TITLES.counterViews, caveats: '品質疑慮', parameters: NOTE_SECTION_TITLES.parameters,
    concepts: '概念', sample_period: NOTE_QUALITY_LABELS.samplePeriod, evidence_note: '證據說明', claim_type: NOTE_QUALITY_LABELS.claimType, evidence_level: NOTE_QUALITY_LABELS.evidenceLevel,
})

/**
 * 須修補之處之稱呼:欄位中文名,清單／參數／概念另附「（第 N 行／列／個）」(修補紀錄與修補提示詞共用)
 *
 * @param {Object} p 輸入 repairProblemsOf 之一筆 { field, kind, index }
 * @returns {String} 回傳稱呼,如「核心知識（第 2 行）」
 * @example
 * console.log(fieldPlaceOf({ field: 'parameters', kind: 'param', index: 0 }), fieldPlaceOf({ field: 'title', kind: 'text', index: -1 }))
 * // => 關鍵參數（第 1 列） 標題
 */
export function fieldPlaceOf(p) {
    return `${NOTE_FIELD_LABELS[p.field] || p.field}${p.index >= 0 ? `（第 ${p.index + 1} ${p.kind === 'param' ? '列' : (p.kind === 'concept' ? '個' : '行')}）` : ''}`
}

/**
 * 須修補之處(正規化後之項目;非知識項回空)
 *
 * @param {Object} k 輸入正規化後之項目
 * @param {Object} [o={}] 輸入 { vocab:resolveSummarizeVocab 之產物(未給＝不驗清單), material:String|undefined(未給＝不檢 SS4) }
 * @returns {Array} 回傳 [{ std:'SS2'|'SS4', field, kind:'text'|'list'|'concepts'|'line'|'param'|'concept', index, line, detail }]
 * @throws {Error} o.vocab 給了而非本套件解析後之詞彙表時拋出
 * @example
 * let k = { relevant: true, title: '恆星分類', summary: '主序星佔恆星約 90%', key_points: ['主序星佔 90%', '紅巨星為晚期階段'], concepts: ['主序星', '赫羅圖'] }
 * let ps = repairProblemsOf(k, { material: '主序星是恆星演化的主要階段' })
 * console.log(ps.map((p) => [p.std, p.field, p.index]))
 * // => [ [ 'SS4', 'summary', -1 ], [ 'SS4', 'key_points', 0 ] ]
 * console.log(ps[0].detail)
 * // => 含原文沒有之數字（90%）
 */
export function repairProblemsOf(k, o = {}) {
    const vocab = standardsVocabOf(o.vocab, 'repairProblemsOf 之 o.vocab')
    if (!isobj(k) || !k.relevant) return []
    const out = noteItemFieldProblems(k, vocab).map((p) => ({ std: 'SS2', field: p.field, kind: p.kind, index: -1, line: p.line, detail: p.detail }))
    if (typeof o.material !== 'string') return out
    const whole = out.find((p) => p.kind === 'concepts')
    for (const u of ungroundedLinesOf(k, o.material)) {
        const detail = `含原文沒有之數字（${u.numbers.join('、')}）`
        if (u.kind === 'concept' && whole) {
            whole.detail += `；概念「${u.line}」${detail}`
            continue
        }
        out.push({ std: 'SS4', field: u.field, kind: u.kind, index: u.index, line: u.line, detail })
    }
    return out
}

/**
 * 修補回覆之形狀驗證(callJson 之 check:物件且 repairs 為陣列)
 *
 * @param {*} d 輸入解析後之回覆
 * @returns {Boolean} 回傳是否合格
 * @example
 * console.log(checkRepairReply({ repairs: [] }), checkRepairReply({ repairs: 'x' }), checkRepairReply(null))
 * // => true false false
 */
export function checkRepairReply(d) {
    return isobj(d) && isarr(d.repairs)
}

// 修補值之文字(抓取套件之 textValueOf);非字串、非數字者回 null＝該處形狀不合而不採(與「刪除」之空字串區分)
const textOrNullOf = (v) => (typeof v === 'string' || typeof v === 'number' ? textValueOf(v) : null)

/**
 * 套用修補回覆(只改被指出之處;不修改輸入)
 *
 * @param {Object} k 輸入正規化後之項目(與 repairProblemsOf 所用者同一份)
 * @param {Array} problems 輸入 repairProblemsOf 之結果(編號＝陣列位置＋1)
 * @param {*} reply 輸入修補回覆 { repairs:[{ no, value }] }
 * @returns {Object} 回傳 { item, applied:Integer(採用之處數), notes:Array(修正紀錄) }
 * @example
 * let k = { relevant: true, title: '恆星分類', summary: '主序星佔恆星約 90%', key_points: ['主序星佔 90%', '紅巨星為晚期階段'], concepts: ['主序星', '赫羅圖'] }
 * let ps = repairProblemsOf(k, { material: '主序星是恆星演化的主要階段' })
 * let r = applyRepairs(k, ps, { repairs: [{ no: 1, value: '主序星佔恆星多數' }, { no: 2, value: null }] })
 * console.log(r.applied, r.item.summary, r.item.key_points)
 * // => 2 主序星佔恆星多數 [ '紅巨星為晚期階段' ]
 * console.log(r.notes[0])
 * // => 修補呼叫：一句話重點「主序星佔恆星約 90%」→「主序星佔恆星多數」
 */
export function applyRepairs(k, problems, reply) {
    const k2 = { ...k }
    for (const f of Object.keys(k2)) if (isarr(k2[f])) k2[f] = [...k2[f]]
    const ps = isarr(problems) ? problems : []
    const byNo = new Map()
    const bad = new Set()
    for (const r of isarr(reply?.repairs) ? reply.repairs : []) {
        const no = Number(r?.no)
        if (!Number.isInteger(no) || no < 1 || no > ps.length || !isobj(r) || !('value' in r)) continue
        if (byNo.has(no) && JSON.stringify(byNo.get(no)) !== JSON.stringify(r.value)) bad.add(no)
        byNo.set(no, r.value)
    }
    const notes = []
    const drop = new Map() // 欄位 → 刪除之位置
    let applied = 0
    ps.forEach((p, i) => {
        const no = i + 1
        if (!byNo.has(no) || bad.has(no)) return
        const v = byNo.get(no)
        const del = v === null || v === ''
        if (p.kind === 'text') {
            const s = del ? '' : textOrNullOf(v)
            if (s === null) return
            k2[p.field] = s
            notes.push(`修補呼叫：${fieldPlaceOf(p)}「${shortText(p.line)}」→「${shortText(s)}」`)
        }
        else if (p.kind === 'line' || p.kind === 'concept') {
            if (!isarr(k2[p.field]) || p.index < 0 || p.index >= k2[p.field].length) return
            if (del) {
                if (!drop.has(p.field)) drop.set(p.field, new Set())
                drop.get(p.field).add(p.index)
                notes.push(`修補呼叫：${fieldPlaceOf(p)}「${shortText(p.line)}」刪除`)
            }
            else {
                const s = textOrNullOf(v)
                if (s === null) return
                k2[p.field][p.index] = s
                notes.push(`修補呼叫：${fieldPlaceOf(p)}「${shortText(p.line)}」→「${shortText(s)}」`)
            }
        }
        else if (p.kind === 'param') {
            if (!isarr(k2.parameters) || p.index < 0 || p.index >= k2.parameters.length) return
            if (del) {
                if (!drop.has('parameters')) drop.set('parameters', new Set())
                drop.get('parameters').add(p.index)
                notes.push(`修補呼叫：${fieldPlaceOf(p)}刪除`)
            }
            else {
                if (!isobj(v)) return
                const row = { name: textValueOf(v.name), value: textValueOf(v.value), note: textValueOf(v.note) }
                if (!row.name && !row.value) return
                k2.parameters[p.index] = row
                notes.push(`修補呼叫：${fieldPlaceOf(p)}→ 名稱「${shortText(row.name, 20)}」、值「${shortText(row.value, 20)}」`)
            }
        }
        else if (p.kind === 'list' || p.kind === 'concepts') {
            if (!isarr(v)) return
            const xs = v.map(textOrNullOf).filter((x) => x)
            k2[p.field] = xs
            notes.push(`修補呼叫：${fieldPlaceOf(p)}→「${shortText(xs.join('、'), 60)}」`)
        }
        else return
        applied++
    })
    for (const [f, idx] of drop) k2[f] = k2[f].filter((_, i) => !idx.has(i))
    return { item: k2, applied, notes }
}

export default { NOTE_FIELD_LABELS, fieldPlaceOf, repairProblemsOf, checkRepairReply, applyRepairs }
