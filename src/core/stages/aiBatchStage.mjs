// aiBatchStage.mjs — 批次 AI 處理的泛用 harness（摘要之預篩、摘要、重標共用的核心機制）
//
// 【機制皆為實戰教訓的結晶】
//   ①「部分接受」——只要求至少一項結構完整即接受，截斷造成的半截項目略過、
//     未涵蓋者留佇列下輪換批次組合再試（全有全無時，一次截斷即整批作廢，每敗白耗整批重試之請求）；
//   ②「同 index 去重」——模型偶爾重複輸出同一項，取第一個；
//   ③「隊頭防阻塞」——失敗批次記 tries 降序排到隊尾，達上限出隊，
//     否則某批令模型反覆截斷時會永遠擋死整條線、每輪白燒全部額度；
//   ④「輪次 × 併發」——單呼叫 1.5~5 分鐘，串行讓排程時窗大半閒置；
//     各批項目由一次取足後切分，彼此不重疊，寫入互不干擾；
//   ⑤「額度中止與零進度守門」——額度用盡（skipped）中止後續輪；
//     整輪全數掛零則停損（下一輪大概率挑到同一批再敗）。
//   ⑥「逐項鏈異常不算進度」——applyItem 回 `_chainFailed:true`（執行端之逐項動作鏈拋錯、已自行落帳）者計入
//     chainFailed 而非 progressed：若算成進度，零進度守門不停損、report 之 fail 不含它，寫入層壞掉
//     （ENOSPC／EPERM／插件 bug）時每輪整批空轉且全綠。
//   ⑦「例外只對未套用者落帳」——批內部分項目已套用後拋錯時，onBatchFailed 只收尚未進 applyItem 之項目：
//     已套用者再記一次失敗會把 noted 覆寫成終態失敗；拋錯當下那一項視為已觸碰（可能部分套用）。
//   ⑧「依重量打包」——cfg.packBatches(pool) 由執行端把本輪池切成批（如依字數：長文獨佔一批、全文進 AI）；
//     每輪只跑前 parallel 批，其餘原樣留佇列（不記 tries，下輪依同一排序再取）。未給即依 batchSize 等分。
//   ⑨「套用前之批次覆核」——cfg.reviewItems(entries) 於批內合格項套用前一次覆核（如摘要之忠實性覆核）：
//     覆核不通過者不套用、交 cfg.onReviewRejected 落帳（未給交 onMissed）；覆核中止（預算／額度）→ 本批不套用任何項、
//     不記 tries（留佇列，同額度中止）。未給即不覆核。
//
// 【prompt 與逐項處置由執行端注入】機制與內容分離：本檔不認識任何領域欄位。
// 【本機制所發之日誌字樣由本檔宣告】AI_BATCH_LOG_KNOWN／AI_BATCH_REVIEW_LOG_KNOWN／AI_BATCH_LOG_MUST_SEE:使用本機制之工作之日誌契約
//   以之組成(不各抄一份;改字只改這裡)。套用前覆核之字樣只在給了 cfg.reviewItems 時發出,故另列——不給覆核之工作不收(不收無發出者之字樣)。

import chunk from 'lodash-es/chunk.js'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import isp0int from 'wsemi/src/isp0int.mjs'
import cint from 'wsemi/src/cint.mjs'
import { oneline } from '../capturePackage.mjs'

/**
 * 批次機制之已知常態 WARN 字樣(正則片段):全鏈失敗(「批次 AI 失敗（…）」;免費模型之輸出截斷是常態,失敗者記 tries 排隊尾、達上限出隊——
 *   真的大量發生時由產出停滯等判準反映)、批次例外(「批次異常：…」;已落帳,下輪重試)、時間預算守門(「批次：逾時間預算，…」;未取件者留佇列)
 *
 * @type {Array}
 */
export const AI_BATCH_LOG_KNOWN = Object.freeze(['批次 AI 失敗', '批次異常', '批次：逾時間預算'])

