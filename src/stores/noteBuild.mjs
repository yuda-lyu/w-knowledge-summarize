// noteBuild.mjs — 筆記之組裝(不落地):摘要子階段(stages/noteStage)與人工匯入(ops/ingestNotes)共用同一份
//
// 【為何共用】兩條寫入路徑若各自清洗與組裝(概念清洗、類別修剪、清單外類別之落點各寫一份),同一份 note 經兩條路會產出不同之 record 與 md;
//   清洗、類別落點與 record／frontmatter 之組裝只寫在這裡。
// 【清單外類別】落 vocab.fallbackCategory,並保留模型(或匯入者)原給之類別於 categoryRaw——分類法擴充之候選依據
//   (類別提案彙整;不自動新增類別)。
// 【版型】frontmatter 與 record 之欄位、順序維持既有筆記之格式(新舊筆記不分裂);本文由 domain.renderNoteBody 產生。
// 【產物契約(domain.contract)】摘要段對產物之全部認識只經契約:{ kind, fields(AI 項目之欄位 schema:required／type／maxChars／maxItems;納入閘之
//   SS2 通用判定), buildNote(item, doc, { notesDir, nowIso, chars }) → { record(必含 id、docId), md:{ file, front, body }|null, text?(無 md 者供標準讀之
//   內容文字) }, standards(落地前以筆記標準判之子集;無 md 者只能列不讀 md 之標準) }。內建 note 契約(noteContractOf)即現行組裝與全部筆記標準;
//   自訂契約(如速報 domain/digestDomain)不落 md、記錄之欄位自定。

import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { slugify, checkKeys } from '../core/capturePackage.mjs'
import { SUMMARIZE_VOCAB_DEFAULT } from '../core/vocab/summarizeVocab.mjs'
import { cleanStrList, NOTE_LIST_FIELDS, NOTE_TEXT_FIELDS } from '../standards/noteNormalize.mjs'
import { CONCEPT_COUNT, NOTE_STANDARDS } from '../standards/noteStandards.mjs'

/**
 * 內建 note 契約之欄位(AI 項目之欄位 schema;與 isValidItem、noteItemFieldProblems 之硬性欄位同一組必填——title、summary、key_points、concepts;
 *   其餘為選填且不設上限,上限由 createSummarizeDomain 之 opt.limits 或正規化之 NOTE_FIELD_LIMITS 處置)
 *
 * @type {Object}
 */
export const NOTE_CONTRACT_FIELDS = Object.freeze({
    ...Object.fromEntries(NOTE_TEXT_FIELDS.map((f) => [f, Object.freeze({ type: 'string', ...(f === 'title' || f === 'summary' ? { required: true } : {}) })])),
    ...Object.fromEntries(NOTE_LIST_FIELDS.map((f) => [f, Object.freeze({ type: 'string[]', ...(f === 'key_points' ? { required: true } : {}) })])),
    concepts: Object.freeze({ required: true, type: 'string[]' }),
    claim_type: Object.freeze({ type: 'string' }),
    evidence_level: Object.freeze({ type: 'string' }),
    parameters: Object.freeze({ type: 'object[]' }),
    explore: Object.freeze({ type: 'object[]' }),
})

/**
 * 內建 note 契約適用之標準(全部程式判定之筆記標準;NOTE_STANDARDS 之 id)
 *
 * @type {Array}
 */
export const NOTE_CONTRACT_STANDARDS = Object.freeze(NOTE_STANDARDS.map((s) => s.id))

/**
 * 契約欄位之上限覆寫之合併(createSummarizeDomain 之 opt.limits):{ 欄位: { maxChars?, maxItems? } } 併入 fields;鍵限 fields 之欄位、值須為正整數
 *
 * @param {Object} fields 輸入契約欄位
 * @param {*} limits 輸入上限覆寫(未給＝不改)
 * @returns {Object} 回傳合併後之欄位(新物件;未給 limits 即原物件)
 * @throws {Error} limits 非物件、含不認得之欄位、或 maxChars／maxItems 非正整數時拋出
 * @example
 * console.log(mergeContractLimits({ title: { type: 'string', required: true } }, { title: { maxChars: 40 } }))
 * // => { title: { type: 'string', required: true, maxChars: 40 } }
 */
