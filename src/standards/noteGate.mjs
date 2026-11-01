// noteGate.mjs — 摘要之納入閘(新進筆記;摘要子階段與人工匯入共用):正規化 → 硬性欄位 → 數字紮根逐條移除 → 結果
//
// 【達標才納入】AI 項目先經確定性正規化(noteNormalize),再判硬性欄位(SS2)與數字紮根(SS4):
//   清單行、參數列、概念中有原文沒有之數字者逐條移除(剔除有問題之部分;移除紀錄入 fixes),樣本期間改「未載明」、證據說明清空;
//   標題或一句話重點有原文沒有之數字、或移除後核心知識為空／概念不足 → 整項不納入(交重試;重試耗盡 → summarize-failed,
//   待判轉使用者,可以 ops/reviveFailed 重開)。落地前另以 noteStandards.checkNote 對組好之 md 再驗一次(同一組標準)。
// 【哪些行受檢】ungroundedLinesOf 為單一實作:逐條移除(dropUngrounded)與欄位定向修補呼叫之指出(standards/noteRepair)
//   讀同一份清單,受檢欄位與順序只定義一次。
// 【材料】原文標題＋摘要當時送出之內文(與 noteStandards.noteMaterialOf 同一定義);人工匯入無機器可讀之原文 → 不檢 SS4
//   (出處由匯入者負責;記錄 sourceKind:'manual')。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import { ungroundedNumbers } from '../core/standards/numbers.mjs'
import { normalizeNoteItem, noteItemProblems, contractFieldProblems, NOTE_LIST_FIELDS, NOTE_PLACEHOLDERS, shortText } from './noteNormalize.mjs'
import { CONCEPT_COUNT, standardsVocabOf } from './noteStandards.mjs'

/**
 * 含原文沒有之數字之欄位與行(SS4 受檢範圍之單一實作;依標題、一句話重點、各清單欄、參數列、概念、樣本期間、證據說明之順序)
 *
 * @param {Object} k 輸入正規化後之項目
 * @param {String} material 輸入材料
 * @returns {Array} 回傳 [{ field, kind:'text'|'line'|'param'|'concept', index(清單內之位置;非清單為 -1), line(該行文字), row?(參數列物件), numbers:Array }]
 * @example
 * let k = { title: '星系旋轉曲線', summary: '外圍轉速趨於定值', key_points: ['外圍轉速約 250 公里每秒', '可見質量不足'], concepts: ['星系', '暗物質'] }
 * let material = '星系旋轉曲線\n外圍恆星的轉速趨於定值，約 220 公里每秒'
 * console.log(ungroundedLinesOf(k, material).map((u) => [u.field, u.kind, u.index, u.numbers]))
 * // => [ [ 'key_points', 'line', 0, [ '250' ] ] ]
 */
export function ungroundedLinesOf(k, material) {
    const g = (s) => ungroundedNumbers(s, material)
    const out = []
    const text = (field) => {
        const u = g(k[field])
        if (u.length) out.push({ field, kind: 'text', index: -1, line: String(k[field] ?? ''), numbers: u })
    }
    text('title')
    text('summary')
    for (const f of NOTE_LIST_FIELDS) {
        if (!isarr(k[f])) continue
        k[f].forEach((x, i) => {
            const u = g(x)
            if (u.length) out.push({ field: f, kind: 'line', index: i, line: String(x ?? ''), numbers: u })
        })
    }
    if (isarr(k.parameters)) {
        k.parameters.forEach((p, i) => {
            const u = g(`${p.name} ${p.value} ${p.note || ''}`)
            if (u.length) out.push({ field: 'parameters', kind: 'param', index: i, line: `名稱「${p.name ?? ''}」、值「${p.value ?? ''}」、說明「${p.note ?? ''}」`, row: p, numbers: u })
        })
    }
    if (isarr(k.concepts)) {
        k.concepts.forEach((c, i) => {
            const u = g(c)
            if (u.length) out.push({ field: 'concepts', kind: 'concept', index: i, line: String(c ?? ''), numbers: u })
        })
    }
    text('sample_period')
    text('evidence_note')
    return out
}

