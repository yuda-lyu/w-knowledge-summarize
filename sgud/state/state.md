# 現況（w-knowledge-summarize）— 2026-11-08

> 只記現況，不寫過程（過程在 `../exp/`）。接續工作先讀本檔；完成一項功能或結束一輪工作即更新。
> **路徑基準**：原始碼在 `src/`，下文與分檔所列檔案路徑除已標 `src/` 或 `test/` 者外皆相對 `src/`。
> **用語**：「使用端」＝使用本套件之專案；「抓取套件」＝npm `w-knowledge-capture`；「下游」＝讀本套件產物之後續工作。

## 身分與位置

- npm `w-knowledge-summarize`（`package.json` 版本 1.0.x）；主入口 `src/WKnowledgeSummarize.mjs`（具名匯出 273 個＋同組預設物件；2026-11-05 起含 `core/stages/stageReserve` 之 3 個，2026-11-08 起含產出鏈與選件之 9 個：`stores/noteProduced` 6、`stores/notePatch` 增 2、`ops/notesByProvenance` 1）、總組裝 `createKnowledgeSummarize`、執行期件 `createSummarizeRuntime`、物件 `summarizeObject.mjs`。
- **佈局**（2026-11-01 比照自有套件重整）：`src/`（根層 5 檔＋`bench/ core/ domain/ ops/ stages/ standards/ stores/`）、`test/`（33 個 `*.test.mjs`＋`tools/` 12 檔＋`golden/`，皆隨 npm 包發布）、`toolg/`（`addVersion`／`modifyReadme`／`cleanFolder`／`gDocsExams`／`gDistRollup`）、`g.mjs`（離線範例）、`.editorconfig` 等根目錄範本檔；`dist/`、`docs/` 為發布流程產製物。`main` 指 `dist/w-knowledge-summarize.umd.js`，不設 `exports` 與 `files`；**不提供 `.npmignore`**（2026-11-02 起；使用者 2026-11-01 裁示：npm 包＝git 版控內容，依 `.gitignore`；本套件無外部執行檔、`test/`〔約 1.2MB〕與 `docs/`〔約 4.1MB〕皆 <10MB），`sgud/`、`test/`、`docs/` 皆隨包，`CLAUDE*.md`、`tmp`、`test/_tmp` 由 `.gitignore` 排除（下游以 `w-knowledge-summarize/src/…`、`w-knowledge-summarize/test/tools/…` 深層路徑取用）。
- 依賴：`dependencies`＝`w-knowledge-capture` ^1.0.13（已安裝 1.0.13；只經 `src/core/capturePackage.mjs`，指定詞 `w-knowledge-capture/src/WKnowledgeCapture.mjs`；測試橋接取其 `test/tools/`；產出鏈共用件 `makeProduced`／`appendProduced`／`pkgIdOf`／`createPromptFpCache` 自 1.0.12 起）、`wsemi` ^1.9.52（已安裝 1.9.52）；`devDependencies`＝`w-data-pipeline` ^1.0.30、`w-dispatch-ai` ^1.0.81、`w-orm-lmdb` ^1.0.56（皆只測試取用）、`w-package-tools` ^1.1.23（`toolg/` 用，並帶入 mocha、jsdoc）。
- 被誰用：下游套件各經其 `core/summarizePackage.mjs` 取用本套件（深層路徑 `w-knowledge-summarize/src/…`）；使用端經其轉接檔取用。
- 發布由使用者／主控處理；發布前確認與套件化重整已完成（見〈最近驗證〉）。

## 審計與結構

| 項 | 狀態 |
|---|---|
| 套件審計（2026-10-11～12） | **結案**：結論見經驗檔〈審計之心得〉；共用件之歸屬見 GEN-19 |
| 泛用化審計（2026-10-28） | 結案；`cfg.lang`（GEN-20）；domain 契約新選項（`domain.contract`、`stageOpts.summarize.sink`、`stageOpts.triage.rank`）皆 opt-in |
| 隨下游審計之修改（2026-10-29） | `runPanelPage` opt-in 擴充＋`PANEL_THIRD_STOP`、`sectionItemsOf`、`stageKit.bagCtx` 入共用件之家；`standards/stockFix.mjs` 有 skipped 之標準列修不了（SS3）、測試「SS3 之概念轉正體會改分群鍵者」（647 → 648） |
| `sgud/` 套件角度整理（2026-11-01） | 結案：檔名去 `專案-` 前綴（`rulebook_general`／`rulebook_summarize`／`rulebook_standards`、`process_common`／`process_summarize`／`process_standards`、`experience_general`）；內容剝除使用端（宿主專案）專屬部分、改套件角度，規則 ID 與節號不變，缺號者見各索引〈已移出〉；盤點指令皆於套件根重跑 |

