// packByChars.mjs — 摘要之依字數打包(摘要段之長文批次規則)
//
// 【規則】每批字數上限＝batchSize×charsPerDoc,依池之順序貪婪裝批:篇數與字數皆不逾上限者同批、各自全文進 AI;
//   單篇逾上限者獨佔一批並截至上限。各篇之字數預算＝min(字數, 每批字數上限)——buildPrompt 之 budgets 與處理範圍皆讀它。
// 【為何獨立】摘要段與檢定標準之題組測試須以同一批次規則組提示詞(評分測的須是正式之提示詞),規則只寫一處。

import isarr from 'wsemi/src/isarr.mjs'

/**
 * 依字數打包文件為批次
 *
 * @param {Array} items 輸入文件陣列(依池之順序;取 id、text)
 * @param {Object} opt 輸入設定物件
 * @param {Integer} opt.batchSize 輸入每批篇數上限正整數
 * @param {Integer} opt.charsPerDoc 輸入每篇字數單位正整數(每批字數上限＝batchSize×charsPerDoc)
 * @returns {Object} 回傳 { batches:Array(各批文件陣列), budgets:Map(doc.id → 本篇送入 AI 之字數上限) }
 * @throws {Error} batchSize 或 charsPerDoc 非正整數時拋出
 * @example
 * let r = packDocsByChars([{ id: 'a', text: 'x'.repeat(2000) }, { id: 'b', text: 'y'.repeat(20000) }], { batchSize: 3, charsPerDoc: 6000 })
 * console.log(r.batches.map((b) => b.map((d) => d.id)), [...r.budgets])
 * // => [ [ 'a' ], [ 'b' ] ] [ [ 'a', 2000 ], [ 'b', 18000 ] ]
 */
export function packDocsByChars(items, { batchSize, charsPerDoc }) {
    if (!(Number.isInteger(batchSize) && batchSize > 0)) throw new Error(`packDocsByChars 之 batchSize 須為正整數：${batchSize}`)
    if (!(Number.isInteger(charsPerDoc) && charsPerDoc > 0)) throw new Error(`packDocsByChars 之 charsPerDoc 須為正整數：${charsPerDoc}`)
    const batchChars = batchSize * charsPerDoc
    const batches = []
    const budgets = new Map()
    let cur = []
    let sum = 0
    for (const d of isarr(items) ? items : []) {
        const need = Math.min(String(d?.text || '').length, batchChars)
        if (cur.length > 0 && (cur.length >= batchSize || sum + need > batchChars)) {
            batches.push(cur)
            cur = []
            sum = 0
        }
        cur.push(d)
        sum += need
        budgets.set(d.id, need)
    }
    if (cur.length) batches.push(cur)
    return { batches, budgets }
}

export default packDocsByChars
