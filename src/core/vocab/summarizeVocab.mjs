// summarizeVocab.mjs — 摘要之詞彙表:內建預設(領域中立)、驗證與合併、子集擷取
//
// 【安裝即用 vs 執行端擴充】內建預設讓零設定可跑;執行端給 cfg.data.vocab 時「整鍵替換」(給 categories 就整組換 categories,
//   未給的鍵沿用內建)——不做深合併:合併語意不可預期,整鍵替換一眼可斷。唯一例外是 guide:逐欄回退預設(只給部分欄位時其餘沿用預設;
//   若整鍵替換,漏給一欄提示詞就缺句)。
// 【只認本套件讀取之鍵】不認得之鍵拋錯並列出可用鍵:打錯之鍵若靜默接受,正名鍵會維持預設而無人察覺。與其他知識處理段共用一份
//   詞彙表者,以 pickSummarizeVocab 取本套件所讀之鍵(guide 只取 triage、summarize、faith 三段)。
// 【抓取共用之鍵交抓取套件驗】domain、kbLabel、conceptRenames、conceptAliases 之預設與規則只在抓取套件(概念鍵之折疊為兩套件共用,
//   同一份對照須同一份規則);本檔不另寫,鍵集亦取自抓取套件。
// 【領域中立】預設不綁任何領域;安裝方以 domain 給主題範圍、以 categories／claimTypes／evidenceLevels 給領域詞彙、以 guide 給提示詞之
//   領域句、以 evidenceRule 給最高證據等級之要件(預設不啟用:最高級之定義因領域而異,通用規則會系統性誤判),即可把預設收斂到自己的主題。
// 【提示詞之兩種句子分居兩處】描述「輸出哪些欄位、什麼格式、怎麼驗證」的句子是套件解析輸出所依賴的契約,留在各 domain 檔;
//   描述「這個領域裡什麼算知識、什麼是雜訊、證據怎麼分級、什麼算誇大」的句子是安裝方的政策,一律成為 guide 欄位(預設值＝中立句)。
//   安裝方填回自己調校過的措辭即可逐字重現其提示詞,而輸出契約仍隨套件演進,不會因安裝方複製整段模板而漂移。
// 【已解析之詞彙表可辨認,缺即拋】resolveSummarizeVocab 之產物之 evidenceRule 為已編譯之規則物件(standards/evidenceRules;帶標記,
//   未啟用者亦然)。各處取證據規則一律經 assertSummarizeVocab(vocab).evidenceRule:給的若是未經本套件解析之詞彙(他段之詞彙表、{}、
//   JSON 往返後之複本)即拋錯——不得靜默退回「不啟用」,否則安裝方給的規則在某入口無聲失效。
// 【可序列化】產物 JSON.stringify 後 evidenceRule 為其正規形 { subject, check, strict:[{p,f?}], loose } 或 null(未啟用);
//   以 resolveSummarizeVocab 重新解析即還原(可重複套用)。
// 【頭、子集、guide 與改名鏈取共用件】值為 undefined 之鍵視為未給、null 依逐鍵宣告(SUMMARIZE_VOCAB_NULL_AS)、不認得之鍵／段／欄位之訊息、
//   guide 之逐欄回退與內建型別、改名鏈之檢核——皆取抓取套件之 vocabKit(各工作之詞彙表同一份);本檔只給摘要之型別處理(levelMap)與鍵之宣告。
//
// 各鍵語意:
//   domain、kbLabel、conceptRenames、conceptAliases  抓取共用之鍵(語意與驗證見抓取套件之詞彙表;domain 另決定預設 guide 之數句)
//   categories       筆記分類(摘要提示詞之單選清單;不在清單者落 fallbackCategory)
//   fallbackCategory 清單外分類之落點(須為 categories 之一——自訂 categories 不含「其他」者須明給)
//   ── 分類法變更之宣告(重標子階段據此重標既有筆記;未宣告之移除只守門告警、不動資料)──
//   categoryRenames  { 舊類別: 新類別 }:舊類別自 categories 移除、其筆記機械改為新類別(新類別須在 categories,或為另一筆改名之
//                    舊名而循對照可達 categories——連續改名 A→B、B→C 保留舊宣告即可;不得成環)。改名之目標不算新增類別
//   categoryRetire   [舊類別]:舊類別自 categories 移除、其筆記由 AI 依現行清單重判(不可同時出現在 categoryRenames)
//   categoryHints    { 類別: [關鍵詞] }:新增類別之重判範圍——落點類別之筆記之外,標題／概念／一句話重點含關鍵詞者亦重判
//   claimTypeRenames／evidenceLevelRenames { 舊: 新 }:內容類型／證據等級改名之機械對照(新進正規化與重標共用;規則同 categoryRenames)
//   claimTypes       內容類型標注(實證研究／理論模型…)
//   evidenceLevels   證據等級名稱(由高至低;提示詞之擇一清單與產出驗證同據此;各級定義見 guide.summarize.evidenceLevelDefs,
//                    最高級之要件見 evidenceRule)
//   guide            提示詞之領域句(段與欄位見 SUMMARIZE_GUIDE_FIELDS;值原樣插入,可含換行,續行請自帶三格縮排)
//   evidenceRule     最高證據等級之要件與「caveat 自承無此要件」之判準 { subject, check, strict, loose }(四鍵皆須給;見 standards/evidenceRules);
//                    null(預設)＝不啟用

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { resolveCaptureVocab, captureVocabDefaultOf, pickCaptureVocab, kbLabelOf, cloneSettingsDefault, vocabHeadOf, pickVocabKeys, mergeGuideFields, renameChainProblems } from '../capturePackage.mjs'
import { EVIDENCE_RULE_DEFAULT, evidenceRuleOf, isEvidenceRule } from '../standards/evidenceRules.mjs'


