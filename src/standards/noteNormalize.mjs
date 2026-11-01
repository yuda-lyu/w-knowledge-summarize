// noteNormalize.mjs — 摘要輸出之確定性正規化與硬性欄位檢查(納入閘之前段;摘要子階段與人工匯入共用)
//
// 【先正規化再驗證】AI 輸出常有可確定修正之形狀問題:清單元素為物件(渲染成 [object Object] 或被丟棄而失去內容)、內容類型給簡體值
//   (對不上清單)、概念帶計數尾碼或一標籤擠多概念、簡體字。這些在驗證前一律修正(修正紀錄回傳 fixes,落入筆記記錄 stdFixes 備查),
//   修不了的才判不合格交重試。
// 【只做確定性修正】不猜內容:物件攤平為「鍵值以：串接」;參數列之物件取 name／value／note;概念標籤只做三種有明確判準之修正
//   (計數尾碼、括號外之分隔、跨文字系統之括號註記——判準同 noteStandards.conceptLabelProblem);內容類型與證據等級只套詞彙表之
//   改名對照;最高證據等級而 caveat 明確自承無最高級之要件者(詞彙表 evidenceRule 之嚴式)降一級——降級只往保守方向。
// 【新進與存量同一判準】①證據等級(SS11)只在嚴式命中時降級;只命中寬式(涉及要件而未明確自承)者不改,由 checkNote 判未能判定 →
//   不納入、附回饋重摘(存量修正同此;判準與說明皆出自 core/standards/evidenceRules)。②擠一標籤之多概念,須各段(修正後)皆為既有概念
//   才拆(opt.knownConcept;摘要段與人工匯入以 stores/knownConcepts.knownConceptOf 注入,與存量同一來源);未注入＝無從判定
//   「各段皆為既有概念」→ 不拆,標籤原樣保留,由 checkNote 判 SS6 不合格(呼叫端不納入、交重試)。
// 【詞彙】同 noteStandards【詞彙之送達】:給了須為本套件解析後之詞彙表;未給＝不驗清單、不降級。
// 【字形政策依語言設定】文字欄之轉正體與跨文字系統括號註記之保留方向經 opt.locale(抓取套件之 core/locale;未給＝臺灣正體、保留中文半);
//   語言設定非中文時不轉字形、保留非漢字之半。
// 【共用字樣】品質標注之缺值字樣(NOTE_PLACEHOLDERS)與訊息用之短文字(shortText)定義於此,納入閘、修補、待判、落地版型與存量修正同讀。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import { resolveLocale, scriptOf, cutAtBoundary, strOf } from '../core/capturePackage.mjs'
import { conceptLabelProblem, CONCEPT_COUNT, conceptCountDetail, standardsVocabOf } from './noteStandards.mjs'

/** 清單欄位(AI 輸出;依摘要提示詞) */
export const NOTE_LIST_FIELDS = ['key_points', 'methods', 'conditions', 'verifiable', 'pros', 'cons', 'regime_dependency', 'counter_views', 'caveats']
/** 純文字欄位 */
export const NOTE_TEXT_FIELDS = ['title', 'summary', 'evidence_note', 'sample_period', 'category']
/**
 * 品質標注欄位之上限(不靜默截斷——長度問題須可得知):逾上限之文字於上限內最後一個句讀處截(上限內無句讀 → 全文保留,不在詞或數字
 *   中間斷開)、清單取前 N 項,皆記修正說明(落筆記記錄 stdFixes)。清單上限＝提示詞所載之條數(pros／cons 0-4、regime 0-3、counter 0-3);
 *   caveats 與兩個文字欄之提示詞未載上限,取寬鬆值。落地(domain.normalizeQuality)不另截
 */
export const NOTE_FIELD_LIMITS = {
    text: { evidence_note: 200, sample_period: 120 },
    list: { caveats: 12, pros: 4, cons: 4, regime_dependency: 3, counter_views: 3 },
}
/**
 * 品質標注之缺值字樣:模型漏給或不在清單之內容類型與證據等級、未載明之樣本期間(落地版型、數字紮根之處置、提示詞與存量修正同讀此處)
 *
 * @type {Object}
 */
