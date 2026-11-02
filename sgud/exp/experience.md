# 累積經驗（w-knowledge-summarize）

> 執行時之累積經驗。本檔為索引與摘要；通則分檔如下表。日期一律絕對日期。
> **路徑基準**：原始碼在 `src/`，下文所列檔案路徑除已標 `src/` 或 `test/` 者外皆相對 `src/`。
> **用語**：「使用端」＝使用本套件之專案；「抓取套件」＝npm `w-knowledge-capture`；「下游」＝讀本套件產物之後續工作。

## 分檔

| 檔 | 內容 |
|---|---|
| `experience_general.md` | 通則（節號沿用最初編號，故不連號）：預設席位與供應商 id 之漂移（1）、prompt 長度上限（2）、批量與輸出截斷（7）、測試之 cwd（16）、摘要之素材回報／長文／分類法重標（17）、檢定標準之判準（19）、評分（bench）與等價驗證（24）、他套件與使用端取用本套件之介面（25）、審計所得（32）、泛用化與語言設定（33） |

## 審計之心得（2026-10-11～12 套件審計）

1. **下層需要上層之資料契約，只好手寫——這是跨套件最大之重複**：待判登錄原在本套件而抓取取不到（抓取只好手寫登錄鍵）；掃描累計器、存量帳多份手寫而已分歧（回退 fail-open）。處置：以「最低之使用者」為落點全部下移至抓取套件（GEN-19），本套件只留判定小組之設定面與字樣表（抓取不用）。
2. **同一判定在建構期、執行期、工具各一份即分歧**：必填席位三份、SS5 執行期缺席位靜默關閉並轉 skip。處置：功能表（`SUMMARIZE_FEATURES`＋`summarizeFeatureProblems`）之單一判定，建構期與執行期同讀；缺席位一律拋錯。
3. **新舊往返比對是最終判準**：拿真實規模資料之複本，以舊碼 ‖ 新碼各跑一次真實命令列，預演輸出與處置帳逐筆全同才結案；回退之驗收須比「回退後 ‖ 套用前」之全集合，殘留逐類分設計之簿記與缺陷；時間衍生值（待判期限、事件 id）會假裝成差異，先列分布再判。
4. **複本之記錄外指會寫回原庫**：筆記記錄之 `file` 為指向原庫之絕對路徑——以複本演練存量處置或回退前，先把記錄之 `file` 改指複本；寫入型工具開庫後先驗證不是原庫。
5. **盤點以守門之同一判準跑，不另寫較窄之掃描**；守門之盲點（只靠明列之名）另以不靠名單之盤點補（一名一檔）。
6. **改名只搜呼叫形漏函數參照**：改名後以 `\bname\b` 全檔驗 0。
7. **差分工具依賴測試件**：動測試件亦須重跑依賴其之差分。
8. **SS3 存量處置之殘餘**：概念轉正體會改分群鍵之 skipped 未列修不了，會使使用端之回退判準誤判——有 skipped 之標準列修不了（detail＝理由，STD-22）。

## 結構整理之心得（2026-11-01 套件化：原始碼移入 `src/`、補根目錄檔與編譯工具）