/**
 * 提示詞領域句之欄位表:段 → 欄位 → 型別('string' 字串｜'estr' 非空字串｜'array' 字串陣列｜'levelMap' 證據等級→定義之物件)
 *
 * @type {Object}
 */
export const SUMMARIZE_GUIDE_FIELDS = Object.freeze({
    // 預篩(標題＋開頭片段判「有無可複用知識」)
    triage: Object.freeze({
        question: 'string', // 首句「請逐篇判斷…」之判斷對象與列舉(含「」與粗體)
        scopeLine: 'string', // 主題範圍句;空字串＝不出現
        criterionNote: 'string', // 「判準（**…**，判的是後者）」之粗體內文
        elements: 'string', // 判準 0 之「具體的…元素」與列舉
        rejectIntro: 'string', // 判準 1 之前導句(不含結尾冒號)
        rejects: 'array', // 判準 1 之排除清單(每項一行)
        accepts: 'string', // 判準 2「下列判 true：」之列舉(不含句號)
        fallbackReason: 'string', // 模型漏給 reason 時之預設攔下理由
    }),
    // 摘要(萃取筆記)
    summarize: Object.freeze({
        target: 'string', // 首句「逐篇萃取…」之對象
        relevance: 'string', // 要求 1「先判斷該篇是否含有…（relevant）」之判準
        rejects: 'string', // 要求 1 之 relevant 為 false 清單(不含結尾逗號)
        simplifiedExamples: 'array', // 要求 4 之簡體字例
        conceptExamples: 'string', // 要求 4 之概念標籤用語提示(不含句號)
        evidenceLevelDefs: 'levelMap', // 證據等級之定義(鍵須為 evidenceLevels 之成員;逐級回退預設)
        caveatExamples: 'array', // caveats 之品質疑慮例
        regime: 'string', // regime_dependency 之有效條件描述
    }),
    // 忠實性覆核(判筆記是否忠實於原文;不忠實之判準 ③④ 之領域措辭)
    faith: Object.freeze({
        scope: 'estr', // 判準 ③「原文只在…下成立之結論，筆記寫成普遍成立」之條件詞
        overclaim: 'estr', // 判準 ④「證據等級或其說明誇大原文（如…）」括號內之例
    }),
})