## 最近驗證

| 日期 | 項 | 結果 |
|---|---|---|
| 2026-11-08 | 產出鏈 stage 登記（SUM-15 第二輪：人工匯入 `ingest`、重標之 AI 重判 `retag`、機械改名維持 `standards-fix`；`NOTE_WRITE_STAGE` 增 `retagMech`；`unit-flow-summarize-provenance` 增 P5 人工匯入與選件案）後全套 | **786 ✓、0 ✗、5 pending**（上一輪 785）；修前紅（對本輪改動前之工作樹）8 ✗／93 ✓；變異 10 個全數擊殺（含「AI 重標仍記 standards-fix」「匯入仍記 summarize」）；eslint 新檔 0 錯誤、既有檔錯誤數不變 |
| 2026-11-08 | 筆記之產出鏈（SUM-15；新增 `stores/noteProduced`、`ops/notesByProvenance`；`stores/notePatch` 增深合併殘留之先清；摘要新建、人工匯入、重標、同步修正、存量處置接線；預篩確認之票 `triageVotes`；新增 `unit-summarize-provenance` 38 案、`unit-flow-summarize-provenance` 12 案，`unit-summarize-retag`／`-sync`／`-stockfix` 各增〈產出鏈〉組 5／4／3 案）後全套 | **785 ✓、0 ✗、5 pending**（改前 723 ✓；增 62 案；pending＝`api-summarize-bench-ai` 五角色）；修前紅：新檔對改動前之 HEAD 載入即敗（新模組缺失），對「HEAD＋只加輔助模組、不接站點」之半修版 31 ✗／112 ✓；變異 59 個全數擊殺、0 存活；L3 前後 diff（摘要新建 4、人工匯入 1）md 去掉 `produced_*` 行後逐位元組相同、記錄去掉產出鏈三欄後逐欄相同；既有測試只改三處斷言（皆新增欄位）；eslint 新檔 0 錯誤、既有檔錯誤數與 HEAD 相同；`npm pack` 內容與 `dist/`、`docs/` 未動 |
| 2026-11-05 | 預篩（含第二席確認）、摘要（含修補、忠實性覆核）扣保留給後段之時間（SUM-14；新增 `core/stages/stageReserve`；新增 `unit-summarize-reserve` 27 案、`unit-summarize-reserve-gate` 12 案，`unit-summarize-log-contract` 增 1 案）後全套 | **723 ✓、0 ✗、5 pending**（改前 683 ✓；pending＝`api-summarize-bench-ai` 五角色）；修前碼（改動前之原始碼）對 `unit-summarize-reserve` 20 ✗／7 ✓（7 ✓＝保留未給行為不變與不誤報之守門案）；變異 58 個全數殺死、0 存活；保留未給之行為與提示詞不變（`unit-summarize-stages`、`unit-flow-summarize`、`unit-summarize-retag` 原案全綠） |
| 2026-11-02 | 字數類 opt／逐篇 budgets 以 `iseint` 判定後 `Number()` 取值（GEN-25；wsemi 升 ^1.9.44；新增 `unit-summarize-charcount` 31 案、`test/tools` 4 檔〔嚴格版替身〕）後全套 | **683 ✓、0 ✗、5 pending**（改前 652 ✓；增 31 案；pending＝`api-summarize-bench-ai` 五角色）；修前碼對新測試 20 ✓／11 ✗（修前紅）；修前修後提示詞差分：有效值與未給 9,834 比對 0 差；變異 16 個殺死 15、存活 1（等價）；嚴格版 `strTruncate` 下修前碼 35 案拋錯、修後 0 |
| 2026-11-02 | 升抓取套件 `w-knowledge-capture` ^1.0.2（`wsemi` ^1.9.40、`w-package-tools` ^1.1.22 本已就位）、五角色 `casesHelp` 之題組路徑改 `src/bench/cases/…`、`unit-summarize-bench` 首行正規式改 `node src/bench/cli.mjs` 並於用法案補斷言（`--help` 首行、不含舊字串、題組路徑存在）、`unit-summarize-stores` 之 `knownConceptOf` 案概念樣本改合成後全套；`node toolg/gDocsExams.mjs` 實跑 exit 0 | **652 ✓、0 ✗、5 pending**（升版後未改測試前 651 ✓、1 ✗＝釘舊首行之用法案；案數不變）；`migrate-sgud --apply` 末行 `hygiene=ok pack=ok(203 檔)`；`npm pack --dry-run` 203 檔（`sgud` 11、`test/tools` 8、`CLAUDE*.md` 0） |
| 2026-11-02 | 發布面改依 git 版控內容（刪 `.npmignore`；`unit-summarize-package` ② 改判準並增〈打包清單〉案）、命令列用法字串改 `node src/bench/cli.mjs`（五角色 `command` 與 `cli.mjs` 之用法、錯誤訊息；`unit-summarize-bench` 增〈用法為實際可執行路徑〉案）、`unit-summarize-stores` 素材問題理由樣本改合成之中立樣本、`captureForTest.mjs` 註解修正後全套 | **652 ✓、0 ✗、5 pending**（改前 650 ✓、5 pending；增 2 案）；`npm pack --dry-run` 203 檔（`sgud` 11、`test/tools` 8、`test/*.test.mjs` 30、`test/golden` 1、`docs` 79、`CLAUDE*.md` 0）；`migrate-sgud --apply` 末行 `hygiene=ok pack=ok` |
| 2026-11-01 | `sgud/` 套件角度整理後全套（只動 `sgud/`，程式與測試未改） | **650 ✓、0 ✗、5 pending**（與整理前同數；pending＝`api-summarize-bench-ai` 五角色） |
| 2026-11-01 | 套件化重整（原始碼移入 `src/`、補根目錄檔／`g.mjs`／`toolg/`、`package.json` 比照自有套件、`lodash-es` 取單函數路徑、`src/` 匯出函數 163 個之 JSDoc〔說明、`@param`、`@returns`、`@example`〕100%、README 比照範本、當時以 `.npmignore` 定發布面〔2026-11-02 起改無 `.npmignore`，見上列〕）後全套 | **650 ✓、0 ✗、5 pending**（pending＝`api-summarize-bench-ai` 五角色，未設 `WK_LIVE_AI=1` 不跑）；`jsdoc -c .jsdoc`、`gDocsExams`、`gDistRollup` 皆 exit 0；`require(dist)` 具名匯出 261＝主入口 261；當時 `npm pack --dry-run` 82 檔（含 `test/tools` 8 檔、`模型評比.csv`；現況見上列）；tarball 於全新最小專案安裝後深層路徑、`info()`、`test/tools/summarizeTestKit.mjs`、`require` 皆可用 |
| 2026-11-01 | 同步子階段補傳每輪依賴之語言設定（`stages/syncStage.mjs`：lang 非繁體中文時同步路徑之 SS3 不判、不轉字形；GEN-20 ①）＋ `unit-summarize-sync` L 案後全套 | **649 ✓、0 ✗、5 pending** |
| 2026-11-01 | 抓取改取 npm 套件 w-knowledge-capture 1.0.1（抓取埠與測試橋接改 npm 指定詞、package ① 守門分相對／npm 兩形）；STD-01 之 fixKeepLinks 案補連結與網址不轉之斷言；依賴對齊 | **648 ✓、0 ✗、5 pending** |
| 2026-10-30 | 全套（package 守門增 sgud／ignore 檔判準後） | **648 ✓、0 ✗、5 pending**（真 AI） |
| 2026-10-29 | SS3 存量處置有 skipped 者列修不了：複本複驗 `fix SS3 --apply` | 修不了 5、held 5、重掃 5、無回退判準、exit 0 |

