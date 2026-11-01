// summarizeSettings.mjs — 摘要之設定預設值、schema 與解析(安裝即用;執行端 cfg 逐鍵覆寫)
//
// 【三段】ai(AI 調度層:抓取套件之 ai 段＋本套件之 parallel)、summarize(摘要之全部設定)、capture(抓取設定;交抓取套件驗——
//   本套件只用其素材退回抓取之欄位與 raw 進料上界)。summarize 依摘要之要點分組:要點 1 整理成可讀筆記(含預篩 triage)、
//   要點 2 長文與格式問題(charsPerDoc、refetch)、要點 3～5 分類標注與擴充(retag;分類法在詞彙表)、檢定標準(standards)。
//   AI 席位放在用到它的那一組(鍵名一律 ai)。推導值在 capacity(唯讀)。
// 【合併】組(物件節點)逐鍵遞迴合併:只給想調的鍵,其餘沿用預設;葉(席位、樣式陣列)給了即整個取代。合併與型別規則一律取
//   抓取套件之 mergeSettingsGroup／SETTING_TYPES(各套件同一份規則,不另寫)。
// 【免費 AI 為主】摘要之預設席位全為免費模型(opencode CLI 之匿名免費存取,免金鑰);預篩、重標未給席位即沿用摘要席位;判定小組預設關閉。
//   付費家由安裝方加於 fallback 尾。摘要恆以席位呼叫 AI,不收供應商池之設定(ai 段給 providerPick 即拋)。
// 【設定錯誤一律啟動期拋錯,不靜默回預設】各組之鍵以 schema 逐鍵驗型別與值域、不認得之鍵拋錯、組給了但形狀錯亦拋——
//   安裝方之設定是刻意為之,靜默改用套件預設(如席位退回預設家、'27' 被算成字串)比拋錯更難察覺。
// 【容量自洽】關卡依序為 抓取(raw 進料)→ 預篩 → 摘要,每一關之每輪容量須 ≥ 該關進料之上界——寧可稍慢,不可讓積壓持續大於處理量。
//   只警告「進料 > 容量」,不警告「容量閒置」:容量是上限不是成本(批次池空即停,不空轉);把閒置當問題會引導人開大進料、縮小容量。
//   raw 進料之上界由抓取套件推導(captureCapacityOf);放行率與產出率為安裝端校準之估計值,方向一律取偏高——估低了會讓真實積壓
//   通過檢核。摘要之後之關卡之檢核屬組裝者,本檔提供筆記產出上界 capacity.notesOut 與筆記進料上界 notesInflowOf 供其比較。
// 【判定小組】兩票之實際成交供應者須不同才成立:已開啟之小組其成對兩席首選同家且無不同家之第三席者,啟動期警告(永遠無法成立)。
//   預篩確認之另一票即預篩席本身,故其小組只有 first 與 third(給 second 即拋——收下卻無效之鍵比拋錯更難察覺)。
//   小組之組成、同家之判定與警告之字樣取 core/standards/panelConfig(三工作同一份);小組之開啟與成員之必填由功能表(SUMMARIZE_FEATURES)推導。
// 【功能表】檢定標準之各功能(稱呼、開啟判準、判定小組之必填席、所需之 domain 成員)只在 SUMMARIZE_FEATURES:執行期件之啟動期檢核、子階段之
//   執行期檢核(抓取套件之 featureProblemsOf)、判定小組之必填與席位檢核工具同讀。
// 【健康降序】ai.healthStreak 預設 3(抓取套件之預設為不開):摘要為呼叫量最大之工作,連續失敗之條目移到鏈尾。本段之 ai 預設亦為下游工作與
//   多工作之組裝者之 ai 段之底(各取 SUMMARIZE_AI_DEFAULT／SUMMARIZE_AI_SCHEMA,不另寫健康降序與併發之預設)。
// 【下游關卡之進料與席位之沿用只在本檔】筆記進料之上界(notesInflowOf;下游關卡之容量警告之 inflow)與其形狀之判準(notesInflowProblem)、
//   預篩／重標「未設即沿用摘要席位」之取法(summarizeSeatOf;子階段之呼叫與判定小組之預篩席同讀)各一份。

