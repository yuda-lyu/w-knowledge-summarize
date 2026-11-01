// noteContent.mjs — 筆記 md 之內容章與來源章欄位(檢定標準之材料)
//
// 【為何獨立成檔】筆記之「內容章」是數字紮根(SS4)之輸出側材料,摘要之標準、納入閘與存量處置共用,故只定義一次於此。
// 【內容章】筆記本文去掉程式產生之「來源」章與下游投影之「關聯」「⚠ 衝突與反例」章;這三章不是本筆記之 AI 內容
//   (原文標題可能合法為簡體、投影章之理由屬下游之標準)。保留「# 標題」行。
// 【來源章欄位】原文標題(originalTitleOf)、發布時間(publishedOf)取自來源章之條列行(版型由摘要之 renderNoteBody 寫出);
//   值為缺值字樣(「（無）」「（未提供）」)者視為無。下游讀筆記之版型一律經本檔,不另寫一份。

import { sectionOf, SUMMARY_SECTION } from './md.mjs'

/**
 * 筆記版型之章名(跨套件之資料契約;唯一一份):本套件之版型、標準、修補、存量處置、同步與下游套件之讀者(材料讀法、分節摘要)一律取此常數,
 *   不另寫字面——章名綁定既有筆記,不可改
 *
 * @type {Object}
 */
export const NOTE_SECTION_TITLES = Object.freeze({
    summary: SUMMARY_SECTION, quality: '品質與證據標注', keyPoints: '核心知識', parameters: '關鍵參數', methods: '方法與步驟', conditions: '適用條件與限制',
    prosCons: '利弊與取捨', regime: '時效與機制相依', counterViews: '爭議與反方觀點', verifiable: '可驗證要點', source: '來源',
})

/** 筆記版型之章序(renderNoteBody 之產出序;鍵同 NOTE_SECTION_TITLES) */
export const NOTE_SECTION_ORDER = Object.freeze(['summary', 'quality', 'keyPoints', 'parameters', 'methods', 'conditions', 'prosCons', 'regime', 'counterViews', 'verifiable', 'source'])

/** 來源章之行首(「<行首>：<值>」;原文標題與發布時間之讀法亦據此) */
export const NOTE_SOURCE_LABELS = Object.freeze({ originalTitle: '原文標題', sourceName: '來源', url: '網址', published: '發布時間', textFrom: '內文取得方式', processed: '內文處理範圍' })

/** 品質與證據標注章之行首 */
export const NOTE_QUALITY_LABELS = Object.freeze({ claimType: '內容類型', evidenceLevel: '證據等級', samplePeriod: '數據樣本期間' })

/** 下游投影章之章名(跨套件之資料契約:本套件列為非內容章、下游依名寫入與讀取——章名只定義於此,下游取用同一常數) */
export const PROJECTION_SECTION_TITLES = Object.freeze({ relations: '關聯', conflicts: '⚠ 衝突與反例' })

/** 非本筆記 AI 內容之章(程式產生之來源章、下游投影章) */
export const NON_CONTENT_SECTIONS = [NOTE_SECTION_TITLES.source, PROJECTION_SECTION_TITLES.relations, PROJECTION_SECTION_TITLES.conflicts]

/**
 * 筆記之內容章(去掉 NON_CONTENT_SECTIONS 之章——來源章與下游投影章;保留「# 標題」行)
 *
 * @param {*} body 輸入 md 本文(不含 frontmatter)
 * @returns {String} 回傳內容章文字
 * @example
 * const body = '# 太陽黑子\n\n## 核心知識\n\n- 週期約 11 年\n\n## 來源\n\n- 原文標題：Sunspot cycle\n\n## ⚠ 衝突與反例\n\n- 某則反例\n'
 * console.log(JSON.stringify(noteContentText(body)))
 * // => "# 太陽黑子\n\n## 核心知識\n\n- 週期約 11 年\n"
 */
