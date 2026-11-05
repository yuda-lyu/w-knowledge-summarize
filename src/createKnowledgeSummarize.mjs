// createKnowledgeSummarize.mjs — 總組裝:通用知識摘要(安裝即用,僅 workDir 必填;逐層可覆寫)
//
// ════════════════ 套件用法 ════════════════
//
//   import W from 'w-knowledge-summarize/src/WKnowledgeSummarize.mjs'
//   const flow = W.createKnowledgeSummarize({ workDir: 'c:/my-kb', data: { vocab: { domain: '天文學' } } })
//   await flow.run()
//
// 擴充入口(每層都有預設):
//   ①cfg 設定覆寫(ai／summarize／capture 逐鍵)            ②cfg.data.vocab 分類法、標注清單、知識庫稱呼與主題範圍、提示詞之領域句
//   ③cfg.prompts 各 AI 角色之提示詞(預篩、摘要、忠實性覆核、修補、重標)  ④cfg.domains 整組置換 domain
//   ⑤cfg.stages 整組自訂子階段／cfg.stageOpts 各內建子階段之 opt(含 tap)   ⑥cfg.aiAdapter 整組置換 AI 調度層
//
// 【執行端不需要的膠水全在此】workDir → 各目錄展開(筆記 md 在 <workDir>/knowledge/notes);lmdb/WOrm 內建(可注入);AI 調度層內建
//   (envFile 給金鑰;cfg.aiAdapter 可整組置換);clock/logFactory 內建。摘要執行期件(資料與詞彙、概念鍵之折疊、素材樣式、domain 與其
//   啟動期檢核、去重身分、網路判斷)一律經 summarizeRuntime 之 createSummarizeRuntime 組裝——與他總組裝同一份,不在此另組。
// 【組裝機制取自抓取套件之總組裝共用件】鍵檢核、目錄、時鐘、提示詞與子階段設定、儲存、日誌工廠／收尾鉤子／調度層之形狀、調度層之建構
//   與事件日誌、集合之開關、每輪之序列與 info() 之共同欄,與抓取之總組裝同一份(經 core/capturePackage);本檔只放摘要專屬者(摘要之鍵集、
//   summarizeRuntime、摘要物件、每輪依賴)與檢核之順序。
// 【時間預算單一來源】整輪軟性截止 deadlineMs、執行鎖陳舊期限 lockStaleMs 與各路徑由抓取套件之 resolveRuntime 一次解析(排程上限
//   cfg.scheduleLimitMin;cfg 明給者優先);管線與 info() 同取此份。各段經 budgetOf(ctx) 消費同一份預算;預篩、摘要、重標三段皆另扣保留給後段之時間
//   (cfg.stageOpts.<triage|summarize|retag>.reserveMs,或組裝者於每輪依賴給一次之 deps.reserveMs〔opt 未給時三段同取〕;本套件不讀他工作之設定):
//   保留 > 0 時各段於開工前與每輪(wave)開工前判「扣保留後剩餘 ≥ 一次呼叫之估計」,不足則少做幾輪、文件留池待下輪(detail.deferred),每次呼叫以「剩餘−保留」封頂;
//   保留未給則行為不變。
// 【開工標記】每輪開工先寫 log/<day>/<stamp>-run.start.json(本輪上限之宣告):被砍的輪次沒有 run.json,外部巡檢逐輪判界靠它。
// 【啟動期檢核】設定(各段 schema)、cfg 各鍵之形狀、資料、提示詞、domain、子階段、啟用之功能所需之 domain 成員與判定小組席位、AI 席位
//   (use／fallback 全部可解析)皆於建構期驗——打錯之鍵、缺金鑰或 id 打錯要在啟動期爆,不是靜默沿用預設或跑到第一次呼叫才被子階段當單次
//   失敗吞掉。形狀錯誤之訊息先於席位檢核(席位檢核在最後)。
// 【AI 調度層之建構選項】失敗預覽(preview)與條目固有之 prompt 長度預篩(capability)開啟:批次摘要之失敗須看得到模型回了什麼,長 prompt
//   (預篩長文另附中段、批量數十篇)須在呼叫前避開放不下之條目。截斷放行(acceptTruncated)不在建構期開:陣列輸出之呼叫點(預篩、摘要、重標)
//   逐次給,物件輸出之修補與覆核不給——注入同一調度實例給多個工作共用時,各工作之呼叫互不影響。
// 【調度層事件寫入當輪日誌】ai.pools／ai.healthStreak(摘要預設 3)／ai.providerLimits 開啟時,供應商額度／健康／能力之事件以 WARN 寫入
//   當輪日誌(注入 cfg.aiAdapter 時不接,調度層屬注入方)。
// 【收尾在管線之外、摘要之後】每輪結束依序:①符合度掃描(summarize.standards.scanEachRun 開時;計數入執行摘要,本輪已逾時間預算者略過)
//   ②寫結構化摘要 run.json ③收尾鉤子(cfg.afterRun 給函數才跑;本套件無內建巡檢)。收尾讀 run.json 時當輪的已存在;掃描與收尾失敗只留
//   warn,不影響本輪成敗。
// 【核心集合為選用】cfg.cores 開啟(true 或集合名)才加開 cores 集合(唯讀;擠在一個標籤之多概念以「各段皆為既有概念」為拆分條件,既有概念
//   另含核心之概念);未開時既有概念只取筆記。

