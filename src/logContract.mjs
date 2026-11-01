// logContract.mjs — 摘要之日誌與報告契約:外部巡檢判讀摘要段之日誌字樣與正則,及執行摘要(run.json)中摘要段之 report 鍵
//   (唯一來源;隨本套件之訊息與 report 一起改)
//
// 【為何在摘要套件】摘要各子階段(及其所用之批次 AI 機制、總組裝共用件)之訊息字樣與 report 之鍵由本套件之碼產生;巡檢若自寫一份,
//   本套件改字即失效——字樣對不上時,常態訊息被當未知警告洗版、或須見之訊息被已知字樣吞掉。
// 【三類字樣】
//   SUMMARIZE_LOG_KNOWN:已知常態之 WARN 字樣(各有機制兜底,或本為正常訊息)——巡檢不當未知警告;
//   SUMMARIZE_LOG_MUST_SEE:一律須見之字樣(行內即使含已知字樣或標題,亦須列出;他工作之已知字樣過寬時亦不被吞);
//   SUMMARIZE_LOG_PARSE:逐輪數字之正則(執行摘要 run.json 缺時之退路;group 1 為數字)。
//   前兩類為正則片段字串,巡檢以「|」併入其總表(與其他工作之字樣合併)。
// 【字樣由發出者宣告、本檔以聯集組成】摘要各子階段專屬者列於本檔;批次 AI 機制(core/stages/aiBatchStage;本段給套用前覆核)所發者取其
//   AI_BATCH_*;總組裝共用件與抓取套件之核心件所發者取抓取套件之 CORE_LOG_*——不另抄一份。
// 【字樣取該行特有之片語】已知字樣若是常見詞(如只寫「預篩」),會連帶吞掉同段之設定錯誤警告(摘要段之「…皆無預篩結果…」);
//   不再有發出者之字樣不列(列著只會吞掉日後碰巧含之之新訊息)。
// 【report 鍵】SUMMARIZE_REPORT_KEYS:階段名、子階段鍵、統一統計之鍵、各子階段 detail 之鍵(全集;部分鍵只在條件下出現,見各列註解)——
//   巡檢讀 run.json 之 stages[].sub 依此取值,固定格式摘要(summarizeObject 之 summarizeSummaryOf)讀同一組鍵。
// 【以實際訊息驗證】單元測試以真實之子階段與總組裝產出之日誌與 report 驗證(test/unit-summarize-log-contract、unit-flow-summarize):
//   每條字樣皆須在實際日誌出現、每個 report 鍵皆須在實際 report 出現,實際 report 亦不得有未列之鍵。

import { CORE_LOG_KNOWN, CORE_LOG_MUST_SEE } from './core/capturePackage.mjs'
import { AI_BATCH_LOG_KNOWN, AI_BATCH_REVIEW_LOG_KNOWN, AI_BATCH_LOG_MUST_SEE } from './core/stages/aiBatchStage.mjs'

/**
 * 摘要段之已知常態 WARN 字樣(正則片段;摘要專屬者＋批次機制(含套用前覆核)＋核心件之字樣)
 *
 * @type {Array}
 */
export const SUMMARIZE_LOG_KNOWN = Object.freeze([
    // 未涵蓋／整批失敗之終態(達重試上限出隊正是隊頭防阻塞在運作)——真的大量發生時由產出停滯等判準反映
    '未被模型完整涵蓋', '摘要批次失敗', '標為 summarize-failed',
    // 預篩失敗達上限放行交摘要(fail-open 在運作;攔不下者由摘要以全文再判)
    '放行交摘要',
    // 批次 AI 機制所發者(全鏈失敗、批次例外、時間預算守門;本段給套用前覆核——其中止亦常態)
    ...AI_BATCH_LOG_KNOWN, ...AI_BATCH_REVIEW_LOG_KNOWN,
    // 核心件所發者(管線秩序、AI 調度層之事件)
    ...CORE_LOG_KNOWN,
])

/**
 * 摘要段之一律須見字樣(正則片段;純文字;摘要專屬者＋批次機制＋核心件之字樣)
 *
 * @type {Array}
 */
export const SUMMARIZE_LOG_MUST_SEE = Object.freeze([
    // 逐項鏈異常(摘要／預篩之逐項動作鏈拋錯＝程式或寫入問題;不標終態、每次 WARN)——行內含標題,預篩者另以「放行交摘要」(已知)收尾
    '逐項鏈異常',
    // 分類法守門:類別／內容類型／證據等級自清單移除而未宣告去向、狀態檔無法解析(資料不動;類別名可能含他處之已知字樣)
    '分類法守門',
    // 筆記之 md 讀不到(記錄在而 md 不在:不自動視為刪除,須還原或明示刪除)
    '篇筆記之 md 讀不到',
    // 設定矛盾:摘要只取已預篩放行者而池中皆無預篩結果(預篩段停用或未執行;本段永遠取不到件)
    '皆無預篩結果',
    // 批次 AI 機制所發者(批次例外之落帳失敗)
    ...AI_BATCH_LOG_MUST_SEE,
    // 核心件所發者(本機網路不通;行首為已知之「批次 AI 失敗」)
    ...CORE_LOG_MUST_SEE,
])

