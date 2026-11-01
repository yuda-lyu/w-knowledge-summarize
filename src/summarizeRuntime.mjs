// summarizeRuntime.mjs — 摘要執行期件之組裝(唯一一份):本套件之總組裝 createKnowledgeSummarize 與他總組裝(多工作之知識套件)共用,
//   呼叫端不另組任何摘要件
//
// 【組裝之件】資料檢核(cfg.data 之 vocab)、詞彙解析、概念鍵之折疊(與抓取套件同一單例、同一規則)、素材問題樣式於建構期編譯、
//   預篩／摘要／重標之 domain(內建三工廠＋提示詞覆寫 → 與 opt.domains 合併)、啟用之功能所需之 domain 成員與判定小組席位之啟動期檢核、
//   去重身分(與抓取同一身分)、本機網路判斷(交 AI 調度層之 isNetDown)。資料之解析、折疊之套用、提示詞覆寫之驗證與其和注入 domain 之衝突、
//   domain 之合併取抓取套件之共用件(各工作之執行期件同一份)。
// 【為何獨立】總組裝各自逐段同型實作時,任一側新增 domain 成員、檢核條件或依賴,另一側即漂移;他總組裝以本函數組出同一組摘要件。
// 【呼叫端負責】cfg 之鍵集檢核(含 cfg.data、cfg.prompts 之鍵)、設定解析(resolveSummarizeSettings 或同形之設定)、AI 調度層、
//   集合之開關與每輪管線——摘要以外之件不在此。
// 【生效之 domain 只有一份】回傳之 domains 即每輪依賴之 deps.domains 與總組裝之 info().domains:管線與維運工具(人工匯入、評分)用同一套
//   提示詞;子階段 opt.domain 仍可另給(屬自組)。提示詞覆寫(opt.prompts)作用於內建 domain;注入整組 domain(opt.domains)者即不經
//   提示詞覆寫——兩者給在同一 domain 即拋(其一會靜默失效)。
// 【domain 之注入只經 opt.domains】本函數不讀 cfg.domains:獨立總組裝把其 cfg.domains 交 opt.domains;他總組裝交其 cfg.domains 中屬本套件之子集
//   (SUMMARIZE_DOMAIN_KEYS;無注入時不給或給 {})——他工作之 domain 不會被誤認。
// 【提示詞覆寫之形式唯一來源為各 domain 檔】SUMMARIZE_PROMPT_SIGS 由三個 domain 檔之 SIGS 組成,各鍵所屬之 domain 由組成之來源推導。
// 【設定錯誤一律啟動期拋錯】修補／忠實性覆核開啟而 domain 缺對應之提示詞、判定小組開啟而缺必填席位、注入之 domain 缺成員或其詞彙表
//   未經本套件解析(納入閘與證據規則只收本套件解析後之詞彙,不在此擋即於每批驗證時拋錯而燒掉 AI 呼叫)、素材問題樣式無法編譯——
//   皆在建構期拋,不等到第一輪才爆。
// 【概念鍵之折疊為模組級單例】本函數以 cfg.conceptFold 之決定與詞彙表之概念改名／別名設定抓取套件之折疊(線索鍵與概念分群鍵);
//   同行程多個實例以最後建構者為準。

import isobj from 'wsemi/src/isobj.mjs'
import {
    applyConceptFold, captureIdentityOf, captureNetGuardOf, promptOverridesOf, promptDomainConflicts, promptDomainOf, promptsForDomain, mergeDomains, resolveDataCfg, resolveLocale,
} from './core/capturePackage.mjs'
import { resolveSummarizeVocab, summarizeVocabProblem } from './core/vocab/summarizeVocab.mjs'
import { SUMMARIZE_FEATURES, summarizeFeatureProblems } from './core/summarizeSettings.mjs'
import { createTriageDomain, TRIAGE_PROMPT_SIGS } from './domain/triageDomain.mjs'
import { createSummarizeDomain, NOTE_PROMPT_SIGS } from './domain/noteDomain.mjs'
import { createRetagDomain, RETAG_PROMPT_SIGS } from './domain/retagDomain.mjs'
import { createMaterialPolicy } from './stores/materialPolicy.mjs'
import { contractProblem } from './stores/noteBuild.mjs'

