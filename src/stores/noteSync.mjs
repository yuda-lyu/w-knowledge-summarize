// noteSync.mjs — 筆記內容變更之偵測(純函數):由 md 讀回下游判定所讀之欄位(標題、概念、一句話重點)、算同步雜湊
//
// 【為何同步回記錄】下游判定只讀筆記記錄之 title／concepts／summary,而記錄之 summary 只存在記錄(md 是「一句話重點」章)。
//   只偵測 md 而不同步,重判看到的仍是舊內容。
// 【欄位之真理】內容欄位(標題、概念、一句話重點)以 md 為準(使用者改 md);分類欄位(類別、內容類型、證據等級)以記錄為準
//   (重標依記錄改寫 md)——兩種變更之真理來源刻意分開。
// 【雜湊之正準形】只由 md 讀回值計(掃描回填,不在建立時寫:寫入前之值與讀回值在換行、引號、頭尾空白上不同,會讓每篇新筆記
//   於下一輪被誤判為變更);值內空白與換行類字元壓成單一空白;概念取原字串、保序(換位會改變下游所取之主標籤)、不過 normalizeConcept
//   (詞彙別名一改全庫雜湊同時翻動);標題取 frontmatter title(正文 H1 不算)。
// 【只看下游判定所讀者】正文其他章(核心知識等)之改動不進雜湊——下游之判定不讀它們(讀 md 原文之下游另行處理其變更)。

import isarr from 'wsemi/src/isarr.mjs'
import { summaryTextOf } from '../core/md/md.mjs'
import { NOTE_SECTION_TITLES } from '../core/md/noteContent.mjs'
import { sha1 } from '../core/capturePackage.mjs'

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

/**
 * 由 md 讀回同步欄位
 *
 * @param {Object} md 輸入 readMd 之產物 { front, body }
 * @returns {Object} 回傳 { title, concepts:Array, summary }
 * @example
 * console.log(syncFieldsOf({ front: { title: ' T ', concepts: ['a', ' b '] }, body: '# T\n\n## 一句話重點\n\n重點\n\n## 核心知識\n\n- k' }))
 * // => { title: 'T', concepts: [ 'a', 'b' ], summary: '重點' }
 */
export function syncFieldsOf(md) {
    const front = md?.front || {}
    const seen = new Set()
    const concepts = []
    for (const c of isarr(front.concepts) ? front.concepts : []) {
        const v = norm(c)
        if (v && !seen.has(v)) {
            seen.add(v)
            concepts.push(v)
        }
    }
    return { title: norm(front.title), concepts, summary: summaryTextOf(md) ?? '' }
}

/**
 * 同步雜湊
 *
 * @param {Object} f 輸入 syncFieldsOf 之產物
 * @returns {String} 回傳雜湊
 * @example
 * let f = syncFieldsOf({ front: { title: '恆星分類', concepts: ['主序星', '赫羅圖'] }, body: '## 一句話重點\n\n依光譜型分類。' })
 * console.log(syncHashOf(f).length, syncHashOf(f) === syncHashOf({ ...f }), syncHashOf({ ...f, title: '恆星演化' }) === syncHashOf(f))
 * // => 40 true false
 */
export function syncHashOf(f) {
    return sha1(JSON.stringify([f.title, f.concepts, f.summary]))
}

/**
 * 變更時寫回記錄之欄位(summary 同建立時之 300 字上限)
 *
 * @param {Object} f 輸入 syncFieldsOf 之產物
 * @returns {Object} 回傳 { title, concepts, summary }
 * @example
 * let p = recordPatchOf({ title: '恆星分類', concepts: ['主序星'], summary: '重點'.repeat(200) })
 * console.log(p.title, p.summary.length)
 * // => 恆星分類 300
 */
export function recordPatchOf(f) {
    return { title: f.title, concepts: f.concepts, summary: f.summary.slice(0, 300) }
}

/**
 * 兩組欄位之差異描述(日誌用)
 *
 * @param {Object} rec 輸入記錄(舊值)
 * @param {Object} f 輸入新欄位
 * @returns {String} 回傳如「標題、概念」
 * @example
 * let rec = { title: '恆星分類', concepts: ['主序星', '赫羅圖'], summary: '依光譜型分類' }
 * console.log(diffLabelOf(rec, { title: '恆星演化', concepts: ['主序星', '赫羅圖'], summary: '依光譜型分類' }))
 * // => 標題
 * console.log(diffLabelOf(rec, { title: '恆星分類', concepts: ['主序星'], summary: '依光譜型與光度分類' }))
 * // => 概念、一句話重點
 * console.log(diffLabelOf(rec, rec))
 * // => 內容
 */
export function diffLabelOf(rec, f) {
    const out = []
    if (norm(rec?.title) !== f.title) out.push('標題')
    const old = (isarr(rec?.concepts) ? rec.concepts : []).map(norm)
    if (JSON.stringify(old) !== JSON.stringify(f.concepts)) out.push('概念')
    if (!f.summary.startsWith(norm(rec?.summary).slice(0, 200))) out.push(NOTE_SECTION_TITLES.summary)
    return out.join('、') || '內容'
}

export default { syncFieldsOf, syncHashOf, recordPatchOf, diffLabelOf }