import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import {
    AI_DEFAULT, AI_SCHEMA, mergeSettingsGroup, cloneSettingsDefault, resolveCaptureSettings, captureCapacityOf, featureProblemsOf, seatsFrom, seatLabelsFrom, checkKeys,
} from './capturePackage.mjs'
import { PANEL_SCHEMA, panelGroupOf, panelSameProviderWarnings, panelSeatRowsOf } from './standards/panelConfig.mjs'


/** ai 段之預設:抓取套件之 AI 調度層預設＋健康降序＋同時併發之 AI 呼叫數 */
export const SUMMARIZE_AI_DEFAULT = {
    ...cloneSettingsDefault(AI_DEFAULT),
    // 健康降序:同一條目連續失敗幾次即移到鏈尾(摘要呼叫量最大,預設開、3 次;抓取套件之預設為不開)
    healthStreak: 3,
    // 同時併發之 AI 呼叫數(預篩、摘要、重標各批共用;各段容量＝輪數×本值×每次篇數,見 capacity)
    parallel: 3,
}

/** ai 段之 schema(抓取套件之 ai 段＋parallel) */
export const SUMMARIZE_AI_SCHEMA = { ...AI_SCHEMA, parallel: 'pint' }

/** 摘要(summarize)之預設 */
export const SUMMARIZE_DEFAULT = {
    // ── 要點 1:從各種原文整理出可讀內容(先預篩、再摘要成筆記)──
    rounds: 6, // 摘要容量＝本值×ai.parallel×docsPerCall(6×3×3＝54 篇/輪)
    docsPerCall: 3, // 每次 AI 摘要處理幾篇(縮批量控輸出截斷,配合部分接受)
    // 摘要產出率(新知識÷處理篇數)估計值:下游之容量檢核用(capacity.notesOut＝摘要容量×本值;取偏高——估低了會讓真實積壓通過檢核)
    yieldRate: 0.5,
    // 席位 { use, fallback?, timeoutMs?, minAttemptMs?, budgetMs? }:預設全為免費模型;付費家由安裝方加於 fallback 尾
    ai: { use: 'oc:opencode/mimo-v2.6-flash-free', fallback: ['oc:opencode/big-pickle'] },
    // 預篩:標題＋開頭片段判「明確無關」即攔下,摘要只讀放行者。實際運行之摘要呼叫常有過半判非知識,預篩一次看 20 篇
    //   (約摘要 1/10 成本),同樣 AI 預算可判定的文件數約 2 倍以上;拿不準一律放行、預篩失敗達上限亦放行
    triage: {
        enabled: true,
        rounds: 2, // 預篩容量＝本值×ai.parallel×docsPerCall(2×3×20＝120 篇/輪,約摘要容量 2 倍)
        docsPerCall: 20, // 每次預篩呼叫看幾篇(只給標題＋片段,20 篇約 9k 字、40 篇約 16k)
        charsPerDoc: 400, // 每篇給模型的開頭片段字數
        maxTries: 2, // 預篩失敗幾次即放行交摘要(fail-open)
        passRate: 0.5, // 放行率估計值(容量自洽檢核用,非門檻):檢核方向是「進料上界 ≤ 容量」,故取偏高之值;安裝端校準
        ai: null, // 席位;null＝沿用 summarize.ai(提示詞短、輸出短)
    },

    // ── 要點 2:長文與格式問題 ──
    charsPerDoc: 6000, // 每篇送 AI 之字數上限;未讀到之部分記 processedChars,不靜默截斷
    // 素材問題回報:預篩或摘要判非知識、且理由直指素材壞了(亂碼／未載入／截斷…)者,不轉 skip,改退回抓取以另一種方法重抓
    refetch: {
        patterns: [], // 樣式接在套件內建之後({p,f} 或 RegExp)
        max: 1, // 同一篇至多退回幾次(0＝停用)
    },

    // ── 要點 3～5:分類標注與擴充(分類法在詞彙表;分類法變更 → 自動重判既有筆記之類別)──
    retag: {
        perRun: 60, // AI 每輪至多重判篇數(量只發生於分類法變更時:新增一個類別約重判落點類別之全部筆記)
        notesPerCall: 20, // 每次 AI 呼叫幾篇
        mechanicalPerRun: 500, // 機械改名每輪至多篇數(分頁,下輪續)
        ai: null, // 席位;null＝沿用 summarize.ai
    },

    // ── 檢定標準 ──
    standards: {
        // 預篩攔下之第二席確認(SS5):開啟時預篩席判無關者須確認席(ai.first;須與預篩席不同家)同判才攔下,推翻或不一致者
        //   放行交摘要(以全文再判);ai.third＝兩席不一致時之第三席(缺則放行)。預篩席本身即另一票,故無 second。
        //   開啟條件:預篩之評分題組以正式席位逐案兩次全過
        triageConfirm: {
            enabled: false,
            ai: { first: null, third: null },
        },
        // 筆記忠實性覆核(SS14):開啟時過確定性納入閘之項目於寫筆記前交判定小組判是否忠實於原文:不忠實 → 不寫、回饋重試;
        //   判不了 → 待判(首次下輪重判,再判不了改由使用者);缺票逾 maxTries 次同判不了。每批多 2 次呼叫(＋第三席)——開啟前依容量原則估算;
        //   first、second 必填,宜不同家且與摘要席不同。開啟條件:忠實性之評分題組以正式席位逐案兩次全過
        faithCheck: {
            enabled: false,
            maxTries: 3,
            ai: { first: null, second: null, third: null },
        },
        // 欄位定向修補呼叫(SS2／SS4「先修正、修不了才不納入」):開啟時摘要項目過確定性納入閘而有可修之問題(SS4 未紮根之行、SS2 欄位不合)者,
        //   先以摘要席依原文定向修補一次(只改被指出之行／欄位),修補後重過閘;仍不合格才逐條移除／不納入。每篇有問題者多 1 次呼叫
        repair: {
            enabled: false,
        },
        // 符合度掃描:每輪管線結束後掃一次摘要之確定性標準(SS*;不呼叫 AI;本輪已逾時間預算者略過),違反數入執行摘要。
        //   預設關閉:掃描逐篇讀筆記與原文另存,大庫耗時;由安裝端依庫規模開啟
        scanEachRun: false,
    },
}

