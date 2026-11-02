// triageDomain.mjs — 預篩(triage)的內建領域預設:以標題＋開頭片段判「可能含可長期複用之知識否」
//
// 【為何要預篩】摘要一次呼叫讀數篇全文(每篇數千字),而實際運行之摘要呼叫常有過半判為非知識——AI 容量多被純新聞／公告／廣告耗掉。
//   預篩一次呼叫看 20 篇之標題＋開頭片段(約摘要 1/10 成本),把明確無關者在進摘要前攔下;摘要只讀放行者。同樣的 AI 預算下可判定的
//   文件數約 2 倍以上。
// 【寧可多放行】預篩只做「明確無關」的否決,拿不準一律放行——摘要仍會嚴格判定 relevant;誤攔的代價(知識漏失)遠大於多放行的代價
//   (多一次摘要)。攔下者狀態 skip、skipReason 帶「預篩：」,記錄保留可稽核;預篩本身失敗達上限者放行交摘要(fail-open),
//   不得因預篩壞了擋住整條線。
// 【判準是「有無可複用之方法論」,不是「主題像不像」】主題相符但無方法論之內容(即時快訊、評論、公告、產品新聞)正是摘要判掉的大宗;
//   判準逐類列舉「無方法元素者」才對得上摘要的尺。主題範圍由 vocab.domain 注入(空＝不限主題);判斷對象、判準提示、方法元素、
//   排除與放行清單、預設攔下理由為 vocab.guide.triage 欄位(預設＝中立句),安裝方可逐字填回自己調校過的措辭;
//   整個提示詞亦可經 opt.prompts.triage 覆寫(輸出格式與驗證不變)。
// 【長文另附中段】正文逾 longDocChars(預設 6,000;組裝者傳 summarize.charsPerDoc)者,片段＝開頭＋中段各 triageCharsPerDoc 字:
//   長文開頭常是導言／目錄／導覽,方法論在後段——只看開頭之判定會把長文大量誤攔。短文之提示詞逐字不變。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import iseint from 'wsemi/src/iseint.mjs'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import { resolveSummarizeVocab, kbLabelOf } from '../core/vocab/summarizeVocab.mjs'
import { SUMMARIZE_DEFAULT } from '../core/summarizeSettings.mjs'
import { promptOverridesOf, promptCtxOf, overridablePrompt, resolveLocale } from '../core/capturePackage.mjs'

/** 字數類 opt 之判定範圍(wsemi iseint:1～4294967295 之整數或其十進位數字字串;Infinity、'0x10'、包裝物件等為非預期,改用預設) */
const COUNT_MIN1 = Object.freeze({ use: 'count', min: 1 })

/**
 * 預篩 domain 可覆寫之提示詞與覆寫函數之形式(唯一一份;抓取套件之提示詞覆寫之 SIGS 形狀——cfg 層、執行期件與本工廠同讀,摘要執行期件之
 *   SUMMARIZE_PROMPT_SIGS 由之組成):triage＝預篩之提示詞;末參數 ctx 為 { kbLabel, domain, vocab, defaultPrompt }
 *
 * @type {Object}
 */
export const TRIAGE_PROMPT_SIGS = Object.freeze({ triage: Object.freeze({ params: '(docs, ctx)' }) })


/**
 * 建立預篩之內建領域預設
 *
 * 回傳物件之全部函數皆可由組裝者整組置換(cfg.domains);提示詞可個別覆寫(opt.prompts.triage)
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.vocab=null] 輸入詞彙表覆寫物件(見 resolveSummarizeVocab;亦可為其產物)，含 domain(主題範圍)、kbLabel、categories、
 *   guide.triage(領域句)等，預設null代表全用內建
 * @param {Integer} [opt.triageCharsPerDoc=400] 輸入每篇給模型之開頭片段字數正整數(1～4294967295 之整數或其十進位數字字串；Infinity、'0x10'、包裝物件、逾上限者等非預期值視為未給,改用預設)，預設400(＝summarize.triage.charsPerDoc 之預設,取自 SUMMARIZE_DEFAULT)
 * @param {Integer} [opt.longDocChars=6000] 輸入長文門檻正整數(取值範圍與非預期之處置同 triageCharsPerDoc)：正文(壓平空白後)逾此字數者另附中段 triageCharsPerDoc 字，預設6000(＝summarize.charsPerDoc 之預設,取自 SUMMARIZE_DEFAULT)
 * @param {Object} [opt.prompts] 輸入提示詞覆寫 { triage? }：函數 (docs, ctx) => String，ctx 為 { kbLabel, domain, vocab,
 *   defaultPrompt:(docs) => 內建提示詞 }，須回傳非空字串;未給用內建
 * @param {String|Object} [opt.locale='zh-TW'] 輸入語言設定(語言代碼或抓取套件 resolveLocale 之產物;理由之語言句取其稱呼)
 * @returns {Object} 回傳 domain 物件，含 vocab、buildPrompt(docs)、isValidItem(it, count)、reasonOf(it)
 * @throws {Error} opt.vocab 不合規格(見 resolveSummarizeVocab)、opt.prompts 不合規格(見 promptOverridesOf)、或 opt.locale 不合時拋出
 * @example
 * let domain = createTriageDomain({ vocab: { domain: '機器學習' } })
 * let prompt = domain.buildPrompt([{ title: 'T', sourceName: 'S', text: '開頭片段' }])
 * console.log(prompt.startsWith('你是「機器學習」知識庫的預篩器'))
 * // => true
 */
