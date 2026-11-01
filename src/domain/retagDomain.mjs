// retagDomain.mjs — 重標(retag)的內建領域預設:分類法變更後,依現行分類清單為既有筆記重判類別
//
// 【輸入只用筆記既有之結構化欄位】標題、原類別、一句話重點、核心知識前三條(md 之「核心知識」章)——不重讀原文
//   (原文終態後已瘦身;分類只需筆記層之資訊)。
// 【可維持原類別】新增類別時之重判範圍含落點類別與關鍵詞相符者,多數仍屬原類別;要求模型「原類別仍最合適即維持」,
//   避免為了回應「新增了 Y」而硬搬。退役類別不在清單,模型只能改選清單內者(驗證亦擋)。
// 【新增類別只問新類別】原類別非落點者只判「是否改歸 Y」(兩既有類別間之平移不是新增 Y 所觸發;程式亦強制,見 taxonomy.retagTargetOf);
//   落點類別者依清單擇一(新類別或既有類別皆可)。
// 【輸出契約】[{ index, category }];category 須照清單原字(驗證以現行清單比對,不在清單之項目不採用、該篇留待下輪)。
//   整個提示詞可經 opt.prompts.retag 覆寫(收原參數＋末參數 ctx,可包裝內建);輸出契約與驗證不變。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import { resolveSummarizeVocab, kbLabelOf } from '../core/vocab/summarizeVocab.mjs'
import { promptOverridesOf, promptCtxOf, overridablePrompt } from '../core/capturePackage.mjs'

/**
 * 重標 domain 可覆寫之提示詞與覆寫函數之形式(唯一一份;抓取套件之提示詞覆寫之 SIGS 形狀——cfg 層、執行期件與本工廠同讀,摘要執行期件之
 *   SUMMARIZE_PROMPT_SIGS 由之組成):retag＝重標之提示詞;末參數 ctx 為 { kbLabel, domain, vocab, defaultPrompt }
 *
 * @type {Object}
 */
export const RETAG_PROMPT_SIGS = Object.freeze({ retag: Object.freeze({ params: '(items, o, ctx)' }) })


/**
 * 建立重標之內建領域預設
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.vocab=null] 輸入詞彙表覆寫物件(見 resolveSummarizeVocab;亦可為其產物)，取 categories、fallbackCategory、categoryHints、kbLabel／domain
 * @param {Object} [opt.prompts] 輸入提示詞覆寫 { retag? }：函數 (items, o, ctx) => String，ctx 為 { kbLabel, domain, vocab,
 *   defaultPrompt:(items, o) => 內建提示詞 }，須回傳非空字串;未給用內建
 * @returns {Object} 回傳 domain 物件，含 vocab、buildPrompt(items, { focus })、isValidItem(it, count)
 * @throws {Error} opt.vocab 不合規格(見 resolveSummarizeVocab)、或 opt.prompts 不合規格(見 promptOverridesOf)時拋出
 * @example
 * let d = createRetagDomain({})
 * console.log(d.isValidItem({ index: 1, category: '其他' }, 1))
 * // => true
 */
export function createRetagDomain(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const vocab = resolveSummarizeVocab(opt.vocab)
    const custom = promptOverridesOf(opt.prompts, RETAG_PROMPT_SIGS, 'createRetagDomain')
    const kb = kbLabelOf(vocab)

    /**
     * 內建之單批重標提示詞
     *
     * @param {Array} items 輸入筆記陣列，各項含 title、category、summary、points(核心知識前三條)
     * @param {Object} [o={}] 輸入選項
     * @param {Object} [o.focus] 輸入本批之焦點 { reason:'add'|'retire'|'requeue', category }：新增類別／退役類別各加一句說明
     * @returns {String} 回傳提示詞字串
     */
    function builtinPrompt(items, o = {}) {
        if (!isarr(items)) items = []
        const f = isobj(o?.focus) ? o.focus : {}
        const hints = vocab.categoryHints?.[f.category] || []
        const focusLine = f.reason === 'add'
            ? `\n本次分類清單新增了「${f.category}」${hints.length ? `（相關關鍵詞：${hints.join('、')}）` : ''}：請判斷各篇是否更適合歸入「${f.category}」。` +
                `原類別為「${vocab.fallbackCategory}」者，依分類清單擇一最合適之類別；原類別為清單中其他類別者，只在「${f.category}」與原類別之間擇一（更適合「${f.category}」才改，否則寫原類別）。`
            : f.reason === 'retire'
                ? `\n「${f.category}」已自分類清單移除：各篇須改選分類清單中之類別。`
                : ''
        const blocks = items.map((n, i) => [
            `${i + 1}. 【${strTruncate(String(n.title || '（無標題）'), 120)}】（原類別：${n.category || '（無）'}）`,
            `   一句話重點：${strTruncate(String(n.summary || '（無）'), 300)}`,
            ...(isarr(n.points) && n.points.length ? [`   核心知識：${n.points.slice(0, 3).map((x) => strTruncate(String(x), 160)).join('；')}`] : []),
        ].join('\n')).join('\n')
        return `你是${kb}的分類器。以下 ${items.length} 篇知識筆記，請依分類清單為每篇擇一最合適之類別。
分類清單：${vocab.categories.join('、')}${focusLine}

要求：
1. 只能從分類清單擇一，照清單原字寫出。
2. 原類別仍是最合適者，請維持原類別（原類別不在清單者須改選）。
3. 「${vocab.fallbackCategory}」只給清單中確實沒有合適類別者。

只回覆 JSON 陣列，不要任何其他文字，格式：
[{"index":1,"category":"..."}]

${blocks}`
    }

    /**
     * 組單批重標提示詞 (items, o = { focus }) => String:有覆寫者交覆寫函數(opt.prompts.retag;收原參數＋ctx,回傳須為非空字串——抓取套件之 overridablePrompt),否則用內建
     */
    const buildPrompt = overridablePrompt(custom, 'retag', builtinPrompt, { ctxOf: (b) => promptCtxOf(vocab, kb, b), norm: (items, o = {}) => [isarr(items) ? items : [], isobj(o) ? o : {}] })

    /**
     * 判斷單一 AI 回傳項目是否可採用:index 為 1～count 之整數、category 照清單原字
     *
     * @param {Object} it 輸入 AI 回傳之單一項目
     * @param {Integer} count 輸入本批筆記數
     * @returns {Boolean} 回傳是否可採用
     */
    function isValidItem(it, count) {
        return !!it && typeof it === 'object' &&
            Number.isInteger(it.index) && it.index >= 1 && it.index <= count &&
            typeof it.category === 'string' && vocab.categories.includes(it.category)
    }

    return { vocab, buildPrompt, isValidItem }
}


export default createRetagDomain