/**
 * 依主題範圍產生提示詞領域句之預設值(套件中立句;有 domain 時數句帶入主題)
 *
 * @param {String} [domain=''] 輸入主題範圍字串，空字串代表不限主題
 * @returns {Object} 回傳完整 guide 物件 { triage, summarize, faith }，各段各欄位皆有值(欄位見 SUMMARIZE_GUIDE_FIELDS)
 * @example
 * console.log(guideDefaultOf('').triage.fallbackReason)
 * // => 無可複用知識
 *
 * console.log(guideDefaultOf('機器學習').triage.scopeLine)
 * // => 本知識庫之主題範圍為「機器學習」：與此主題無關者判 false。
 *
 * console.log(guideDefaultOf('').faith.scope)
 * // => 特定對象、期間或條件
 */
export function guideDefaultOf(domain = '') {
    const d = String(domain || '').trim()
    return {
        triage: {
            question: '「本篇是否含有**可長期複用的知識或方法論**」——原理與機制、模型或演算法、方法與步驟、參數與門檻、規則或準則、指標或評估方式、實驗或實證結果、風險與限制分析',
            scopeLine: d ? `本知識庫之主題範圍為「${d}」：與此主題無關者判 false。` : '',
            criterionNote: '與主題相關並不等於有可複用之知識',
            elements: '**具體的方法或知識元素**——模型或方法的名稱與做法、參數與門檻值、規則或步驟、\n   實驗設計／樣本與檢定、評估方式、機制或原理的說明',
            rejectIntro: '無上述元素，且**整篇的主要內容**即為下列之一者判 false',
            rejects: [
                '即時新聞快訊、數字或價格之例行報導',
                '名人／評論者／分析師之主觀看法、預測、展望、採訪與節目摘要',
                '問卷或意見調查之數字報導',
                '公司／平台之產品發布、上線公告、業務與財務新聞',
                '產品介紹、比較、排行或促銷資訊',
                '法規、政策之宣導與新聞',
                '例行統計數據發布、產業或時事新聞',
                '個人生活建議、公司人事與活動公告、廣告與招募、免責聲明或版權頁、純導覽頁',
            ],
            accepts: '學術論文與研究、方法或模型之構建與驗證、實驗或評估方法與陷阱、參數選擇、\n   原理與機制分析、風險與限制分析、資料處理方法、程式或工具之方法說明、對某方法之實證檢驗或反駁',
            fallbackReason: d ? `與「${d}」無關或無可複用知識` : '無可複用知識',
        },
        summarize: {
            target: '可長期複用的知識',
            relevance: `${d ? `與「${d}」相關、` : ''}可長期複用之知識、方法、技術、參數或原理`,
            rejects: `純新聞快訊、廣告、招募、無方法論的評論或觀點、免責聲明或版權頁、產品／月報更新${d ? `、與「${d}」無關之內容` : ''}`,
            simplifiedExamples: ['数据', '网络'],
            conceptExamples: '用該領域的通用術語',
            evidenceLevelDefs: {
                '高': '有獨立驗證、重複驗證或實際應用結果',
                '中': '僅單一研究、案例或統計分析',
                '低': '示範性質、未驗證、或推廣內容',
            },
            caveatExamples: ['無獨立驗證', '樣本小或期間短', '選樣偏差風險', '相關不等於因果', '適用範圍狹窄', '推廣性質', '結論與所附數據不符'],
            regime: '在什麼環境／時期／條件下有效',
        },
        faith: {
            scope: '特定對象、期間或條件',
            overclaim: '原文只有初步或單一來源之結果，筆記寫有獨立驗證或實際應用',
        },
    }
}


/**
 * 內建預設詞彙表(領域中立):抓取共用之鍵(抓取套件之 captureVocabDefaultOf——同一份預設、複本)＋摘要自有之鍵
 *
 * @type {Object}
 */
export const SUMMARIZE_VOCAB_DEFAULT = {
    ...captureVocabDefaultOf(),
    categories: ['原理與概念', '方法與技術', '模型與演算法', '流程與實務', '工具與實作', '資料與指標', '評估與驗證', '風險與限制', '其他'],
    fallbackCategory: '其他',
    categoryRenames: {},
    categoryRetire: [],
    categoryHints: {},
    claimTypeRenames: {},
    evidenceLevelRenames: {},
    claimTypes: ['實證研究', '理論模型', '實務經驗', '教學示範', '觀點評論', '廠商內容'],
    evidenceLevels: ['高', '中', '低'],
    guide: guideDefaultOf(''),
    evidenceRule: EVIDENCE_RULE_DEFAULT,
}