/** 預篩確認之小組(預篩席即另一票:只有確認席 first 與第三席 third;其餘判定小組之三席取 panelConfig 之 PANEL_SCHEMA) */
const CONFIRM_SCHEMA = { first: 'seatOrNull', third: 'seatOrNull' }

/** summarize 段之 schema(與 SUMMARIZE_DEFAULT 同形;節點為字串＝葉之型別名,為物件＝組) */
export const SUMMARIZE_SCHEMA = {
    rounds: 'p0int', docsPerCall: 'pint', yieldRate: 'ratio', ai: 'seat',
    triage: { enabled: 'bool', rounds: 'p0int', docsPerCall: 'pint', charsPerDoc: 'pint', maxTries: 'pint', passRate: 'ratio', ai: 'seatOrNull' },
    charsPerDoc: 'pint',
    refetch: { patterns: 'patterns', max: 'p0int' },
    retag: { perRun: 'p0int', notesPerCall: 'pint', mechanicalPerRun: 'p0int', ai: 'seatOrNull' },
    standards: {
        triageConfirm: { enabled: 'bool', ai: CONFIRM_SCHEMA },
        faithCheck: { enabled: 'bool', maxTries: 'pint', ai: PANEL_SCHEMA },
        repair: { enabled: 'bool' },
        scanEachRun: 'bool',
    },
}


