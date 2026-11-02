// noteDomain.mjs — 摘要(summarize)的內建領域預設:提示詞、驗證、品質標注、筆記版型
//
// 【套件開發者擁有、隨版本演進】摘要指令／欄位 schema／md 版型是內建能力(領域中立)。安裝方之覆寫有三層:①詞彙表(主題範圍 domain、
//   類別與標注清單、提示詞之領域句 guide.summarize／guide.faith 逐欄)②整個提示詞函數(opt.prompts 之 summarize、faith、repair;收原參數＋
//   末參數 ctx { kbLabel, domain, vocab, defaultPrompt },defaultPrompt 為內建提示詞函數,可包裝之)③整組 domain(組裝者之 cfg.domains)。
//   輸出欄位與格式說明、項目驗證(isValidItem)、品質標注正規化與 md 版型不隨提示詞覆寫改變(套件解析輸出之契約;覆寫者須依契約要求模型輸出,
//   否則其輸出會被驗證擋下)。
// 【版型逐字保真】md 版型與 JSON 欄位維持既有筆記之格式(含全形標點)——版型變動會讓新舊筆記格式分裂。
// 【regime_dependency 之稱呼與 md 章節名同為「時效與機制相依」】章節名綁定既有筆記(不可改);「機制」即 regime,不綁領域。
// 【提示詞之例句不綁領域】JSON 範例之內容類型與證據等級取自詞彙表(claimTypes 第一項;evidenceLevels 第二項,只有一級時取第一項);
//   忠實性判準 ③④ 之條件詞與誇大例取自 guide.faith(預設為中立句)。
// 【提示詞覆寫之共用件】promptOverridesOf(建構期驗證)與 overridablePrompt／promptCtxOf(呼叫期之分派、ctx 與回傳檢查)取抓取套件(各工作之 domain 工廠、執行期件與 cfg 層
//   同一份驗證與訊息);本檔只宣告可覆寫之鍵與其形式(NOTE_PROMPT_SIGS)。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import iseint from 'wsemi/src/iseint.mjs'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import { section } from '../core/md/md.mjs'
import { resolveSummarizeVocab, kbLabelOf } from '../core/vocab/summarizeVocab.mjs'
import { SUMMARIZE_DEFAULT } from '../core/summarizeSettings.mjs'
import { textFromLabelOf, promptOverridesOf, promptCtxOf, overridablePrompt, textValueOf, resolveLocale, DEFAULT_LANG } from '../core/capturePackage.mjs'
import { NOTE_FIELD_LABELS, fieldPlaceOf } from '../standards/noteRepair.mjs'
import { NOTE_PLACEHOLDERS, cleanStrList } from '../standards/noteNormalize.mjs'
import { CONCEPT_COUNT } from '../standards/noteStandards.mjs'
import { NOTE_SECTION_TITLES, NOTE_SOURCE_LABELS, NOTE_QUALITY_LABELS } from '../core/md/noteContent.mjs'
import { noteContractOf } from '../stores/noteBuild.mjs'

/** 字數類 opt 之判定範圍(wsemi iseint:1～4294967295 之整數或其十進位數字字串;Infinity、'0x10'、包裝物件等為非預期,改用預設) */
const COUNT_MIN1 = Object.freeze({ use: 'count', min: 1 })


/**
 * 清洗字串陣列欄位:非陣列視為空陣列,逐項轉字串修剪、去空值(不限量——上限由納入閘之正規化處置並記錄,見 normalizeQuality)
 *
 * @param {*} v 輸入待清洗值
 * @returns {Array} 回傳字串陣列
 */
function strArr(v) {
    // 只收字串與數字(物件元素以 String(x) 會落成 "[object Object]";攤平由納入閘之正規化先做,此處防線不造假字串)
    return (Array.isArray(v) ? v : []).map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x).trim() : '')).filter(Boolean)
}