import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import {
    normalizeWorkDir, resolveRuntime, runtimeCfgOf,
    checkKeys, resolveDirsCfg, resolveClockCfg, resolvePromptsCfg, checkDataKeys, checkStageConfig, checkOptionalCollections, resolveLmdbCfg,
    resolveLogFactory, resolveAfterRun, checkAiAdapter, createRoundLog, buildAiAdapter, startupWarningsOf,
    createStoreOpener, pipelineNameOf, createRoundRunner, assemblyInfoOf, standardsCountsOf,
} from './core/capturePackage.mjs'
import { resolveSummarizeSettings, summarizeSeatsOf } from './core/summarizeSettings.mjs'
import { createSummarizeObject, SUMMARIZE_STAGE_KEYS } from './summarizeObject.mjs'
import { createSummarizeRuntime, SUMMARIZE_STORE_KEYS, SUMMARIZE_DATA_KEYS, SUMMARIZE_DIRS, SUMMARIZE_PROMPT_SIGS } from './summarizeRuntime.mjs'
import { auditSummarizeStandards, summarizeScanOf } from './standards/audit.mjs'

/**
 * cfg 之全部可用鍵(本檔、summarizeRuntime、core/summarizeSettings 讀取者之聯集;交抓取套件 resolveRuntime 者經其 runtimeCfgOf 逐鍵讀出〔RUNTIME_CFG_KEYS〕):
 *   不在此者於組裝期拋錯——打錯之鍵若靜默接受,正名鍵會維持預設而無人察覺。新增讀取 cfg.<鍵> 處須同步列入
 *
 * @type {Array}
 */
export const CFG_KEYS = Object.freeze([
    'workDir', 'name', 'dirs', 'timeZone', 'clock', 'lang', 'data', 'prompts', 'domains', 'conceptFold',
    'ai', 'summarize', 'capture',
    'scheduleLimitMin', 'deadlineMs', 'lockStaleMs', 'lock', 'envFile', 'aiWorkspace', 'aiAdapter', 'aiOptions',
    'stages', 'stageOpts', 'dedup', 'lmdb', 'cores',
    'logFactory', 'afterRun', 'netGuard',
])

/**
 * cfg.data 之可用鍵(即摘要所讀之資料鍵,summarizeRuntime 之 SUMMARIZE_DATA_KEYS)
 *
 * @type {Array}
 */
export const DATA_KEYS = SUMMARIZE_DATA_KEYS

/**
 * cfg.prompts 之可用鍵(提示詞覆寫;各鍵之函數形式見 summarizeRuntime 之 SUMMARIZE_PROMPT_SIGS,輸出契約固定)
 *
 * @type {Array}
 */