/**
 * 摘要所用之集合(對外名;摘要子階段與維運函數讀寫者):文件(抓取寫入、摘要轉移狀態)、原文另存(唯讀)、待探索線索(摘要寫入)、
 *   筆記、待判登錄。總組裝之開集合須至少含這些(他工作之集合另加;核心集合 cores 為選開)
 *
 * @type {Array}
 */
export const SUMMARIZE_STORE_KEYS = Object.freeze(['docs', 'docTexts', 'frontier', 'notes', 'holds'])

/**
 * 摘要所讀之資料鍵(cfg.data):詞彙覆寫 vocab
 *
 * @type {Array}
 */
export const SUMMARIZE_DATA_KEYS = Object.freeze(['vocab'])

/**
 * 摘要之輸出目錄(相對 workDir;交 resolveDirsCfg／expandDirs 之 extra):notes＝筆記 md(不隨 knowledge 之覆寫移動)
 *
 * @type {Object}
 */
export const SUMMARIZE_DIRS = Object.freeze({ notes: 'knowledge/notes' })

/**
 * 各 domain 之提示詞覆寫之形式(唯一來源為各 domain 檔;下列組合與所屬推導由之而來)
 *
 * @type {Object}
 */
const DOMAIN_PROMPT_SIGS = Object.freeze({ triage: TRIAGE_PROMPT_SIGS, summarize: NOTE_PROMPT_SIGS, retag: RETAG_PROMPT_SIGS })

/**
 * 提示詞覆寫之鍵與其函數形式(三個 domain 檔之 SIGS 之組合;錯誤訊息用,輸出契約固定,由各 domain 驗):預篩 triage、摘要 summarize、
 *   忠實性覆核 faith、欄位定向修補 repair、重標 retag;末參數 ctx 為 { kbLabel, domain, vocab, defaultPrompt }(defaultPrompt＝內建提示詞函數,可包裝)
 *
 * @type {Object}
 */
export const SUMMARIZE_PROMPT_SIGS = Object.freeze(Object.assign({}, ...Object.values(DOMAIN_PROMPT_SIGS)))

/**
 * 摘要之 domain 鍵(每輪 deps.domains 中屬本套件者;他總組裝之 cfg.domains 另有他工作之 domain 時,以此取子集交 opt.domains)
 *
 * @type {Array}
 */
export const SUMMARIZE_DOMAIN_KEYS = Object.freeze(Object.keys(DOMAIN_PROMPT_SIGS))

/** 各提示詞所屬之 domain(提示詞覆寫交該 domain 之工廠;與注入之同一 domain 擇一;由各 domain 檔之 SIGS 推導——抓取套件之 promptDomainOf) */
const PROMPT_DOMAIN = promptDomainOf(DOMAIN_PROMPT_SIGS)

/** 各 domain 之工廠之寫法(注入之建議;錯誤訊息用) */
const DOMAIN_FACTORY = Object.freeze({ triage: 'createTriageDomain({ vocab })', summarize: 'createSummarizeDomain({ vocab })', retag: 'createRetagDomain({ vocab })' })

/**
 * 選填之 domain 成員:功能表(SUMMARIZE_FEATURES)中依功能而必填者——缺之則對應功能不可開啟(開啟而缺之即於建構期拋錯);
 *   note 版型之內部件(normalizeQuality、renderNoteBody)——自備產物契約(contract.buildNote)之 domain 不需之;語言設定(locale;給了須與 cfg.lang 同一語言)
 */
const OPTIONAL_DOMAIN_MEMBERS = Object.freeze({ summarize: Object.freeze([...new Set([...SUMMARIZE_FEATURES.flatMap((f) => f.members || []), 'normalizeQuality', 'renderNoteBody', 'locale'])]) })