/** 未設席位即沿用摘要席位(summarize.ai)之步(預篩、重標) */
const SEAT_FALLBACK_STAGES = Object.freeze(['triage', 'retag'])

/**
 * 摘要各步之生效席位(唯一一份;子階段之呼叫、判定小組之預篩席同讀,不各寫「|| summarize.ai」):預篩、重標未設(null)即沿用摘要席位
 *   summarize.ai;其餘步(含未給)即摘要席位
 *
 * @param {Object} summarize 輸入 summarize 段(resolveSummarizeSettings 之產物之 summarize;可缺——回 undefined)
 * @param {String} [stage] 輸入 'triage'｜'retag'(未給或其他＝摘要席位)
 * @returns {Object|undefined} 回傳席位
 * @example
 * const s = resolveSummarizeSettings({ summarize: { retag: { ai: { use: 'x:r' } } } }).summarize
 * console.log(summarizeSeatOf(s, 'retag').use, summarizeSeatOf(s, 'triage') === s.ai)
 * // => x:r true
 */
export function summarizeSeatOf(summarize, stage) {
    const own = SEAT_FALLBACK_STAGES.includes(stage) ? summarize?.[stage]?.ai : null
    return own || summarize?.ai
}

/**
 * 預篩是否啟用之單一判準(summarize.triage.enabled === true;未經解析之裸設定視為未啟用):預篩子階段之開關、摘要之「只取已放行者」
 *   與容量推導同用此函數,不各寫一份
 *
 * @param {Object} summarize 輸入 summarize 段(resolveSummarizeSettings 之產物之 summarize;可缺)
 * @returns {Boolean} 回傳是否啟用
 * @example
 * console.log(triageEnabledOf(resolveSummarizeSettings({}).summarize), triageEnabledOf(undefined))
 * // => true false
 */
export function triageEnabledOf(summarize) {
    return summarize?.triage?.enabled === true
}

/**
 * 摘要之每輪容量與進料上界(由已解析設定推導之唯一來源;容量自洽檢核、組裝者之下游檢核與巡檢取用,不另推導)
 *
 * @param {Object} settings 輸入已解析之設定(resolveSummarizeSettings 之產物,或同形之 { ai, summarize, capture })
 * @returns {Object} 回傳 {
 *   rawInflowMax   raw 進料上界(抓取套件之 captureCapacityOf),
 *   gridInflowMax  其中網格摘要直入之上界,
 *   rawInflowDesc  raw 進料上界之推導式說明(警告與巡檢訊息用),
 *   triage         預篩容量＝summarize.triage.rounds×ai.parallel×summarize.triage.docsPerCall(預篩未啟用為 0;啟用判準為 triageEnabledOf,與子階段同),
 *   summarize      摘要容量＝summarize.rounds×ai.parallel×summarize.docsPerCall,
 *   notesOut       筆記產出上界＝round(摘要容量×summarize.yieldRate)(下游進料之上界) }
 * @example
 * let c = summarizeCapacityOf(resolveSummarizeSettings({}))
 * console.log(c.triage, c.summarize, c.notesOut)
 * // => 120 54 27
 */
export function summarizeCapacityOf(settings) {
    const { ai, summarize, capture } = settings
    const cc = captureCapacityOf(capture)
    const triage = triageEnabledOf(summarize) ? summarize.triage.rounds * ai.parallel * summarize.triage.docsPerCall : 0
    const sum = summarize.rounds * ai.parallel * summarize.docsPerCall
    return {
        rawInflowMax: cc.rawInflowMax,
        gridInflowMax: cc.gridInflowMax,
        rawInflowDesc: cc.rawInflowDesc,
        triage,
        summarize: sum,
        notesOut: Math.round(sum * summarize.yieldRate),
    }
}