export function noteContentText(body) {
    const parts = String(body ?? '').replace(/\r\n/g, '\n').split(/\n(?=## )/)
    return parts.filter((p) => !NON_CONTENT_SECTIONS.some((h) => p.startsWith(`## ${h}\n`) || p === `## ${h}` || p.startsWith(`## ${h} `))).join('\n')
}

/**
 * 某章之內文(去章標題行;無此章回 '')
 *
 * @param {*} body 輸入 md 本文
 * @param {String} title 輸入章名
 * @returns {String} 回傳內文
 * @example
 * const body = '## 核心知識\n\n- 週期約 11 年\n\n## 來源\n\n- 原文標題：甲\n'
 * console.log(JSON.stringify(sectionBodyOf(body, '核心知識')))
 * // => "- 週期約 11 年"
 *
 * console.log(JSON.stringify(sectionBodyOf(body, '利弊與取捨')))
 * // => ""
 */
export function sectionBodyOf(body, title) {
    const sec = sectionOf(String(body ?? '').replace(/\r\n/g, '\n'), title)
    return sec ? sec.text.replace(/^## [^\n]*\n?/, '').trim() : ''
}

/**
 * 某章之條列項(「- 」或「* 」起首之行,去前綴與頭尾空白、略空項;無此章或無條列回 [])——版型之條列章(核心知識、適用條件與限制…)之讀法,
 *   下游讀筆記之條列章一律經此
 *
 * @param {*} body 輸入 md 本文
 * @param {String} title 輸入章名
 * @returns {Array} 回傳條列項之文字陣列
 * @example
 * console.log(sectionItemsOf('## 核心知識\n\n- 甲\n* 乙 \n\n文\n- \n', '核心知識'))
 * // => [ '甲', '乙' ]
 */
export function sectionItemsOf(body, title) {
    return sectionBodyOf(body, title).split('\n').filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, '').trim()).filter(Boolean)
}

/**
 * 原文標題(來源章「原文標題：」行;數字紮根之材料之一)
 *
 * @param {*} body 輸入 md 本文
 * @returns {String} 回傳原文標題(無則 '')
 * @example
 * console.log(originalTitleOf('## 來源\n\n- 原文標題：Sunspot cycle\n- 來源：示範站\n'))
 * // => Sunspot cycle
 *
 * console.log(JSON.stringify(originalTitleOf('## 來源\n\n- 原文標題：（無）\n')))
 * // => ""
 */
export function originalTitleOf(body) {
    const m = new RegExp(`^(?:-\\s*)?${NOTE_SOURCE_LABELS.originalTitle}：(.*)$`, 'm').exec(sectionBodyOf(body, NOTE_SECTION_TITLES.source)) // 來源章為條列(「- 原文標題：…」)
    return m && m[1].trim() !== '（無）' ? m[1].trim() : ''
}

/**
 * 原文之發布時間(來源章「發布時間：」行;未提供者版型寫「（未提供）」,視為無)——下游以筆記為據之材料之一(如批次摘要所附之發布時間)
 *
 * @param {*} body 輸入 md 本文
 * @returns {String} 回傳發布時間(去頭尾空白;無此行、無來源章或為「（未提供）」回 '')
 * @example
 * console.log(publishedOf('## 來源\n\n- 原文標題：甲\n- 發布時間：2026-01-01T08:00:00+08:00\n'))
 * // => 2026-01-01T08:00:00+08:00
 *
 * console.log(JSON.stringify(publishedOf('## 來源\n\n- 發布時間：（未提供）\n')))
 * // => ""
 */
export function publishedOf(body) {
    const m = new RegExp(`^(?:-\\s*)?${NOTE_SOURCE_LABELS.published}：(.*)$`, 'm').exec(sectionBodyOf(body, NOTE_SECTION_TITLES.source))
    return m && m[1].trim() !== '（未提供）' ? m[1].trim() : ''
}

/**
 * 證據說明(「品質與證據標注」章之「- 證據等級：<等級>（<說明>）」行之括號內文;最高證據等級之要件判定(SS11)取之,以辨認
 *   另一種合格證據——版型由摘要之 renderNoteBody 寫出)
 *
 * @param {*} body 輸入 md 本文
 * @returns {String} 回傳證據說明(無則 '')
 * @example
 * console.log(evidenceNoteOf('## 品質與證據標注\n\n- 證據等級：高（三年之世代追蹤結果）\n'))
 * // => 三年之世代追蹤結果
 */
export function evidenceNoteOf(body) {
    const m = new RegExp(`^(?:-\\s*)?${NOTE_QUALITY_LABELS.evidenceLevel}：[^（\\n]*（(.*)）\\s*$`, 'm').exec(sectionBodyOf(body, NOTE_SECTION_TITLES.quality))
    return m ? m[1].trim() : ''
}

/**
 * 筆記之存量材料(原文標題＋內容章):下游以筆記為據之數字紮根材料(下游產出所引之數字須見於所據之筆記)
 *
 * @param {*} body 輸入 md 本文
 * @returns {String} 回傳材料文字
 * @example
 * console.log(JSON.stringify(noteMaterialText('# T\n\n## 核心知識\n\n- 週期 12 年\n\n## 來源\n\n- 原文標題：太陽黑子週期')))
 * // => "太陽黑子週期\n# T\n\n## 核心知識\n\n- 週期 12 年\n"
 */
export function noteMaterialText(body) {
    return `${originalTitleOf(body)}\n${noteContentText(body)}`
}

export default { NOTE_SECTION_TITLES, NOTE_SECTION_ORDER, NOTE_SOURCE_LABELS, NOTE_QUALITY_LABELS, PROJECTION_SECTION_TITLES, NON_CONTENT_SECTIONS, noteContentText, sectionBodyOf, sectionItemsOf, originalTitleOf, publishedOf, evidenceNoteOf, noteMaterialText }
