# 回饋（w-knowledge-summarize）

> 任務中發現之自有套件、全域技能、全域設定之調整與抽提提案；只增不改，處置結果另記一列。欄位：日期｜類別｜對象｜內容｜依據。

| 日期 | 類別 | 對象 | 內容 | 依據 |
|---|---|---|---|---|
| 2026-11-11 | 自有套件 | w-knowledge-capture | `reservedAiCallOf` 以 `callOpt.spec` 取席位 `minAttemptMs` 算續派門檻，並把 `spec` 原樣轉交 `call`；下游若有「覆寫之 callAI 不收 spec」之契約（本套件之預篩、摘要、重標主呼叫），須在第一參數內自行剝除。建議包裝另收 `opt.seat`（或 `stepSeat`）供算門檻而不必經 callOpt 轉交，三個下游可少一段剝除碼 | `src/stages/triageStage.mjs`、`src/stages/noteStage.mjs`、`src/stages/retagStage.mjs` 之 `reservedAiCallOf` 第一參數；抓取套件 `src/core/ai/reservedCall.mjs:116,120-124` |
| 2026-11-11 | 自有套件 | w-knowledge-capture | 本套件之 `reserveFnOf` 與抓取套件之 `stageReserveFnOf` 語意相同（同包 `reserveMsOf`）；若抓取套件視 `stageReserveFnOf` 為對下游之公開件，本套件可刪 `reserveFnOf` 改用之（須裁示，設計未列） | `src/core/stages/stageReserve.mjs:reserveFnOf`；抓取套件 `src/core/util/stageReserve.mjs:44-47` |