/**
 * 容量之推導式說明(警告與巡檢訊息引用;式之單一來源為 summarizeCapacityOf)
 *
 * @type {Object}
 */
export const SUMMARIZE_CAPACITY_DESC = Object.freeze({
    triage: 'summarize.triage.rounds×ai.parallel×summarize.triage.docsPerCall',
    summarize: 'summarize.rounds×ai.parallel×summarize.docsPerCall',
    notesOut: 'round(摘要容量×summarize.yieldRate)',
})

/**
 * 筆記進料之上界(摘要之下游關卡之進料;唯一一份,組裝者交下游之容量警告之 opt.inflow,不另寫推導與說明):
 *   摘要之筆記產出上界(summarizeCapacityOf 之 notesOut)與其推導式說明
 *
 * @param {Object} settings 輸入已解析之設定(同 summarizeCapacityOf;取 summarize.yieldRate)
 * @returns {Object} 回傳 { max:Number(篇/輪), desc:String(推導式說明,入警告訊息) }
 * @example
 * console.log(notesInflowOf(resolveSummarizeSettings({})))
 * // => { max: 27, desc: '摘要容量 54×產出率 0.5' }
 */
export function notesInflowOf(settings) {
    const cap = summarizeCapacityOf(settings)
    return { max: cap.notesOut, desc: `摘要容量 ${cap.summarize}×產出率 ${settings.summarize.yieldRate}` }
}

/**
 * 筆記進料上界之形狀問題(下游關卡之容量警告之 opt.inflow 同一判準與字樣;合格回 '')
 *
 * @param {*} inflow 輸入 { max:非負數(篇/輪), desc:非空字串 }
 * @returns {String} 回傳問題說明(呼叫端冠其主詞,如「relateWarningsOf 之 opt.inflow 」)
 * @example
 * console.log(notesInflowProblem({ max: 3, desc: '上游' }) === '', notesInflowProblem({ max: -1 }).slice(0, 6))
 * // => true 須為 { max
 */
export function notesInflowProblem(inflow) {
    return isobj(inflow) && Number.isFinite(inflow.max) && inflow.max >= 0 && isestr(inflow.desc) ? '' : '須為 { max: 非負數（筆記進料上界，篇/輪）, desc: 非空字串（其推導式說明） }'
}

/**
 * 抓取 → 預篩 → 摘要之容量自洽警告(只警告「進料 > 容量」)
 *
 * @param {Object} s 輸入已解析之設定(取 summarize.triage.passRate)
 * @param {Object} cap 輸入 summarizeCapacityOf 之產物
 * @returns {Array} 回傳警告字串陣列
 */
function capacityWarningsOf(s, cap) {
    const warnings = []
    const inflow = cap.rawInflowMax
    const inflowDesc = cap.rawInflowDesc
    const D = SUMMARIZE_CAPACITY_DESC
    if (cap.triage > 0) {
        if (cap.triage < inflow) {
            warnings.push(`預篩容量 ${cap.triage}（${D.triage}）小於 raw 進料 ${inflow}（${inflowDesc}）：raw 會在預篩關堆積；調高預篩容量或降名額`)
        }
        // 預篩啟用時摘要吃到的是「預篩放行量」:以 min(預篩容量, 進料)×放行率計(預篩容量是清積壓時的上限,積壓清完後每輪能預篩的只有當輪進料)
        const rate = s.summarize.triage.passRate
        const passed = Math.round(Math.min(cap.triage, inflow) * rate)
        if (passed > cap.summarize) {
            warnings.push(`預篩放行上界約 ${passed} 篇（每輪進料 ${inflow}×放行率 ${rate}）大於摘要容量 ${cap.summarize}（${D.summarize}）：放行者萃不完會在摘要關堆積；調高 summarize.rounds 或降 capture.articles.perRun`)
        }
    }
    // 無預篩時 raw 進料全數進摘要關(與預篩關同一個進料上界)
    else if (inflow > cap.summarize) {
        warnings.push(`raw 進料 ${inflow}（${inflowDesc}）大於摘要容量 ${cap.summarize}（${D.summarize}）：抓進來萃不完，raw 會逐輪堆積；調高容量或降名額`)
    }
    return warnings
}

