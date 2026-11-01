# 處理要點（專案複製）— srcSummarize 之使用與驗收、摘要之設定、維運與監看

> 自專案 `CLAUDE_process.md` 之〈srcSummarize 之使用與驗收〉與〈摘要之設定、維運與監看〉於 2026-10-30 建 sgud 時整段複製搬入；**未逐條核對是否仍適用**（內含 srcPack 時期之主詞、已結案之待辦與專案專有之路徑）。
> 現況以本套件 `sgud/state/state.md` 與 README 為準；原文仍在專案檔，之後只在本檔增修、不再回寫專案檔。

## srcSummarize(摘要之獨立套件,暫名 w-knowledge-summarize)之使用與驗收(2026-10-07 起)

**背景**:使用者 2026-10-07 要求「重新抽提出[摘要]之功能的程式碼放入 `./srcSummarize`,除了 `./srcCapture` 皆不要 import 其他處程式碼;srcCapture 能以 opt={} 擴充者可擴展重構;維持通用套件角度、不預設量化;設定與提示詞有預設、可由外部覆寫;內含完整測試、檢定標準與免費 AI 能力評分」.方案 `tmp/summarize-extract/方案.md`(v2,複審 28 條全採,`review-1-處置.md`)、全盤 `tmp/summarize-extract/全盤.md`、待決 `tmp/summarize-extract/需你決定.md`.**2026-10-07 使用者「將 ./srcPack 的[摘要] 全部改使用 ./srcSummarize」→ 已切換**:srcPack 之摘要即取自 srcSummarize(規則帳本 GEN-12;方案與複審 `tmp/summarize-switch/`,`srcPack/summarize` 已刪)——改摘要只改 srcSummarize.

- **專案之接點(2026-10-11 起;此前為 srcPack 之單一匯入點,GEN-12)**:摘要轉接檔 `src/pipeline/packages/summarize.mjs`;專案 `src/`、`test/` 取摘要之件一律經它(具名 import;GEN-17).**`info().vocab`(合併之詞彙)只交斷言型 API**(checkNote、gateNoteItem、syncNotes、createNoteRestoreGate、掃描、存量);建摘要 domain(`createTriageDomain`／`createSummarizeDomain`／`createRetagDomain`)須先 `pickSummarizeVocab(詞彙)`——否則「vocab 含不認得之鍵：relationTypes…」.不經 createKnowledgePipeline 而直接呼叫 `planStockFix`／`applyStockFix` 之工具須設抓取套件之 `setConceptFold`(概念折疊之單例只有抓取套件一份;摘要之筆記處置用之;未設則 SS3 之概念轉正體被略過).各套件間已無各帶一份之通用核心件(2026-10-11 srcCapture 審計收斂最後一對——測試用中立詞表——為抓取套件之 `srcCapture/test/tools/domainTerms.mjs`);`node test/unit-core-copies.test.mjs` 守「不再長副本」(2026-10-12 起擴為「明列之共用件只定義於其家」,範圍含四套件與專案之 test/;家與例外見其檔頭與規則帳本 GEN-19).
- **套件審計(2026-10-11～12;終審 `tmp/summarize-pkg-audit/終審.md`、進度 `進度.md`,快照 `pre/`＋`pre-manifest.json` 勿清)之接手須知**:①**跨套件共用件之家**(規則帳本 GEN-19):待判登錄之件(holdKey、putHold、resolveHold、waiveHold、listHolds、overdueHolds、requestRetry、存量待判件)、存量處置帳之協定(stockLedger;壞行即拒、`stockErrorOf`)、掃描之累計器與計數、功能表、提示詞覆寫之驗證、詞彙表解析(vocabKit)、值工具(strOf、textValueOf、checkKeys)、isDirectRun、評分小件、核心件之日誌字樣——**皆在抓取套件**,摘要只經其抓取埠取用;判定小組之組成與必填(panelConfig)、未成立原因之字樣表(PANEL_WHY_LABELS)、批次 AI 之字樣在摘要.摘要之筆記待判之期限為 `noteHoldDeadlineOf`(原 holdDeadlineOf 之名歸抓取之通用件).②**存量處置**:摘要之預演參數為 `opt.stds`(原 only);讀帳遇壞行即拒(CLI `--allow-bad-lines`);還原閘之回傳分列 `contentChanged`／`titleChanged`.③**守門**:舊名、沿革與面向使用者字樣之判準一份(`srcCapture/test/tools/historyMarks.mjs`,四套件同用;摘要之具名例外只一項——提示詞原文「跨篇關聯與提煉」,改即改提示詞與題目識別).④差分夾具 `diff/{harness,stock,lexer}.mjs`(新舊逐案;**依賴測試件**——動測試件亦須重跑).
- **切換之新舊等價證據**(2026-10-07,`tmp/summarize-switch/equiv/`):總組裝 5 情境兩輪(基本／改類別名／時間緊迫／自組管線／插件;替身 AI＋固定時鐘＋真 LMDB)集合、檔案、run.json、日誌、監控紀錄、提示詞全同(只差刻意之字樣通用化);正式庫複本掃描 8 情境與存量預演 3 組全同(只差 `material:false` 之 SS4 改記未能判定);巡檢判定 1,910 行只差 4 行(皆刻意);核心 md 84 個全同;正式組裝 info() 之設定只少 `triageConfirm.ai.second`、詞彙多 evidenceRule／guide.faith、席位與啟動期警告與五類提示詞全同.刻意差異之全集見 GEN-12.