/**
 * 逐條移除含原文沒有之數字者(SS4 之確定性處置)
 *
 * @param {Object} k 輸入正規化後之項目
 * @param {String} material 輸入材料
 * @returns {Object} 回傳 { item, removed:Array } 或 { fatal:String }
 * @example
 * let k = { title: '星系旋轉曲線', summary: '外圍轉速趨於定值', key_points: ['外圍轉速約 250 公里每秒', '可見質量不足'], concepts: ['星系', '暗物質'] }
 * let material = '星系旋轉曲線\n外圍恆星的轉速趨於定值，約 220 公里每秒'
 * let d = dropUngrounded(k, material)
 * console.log(d.item.key_points, d.removed)
 * // => [ '可見質量不足' ] [ 'key_points「外圍轉速約 250 公里每秒」（250）' ]
 *
 * console.log(dropUngrounded({ ...k, title: '轉速 250 公里每秒' }, material))
 * // => { fatal: '標題含原文沒有之數字（250）' }
 */
export function dropUngrounded(k, material) {
    const us = ungroundedLinesOf(k, material)
    const t = us.find((u) => u.field === 'title')
    if (t) return { fatal: `標題含原文沒有之數字（${t.numbers.join('、')}）` }
    const s = us.find((u) => u.field === 'summary')
    if (s) return { fatal: `一句話重點含原文沒有之數字（${s.numbers.join('、')}）` }
    const removed = []
    const drop = new Map() // 欄位 → 移除之位置
    const mark = (u) => {
        if (!drop.has(u.field)) drop.set(u.field, new Set())
        drop.get(u.field).add(u.index)
    }
    const k2 = { ...k }
    for (const u of us) {
        if (u.kind === 'line') {
            removed.push(`${u.field}「${shortText(u.line)}」（${u.numbers.join('、')}）`)
            mark(u)
        }
        else if (u.kind === 'param') {
            removed.push(`參數「${shortText(u.row?.name, 20)}」（${u.numbers.join('、')}）`)
            mark(u)
        }
        else if (u.kind === 'concept') {
            removed.push(`概念「${u.line}」（${u.numbers.join('、')}）`)
            mark(u)
        }
        else if (u.field === 'sample_period') {
            removed.push(`樣本期間「${shortText(k2.sample_period, 30)}」改為${NOTE_PLACEHOLDERS.samplePeriod}`)
            k2.sample_period = NOTE_PLACEHOLDERS.samplePeriod
        }
        else if (u.field === 'evidence_note') {
            removed.push(`證據說明「${shortText(k2.evidence_note, 30)}」清空`)
            k2.evidence_note = ''
        }
    }
    for (const [f, idx] of drop) k2[f] = k2[f].filter((_, i) => !idx.has(i))
    if (!(isarr(k2.key_points) && k2.key_points.length)) return { fatal: '核心知識皆含原文沒有之數字' }
    if ((k2.concepts || []).length < CONCEPT_COUNT.min) return { fatal: `移除含原文沒有之數字之概念後不足 ${CONCEPT_COUNT.min} 個` }
    return { item: k2, removed }
}

/**
 * 非 note 契約之項目之輕量正規化(不猜內容):字串欄去頭尾空白、字串陣列逐項去空白濾空;其餘原樣
 *
 * @param {Object} it 輸入項目
 * @returns {Object} 回傳新物件
 */
function trimItem(it) {
    const k = { ...it }
    for (const [f, v] of Object.entries(k)) {
        if (typeof v === 'string') k[f] = v.trim()
        else if (isarr(v) && v.every((x) => typeof x === 'string')) k[f] = v.map((x) => x.trim()).filter(Boolean)
    }
    return k
}