10. **結構測試以位置定根**：掃描原始碼夾之測試（`unit-summarize-entry`、`-package`、`-domain`、`-digest`、`-ops`、`-registry`、`-log-contract`、`-bench`、`unit-vocab`、`unit-summarize-assembly`）原以「本檔位置的上一層」為根；原始碼移入 `src/` 後改以 `<根>/src` 為掃描根，標準檔與題組（`test/golden`）仍在 `test/`。掃描根未收窄時，`tmp/`（暫存與快照夾）內的 `.mjs` 會被走訪而誤報——`unit-summarize-package` 之 `sourceFiles` 明排除 `tmp`、`dist`、`docs`。
11. **編譯 exit 0 不等於可載入**：`opencc-js/dict/*` 若列 external，`require(dist)` 即拋 `g.split is not a function`（套件 exports 之 `./*` 只給 ESM，CJS 得到命名空間物件）；本套件經抓取套件而達該詞庫，故 `gDistRollup` 不剔除之而打包。改清單後一律以 `require` 載入 dist 並比對匯出鍵（261＝261）。
12. **external 清單以 import 圖盤點而非照抄他套件**：本套件不直接引用第三方套件，圖到達者為 node 內建 9 項、`opencc-js`、`dayjs`＋`dayjs/plugin/utc.js`、`tree-kill`、`@mozilla/readability`、`jsdom`、`playwright`、`rss-parser`、`lmdb`；`lodash-es/*`、`crypto-js/*`、`uuid`、`eventemitter3` 與 `opencc-js/dict/*` 被打包。抓取套件清單中本套件圖未到達者（`mingo`、`html-to-text`、`xss`、`cheerio`、`chokidar`、`ua-parser-js` 及 readline／events／stream／process／http／https／buffer）不列。
13. **`lodash-es` 取單函數路徑**：`core/stages/aiBatchStage.mjs` 原 `import { chunk } from 'lodash-es'`（整包）改 `lodash-es/chunk.js`；實函數同一個、行為不變。
14. **子代理補 JSDoc 的驗證法**：只准改 `/** */` 區塊；驗收以「去掉全部 `/** */` 後與搬移前快照逐字比對」證程式碼一字未改（唯一例外為上條之 import），並以腳本抽出每則 `@example` 實跑比對 `// =>`。

（編號沿用最初編號：第 9 條〔派工工具之額度偵測〕屬宿主之派工工具，已移出；第 10～14 條接續其後。）

## 發布面與用法字串之心得（2026-11-02）

15. **發布面以實際打包清單守，不只讀 ignore 檔字樣**：刪 `.npmignore` 後 npm 改讀 `.gitignore`；只斷言 ignore 檔內容抓不到「某資料夾被規則擋掉」。`unit-summarize-package` 增〈打包清單〉案以 `npm pack --dry-run --json --ignore-scripts` 驗含 `sgud/`、`test/tools/`、不含 `CLAUDE*.md`；`npm pack --json` 在 npm 12 回「以套件名為鍵之物件」而非陣列，解析須 `Array.isArray(x) ? x[0] : Object.values(x)[0]`；無 `.npmignore` 時 stderr 有 `gitignore-fallback` 警告，不影響 stdout 之 JSON。
16. **只在直接執行時才印出之字串，須另起行程驗**：`cli.mjs` 之失敗訊息只在 `isDirectRun` 時印，import 後比對常數抓不到；`unit-summarize-bench` 以 `spawnSync` 直接執行 `--help` 與不認得之 `--role`（不連網、離開碼 1）驗用法字串與腳本路徑存在。多角色 `--help` 之首行由抓取套件 `benchRoles` 產生（1.0.1 寫死 `node bench/cli.mjs`，1.0.2 起為 `node src/bench/cli.mjs`），本套件不改該行、只隨版本同步測試。
17. **改測試樣本須先證「命中集合不變」**：素材問題理由樣本中立化時，以腳本（修前取 `git show HEAD:` 之版本）逐案比對各樣式之命中集合、排除樣式與 `problemOf` 判定，全相同才算語意不變；命中片段（含站名）本就不同，不算差異。`knownConceptOf` 案同法：取兩版之輸入與期望，比對判定向量。
18. **升抓取套件後，被釘住其輸出字串之測試會紅，屬預期**：抓取套件 1.0.2 改了 `--help` 首行與 `casesHelp` 之路徑，本套件 `unit-summarize-bench` 釘舊首行之案即紅（651 ✓／1 ✗，僅此一案）；先確認「只有被釘住那條」再改測試。變異模擬舊版：暫改 `node_modules/w-knowledge-capture` 內單行，先 `cp` 備份、驗完 `cp` 還原並以 `git hash-object` 與 `npm ls` 回驗版本（不 `npm i` 重裝）。
19. **字串裡的路徑要驗檔案存在**：`casesHelp` 印的題組路徑（`bench/cases/…` 缺 `src/`）佈局改動後無人察覺；用法案由字串解析出路徑並 `existsSync`，不只比對字面。