- **邊界**:只經 `src/core/capturePackage.mjs` 取抓取之件(明列名稱;只由主代理增名),測試另有唯一之 `test/tools/captureForTest.mjs`;core 與 srcCapture/core 無同相對路徑之檔;抓取缺能力者於 srcCapture 以 opt-in 擴充(預設不變、附測試).結構測試 `unit-summarize-package`;另可跑 `node tmp/summarize-extract/check-imports.mjs --syntax`.
- **測試(一律自 srcSummarize 根)**:`npm test`(＝`mocha --parallel "test/*.test.mjs" --timeout 180000`)(2026-10-07 切換後 580 通過、5 待定＝真 AI;約 20 秒;srcPack 同日 850 通過);單檔去掉 `--parallel` 換檔名;真 AI `WK_LIVE_AI=1`(燒免費額度).**改 srcSummarize 者另跑下游套件(srcRelate、srcExtract)與專案 run-all**(編排層經它跑摘要);改 srcCapture 者另跑 srcCapture、srcSummarize 與其下游及專案(GEN-10、GEN-12、GEN-17).
- **與 srcPack 之等價證據**(2026-10-07):量化詞彙下 13 類提示詞逐字同;子階段行為差分 12/12;SS11 判定 258,915 項 0 差;正式庫複本 18,114 篇之掃描(SS2／3／4／6／11 計數與 id)與存量預演(2,601 件、修不了 276)全等(`tmp/summarize-extract/h/formal-diff.mjs`);設定 29 鍵逐鍵同(差異只 scanEachRun 預設、triageConfirm.ai.second 移除).
- **本專案之量化覆寫值**(套件預設中立;**已寫入 `data/vocab.json` 之 `evidenceRule`／`guide.faith`**——正式管線經編排層交摘要套件;評分另給 `--vocab`。strict／loose 原取自切換前 srcPack 寫死之 NO_OOS_STRICT_RE／NO_OOS_RE〔該檔已刪〕,無 alt 時指紋 `578f474098c84a30`、含 alt 為 `57946ae001789a4d`):
  - `evidenceRule.subject` `樣本外`、`check` `樣本外驗證`;
  - `strict:[{ p:'(?:無|沒有|缺乏|未(?:經|做|進行|有|曾|提供|提及|說明|驗證|檢驗|測試|做過)?)(?:任何|獨立|額外)?(?:的)?樣本外|僅(?:限)?樣本內|只有樣本內' }]`;
  - `loose:[{ p:'(?:無|未|沒有|缺乏|未提供|未提及|未說明|未明確|未經)[^；;。]{0,10}樣本外|僅樣本內|僅限樣本內' }]`;
  - `alt:[{ p:'^(?!.*(?:未|無|沒|缺|不|待|需|可能|可望|若|如果|假設|計畫|預計|打算|門檻|差距|難度|參考|距離|可行))(?:(?!非).)*實盤(?:真實)?(?:運作|績效|結果|成果|統計|開倉|上線|填單|交易(?!數據|資料|驗證))' }]`——詞彙表「高＝有樣本外驗證**或實盤結果**」之另一種合格證據(2026-10-07 加;加入後指紋改變,不再是 `578f474098c84a30`).**依據**:正式筆記實測(`node tmp/summarize-switch/scan-ss11-alt.mjs`):最高級 1,244 篇中改判 4 篇(不合格 15→14、未能判定 27→24),逐句皆為肯定陳述實盤結果(edelweiss 兩篇基金實際淨值、比特幣兩所實盤開倉、強化學習執行實盤上線);未改判而提到實盤者 3 篇皆為否定句或「實盤數據量測」(市場數據非交易結果,保守不放行).**初版樣式 `(?<!非)實盤` 太寬**:全庫自承無樣本外之 6,229 篇中命中 95 句,多為「非樣本外…或實盤驗證」(非在關鍵詞前數字)、「實盤數據」(市場數據)、「可能影響實盤應用」(展望)——收緊為「全句無否定展望詞＋關鍵詞前無非＋後接結果類名詞」後只命中 10 句且全為真(`scan-insample-live.mjs`).改樣式必重跑兩支掃描逐句核.
  - **提煉之〔樣本內〕推定未看實盤**(提煉套件 `srcExtract/domain/extractDomain.mjs` inSampleOf;原載 `srcPack/extract/domain/extractDomain.mjs`,2026-10-11 提煉切換後在提煉套件:切換後讀同一 `vocab.evidenceRule` 之寬式 admits,只讀 caveats;筆記記錄不含證據說明;詞彙未給 evidenceRule 即不推定):上述 10 篇若為某核心之全部出處會被誤標〔樣本內〕;2026-10-07 實測 0 篇被核心引用 → 記為設計限制,提煉改套件時處理(記錄帶證據說明或改讀 md).
  - `guide.faith = { scope:'特定市場、期間或條件', overclaim:'原文只有回測，筆記寫有樣本外驗證或實盤' }`;其餘取 `pickSummarizeVocab(data/vocab.json)`.產生器 `tmp/summarize-extract/bench/make-quant-vocab.mjs`(以 resolveSummarizeVocab 驗指紋).