export function mergeContractLimits(fields, limits) {
    if (limits === undefined || limits === null) return fields
    if (!isobj(limits)) throw new Error('contract.limits 須為物件 { 欄位: { maxChars?, maxItems? } }')
    checkKeys(limits, Object.keys(fields), 'contract.limits')
    const out = { ...fields }
    for (const [f, l] of Object.entries(limits)) {
        if (!isobj(l)) throw new Error(`contract.limits.${f} 須為物件 { maxChars?, maxItems? }`)
        checkKeys(l, ['maxChars', 'maxItems'], `contract.limits.${f}`)
        for (const k of ['maxChars', 'maxItems']) {
            if (l[k] !== undefined && !(Number.isInteger(l[k]) && l[k] > 0)) throw new Error(`contract.limits.${f}.${k} 須為正整數`)
        }
        out[f] = Object.freeze({ ...fields[f], ...(l.maxChars !== undefined ? { maxChars: l.maxChars } : {}), ...(l.maxItems !== undefined ? { maxItems: l.maxItems } : {}) })
    }
    return Object.freeze(out)
}

/**
 * 契約之形狀問題(注入之 domain 之 contract 於建構期驗;自組契約亦可自驗)
 *
 * @param {*} c 輸入契約
 * @returns {String} 回傳問題說明(合格回 '')
 * @example
 * console.log(contractProblem({ kind: 'x', fields: {}, buildNote: () => ({}), standards: [] }))
 * // =>
 */
export function contractProblem(c) {
    if (!isobj(c)) return 'contract 須為物件 { kind, fields, buildNote, standards }'
    if (!isestr(c.kind)) return 'contract.kind 須為非空字串'
    if (!isobj(c.fields)) return 'contract.fields 須為物件 { 欄位: { required?, type?, maxChars?, maxItems? } }'
    if (typeof c.buildNote !== 'function') return 'contract.buildNote 須為函數 (item, doc, { notesDir, nowIso, chars }) => { record, md, text? }'
    if (!isarr(c.standards) || !c.standards.every(isestr)) return 'contract.standards 須為標準 id 之字串陣列'
    const unknown = c.standards.filter((id) => !NOTE_CONTRACT_STANDARDS.includes(id))
    if (unknown.length) return `contract.standards 含不認得之標準：${unknown.join('、')}（可用：${NOTE_CONTRACT_STANDARDS.join('、')}）`
    return ''
}

/**
 * 內建 note 契約(檔頭【產物契約】):欄位＝NOTE_CONTRACT_FIELDS(併 o.limits)、組裝＝本檔之 buildNote(經 domain 之 normalizeQuality／renderNoteBody)、
 *   標準＝全部筆記標準。無 contract 之自組 domain(只具 normalizeQuality／renderNoteBody／vocab 者)亦以此取得契約(摘要段之退路)
 *
 * @param {Object} domain 輸入摘要領域物件(取 vocab、normalizeQuality、renderNoteBody)
 * @param {Object} [o={}] 輸入 { limits }(欄位上限覆寫;見 mergeContractLimits)
 * @returns {Object} 回傳契約 { kind:'note', fields, buildNote, standards }(凍結)
 * @throws {Error} domain 非物件、或 o.limits 不合規格時拋出
 * @example
 * const contract = noteContractOf({}, { limits: { summary: { maxChars: 300 } } })
 * console.log(contract.kind, contract.fields.summary)
 * // => note { type: 'string', required: true, maxChars: 300 }
 */