/**
 * 摘要 domain 可覆寫之提示詞與覆寫函數之形式(唯一一份;抓取套件之提示詞覆寫之 SIGS 形狀——cfg 層、執行期件與本工廠同讀,摘要執行期件之
 *   SUMMARIZE_PROMPT_SIGS 由之組成):summarize＝摘要、faith＝忠實性覆核、repair＝欄位定向修補;末參數 ctx 為 { kbLabel, domain, vocab, defaultPrompt }
 *
 * @type {Object}
 */
export const NOTE_PROMPT_SIGS = Object.freeze({
    summarize: Object.freeze({ params: '(docs, conceptVocab, o, ctx)' }),
    faith: Object.freeze({ params: '(input, ctx)' }),
    repair: Object.freeze({ params: '(input, ctx)' }),
})


/**
 * 建立摘要之內建領域預設
 *
 * 回傳物件之全部函數皆可由組裝者整組置換(cfg.domains);提示詞可個別覆寫(opt.prompts)
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.vocab=null] 輸入詞彙表覆寫物件(見 resolveSummarizeVocab;亦可為其產物)，含 domain(主題範圍)、kbLabel、categories、
 *   evidenceLevels、guide.summarize／guide.faith(領域句)等，預設null代表全用內建
 * @param {Integer} [opt.summarizeCharsPerDoc=6000] 輸入每篇送入提示詞之內文字數上限正整數(1～4294967295 之整數或其十進位數字字串；Infinity、'0x10'、包裝物件、逾上限者等非預期值視為未給,改用預設)，預設6000(＝summarize.charsPerDoc 之預設,取自 SUMMARIZE_DEFAULT)
 * @param {Object} [opt.prompts] 輸入提示詞覆寫 { summarize?, faith?, repair? }：各為函數,收原參數＋末參數
 *   ctx { kbLabel, domain, vocab, defaultPrompt(內建提示詞函數,參數同原方法) }，須回傳非空字串;未給者用內建
 *   (summarize:(docs, conceptVocab, o, ctx)、faith:(input, ctx)、repair:(input, ctx))
 * @param {Object} [opt.limits] 輸入產物契約之欄位上限覆寫 { 欄位: { maxChars?, maxItems? } }(併入 contract.fields;預設不設上限——逾者由納入閘
 *   以「欄位 X 超過 N 字」不納入、附回饋重摘);鍵限 NOTE_CONTRACT_FIELDS 之欄位
 * @param {String|Object} [opt.locale='zh-TW'] 輸入語言設定(語言代碼或抓取套件 resolveLocale 之產物):提示詞之輸出語言句取其稱呼、字形句只在臺灣正體
 *   時要求繁體字形;產物之 slug 政策依之(domain.locale)。總組裝交其 cfg.lang;注入 domain 時須與 cfg.lang 同一語言
 * @returns {Object} 回傳 domain 物件，含 vocab、locale(語言設定)、buildPrompt(docs, conceptVocab, { budgets })、isValidItem(it, count)、normalizeQuality(k)、
 *   renderNoteBody(k, doc, q, { sourceChars, processedChars })、buildFaithCheckPrompt({ items })(SS14 覆核)、
 *   buildRepairPrompt({ material, item, problems })(欄位定向修補呼叫)、contract(產物契約:stores/noteBuild 之 noteContractOf)
 * @throws {Error} opt.vocab 不合規格(見 resolveSummarizeVocab)、opt.prompts 不合規格(見 promptOverridesOf)、opt.limits 或 opt.locale 不合規格時拋出
 * @example
 * let domain = createSummarizeDomain({ vocab: { domain: '機器學習' } })
 * let prompt = domain.buildPrompt([{ title: 'T', sourceName: 'S', url: 'https://e.com/a', text: '內文' }], [])
 * console.log(prompt.startsWith('你是「機器學習」知識庫的萃取器'))
 * // => true
 *
 * let d2 = createSummarizeDomain({ prompts: { summarize: (docs, conceptVocab, o, ctx) => `${ctx.defaultPrompt(docs, conceptVocab, o)}\n（附註）` } })
 * console.log(d2.buildPrompt([], []).endsWith('（附註）'))
 * // => true
 */
