// noteKit.mjs — 本套件交出之筆記之測試件(下游套件之測試以之落筆記;共用層,不帶 .test. 中綴)
//
// 【筆記即本套件之產物】landNoteOf 之產物以本套件之真實組裝(buildNote)寫 md 與組記錄——下游讀到的是真實之版型與欄位(md 之章名與行首標籤、
//   記錄之 claimType／evidenceLevel／sourceName、relatedAt／extractedAt 之初值),不是測試自擬之形狀。
// 【工廠】各下游之預設不同(提煉之筆記預設已關聯——relatedAt＝建立時刻,可提煉;關聯之筆記預設未關聯):各下游之測試共用層以 landNoteOf 實例化
//   一次(關聯、提煉之測試經各自之 test/tools/summarizeForTest.mjs 取用),不各寫一份。

import { writeMd } from '../../src/core/md/md.mjs'
import { createSummarizeDomain } from '../../src/domain/noteDomain.mjs'
import { buildNote } from '../../src/stores/noteBuild.mjs'
import { genClockTZ } from './captureForTest.mjs'

/** 本套件之 domain(筆記組裝用;預設詞彙) */
const SUMMARIZE_DOMAIN = createSummarizeDomain({})

/** 真時鐘(Asia/Taipei;建立時刻之預設) */
const CLOCK = genClockTZ('Asia/Taipei')

/**
 * 落筆記之函數之工廠
 *
 * @param {Object} [opt={}] 輸入 { related:Boolean(true＝記錄之 relatedAt 預設為建立時刻——已關聯,可提煉;預設 false) }
 * @returns {Function} 回傳 landNote(notesDir, o):以 buildNote 寫 md 並回筆記記錄(id 即 slug;file 為 md 之路徑;不入集合)。
 *   o:{ doc:來源文件 id(決定 slug 之尾碼), title, concepts:Array, category?, summary?, keyPoints?:Array, conditions?:Array,
 *   k?:Object(摘要項目之其他欄位,如 parameters、methods、pros、cons、regime_dependency、counter_views、verifiable——對應各選填章),
 *   nowIso?(建立時刻;未給取真時鐘), record?:Object(記錄之額外欄位,覆寫 relatedAt 等) }
 * @example
 * const landNote = landNoteOf({ related: true })
 * const rec = landNote(`${root}/knowledge/notes`, { doc: 'd1', title: '動量之衰退', concepts: ['動量'] })
 */
export function landNoteOf(opt = {}) {
    const related = opt?.related === true
    return (notesDir, o) => {
        const title = o.title
        const nowIso = o.nowIso || CLOCK.iso8()
        const k = {
            title,
            summary: o.summary || `${title}之重點`,
            key_points: o.keyPoints || [`${title}之步驟`, `${title}之適用條件`],
            concepts: o.concepts,
            category: o.category || '方法與技術',
            claim_type: '實證研究',
            evidence_level: '中',
            caveats: ['適用範圍狹窄'],
            ...(o.conditions ? { conditions: o.conditions } : {}),
            ...(o.k || {}),
        }
        const b = buildNote({ k, doc: { id: o.doc, url: `https://example.com/${o.doc}`, sourceName: '測試來源', title }, domain: SUMMARIZE_DOMAIN, notesDir, nowIso })
        writeMd(b.file, b.front, b.body)
        return { ...b.record, ...(related ? { relatedAt: nowIso } : {}), ...(o.record || {}) }
    }
}

export default { landNoteOf }
