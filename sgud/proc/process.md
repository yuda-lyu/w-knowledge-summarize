# 處理要點（w-knowledge-summarize）

> 本套件之開發、驗收、維運要求與其處理流程。本檔為索引與要點；細節分檔如下表。
> **路徑基準**：原始碼在 `src/`，下文與分檔所列檔案路徑（`core/…`、`stages/…`、`createKnowledgeSummarize.mjs` 等）除註明外皆相對 `src/`；測試在 `test/`（輔助件在 `test/tools/`，隨 npm 包發布供下游取用）。
> **用語**：「使用端」＝使用本套件之專案；「抓取套件」＝npm `w-knowledge-capture`；「下游」＝讀本套件產物之後續工作。

## 分檔

| 檔 | 內容 |
|---|---|
| `process_common.md` | 變更與驗收之共通要點：測試自套件根、改設定鍵須知、提示詞逐字相同檢查、模組英文名、設定結構與席位清單、語言設定 `cfg.lang` |
| `process_summarize.md` | 摘要之開發與驗收（定位、邊界、共用件之家、守門、測試、免費 AI 能力評分）＋設定、維運與監看（子階段序、素材問題回報、分類法變更、維運 API、監看字樣、內容變更、失敗重開） |
| `process_standards.md` | 檢定標準之維運：符合度掃描、存量處置與回退判準、AI 標準之開啟、容量、待判、SS4 之原文材料 |

## 已移出

屬使用端（宿主專案）之運維，不屬本套件之處理要點，原文由原出處保有：變更與驗收流程中之整點避開、使用端全套驗收、席位核對、等下一輪、留紀錄（`process_common.md` 缺號 1、4、6、7、8），使用端設定檔對本套件設定之舊→新對照、使用端之領域設定位置、下游之型別與提示詞設定，以及檢定標準之運維中使用端已開啟之 AI 標準與其容量數字。

## 本套件之鐵則（細目見 `../rule/rulebook.md`）

- **邊界**：只 import 自己的檔案、`package.json` 所列套件，以及抓取套件（`w-knowledge-capture`；**只經單一匯入點 `src/core/capturePackage.mjs`**，名單明列、每一名須有非測試取用）；測試另經 `test/tools/captureForTest.mjs`。下游套件經各自之埠，以 `w-knowledge-summarize/src/…` 與 `w-knowledge-summarize/test/tools/…` 深層路徑取本套件之件。
- **領域中立、只放新格式新工作流**（同抓取）。抓取缺能力者於抓取以 opt-in 擴充（預設不變、附測試），不在本套件另寫。
- **本套件為家之共用件**：判定小組之設定面與未成立原因字樣（`core/standards/panelConfig`、`panel.mjs` 之 `PANEL_WHY_LABELS`、單頁執行器 `runPanelPage`）、數字紮根（`core/standards/numbers`）、批次 AI 字樣（`aiBatchStage`）、筆記進料上界（`notesInflowOf`）、測試件 `noteKit`／`quantRule`／`stageKit.bagCtx`。
- **改本套件後**：跑本套件全套（`npm test`），再跑下游套件與使用端之全套；`src/` 內之檔路徑一改，下游埠與使用端轉接檔之指定詞同步。

## 結構與工具