export function createSummarizeDomain(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    const vocab = resolveSummarizeVocab(opt.vocab)
    const custom = promptOverridesOf(opt.prompts, NOTE_PROMPT_SIGS, 'createSummarizeDomain')
    // 語言設定:輸出語言之稱呼 L(預設「繁體中文」,提示詞逐字不變);字形句只在臺灣正體之字形政策下要求繁體字形;翻譯句於預設語言逐字維持
    const locale = resolveLocale(opt.locale, 'createSummarizeDomain 之 opt.locale')
    const L = locale.label
    const twScript = locale.script.id === 'zh-Hant-TW'
    const translateNote = locale.code === DEFAULT_LANG ? '原文為英文時翻譯成繁體中文' : `原文為其他語言時翻譯成${L}`

    //charsPerDoc
    let charsPerDoc = opt.summarizeCharsPerDoc
    if (!iseint(charsPerDoc, COUNT_MIN1)) {
        charsPerDoc = SUMMARIZE_DEFAULT.charsPerDoc
    }
    charsPerDoc = Number(charsPerDoc)
    /** 逐篇字數上限:有效(同 summarizeCharsPerDoc 之取值範圍)依其值,否則用 charsPerDoc */
    const charsOf = (b) => (iseint(b, COUNT_MIN1) ? Number(b) : charsPerDoc)

    const kb = kbLabelOf(vocab)
    const g = vocab.guide.summarize // 領域句(安裝方可經 vocab.guide.summarize 逐欄覆寫;輸出欄位與格式留在本檔)
    const gf = vocab.guide.faith // 忠實性判準 ③④ 之領域措辭(vocab.guide.faith)
    // 證據等級擇一清單依 vocab.evidenceLevels 產生(提示詞要求之等級即 normalizeQuality 驗證所認之等級)
    const evidenceChoices = (isarr(vocab.evidenceLevels) ? vocab.evidenceLevels : []).map((lv) => (g.evidenceLevelDefs[lv] ? `${lv}（${g.evidenceLevelDefs[lv]}）` : lv)).join('／')
    // JSON 範例之內容類型與證據等級(檔頭【提示詞之例句不綁領域】;清單之非空由詞彙表解析保證)
    const exampleClaimType = vocab.claimTypes[0]
    const exampleLevel = vocab.evidenceLevels[Math.min(1, vocab.evidenceLevels.length - 1)]
    const quoted = (arr) => arr.map((x) => `「${x}」`).join('')
    /** 覆寫函數之末參數(抓取套件之 promptCtxOf;defaultPrompt＝該提示詞之內建函數) */
    const ctxOf = (defaultPrompt) => promptCtxOf(vocab, kb, defaultPrompt)

    /**
     * 內建之單批摘要提示詞
     *
     * @param {Array} docs 輸入本批文件陣列，各項需含 title、sourceName、url、text
     * @param {Array} [conceptVocab=[]] 輸入既有概念標籤陣列(名稱，依使用篇數降冪；conceptVocabulary 之預設產出)，令模型沿用既有寫法
     * @param {Object} [o={}] 輸入選項
     * @param {Array} [o.budgets] 輸入逐篇內文字數上限(與 docs 同序;有效者〔1～4294967295 之整數或其十進位數字字串〕取代 summarizeCharsPerDoc——摘要段依字數打包,
     *        長文獨佔一批時其預算為整批之字數)，未給或該項非預期(非正整數、Infinity、'0x10'、包裝物件、逾上限者等)即用 summarizeCharsPerDoc
     * @returns {String} 回傳提示詞字串
     */
    function builtinPrompt(docs, conceptVocab = [], o = {}) {
        if (!isarr(docs)) docs = []
        if (!isarr(conceptVocab)) conceptVocab = []
        const budgets = isarr(o?.budgets) ? o.budgets : []
        const blocks = docs.map((d, i) => [
            `--- 第${i + 1}篇 ---`,
            `標題：${d.title}`,
            `來源：${d.sourceName}`,
            `網址：${d.url}`,
            // 上次之輸出未達檢定標準者附回饋(只在該篇帶 stdFeedback 時出現;其餘篇之提示詞逐字不變——評分題目識別不受影響)
            ...(d.stdFeedback ? [`（上次之輸出未達標準：${String(d.stdFeedback).slice(0, 200)}——本次請依原文更正）`] : []),
            `內文：`,
            strTruncate(d.text, charsOf(budgets[i])),
        ].join('\n')).join('\n\n')

        return `你是${kb}的萃取器。請閱讀以下 ${docs.length} 篇資料，逐篇萃取${g.target}。

要求：
1. 先判斷該篇是否含有${g.relevance}（relevant）。下列一律 relevant 為 false：
   ${g.rejects}，
   以及「連結彙整、每週精選、文章清單」這類本身不含方法論、只是把別處文章列出來的匯流貼文。
   這類匯流貼文雖不成筆記，但它列出的題目很有價值，請務必在 explore 給出對應的關鍵字線索。
2. relevant 為 true 時，須以${L}萃取下列欄位；${translateNote}，專有名詞保留英文於括號內（concepts 除外，見第 4 條）。
3. 只寫原文確實提到的內容，不可自行補充原文沒有的數字、參數或結論。原文沒提到的欄位請給空陣列。
4. concepts 是用於跨篇關聯與提煉的概念標籤，${CONCEPT_COUNT.min} 到 ${CONCEPT_COUNT.max} 個，依與本篇之核心程度排序、第一個為本篇主概念，${twScript ? `**必須使用繁體字形（不可寫${quoted(g.simplifiedExamples)}這類簡體）**` : `**以${L}書寫**`}，${g.conceptExamples}。
   標籤要「可跨篇共用」：優先用該領域的通用概念名稱，不要用只有這一篇才成立的長描述或論文專屬模型名。每個標籤只寫一個概念之名稱本身：多個概念請分成多個標籤，不加括號說明、英文對照或「是否在清單中」之註記；名稱本身帶括號者（如階數、參數）照寫。${conceptVocab.length
        ? `
   下列是知識庫既有的概念標籤（依使用篇數由多到少排列）。若本篇的概念與其中某個語意相同，請「直接沿用既有寫法」，不要另創同義詞；清單外之概念直接寫名稱，不必註明：
   ${conceptVocab.join('、')}`
        : ''}
5. explore 是你從本篇看出「值得日後再深入抓取」的線索：type 為 keyword（關鍵字）、topic（主題）或 site（具體網站首頁網址）。site 只能填原文中確實出現過的網址，不可自行想像；沒有就不要給 site。每篇最多 4 項，只給真正值得追的，不要為湊數而列泛泛題目。
6. category 從此清單擇一：${vocab.categories.join('、')}。
7. 品質與證據標注（每篇必填，這是為了讓後續使用者看得到內容的可信度與邊界）：
   - claim_type 擇一：${vocab.claimTypes.join('／')}。
   - evidence_level 擇一：${evidenceChoices}；evidence_note 一句話說明判定依據。
   - caveats：內容品質問題（陣列，誠實列出，無則空）——例：${quoted(g.caveatExamples)}。
   - sample_period：原文數據樣本期間（如 "2015-2025"；未載明填「${NOTE_PLACEHOLDERS.samplePeriod}」）。
8. 多元觀點（原文有依據才寫，不可捏造）：
   - pros／cons：此方法或觀點的利與弊，各 0-4 條。
   - regime_dependency：時效與機制相依（0-3 條）——${g.regime}、何時失效、利弊在何種條件下反轉。
   - counter_views：原文提到的反方觀點、與主流相左的說法、或作者自己承認的爭議（0-3 條）。

只回覆 JSON 陣列，不要任何其他說明文字，格式：
[{"index":1,"relevant":true,"reason":"","title":"繁中標題","category":"${vocab.categories[0] || '其他'}","summary":"一句話重點","key_points":["..."],"parameters":[{"name":"參數名","value":"值或區間","note":"說明"}],"methods":["步驟或方法"],"conditions":["適用條件或限制"],"verifiable":["可驗證或可實作的要點"],"concepts":["概念1","概念2"],"claim_type":"${exampleClaimType}","evidence_level":"${exampleLevel}","evidence_note":"...","caveats":["..."],"sample_period":"...","pros":["..."],"cons":["..."],"regime_dependency":["..."],"counter_views":["..."],"explore":[{"type":"keyword","value":"...","why":"..."}]}]

${blocks}`
    }

    /**
     * 組單批摘要提示詞 (docs, conceptVocab = [], o = { budgets }) => String:有覆寫者交覆寫函數(opt.prompts.summarize;收原參數＋ctx,回傳須為非空字串——
     *   抓取套件之 overridablePrompt),否則用內建
     */
    const buildPrompt = overridablePrompt(custom, 'summarize', builtinPrompt, { ctxOf, norm: (docs, conceptVocab = [], o = {}) => [isarr(docs) ? docs : [], isarr(conceptVocab) ? conceptVocab : [], isobj(o) ? o : {}] })

    /**
     * 判斷單一 AI 回傳項目是否結構完整(可安全採用)
     *
     * 驗證與落地同一規則:index 須為整數(1.5 之項目取不到目標);key_points／concepts 以清洗後(cleanStrList:只收字串／數字、trim、濾空)
     * 之長度判非空——驗原始長度會讓 [' '] 或 [{}] 通過,落地成無概念筆記(永不分群)
     *
     * @param {Object} it 輸入 AI 回傳之單一項目
     * @param {Integer} count 輸入本批文件數(index 須介於 1～count)
     * @returns {Boolean} 回傳是否結構完整，relevant 為 true 者另須有 title、key_points 與 concepts
     */
    function isValidItem(it, count) {
        if (!it || typeof it !== 'object') return false
        if (!Number.isInteger(it.index) || it.index < 1 || it.index > count) return false
        if (typeof it.relevant !== 'boolean') return false
        if (it.relevant) {
            if (!String(it.title || '').trim()) return false
            if (cleanStrList(it.key_points).length === 0) return false
            if (cleanStrList(it.concepts).length === 0) return false
        }
        return true
    }

    /**
     * 正規化品質標注欄位(模型漏給時以缺值字樣 NOTE_PLACEHOLDERS 呈現,不讓標注缺席)。只清洗、不截斷:欄位上限由納入閘之正規化
     *   (standards/noteNormalize 之 NOTE_FIELD_LIMITS)處置並記修正說明(摘要與人工匯入皆先經 gateNoteItem 再落地)
     *
     * @param {Object} k 輸入 AI 回傳之單一項目
     * @returns {Object} 回傳品質標注物件，含 claimType、evidenceLevel、evidenceNote、caveats、samplePeriod、pros、cons、regime、counterViews
     */
    function normalizeQuality(k) {
        if (!isobj(k)) k = {}
        return {
            claimType: vocab.claimTypes.includes(k.claim_type) ? k.claim_type : NOTE_PLACEHOLDERS.claimType,
            evidenceLevel: vocab.evidenceLevels.includes(k.evidence_level) ? k.evidence_level : NOTE_PLACEHOLDERS.evidenceLevel,
            evidenceNote: String(k.evidence_note || '').trim(),
            caveats: strArr(k.caveats),
            samplePeriod: String(k.sample_period || '').trim() || NOTE_PLACEHOLDERS.samplePeriod,
            pros: strArr(k.pros),
            cons: strArr(k.cons),
            regime: strArr(k.regime_dependency),
            counterViews: strArr(k.counter_views),
        }
    }

    /**
     * 由結構化欄位組裝知識 md 本文(版型逐字同既有筆記;內文經截斷者於來源章多一行處理範圍)
     *
     * @param {Object} k 輸入 AI 回傳之單一項目(結構完整者)
     * @param {Object} doc 輸入來源文件記錄，需含 title、sourceName、url、publishedAt、textFrom
     * @param {Object} q 輸入 normalizeQuality 之產出
     * @param {Object} [meta={}] 輸入處理範圍 { sourceChars, processedChars }：processedChars 小於 sourceChars(摘要只讀了前段)時
     *        來源章加「內文處理範圍」一行——截斷明示(不得暴力裁剪而無從得知);未截斷者版型不變
     * @returns {String} 回傳 md 本文字串(不含 frontmatter)
     */
    function renderNoteBody(k, doc, q, meta = {}) {
        const src = Number(meta?.sourceChars) || 0
        const done = Number(meta?.processedChars) || 0
        const truncLine = src > 0 && done > 0 && done < src ? [`${NOTE_SOURCE_LABELS.processed}：原文 ${src} 字，摘要只讀前 ${done} 字`] : []
        // 表格儲存格一律轉義 |(名稱／值含 | 會撐破表格)
        const cell = (v) => String(v || '').trim().replace(/\|/g, '／')
        const paramTable = Array.isArray(k.parameters) && k.parameters.length
            ? ['| 參數 | 值／區間 | 說明 |', '| --- | --- | --- |',
                ...k.parameters.map((p) => `| ${cell(p?.name)} | ${cell(p?.value)} | ${cell(p?.note)} |`)].join('\n')
            : ''

        // 利弊分欄呈現(單一 section 混列會失去對照性)
        const prosCons = (q.pros.length || q.cons.length)
            ? [`## ${NOTE_SECTION_TITLES.prosCons}`, '',
                ...(q.pros.length ? ['**優勢／利**', '', ...q.pros.map((x) => `- ${x}`), ''] : []),
                ...(q.cons.length ? ['**侷限／弊**', '', ...q.cons.map((x) => `- ${x}`)] : [])].join('\n')
            : ''

        const T = NOTE_SECTION_TITLES
        const L = NOTE_SOURCE_LABELS
        const Q = NOTE_QUALITY_LABELS
        return [
            `# ${k.title}`,
            '',
            section(T.summary, k.summary),
            // 品質標注永遠存在(含缺值字樣):後續讀者一律先看到可信度邊界,再看內容
            section(T.quality, [
                `${Q.claimType}：${q.claimType}`,
                `${Q.evidenceLevel}：${q.evidenceLevel}${q.evidenceNote ? `（${q.evidenceNote}）` : ''}`,
                `${Q.samplePeriod}：${q.samplePeriod}`,
                ...(q.caveats.length ? q.caveats.map((c) => `⚠ ${c}`) : ['（未發現明顯品質問題）']),
            ]),
            section(T.keyPoints, cleanStrList(k.key_points)),
            paramTable ? `## ${T.parameters}\n\n${paramTable}` : '',
            section(T.methods, k.methods),
            section(T.conditions, k.conditions),
            prosCons,
            section(T.regime, q.regime),
            section(T.counterViews, q.counterViews),
            section(T.verifiable, k.verifiable),
            section(T.source, [
                `${L.originalTitle}：${doc.title || '（無）'}`,
                `${L.sourceName}：${doc.sourceName}`,
                `${L.url}：${doc.url}`,
                `${L.published}：${doc.publishedAt || '（未提供）'}`,
                // 內文取得方式之顯示名由抓取套件提供(textFrom 之值域屬抓取;本檔不自解讀)
                `${L.textFrom}：${textFromLabelOf(doc.textFrom)}`,
                ...truncLine,
            ]),
        ].filter(Boolean).join('\n\n')
    }

    /**
     * 內建之忠實性覆核提示詞(檢定標準 SS14;standards/faithCheck):每項一篇原文(送給摘要 AI 之材料)與依它萃取之筆記,
     *   判筆記是否忠實於原文;不確定為合法裁決。數字之紮根另由程式(SS4)核對。判準 ③④ 之領域措辭取 vocab.guide.faith。
     *
     * @param {Object} input 輸入 { items:[{ index, title, material(原文標題＋送出之內文), noteText(faithNoteText) }] }
     * @returns {String} 回傳提示詞字串
     */
    function builtinFaithPrompt(input) {
        const items = (Array.isArray(input?.items) ? input.items : []).map((it) => `--- 第${it.index}項 ---\n【原文】\n${String(it.material ?? '').trim()}\n\n【筆記】\n${String(it.noteText ?? '').trim()}`).join('\n\n')
        return `你是${kb}的忠實性核對員。下列每一項是一篇原文，以及依它萃取之筆記。請逐項判斷：筆記是否忠實於原文。

判準：
- faithful：筆記之結論、方向與比較、條件與限制、證據等級皆與原文相符；省略細節、改寫措辭、翻譯成${L}不算不忠實。
- unfaithful：有下列任一者——①筆記有原文沒有之結論或主張；②否定、方向或比較翻錯（如原文「不顯著」寫成「顯著」、「低於」寫成「高於」）；③原文只在${gf.scope}下成立之結論，筆記寫成普遍成立；④證據等級或其說明誇大原文（如${gf.overclaim}）。數字是否見於原文另有程式核對，不必逐一比對數字。
- unsure：原文不足以判斷（如原文過短、被截斷而無從核對）；拿不準就回 unsure，不要猜。
reason 用${L}一句話（至少十個字）：unfaithful 須指出筆記哪一欄與原文哪一處不符。

只回覆一個 JSON 物件，每項一個裁決，以項之編號對應，不要任何其他說明文字，格式：
{"checks":[{"index":1,"verdict":"faithful","reason":"..."},{"index":2,"verdict":"unfaithful","reason":"..."}]}

${items}`
    }

    /** 忠實性覆核之提示詞 (input:{ items }) => String:有覆寫者交覆寫函數(opt.prompts.faith;收原參數＋ctx,回傳須為非空字串),否則用內建(見 builtinFaithPrompt) */
    const buildFaithCheckPrompt = overridablePrompt(custom, 'faith', builtinFaithPrompt, { ctxOf })

    /**
     * 修補提示詞所附之筆記(逐欄;清單與參數列編號,與「需更正之處」之「第 N 行／列／個」同一編號)
     *
     * @param {Object} k 輸入正規化後之項目
     * @returns {String} 回傳逐欄文字
     */
    function repairNoteText(k) {
        const L = NOTE_FIELD_LABELS
        const lines = []
        const one = (f) => {
            if (textValueOf(k[f])) lines.push(`${L[f]}：${textValueOf(k[f])}`)
        }
        const list = (f, xs, unit = '') => {
            const ys = (Array.isArray(xs) ? xs : []).map((x, i) => `${i + 1}. ${x}`)
            if (ys.length) lines.push(`${L[f]}${unit}：`, ...ys)
        }
        one('title')
        one('summary')
        one('claim_type')
        one('evidence_level')
        one('evidence_note')
        one('sample_period')
        for (const f of ['key_points', 'methods', 'conditions', 'verifiable', 'pros', 'cons', 'regime_dependency', 'counter_views', 'caveats']) list(f, k[f])
        list('parameters', (Array.isArray(k.parameters) ? k.parameters : []).map((p) => `名稱「${textValueOf(p?.name)}」、值「${textValueOf(p?.value)}」、說明「${textValueOf(p?.note)}」`), '（逐列）')
        list('concepts', k.concepts)
        return lines.join('\n')
    }

    /**
     * 內建之欄位定向修補呼叫提示詞(檢定標準 SS2／SS4「先修正、修不了才不納入」;standards/noteRepair;summarize.standards.repair.enabled):
     *   只要求更正被指出之行／欄位、一律依原文、不得加入原文沒有之內容、改不成可刪該處(清單之一行、參數之一列、概念之一個);回覆以編號對應、
     *   呼叫端只取被指出之編號套回後以同一納入閘重判。value 之形狀與套用端(standards/noteRepair 之 applyRepairs)逐類一致:
     *   概念之一個(kind concept)給字串、概念整欄(kind concepts)給字串陣列——曾一律寫「概念給字串陣列」,單一概念之更正因形狀不合全數不採
     *
     * @param {Object} input 輸入 { material(送出之原文:原文標題＋送出之內文), item(正規化後之項目), problems:[{ field, kind, index, line, detail }] }
     * @returns {String} 回傳提示詞字串
     */
    function builtinRepairPrompt(input) {
        const k = isobj(input?.item) ? input.item : {}
        const ps = isarr(input?.problems) ? input.problems : []
        const probs = ps.map((p, i) => `${i + 1}. ${fieldPlaceOf(p)}：${String(p.line ?? '').trim() ? `「${String(p.line).trim()}」` : '（空白）'}——${p.detail}`).join('\n')
        return `你是${kb}的萃取器。下列【筆記】是先前依【原文】萃取的結果，其中【需更正之處】所列各處未達檢定標準。請只更正這些地方；未列出之內容不在本次範圍，不必回覆。

規則：
1. 一律依原文：只能寫原文確實提到的內容與數字，不可加入原文沒有之數字、參數或結論。
2. 數字與原文不符者，改為原文之數字；原文沒有對應之數字者，改寫為不含該數字之敘述。
3. 清單之一行、參數表之一列或概念之一個無法依原文更正者，可刪除（value 給 null）；標題與一句話重點不可刪除。
4. 內容類型擇一：${vocab.claimTypes.join('／')}；證據等級擇一：${evidenceChoices}。
5. 概念為 ${CONCEPT_COUNT.min} 到 ${CONCEPT_COUNT.max} 個標籤，每個標籤只寫一個概念之名稱本身，${twScript ? '**必須使用繁體字形**' : `**以${L}書寫**`}。
6. 以${L}書寫。

【需更正之處】
${probs}

【筆記】
${repairNoteText(k)}

【原文】
${String(input?.material ?? '').trim()}

只回覆一個 JSON 物件，不要任何其他說明文字，每處一筆、以編號對應，格式：
{"repairs":[{"no":1,"value":"更正後之文字"},{"no":2,"value":null}]}
value 之形狀：標題、一句話重點、數據樣本期間、證據說明、內容類型、證據等級、清單之一行與概念之一個（標「第 N 個」者）給字串；概念整欄（只寫「概念」而未標第幾個者）給字串陣列；參數之一列給 {"name":"…","value":"…","note":"…"}；刪除給 null。`
    }

    /** 欄位定向修補呼叫之提示詞 (input:{ material, item, problems }) => String:有覆寫者交覆寫函數(opt.prompts.repair;收原參數＋ctx,回傳須為非空字串),否則用內建(見 builtinRepairPrompt) */
    const buildRepairPrompt = overridablePrompt(custom, 'repair', builtinRepairPrompt, { ctxOf })

    const domain = { vocab, locale, buildPrompt, isValidItem, normalizeQuality, renderNoteBody, buildFaithCheckPrompt, buildRepairPrompt }
    // 產物契約(stores/noteBuild 之內建 note 契約:欄位、組裝、適用之標準;opt.limits 併入欄位上限)
    domain.contract = noteContractOf(domain, { limits: opt.limits })
    return domain
}


export default createSummarizeDomain