export function noteContractOf(domain, o = {}) {
    if (!isobj(domain)) throw new Error('noteContractOf 需要 domain 物件')
    const fields = mergeContractLimits(NOTE_CONTRACT_FIELDS, isobj(o) ? o.limits : undefined)
    return Object.freeze({
        kind: 'note',
        fields,
        buildNote: (k, doc, c = {}) => {
            const n = buildNote({ k, doc, domain, notesDir: c?.notesDir, nowIso: c?.nowIso, ...(isobj(c?.chars) ? { chars: c.chars } : {}), locale: domain.locale })
            return { record: n.record, md: { file: n.file, front: n.front, body: n.body }, slug: n.slug, nowIso: n.nowIso, concepts: n.concepts, category: n.category, categoryRaw: n.categoryRaw }
        },
        standards: NOTE_CONTRACT_STANDARDS,
    })
}

/**
 * 生效之契約:domain.contract 有且合格者取之;無者退為內建 note 契約(摘要段與人工匯入同一取法)
 *
 * @param {Object} domain 輸入摘要領域物件
 * @returns {Object} 回傳契約
 * @throws {Error} domain.contract 給了而形狀不合時拋出
 * @example
 * console.log(contractOf({}).kind)
 * // => note
 *
 * console.log(contractOf({ contract: { kind: 'digest', fields: {}, buildNote: () => ({}), standards: [] } }).kind)
 * // => digest
 */
export function contractOf(domain) {
    if (isobj(domain?.contract)) {
        const p = contractProblem(domain.contract)
        if (p) throw new Error(`domain.contract 不合：${p}`)
        return domain.contract
    }
    return noteContractOf(domain)
}

/**
 * 類別落點:去頭尾空白後在清單內即採用,否則落 fallbackCategory(並回傳原給之類別供 categoryRaw)
 *
 * @param {*} raw 輸入原給之類別
 * @param {Object} vocab 輸入詞彙表(取 categories、fallbackCategory;未給 fallbackCategory 用本套件預設詞彙表之值)
 * @returns {Object} 回傳 { category, categoryRaw }：categoryRaw 只在原給非空且不在清單時為原值，否則為 ''
 * @example
 * console.log(categoryOf(' 方法與技術 ', { categories: ['方法與技術', '其他'], fallbackCategory: '其他' }))
 * // => { category: '方法與技術', categoryRaw: '' }
 */
export function categoryOf(raw, vocab) {
    const cats = isarr(vocab?.categories) ? vocab.categories : []
    const fb = isestr(vocab?.fallbackCategory) ? vocab.fallbackCategory : SUMMARIZE_VOCAB_DEFAULT.fallbackCategory
    const s = String(raw ?? '').trim()
    if (cats.includes(s)) return { category: s, categoryRaw: '' }
    return { category: fb, categoryRaw: s }
}