- **免費 AI 能力評分**:`node src/bench/cli.mjs --role all --models free --runs 2 --out <專案外目錄> --env <金鑰檔> --board 模型評比.csv`(五角色 × 8 免費模型 × 2 回;每模型每回 26 次呼叫).**`--out` 必放專案外**(AI 工作目錄＝`<out>/ai-workspace`;在專案下 CLI 會讀本專案 CLAUDE.md,不是通用能力).長跑以 detached 執行(範例 `tmp/summarize-extract/bench/run-bench.mjs`,可 `--start HH:MM` 等額度重置).opencode 免費池台灣 08:00 重置,一天約只夠一次全量;撞額度之模型停測、該角色不寫評比表,隔日 `--role <角色> --models <id>` 補.**本專案量化題組**:`--role faith --cases data/bench/standards/SS14.json --vocab <量化詞彙檔>`(SS9 同理 `--role retag`)——**不給 `--board`**(會覆蓋同角色之通用題組列);2026-10-07 zen:space-bunny-free 14/14.**2026-10-07 全量之現況**(全盤 §4 第 6 列):opencode 池於 09:00 限流,忠實性／重標只完成 fledge 與 zen;**補跑已以 detached 排定**——10-08 08:05(`tmp/summarize-extract/bench/plan-20261008.json`,狀態檔 `plan.pid`／`plan-result.json`、日誌 `plan.log`)、10-09 08:05 修補重評(`plan-20261009.json`,狀態檔 `plan-20261009.pid`／`.result.json`);兩支開跑前皆查排程 trigger-kns-trade 須仍為 Disabled,否則整份不跑(記 skipped).接手時先看狀態檔,勿重排同一份;單一模型某角色 0 分而「呼叫失敗 1」者是整頁呼叫失敗,不是判斷錯——補跑該格即可.
- **單獨使用 srcSummarize 時之對應**(本專案管線經編排層 src/pipeline 組裝,不需此表;另以 `createKnowledgeSummarize` 單獨跑摘要時用;README §15 同):

| 專案來源 | 交給 srcSummarize 之 cfg | 注意 |
|---|---|---|
| `settings.summarize` | `summarize`(原樣) | `scanEachRun` 預設 false(本專案要每輪掃描者明給 true);`triageConfirm.ai.second` 給了即拋 |
| `settings.ai` | `ai` 只取 `SUMMARIZE_AI_SCHEMA` 之鍵 | `providerPick`、他工作之池會被拒收;`healthStreak` 預設 3 |
| `settings.capture` | `capture`(原樣) | 素材退回與容量推導讀之 |
| `data/vocab.json` | `data.vocab` ＝ `pickSummarizeVocab(…)`＋上列 `evidenceRule`／`guide.faith` | 不認得之鍵拋錯 |
| `settings.lmdb.db`／`cl` | `lmdb.db`／`lmdb.cls` | 集合預設名即對外名;既有核心集合給 `cores: true` |
| 提煉之保留時間、共用調度實例 | `stageOpts.retag.reserveMs`(他總組裝亦可給每輪依賴 `deps.reserveMs`——本專案之編排層即此)、`aiAdapter` | 本套件不讀他工作之設定 |

---


---

## 摘要(summarize)之設定、維運與監看(2026-10-04 起;方案與三審 `tmp/summarize-audit/終審.md`)