export const PROMPT_KEYS = Object.freeze(Object.keys(SUMMARIZE_PROMPT_SIGS))

/**
 * 集合之對外名(cfg.lmdb.cls 之可用鍵):摘要所用之集合(summarizeRuntime 之 SUMMARIZE_STORE_KEYS)＋cores(僅於 cfg.cores 開啟時開啟)
 *
 * @type {Array}
 */
export const COLLECTION_KEYS = Object.freeze([...SUMMARIZE_STORE_KEYS, 'cores'])

/** 內建管線名(日誌與執行摘要 run.json 之 name;cfg.name 給了即取代) */
const PIPELINE_NAME = '知識摘要'

/** AI 調度層之建構選項(檔頭【AI 調度層之建構選項】) */
const AI_ADAPTER_OPT = Object.freeze({ preview: true, capability: true })

/**
 * 總組裝:通用知識摘要(安裝即用,僅 workDir 必填;擴充入口見檔頭)
 *
 * @param {Object} [cfg={}] 輸入設定物件，非物件時視為{}(再由 workDir 檢查拋錯)；可用鍵見 CFG_KEYS
 * @param {String} cfg.workDir 輸入工作目錄路徑字串(唯一必填:所有輸出的路徑錨點)
 * @param {String} [cfg.name] 輸入管線名(日誌之管道名與執行摘要 run.json 之 name)，未給用內建名「知識摘要」
 * @param {Object} [cfg.dirs] 輸入目錄逐鍵覆寫(鍵:db、log、tmp、state、knowledge、notes)
 * @param {String} [cfg.timeZone='Asia/Taipei'] 輸入 IANA 時區(日誌時間戳、檔名、「今日」判定之基準;不依系統時區)
 * @param {Object} [cfg.clock] 輸入時鐘物件(wsemi 之 genClockTZ 產物)，給了即不依 timeZone 建立
 * @param {String} [cfg.lang='zh-TW'] 輸入語言設定(BCP 47 代碼;抓取套件之 resolveLocale):提示詞之輸出語言句、筆記標準 SS3 之適用(只有繁體中文有字形標準,
 *   其餘語言列不適用、納入閘不轉字形)、概念鍵之繁簡折疊(中文才折)、slug 之字元政策依之;預設繁體中文
 * @param {Object} [cfg.data] 輸入資料 { vocab:詞彙覆寫 }(鍵見 core/vocab/summarizeVocab 之 SUMMARIZE_VOCAB_KEYS)
 * @param {Object} [cfg.prompts] 輸入提示詞覆寫 { triage?, summarize?, faith?, repair?, retag? }(函數形式見 summarizeRuntime 之 SUMMARIZE_PROMPT_SIGS;輸出契約固定)
 * @param {Object} [cfg.domains] 輸入整組置換之 domain { triage?, summarize?, retag? }(須具備內建之全部成員;同時作用於管線與 info();摘要 domain 帶 locale 者須與 cfg.lang 同一語言)
 * @param {Boolean|Function} [cfg.conceptFold] 輸入概念與線索鍵之字形折疊：false 停用、函數自訂、true 內建繁簡折疊、未給依語言設定(中文折、其他不折)
 * @param {Object} [cfg.ai] 輸入 AI 調度層覆寫(鍵見 core/summarizeSettings 之 SUMMARIZE_AI_SCHEMA；席位在 summarize 段)
 * @param {Object} [cfg.summarize] 輸入摘要設定覆寫(鍵見 core/summarizeSettings 之 SUMMARIZE_SCHEMA)
 * @param {Object} [cfg.capture] 輸入抓取設定覆寫(交抓取套件驗;本套件只用素材退回抓取之欄位與 raw 進料上界)
 * @param {Number} [cfg.scheduleLimitMin] 輸入排程執行上限分鐘數，時間預算與鎖陳舊期限由此推導
 * @param {Number} [cfg.deadlineMs] 輸入整輪軟性截止毫秒數，未給由排程上限推導
 * @param {Number} [cfg.lockStaleMs] 輸入執行鎖陳舊期限毫秒數(持鎖者宣告值)
 * @param {Boolean|String} [cfg.lock] 輸入執行鎖：false 不上鎖、true 或未給用 <dirs.tmp>/run.lock、字串為鎖檔路徑
 * @param {String} [cfg.envFile] 輸入金鑰檔路徑(相對者以 workDir 為基準)，預設 <workDir>/.env
 * @param {String} [cfg.aiWorkspace] 輸入 AI 子進程工作目錄，預設 <workDir>/tmp/ai-workspace
 * @param {Object} [cfg.aiAdapter] 輸入整組置換之 AI 調度層(須具 callJson(prompt, check, { spec, budgetMs?, shouldStop?, avoid?, acceptTruncated? }))，
 *   未給用內建調度層
 * @param {Object} [cfg.aiOptions] 輸入內建調度層之建構選項(安裝端之資產 { providerPick?, exes?, persistStore?, usageCounter? };鍵見抓取套件之 AI_OPTIONS_KEYS),
 *   注入 aiAdapter 時不用
 * @param {Array} [cfg.stages] 輸入整組自訂之子階段陣列({ name, run(ctx) })，給了即取代內建子階段(與 stageOpts 擇一)
 * @param {Object} [cfg.stageOpts] 輸入各內建子階段之 opt { triage, summarize, retag, sync }(含 tap;triage／summarize／retag 之 reserveMs 為保留給後段之時間,
 *   未給取每輪依賴之 deps.reserveMs)
 * @param {Object} [cfg.dedup] 輸入去重身分設定(w-data-pipeline createIdentity;與抓取同一身分)，預設抓取套件之 DEFAULT_DEDUP
 * @param {Object} [cfg.lmdb] 輸入 { WOrm?, path?(預設 dirs.db), db?(預設 'knowledge'), cls?(集合名覆寫) }
 * @param {Boolean|String} [cfg.cores=false] 輸入核心集合:true 或集合名 → 唯讀加開 cores(既有概念另含核心之概念)
 * @param {Function} [cfg.logFactory] 輸入日誌工廠 () => logger，預設每輪一檔 log/<day>/<stamp>-run.log
 * @param {Function|Boolean} [cfg.afterRun] 輸入收尾鉤子 ({ report, summaryFile, log, deps }) => 結果，false 或未給即無
 * @param {Object|null} [cfg.netGuard] 輸入本機網路判斷器(整組置換)；null＝不判斷；未給依 settings.capture.network 建立
 * @returns {Object} 回傳 { run:Function, openStores:Function, closeStores:Function, info:Function }
 * @throws {Error} cfg.workDir 非有效字串、cfg 含不認得之鍵、settings 各段不合 schema、cfg 各鍵形狀不合(見各檢核)、素材樣式無法編譯、
 *   詞彙表不合規格、domain 不合規格、啟用之功能缺 domain 成員或判定小組席位，或 AI 席位無法解析時拋出
 * @example
 * need test in nodejs.
 *
 * let flow = createKnowledgeSummarize({ workDir: 'c:/my-kb', data: { vocab: { domain: '天文學' } } })
 * let report = await flow.run()
 * console.log(report.ok)
 */
