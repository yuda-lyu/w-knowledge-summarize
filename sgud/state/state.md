# 現況（w-knowledge-summarize）— 2026-11-01

> 只記現況，不寫過程（過程在 `../exp/`）。接續工作先讀本檔；完成一項功能或結束一輪工作即更新。
> **路徑基準**：原始碼在 `src/`，下文與分檔所列檔案路徑除已標 `src/` 或 `test/` 者外皆相對 `src/`；`tmp/…` 證據夾與 `srcRelate`／`srcExtract` 等舊名屬原宿主專案。

## 身分與位置

- npm `w-knowledge-summarize`（`package.json` 版本 1.0.x，尚未發布）；主入口 `src/WKnowledgeSummarize.mjs`（具名匯出 261 個＋同組預設物件）、總組裝 `createKnowledgeSummarize`、執行期件 `createSummarizeRuntime`、物件 `summarizeObject.mjs`。
- **佈局**（2026-11-01 比照自有套件重整）：`src/`（根層 5 檔＋`bench/ core/ domain/ ops/ stages/ standards/ stores/`）、`test/`（30 個 `*.test.mjs`＋`tools/` 8 檔隨 npm 包發布＋`golden/`）、`toolg/`（`addVersion`／`modifyReadme`／`cleanFolder`／`gDocsExams`／`gDistRollup`）、`g.mjs`（離線範例）、`.editorconfig` 等根目錄範本檔；`dist/`、`docs/` 為發布流程產製物。`main` 指 `dist/w-knowledge-summarize.umd.js`，不設 `exports` 與 `files`，發布範圍由 `.npmignore` 決定（下游以 `w-knowledge-summarize/src/…`、`w-knowledge-summarize/test/tools/…` 深層路徑取用）。
- 依賴：`dependencies`＝`w-knowledge-capture` ^1.0.1（只經 `src/core/capturePackage.mjs`，指定詞 `w-knowledge-capture/src/WKnowledgeCapture.mjs`；測試橋接取其 `test/tools/`）、`wsemi` ^1.9.40；`devDependencies`＝`w-data-pipeline` ^1.0.24、`w-dispatch-ai` ^1.0.64、`w-orm-lmdb` ^1.0.50（皆只測試取用）、`w-package-tools` ^1.1.21（`toolg/` 用，並帶入 mocha 11.8.0、jsdoc）。
- 被誰用：下游關聯、提煉套件各經其 `core/summarizePackage.mjs`（關聯之摘要埠 33 名）；宿主經其轉接檔；正式管線之摘要即本套件之實作（2026-10-07 切換）。
- 發布狀態：尚未發布（發布由使用者／主控）。2026-11-01 發布前確認完成並完成套件化重整（見〈最近驗證〉）。

## 審計與結構

| 項 | 狀態 |
|---|---|
| 套件審計（2026-10-11～12） | **結案**：P0～P13（終審 `tmp/summarize-pkg-audit/終審.md` §5 104 條逐條核對；進度 `進度.md`）；P13 正式庫複本往返 0 差。快照 `tmp/summarize-pkg-audit/pre/`＋`pre-manifest.json` **勿清** |
| 四套件界定審計（2026-10-28） | 結案；`cfg.lang`（GEN-20）；domain 契約新選項（`domain.contract`、`stageOpts.summarize.sink`、`stageOpts.triage.rank`）皆 opt-in |
| 隨下游審計之修改 | srcRelate 審計 P4（10-29）：`runPanelPage` opt-in 擴充＋`PANEL_THIRD_STOP`；P7：`sectionItemsOf`；P8：`stageKit.bagCtx` 入共用件之家；P10：`standards/stockFix.mjs` 有 skipped 之標準列修不了（SS3）、測試「SS3 之概念轉正體會改分群鍵者」（647 → 648） |

## 最近驗證

| 日期 | 項 | 結果 |
|---|---|---|
| 2026-11-01 | 套件化重整（原始碼移入 `src/`、補根目錄檔／`g.mjs`／`toolg/`、`package.json` 比照自有套件、`lodash-es` 取單函數路徑、`src/` 匯出函數 163 個之 JSDoc〔說明、`@param`、`@returns`、`@example`〕100%、README 比照範本、`.npmignore` 定發布面）後全套 | **650 ✓、0 ✗、5 pending**（較前 649 多 1 案＝`g.mjs` 離線可執行且 README 含其全文之守門；pending＝`api-summarize-bench-ai` 五角色，未設 `WK_LIVE_AI=1` 不跑）；`jsdoc -c .jsdoc`、`gDocsExams`、`gDistRollup` 皆 exit 0；`require(dist)` 具名匯出 261＝主入口 261；`npm pack --dry-run` 82 檔（含 `test/tools` 8 檔、`模型評比.csv`，不含 `test/*.test.mjs`、`sgud`、`CLAUDE*.md`）；tarball 於全新最小專案安裝後深層路徑、`info()`、`test/tools/summarizeTestKit.mjs`、`require` 皆可用 |
| 2026-11-01 | 同步子階段補傳每輪依賴之語言設定（`stages/syncStage.mjs`：lang 非繁體中文時同步路徑之 SS3 不判、不轉字形；GEN-20 ①）＋ `unit-summarize-sync` L 案；規則帳本三分檔逐條核對後全套 | **649 ✓、0 ✗、5 pending**；下游關聯 546 ✓、提煉 831 ✓；宿主 run-all 39 ✓ |
| 2026-11-01 | 抓取改取 npm 套件 w-knowledge-capture 1.0.1（抓取埠與測試橋接改 npm 指定詞、package ① 守門分相對／npm 兩形）；STD-01 之 fixKeepLinks（樣本期間、限制、概念）＋ SS3 案補連結與網址不轉之斷言；依賴對齊 | **648 ✓、0 ✗、5 pending** |
| 2026-11-01 | 抓取套件之執行秩序件改取 w-data-pipeline／w-dispatch-ai／wsemi（經抓取埠同名取用；測試之 `createClock` 改名 `genClockTZ`，本套件程式未改）後全套 | **648 ✓、0 ✗、5 pending** |
| 2026-10-30 | 全套（sgud 建立、package 守門增 sgud／ignore 檔判準後） | **648 ✓、0 ✗、5 pending**（真 AI） |
| 2026-10-30 | 提煉審計檢查點 `pk p1` | 648 ✓ |
| 2026-10-29 | 關聯審計 P10 複本複驗 `fix SS3 --apply` | 修不了 5、held 5、重掃 5、無回退判準、exit 0 |
| 2026-10-12 | 審計 P13 複本往返（舊碼 ‖ 新碼） | 預演 5,106 件 0 差、處置帳 0 差、正式庫 19,065 檔 mtime 0 變動 |