- **子階段順序**:triage(預篩:標題＋開頭片段;長文另附中段)→ summarize(依字數打包:每批 ≤ `summarize.docsPerCall`×`summarize.charsPerDoc`＝18,000 字、≤3 篇;上限內長文全文進 AI)→ retag(分類法同步;有工作且扣掉提煉保留〔提煉啟用時＝提煉下限〕後剩 5 分才處理,每次呼叫預算亦扣保留)→ sync(筆記內容變更之偵測,無 AI).
- **素材問題回報**:預篩／摘要判非知識而理由直指素材壞了(亂碼、未載入、只抓到導覽…;不含付費牆／登入)→ 不丟,退回抓取之瀏覽器佇列並排除產生該素材之方法(curl 來源 → 不用 curl),同一篇至多一次(`summarize.refetch.max` 1;0＝停用).本專案追加樣式填 `summarize.refetch.patterns`([{p,f}]).內建樣式以生產 skip 理由校準(`tmp/summarize-audit/measure-material.mjs`,唯讀;改樣式後重跑比對命中與誤收).
- **分類法變更(要點 4、5)一律改 `data/vocab.json`**:新增類別 → 加進 `categories`(可另給 `categoryHints: { 類別: [關鍵詞] }` 擴大重判範圍);改名 → 新名加進 `categories`、舊名移出、`categoryRenames: { 舊: 新 }`(連續改名保留舊對照即可);退役 → 移出 `categories` 並列 `categoryRetire`;內容類型／證據等級改名 → `claimTypeRenames`／`evidenceLevelRenames`(另檢查提煉之 `evidenceCaps` 是否需同步新名).**移除而不宣告去向** → 每輪 WARN「分類法守門」(巡檢必看)、資料不動.下一輪 retag 自動排工作:改名機械(不呼叫 AI)、新增／退役 AI 重判(席位 `summarize.retag.ai`,本專案 sonnet 首選;新增一類約重判「其他」全部筆記 ≈1,270 篇 ≈64 次、每輪至多 3 次).guide 措辭改了而清單未變 → `node src/tools/taxonomy.mjs requeue <類別>` 明示排入.
- **維運**:`node src/tools/taxonomy.mjs status`(唯讀:版本、下一輪將排入之工作與守門、待處理篇數、預估呼叫)／`requeue <類別>`(取執行鎖)／`proposals [--top N]`(模型給之清單外類別＝筆記 categoryRaw,依篇數排;採納＝加進 categories,categoryRaw 恰為該類者機械改、零 AI).人工筆記匯入 `node src/tools/ingest-notes.mjs <items.json>`(取執行鎖;與摘要同一組裝).狀態檔 `state/taxonomy.json` 為真理檔:無法解析時 retag 停止並 WARN「分類法守門」,刪除＝以現行分類法為已套用(未完工作作廢).
- **監看**(日誌):`預篩：素材問題退回抓取[…]`／`摘要：素材問題退回抓取[…]`、`摘要分類[…]：「X」不在分類清單，落「其他」（原值存 categoryRaw）`、`分類法：首次記錄／排入重標工作——…／重標工作完成——…／本輪重標 N 篇`、WARN `分類法守門：…`(須見)、WARN `分類法：筆記 … md 改寫失敗`／`重判 2 次未成`;摘要段 summary 尾「｜素材退回 N｜長文截斷 N｜重標 N 篇（AI N 次）｜內容變更 N 篇」.巡檢近況總覽之「摘要（今日）」「分類法」兩行.
- **內容變更(sync 子階段,無 AI)**:使用者手改筆記 md 之標題(frontmatter `title`)、概念(`concepts`)或「一句話重點」章 → 下一輪自動偵測(只讀 mtime 新於上次掃描者,每輪約 0.3 秒),同步回記錄並寫 `knowledgeChangedAt`,關聯段據以重判(見下節).改其他章(核心知識等)或分類欄位不觸發.要立刻同步:`node src/tools/notes.mjs sync <slug>`(取執行鎖).**同步入口過筆記標準**(2026-10-05):可確定性修正者(簡體、[object Object] 行、概念計數尾碼…)寫回 md;仍不合格者登錄待判(使用者;`standards holds` 列出),同步照做.
- **摘要失敗之重開**(2026-10-05):`summarize-failed`(逾次未納入)之文件,使用者修正後以 `node src/tools/revive-failed.mjs (--host <主機> | --error <原因子字串> | --ids <docId,…> | --all) [--apply]`(預設只預演;原文自 docTexts 回填、狀態回 raw、tries 歸零,下輪重摘;--apply 取執行鎖)重開,或 `standards waive` 確認不納入;無原文者須重抓(revive-dead 類).

---
