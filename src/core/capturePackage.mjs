// capturePackage.mjs — 抓取套件(npm 套件 w-knowledge-capture)之單一匯入點
//
// 【為何單一匯入點】本套件除抓取套件外不 import 任何其他專案程式碼;取抓取套件之件一律經本檔——抓取套件之指定詞只在本檔
//   ('w-knowledge-capture/src/WKnowledgeCapture.mjs';自有套件發布後 main 指 UMD、原始碼在 src/,取 ESM 入口一律以「套件名/src/入口檔」)。
// 【明列名稱＝抓取埠】本套件依賴抓取套件之哪些件一目瞭然;新增依賴先列於此,不在他檔直接 import 抓取套件。只列套件程式碼所需之名
//   (測試另需者經測試專用之橋接 test/tools/captureForTest.mjs;unit-summarize-package ① 驗每一名皆有非測試檔取用)。
// 【抓取之知識只在抓取套件】文件狀態機、素材退回抓取之欄位、原文另存、待探索線索、去重身分、raw 進料上界、概念鍵之折疊——
//   本套件只呼叫其 API,不另寫一份(讀抓取設定或判斷抓取狀態前先找抓取套件之 API)。
// 【核心件同一實作】管線秩序(kernel)、時間預算、判定形狀、正體、文字與概念鍵、小工具、時鐘、路徑、鎖、執行期、日誌、執行摘要、
//   設定合併規則、AI 調度層、物件共用件、待判登錄取自抓取套件(時鐘、鎖、日誌、執行摘要與 AI 調度層經總組裝共用件取用,套件程式碼不直接呼叫者
//   不列於本埠);本套件之 core/ 只放抓取套件沒有之模組(與其 core/ 不得有同相對路徑之檔)。

export {
    // ── ① 核心件:管線秩序、時間預算、判定形狀、正體(非本篇文字之片段、證據規則之比對前折疊)、語言設定(字形政策、輸出語言稱呼)、文字與概念鍵、小工具(含值之字串化、命令列之直接執行判定)──
    defineMw, applyTaps, rejectChainOpts, makeMsg, count, runChainOverMsgs, stdReport,
    budgetOf, reserveOf, reserveMsOf,
    STATUS, result, fromProblems,
    withoutForeignSpans, toTw,
    DEFAULT_LANG, SCRIPT_NA_DETAIL, resolveLocale, scriptOf, scriptApplies,
    sha1, normalizeConcept, slugify, cutAtBoundary,
    oneline, queueAge, readJson, writeFileAtomic, strOf, textValueOf, isDirectRun,
    toPatterns,
    // ── ② 路徑、執行期生效值(與交之 cfg 鍵)──
    normalizeWorkDir, resolveRuntime, runtimeCfgOf,
    // ── ③ 設定合併規則、席位表、詞彙(抓取共用之鍵;詞彙表解析之共用件——頭之政策、子集、guide 之合併、改名鏈)、折疊之套用／身分／網路判斷之共用判準 ──
    AI_DEFAULT, AI_SCHEMA, mergeSettingsGroup, cloneSettingsDefault, resolveCaptureSettings, seatsFrom, seatLabelsFrom,
    resolveVocab as resolveCaptureVocab, captureVocabDefaultOf, kbLabelOf, pickCaptureVocab, vocabHeadOf, pickVocabKeys, mergeGuideFields, renameChainProblems,
    applyConceptFold, captureIdentityOf, captureNetGuardOf,
    // ── ④ 抓取資料之 API:文件生命週期、原文另存、待探索線索、記錄形狀、素材退回抓取、raw 進料上界;筆記之「已被下游消化」(欄位之單一宣告)──
    byRetryTierFifo, DOC_STATUS, docTextOf, docTextRestoreOf, saveClues, externalDocOf, textFromLabelOf,
    refetchRequestOf, captureCapacityOf, SKIP_KIND_MATERIAL, noteConsumedOf,
    // ── ⑤ 物件共用件(子階段序列執行、摘要組裝、物件 report)──
    stageFields, subOpt, runSubStages, summaryOf, objectReport,
    // ── ⑥ 檢定標準共用件(符合度掃描之累計器、總覽之形狀與計數摘要;待判登錄——鍵、登錄、結案、列出;存量處置之帳協定與待判件)──
    createStandardsTally, standardsScanOf, standardsCountsOf,
    holdKey, putHold, resolveHold, listHolds, holdDeadlineOf, retryRequestedOf,
    stockLedgerFileOf, stockAtOf, stockLedgerRowsOf, stockLedgerWriter, appendRollbackRow, rollbackPlanOf, rollbackWriteOf, sameValue, stockErrorOf, holdStockUnfixable, rollbackStockHold, stockHoldProblems,
    // ── ⑦ 總組裝共用件(與工作內容無關之組裝機制:鍵檢核、目錄、時鐘、提示詞覆寫之驗證與套用〔cfg 層、執行期件、domain 工廠同一份:覆寫之 ctx、
    //   可覆寫成員、鍵之歸屬與子集〕與其和注入 domain 之衝突、domain 之注入與合併、cfg.data 之鍵集與解析、子階段設定、選開集合、lmdb、日誌、
    //   調度層之建構、啟動期警告、功能表之必填檢核、集合開關、每輪 run、info 共同欄、主入口之合成)──
    checkKeys, resolveDirsCfg, resolveClockCfg, resolvePromptsCfg, promptOverridesOf, promptCtxOf, overridablePrompt, promptDomainOf, promptsForDomain, promptDomainConflicts, mergeDomains,
    checkDataKeys, resolveDataCfg, checkStageConfig, checkOptionalCollections, resolveLmdbCfg,
    resolveLogFactory, resolveAfterRun, checkAiAdapter, createRoundLog, buildAiAdapter, startupWarningsOf,
    featuresOnOf, featureProblemsOf, createStoreOpener, pipelineNameOf, createRoundRunner, assemblyInfoOf, composeNamespaces,
    // ── ⑧ AI 能力評分之角色化核心(角色之定義、多角色之命令列〔含單角色之執行與準備〕、命令列之參數、免費受測名單;角色作者之共用小件)──
    defineBenchRole, defineBenchRoles, benchArgPint, DEFAULT_FREE_MODELS,
    typeName, chunk, groupBy, vocabKeyOf, inputVocabProblemsOf, domainNeedsOf, noVerdict, benchPintOf, batchOption,
    // ── ⑨ 日誌契約:核心件(總組裝共用件之每輪序列、AI 調度層之事件、本機網路判斷)所發之字樣(本套件之契約以之組成)──
    CORE_LOG_KNOWN, CORE_LOG_MUST_SEE,
} from 'w-knowledge-capture/src/WKnowledgeCapture.mjs'