## 功能現況（對應規則帳本）

| 功能 | 狀態 | 規則／測試 |
|---|---|---|
| 預篩 triage（標題＋開頭片段；fail-open） | 落地 | SUM-01～03；`unit-summarize-stages`、`unit-flow-summarize` |
| 摘要 summarize（依字數打包、納入閘、數字紮根、md 落地） | 落地 | STD-05、STD-02；`unit-summarize-material`、`unit-summarize-digest`、`unit-summarize-standards` |
| 重標 retag（分類法同步：改名機械、新增／退役 AI 重判、守門） | 落地 | SUM-10～12；`unit-summarize-retag` |
| 預篩、摘要扣保留給後段之時間（開工前與每輪開工前判「扣保留後剩餘 ≥ 該席位一次呼叫之估計」、呼叫以「剩餘−保留」封頂、不足時文件留池並附 `detail.deferred`；修補／覆核不足時本批不套用；保留未給行為不變） | 落地（2026-11-05；預篩主迴圈、第二席確認、摘要主段、修補、覆核；與重標同法） | SUM-14（規則帳本鐵則 12）；`unit-summarize-reserve`、`unit-summarize-reserve-gate`、`unit-summarize-log-contract` |
| 筆記之產出鏈 produced（記錄加 `produced`／`producedHistory`／`producedHistoryDropped`，md front matter 只加純量鍵 `produced_stamp`／`produced_stage`／`produced_provider`；落筆記之站點〔摘要新建、人工匯入、分類法重標、同步修正、存量處置〕一律經 `stores/noteProduced`；`provider` 取該次呼叫之成交條目〔遞補者〕、成交條目未知者不寫；`promptFp` 取評比機制之指紋；依之選件 `notesByProvenance`〔純讀〕；預篩確認小組之票寫文件記錄 `triageVotes`） | 落地（2026-11-08；規格為跨套件之「知識套件之產出鏈」，使用端需求見 Gitea #107）；stage 依規格 §4：`summarize`（摘要新建）、`ingest`（人工匯入）、`retag`（重標之 AI 重判）、`standards-fix`（機械改名、同步修正、存量處置；2026-11-08 第二輪登記） | SUM-15（規則帳本鐵則 13）；`unit-summarize-provenance`、`unit-flow-summarize-provenance`、`unit-summarize-retag`／`-sync`／`-stockfix` 之〈產出鏈〉組 |
| 同步 sync（筆記 md 之標題／概念／一句話重點變更偵測、過筆記標準） | 落地 | SUM-13；`unit-summarize-sync` |
| 素材問題退回抓取（`summarize.refetch`） | 落地 | SUM-08；`unit-summarize-material` |
| 檢定標準 SS1～SS14 之掃描與存量處置（逐單位回退；skipped 列修不了） | 落地 | STD-05／22／25；`unit-summarize-audit`、`unit-summarize-ops`、`unit-summarize-holds`（STD-29「已不再違反之結案」在本套件為筆記同步重驗：`ops/syncNotes` 之 `resolveNoteHolds`，存量處置不列 `resolvable`） |
| SS5 預篩攔下之第二席確認（`summarize.standards.triageConfirm`） | 落地；預設關 | STD-13；`unit-summarize-stages` |
| SS14 忠實性覆核（`faithCheck`）與修補（`repair`） | 落地；預設關（存量須原文回溯） | STD-16；`unit-summarize-faith`、`unit-summarize-repair` |
| 判定小組之設定面、字樣表、單頁執行器（四工作同用） | 落地 | STD-10／28；`unit-core`、`unit-summarize-assembly` |
| 免費 AI 能力評分（五角色） | 落地；補跑 2026-10-08、10-09 完成（`模型評比.csv`） | GEN-15／16；`unit-summarize-bench` |
| 語言設定 `lang` | 落地 | GEN-20；`unit-summarize-locale` |
| 字數類 opt（`summarizeCharsPerDoc`、`triageCharsPerDoc`、`longDocChars`）與逐篇 `budgets[i]` 之判定（`iseint` count、下限 1 → `Number`；非預期改用預設，含 `Infinity`）；wsemi 第 3 輪嚴格版 `strTruncate` 替身下不拋錯 | 落地（2026-11-02；wsemi 第 3 輪尚未改，本套件先行） | GEN-25（規則帳本鐵則 11）；`unit-summarize-charcount` |
| 套件佈局、編譯與文件（`src/`、`g.mjs`、`toolg/`、`dist`、`docs`、JSDoc 全覆蓋） | 落地 | 規則帳本鐵則 9／10；`unit-summarize-package` ②（發布面、依賴對帳、`g.mjs` 守門） |