/**
 * 摘要所讀之資料(cfg.data 之 vocab)之檢核與正規化(抓取套件之 resolveDataCfg;各工作同一份);cfg.data 之鍵集由呼叫端檢核(各總組裝之 cfg.data 可另有其鍵)
 *
 * @param {*} d 輸入 cfg.data，未給代表全用預設
 * @returns {Object} 回傳 { vocab:Object|null(安裝方原給之詞彙覆寫;null＝用內建預設) }
 * @throws {Error} 非物件、或 vocab 非物件時拋出
 * @example
 * console.log(resolveSummarizeData({ vocab: { domain: '天文學' } }).vocab.domain)
 * // => 天文學
 */
export function resolveSummarizeData(d) {
    return resolveDataCfg(d, { keys: SUMMARIZE_DATA_KEYS, vocabKeysOf: 'core/vocab/summarizeVocab 之 SUMMARIZE_VOCAB_KEYS' })
}

/**
 * 組裝摘要執行期件(檔頭):建構期即驗資料、編譯素材樣式、設定概念鍵之折疊、建 domain 並檢核啟用之功能——設定錯誤要在啟動期爆
 *
 * @param {Object} cfg 輸入總組裝之 cfg(讀 lang、data、conceptFold、dedup、netGuard)
 * @param {Object} settings 輸入解析後之設定(讀 summarize、capture;本套件之 resolveSummarizeSettings 或他總組裝之同形設定)
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Object} [opt.vocab] 輸入交本套件之詞彙(只含本套件所讀之鍵,見 core/vocab/summarizeVocab 之 pickSummarizeVocab);未給即用 cfg.data.vocab
 * @param {Object} [opt.prompts] 輸入提示詞覆寫 { triage?, summarize?, faith?, repair?, retag? }(鍵與函數形式見 SUMMARIZE_PROMPT_SIGS;
 *   呼叫端已檢核之 cfg.prompts),作用於內建 domain
 * @param {Object} [opt.domains] 輸入交本套件之 domain 注入 { triage?, summarize?, retag? }(檔頭【domain 之注入只經 opt.domains】;未給＝無注入)
 * @returns {Object} 回傳 { data:{ vocab }(原給), vocab(已解析), locale(語言設定:抓取套件 resolveLocale 之產物), folds:{ fold, clueFold }, identity(去重身分),
 *   netGuard(null＝不判斷), isNetDown(交 AI 調度層之函數;netGuard 無 confirmDown 時為 null), domains:{ triage, summarize, retag }(生效之一份) }
 * @throws {Error} settings 不含 summarize／capture、cfg.lang 不合、cfg.data 形狀不合、素材問題樣式無法編譯、詞彙表不合規格、cfg.conceptFold 型別不合、
 *   opt.prompts 不合(非物件、不認得之鍵、值非函數)、提示詞覆寫與注入之 domain 給在同一 domain、opt.domains 不合規格(非物件、不認得之鍵、
 *   缺成員、詞彙表未經本套件解析、locale 與 cfg.lang 不同語言)、修補／忠實性覆核開啟而 domain 缺對應成員、判定小組開啟而缺必填席位、
 *   去重身分設定不合、cfg.netGuard 非物件時拋出
 * @example
 * need test in nodejs.
 *
 * let rt = createSummarizeRuntime({ data: { vocab: { domain: '天文學' } } }, resolveSummarizeSettings({}))
 * console.log(rt.domains.summarize.vocab.domain)
 * // => 天文學
 */