export function createTriageDomain(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const vocab = resolveSummarizeVocab(opt.vocab)
    const custom = promptOverridesOf(opt.prompts, TRIAGE_PROMPT_SIGS, 'createTriageDomain')
    const L = resolveLocale(opt.locale, 'createTriageDomain 之 opt.locale').label // 輸出語言之稱呼(預設「繁體中文」,提示詞逐字不變)

    //chars
    let chars = opt.triageCharsPerDoc
    if (!iseint(chars, COUNT_MIN1)) {
        chars = SUMMARIZE_DEFAULT.triage.charsPerDoc
    }
    chars = Number(chars)

    //longChars
    let longChars = opt.longDocChars
    if (!iseint(longChars, COUNT_MIN1)) {
        longChars = SUMMARIZE_DEFAULT.charsPerDoc
    }
    longChars = Number(longChars)

    const kb = kbLabelOf(vocab)
    const g = vocab.guide.triage // 領域句(安裝方可經 vocab.guide.triage 逐欄覆寫;輸出格式與驗證留在本檔)

    /**
     * 本篇片段:開頭 chars 字;長文(逾 longChars)另附中段 chars 字(檔頭【長文另附中段】)
     *
     * @param {String} snippet 輸入壓平空白後之正文
     * @returns {String} 回傳片段字串
     */
    function snippetOf(snippet) {
        if (!snippet) return '（無內文片段）'
        if (snippet.length <= longChars) return strTruncate(snippet, chars)
        const from = Math.max(chars, Math.floor(snippet.length / 2) - Math.floor(chars / 2))
        return `${strTruncate(snippet, chars)}（中段）${strTruncate(snippet.slice(from), chars)}`
    }

    /**
     * 內建之單批預篩提示詞(只給標題、來源與開頭片段;長文另附中段)
     *
     * @param {Array} docs 輸入本批文件陣列，各項可含 title、sourceName、text 或 feedText
     * @returns {String} 回傳提示詞字串
     */
    function builtinPrompt(docs) {
        if (!isarr(docs)) docs = []
        const blocks = docs.map((d, i) => {
            const snippet = String(d.text || d.feedText || '').replace(/\s+/g, ' ').trim()
            return `${i + 1}. 【${strTruncate(String(d.title || '（無標題）'), 120)}】（${d.sourceName || '未知來源'}）${snippetOf(snippet)}`
        }).join('\n')

        const scopeLine = g.scopeLine ? `\n${g.scopeLine}` : ''
        const rejects = g.rejects.map((x) => `   - ${x}`).join('\n')
        return `你是${kb}的預篩器。以下 ${docs.length} 篇只給標題、來源與開頭片段，請逐篇判斷${g.question}。${scopeLine}

判準（**${g.criterionNote}**，判的是後者）：
0. 先看片段裡有沒有${g.elements}。
   **只要有，即使它包在一篇新聞報導或評論裡，也判 true**；沒有才往下看第 1 條。
1. ${g.rejectIntro}：
${rejects}
2. 下列判 true：${g.accepts}。
3. 片段太短、被付費牆截斷、或確實看不出屬於哪一邊者判 true（後續萃取會再嚴格判定——預篩只負責
   攔掉一望即知的雜訊，**寧可多放行**；攔過頭會讓萃取吃不飽而整體產出下降，實測放行率
   低於兩成即屬過嚴）。
4. 類別參考：${vocab.categories.join('、')}。
5. reason 用${L}十字以內。

只回覆 JSON 陣列，不要任何其他文字，格式：
[{"index":1,"relevant":true,"reason":"..."}]

${blocks}`
    }

    /**
     * 組單批預篩提示詞 (docs) => String:有覆寫者交覆寫函數(opt.prompts.triage;收原參數＋ctx,回傳須為非空字串——抓取套件之 overridablePrompt),否則用內建
     */
    const buildPrompt = overridablePrompt(custom, 'triage', builtinPrompt, { ctxOf: (b) => promptCtxOf(vocab, kb, b), norm: (docs) => [isarr(docs) ? docs : []] })

    /**
     * 判斷單一 AI 回傳項目是否結構完整
     *
     * @param {Object} it 輸入 AI 回傳之單一項目
     * @param {Integer} count 輸入本批文件數(index 須為 1～count 之整數)
     * @returns {Boolean} 回傳是否結構完整
     */
    function isValidItem(it, count) {
        return !!it && typeof it === 'object' &&
      Number.isInteger(it.index) && it.index >= 1 && it.index <= count &&
      typeof it.relevant === 'boolean'
    }

    /**
     * 取攔下理由(供 skipReason;模型漏給時給預設)
     *
     * @param {Object} it 輸入 AI 回傳之單一項目
     * @returns {String} 回傳理由字串(壓平空白、限 60 字)，無理由時為預設說明
     */
    function reasonOf(it) {
        return String(it?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 60) || g.fallbackReason
    }

    return { vocab, buildPrompt, isValidItem, reasonOf }
}


export default createTriageDomain