## 功能現況（對應規則帳本）

| 功能 | 狀態 | 規則／測試 |
|---|---|---|
| 預篩 triage（標題＋開頭片段；fail-open） | 落地 | SUM-01～03；`unit-summarize-stages`、`unit-flow-summarize` |
| 摘要 summarize（依字數打包、納入閘、數字紮根、md 落地） | 落地 | STD-05、STD-02；`unit-summarize-material`、`unit-summarize-digest`、`unit-summarize-standards` |
| 重標 retag（分類法同步：改名機械、新增／退役 AI 重判、守門） | 落地 | SUM-10～12；`unit-summarize-retag` |
| 同步 sync（筆記 md 之標題／概念／一句話重點變更偵測、過筆記標準） | 落地 | SUM-13；`unit-summarize-sync` |
| 素材問題退回抓取（`summarize.refetch`） | 落地 | SUM-08；`unit-summarize-material` |
| 檢定標準 SS1～SS14 之掃描與存量處置（逐單位回退；skipped 列修不了） | 落地 | STD-05／22／25；`unit-summarize-audit`、`unit-summarize-ops`、`unit-summarize-holds`（STD-29「已不再違反之結案」在本套件為筆記同步重驗：`ops/syncNotes` 之 `resolveNoteHolds`，存量處置不列 `resolvable`） |
| SS5 預篩攔下之第二席確認（`summarize.standards.triageConfirm`） | 落地；本專案 2026-10-10 開啟（first gemini／third muse），排程停用中未生效 | STD-13；`unit-summarize-stages` |
| SS14 忠實性覆核（`faithCheck`）與修補（`repair`） | 落地；本專案未開（存量須原文回溯） | STD-16；`unit-summarize-faith`、`unit-summarize-repair` |
| 判定小組之設定面、字樣表、單頁執行器（四工作同用） | 落地 | STD-10／28；`unit-core`、`unit-summarize-assembly` |
| 免費 AI 能力評分（五角色） | 落地；補跑 2026-10-08、10-09 完成（`模型評比.csv`） | GEN-15／16；`unit-summarize-bench` |
| 語言設定 `lang` | 落地 | GEN-20；`unit-summarize-locale` |
| 套件佈局、編譯與文件（`src/`、`g.mjs`、`toolg/`、`dist`、`docs`、JSDoc 全覆蓋） | 落地 | 規則帳本鐵則 9／10；`unit-summarize-package` ②（發布面、依賴對帳、`g.mjs` 守門） |

## 已知缺口與待辦

- **命令列用法字串未隨佈局更新**：`src/bench/summarizeBench.mjs`（五角色之 `command`）與 `src/bench/cli.mjs`（用法、錯誤訊息）仍印 `node bench/cli.mjs …`，套件內實際為 `node src/bench/cli.mjs`；`unit-summarize-bench` 釘住此字串（行為改動，下一輪處理；README 已寫 `node src/bench/cli.mjs`）。
- **疑似遺留（未刪，可能供下游取用）**：六個匯出僅自身檔內使用或僅由主入口轉出而無他處引用——`core/md/noteContent.mjs:PROJECTION_SECTION_TITLES`、`core/standards/numbers.mjs:outputNumbers`、`stores/materialPolicy.mjs:MATERIAL_EXCLUDE_PATTERNS_DEFAULT`、`stores/taxonomy.mjs:diffTaxonomy`／`resolveJob`／`inAddScope`；另 `core/standards/numbers.mjs:24` 之 `AMBIGUOUS_SCALE` 宣告後無引用。
- **SS14 存量**須原文（宿主之原文回溯須使用者同意）；SS4 之存量判定同。
- **提煉之〔樣本內〕推定未看實盤**（設計限制，記於分檔 process_專案-摘要）；提煉套件審計處理。
- `sgud/rule` 三分檔已於 2026-11-01 逐條核對（總則 23〔補入 GEN-20／21／22／24〕、summarize 13、檢定標準 19；報告 `tmp/summarize-doc-debt/報告-*.md`、驗收 `驗收.md`）；`sgud/proc/process_專案-*.md` 與 `sgud/exp/experience_專案-通則.md` 仍為 2026-10-30 之複製、檔頭標「未逐條核對」（與抓取套件交付時同，該輪亦只核對 rule 分檔）。
- 宿主專案評比之摘要列為舊題組（1a0606）之結果，要更新須重跑摘要之評比（宿主事；本套件 `模型評比.csv` 為通用題組）。
- 處理要點與經驗之分檔含審計前之沿革敘述，尚未逐條核對是否仍適用（分檔檔頭已標；規則帳本分檔已核對）。

## 需使用者決定者

- 無。
