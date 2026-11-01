# 規則帳本（w-knowledge-summarize）

> **藍圖**：以規則為單位記程式碼須長成什麼樣。本檔為索引與本套件之鐵則；條目分檔如下表。與現況比對看 `../state/state.md`。
> 規則 ID 沿用原宿主專案帳本之編號（GEN／SUM／STD）；新規則在本檔新增節並編號。
> **路徑基準**：原始碼在 `src/`，分檔所列檔案路徑（`core/…`、`stages/…` 等）除已標 `src/` 或 `test/` 者外皆相對 `src/`；`tmp/…` 證據夾、`srcRelate`／`srcExtract`／`srcPack`／`srcCapture`／`srcRunner` 與宿主專案名屬原宿主專案，為歷史敘事，保留不改。

## 分檔

| 檔 | 內容 | 來源 |
|---|---|---|
| `rulebook_專案-總則.md` | GEN-01～GEN-22、GEN-24（含 GEN-11 摘要獨立套件只依賴抓取且領域中立、GEN-12 摘要一律取自本套件、GEN-19 共用件之歸屬、GEN-20 四套件之界定與語言設定、GEN-24 抓取為 npm 套件；GEN-23 為宿主之派工規範，不收）；2026-11-01 逐條核對完成（報告 `tmp/summarize-doc-debt/報告-總則.md`） | 專案規則帳本 §1（2026-10-30 複製；GEN-20～22、24 於 2026-11-01 補入） |
| `rulebook_專案-summarize.md` | SUM-01～13（預篩、摘要納入閘、長文、分類法重標、內容同步、素材退回、失敗重開）；2026-11-01 逐條核對完成（報告 `tmp/summarize-doc-debt/報告-summarize.md`） | 專案規則帳本 §4 |
| `rulebook_專案-檢定標準.md` | 框架條目 STD-00、01、03、04、07、10、14、22、24～29 ＋ 本套件之模組條目 STD-02（數字紮根單一實作）、STD-05（摘要納入閘）、STD-13（預篩攔下之第二席確認 SS5）、STD-16（忠實性覆核 SS14）、STD-17（預篩題組）；2026-11-01 逐條核對完成（報告 `tmp/summarize-doc-debt/報告-檢定標準.md`） | 專案規則帳本 §11 |

## 本套件之鐵則

1. **邊界**（GEN-11／17／18）：只 import 自己、`package.json` 所列套件與抓取套件；抓取只經 `src/core/capturePackage.mjs`（名單明列、每一名須有非測試取用；測試另經 `test/tools/captureForTest.mjs`）；core 與抓取之 core 無同相對路徑之檔。import 規範：`lodash-es` 取單函數路徑、wsemi 取 `wsemi/src/<函數>.mjs`、其他自有套件走其 `src/` 深層路徑、node 內建模組在 `src/` 無前綴（與 `toolg/gDistRollup.mjs` 之 external 清單一致）。守門：`test/unit-summarize-package.test.mjs` ①②。
2. **領域中立**（GEN-02）：原始碼、README、bench 不含領域詞、不提他工作之名（只稱「下游」）。守門：`unit-summarize-package` ②④。
3. **四子階段**（triage → summarize → retag → sync）與其狀態轉移：讀 `raw`，轉 `noted`／`skip`／`summarize-failed`；素材壞了而可換法重抓者退回抓取（狀態回 `new`，由抓取之 `refetchRequestOf` 決定欄位）。
4. **摘要納入閘**（STD-05）：正規化、硬性欄位、數字紮根（`core/standards/numbers`，STD-02 單一實作）→ 組 md → 落地前再驗筆記標準；不合格者不落地；可確定性修正者修正、修不了者登錄待判。
5. **分類法變更只改詞彙表**（SUM-10～12）：新增／改名／退役由 `categories`、`categoryRenames`、`categoryRetire` 宣告；移除而不宣告去向 → 每輪 WARN「分類法守門」、資料不動；`state/taxonomy.json` 為真理檔。
6. **內容同步**（sync，無 AI）：只讀 mtime 新於上次掃描者；同步入口過筆記標準；寫 `knowledgeChangedAt` 供關聯重判。
7. **判定小組之家在本套件**（STD-10／28）：設定面 `core/standards/panelConfig.mjs`、未成立原因字樣表 `panel.mjs PANEL_WHY_LABELS`、單頁執行器 `runPanelPage`（opt-in 擴充：`secondOf`、`ballotOf`、`decideOf`、`thirdStop`）；關聯、提煉經埠取用。
8. **存量處置**（STD-22／25／29）：預演 `opt.stds`；帳列記實際修改之單位（各內容章、H1、frontmatter 鍵）之 before／after，回退逐單位、現值≠after 報衝突；有 skipped 之標準（SS3 概念轉正體會改分群鍵者）列修不了（2026-10-29）；讀帳壞行即拒。
9. **發布面**：`main` 指 `dist/w-knowledge-summarize.umd.js`、**不設 `exports` 與 `files`**（下游以 `…/src/…`、`…/test/tools/…` 深層路徑取用）；發布範圍由 `.npmignore` 決定——排除 `sgud`、`CLAUDE*.md`、暫存、`test/*.test.mjs`、`test/fixtures`、`docs`，保留 `src`、`test/tools`、`dist`；`CLAUDE*.md` 不入 git。範例 `g.mjs` 離線可執行、輸出與檔末 `// =>` 相符、README 之 Example 含其全文。守門：`unit-summarize-package` ②。
10. **編譯清單與 JSDoc**：`toolg/gDistRollup.mjs` 之 external／globals 自 `src/WKnowledgeSummarize.mjs` 之 import 圖（含經抓取套件再引用之自有套件原始碼）盤點，`opencc-js/dict/*` 須打包；`src/` 每個匯出函數皆有說明、`@param`、`@returns`、`@example`（範例之 `// =>` 為實跑輸出）。盤點指令見下表。

