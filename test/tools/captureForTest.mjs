// captureForTest.mjs — 測試專用之抓取橋接(只供測試;套件程式碼不得 import 本檔——邊界檢查只許本檔與 core/capturePackage.mjs 引用抓取套件,
//   且非測試檔一律不得引用 test/ 下之檔)
//
// 【為何需要】素材退回抓取之往返(摘要判素材壞了而退回 → 抓取以排除之方法重抓 → 摘要再取到同一文件)須以抓取套件之真實子階段驗
//   兩側讀寫之欄位一致;這些件(補全文子階段、瀏覽器抓取器、佇列之分法)是抓取之內部積木,本套件之程式碼用不到,故不列入抓取埠
//   (core/capturePackage.mjs 只列套件程式碼所需之名——unit-summarize-package ① 自動驗)。測試另需之時鐘、目錄、鎖、日誌、設定型別、
//   調度層、文件狀態、原文另存、去重預設、評分核心、待判登錄之使用者處置(重試要求、豁免)、存量處置帳之檔名與概念折疊之單例
//   (套件程式碼經 applyConceptFold 設定;測試直接設定與清除)之件亦經本檔取用。
// 【領域中立詞表】四套件之中立掃描共用抓取套件之測試詞表(其 test/tools/domainTerms;自檢在抓取套件之 unit-domain-terms)——同一規則只一份。
// 【共用測試件】記憶體集合(memStore)、靜音日誌(nullLogger)、位置無關之共用件(testKit:日誌之替身、暫存根之工廠、子階段 report、集合之開關、
//   AI 調度層之替身 stubAdapter…)、
//   原始碼之詞法器(sourceScan)、假 OpenAI 相容伺服器(fakeRest)、提示詞標準檔之比對與重產(promptGolden)、舊名與沿革及面向使用者字樣之判準
//   (historyMarks)皆在抓取套件之 test/tools(四套件同一份),本套件之測試經本檔取用。
// 【只轉出測試所需之名】新增前先確認抓取埠沒有、且確為測試所需;每一名須被本套件 test/ 下至少一檔具名取用(尚無自動守門案,以規則帳本 GEN-22 ③ 之人工盤點代之)。
// 【指定詞】抓取套件為 npm 套件:主入口 'w-knowledge-capture/src/WKnowledgeCapture.mjs'(同抓取埠)、測試件 'w-knowledge-capture/test/tools/<檔>'(隨其 tarball 發布)。

export {
    stageDetailFetch, createBrowserFetcher, docQueuesOf, showSettingValue,
    genClockTZ, expandDirs, acquireLock, SETTING_TYPES, createAiAdapter,
    DOC_STATUSES, archiveDocText, DEFAULT_DEDUP,
    validateBenchCases, loadBenchCases, planBench, BENCH_FAIL_KINDS, writeBenchReport, BENCH_BOARD_HEADER,
    requestRetry, waiveHold, STOCK_LEDGER_FILE,
    setConceptFold, conceptFoldsOf, RUNTIME_CFG_KEYS,
    toTwKeepLinks, SCRIPT_NONE,
} from 'w-knowledge-capture/src/WKnowledgeCapture.mjs'
export { DOMAIN_TERMS, DOMAIN_TERM_RE, domainTermsIn } from 'w-knowledge-capture/test/tools/domainTerms.mjs'
export { memStore } from 'w-knowledge-capture/test/tools/memStore.mjs'
export { nullLogger } from 'w-knowledge-capture/test/tools/nullLogger.mjs'
export {
    pkgRootOf, tmpRootsOf, removeRoots, silentLog, recLog, plainLog, logsOf, fileLogFactory, resetConceptFold, subReport, withStores, findFiles, readJsonFile,
    FIXED_CLOCK, msgOf, sleep, stubAdapter, parseCsv,
} from 'w-knowledge-capture/test/tools/testKit.mjs'
export { lexSource, scanSource, specifiersOf, exportedNamesOf, namedImportsOf } from 'w-knowledge-capture/test/tools/sourceScan.mjs'
export { startServer } from 'w-knowledge-capture/test/tools/fakeRest.mjs'
export { runPromptGolden, goldenDiffOf } from 'w-knowledge-capture/test/tools/promptGolden.mjs'
export { HOST_CLI, historyHitsOf, userTextHitsOf, historyScanOf, userTextScanOf, benchCaseNotesOf } from 'w-knowledge-capture/test/tools/historyMarks.mjs'