/**
 * 摘要項目之納入閘(非知識項原樣放行——判非知識不是本閘之事)
 *
 * 契約(opt.contract;stores/noteBuild 檔頭【產物契約】):kind 'note'(或未給)→ note 之正規化、硬性欄位、契約欄位(fields)、數字紮根逐條移除;
 *   其他 kind → 只做輕量正規化與契約欄位之判定(欄位語意屬該契約,無 note 之正規化與逐條移除;數字紮根於落地前以契約之 text 判)
 *
 * @param {Object} it 輸入 AI 回傳之單一項目(或人工匯入之 note)
 * @param {Object} [opt={}] 輸入 { vocab:resolveSummarizeVocab 之產物(未給＝不驗清單、不降級), material:String|undefined(未給＝不檢 SS4),
 *   knownConcept:(標籤)=>Boolean(既有概念;擠標籤之拆分條件,未給＝不拆——見 noteNormalize 檔頭), contract:產物契約(未給＝內建 note,無欄位上限),
 *   locale:語言設定或字形政策(正規化之轉正體依之;未給＝臺灣正體) }
 * @returns {Object} 回傳 { ok, item, fixes:Array, reasons:Array(不納入之理由), std:String(不納入之主要標準 SS2｜SS4;納入為 ''),
 *   removed:Array(逐條移除之紀錄;納入時) }
 * @throws {Error} opt.vocab 給了而非本套件解析後之詞彙表時拋出(非知識項亦然)
 * @example
 * let item = { relevant: true, title: '星系旋轉曲線', summary: '外圍轉速趨於定值', key_points: ['外圍轉速約 220 公里每秒', '另有 250 公里每秒之說'], concepts: ['星系', '暗物質'], category: '其他', claim_type: '實證研究', evidence_level: '中', caveats: ['樣本有限'] }
 * let material = '星系旋轉曲線\n外圍恆星的轉速趨於定值，約 220 公里每秒'
 * let g = gateNoteItem(item, { material })
 * console.log(g.ok, g.item.key_points, g.removed)
 * // => true [ '外圍轉速約 220 公里每秒' ] [ 'key_points「另有 250 公里每秒之說」（250）' ]
 *
 * let g2 = gateNoteItem({ ...item, concepts: ['星系'] })
 * console.log(g2.ok, g2.std, g2.reasons)
 * // => false SS2 [ '概念 1 個（須 2～6）' ]
 */
export function gateNoteItem(it, opt = {}) {
    standardsVocabOf(opt.vocab, 'gateNoteItem 之 opt.vocab')
    if (!isobj(it) || !it.relevant) return { ok: true, item: it, fixes: [], reasons: [], std: '', removed: [] }
    const contract = isobj(opt.contract) ? opt.contract : null
    if (contract && contract.kind !== 'note') {
        const item = trimItem(it)
        const problems = contractFieldProblems(item, contract.fields).map((p) => p.detail)
        return problems.length ? { ok: false, item, fixes: [], reasons: problems, std: 'SS2', removed: [] } : { ok: true, item, fixes: [], reasons: [], std: '', removed: [] }
    }
    const { item, fixes } = normalizeNoteItem(it, { vocab: opt.vocab, knownConcept: opt.knownConcept, locale: opt.locale })
    const problems = [...noteItemProblems(item, opt.vocab), ...(contract ? contractFieldProblems(item, contract.fields).map((p) => p.detail) : [])]
    if (problems.length) return { ok: false, item, fixes, reasons: [...new Set(problems)], std: 'SS2', removed: [] }
    if (typeof opt.material !== 'string') return { ok: true, item, fixes, reasons: [], std: '', removed: [] }
    const d = dropUngrounded(item, opt.material)
    if (d.fatal) return { ok: false, item, fixes, reasons: [d.fatal], std: 'SS4', removed: [] }
    return { ok: true, item: d.item, fixes: [...fixes, ...d.removed.map((x) => `移除含原文沒有之數字：${x}`)], reasons: [], std: '', removed: d.removed }
}

export default { ungroundedLinesOf, dropUngrounded, gateNoteItem }