- **佈局**：`src/`（主入口 `src/WKnowledgeSummarize.mjs`；根層 5 檔＋`bench/ core/ domain/ ops/ stages/ standards/ stores/`）、`test/`（`*.test.mjs`＋`tools/`＋`golden/`）、`toolg/`（編譯與文件工具）、`g.mjs`（離線範例，輸出附檔末 `// =>`；README 之 Example 含其全文，改 `g.mjs` 須同步 README，`unit-summarize-package` 守）、`模型評比.csv`（`bench` 命令列 `--board` 之輸出目標，程式不讀）。`dist/`、`docs/` 為發布流程產製物。
- **發布面**：`package.json` 之 `main` 指 `dist/w-knowledge-summarize.umd.js`，**不設 `exports` 與 `files`**（設了即擋掉下游之 `…/src/…`、`…/test/tools/…` 深層路徑）；**不提供 `.npmignore`**，npm 包＝git 版控內容（依 `.gitignore`）：`sgud/`、`test/`（含 `test/tools/`）、`docs/` 皆隨包，`CLAUDE*.md`、`tmp`、`test/_tmp` 由 `.gitignore` 排除、不入包（`test/`、`docs/` 皆 <10MB，且無外部執行檔，故不須排除項；日後任一資料夾 ≥10MB 或加入外部執行檔才提供 `.npmignore`，且首段須完整抄錄 `.gitignore`）。發布流程見 `script.txt`；發布由使用者處理。
- **編譯**：`node toolg/gDistRollup.mjs`；`external`／`globals` 自 `src/WKnowledgeSummarize.mjs` 靜態追蹤 import 圖（含經 `w-knowledge-capture` 再引用之自有套件原始碼）盤點，原則見該檔檔頭；`opencc-js/dict/*` 須打包（列 external 則 `require(dist)` 即拋錯）。編譯 exit 0 不等於可載入——改清單後必以 `require` 載入 dist 並比對匯出鍵。
- **import 規範**：`lodash-es` 取單函數路徑（`lodash-es/chunk.js`）；wsemi 取 `wsemi/src/<函數>.mjs`；其他自有套件走其 `src/` 深層路徑；node 內建模組在 `src/` 無前綴（`fs`、`path`、`url`）。
- **JSDoc**：`src/` 每個匯出函數皆有說明、`@param`、`@returns`、`@example`（`// =>` 為實跑輸出）；`node node_modules/jsdoc/jsdoc.js -c .jsdoc` 須成功。

## 測試

- 自套件根跑：`npm test`（＝`mocha --parallel "test/*.test.mjs" --timeout 180000`）；不建 `.mocharc.json`，`package.json` 之 scripts 為 `test` 與 `deploy`。單檔：自行編寫 mocha 指令（去 `--parallel`、換檔名）。
- 不連網、不呼叫真實 AI；真 AI 之案（`api-summarize-bench-ai`）以 `WK_LIVE_AI=1` 才會跑（燒免費額度，須使用者同意）。

## 要點（本套件）

- **免費 AI 能力評分**：`node src/bench/cli.mjs --role all --models free --runs 2 --out <專案外目錄> --env <.env> --board 模型評比.csv`（五角色 × 免費模型 × 2 回）；`--out` 必放專案外；撞額度之模型停測、該角色不寫表，隔日 `--role <角色> --models <id>` 補；使用端自己之題組以 `--cases`＋`--vocab` 跑且**不給 `--board`**（會覆蓋通用題組列）。單一模型某角色 0 分而「呼叫失敗 1」者是整頁呼叫失敗，補跑即可。（命令列用法字串與題組路徑：五角色之 `command`、`casesHelp`、`cli.mjs` 之用法與錯誤訊息，以及 `--help` 首行〔抓取套件 1.0.2 起〕皆為 `node src/bench/cli.mjs`／`src/bench/cases/…`，`unit-summarize-bench` 以直接執行 `--help` 與失敗路徑守之。）
- **詞彙由使用方給**：建 domain 前先 `pickSummarizeVocab(詞彙)`，否則「vocab 含不認得之鍵」；領域覆寫值（`evidenceRule.{subject,check,strict,loose,alt}`、`guide.faith`）由使用端給，改樣式必以既有筆記實測其命中並逐句核（見分檔）。
- **概念折疊為抓取之單例**：不經總組裝直接呼叫 `planNoteStockFix`／`applyNoteStockFix` 之工具須先 `setConceptFold`。
- **席位**：免費家首選；預篩席、重標席未設即沿用摘要席（`summarizeSeatOf`）；判定小組 first／second 須不同家（啟動期警告「判定小組永遠無法成立」為須見）。

## 使用端須知

本套件對使用端之契約（只列套件側；各鍵之完整語意見 README，使用端之值、檔位置與排程不在本套件管轄）：

