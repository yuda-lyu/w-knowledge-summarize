# 處理要點 — 檢定標準之運維

> 本檔屬本套件之處理要點:本套件提供之檢定標準維運能力(符合度掃描、存量處置、AI 標準之開啟、待判之處置、SS4 之原文材料)與其判準。規則見 `../rule/rulebook_standards.md`(STD-*)。寫入者(正式庫)之執行鎖、備份與使用者同意由呼叫端(使用端)負責,使用端須知見 `process.md`。

## 檢定標準之運維(規則帳本 §11 STD-*)

- **符合度**(STD-00):`auditSummarizeStandards(deps, { only, material, maxIds, onNote })`(唯讀;`only` 限標準、`material:false` 不讀原文〔SS4 每篇記未能判定〕、`maxIds` 限每態列出之 id 數)→ 逐標準 `{ total, pass, violation, undetermined, na, waived, violations, undetermineds, waiveds }`(SS11 另附規則指紋 `fp`)與 `ai`(SS5／SS9／SS14 之待判 `open`／`waived`)。管線每輪自動掃一次:`summarize.standards.scanEachRun: true`(預設關;計數入 `run.json.standards`)。判讀:違反 > 0 必看;違反數較前次掃描增加而非標準升版所致者,新進閘門應已擋住——查寫入入口(納入閘、人工匯入、同步、還原筆記)。
- **存量處置**(STD-22／25;`src/standards/stockFix.mjs`):①預演 `planNoteStockFix(deps, { stds, ids, limit, material })`(不寫)→ 呈報 `counts`(各標準違反數與將修件數)、`items`、修不了者 `unfixable`。②套用 `applyNoteStockFix(deps, plan)`:逐件以現值重算再寫,處置帳 `stock-fix.jsonl`(`opt.ledgerFile` 或 `deps.dirs.state` 下),修不了者登錄待判(user)。③連鎖斷言 `verifyNoteStockChain(deps, rows)`(rows＝套用回傳之 `ledger` 或 `readNoteStockLedger` 之產物) ＋ 重掃(`auditSummarizeStandards`);下游連鎖由呼叫端依回傳 `applied[].titleChanged／contentChanged／consumed／conceptKeys` 處置。④回退 `rollbackNoteStockFix(deps, readNoteStockLedger(file, { since }))`:依帳逆序、逐單位三態,其後被改動者報 `conflicts`(`opt.acceptCurrent` 接受現值)。
  - **回退判準**(建議呼叫端採用):連鎖斷言有問題、套用有 `errors`、或套用後重掃之不合格多於「應剩」之件數 → 回退。全量:應剩＝預演之 `unfixable` 件數(含「有修正而仍有殘留」者——擠標籤有段非既有概念、SS3 轉正體會改分群鍵者;本套件已把此類殘留列入 `unfixable`,STD-22);限量(`opt.limit`):應剩＝套用前以同一口徑(只本次之標準)先掃之不合格件數減已套用之件數,下限 0——否則限量套用必被判回退。
  - 注意:`readNoteStockLedger` 遇壞行即拒(`allowBad` 才略過);以複本演練時,筆記記錄之 `file` 若指向原庫之 md,套用會寫回原 md——須先改指複本。
- **AI 標準之開啟**(SS5 預篩確認 `summarize.standards.triageConfirm`、SS14 忠實性覆核 `summarize.standards.faithCheck`;預設皆關,開啟須使用者同意):①對應角色之評分題組以正式席位逐案兩回全過(`node src/bench/cli.mjs --role triage|faith --models <席位> --runs 2 …`;評比表記提示詞指紋,提示詞或題組改了須重跑,STD-10)。②席位:預篩確認席 `first` 必填、覆核 `first`／`second` 必填,首兩票須不同家(預篩確認之首兩票為預篩席與確認席 `first`;覆核為 `first`、`second`)——`summarizePanelsOf(settings)` 取各小組之必填與投票組合;缺必填席 → 拋錯,首兩票同家而無首選不同之第三席 → 啟動期警告「判定小組永遠無法成立」。③改設定開關與配額。
- **AI 標準之容量**(開啟前依「容量 ≥ 進料」定配額與席位;呼叫數為下限＝兩席各 1 次／頁,另加第三席〔兩席不一致時〕):

  | 標準 | 存量 | 一頁 | 進料 | 呼叫量 |
  |---|---|---|---|---|
  | SS14 忠實性 | 不覆核(須原文) | 摘要之一批 | 新筆記(過納入閘者) | 每批多 2 次(第一、二席),不一致再加第三席;摘要 AI 呼叫約 3 倍(STD-16) |
  | SS5 預篩確認 | — | 同預篩批(`summarize.triage.docsPerCall`) | 預篩席攔下者(reject-pending) | 每批 1 次(確認席),不一致再加第三席;每輪至多 `summarize.triage.rounds×ai.parallel×summarize.triage.docsPerCall` 篇(同預篩容量) |
  | SS9 重標 | 只在分類法變更時 | `summarize.retag.notesPerCall`(預設 20) | — | 每輪至多 `perRun÷notesPerCall` 次(預設 60÷20＝3);新增一類須重判落點類別之全部筆記 |

- **待判**(STD-07):列出 `listHolds(holds, { status, object, std, owner })`、逾期 `overdueHolds(rows, nowIso)`;處置 `requestRetry(holds, 鍵, { at })`、`waiveHold(holds, 鍵, { by, ruling, at })`(須記裁示者與內容)、`resolveHold`;`summarize-failed` 之文件重開 `reviveFailedDocs(stores, { match, nowIso, apply })`(預設預演;原文自另存回填、tries 歸零、該文件未結之待判結案)。各待判之 `next` 即可完成之處置。
- **SS4 之原文材料與存量判定**(STD-03、STD-22):材料＝原文標題＋摘要當時送出之內文(`noteMaterialOf`);原文已瘦身而無另存者 SS4 只能未能判定。記錄缺 `processedChars` 者材料取全文,較送出範圍寬——補入原文前,宜先補存量筆記之 `processedChars`,否則 SS4 材料會放寬到 AI 當時未讀之後段。網頁類回溯物(`currentPage`)不作 SS4 材料,API 依編號取得者照用。流程:原文可得 → `auditSummarizeStandards(…, { only: ['SS4'] })` 判定 → `planNoteStockFix(…, { stds: ['SS4'] })` 預演 → 同意後套用(含原文沒有之數字之清單行逐條移除;標題／一句話重點有者入待判)。