/**
 * 摘要之功能表(唯一一份;抓取套件之 featureProblemsOf 之表):檢定標準之各功能——稱呼(含開啟之設定)、開啟判準、判定小組之必填席、所需之
 *   摘要 domain 之函數成員。執行期件之啟動期檢核、子階段之執行期檢核(summarizeFeatureProblems)、判定小組之開啟與成員之必填(summarizePanelsOf)、
 *   席位檢核工具同讀
 *
 * @type {Array}
 */
export const SUMMARIZE_FEATURES = Object.freeze([
    {
        key: 'repair',
        what: '摘要欄位定向修補呼叫(summarize.standards.repair.enabled)',
        on: (s) => s?.summarize?.standards?.repair?.enabled === true,
        members: ['buildRepairPrompt'],
    },
    {
        key: 'faithCheck',
        what: '筆記忠實性覆核(summarize.standards.faithCheck.enabled)',
        on: (s) => s?.summarize?.standards?.faithCheck?.enabled === true,
        panel: { path: 'summarize.standards.faithCheck.ai', seats: ['first', 'second'] },
        members: ['buildFaithCheckPrompt'],
    },
    {
        key: 'triageConfirm',
        what: '預篩攔下之第二席確認(summarize.standards.triageConfirm.enabled)',
        on: (s) => s?.summarize?.standards?.triageConfirm?.enabled === true,
        panel: { path: 'summarize.standards.triageConfirm.ai', seats: ['first'] },
    },
].map((x) => Object.freeze(x)))

/**
 * 摘要之功能之問題(功能表之單一判定;抓取套件之 featureProblemsOf):已開啟之功能所需之判定小組必填席與摘要 domain 之函數成員
 *
 * @param {Object} settings 輸入已解析之設定(取 summarize)
 * @param {Object} domain 輸入摘要 domain(非物件視為缺全部成員)
 * @param {Object} [o={}] 輸入 { enabled?:Array(開啟之功能鍵;子階段之選項覆寫設定時用), domainLabel?:String }
 * @returns {Array} 回傳問題說明陣列(無問題為空陣列)
 * @example
 * console.log(summarizeFeatureProblems(resolveSummarizeSettings({ summarize: { standards: { triageConfirm: { enabled: true } } } }), {}))
 * // => [ '預篩攔下之第二席確認(summarize.standards.triageConfirm.enabled)已啟用,但缺席位 settings.summarize.standards.triageConfirm.ai.first' ]
 */
export function summarizeFeatureProblems(settings, domain, o = {}) {
    return featureProblemsOf(SUMMARIZE_FEATURES, settings, domain, o)
}

/**
 * 判定小組之定義(唯一一份;core/standards/panelConfig 之小組定義):成對投票之兩席(members 之 0、1)與第三席(members 之 2;判定須兩票明確、相同、
 *   且實際成交之供應者不同才成立;未成立而可成立者叫第三席)。預篩確認之第一票為預篩席本身(未設即摘要席),確認席 first 與之成對
 *
 * @type {Array}
 */
const PANEL_DEFS = Object.freeze([
    {
        std: 'SS5',
        path: 'summarize.standards.triageConfirm.ai',
        name: '預篩攔下之第二席確認',
        members: (s) => [
            { label: '預篩席（summarize.triage.ai，未設即 summarize.ai）', seat: summarizeSeatOf(s.summarize, 'triage'), required: true },
            { key: 'first', label: 'first', seat: s.summarize.standards.triageConfirm.ai.first },
            { key: 'third', label: 'third', seat: s.summarize.standards.triageConfirm.ai.third },
        ],
    },
    {
        std: 'SS14',
        path: 'summarize.standards.faithCheck.ai',
        name: '筆記忠實性覆核',
        members: (s) => ['first', 'second', 'third'].map((k) => ({ key: k, label: k, seat: s.summarize.standards.faithCheck.ai[k] })),
    },
].map((x) => Object.freeze(x)))