/**
 * 批次機制之套用前覆核所發之已知常態 WARN 字樣(只在給了 cfg.reviewItems 時):覆核中止(「批次：套用前覆核中止（時間預算／額度）…」;本批不套用、
 *   不記 tries,留佇列)
 *
 * @type {Array}
 */
export const AI_BATCH_REVIEW_LOG_KNOWN = Object.freeze(['套用前覆核中止'])

/**
 * 批次機制之一律須見字樣(純文字):批次例外之落帳失敗(寫入層壞了;行首為已知之「批次異常」)
 *
 * @type {Array}
 */
export const AI_BATCH_LOG_MUST_SEE = Object.freeze(['批次異常之落帳失敗'])

/**
 * 執行一個「批次 AI 處理」階段。
 *
 * @param {Object} cfg 輸入設定物件(必填)
 * @param {Function} cfg.pickPool 輸入取待處理池之函數，簽名 (limit:Number)=>Promise<Array>(呼叫端負責排序：tries 前置)
 * @param {Integer} cfg.batchSize 輸入每批項目數，須為正整數
 * @param {Integer} cfg.parallel 輸入每輪並行批數，須為正整數
 * @param {Integer} cfg.rounds 輸入輪數，須為非負整數
 * @param {Function} cfg.buildPrompt 輸入組單批 prompt 之函數，簽名 (batch:Array)=>Promise<String>（async 允許——可查詞彙表）
 * @param {Function} cfg.checkResult 輸入 AI 回傳整體驗證函數，簽名 (data:*, batch:Array)=>Boolean（部分接受語意：至少一項完整）
 * @param {Function} cfg.isValidItem 輸入單項結構完整性函數，簽名 (item:*, batch:Array)=>Boolean
 * @param {Function} cfg.indexOf 輸入取項目對應之批內編號函數，簽名 (item:*)=>Number(1-based)
 * @param {Function} cfg.callAI 輸入 AI 呼叫函數，簽名 (prompt:String, check:Function, ctx:{ batch:Array })=>Promise<{ok,data,error,skipped,attempts,preview,providerId?,errors?}>
 * @param {Function} cfg.applyItem 輸入套用單一完整項目之函數，簽名 (item:*, target:*, helpers:{ batch:Array })=>Promise<Object>
 *        （寫檔／入庫／改狀態全在執行端；回傳計數併入 stats.applied；回傳含 `_chainFailed:true` 者不算進度、計入 chainFailed；
 *        helpers.batch＝該項所屬之批——同一目標在同一階段兩度入批時,執行端以它取該批之上下文,不以目標反查)
 * @param {Function} cfg.onMissed 輸入處理未被涵蓋項目之函數，簽名 (target:*, helpers:{ providerId:String })=>Promise<void>
 *        （記 tries／達上限出隊——由執行端決定欄位與狀態）
 * @param {Function} [cfg.onBatchFailed] 輸入整批失敗時(非額度問題)的處置函數，簽名 (targets:Array, error:Object, helpers:Object)=>Promise<void>；
 *        非函數視為未給，僅記日誌
 * @param {Function} [cfg.packBatches] 輸入本輪池之打包函數，簽名 (pool:Array)=>Array<Array>：回傳批次陣列(每批非空、
 *        項目須取自 pool 且至多出現一次;依序取前 parallel 批，其餘留佇列)。非函數視為未給，依 batchSize 等分
 * @param {Function} [cfg.reviewItems] 輸入套用前之批次覆核函數(檔頭⑨)，簽名 (entries:[{ item, target, index }], helpers:{ batch, providerId })=>
 *        Promise<{ rejected?:Map(index → 原因物件), stopped?:Boolean }>：rejected 中之項不套用；stopped 為 true → 本批不套用、計 aborted、不記 tries。
 *        非函數視為未給(不覆核)
 * @param {Function} [cfg.onReviewRejected] 輸入覆核不通過之項之落帳函數，簽名 (target:*, why:*, helpers:{ batch, providerId })=>Promise<void>；
 *        未給則交 cfg.onMissed
 * @param {Function} [cfg.shouldStop] 輸入時間預算守門函數，簽名 ()=>Boolean：每輪開工前詢問，回 true 即不再開新輪
 *        （進行中的批次跑完；未取件者原樣留佇列）。非函數視為未給。rounds 迴圈若不看剩餘時間，
 *        整輪軟性截止（deadlineMs）便形同虛設
 * @param {Object} cfg.log 輸入 logger 物件，需具 info／warn 方法
 * @returns {Promise} 回傳 Promise，resolve 回傳 {rounds, batches, aiCalls, aiAttempts, applied, aborted, stopped, failedBatches, missed, chainFailed, reviewRejected}
 *        aiCalls＝批次(任務)數；aiAttempts＝實際嘗試數(含遞補與重試,與用量計帳同義)；
 *        aborted＝額度／預算用盡中止；stopped＝shouldStop 守門停止；failedBatches／missed／chainFailed 供階段 report 之 fail 統計
 *        (預算／額度中止之批次不計 failedBatches——它不是這批的失敗,另由 aborted/stopped 表達)
 * @throws {Error} cfg 非物件、必要函數缺席、batchSize／parallel 非正整數、rounds 非非負整數、log 缺 info/warn 函數，
 *        或 packBatches 回傳不合規格(非陣列、含空批、項目不在池中或重複)時拋出
 * @example
 * const queue = [{ name: '月球' }, { name: '火星' }]
 * const done = []
 * const left = []
 * const stat = await runAiBatchStage({
 *     pickPool: async (limit) => queue.splice(0, limit),
 *     batchSize: 2,
 *     parallel: 1,
 *     rounds: 1,
 *     buildPrompt: async (batch) => batch.map((t, i) => `${i + 1}. ${t.name}`).join('\n'),
 *     callAI: async () => ({ ok: true, data: [{ index: 1, note: '甲' }], attempts: 1 }),
 *     checkResult: (data) => Array.isArray(data) && data.length > 0,
 *     isValidItem: (item) => typeof item.note === 'string',
 *     indexOf: (item) => item.index,
 *     applyItem: async (item, target) => {
 *         done.push(`${target.name}:${item.note}`)
 *         return { noted: 1 }
 *     },
 *     onMissed: async (target) => {
 *         left.push(target.name)
 *     },
 *     log: { info: () => {}, warn: () => {} },
 * })
 * console.log(stat.applied, stat.missed, done, left)
 * // => { noted: 1 } 1 [ '月球:甲' ] [ '火星' ]
 */