## 已知缺口與待辦

- **疑似遺留（未刪，可能供下游取用）**：六個匯出僅自身檔內使用或僅由主入口轉出而無他處引用——`core/md/noteContent.mjs:PROJECTION_SECTION_TITLES`、`core/standards/numbers.mjs:outputNumbers`、`stores/materialPolicy.mjs:MATERIAL_EXCLUDE_PATTERNS_DEFAULT`、`stores/taxonomy.mjs:diffTaxonomy`／`resolveJob`／`inAddScope`；另 `core/standards/numbers.mjs:24` 之 `AMBIGUOUS_SCALE` 宣告後無引用。
- **字數類取值之餘項（GEN-25 範圍外，未動）**：①抓取套件之設定型別 `pint`（`Number.isInteger(v) && v > 0`）收逾 4294967295 之有限整數，`summarize.charsPerDoc`／`summarize.triage.charsPerDoc` 給此類值不在啟動期拋錯，經 domain 靜默改用預設（建議由抓取套件之 `pint` 改以 `iseint` count 判定）；②同型寫法（`ispint`→`cint`）但未傳給 wsemi 第 3 輪變動函數者：`domain/digestDomain.mjs` 之 `shortMax`／`longMax`、`core/stages/aiBatchStage.mjs` 之 `batchSize`／`parallel`／`rounds`、`core/vocab/conceptGroups.mjs` 之 `limit`——`Infinity` 仍會過 `ispint` 而成 `Number.MAX_VALUE`，是否同改待使用者裁示。
- **SS14、SS4 之存量**須原文（使用端之原文回溯須使用者同意）。
- **保留時間之已知特性（SUM-14，未動）**：每輪開工判斷只用該段主席位之一次呼叫估計，不預扣同批後續修補／覆核席之時間；開工後若覆核席不夠，該批主呼叫已耗而整批不套用（與整輪逾期同，下輪重做）。若實務上此情形常見，可改為開啟修補／覆核時以主席位＋覆核席估計之和為每輪門檻（待使用者視觀察裁示）。`dist/`、`docs/` 為發布流程產製物，本次未重建（`require(dist)` 之具名匯出待發布流程重建後與主入口 273 對齊）。
- **產出鏈之已知限制與待裁示（SUM-15，2026-11-08）**：①修補與覆核之成交條目不入 `produced`（新建之 `provider` 為主呼叫之成交條目；修補回覆採用之欄位可能出自另一成交條目，單一 `produced` 無處容納；若須記，規格需定「摘要之多步形狀」）；②（已裁定，2026-11-08）stage 登記 `ingest`（人工匯入）與 `retag`（重標之 AI 重判）；機械改名維持 `standards-fix`；預篩、修補、覆核非筆記寫入點、規格不列；③使用者之編修經同步入口照實回記錄而本套件未改寫者不記產出鏈（已裁定採納）；④`ops/noteRestoreGate` 只回傳修正後之 md 與 recordPatch、由呼叫端落地，其回傳不含產出鏈（已裁定不動）；⑤自訂 `domain`（含自訂提示詞）之 `promptFp` 仍為內建角色＋現行詞彙之指紋（已裁定採納）；dist（UMD）下內建題組不隨包、`promptFp` 省略（抓取套件之限制）；⑥選件介面為 `notesByProvenance(deps, cond)`（`deps.stores.notes`；null 條件選該欄為 null 者、`history:true` 回符合之最近一筆、條件不合即拋；已裁定採納並寫入規格 §6）。
- **GEN-19／22 之守門缺口**：橋接 `test/tools/captureForTest.mjs` 之死轉出、與抓取套件 `test/tools` 同名之共用件手寫副本，本套件尚無自動守門案（規則帳本以人工盤點指令代之）；`test/tools/captureForTest.mjs` 檔頭註解已不再提及本 repo 無之 `unit-core-copies`（2026-11-02）。
- **測試中的領域字樣（餘項）**：`unit-summarize-stores` 已於 2026-11-02 全檔中立化（素材問題理由樣本與 `knownConceptOf` 案之概念樣本改合成，判定不變；抓取套件 `domainTermsIn` 重掃全檔 0）。領域中立守門（`unit-summarize-package` ③、`unit-summarize-domain`）不掃測試檔，其餘測試檔以 `domainTermsIn` 逐檔掃仍有命中（`unit-core`、`-audit`、`-ops`、`-stages`、`-standards`、`-stockfix`、`-repair`、`-sync`、`-holds`、`-locale`、`-faith`、`-assembly`、`-contract`、`test/tools/quantRule.mjs`；`-domain`、`-package`、`-bench`、`-registry` 之命中屬領域中立守門之自檢，刻意含詞）；是否逐檔中立化待使用者裁示。

## 需使用者決定者

- 見上〈已知缺口與待辦〉末項（其餘測試檔之領域字樣是否中立化）。
- 見上〈已知缺口與待辦〉「字數類取值之餘項」（抓取套件 `pint` 之上限；`shortMax`／`longMax`、`batchSize` 等同型寫法是否同改）。