## 盤點指令與判準

| 項 | 指令 | 判準 |
|---|---|---|
| 全套測試 | `npm test`(＝`mocha --parallel "test/*.test.mjs" --timeout 180000`) | 0 失敗；pending 只有真 AI 之案 |
| 結構與守門 | `unit-summarize-package`、`unit-summarize-entry`、`unit-summarize-contract`、`unit-summarize-log-contract`、`unit-summarize-registry` | 皆綠 |
| 提示詞基準 | `test/tools` 之 genPromptGolden（比對模式「與標準檔逐字相同」exit 0） | 0 差 |
| 按需引入 | `grep -rn "from 'lodash-es'" src toolg g.mjs`、`grep -rn "from 'wsemi'" src toolg g.mjs`、`grep -rn "from 'node:" src toolg g.mjs` | 三條皆無輸出 |
| 編譯 | `node toolg/gDistRollup.mjs` 後以 `require` 載入 `dist/w-knowledge-summarize.umd.js`，具名匯出鍵與型別須同主入口（ESM）之具名匯出 | exit 0；載入不拋；鍵集相同 |
| 文件 | `node node_modules/jsdoc/jsdoc.js -c .jsdoc`、`node toolg/gDocsExams.mjs` | 皆 exit 0；JSDoc 覆蓋 100%（匯出函數之說明、`@param`、`@returns`、`@example`） |
| 下游回歸 | 下游關聯、提煉套件全套＋宿主專案全套 | 0 失敗 |

## 測試清單（`test/`）

- 核心與結構：`unit-core`、`unit-settings`、`unit-vocab`、`unit-evidence`、`unit-summarize-entry`、`unit-summarize-package`、`unit-summarize-contract`、`unit-summarize-registry`、`unit-summarize-log-contract`、`unit-summarize-locale`、`unit-summarize-assembly`、`unit-summarize-object`
- 子階段與判定：`unit-summarize-stages`、`unit-flow-summarize`、`unit-ai-batch`、`unit-summarize-material`、`unit-summarize-digest`、`unit-summarize-faith`、`unit-summarize-retag`、`unit-summarize-sync`、`unit-summarize-repair`、`unit-summarize-standards`、`unit-summarize-audit`、`unit-summarize-holds`、`unit-summarize-stores`、`unit-summarize-ops`
- 評分：`unit-summarize-bench`；真 AI：`api-summarize-bench-ai`