/**
 * 摘要之判定小組(席位檢核工具與啟動期同家警告同讀;呼叫端不另寫小組之組成;core/standards/panelConfig 之 panelGroupOf):各組之標準、設定路徑、
 *   名稱、是否開啟、成員(顯示名、席位〔null＝未設〕、是否必填——由功能表推導)與一起投票之組合(ballots:[首票, 次票, 第三席] 之成員索引)
 *
 * @param {Object} settings 輸入已解析之設定(取 summarize;本套件或組裝者之 resolve 產物皆可)
 * @returns {Array} 回傳 [{ std, path, name, on:Boolean, members:[{ label, seat:Object|null, required:Boolean }], ballots:[[0, 1, 2]] }](無 summarize 段回 [])
 * @example
 * console.log(summarizePanelsOf(resolveSummarizeSettings({})).map((g) => `${g.std}:${g.on}`))
 * // => [ 'SS5:false', 'SS14:false' ]
 */
export function summarizePanelsOf(settings) {
    if (!isobj(settings?.summarize)) return []
    return PANEL_DEFS.map((d) => panelGroupOf(d, settings, SUMMARIZE_FEATURES))
}

/** 設定之段(resolveSummarizeSettings 只收此三段;總組裝只交原給之段——不把整份 cfg 交出) */
const SECTIONS = Object.freeze(['ai', 'summarize', 'capture'])

/**
 * 各段逐組覆寫(ai／summarize／capture;capture 委由抓取套件之 resolveCaptureSettings),每組依 schema 驗鍵集、型別與值域(檔頭);
 * 另推導容量(capacity)並產生啟動期警告(warnings):抓取 → 預篩 → 摘要之容量自洽、已開啟之判定小組兩席同家
 *
 * @param {Object} [cfg={}] 輸入執行端設定覆寫物件，非物件時視為{};只收 ai、summarize、capture 三段(總組裝只交原給之段)
 * @param {Object} [cfg.ai] 輸入 AI 調度層與併發之覆寫(鍵見 SUMMARIZE_AI_SCHEMA)
 * @param {Object} [cfg.summarize] 輸入摘要之覆寫(鍵見 SUMMARIZE_SCHEMA)
 * @param {Object} [cfg.capture] 輸入抓取之覆寫(鍵見抓取套件之 CAPTURE_SCHEMA)
 * @returns {Object} 回傳 { ai, summarize, capture, capacity:{ rawInflowMax, gridInflowMax, rawInflowDesc, triage, summarize, notesOut }, warnings:字串陣列 }
 * @throws {Error} 含三段以外之段(打錯之段名若靜默略過,該段即維持預設而無人察覺)、任一組給了但非物件、含不認得之鍵、或值型別與值域不符時拋出
 *   (訊息含完整設定路徑與可用鍵)——不可讓安裝方之設定靜默失效
 * @example
 * let s = resolveSummarizeSettings({ summarize: { rounds: 8, triage: { docsPerCall: 40 } } })
 * console.log(s.summarize.rounds, s.summarize.docsPerCall, s.summarize.triage.docsPerCall, s.capacity.summarize)
 * // => 8 3 40 72
 */