export function createKnowledgeSummarize(cfg = {}) {

    //check
    if (!isobj(cfg)) {
        cfg = {}
    }
    if (!isestr(cfg.workDir)) {
        throw new Error('createKnowledgeSummarize 需要 workDir（唯一必填：所有輸出的路徑錨點）')
    }
    checkKeys(cfg, CFG_KEYS, 'cfg')
    const pipelineName = pipelineNameOf(cfg.name, PIPELINE_NAME)

    const workDir = normalizeWorkDir(cfg.workDir)

    // ── 路徑(workDir 展開,筆記 md 之目錄為下游目錄 extra;cfg.dirs 逐鍵覆寫,打錯之目錄鍵若靜默接受,該目錄會落在預設處)──
    const dirs = resolveDirsCfg(workDir, cfg.dirs, SUMMARIZE_DIRS)

    // ── 設定與資料(內建預設＋覆寫;形狀錯誤一律啟動期拋錯)──
    const settings = resolveSummarizeSettings({ ai: cfg.ai, summarize: cfg.summarize, capture: cfg.capture })
    const clock = resolveClockCfg(cfg.clock, cfg.timeZone)
    // cfg.data 之鍵集(只認詞彙覆寫 vocab;形狀之檢核在 summarizeRuntime 之 resolveSummarizeData,與他總組裝同一份)
    checkDataKeys(cfg.data, DATA_KEYS)
    const prompts = resolvePromptsCfg(cfg.prompts, SUMMARIZE_PROMPT_SIGS)
    // 摘要執行期件(summarizeRuntime;與他總組裝同一份):資料、素材樣式編譯、詞彙、概念鍵之折疊、domain(cfg.prompts 覆寫提示詞、cfg.domains
    //   整組置換——明交 opt.domains,執行期件不讀 cfg.domains)與啟用功能之檢核、去重身分、網路判斷——設定錯誤一律於此拋
    const rt = createSummarizeRuntime(cfg, settings, { prompts, domains: cfg.domains })

    // ── 其餘 cfg 鍵之形狀(先於 AI 組裝:設定形狀錯誤的訊息不該被席位檢核搶先)──
    checkStageConfig(cfg.stages, cfg.stageOpts, SUMMARIZE_STAGE_KEYS)
    // 選開之集合:核心(檔頭【核心集合為選用】)
    const optional = { cores: { value: cfg.cores, label: '核心' } }
    const optionalOn = checkOptionalCollections(optional)
    const mkLog = resolveLogFactory(cfg.logFactory, { dir: dirs.log, clock })
    const afterRun = resolveAfterRun(cfg.afterRun)
    checkAiAdapter(cfg.aiAdapter)

    // ── LMDB(WOrm 內建,可注入替換;集合名可覆寫,預設即對外名——與抓取共用一庫時不必遷移)──
    const lmdb = resolveLmdbCfg(cfg.lmdb, dirs, { keys: COLLECTION_KEYS, optional })
    const storeNames = [...SUMMARIZE_STORE_KEYS, ...optionalOn]

    // ── 執行期生效值(排程上限/時間預算/鎖/路徑之單一來源;管線與 info() 同取此份)──
    const runtime = resolveRuntime(runtimeCfgOf(cfg), { workDir, dirs })

    // ── AI 調度層(內建;cfg.aiAdapter 整組置換——測試替身／共用之調度實例皆走這裡);網路判斷經 summarizeRuntime 之 isNetDown 詢問同一份
    //    netGuard;調度層之事件(額度／健康／能力)寫入當輪日誌 ──
    const roundLog = createRoundLog()
    const ai = buildAiAdapter({ aiAdapter: cfg.aiAdapter, options: cfg.aiOptions, ai: settings.ai, envFile: runtime.envFile, workspace: runtime.aiWorkspace, clock, lang: rt.locale.code, isNetDown: rt.isNetDown, roundLog, adapterOpt: AI_ADAPTER_OPT })
    // 啟動期席位檢核(檔頭):不可解析即拋;席位清單取 summarizeSeatsOf(席位路徑只在 core/summarizeSettings 定義)。
    //   執行期生效值之警告(無效值、未給上限)與設定自洽警告(容量、判定小組同家)併入:每輪開頭以「啟動期檢核：」記入日誌
    const startupWarnings = startupWarningsOf(ai, summarizeSeatsOf(settings), [runtime.warnings, settings.warnings])

    // ── 摘要物件:自訂子階段整組置換;否則內建子階段＋各子階段 opt ──
    const summarizeObject = createSummarizeObject(cfg.stages ? { stages: cfg.stages } : (cfg.stageOpts || {}))

    // ── 集合之開關:摘要所用之集合＋選開之核心集合 ──
    const { openStores, closeStores } = createStoreOpener(lmdb, storeNames)

    /**
     * 每輪依賴(deps):套件子階段與執行端自寫子階段同一條注入通道。
     *
     * 【只放可列舉之普通屬性】w-data-pipeline 之管線建脈絡時以 spread 複製 deps({ ...parentCtx.deps, ...spec.deps });getter
     *   (Object.defineProperty 預設 enumerable:false)在 spread 時直接消失 → 子階段拿到 undefined、每輪靜默失敗。
     *
     * @param {Object} stores 輸入 openStores 之產物
     * @returns {Object} 回傳依賴物件 { stores, clock, dirs, data(安裝方原給之資料), vocab(已解析之詞彙表), locale(語言設定), settings, ai, domains(生效之一份) }
     */
    const buildDeps = (stores) => ({
        stores,
        clock,
        dirs,
        data: rt.data,
        vocab: rt.vocab,
        locale: rt.locale,
        settings,
        ai,
        domains: rt.domains,
    })

    /**
     * 執行一輪摘要(寫開工標記 → 開集合 → 跑管線(鎖、時間預算) → 寫執行摘要 → 收尾鉤子(可選) → 關集合)
     *
     * @returns {Promise} 回傳 Promise，resolve 回傳 report(runPipeline 之產物,另含 summaryFile 與 afterRun(收尾鉤子之回傳值));
     *   未取得執行鎖時 report.lockSkipped 為 true,不寫摘要、不觸發收尾鉤子
     */
    const run = createRoundRunner({
        name: pipelineName,
        dirs,
        clock,
        mkLog,
        startupWarnings,
        runtime,
        openStores,
        closeStores,
        buildDeps,
        stages: [summarizeObject],
        ai,
        roundLog,
        // 符合度掃描(settings.summarize.standards.scanEachRun;預設關):本輪管線之後、執行摘要之前,掃可逐件判定之筆記標準
        //   (與新進閘同一判定;SS4 讀原文)與 AI 標準之待判(SS9／SS14 之待判登錄),經 standards/audit 之 summarizeScanOf 整形為各工作同一形狀,
        //   計數(抓取套件之 standardsCountsOf;各工作同形——含 AI 列之未結待判數)入 run.json 之 standards
        scan: {
            enabled: () => settings.summarize.standards.scanEachRun === true,
            audit: async ({ stores, deps }) => summarizeScanOf(await auditSummarizeStandards({ stores, vocab: deps.vocab, locale: deps.locale }, { material: true })),
            countsOf: standardsCountsOf,
        },
        afterRun,
    })

    return {
        run,
        /** 維運入口(工具用):同一套集合定義,呼叫端自負開關 */
        openStores,
        closeStores,
        /**
         * 維運入口:不開管線時取得依賴與執行期生效值(與管線實際使用同源)
         *
         * @returns {Object} 回傳 { dirs, settings, clock, ai, domains(＝每輪 deps.domains 同一物件), identity(去重身分;管線外登記文件之 id 須經之,
         *   如 ingestNotes), locale(語言設定), lmdb, data, vocab(已解析之詞彙表), deadlineMs, lockStaleMs, startupWarnings, scheduleLimitMin(未給為 null), envFile,
         *   aiWorkspace(注入 cfg.aiAdapter 時為 null), lockFile(cfg.lock 為 false 時為 null), collections(openStores 開啟之集合對外名) }；
         *   envFile／aiWorkspace／lockFile 為絕對路徑(相對路徑以當下 cwd 解析,與實際讀寫相同)
         */
        info: () => assemblyInfoOf({
            dirs,
            settings,
            clock,
            ai,
            domains: rt.domains,
            extra: { identity: rt.identity, locale: rt.locale },
            lmdb,
            data: rt.data,
            vocab: rt.vocab,
            runtime,
            startupWarnings,
            collections: storeNames,
        }),
    }
}

export default createKnowledgeSummarize
