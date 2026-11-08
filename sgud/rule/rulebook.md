# 規則帳本（w-knowledge-summarize）

> **藍圖**：以規則為單位記程式碼須長成什麼樣。本檔為索引與本套件之鐵則；條目分檔如下表。與現況比對看 `../state/state.md`。
> 規則 ID 沿用最初編號（GEN／SUM／STD）；缺號者見〈已移出〉；新規則在本檔新增節並編號。
> **路徑基準**：原始碼在 `src/`，分檔所列檔案路徑（`core/…`、`stages/…` 等）除已標 `src/` 或 `test/` 者外皆相對 `src/`；盤點指令在套件根重跑（`git grep` 只搜追蹤檔）。
> **用語**：「使用端」＝使用本套件之專案；「抓取套件」＝npm `w-knowledge-capture`；「下游」＝讀本套件產物之後續工作。

## 分檔

| 檔 | 內容 |
|---|---|
| `rulebook_general.md` | GEN-01 英文名唯一、02 領域中立、03 設定分段與驗證、04 只放新格式、06 模組邊界、07 hook 錨點全集、09 測試以檔案位置定根、10 抓取之知識取自抓取套件、11 只依賴抓取套件且領域中立、15 評比總表在套件根、16 評分命令列與角色小件各一份、18 自有套件匯入指定詞（含測試件發布面、模組私有標記之單例）、19 共用件之歸屬、20 泛用開源套件與語言設定、21 跨套件收斂之共用件、22 測試件之共用與守門、24 抓取依賴為 npm 套件、25 傳給 wsemi 計算類函數之字數值先判定再取值 |
| `rulebook_summarize.md` | SUM-01～15（預篩、摘要納入閘、長文、分類法重標、內容同步、素材退回、失敗重開、預篩與摘要扣保留給後段之時間、筆記之產出鏈 produced 與依之選件） |
| `rulebook_standards.md` | STD-00、01、02、03、04、05、07、10、13、14、16、17、22、25、26、28、29（標準框架、數字紮根、納入閘、待判登錄、判定小組與題組、預篩第二席確認 SS5、忠實性覆核 SS14、存量處置與回退、持久檔語意） |

## 已移出

規則 ID 不重新編號；下列缺號之條目不屬本套件之程式碼要求，原文由原出處保有。

| ID | 原標題 | 去處 |
|---|---|---|
| GEN-05 | 執行端只有一個組裝點 | 已移出（宿主專屬：使用端之組裝入口） |
| GEN-08 | 階段要求 | 已移出（宿主專屬：宿主專案之開發階段要求） |
| GEN-12 | 使用端之摘要一律取自本套件、不自行實作 | 已移出（宿主專屬）；套件側之取用契約已濃縮進 `../proc/process.md`〈使用端須知〉 |
| GEN-13 | 下游之獨立套件只依賴其上游套件 | 已移出（宿主與下游專屬） |
| GEN-14 | 使用端之下游工作一律取自下游之獨立套件、不自行實作 | 已移出（宿主與下游專屬） |
| GEN-17 | 宿主解體後之結構：執行殼與各套件各自獨立 | 已移出（宿主專屬：宿主專案之目錄結構） |
| STD-24 | 盤點表 B 之逐項歸類 | 已移出（宿主專屬：依附宿主之審計與巡檢） |
| STD-27 | 覆核類判定之核對件一份 | 已移出（下游專屬：全屬下游套件之站點） |

## 本套件之鐵則