- **取用路徑**：ESM 入口 `w-knowledge-summarize/src/WKnowledgeSummarize.mjs`（具名匯出與預設匯出為同一組）；`main` 指 UMD `dist`，不設 `exports`／`files`，故 `…/src/…`、`…/test/tools/…` 深層路徑可用；`src/` 內檔路徑一改，使用端與下游埠之指定詞須同步（GEN-18）。隨包發布之測試件 `test/tools/{noteKit,quantRule,stageKit}.mjs`（`landNoteOf` 以真實組裝落筆記、`QUANT_RULE` 證據規則夾具、`bagCtx` 子階段 ctx 袋）供下游測試橋接取用，改其名稱或簽名須同步下游。
- **設定**：`createKnowledgeSummarize(cfg)` 頂層鍵以 `CFG_KEYS` 為準；設定只收 `ai`／`summarize`／`capture` 三段（鍵與預設見 README §5、`SUMMARIZE_SCHEMA`／`SUMMARIZE_AI_SCHEMA`）。不認得之鍵、型別或值域不合、區段形狀錯於建構期拋錯，不靜默回預設。使用端原有多工作設定檔者：`summarize`、`capture` 段原樣給，`ai` 段只挑 `SUMMARIZE_AI_SCHEMA` 之鍵（`providerPick` 等拒收，供應商池走 `cfg.aiOptions`）。預設：`summarize.standards.scanEachRun` 為 false；`triageConfirm.ai` 只收 `first`／`third`；`ai.healthStreak` 為 3；`scheduleLimitMin`／`deadlineMs`／`lockStaleMs` 給無效值視同未給並入 `info().startupWarnings`。
- **詞彙與語言**：領域句由使用端經 `cfg.data.vocab` 給（`kbLabel`、`domain`、`guide`〔`triage`／`summarize`／`faith`〕、`evidenceRule`、`conceptRenames`／`conceptAliases`，README §6）；與他段共用一份詞彙表者先 `pickSummarizeVocab`；斷言型 API（`checkNote`、`gateNoteItem`、`syncNotes`、`createNoteRestoreGate`、`auditSummarizeStandards`、存量處置）只收 `resolveSummarizeVocab` 之產物（`info().vocab` 即是）。改任何一句領域句即改提示詞；`test/golden/prompts-default.json` 只守預設詞彙。`evidenceRule` 預設不啟用，其 `alt` 以逐句樣式比對，不做語意理解。`cfg.lang` 不給即 `zh-TW`；非繁體中文時 SS3 列「不適用」、不轉字形，提示詞本體與 md 章名不在地化（README §16）。
- **自組管線與跨套件通知**：預篩、摘要、重標之保留時間由組裝者以 `stageOpts.<triage|summarize|retag>.reserveMs` 或每輪依賴 `deps.reserveMs` 注入（三段 `opt` 未給時同取依賴），本套件不讀他工作之設定；他總組裝共用摘要件用 `createSummarizeRuntime(cfg, settings, { vocab, prompts, domains })`。跨套件、跨行程判「分類已改」「內容已改」一律以記錄欄 `tagChangedAt`、`knowledgeChangedAt` 為準；ctx 旗標 `notesTagChanged`／`notesChanged` 只在同一條管線內有效。外部巡檢之字樣、報告鍵、容量說明取本套件之常數（`SUMMARIZE_LOG_KNOWN`／`SUMMARIZE_LOG_MUST_SEE`／`SUMMARIZE_LOG_PARSE`／`SUMMARIZE_REPORT_KEYS`、`SUMMARIZE_CAPACITY_DESC`），不手寫。
- **檢定標準與存量**：符合度掃描用 `auditSummarizeStandards`＋`summarizeScanOf`（AI 列 `open` 因標準而異：SS5 為待第二席確認之 raw 文件數，SS9／SS14 為待判登錄之未結數，合併報告時逐欄問語意）。存量處置寫入者（`applyNoteStockFix`、`rollbackNoteStockFix`）不取執行鎖、不備份、不徵求同意，由使用端負責：與管線互斥、一致備份、預演後呈報並取得使用者同意；套用後重掃並斷言連鎖，不符依回退判準回退（`process_standards.md`）。使用端之帳混有他模組之列者，回退須在全域逆序迴圈內逐列交付；以資料複本演練時，筆記記錄之 `file` 若指向原庫之 md，套用會寫回原 md，須先改指複本。下游把封存之筆記放回庫時，注入 `createNoteRestoreGate` 之 `check`／`hold`（README §1〈與上下游之介面〉）。

## 不列為待辦者

- 發布套件、`dist/` 由使用者處理；SS14 忠實性覆核之存量須原文回溯（須使用者同意）。