export function createSummarizeRuntime(cfg, settings, opt = {}) {
    if (!isobj(cfg)) cfg = {}
    if (!isobj(opt)) opt = {}
    const sm = settings?.summarize
    if (!isobj(sm) || !isobj(settings?.capture)) throw new Error('createSummarizeRuntime 需要解析後之 settings(含 summarize、capture)')

    // ── 語言設定(cfg.lang;抓取套件之 core/locale):提示詞之輸出語言句、字形政策、折疊方向、slug 政策——與抓取套件同讀此一份 ──
    const locale = resolveLocale(cfg.lang)

    // ── 資料與素材問題樣式(樣式語法錯誤在啟動期即爆;預篩／摘要每輪才建判定器)──
    const data = resolveSummarizeData(cfg.data)
    createMaterialPolicy({ patterns: sm.refetch.patterns, max: sm.refetch.max })

    // ── 詞彙(分類法、證據等級、提示詞之領域句、證據規則之設定錯誤在建構期即爆)與概念鍵之折疊(檔頭)──
    const vocab = resolveSummarizeVocab(isobj(opt.vocab) ? opt.vocab : data.vocab)
    const folds = applyConceptFold(cfg.conceptFold, vocab, locale)

    // ── domain:內建三工廠(詞彙、字數上限、提示詞覆寫)→ 與注入者合併(生效之一份;注入之詞彙表須經本套件解析——納入閘與證據規則讀之)──
    const prompts = promptOverridesOf(opt.prompts, SUMMARIZE_PROMPT_SIGS, 'createSummarizeRuntime')
    const conflicts = promptDomainConflicts(prompts, opt.domains, PROMPT_DOMAIN)
    if (conflicts.length) throw new Error(conflicts.join('；'))
    const promptsOf = (owner) => promptsForDomain(prompts, PROMPT_DOMAIN, owner)
    const domains = mergeDomains({
        triage: createTriageDomain({ vocab, locale, triageCharsPerDoc: sm.triage.charsPerDoc, longDocChars: sm.charsPerDoc, prompts: promptsOf('triage') }),
        summarize: createSummarizeDomain({ vocab, locale, summarizeCharsPerDoc: sm.charsPerDoc, prompts: promptsOf('summarize') }),
        retag: createRetagDomain({ vocab, prompts: promptsOf('retag') }),
    }, opt.domains, {
        optional: OPTIONAL_DOMAIN_MEMBERS,
        factories: DOMAIN_FACTORY,
        // 注入之摘要 domain:詞彙須經本套件解析;產物契約(contract)須合形狀(stores/noteBuild 之 contractProblem;未給＝內建 note 契約);
        //   語言設定(locale)給了須與 cfg.lang 同一語言(提示詞之語言句與 slug 政策不得與標準之字形政策分家)
        check: (k, d) => [
            summarizeVocabProblem(d.vocab),
            ...(k === 'summarize' && d.contract !== undefined ? [contractProblem(d.contract)] : []),
            ...(k === 'summarize' && d.locale !== undefined && d.locale?.code !== locale.code ? [`locale 須與 cfg.lang 同一語言（domain 為 ${String(d.locale?.code)}，cfg.lang 為 ${locale.code}）`] : []),
        ].filter(Boolean),
    })

    // ── 啟用之功能所需之判定小組席位與 domain 成員(功能表 SUMMARIZE_FEATURES 之單一判定;判定小組須兩票不同供應者才成立:覆核無「提案席」之
    //    一票,first、second 皆須給;預篩確認之另一票即預篩席,只須確認席 first)——缺者啟動期拋錯,不等到該段第一次執行才爆 ──
    const problems = summarizeFeatureProblems(settings, domains.summarize, { domainLabel: 'cfg.domains.summarize' })
    if (problems.length) throw new Error(problems.join('；'))

    // ── 去重身分(人工匯入等管線外登記文件之 id 須經之,與抓取同一身分)與本機網路判斷(抓取套件之判準;交 AI 調度層之 isNetDown)──
    const identity = captureIdentityOf(cfg.dedup)
    const { netGuard, isNetDown } = captureNetGuardOf(cfg.netGuard, settings.capture)

    return { data, vocab, locale, folds, identity, netGuard, isNetDown, domains }
}

export default { SUMMARIZE_STORE_KEYS, SUMMARIZE_DATA_KEYS, SUMMARIZE_DIRS, SUMMARIZE_DOMAIN_KEYS, SUMMARIZE_PROMPT_SIGS, resolveSummarizeData, createSummarizeRuntime }