1. **邊界**（GEN-06／11／18）：只 import 自己、`package.json` 所列套件與抓取套件；抓取只經 `src/core/capturePackage.mjs`（名單明列、每一名須有非測試取用；測試另經 `test/tools/captureForTest.mjs`）；core 與抓取之 core 無同相對路徑之檔。import 規範：`lodash-es` 取單函數路徑、wsemi 取 `wsemi/src/<函數>.mjs`、其他自有套件走其 `src/` 深層路徑、node 內建模組在 `src/` 無前綴（與 `toolg/gDistRollup.mjs` 之 external 清單一致）。守門：`test/unit-summarize-package.test.mjs` ①②。
2. **領域中立**（GEN-02）：原始碼、README、bench 不含領域詞、不提他工作之名（只稱「下游」）。守門：`unit-summarize-package` ②④。
3. **四子階段**（triage → summarize → retag → sync）與其狀態轉移：讀 `raw`，轉 `noted`／`skip`／`summarize-failed`；素材壞了而可換法重抓者退回抓取（狀態回 `new`，由抓取之 `refetchRequestOf` 決定欄位）。
4. **摘要納入閘**（STD-05）：正規化、硬性欄位、數字紮根（`core/standards/numbers`，STD-02 單一實作）→ 組 md → 落地前再驗筆記標準；不合格者不落地；可確定性修正者修正、修不了者登錄待判。
5. **分類法變更只改詞彙表**（SUM-10～12）：新增／改名／退役由 `categories`、`categoryRenames`、`categoryRetire` 宣告；移除而不宣告去向 → 每輪 WARN「分類法守門」、資料不動；`state/taxonomy.json` 為真理檔。
6. **內容同步**（sync，無 AI）：只讀 mtime 新於上次掃描者；同步入口過筆記標準；寫 `knowledgeChangedAt` 供下游重判。
7. **判定小組之家在本套件**（STD-10／28）：設定面 `core/standards/panelConfig.mjs`、未成立原因字樣表 `panel.mjs PANEL_WHY_LABELS`、單頁執行器 `runPanelPage`（opt-in 擴充：`secondOf`、`ballotOf`、`decideOf`、`thirdStop`）；下游經埠取用。
8. **存量處置**（STD-22／25／29）：預演 `opt.stds`；帳列記實際修改之單位（各內容章、H1、frontmatter 鍵）之 before／after，回退逐單位、現值≠after 報衝突；有 skipped 之標準（SS3 概念轉正體會改分群鍵者）列修不了（2026-10-29）；讀帳壞行即拒。
9. **發布面**：`main` 指 `dist/w-knowledge-summarize.umd.js`、**不設 `exports` 與 `files`**（下游以 `…/src/…`、`…/test/tools/…` 深層路徑取用）；**不提供 `.npmignore`**（使用者 2026-11-01 裁示：npm 包＝git 版控內容，依 `.gitignore`；本套件無外部執行檔、`test/`〔約 1.2MB〕與 `docs/`〔約 4.1MB〕皆 <10MB）——`sgud/`、`test/`（含 `test/tools/`、`golden/`）、`docs/` 皆隨包，`CLAUDE*.md`、`tmp`、`test/_tmp` 由 `.gitignore` 排除、不入包（以 `npm pack --dry-run` 清單驗：含 `sgud/` 與 `test/tools/`、不含 `CLAUDE*.md`）。範例 `g.mjs` 離線可執行、輸出與檔末 `// =>` 相符、README 之 Example 含其全文。守門：`unit-summarize-package` ②〈發布面〉（無 `.npmignore`、`.gitignore` 規則）與〈打包清單〉（`npm pack --dry-run`）。
10. **編譯清單與 JSDoc**：`toolg/gDistRollup.mjs` 之 external／globals 自 `src/WKnowledgeSummarize.mjs` 之 import 圖（含經抓取套件再引用之自有套件原始碼）盤點，`opencc-js/dict/*` 須打包；`src/` 每個匯出函數皆有說明、`@param`、`@returns`、`@example`（範例之 `// =>` 為實跑輸出）。盤點指令見下表。
11. **傳給 wsemi 計算類函數之值先判定、再取值**（GEN-25，2026-11-02）：字數類 opt（`summarizeCharsPerDoc`、`triageCharsPerDoc`、`longDocChars`）與逐篇 `budgets[i]` 以 `iseint(v, { use: 'count', min: 1 })` 判定、再 `Number(v)` 取值，非預期（含 `Infinity`、`'0x10'`、包裝物件、逾 4294967295 者）改用預設，不再 `ispint`→`cint`（`cint(Infinity)` 為 `Number.MAX_VALUE`）；對使用端之行為變化僅限非預期值。守門：`unit-summarize-charcount`（含 wsemi 第 3 輪嚴格版 `strTruncate` 替身下不拋錯、站點全集）。
12. **預篩、摘要、重標三段皆扣保留給後段之時間**（SUM-14，2026-11-05）：`opt.reserveMs` 明給者優先、未給取 `ctx.deps.reserveMs`、皆未給為 0（取值規則取抓取套件之 `reserveMsOf`，本套件不讀他工作之設定）；保留 > 0 時各段開工前與每輪開工前判「扣保留後剩餘 ≥ 該席位一次呼叫之估計」（`summarizeCallMsOf`），每次呼叫以「剩餘−保留」封頂；時間不足是少做幾輪、不縮容量鍵，文件留池，`detail.deferred`；保留為 0 時行為與現版完全相同。守門：`unit-summarize-reserve`、`unit-summarize-reserve-gate`、`unit-summarize-log-contract`。
13. **筆記之產出鏈**（SUM-15，2026-11-08；規格為跨套件之「知識套件之產出鏈」）：落筆記之站點（摘要新建、人工匯入、分類法重標、同步入口與存量處置之確定性修正）一律經 `stores/noteProduced.noteProducedOf` 組出，記錄加 `produced`／`producedHistory`（上限 50）／`producedHistoryDropped`，md front matter 只加純量鍵 `produced_stamp`／`produced_stage`／`produced_provider`；`provider` 取該次呼叫之 `providerId`（遞補者），成交條目未知者不寫；不呼叫 AI 者 seat／provider 皆 null；寫入記錄經 `patchNoteRecord`（深合併殘留之先清後寫）；依之選件 `ops/notesByProvenance`（純讀）。新增落筆記之站點須經 `noteProducedOf` 並登記於 SUM-15 站點表。守門：`unit-summarize-provenance`、`unit-flow-summarize-provenance`、`unit-summarize-retag`／`-sync`／`-stockfix` 之〈產出鏈〉組。