/**
 * 詞彙表之全部可用鍵(resolveSummarizeVocab 據此拒絕不認得之鍵;pickSummarizeVocab 據此取子集)
 *
 * @type {Array}
 */
export const SUMMARIZE_VOCAB_KEYS = Object.freeze(Object.keys(SUMMARIZE_VOCAB_DEFAULT))


/**
 * null 之逐鍵政策(抓取套件之 vocabHeadOf):分類法變更之宣告(改名、退役、重判範圍)之 null 為空對照／空清單,guide 之 null 視為未給;
 *   未列之鍵之 null 照收,交其形狀檢核(清單與落點為必填——null 即拋;evidenceRule 之 null＝不啟用)。抓取共用之鍵依抓取套件之宣告
 */
const SUMMARIZE_VOCAB_NULL_AS = Object.freeze({
    categoryRenames: 'empty', claimTypeRenames: 'empty', evidenceLevelRenames: 'empty', categoryRetire: 'empty', categoryHints: 'empty', guide: 'unset',
})

/**
 * guide 之證據等級對照(SUMMARIZE_GUIDE_FIELDS 之 'levelMap')之型別處理(交抓取套件之 mergeGuideFields):逐級回退預設;鍵須為 evidenceLevels
 *   之成員(打錯級名會讓該級靜默沿用預設)
 *
 * @param {Array} levels 輸入證據等級名稱陣列
 * @returns {Function} 回傳 (值, 設定路徑, 預設值) => 合併後之對照(只留 levels 內之等級)
 */
const levelMapOf = (levels) => (v, name, def) => {
    if (!isobj(v)) throw new Error(`${name} 須為物件 { <證據等級>: 定義字串 }`)
    for (const [lv, text] of Object.entries(v)) {
        if (!levels.includes(lv)) throw new Error(`${name} 之「${lv}」不在 evidenceLevels（${levels.join('、')}）`)
        if (typeof text !== 'string') throw new Error(`${name}.${lv} 須為字串`)
    }
    const merged = { ...def, ...v }
    return Object.fromEntries(levels.filter((lv) => merged[lv] !== undefined).map((lv) => [lv, merged[lv]]))
}


/**
 * 合併內建預設詞彙表與執行端覆寫(整鍵替換;guide 逐欄回退預設,預設 guide 依 domain 產生)
 *
 * 可重複套用:resolveSummarizeVocab(resolveSummarizeVocab(x)) 與 resolveSummarizeVocab(x) 相同;
 * 產物經 JSON 往返(JSON.parse(JSON.stringify(v)))後再解析亦相同
 *
 * @param {Object} [override] 輸入覆寫物件，給定之鍵整鍵替換內建值(值為 undefined 者視為未給;null 依 SUMMARIZE_VOCAB_NULL_AS)，
 *   未給或非物件代表全用內建預設(鍵見 SUMMARIZE_VOCAB_KEYS)
 * @returns {Object} 回傳合併後詞彙表物件，含 SUMMARIZE_VOCAB_KEYS 之全部鍵;evidenceRule 為已編譯之規則物件(evidenceRuleOf 之產物,
 *   未給為停用者;JSON 化為其正規形或 null)——取用一律經 assertSummarizeVocab
 * @throws {Error} 含不認得之鍵(附可用鍵)、抓取共用之鍵不合抓取套件之規則(kbLabel 非字串、概念對照形狀錯),
 *   categories／claimTypes／evidenceLevels 非非空字串陣列，fallbackCategory 非字串或不在 categories，
 *   categoryRenames／claimTypeRenames／evidenceLevelRenames 非物件、鍵值非非空字串、舊名仍在清單、新名循對照不可達清單或成環，
 *   categoryRetire 非字串陣列、仍在清單或與改名重複，categoryHints 非物件、類別不在清單或關鍵詞非非空字串陣列，
 *   guide 不合 SUMMARIZE_GUIDE_FIELDS(非物件、不認得之段或欄位、型別不符、證據等級鍵不在 evidenceLevels)，
 *   或 evidenceRule 不合規格(見 evidenceRuleOf)時拋出
 * @example
 * let v = resolveSummarizeVocab({ domain: '機器學習', categories: ['模型', '資料', '其他'] })
 * console.log(v.domain, v.categories, v.evidenceLevels, v.fallbackCategory)
 * // => 機器學習 [ '模型', '資料', '其他' ] [ '高', '中', '低' ] 其他
 *
 * let v2 = resolveSummarizeVocab({ guide: { faith: { scope: '特定族群或條件' } } })
 * console.log(v2.guide.faith.scope, v2.guide.faith.overclaim)
 * // => 特定族群或條件 原文只有初步或單一來源之結果，筆記寫有獨立驗證或實際應用
 */
