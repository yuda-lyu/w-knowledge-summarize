# 處理要點（w-knowledge-summarize）— 變更與驗收之共通要點

> 本檔屬本套件之處理要點（共通部分：變更與驗收流程、模組英文名、設定結構、語言設定）。條文所列路徑除註明外皆相對套件根；規則 ID 沿用最初編號，缺號者（流程 1、4、6、7、8 等屬使用端運維者）見索引〈已移出〉。
> 現況以 `sgud/state/state.md` 與 `README.md` 為準。

## 本套件之變更與驗收(2026-10-11 起)

**背景**:本套件為通用知識摘要套件(領域中立),只依賴抓取套件 `w-knowledge-capture`(經單一匯入點 `src/core/capturePackage.mjs`)與 `wsemi`(GEN-11);使用端以 `w-knowledge-summarize/src/…`、`w-knowledge-summarize/test/tools/…` 深層路徑取用(GEN-18).
- **只有一份之機制**:AI 調度層(遞補、冷卻、健康、免費池額度、能力預篩、斷網不計)、執行期生效值 `resolveRuntime`、總組裝共用件取自抓取套件(經 `src/core/capturePackage.mjs`),本套件不另寫一份——要改這些機制改抓取套件.
- **只放新格式＋新工作流**(2026-10-03 使用者指示,沿用至各套件):不含舊版相容、舊資料遷移、舊名退路;既有資料之處理一律由使用端另寫一次性工具,不進本套件(GEN-04).

### 流程

- **2. 套件測試一律自套件根**:`npm test`(＝`mocha --parallel "test/*.test.mjs" --timeout 180000`);單檔去掉 `--parallel` 換檔名(README §14);暫存落 `test/_tmp/<名>-<pid>`、測完刪除.**不自套件根以外之目錄直跑本套件測試檔**,且測試之掃描／匯入根一律取自測試檔位置、不用 cwd(GEN-09)——逐檔 import 掃到有頂層副作用之入口腳本,等於執行它.
- **3. 改設定鍵須知(2026-10-03 起)**:本套件對 `ai`／`summarize`／`capture` 各段以 schema 驗鍵集、型別與值域(summarize 段 `SUMMARIZE_SCHEMA`、ai 段 `SUMMARIZE_AI_SCHEMA`,皆在 `src/core/summarizeSettings.mjs`;capture 段由抓取套件之 `resolveCaptureSettings`／`CAPTURE_SCHEMA` 驗),頂層 cfg 鍵以 `CFG_KEYS`(`src/createKnowledgeSummarize.mjs`)驗——**打錯鍵、數字寫成字串、區段形狀錯皆於建構期拋錯、整輪不執行**(不靜默回套件預設).`ai` 段不收 `workspace`(AI 工作目錄由頂層 `cfg.aiWorkspace` 給,預設 `<workDir>/tmp/ai-workspace`).改完先跑 `unit-settings` 與 `unit-summarize-assembly`(後者含 `CFG_KEYS` 與讀者對測).
- **5. prompt 逐字相同檢查**:自套件根 `node test/tools/genPromptGolden.mjs`(只比對、不寫檔;離開碼 0＝與 `test/golden/prompts-default.json` 逐字相同,否則逐鍵列出不同者).有差異即預設提示詞變了——查明是否刻意;若是,確認差異皆為刻意變更並取得同意後才以 `--write` 重產標準檔,且該角色既有評比結果失效:評比表 `模型評比.csv` 各列之「提示詞指紋」與 `planSummarizeBench(role, opt).promptFp` 不同者為舊提示詞所評,以同角色同模型重評即覆蓋(README §13).

### 模組之英文名(2026-10-03 使用者指定,一律統一、不得另創或沿用舊名;GEN-01)

| 中文 | 英文(目錄、設定之工作段、hook 前綴、物件工廠、欄位) | 曾用舊名(已全數改掉,不得再出現於 src／test／README／設定) |
|---|---|---|
| 抓取 | `capture`(`cfg.capture`、`CAPTURE_SCHEMA`;實作屬抓取套件) | fetch(設定區段名、物件工廠名) |
| 摘要 | `summarize`(`cfg.summarize`〔`summarize.ai`、`summarize.docsPerCall`、`summarize.charsPerDoc`、`summarize.rounds`…〕、`createKnowledgeSummarize`／`createSummarizeObject`、hook `summarize.triage`／`summarize.summarize`、docs 欄位 `summarizeTries`、狀態 `summarize-failed`、評比角色 `summarize`) | extract(萃取義;如 `extractTries`、`extract-failed`)、organize／彙整(物件層) |

- 中文模組名一律「摘要」(不稱「萃取」「彙整」);「萃取」字樣留在 prompt 原文(「你是…的萃取器」,改了即改 prompt 與 `test/golden` 標準檔,見流程 5).
- 套件只認新欄位 `summarizeTries`／`summarize-failed`,不讀舊欄位 `extractTries`／`extract-failed`;既有庫之欄位改名由使用端另寫一次性工具(GEN-04).

### 設定結構(2026-10-06 設定依工作改版;不認得之鍵〔含已改名之舊鍵〕一律拋錯、不留相容)

- **結構**:cfg 之設定三段 `ai`(AI 調度層與併發)、`summarize`、`capture`(`resolveSummarizeSettings` 只收此三段,其他段名即拋);`summarize` 段依要點分組,檢定標準在 `summarize.standards` 組(含 `scanEachRun`),AI 席位在用到它的那一組(鍵名 `ai`;判定小組席名 `first`／`second`／`third`).只給想調的鍵,其餘沿用預設(組逐鍵合併;席位、樣式陣列給了即整個取代).`capture` 段交抓取套件驗.推導值在 `settings.capacity`(`summarizeCapacityOf`;`info().settings` 即其生效值).鍵之語意見 README §5(GEN-03).
- **席位清單之名稱**(`summarizeSeatsOf`,只列已設者;顯示名 `SUMMARIZE_SEAT_LABELS`;判定小組之組成 `summarizePanelsOf`;啟動期檢核與席位檢核工具共用):`summarize.ai`、`summarize.triage.ai`、`summarize.retag.ai`、`summarize.standards.triageConfirm.ai.{first,third}`、`summarize.standards.faithCheck.ai.{first,second,third}`(null 之選填席位不列).
- **語言設定 `cfg.lang`(2026-10-28 四套件界定審計 S5;GEN-20)**:總組裝 `createKnowledgeSummarize` 收頂層 `lang`(BCP 47 代碼,在 `CFG_KEYS`;解析取抓取套件 `core/locale.mjs` 之 `resolveLocale`,`info().locale` 為解析後之語言設定),決定提示詞之輸出語言句、正體標準 SS3 之適用、概念鍵之繁簡折疊與筆記 slug 之字元政策.**不給即預設 `zh-TW`,行為與語言設定出現前逐字相同**(提示詞指紋、slug、折疊不變;`test/golden` 守);`conceptFold` 未給時改依語言設定(中文折、其餘不折),`true` 仍強制內建折疊.非繁體中文(如 `en`)時:SS3 列不適用(符合度掃描逐篇列「不適用」,納入閘、存量處置與內容同步不轉字形).`lang` 只換輸出語言句、字形政策與 slug 政策,不翻譯提示詞本體與 md 章名(README §16).守門測試:`unit-summarize-locale`、`unit-summarize-sync` L 案.零件庫用法與產物契約之新選項(子階段 `enabled`／`when`、`cfg.aiOptions`、摘要 `domain.contract`、`stageOpts.summarize.sink`、`stageOpts.triage.rank`)皆 opt-in,預設行為逐字不變(README §4、§9、§15).