export async function runAiBatchStage(cfg) {

    //check
    if (!isobj(cfg)) {
        throw new Error('runAiBatchStage 需要 cfg 物件')
    }
    for (const name of ['pickPool', 'buildPrompt', 'callAI', 'checkResult', 'isValidItem', 'indexOf', 'applyItem', 'onMissed']) {
        if (!isfun(cfg[name])) {
            throw new Error(`runAiBatchStage 需要 ${name} 函數`)
        }
    }
    let batchSize = cfg.batchSize
    if (!ispint(batchSize)) {
        throw new Error('runAiBatchStage 需要 cfg.batchSize 正整數')
    }
    batchSize = cint(batchSize)
    let parallel = cfg.parallel
    if (!ispint(parallel)) {
        throw new Error('runAiBatchStage 需要 cfg.parallel 正整數')
    }
    parallel = cint(parallel)
    let rounds = cfg.rounds
    if (!isp0int(rounds)) {
        throw new Error('runAiBatchStage 需要 cfg.rounds 非負整數')
    }
    rounds = cint(rounds)
    if (!isobj(cfg.log) || !isfun(cfg.log.info) || !isfun(cfg.log.warn)) {
        throw new Error('runAiBatchStage 需要 cfg.log（具 info/warn 函數）')
    }

    const log = cfg.log
    const stat = { rounds: 0, batches: 0, aiCalls: 0, aiAttempts: 0, applied: {}, aborted: false, stopped: false, failedBatches: 0, missed: 0, chainFailed: 0, reviewRejected: 0 }
    const bump = (obj) => {
        for (const [k, v] of Object.entries(obj || {})) {
            if (typeof v === 'number') stat.applied[k] = (stat.applied[k] || 0) + v
        }
    }
    const shouldStop = typeof cfg.shouldStop === 'function' ? cfg.shouldStop : null
    const onBatchFailed = typeof cfg.onBatchFailed === 'function' ? cfg.onBatchFailed : null
    const packBatches = typeof cfg.packBatches === 'function' ? cfg.packBatches : null
    const reviewItems = typeof cfg.reviewItems === 'function' ? cfg.reviewItems : null
    const onReviewRejected = typeof cfg.onReviewRejected === 'function' ? cfg.onReviewRejected : (target, why, helpers) => cfg.onMissed(target, helpers)

    /**
     * 打包結果之契約檢查(檔頭⑧):批次為非空陣列、項目取自池且不重複——否則同一項會在兩批各套用一次,或池外項目被落帳
     * @param {Array} packed 輸入 packBatches 之回傳
     * @param {Array} pool 輸入本輪池
     * @returns {Array} 回傳通過檢查之批次陣列
     */
    const checkPacked = (packed, pool) => {
        if (!Array.isArray(packed)) throw new Error('runAiBatchStage:packBatches 須回傳批次陣列')
        const inPool = new Set(pool)
        const seen = new Set()
        for (const b of packed) {
            if (!Array.isArray(b) || b.length === 0) throw new Error('runAiBatchStage:packBatches 之每批須為非空陣列')
            for (const t of b) {
                if (!inPool.has(t) || seen.has(t)) throw new Error('runAiBatchStage:packBatches 之項目須取自本輪池且至多出現一次')
                seen.add(t)
            }
        }
        return packed
    }

    for (let round = 0; round < rounds; round++) {
        if (shouldStop && shouldStop() === true) {
            stat.stopped = true
            log.warn(`批次：逾時間預算，第 ${round + 1}/${rounds} 輪起不再開工（未取件者留佇列）`)
            break
        }
        const pool = await cfg.pickPool(batchSize * parallel)
        if (pool.length === 0) break
        stat.rounds++
        // 依重量打包者只跑前 parallel 批(檔頭⑧):其餘未觸碰,原樣留佇列
        const batches = packBatches ? checkPacked(packBatches(pool), pool).slice(0, parallel) : chunk(pool, batchSize)

        const results = await Promise.all(batches.map(async (batch) => {
            const r0 = { progressed: 0, aborted: false }
            const touched = new Set() // 已進 applyItem 之項目(含拋錯當下那一項):例外時不再對其落帳(檔頭⑦)
            try {
                stat.batches++
                stat.aiCalls++
                const prompt = await cfg.buildPrompt(batch)
                // 第三參數帶本批(呼叫端可據以設定本次呼叫,如避開曾對本批文件產出不合格者之供應者)
                const r = await cfg.callAI(prompt, (d) => cfg.checkResult(d, batch), { batch })
                // 實際嘗試次數(含遞補),與用量計帳同義;aiCalls 為任務數。adapter 回 0(呼叫前即判不可行:全鏈放不下、預算已盡)照記 0——
                //   未 spawn 之失敗不算一次嘗試;缺欄(替身)才記 1
                stat.aiAttempts += Number.isFinite(r?.attempts) && r.attempts >= 0 ? r.attempts : 1
                if (!r.ok) {
                    // 額度／時間預算用盡(skipped)不是這批的失敗:另有 aborted/stopped 欄位,fail 不再吸收它
                    if (!r.skipped) stat.failedBatches++
                    // 附各次嘗試之歷程(callAI 回 errors 時):頂層 error 只是最後一次嘗試,單看它會誤判歸因;前綴不變(日誌契約依此辨識)
                    const hist = Array.isArray(r.errors) && r.errors.length ? `；歷程 ${oneline(r.errors.join('、'), 200)}` : ''
                    log.warn(`批次 AI 失敗（${r.error}，試 ${r.attempts ?? '?'} 次${hist}）→ ${r.preview || ''}`)
                    // 額度用盡（skipped）不記 tries：這不是這批的錯，重排只會冤枉無辜批次
                    if (!r.skipped && onBatchFailed) await onBatchFailed(batch, r, {})
                    r0.aborted = !!r.skipped
                    return r0
                }

                // 部分接受：只採用結構完整的項目；同 index 重複取第一個
                const covered = new Set()
                const entries = []
                for (const item of r.data) {
                    if (!cfg.isValidItem(item, batch) || covered.has(cfg.indexOf(item))) continue
                    covered.add(cfg.indexOf(item))
                    const target = batch[cfg.indexOf(item) - 1]
                    if (!target) continue
                    entries.push({ item, target, index: cfg.indexOf(item) })
                }
                const providerId = String(r.providerId || '')
                // 套用前之批次覆核(檔頭⑨):中止 → 本批不套用、不記 tries(留佇列);不通過者交執行端落帳
                let rejected = new Map()
                if (reviewItems && entries.length) {
                    const rv = await reviewItems(entries, { batch, providerId })
                    if (rv?.stopped === true) {
                        log.warn(`批次：套用前覆核中止（時間預算／額度），本批 ${entries.length} 項不套用、不記 tries（留佇列）`)
                        r0.aborted = true
                        return r0
                    }
                    if (rv?.rejected instanceof Map) rejected = rv.rejected
                }
                for (const { item, target, index } of entries) {
                    touched.add(target)
                    if (rejected.has(index)) {
                        stat.reviewRejected++
                        await onReviewRejected(target, rejected.get(index), { batch, providerId })
                        continue
                    }
                    const ap = await cfg.applyItem(item, target, { batch, providerId })
                    bump(ap)
                    // 逐項鏈異常(執行端已落帳)不算進度(檔頭⑥):否則零進度守門不停損、report 看不見
                    if (ap && ap._chainFailed === true) stat.chainFailed++
                    else r0.progressed++
                }
                // 未被涵蓋者（模型截斷在它們之前）交執行端記 tries／出隊
                const missed = batch.filter((_, i) => !covered.has(i + 1))
                stat.missed += missed.length
                // 成交之供應者一併交給執行端(未涵蓋或項目不合格可記下是哪一家產出,末次重試避開之)
                for (const t of missed) await cfg.onMissed(t, { providerId: String(r.providerId || '') })
                if (missed.length > 0) {
                    log.info(`批次：${batch.length} 項中 ${covered.size} 項完整、${missed.length} 項未涵蓋（留佇列下輪）`)
                }
            }
            catch (e) {
                // 例外仍落帳(與 !r.ok 分支對稱):只記日誌的話——該批全部項目不記 tries、不出隊,
                // 下輪 pickPool 取到同一批再拋,永久空轉且 report 之 fail 不含它。
                // 只對尚未進 applyItem 者落帳(檔頭⑦):已套用者再記一次失敗會把成功結果覆寫成終態失敗
                stat.failedBatches++
                const rest = batch.filter((t) => !touched.has(t))
                log.warn(`批次異常：${e.message}${rest.length < batch.length ? `（${batch.length - rest.length} 項已進套用，不再落帳）` : ''}`)
                if (onBatchFailed && rest.length) {
                    try {
                        await onBatchFailed(rest, { ok: false, error: String(e?.message || e), skipped: false }, {})
                    }
                    catch (e2) {
                        log.warn(`批次異常之落帳失敗：${e2.message}`)
                    }
                }
            }
            return r0
        }))

        if (results.some((x) => x.aborted)) {
            stat.aborted = true; break
        }
        // 零進度守門：本輪全數掛零＝下一輪大概率挑到同一批再敗，停損不空燒
        if (results.every((x) => x.progressed === 0)) break
    }
    return stat
}

export default runAiBatchStage