export const NOTE_PLACEHOLDERS = Object.freeze({ claimType: '未標注', evidenceLevel: '未評估', samplePeriod: '未載明' })
const CLAUSE_END_RE = /[。！？；!?;，,、]/g

const scalar = (x) => typeof x === 'string' || typeof x === 'number'

/**
 * 清洗字串清單(驗證與落地同一規則):只收字串或數字元素、去頭尾空白、濾空;物件元素丟棄(否則落地成 "[object Object]")
 *
 * @param {*} v 輸入任意值，非陣列視為 []
 * @returns {Array} 回傳清洗後之字串陣列
 * @example
 * console.log(cleanStrList([{}, ' a ', 1, '', null, 'b']))
 * // => [ 'a', '1', 'b' ]
 */
export function cleanStrList(v) {
    return (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' || typeof x === 'number').map((x) => String(x).trim()).filter(Boolean)
}

/** 契約欄位之型別名(domain.contract.fields 之 type) */
export const CONTRACT_FIELD_TYPES = Object.freeze(['string', 'string[]', 'object[]', 'integer', 'boolean'])

/**
 * 契約欄位之形狀問題(domain.contract.fields 之判定;單一實作——摘要之納入閘與自組契約皆據以判 SS2):
 *   required 而缺(字串去頭尾空白後為空、陣列為空)→「缺 X」;type 不合 →「X 須為 <型別>」;maxChars(字串,以碼位計)→「欄位 X 超過 N 字」;
 *   maxItems(陣列)→「X 超過 N 項」。未給之選填欄位不檢;fields 非物件視為無契約(回 [])
 *
 * @param {Object} item 輸入項目(AI 輸出或正規化後之項目)
 * @param {Object} fields 輸入契約欄位 { 名: { required?, type?, maxChars?, maxItems? } }
 * @returns {Array} 回傳 [{ field, detail }](空＝合格)
 * @throws {Error} 欄位之 type 不在 CONTRACT_FIELD_TYPES 時拋出(契約之設定錯誤)
 * @example
 * console.log(contractFieldProblems({ short: '一句話', long: '' }, { short: { required: true, type: 'string', maxChars: 2 }, long: { required: true, type: 'string' } }).map((p) => [p.field, p.detail]))
 * // => [ [ 'short', '欄位 short 超過 2 字' ], [ 'long', '缺 long' ] ]
 */
export function contractFieldProblems(item, fields) {
    if (!isobj(fields)) return []
    const k = isobj(item) ? item : {}
    const out = []
    for (const [name, spec] of Object.entries(fields)) {
        if (!isobj(spec)) continue
        if (spec.type !== undefined && !CONTRACT_FIELD_TYPES.includes(spec.type)) throw new Error(`contract.fields.${name}.type「${spec.type}」不在可用型別（${CONTRACT_FIELD_TYPES.join('、')}）`)
        const v = k[name]
        const given = v !== undefined && v !== null
        const empty = !given || (typeof v === 'string' && !v.trim()) || (isarr(v) && v.length === 0)
        if (spec.required === true && empty) {
            out.push({ field: name, detail: `缺 ${name}` })
            continue
        }
        if (!given) continue
        const t = spec.type
        const typeOk = t === undefined ||
            (t === 'string' && typeof v === 'string') ||
            (t === 'string[]' && isarr(v) && v.every((x) => typeof x === 'string')) ||
            (t === 'object[]' && isarr(v) && v.every(isobj)) ||
            (t === 'integer' && Number.isInteger(v)) ||
            (t === 'boolean' && typeof v === 'boolean')
        if (!typeOk) {
            out.push({ field: name, detail: `${name} 須為 ${t}` })
            continue
        }
        if (Number.isInteger(spec.maxChars) && spec.maxChars > 0 && typeof v === 'string' && [...v].length > spec.maxChars) out.push({ field: name, detail: `欄位 ${name} 超過 ${spec.maxChars} 字` })
        if (Number.isInteger(spec.maxItems) && spec.maxItems > 0 && isarr(v) && v.length > spec.maxItems) out.push({ field: name, detail: `${name} 超過 ${spec.maxItems} 項` })
    }
    return out
}

/**
 * 訊息用之短文字(壓空白、去頭尾空白;逾 n 字截斷並加「…」)——納入閘之移除紀錄、修補紀錄與待判原因同一寫法
 *
 * @param {*} s 輸入文字
 * @param {Integer} [n=40] 輸入字數上限
 * @returns {String} 回傳短文字
 * @example
 * console.log(shortText('  甲  乙 ', 40), shortText('一二三四五', 3))
 * // => 甲 乙 一二三…
 */
export function shortText(s, n = 40) {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim()
    return t.length > n ? `${t.slice(0, n)}…` : t
}

/**
 * 清單元素攤平為字串(物件之值以「：」串接;巢狀陣列以「、」串接;布林／null 為空)
 *
 * @param {*} x 輸入元素
 * @returns {String} 回傳字串(去頭尾空白)
 * @example
 * console.log([flattenEl({ 名稱: '主序星', 說明: ['核融合', '穩定'] }), flattenEl(true), flattenEl(' 紅巨星 ')])
 * // => [ '主序星：核融合、穩定', '', '紅巨星' ]
 */
export function flattenEl(x) {
    if (scalar(x)) return String(x).trim()
    if (isarr(x)) return x.map(flattenEl).filter(Boolean).join('、')
    if (isobj(x)) return Object.values(x).map(flattenEl).filter(Boolean).join('：')
    return ''
}

/**
 * 概念標籤之確定性修正(計數尾碼、括號外分隔、跨文字系統之括號註記;轉正體、去重、至多 CONCEPT_COUNT.max 個)——新進(normalizeNoteItem)
 *   與存量修正同一實作
 *
 * @param {*} raw 輸入概念(陣列或單值;元素可為物件,攤平)
 * @param {Array} fixes 輸入修正紀錄陣列(就地 push)
 * @param {Object} [opt={}] 輸入 { canSplit:(各段修正後之標籤陣列)=>Boolean, locale }——擠標籤拆開之條件(各段皆為既有概念;
 *   不可拆者整個標籤原樣保留,仍為 SS6 不合格,由呼叫端處置)。未給＝不拆(無從判定各段是否為既有概念);locale 為語言設定(檔頭【字形政策依語言設定】)
 * @returns {Array} 回傳修正後之概念
 * @example
 * let fixes = []
 * console.log(normConcepts(['主序星(12)', '赫羅圖', '赫羅圖', '光度(luminosity)'], fixes))
 * // => [ '主序星', '赫羅圖', '光度' ]
 * console.log(fixes)
 * // => [ '概念去計數尾碼「主序星(12)」', '概念去括號註記「光度(luminosity)」' ]
 *
 * console.log(normConcepts(['主序星、赫羅圖'], []), normConcepts(['主序星、赫羅圖'], [], { canSplit: () => true }))
 * // => [ '主序星、赫羅圖' ] [ '主序星', '赫羅圖' ]
 */
export function normConcepts(raw, fixes, opt = {}) {
    const canSplit = typeof opt?.canSplit === 'function' ? opt.canSplit : () => false
    const locale = resolveLocale(opt?.locale, 'normConcepts 之 opt.locale')
    const script = locale.script
    const list = (isarr(raw) ? raw : (scalar(raw) ? [raw] : [])).map(flattenEl).filter(Boolean)
    const out = []
    const seen = new Set()
    const push = (c0) => {
        const c = script.fix(c0.normalize('NFKC').trim())
        const key = c.toLowerCase().replace(/\s+/g, '')
        if (!c || seen.has(key)) return
        seen.add(key)
        out.push(c)
    }
    // 單一標籤之修正(去計數尾碼、去跨文字括號註記;回傳 { value, fix })
    const fixOne = (c) => {
        const p = conceptLabelProblem(c)
        if (/^計數尾碼/.test(p)) return { value: c.replace(/\s*\(\d+\)$/, ''), fix: `概念去計數尾碼「${c}」` }
        if (/^跨文字系統/.test(p)) {
            const m = /^(.+?)\s*\(([^()]+)\)$/.exec(c)
            // 保留語言設定那一半(中文之知識庫保留漢字半、其他語言保留非漢字半;另一半之對照不入標籤)
            const hanFirst = /\p{Script=Han}/u.test(m[1])
            return { value: (hanFirst === locale.han ? m[1] : m[2]).trim(), fix: `概念去括號註記「${c}」` }
        }
        return { value: c, fix: '' }
    }
    for (const c0 of list) {
        const c = c0.normalize('NFKC').trim()
        // 先拆括號外之分隔(括號內之逗號是參數,如 Beta(1,1)),再逐個修正——「A(246), B(445)」同時有擠標籤與計數尾碼:
        //   若先判尾碼只去掉最後一個「(445)」,拆不開而成亂鍵
        const parts = c.replace(/\([^()]*\)/g, (m) => m.replace(/[,，、;；]/g, '\u0000')).split(/[,，、;；]/).map((x) => x.replace(/\u0000/g, ',').trim()).filter(Boolean)
        const fixed = parts.map(fixOne)
        if (parts.length > 1 && !canSplit(fixed.map((x) => x.value))) {
            push(c) // 不可拆(有段非既有概念,或未給判定)→ 整個標籤原樣保留(仍為 SS6 不合格:新進不納入、存量列為修不了)
            continue
        }
        if (parts.length > 1) fixes.push(`概念拆開「${c0}」`)
        for (const x of fixed) {
            if (x.fix) fixes.push(x.fix)
            push(x.value)
        }
    }
    if (out.length > CONCEPT_COUNT.max) fixes.push(`概念 ${out.length} 個截為 ${CONCEPT_COUNT.max} 個`)
    return out.slice(0, CONCEPT_COUNT.max)
}

function normParams(raw, fixes, fix) {
    const out = []
    let dropped = 0
    for (const p of isarr(raw) ? raw : []) {
        if (isobj(p) && (p.name !== undefined || p.value !== undefined)) {
            const row = { name: fix(flattenEl(p.name)), value: fix(flattenEl(p.value)), note: fix(flattenEl(p.note)) }
            if (row.name || row.value) out.push(row)
            else dropped++
        }
        else if (scalar(p) && /[：:]/.test(String(p))) {
            const [name, ...rest] = String(p).split(/[：:]/)
            out.push({ name: fix(name.trim()), value: fix(rest.join('：').trim()), note: '' })
            fixes.push('參數列由字串拆為名稱與值')
        }
        else dropped++
    }
    if (dropped) fixes.push(`參數列形狀不合而移除 ${dropped} 列`)
    return out
}

function normEnum(v, list, renames, fix) {
    let s = fix(flattenEl(v).normalize('NFKC').trim())
    if (isobj(renames) && Object.prototype.hasOwnProperty.call(renames, s)) s = renames[s]
    return { value: s, ok: isarr(list) && list.includes(s) }
}

/**
 * 摘要項目之確定性正規化(不修改輸入)
 *
 * @param {Object} it 輸入 AI 回傳之單一項目
 * @param {Object} [opt={}] 輸入 { vocab:resolveSummarizeVocab 之產物(取 claimTypes、evidenceLevels、claimTypeRenames、evidenceLevelRenames、
 *   evidenceRule;未給＝不套改名、不降級), knownConcept:(標籤)=>Boolean(既有概念;擠標籤須各段皆為既有概念才拆),
 *   locale:語言設定或字形政策(檔頭【字形政策依語言設定】;未給＝臺灣正體)}。未給 knownConcept＝擠標籤不拆(檔頭)
 * @returns {Object} 回傳 { item, fixes:Array(修正說明) }
 * @throws {Error} opt.vocab 給了而非本套件解析後之詞彙表、或 opt.locale 不合時拋出
 * @example
 * let r = normalizeNoteItem({ relevant: true, title: '恆星分類', key_points: [{ 名稱: '主序星', 說明: '核融合' }, ' 紅巨星 '], concepts: ['主序星(15)', '赫羅圖'], claim_type: '理論模型', evidence_level: '中' })
 * console.log(r.item.key_points, r.item.concepts)
 * // => [ '主序星：核融合', '紅巨星' ] [ '主序星', '赫羅圖' ]
 * console.log(r.fixes)
 * // => [ 'key_points 之 1 個物件元素已攤平', '概念去計數尾碼「主序星(15)」' ]
 *
 * let vocab = resolveSummarizeVocab({ claimTypeRenames: { 觀測紀錄: '實證研究' } })
 * let r2 = normalizeNoteItem({ relevant: true, claim_type: '觀測紀錄', evidence_level: '中', concepts: ['主序星', '赫羅圖'] }, { vocab })
 * console.log(r2.item.claim_type, r2.fixes)
 * // => 實證研究 [ '內容類型「觀測紀錄」→「實證研究」' ]
 */
export function normalizeNoteItem(it, opt = {}) {
    const vocab = standardsVocabOf(opt.vocab, 'normalizeNoteItem 之 opt.vocab')
    const v = vocab || {}
    const fix = scriptOf(opt.locale, 'normalizeNoteItem 之 opt.locale').fix
    const fixes = []
    if (!isobj(it)) return { item: it, fixes }
    const k = { ...it }
    if (!k.relevant) return { item: k, fixes }
    for (const f of NOTE_TEXT_FIELDS) {
        if (k[f] === undefined) continue
        const before = k[f]
        k[f] = fix(flattenEl(before))
        if (!scalar(before) && before !== undefined && before !== null) fixes.push(`${f} 非字串已攤平`)
    }
    for (const f of NOTE_LIST_FIELDS) {
        if (k[f] === undefined) continue
        const raw = isarr(k[f]) ? k[f] : [k[f]]
        const objs = raw.filter((x) => !scalar(x) && x !== null && x !== undefined).length
        k[f] = raw.map(flattenEl).map((s) => fix(s)).filter(Boolean)
        if (objs) fixes.push(`${f} 之 ${objs} 個物件元素已攤平`)
    }
    if (k.parameters !== undefined) k.parameters = normParams(k.parameters, fixes, fix)
    const known = typeof opt.knownConcept === 'function' ? opt.knownConcept : null
    k.concepts = normConcepts(k.concepts, fixes, { ...(known ? { canSplit: (parts) => parts.every(known) } : {}), locale: opt.locale })
    const ct = normEnum(k.claim_type, v.claimTypes, v.claimTypeRenames, fix)
    const ev = normEnum(k.evidence_level, v.evidenceLevels, v.evidenceLevelRenames, fix)
    if (ct.value !== k.claim_type) fixes.push(`內容類型「${flattenEl(k.claim_type)}」→「${ct.value}」`)
    if (ev.value !== k.evidence_level) fixes.push(`證據等級「${flattenEl(k.evidence_level)}」→「${ev.value}」`)
    k.claim_type = ct.value
    k.evidence_level = ev.value
    // 最高證據等級而 caveat 明確自承無其要件(嚴式)→ 降一級(只往保守方向;SS11,與存量同一判準——檔頭);說明出自規則之訊息模板。
    //   證據說明(evidence_note)或 caveats 肯定陳述另一種合格證據(規則之 alt)者不降
    const d = vocab ? vocab.evidenceRule.downgrade({ level: k.evidence_level, levels: vocab.evidenceLevels, caveats: k.caveats || [], evidence: k.evidence_note }) : null
    if (d) {
        k.evidence_level = d.to
        fixes.push(d.fix)
    }
    // 上限(NOTE_FIELD_LIMITS;截了即記——不靜默截斷)。置於證據等級之判定後:判定看模型給之全部 caveats
    for (const [f, max] of Object.entries(NOTE_FIELD_LIMITS.text)) {
        if (typeof k[f] !== 'string') continue
        const r = cutAtBoundary(k[f], max, { boundaryRe: CLAUSE_END_RE })
        k[f] = r.text
        if (r.cut) fixes.push(`${f} ${r.from} 字逾 ${max}，於句讀處截為 ${[...r.text].length} 字`)
    }
    for (const [f, max] of Object.entries(NOTE_FIELD_LIMITS.list)) {
        if (!isarr(k[f]) || k[f].length <= max) continue
        fixes.push(`${f} ${k[f].length} 項逾 ${max}，取前 ${max} 項`)
        k[f] = k[f].slice(0, max)
    }
    return { item: k, fixes }
}

/**
 * 正規化後之硬性欄位問題(結構化:SS2 之可於 AI 輸出端判定者;納入閘據以不納入、修補呼叫據以指出欄位)
 *
 * @param {Object} k 輸入正規化後之項目
 * @param {Object} [vocab] 輸入詞彙表(resolveSummarizeVocab 之產物;未給＝不驗內容類型與證據等級之清單)
 * @returns {Array} 回傳 [{ field, kind:'text'|'list'|'concepts', line(現值;陣列以「、」串接), detail(問題說明) }](空＝合格;非知識項不檢)
 * @throws {Error} vocab 給了而非本套件解析後之詞彙表時拋出
 * @example
 * let k = { relevant: true, title: '恆星分類', summary: '', key_points: ['主序星'], concepts: ['主序星'], claim_type: '理論模型', evidence_level: '中' }
 * console.log(noteItemFieldProblems(k).map((p) => [p.field, p.detail]))
 * // => [ [ 'summary', '缺一句話重點' ], [ 'concepts', '概念 1 個（須 2～6）' ] ]
 */
export function noteItemFieldProblems(k, vocab) {
    const v = standardsVocabOf(vocab, 'noteItemFieldProblems 之 vocab') || {}
    if (!isobj(k) || !k.relevant) return []
    const out = []
    if (!strOf(k.title).trim()) out.push({ field: 'title', kind: 'text', line: '', detail: '缺標題' })
    if (!strOf(k.summary).trim()) out.push({ field: 'summary', kind: 'text', line: '', detail: '缺一句話重點' })
    if (!(isarr(k.key_points) && k.key_points.length)) out.push({ field: 'key_points', kind: 'list', line: '', detail: '核心知識為空' })
    const n = isarr(k.concepts) ? k.concepts.length : 0
    if (n < CONCEPT_COUNT.min) out.push({ field: 'concepts', kind: 'concepts', line: isarr(k.concepts) ? k.concepts.join('、') : '', detail: conceptCountDetail(n) })
    if (isarr(v.claimTypes) && !v.claimTypes.includes(k.claim_type)) out.push({ field: 'claim_type', kind: 'text', line: strOf(k.claim_type), detail: `內容類型「${k.claim_type ?? ''}」不在清單` })
    if (isarr(v.evidenceLevels) && !v.evidenceLevels.includes(k.evidence_level)) out.push({ field: 'evidence_level', kind: 'text', line: strOf(k.evidence_level), detail: `證據等級「${k.evidence_level ?? ''}」不在清單` })
    return out
}

/**
 * 正規化後之硬性欄位問題(SS2 之可於 AI 輸出端判定者;有問題即不納入、交重試)——noteItemFieldProblems 之說明文字
 *
 * @param {Object} k 輸入正規化後之項目
 * @param {Object} [vocab] 輸入詞彙表(同 noteItemFieldProblems)
 * @returns {Array} 回傳問題說明陣列(空＝合格;非知識項不檢)
 * @throws {Error} vocab 給了而非本套件解析後之詞彙表時拋出
 * @example
 * let k = { relevant: true, title: '恆星分類', summary: '依光譜型分類', key_points: [], concepts: ['主序星', '赫羅圖'] }
 * console.log(noteItemProblems(k), noteItemProblems({ relevant: false }))
 * // => [ '核心知識為空' ] []
 */
export function noteItemProblems(k, vocab) {
    return noteItemFieldProblems(k, vocab).map((p) => p.detail)
}

export default { NOTE_LIST_FIELDS, NOTE_TEXT_FIELDS, NOTE_FIELD_LIMITS, NOTE_PLACEHOLDERS, CONTRACT_FIELD_TYPES, cleanStrList, contractFieldProblems, shortText, flattenEl, normConcepts, normalizeNoteItem, noteItemFieldProblems, noteItemProblems }
