# 處理要點（w-knowledge-summarize）

> 業務端之特化要求與其處理流程。本檔為索引與要點；細節分檔如下表。
> **路徑基準**：原始碼在 `src/`，下文與分檔所列檔案路徑（`core/…`、`stages/…`、`createKnowledgeSummarize.mjs` 等）除註明外皆相對 `src/`；測試在 `test/`（輔助件在 `test/tools/`，隨 npm 包發布供下游取用）。分檔為複製自原宿主專案之處理要點，其中 `tmp/…` 證據夾、`data/…`、`srcRelate`／`srcExtract`／`srcPack`／`srcCapture` 與宿主專案名屬原宿主專案，為歷史敘事，保留不改。

## 分檔

| 檔 | 內容 | 來源 |
|---|---|---|
| `process_專案-共通.md` | 四套件之變更與驗收流程、四模組英文名、設定對照、本專案領域設定所在 | 專案處理要點（2026-10-30 複製） |
| `process_專案-摘要.md` | 本套件之使用與驗收（專案接點、審計接手須知、切換之等價證據、邊界、測試、本專案之量化覆寫值〔`evidenceRule`／`guide.faith`〕、免費 AI 能力評分、單獨使用之 cfg 對應表）＋ 摘要之設定、維運與監看（子階段序、素材問題回報、分類法變更、維運 CLI、監看字樣、內容變更、失敗重開） | 專案處理要點 |
| `process_專案-檢定標準運維.md` | 符合度掃描、存量處置之同意流程與回退判準、AI 標準之開啟程序、已開啟者（SS5 預篩確認）、容量快照、待判、原文回溯 | 專案處理要點 |

## 本套件之鐵則（原 `CLAUDE.md`〈本套件之鐵則〉改寫；細目見 `../rule/rulebook.md`）

- **邊界**：只 import 自己的檔案、`package.json` 所列套件，以及抓取套件（`w-knowledge-capture`；**只經單一匯入點 `src/core/capturePackage.mjs`**，名單明列、每一名須有非測試取用）；測試另經 `test/tools/captureForTest.mjs`。下游（關聯、提煉兩套件）經各自之 `core/summarizePackage.mjs`，以 `w-knowledge-summarize/src/…` 與 `w-knowledge-summarize/test/tools/…` 深層路徑取本套件之件；宿主專案經其轉接檔取用。
- **領域中立、只放新格式新工作流**（同抓取）。抓取缺能力者於抓取以 opt-in 擴充（預設不變、附測試），不在本套件另寫。
- **本套件為家之共用件**：判定小組之設定面與未成立原因字樣（`core/standards/panelConfig`、`panel.mjs` 之 `PANEL_WHY_LABELS`、單頁執行器 `runPanelPage`）、數字紮根（`core/standards/numbers`）、批次 AI 字樣（`aiBatchStage`）、筆記進料上界（`notesInflowOf`）、測試件 `noteKit`／`quantRule`／`stageKit.bagCtx`。
- **改本套件後**：跑本套件全套（`npm test`），再跑下游套件與宿主專案之全套；`src/` 內之檔路徑一改，下游埠與宿主轉接檔之指定詞同步。

## 結構與工具

- **佈局**：`src/`（主入口 `src/WKnowledgeSummarize.mjs`；根層 5 檔＋`bench/ core/ domain/ ops/ stages/ standards/ stores/`）、`test/`（`*.test.mjs`＋`tools/`＋`golden/`）、`toolg/`（編譯與文件工具）、`g.mjs`（離線範例，輸出附檔末 `// =>`；README 之 Example 含其全文，改 `g.mjs` 須同步 README，`unit-summarize-package` 守）、`模型評比.csv`（`bench` 命令列 `--board` 之輸出目標，程式不讀）。`dist/`、`docs/` 為發布流程產製物。
- **發布面**：`package.json` 之 `main` 指 `dist/w-knowledge-summarize.umd.js`，**不設 `exports` 與 `files`**（設了即擋掉下游之 `…/src/…`、`…/test/tools/…` 深層路徑）；發布範圍由 `.npmignore` 決定（排除 `sgud`、`CLAUDE*.md`、暫存、`test/*.test.mjs`、`test/fixtures`、`docs`，保留 `src`、`test/tools`、`dist`）。發布流程見 `script.txt`；發布由使用者處理。
- **編譯**：`node toolg/gDistRollup.mjs`；`external`／`globals` 自 `src/WKnowledgeSummarize.mjs` 靜態追蹤 import 圖（含經 `w-knowledge-capture` 再引用之自有套件原始碼）盤點，原則見該檔檔頭；`opencc-js/dict/*` 須打包（列 external 則 `require(dist)` 即拋錯）。編譯 exit 0 不等於可載入——改清單後必以 `require` 載入 dist 並比對匯出鍵。
- **import 規範**：`lodash-es` 取單函數路徑（`lodash-es/chunk.js`）；wsemi 取 `wsemi/src/<函數>.mjs`；其他自有套件走其 `src/` 深層路徑；node 內建模組在 `src/` 無前綴（`fs`、`path`、`url`）。
- **JSDoc**：`src/` 每個匯出函數皆有說明、`@param`、`@returns`、`@example`（`// =>` 為實跑輸出）；`node node_modules/jsdoc/jsdoc.js -c .jsdoc` 須成功。

## 測試

- 自套件根跑：`npm test`（＝`mocha --parallel "test/*.test.mjs" --timeout 180000`）；不建 `.mocharc.json`，`package.json` 之 scripts 為 `test` 與 `deploy`。單檔：自行編寫 mocha 指令（去 `--parallel`、換檔名）。
- 不連網、不呼叫真實 AI；真 AI 之案（`api-summarize-bench-ai`）以 `WK_LIVE_AI=1` 才會跑（燒免費額度，須使用者同意）。

## 要點（本套件）

- **免費 AI 能力評分**：`node src/bench/cli.mjs --role all --models free --runs 2 --out <專案外目錄> --env <.env> --board 模型評比.csv`（五角色 × 免費模型 × 2 回）；`--out` 必放專案外；撞額度之模型停測、該角色不寫表，隔日 `--role <角色> --models <id>` 補；宿主之題組（SS14／SS9）以 `--cases`＋`--vocab` 跑且**不給 `--board`**（會覆蓋通用題組列）。單一模型某角色 0 分而「呼叫失敗 1」者是整頁呼叫失敗，補跑即可。（命令列用法字串〔`areaBench`／`benchKit` 等印出之 `node bench/cli.mjs`〕尚未隨佈局更新，見 `../state/state.md`〈已知缺口〉。）
- **詞彙由使用方給**：建 domain 前先 `pickSummarizeVocab(詞彙)`，否則「vocab 含不認得之鍵」；宿主之量化覆寫值（`evidenceRule.{subject,check,strict,loose,alt}`、`guide.faith`）在宿主 `data/vocab.json`，改樣式必重跑兩支掃描逐句核（見分檔）。
- **概念折疊為抓取之單例**：不經總組裝直接呼叫 `planStockFix`／`applyStockFix` 之工具須先 `setConceptFold`。
- **席位**：免費家首選；預篩席、重標席未設即沿用摘要席（`summarizeSeatOf`）；判定小組 first／second 須不同家（啟動期警告「判定小組永遠無法成立」為須見）。

## 不列為待辦者

- 發布套件、`dist/` 由使用者處理；排程恢復由使用者確認；SS14 忠實性覆核之存量須原文回溯（須同意）。