export function resolveSummarizeVocab(override) {
    const o = vocabHeadOf(override, SUMMARIZE_VOCAB_KEYS, { nullAs: SUMMARIZE_VOCAB_NULL_AS, defaults: SUMMARIZE_VOCAB_DEFAULT })

    // 抓取共用之鍵:交抓取套件驗證與合併(同一份規則)
    const shared = resolveCaptureVocab(pickCaptureVocab(o))
    const v = { ...cloneSettingsDefault(SUMMARIZE_VOCAB_DEFAULT), ...o, ...shared }

    // 清單之形狀:給了非陣列或空清單者,摘要每篇都會落到清單外(靜默)
    for (const k of ['categories', 'claimTypes', 'evidenceLevels']) {
        if (!isarr(v[k]) || v[k].length === 0 || !v[k].every(isestr)) throw new Error(`vocab.${k} 須為非空字串陣列`)
    }
    // 清單外分類之落點須在清單內:自訂 categories 不含「其他」者,模型給清單外類別即落一個清單外之落點(靜默)
    if (!isestr(v.fallbackCategory)) throw new Error('vocab.fallbackCategory 須為非空字串（categories 之一）')
    if (!v.categories.includes(v.fallbackCategory)) {
        throw new Error(`vocab.fallbackCategory「${v.fallbackCategory}」不在 categories（${v.categories.join('、')}）${o.fallbackCategory === undefined ? '；自訂 categories 不含「其他」者請給 vocab.fallbackCategory 指定清單外分類之落點' : ''}`)
    }
    // 分類法變更之宣告:形狀與目標於建構期檢核(抓取套件之 renameChainProblems;問題一次列全)——打錯之對照會讓重標改到不存在之類別、或該移除者靜默不動
    for (const [k, list] of [['categoryRenames', v.categories], ['claimTypeRenames', v.claimTypes], ['evidenceLevelRenames', v.evidenceLevels]]) {
        const bad = renameChainProblems(v[k], list, `vocab.${k}`)
        if (bad.length) throw new Error(bad.join('；'))
    }
    if (!isarr(v.categoryRetire) || !v.categoryRetire.every(isestr)) throw new Error('vocab.categoryRetire 須為字串陣列（退役之舊類別）')
    for (const c of v.categoryRetire) {
        if (v.categories.includes(c)) throw new Error(`vocab.categoryRetire 之「${c}」仍在 categories（退役之類別須已自清單移除）`)
        if (Object.hasOwn(v.categoryRenames, c)) throw new Error(`vocab.categoryRetire 之「${c}」同時出現在 categoryRenames（改名與退役擇一）`)
    }
    if (!isobj(v.categoryHints)) throw new Error('vocab.categoryHints 須為物件 { 類別: [關鍵詞] }')
    for (const [c, kws] of Object.entries(v.categoryHints)) {
        if (!v.categories.includes(c)) throw new Error(`vocab.categoryHints 之「${c}」不在 categories`)
        if (!isarr(kws) || kws.length === 0 || !kws.every(isestr)) throw new Error(`vocab.categoryHints.${c} 須為非空字串陣列`)
    }
    // guide:抓取套件之 mergeGuideFields(逐欄回退預設;預設 guide 依 domain 產生);levelMap 未給時亦只留 levels 內之等級(改了等級名稱者,
    //   預設之高／中／低定義不適用)
    const guide = mergeGuideFields(SUMMARIZE_GUIDE_FIELDS, guideDefaultOf(v.domain), o.guide, { types: { levelMap: levelMapOf(v.evidenceLevels) } })
    const defs = guide.summarize.evidenceLevelDefs
    guide.summarize.evidenceLevelDefs = Object.fromEntries(v.evidenceLevels.filter((lv) => defs[lv] !== undefined).map((lv) => [lv, defs[lv]]))
    v.guide = guide
    // 證據規則:於此驗證與編譯(未給＝不啟用);存已編譯之規則物件——其標記即「本套件解析過」之憑據(assertSummarizeVocab)
    v.evidenceRule = evidenceRuleOf(o.evidenceRule)
    return v
}


