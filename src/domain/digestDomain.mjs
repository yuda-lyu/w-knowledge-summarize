// digestDomain.mjs — 速報(digest)之內建中立 domain:每篇一句話摘要 short 與段落摘要 long;不落 md、記錄之欄位自定
//
// 【為何有它】摘要套件之產物契約(stores/noteBuild 檔頭【產物契約】)讓宿主以自己的產物形狀用本套件之機制(選池、批次 AI、納入閘、既有產物不覆寫、
//   文件終態與回鏈);本 domain 是契約之第二實例——零件庫用法(如每日速報)之示範,也是契約測試之對照:內建 note 契約與它走同一條子階段。
// 【只做契約所需】提示詞中立(不綁領域;主題範圍由 vocab.domain 給)、isValidItem 驗結構、contract 之 fields 驗長度(上限×容差;逾者不納入、附回饋
//   重摘)、buildNote 組記錄(不落 md,text 供標準讀)、standards 列可於 text 判之標準(SS3 正體、SS4 數字紮根)。無修補與忠實性覆核之提示詞
//   (開啟該二功能即於建構期拋錯——功能表之單一判定)。
// 【提示詞覆寫】opt.prompts.digest(docs, o, ctx)(ctx { kbLabel, domain, vocab, defaultPrompt });輸出欄位與格式段為契約,覆寫者須依之要求模型輸出。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import cint from 'wsemi/src/cint.mjs'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import { resolveSummarizeVocab, kbLabelOf } from '../core/vocab/summarizeVocab.mjs'
import { SUMMARIZE_DEFAULT } from '../core/summarizeSettings.mjs'
import { promptOverridesOf, promptCtxOf, overridablePrompt, checkKeys, resolveLocale } from '../core/capturePackage.mjs'
import { NOTE_CONTRACT_STANDARDS } from '../stores/noteBuild.mjs'

/**
 * 速報 domain 可覆寫之提示詞與覆寫函數之形式:digest＝單批速報;末參數 ctx 為 { kbLabel, domain, vocab, defaultPrompt }
 *
 * @type {Object}
 */
export const DIGEST_PROMPT_SIGS = Object.freeze({ digest: Object.freeze({ params: '(docs, o, ctx)' }) })

/**
 * 速報之預設:一句話摘要上限 60 字、段落摘要上限 200 字、納入閘之容差 1.5 倍(提示詞要求之上限×容差為不納入之門檻)、適用之標準 SS3／SS4
 *
 * @type {Object}
 */
export const DIGEST_DEFAULT = Object.freeze({ shortMax: 60, longMax: 200, tolerance: 1.5, standards: Object.freeze(['SS3', 'SS4']) })

/** createDigestDomain 之可用鍵 */
const OPT_KEYS = Object.freeze(['vocab', 'shortMax', 'longMax', 'tolerance', 'standards', 'prompts', 'summarizeCharsPerDoc', 'locale'])

/**
 * 建立速報 domain(產物契約 kind 'digest')
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.vocab=null] 輸入詞彙表覆寫(見 resolveSummarizeVocab;取 domain 主題範圍與 kbLabel 稱呼)，預設null代表全用內建
 * @param {Integer} [opt.shortMax=60] 輸入一句話摘要之字數上限(提示詞所載)
 * @param {Integer} [opt.longMax=200] 輸入段落摘要之字數上限(提示詞所載)
 * @param {Number} [opt.tolerance=1.5] 輸入納入閘之容差(≥1;上限×容差為不納入之門檻,模型略逾提示詞之上限不整篇重摘)
 * @param {Array} [opt.standards=['SS3','SS4']] 輸入落地前以筆記標準判之子集(無 md:只能列可於 text 判者——SS3、SS4)
 * @param {Object} [opt.prompts] 輸入提示詞覆寫 { digest? }(函數形式見 DIGEST_PROMPT_SIGS)
 * @param {Integer} [opt.summarizeCharsPerDoc=6000] 輸入每篇送入提示詞之內文字數上限(未給 budgets 時;預設取 SUMMARIZE_DEFAULT.charsPerDoc)
 * @param {String|Object} [opt.locale='zh-TW'] 輸入語言設定(語言代碼或抓取套件 resolveLocale 之產物;書寫語言句取其稱呼)
 * @returns {Object} 回傳 domain 物件 { vocab, locale, buildPrompt(docs, conceptVocab, { budgets }), isValidItem(it, count), skipReasonOf(it), contract }
 * @throws {Error} opt 含不認得之鍵、vocab／prompts／locale 不合規格、shortMax／longMax 非正整數、tolerance 非 ≥1 之數、standards 不合時拋出
 * @example
 * let d = createDigestDomain({ vocab: { domain: '天文學' } })
 * console.log(d.contract.kind, d.contract.fields.short.maxChars, d.isValidItem({ index: 1, relevant: true, short: '一句', long: '一段' }, 1))
 * // => digest 90 true
 */