## 盤點指令與判準

| 項 | 指令 | 判準 |
|---|---|---|
| 全套測試 | `npm test`(＝`mocha --parallel "test/*.test.mjs" --timeout 180000`) | 0 失敗；pending 只有真 AI 之案 |
| 結構與守門 | `unit-summarize-package`、`unit-summarize-entry`、`unit-summarize-contract`、`unit-summarize-log-contract`、`unit-summarize-registry` | 皆綠 |
| 提示詞基準 | `node test/tools/genPromptGolden.mjs`（比對模式「與標準檔逐字相同」） | exit 0；0 差 |
| 按需引入 | `git grep -nE "from 'lodash-es'" -- src toolg g.mjs`、`git grep -nE "from 'wsemi'" -- src toolg g.mjs`、`git grep -nE "from 'node:" -- src toolg g.mjs` | 三條皆無輸出 |
| 編譯 | `node toolg/gDistRollup.mjs` 後以 `require` 載入 `dist/w-knowledge-summarize.umd.js`，具名匯出鍵與型別須同主入口（ESM）之具名匯出 | exit 0；載入不拋；鍵集相同 |
| 文件 | `node node_modules/jsdoc/jsdoc.js -c .jsdoc`、`node toolg/gDocsExams.mjs` | 皆 exit 0；JSDoc 覆蓋 100%（匯出函數之說明、`@param`、`@returns`、`@example`） |
| 整輪預算之站點（SUM-14） | `git grep -nE "budgetOf\(\|budget\.(remainingMs\|shouldStop)" -- src`、`git grep -nE "reserveGateOf\|reserveFnOf" -- src/stages` | 前者只見 `core/stages/stageReserve.mjs`（閘之底層）與 `createKnowledgeSummarize.mjs` 註解，各段不得直接用整輪預算；後者見 `triageStage`、`noteStage` 各自建閘（重標用抓取套件之 `reserveOf`，既有） |
| wsemi 計算類函數之傳入值 | `git grep -nE "strTruncate\(\|interp1\(\|arrGroupByMaxmin\(\|arrLookupByMaxmin\(" -- src`、`git grep -nE "\bcint\(\|import cint" -- src/domain` | 前者只 `domain/{triage,retag,note,digest}Domain.mjs` 之 9 處（`maxLen` 為字面值或 `iseint` 判定後之變數）、`interp1` 等 0 處；後者 0 命中（GEN-25；`unit-summarize-charcount` ③） |
| 落筆記之站點（SUM-15） | `git grep -nE "writeMd\(\|notes\.(patch\|insertNew)\(\|patchNoteRecord\(" -- src`、`git grep -nE "noteProducedOf\(" -- src` | 前者之站點（`noteStage`、`ingestNotes`、`retagStage`、`syncNotes`、`stockFix`、`notePatch` 本體、`noteBuild`／`noteRestoreGate` 只組或回傳）皆見於 SUM-15 站點表；後者五處各一（`noteStage`、`ingestNotes`、`retagStage`、`syncNotes`、`stockFix`）＋定義 |
| 下游回歸 | 下游套件全套＋使用端全套 | 0 失敗 |

## 測試清單（`test/`）

- 核心與結構：`unit-core`、`unit-settings`、`unit-vocab`、`unit-evidence`、`unit-summarize-entry`、`unit-summarize-package`、`unit-summarize-contract`、`unit-summarize-registry`、`unit-summarize-log-contract`、`unit-summarize-locale`、`unit-summarize-assembly`、`unit-summarize-object`
- 子階段與判定：`unit-summarize-stages`、`unit-flow-summarize`、`unit-ai-batch`、`unit-summarize-domain`、`unit-summarize-material`、`unit-summarize-digest`、`unit-summarize-faith`、`unit-summarize-retag`、`unit-summarize-sync`、`unit-summarize-repair`、`unit-summarize-standards`、`unit-summarize-audit`、`unit-summarize-stockfix`、`unit-summarize-holds`、`unit-summarize-stores`、`unit-summarize-ops`、`unit-summarize-charcount`（GEN-25：字數類 opt／逐篇 budgets 之判定、wsemi 第 3 輪嚴格版 `strTruncate` 替身〔`test/tools/strictWsemi*.mjs`、`strictProbe.mjs`、`charCountKit.mjs`〕、站點全集）、`unit-summarize-reserve`、`unit-summarize-reserve-gate`（SUM-14：預篩與摘要扣保留給後段之時間）、`unit-summarize-provenance`、`unit-flow-summarize-provenance`（SUM-15：筆記之產出鏈、深合併、選件、預篩確認之票）
- 評分：`unit-summarize-bench`；真 AI：`api-summarize-bench-ai`