/**
 * 組裝一篇筆記(不落地):slug、md 路徑、frontmatter、本文、筆記索引記錄
 *
 * @param {Object} o 輸入物件
 * @param {Object} o.k 輸入摘要項目(AI 輸出或人工匯入之 note;取 title、concepts、category、summary 與品質欄位)
 * @param {Object} o.doc 輸入來源文件記錄(取 id、url、sourceName、publishedAt、textFrom、title)
 * @param {Object} o.domain 輸入摘要領域物件(取 vocab、normalizeQuality、renderNoteBody)
 * @param {String} o.notesDir 輸入筆記 md 目錄
 * @param {String} o.nowIso 輸入建立時刻
 * @param {Object} [o.chars] 輸入處理範圍 { sourceChars, processedChars }(摘要子階段之長文截斷明示;匯入不給)
 * @param {Object} [o.locale] 輸入語言設定(抓取套件 resolveLocale 之產物;未給或無 slug 政策＝只收漢字與拉丁——既有 slug 不變;domain.locale 之 slug 政策:
 *   非中文之語言收任何文字之字母與數字)
 * @returns {Object} 回傳 { slug, file, nowIso, front, body, record, concepts, category, categoryRaw }
 * @throws {Error} o 非物件或缺 k／doc／domain／notesDir 時拋出
 * @example
 * const domain = {
 *     vocab: { categories: ['天文'], fallbackCategory: '其他' },
 *     normalizeQuality: () => ({ claimType: '事實', evidenceLevel: '中', samplePeriod: '', caveats: [] }),
 *     renderNoteBody: (k) => `# ${k.title}\n`,
 * }
 * const k = { title: '太陽黑子', summary: '週期約 11 年', category: '歷史', concepts: ['太陽黑子'] }
 * const doc = { id: 'd1', url: '', sourceName: '示範站', publishedAt: '' }
 * const note = buildNote({ k, doc, domain, notesDir: './notes', nowIso: new Date().toISOString() })
 * console.log(note.slug, note.category, note.categoryRaw)
 * // => 太陽黑子-ee17560c 其他 歷史
 *
 * console.log(note.record.file)
 * // => notes/太陽黑子-ee17560c.md
 */
export function buildNote(o) {
    if (!isobj(o) || !isobj(o.k) || !isobj(o.doc) || !isobj(o.domain) || !isestr(o.notesDir)) {
        throw new Error('buildNote 需要 { k, doc, domain, notesDir }')
    }
    const { k, doc, domain, notesDir, nowIso } = o
    const chars = isobj(o.chars) ? o.chars : {}
    const locale = isobj(o.locale) ? o.locale : (isobj(domain.locale) ? domain.locale : null)
    const slug = slugify(k.title, doc.id, isestr(locale?.slug) ? { chars: locale.slug } : {})
    const file = path.join(notesDir, `${slug}.md`)
    // 只收字串或數字元素(物件元素會成 "[object Object]";驗證端 isValidItem 同一清洗規則);至多 CONCEPT_COUNT.max 個
    const concepts = cleanStrList(k.concepts).slice(0, CONCEPT_COUNT.max)
    const q = domain.normalizeQuality(k)
    const { category, categoryRaw } = categoryOf(k.category, domain.vocab)
    const front = {
        title: k.title,
        slug,
        category,
        concepts,
        claim_type: q.claimType,
        evidence_level: q.evidenceLevel,
        sample_period: q.samplePeriod,
        caveats: q.caveats,
        source_name: doc.sourceName,
        source_url: doc.url,
        published: doc.publishedAt || '',
        created: nowIso,
        doc_id: doc.id,
        type: 'note',
    }
    const record = {
        id: slug,
        title: k.title,
        category,
        // 清單外類別之原值(分類法擴充之候選依據;見檔頭)
        ...(categoryRaw ? { categoryRaw } : {}),
        concepts,
        summary: String(k.summary || '').slice(0, 300),
        claimType: q.claimType,
        evidenceLevel: q.evidenceLevel,
        caveats: q.caveats,
        samplePeriod: q.samplePeriod,
        sourceUrl: doc.url,
        sourceName: doc.sourceName,
        docId: doc.id,
        // 處理範圍(摘要子階段之長文規則):processedChars < sourceChars 即摘要只讀了前段
        ...(chars.sourceChars ? { sourceChars: chars.sourceChars, processedChars: chars.processedChars } : {}),
        file: file.replace(/\\/g, '/'),
        createdAt: nowIso,
        // 下游工作之處理時刻(初值為空;由下游寫入)
        relatedAt: '',
        extractedAt: '',
    }
    return { slug, file, nowIso, front, body: domain.renderNoteBody(k, doc, q, chars), record, concepts, category, categoryRaw }
}

export default { NOTE_CONTRACT_FIELDS, NOTE_CONTRACT_STANDARDS, mergeContractLimits, contractProblem, noteContractOf, contractOf, categoryOf, buildNote }