export function createDigestDomain(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }
    checkKeys(opt, OPT_KEYS, 'createDigestDomain 之 opt')

    const vocab = resolveSummarizeVocab(opt.vocab)
    const custom = promptOverridesOf(opt.prompts, DIGEST_PROMPT_SIGS, 'createDigestDomain')
    const shortMax = opt.shortMax === undefined ? DIGEST_DEFAULT.shortMax : opt.shortMax
    const longMax = opt.longMax === undefined ? DIGEST_DEFAULT.longMax : opt.longMax
    const tolerance = opt.tolerance === undefined ? DIGEST_DEFAULT.tolerance : opt.tolerance
    if (!ispint(shortMax) || !ispint(longMax)) throw new Error('createDigestDomain 之 shortMax／longMax 須為正整數')
    if (!(typeof tolerance === 'number' && Number.isFinite(tolerance) && tolerance >= 1)) throw new Error('createDigestDomain 之 tolerance 須為 ≥1 之數')
    const standards = opt.standards === undefined ? DIGEST_DEFAULT.standards : opt.standards
    if (!isarr(standards) || !standards.every((id) => NOTE_CONTRACT_STANDARDS.includes(id))) throw new Error(`createDigestDomain 之 standards 須為標準 id 之陣列（可用：${NOTE_CONTRACT_STANDARDS.join('、')}）`)
    let charsPerDoc = opt.summarizeCharsPerDoc
    if (!ispint(charsPerDoc)) charsPerDoc = SUMMARIZE_DEFAULT.charsPerDoc
    charsPerDoc = cint(charsPerDoc)

    const kb = kbLabelOf(vocab)
    const locale = resolveLocale(opt.locale, 'createDigestDomain 之 opt.locale')
    const L = locale.label
    const scope = vocab.domain ? `本知識庫之主題範圍為「${vocab.domain}」，摘要時以與之相關之內容為主。` : ''

    /**
     * 內建之單批速報提示詞
     *
     * @param {Array} docs 輸入本批文件陣列(title、sourceName、url、text)
     * @param {Object} [o={}] 輸入 { budgets }(逐篇內文字數上限,與 docs 同序)
     * @returns {String} 回傳提示詞字串
     */
    function builtinPrompt(docs, o = {}) {
        if (!isarr(docs)) docs = []
        const budgets = isarr(o?.budgets) ? o.budgets : []
        const blocks = docs.map((d, i) => [
            `--- 第${i + 1}篇 ---`,
            `標題：${d.title}`,
            `來源：${d.sourceName}`,
            `網址：${d.url}`,
            ...(d.stdFeedback ? [`（上次之輸出未達標準：${String(d.stdFeedback).slice(0, 200)}——本次請依原文更正）`] : []),
            '內文：',
            strTruncate(d.text, ispint(budgets[i]) ? cint(budgets[i]) : charsPerDoc),
        ].join('\n')).join('\n\n')
        return `你是${kb}的速報撰寫員。請閱讀以下 ${docs.length} 篇資料，逐篇寫出摘要。

要求：
1. 先判斷該篇是否為可摘要之文章內容（relevant）：素材為亂碼、未載入、只有導覽列或付費牆提示者 relevant 為 false，並在 reason 說明；其餘一律 true。
2. relevant 為 true 時：short 為一句話摘要（至多 ${shortMax} 字），long 為段落摘要（至多 ${longMax} 字，可分一到三句）。${scope ? `\n   ${scope}` : ''}
3. 只寫原文確實提到的內容，不可自行補充原文沒有的數字、人名或結論。
4. 以${L}書寫；原文為其他語言時翻譯成${L}，專有名詞可保留原文於括號內。

只回覆 JSON 陣列，不要任何其他說明文字，格式：
[{"index":1,"relevant":true,"reason":"","short":"一句話摘要","long":"段落摘要"}]

${blocks}`
    }

    /** 速報提示詞 (docs, o) => String:有覆寫者交覆寫函數(opt.prompts.digest;收原參數＋ctx,回傳須為非空字串——抓取套件之 overridablePrompt),否則用內建 */
    const digestPrompt = overridablePrompt(custom, 'digest', builtinPrompt, { ctxOf: (b) => promptCtxOf(vocab, kb, b), norm: (docs, o = {}) => [isarr(docs) ? docs : [], isobj(o) ? o : {}] })

    /**
     * 組單批提示詞(與 note domain 同形:conceptVocab 不用)
     *
     * @param {Array} docs 輸入本批文件陣列
     * @param {Array} [conceptVocab=[]] 輸入既有概念標籤(速報不用;與摘要子階段之呼叫同形)
     * @param {Object} [o={}] 輸入 { budgets }
     * @returns {String} 回傳提示詞字串
     * @throws {Error} 覆寫函數未回傳非空字串時拋出
     */
    function buildPrompt(docs, conceptVocab = [], o = {}) {
        return digestPrompt(docs, o)
    }

    /**
     * 單一項目之結構驗證:index 為批內整數、relevant 布林;relevant 者 short 與 long 為非空字串
     *
     * @param {Object} it 輸入 AI 回傳之單一項目
     * @param {Integer} count 輸入本批文件數
     * @returns {Boolean} 回傳是否結構完整
     */
    function isValidItem(it, count) {
        if (!isobj(it)) return false
        if (!Number.isInteger(it.index) || it.index < 1 || it.index > count) return false
        if (typeof it.relevant !== 'boolean') return false
        if (it.relevant && !(typeof it.short === 'string' && it.short.trim() && typeof it.long === 'string' && it.long.trim())) return false
        return true
    }

    const fields = Object.freeze({
        short: Object.freeze({ required: true, type: 'string', maxChars: Math.round(shortMax * tolerance) }),
        long: Object.freeze({ required: true, type: 'string', maxChars: Math.round(longMax * tolerance) }),
        reason: Object.freeze({ type: 'string' }),
    })

    /**
     * 產物契約(stores/noteBuild 檔頭):記錄 { id:'digest-<文件 id>', docId, title, short, long, sourceUrl, sourceName, publishedAt, createdAt };不落 md;
     *   text＝short＋long(供 SS3／SS4 讀)
     */
    const contract = Object.freeze({
        kind: 'digest',
        fields,
        buildNote: (it, doc, c = {}) => {
            const short = String(it?.short ?? '').trim()
            const long = String(it?.long ?? '').trim()
            const chars = isobj(c?.chars) && c.chars.sourceChars ? { sourceChars: c.chars.sourceChars, processedChars: c.chars.processedChars } : {}
            return {
                record: { id: `digest-${doc.id}`, docId: doc.id, title: String(doc.title || ''), short, long, sourceUrl: String(doc.url || ''), sourceName: String(doc.sourceName || ''), publishedAt: String(doc.publishedAt || ''), ...chars, createdAt: String(c?.nowIso || '') },
                md: null,
                text: `${short}\n${long}`,
            }
        },
        standards: Object.freeze([...standards]),
    })

    return { vocab, locale, buildPrompt, isValidItem, skipReasonOf: (it) => String(it?.reason || ''), contract }
}

export default createDigestDomain