/**
 * 逐輪數字之正則(執行摘要缺時之退路;group 1 為數字):
 *   processed／notes／skipped／aiCalls:管線執行器之段落完成行(「步驟N 摘要 完成：」＋summarizeObject 之固定格式摘要;aiCalls 取第一個
 *     「（AI N 次）」＝摘要子階段之呼叫數);
 *   rawPool／rawDays:摘要子階段之積壓可見性行(「raw 池 N 篇（最舊 M 天…）」;預篩啟用時其後另附「，已預篩放行 K」)
 *
 * @type {Object}
 */
export const SUMMARIZE_LOG_PARSE = Object.freeze({
    processed: /步驟\d+ 摘要 完成：處理 (\d+)/,
    notes: /步驟\d+ 摘要 完成：.*?新知識 (\d+)/,
    skipped: /步驟\d+ 摘要 完成：.*?略過 (\d+)/,
    aiCalls: /步驟\d+ 摘要 完成：.*?（AI (\d+) 次）/,
    rawPool: /raw 池 (\d+) 篇/,
    rawDays: /raw 池 \d+ 篇（最舊 (\d+) 天[，）]/,
})

/**
 * 執行摘要(run.json)中摘要段之 report 鍵:stages[] 中 name 為 stage 之段,其 sub 為子階段名 → 子階段 report({ ok, stats, detail, summary })
 *
 * @type {Object}
 */
export const SUMMARIZE_REPORT_KEYS = Object.freeze({
    // 物件之階段名(summarizeObject 之預設 name)
    stage: '摘要',
    // 子階段之鍵(依執行順序)
    subStages: Object.freeze(['triage', 'summarize', 'retag', 'sync']),
    // 各子階段與物件之統一統計
    stats: Object.freeze(['in', 'out', 'skip', 'fail', 'aiCalls']),
    detail: Object.freeze({
        // 預篩:disabled(停用時,另只有 processed／relevant／irrelevant);池空時另只有 pool 與 confirmClosed;confirmClosed(確認席關閉而依預篩席
        //   攔下待確認者,有才附);rejectPending～confirmCalls(第二席確認開啟時)
        triage: Object.freeze([
            'disabled', 'processed', 'relevant', 'irrelevant', 'pool', 'confirmClosed',
            'rejectPending', 'confirmed', 'overturned', 'confirmUndetermined', 'confirmRetry', 'confirmCalls',
            'materialRefetch', 'aborted', 'stopped', 'failedBatches', 'missed', 'chainFailed', 'aiAttempts',
        ]),
        // 摘要:faith*(忠實性覆核開啟時)、stdRepaired／stdRepairFailed(欄位定向修補開啟時)、stdHeld／stdHoldsResolved／stdHoldsEscalated
        //   (待判有異動時)
        summarize: Object.freeze([
            'processed', 'notes', 'notesExisting', 'skipped', 'materialRefetch', 'truncated', 'categoryOffList', 'stdFixed', 'stdRejected',
            'explore', 'tagSuspect', 'aborted', 'stopped', 'failedBatches', 'missed', 'chainFailed', 'aiAttempts', 'pool', 'poolOldestDays', 'ready',
            'faithChecked', 'faithRejected', 'faithHeld', 'faithRetry', 'faithCalls', 'faithResolved', 'faithWaived',
            'stdRepaired', 'stdRepairFailed',
            'stdHeld', 'stdHoldsResolved', 'stdHoldsEscalated',
        ]),
        // 重標:disabled(停用時唯一之鍵);loadFailed(分類法狀態檔無法解析時);changed(跑完時;時間不足而延後者無)
        retag: Object.freeze([
            'disabled', 'version', 'initialized', 'jobsAdded', 'jobsVoided', 'jobsPending', 'jobsDone', 'guards',
            'mechChanged', 'aiJudged', 'aiChanged', 'aiKept', 'aiLateral', 'mdFailed', 'mdRepaired', 'deferred',
            'failedBatches', 'missed', 'aiAttempts', 'holdsAdded', 'holdsResolved', 'jobsRetried', 'loadFailed', 'changed',
        ]),
        // 同步:disabled(停用時唯一之鍵)
        sync: Object.freeze([
            'disabled', 'scanned', 'read', 'backfilled', 'changed', 'mdMissing', 'touchExtracted', 'stdFixed', 'stdHeld', 'stdResolved',
        ]),
    }),
})

/**
 * 同一管線內交下游之 ctx 旗標(本輪累計篇數):tagChanged＝重標改了分類之篇數(重標子階段設)、contentChanged＝內容同步判定內容已變之篇數
 *   (同步子階段設)。跨輪、跨行程之讀者改讀筆記記錄之 tagChangedAt／knowledgeChangedAt
 *
 * @type {Object}
 */
export const SUMMARIZE_CTX_FLAGS = Object.freeze({ tagChanged: 'notesTagChanged', contentChanged: 'notesChanged' })

export default { SUMMARIZE_LOG_KNOWN, SUMMARIZE_LOG_MUST_SEE, SUMMARIZE_LOG_PARSE, SUMMARIZE_REPORT_KEYS, SUMMARIZE_CTX_FLAGS }