export function resolveSummarizeSettings(cfg = {}) {

    //check
    if (!isobj(cfg)) {
        cfg = {}
    }
    checkKeys(cfg, SECTIONS, 'settings')

    const s = {
        ai: mergeSettingsGroup('ai', cfg.ai, SUMMARIZE_AI_SCHEMA, SUMMARIZE_AI_DEFAULT),
        summarize: mergeSettingsGroup('summarize', cfg.summarize, SUMMARIZE_SCHEMA, SUMMARIZE_DEFAULT),
        capture: resolveCaptureSettings(cfg.capture),
    }
    s.capacity = summarizeCapacityOf(s)
    s.warnings = summarizeWarningsOf(s)
    return s
}

/**
 * 摘要之啟動期警告(容量自洽、已開啟之判定小組兩席同家;resolveSummarizeSettings 之 warnings 即此):他總組裝以自己解析之同形設定
 *   (含 summarize、capture、ai.parallel;其 ai 段可另有本套件不收之鍵)取同一組警告,不另寫判準與字樣
 *
 * @param {Object} settings 輸入已解析之設定 { ai, summarize, capture }
 * @returns {Array} 回傳警告字串陣列
 * @example
 * console.log(summarizeWarningsOf(resolveSummarizeSettings({})))
 * // => []
 */
export function summarizeWarningsOf(settings) {
    return [...capacityWarningsOf(settings, summarizeCapacityOf(settings)), ...panelSameProviderWarnings(summarizePanelsOf(settings))]
}


/**
 * 摘要之 AI 席位表(唯一一份):設定路徑、顯示名、自 settings.summarize 取席位之函數(序同組裝者列席位之序)
 *
 * @type {Array}
 */
const SUMMARIZE_SEATS = Object.freeze([
    { path: 'summarize.ai', label: '摘要', of: (s) => s?.ai },
    { path: 'summarize.triage.ai', label: '預篩', of: (s) => s?.triage?.ai },
    { path: 'summarize.retag.ai', label: '重標', of: (s) => s?.retag?.ai },
    ...panelSeatRowsOf('summarize.standards.triageConfirm.ai', [['first', '預篩確認席'], ['third', '預篩確認第三席']], (s) => s?.standards?.triageConfirm?.ai),
    ...panelSeatRowsOf('summarize.standards.faithCheck.ai', [['first', '忠實性覆核第一席'], ['second', '忠實性覆核第二席'], ['third', '忠實性覆核第三席']], (s) => s?.standards?.faithCheck?.ai),
].map((x) => Object.freeze(x)))

/**
 * 摘要之 AI 席位之顯示名(設定路徑 → 名稱;全部可設之席位,含預設為 null 者;席位檢核工具與報表用)
 *
 * @type {Object}
 */
export const SUMMARIZE_SEAT_LABELS = seatLabelsFrom(SUMMARIZE_SEATS)

/**
 * 摘要之 AI 席位(設定路徑 → 席位;只列已設者——null＝沿用摘要席位或未啟用之空席,不列):啟動期席位檢核、主力供應商計算與席位檢核工具取用,
 *   呼叫端不另寫席位路徑
 *
 * @param {Object} settings 輸入已解析之設定(取 summarize;本套件或組裝者之 resolve 產物皆可)
 * @returns {Object} 回傳 { '<設定路徑>': { use, fallback, … } }
 * @example
 * console.log(Object.keys(summarizeSeatsOf(resolveSummarizeSettings({}))))
 * // => [ 'summarize.ai' ]
 */
export function summarizeSeatsOf(settings) {
    return seatsFrom(SUMMARIZE_SEATS, settings?.summarize)
}


export default {
    SUMMARIZE_AI_DEFAULT, SUMMARIZE_AI_SCHEMA, SUMMARIZE_DEFAULT, SUMMARIZE_SCHEMA,
    resolveSummarizeSettings, summarizeSeatOf, triageEnabledOf, summarizeCapacityOf, SUMMARIZE_CAPACITY_DESC, notesInflowOf, notesInflowProblem, summarizeWarningsOf,
    SUMMARIZE_FEATURES, summarizeFeatureProblems, summarizePanelsOf, SUMMARIZE_SEAT_LABELS, summarizeSeatsOf,
}