## 傳給 wsemi 之值先判定再取值所得之心得（2026-11-02，排程第 271 項第 3 輪，下游先行）

20. **`ispint`→`cint` 不是清洗，是把壞值變成可用之錯值**：`ispint(Infinity)`、`ispint('0x10')`、`ispint(new Number(n))` 皆 true，`cint(Infinity)` 為 `Number.MAX_VALUE`、`cint('0x10')` 為 16；交給 `strTruncate` 後在 wsemi 第 3 輪即拋錯。計算類參數一律 `iseint(v, { use: 'count', min: 1 })` 判定、通過再 `Number(v)`。`ispint` 之「正」與 `iseint` 之下限 `min: 1` 對應，`use: 'count'` 另帶上限 4294967295（超過者曾「實際不截斷」，改後用預設）。
21. **前瞻驗證不必等 wsemi 改版**：依第 3 輪契約自寫嚴格版替身（`test/tools/strictWsemi.mjs`），子行程以 `node --import test/tools/strictWsemiHook.mjs` 經 `module.registerHooks` 的 resolve 掛鉤把 `wsemi/src/strTruncate.mjs` 換成它（比對解析後網址，才連 wsemi 內部之相對引用都換到；替身自己載入真函數時依 `parentURL` 放行，否則自我取代而無窮遞迴）。同行程註冊無效（已載入之模組不重新解析），故測試以 `spawnSync` 起子行程；探針自檢 `hookLive`（嚴格版對 `Infinity`、未給須拋、對 2 不拋），替身沒生效時結果不可信。
22. **提示詞字數之觀察法**：正文全用罕見標記字元（``）、數提示詞內出現個數；非預期值之應然＝「與未給相同」，不寫死預設值。每個選項觀察兩種正文長度（3000、9000）才分辨得出差異——`Infinity` 對 `longDocChars` 只有 9000 看得出（預設 6000 對「從不另附中段」），`'0x10'` 只有 3000 看得出（16 對預設）。
23. **修前紅與變異都用複本，不動工作樹**：修前碼以 `git archive HEAD src` 解到 `tmp/`，探針腳本接「原始碼根」參數即可對同一案例組跑修前碼（嚴格版下 35 案拋錯）；變異於 `tmp/` 複本（src＋測試＋工具）套單行改動後單檔跑 mocha。`Number()` 取值移除為等價變異（任何收數字字串之 count 契約下皆無觀察差異）——保留 `Number()` 是依 wsemi 規格「判定後一律用轉換值」，不是為了讓某測試轉紅。
24. **設定層與 domain 之上限不一致要明列**：抓取套件的 `pint`（`Number.isInteger(v) && v > 0`）已擋 `Infinity`、字串、包裝物件，但收逾 4294967295 之有限整數；該值經 domain 改用預設而非啟動期拋錯。本套件不改抓取套件之型別表，列為待辦（見 state）。
25. **全套測試之守門不必預先調整**：新增 4 個 `test/tools` 檔與 1 個測試檔後，`unit-summarize-package`（打包清單、領域字樣、內網位址）全綠——新檔不含領域詞，守門只靠規則而非檔案數。

## 通用之坑

- 絕不自使用端專案根以 mocha 直跑套件測試檔（GEN-09）。
- 評分 `--out` 放在含指示檔（如 `CLAUDE.md`）之專案目錄下，量到的是「讀過該指示檔」之能力，不是通用能力。
- 本套件之守門擋下新寫之註解提他工作之名——一律中立措辭（「下游」）。
