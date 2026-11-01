# 累積經驗（w-knowledge-summarize）

> 執行時之累積經驗。本檔為索引與摘要；原載於專案經驗檔之節已複製為分檔。日期一律絕對日期。
> **路徑基準**：原始碼在 `src/`，下文所列檔案路徑除已標 `src/` 或 `test/` 者外皆相對 `src/`；`tmp/…` 證據夾與 `srcPack`／`srcSummarize` 等舊名屬原宿主專案，為歷史敘事。

## 分檔

| 檔 | 內容 |
|---|---|
| `experience_專案-通則.md` | 專案經驗通則中與本套件相關之節：AI 供應商目錄（1）、prompt 長度上限（2）、批量與輸出截斷（7）、測試之 cwd（16）、素材回報／長文／分類法重標（17）、檢定標準之判準（19）、抽提為獨立套件（24）、切換為取自本套件（25）、srcSummarize 審計（32）、四套件界定審計（33） |

## 審計之心得（2026-10-11～12 套件審計；終審 `tmp/summarize-pkg-audit/終審.md`、進度 `進度.md`）

1. **下層需要上層之資料契約，只好手寫——這是跨四套件最大之重複**：待判登錄原在本套件而抓取取不到（抓取手寫登錄鍵、CS12 待判由編排層代寫）；掃描累計器四份、存量帳 6 份已分歧（回退 fail-open）。處置：以「最低之使用者」為落點全部下移至抓取（GEN-19），本套件只留判定小組之設定面與字樣表（抓取不用）。
2. **同一判定在建構期、執行期、工具各一份即分歧**：必填席位三份、SS5 執行期缺席位靜默關閉並轉 skip。處置：功能表（`SUMMARIZE_FEATURES`＋`featureProblemsOf`）之單一判定，建構期與執行期同讀；缺席位一律拋錯。
3. **複本往返是最終判準**：正式庫複本以舊碼（P0 快照）‖ 新碼各跑一次真實命令列，預演 JSON（5,106 件）0 差、處置帳 0 差才結案；回退之驗收須比「回退後 ‖ 套用前」之全集合，殘留逐類分設計之簿記與缺陷；時間衍生值（待判期限、事件 id）會假裝成差異，先列分布再判。
4. **複本之記錄外指會寫回正式庫**：複本之筆記／核心記錄之 `file` 為指向正式庫之絕對路徑——演練前一律先 `src/tools/repoint-copy.mjs --apply`；寫入型工具開庫後先驗非正式庫（OPS-02）。
5. **盤點以守門之同一判準跑，不另寫較窄之掃描**；守門之盲點（只靠明列之名）另以不靠名單之盤點補（一名一檔）。
6. **改名只搜呼叫形漏函數參照**（P7 追加 1）：改名後以 `\bname\b` 全檔驗 0。
7. **差分工具依賴測試件**（P11 追加 1）：動測試件亦須重跑依賴其之差分。
8. **SS3 存量處置之殘餘**（2026-10-29 關聯審計 P10 發現）：概念轉正體會改分群鍵之 skipped 未列修不了，使宿主回退判準誤判——有 skipped 之標準列修不了（detail＝理由）。
9. **派工之額度偵測看尾端**：dispatch 之額度偵測只看被截斷之 stderr 開頭，撞額度之訊息在尾端故未偵測到（r-solA 撞 Codex 用量上限）。

## 結構整理之心得（2026-11-01 套件化：原始碼移入 `src/`、補根目錄檔與編譯工具）

10. **結構測試以位置定根**：掃描原始碼夾之測試（`unit-summarize-entry`、`-package`、`-domain`、`-digest`、`-ops`、`-registry`、`-log-contract`、`-bench`、`unit-vocab`、`unit-summarize-assembly`）原以「本檔位置的上一層」為根；原始碼移入 `src/` 後改以 `<根>/src` 為掃描根，標準檔與題組（`test/golden`）仍在 `test/`。掃描根未收窄時，`tmp/`（證據夾與快照）內的 `.mjs` 會被走訪而誤報——`unit-summarize-package` 之 `sourceFiles` 明排除 `tmp`、`dist`、`docs`。
11. **編譯 exit 0 不等於可載入**：`opencc-js/dict/*` 若列 external，`require(dist)` 即拋 `g.split is not a function`（套件 exports 之 `./*` 只給 ESM，CJS 得到命名空間物件）；本套件經抓取套件而達該詞庫，故 `gDistRollup` 不剔除之而打包。改清單後一律以 `require` 載入 dist 並比對匯出鍵（261＝261）。
12. **external 清單以 import 圖盤點而非照抄他套件**：本套件不直接引用第三方套件，圖到達者為 node 內建 9 項、`opencc-js`、`dayjs`＋`dayjs/plugin/utc.js`、`tree-kill`、`@mozilla/readability`、`jsdom`、`playwright`、`rss-parser`、`lmdb`；`lodash-es/*`、`crypto-js/*`、`uuid`、`eventemitter3` 與 `opencc-js/dict/*` 被打包。抓取套件清單中本套件圖未到達者（`mingo`、`html-to-text`、`xss`、`cheerio`、`chokidar`、`ua-parser-js` 及 readline／events／stream／process／http／https／buffer）不列。
13. **`lodash-es` 取單函數路徑**：`core/stages/aiBatchStage.mjs` 原 `import { chunk } from 'lodash-es'`（整包）改 `lodash-es/chunk.js`；實函數同一個、行為不變。
14. **子代理補 JSDoc 的驗證法**：只准改 `/** */` 區塊；驗收以「去掉全部 `/** */` 後與搬移前快照逐字比對」證程式碼一字未改（唯一例外為上條之 import），並以腳本抽出每則 `@example` 實跑比對 `// =>`。

## 通用之坑

- 絕不自專案根以 mocha 直跑套件測試檔（GEN-09）；整點前後不動原始碼。
- 評分 `--out` 放專案下即量到「讀過本專案 CLAUDE.md」之能力，不是通用能力。
- 本套件之守門擋下新寫之註解提他工作之名（「關聯、提煉」）——一律中立措辭（「下游」）。