/**
 * 確認詞彙表為 resolveSummarizeVocab 之產物(證據規則等之取用入口;缺即拋,不靜默退回預設)。判準:evidenceRule 為已編譯之規則物件
 *   (isEvidenceRule;展開複製 { ...vocab } 仍保有,JSON 往返後須重新解析)
 *
 * @param {*} vocab 輸入詞彙表
 * @param {String} [where='vocab'] 輸入呼叫處之名稱(錯誤訊息用)
 * @returns {Object} 回傳同一詞彙表(取規則:assertSummarizeVocab(vocab).evidenceRule)
 * @throws {Error} 非物件或未經本套件解析(evidenceRule 非已編譯之規則物件)時拋出
 * @example
 * let v = resolveSummarizeVocab({})
 * console.log(assertSummarizeVocab(v) === v, assertSummarizeVocab(v).evidenceRule.enabled)
 * // => true false
 *
 * try { assertSummarizeVocab({ evidenceLevels: ['高', '中'] }) } catch (e) { console.log(e.message.slice(0, 33)) }
 * // => vocab 須為 resolveSummarizeVocab 之產物
 */
export function assertSummarizeVocab(vocab, where = 'vocab') {
    const p = summarizeVocabProblem(vocab, where)
    if (p) throw new Error(p)
    return vocab
}

/**
 * 詞彙表是否為 resolveSummarizeVocab 之產物之問題(assertSummarizeVocab 之判準;不拋錯之版本——注入 domain 之形狀檢核以之列問題)
 *
 * @param {*} vocab 輸入詞彙表
 * @param {String} [where='vocab'] 輸入呼叫處之名稱(訊息用)
 * @returns {String} 回傳問題說明(合格回 '')
 * @example
 * console.log(summarizeVocabProblem(resolveSummarizeVocab({})) === '', summarizeVocabProblem({}).slice(0, 33))
 * // => true vocab 須為 resolveSummarizeVocab 之產物
 */
export function summarizeVocabProblem(vocab, where = 'vocab') {
    if (isobj(vocab) && isEvidenceRule(vocab.evidenceRule)) return ''
    return `${where} 須為 resolveSummarizeVocab 之產物（evidenceRule 須為已編譯之規則物件；未經本套件解析之詞彙表、他段之詞彙表或 JSON 往返之複本請先以 resolveSummarizeVocab 解析——證據規則不得靜默退回不啟用）`
}


/**
 * 自任意詞彙表取本套件所讀之鍵(SUMMARIZE_VOCAB_KEYS;guide 只取 triage、summarize、faith 三段):他段與本套件共用一份詞彙表時,
 *   以此取子集交本套件(resolveSummarizeVocab 拒收其他鍵與他段)——鍵集只在本檔定義,呼叫端不另抄一份
 *
 * @param {Object} [vocab] 輸入詞彙表(可含他段之鍵)，非物件視為{}
 * @returns {Object} 回傳只含本套件所讀之鍵(未給者不列;guide 為物件時只留三段中已給者)之新物件
 * @example
 * console.log(pickSummarizeVocab({ domain: '機器學習', relationTypes: ['相關'], guide: { summarize: { target: '知識' }, relate: {} } }))
 * // => { domain: '機器學習', guide: { summarize: { target: '知識' } } }
 */
export function pickSummarizeVocab(vocab) {
    return pickVocabKeys(vocab, SUMMARIZE_VOCAB_KEYS, { guideSections: Object.keys(SUMMARIZE_GUIDE_FIELDS) })
}


export { kbLabelOf }

export default {
    SUMMARIZE_GUIDE_FIELDS, SUMMARIZE_VOCAB_DEFAULT, SUMMARIZE_VOCAB_KEYS,
    guideDefaultOf, resolveSummarizeVocab, assertSummarizeVocab, summarizeVocabProblem, pickSummarizeVocab, kbLabelOf,
}
