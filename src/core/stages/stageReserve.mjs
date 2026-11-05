// stageReserve.mjs — 預篩、摘要(含第二席確認、修補、忠實性覆核)扣保留給後段之時間的共用件:取值器、一次呼叫之估計、守門閘
//
// 【為何】整輪預算由 w-data-pipeline 之 ctx 持有;組裝者(跨工作之時間分配)可保留一段時間給後段工作(opt.reserveMs 或每輪依賴 deps.reserveMs),
//   本段之開工判斷與每次呼叫之封頂都須扣掉它——否則本段一路跑到容量用完或整輪截止,後段無從開工。重標段早已扣保留(stages/retagStage);
//   預篩與摘要比照,取值規則同一份(抓取套件之 reserveMsOf／reserveOf):opt.reserveMs 明給者優先、未給(或 null)取 ctx.deps.reserveMs、皆未給為 0。
// 【保留為 0 時行為不變】未給保留(或 0)時,本件之判斷與封頂與直接用整輪預算(budgetOf)完全相同:不加「一次呼叫」之開工門檻、不改封頂、
//   不附日誌與 detail——無組裝者注入時行為與有此機制前相同。
// 【一次呼叫之估計】開工門檻(canStart)＝該席位鏈首家之單次逾時(summarizeCallMsOf):席位 timeoutMs → ai.providerTimeouts[席位 use] →
//   ai.extraProviders 中該條目自帶之 timeoutMs → ai.timeoutMs → 300000;不另設設定鍵。各席各用自己之估計(摘要席、預篩席、確認席 first／third、
//   覆核席各異)。調度層內建條目表自帶之逾時(未列於上述設定者)此處看不到,以 ai.timeoutMs 計——要精準請於 ai.providerTimeouts 明列。
// 【時間不足是少做,不是縮容量】開工前不成立 → 本段不開工;批次調度每輪(wave)開工前同判 → 少做幾輪;未取件者原樣留池待下輪。容量鍵不變。

import isobj from 'wsemi/src/isobj.mjs'
import { budgetOf, reserveOf, reserveMsOf } from '../capturePackage.mjs'

/** 未設任何逾時時之單次呼叫逾時(毫秒;同 AI 調度層之預設) */
const CALL_TIMEOUT_FALLBACK_MS = 300_000

/**
 * 一次 AI 呼叫之時間估計(開工門檻):該席位鏈首家之單次逾時——席位 timeoutMs → ai.providerTimeouts[席位 use] → ai.extraProviders 中該條目自帶之
 *   timeoutMs → ai.timeoutMs → 300000(調度層「席位逾時覆寫鏈內各條目、逐 id 逾時次之、條目自帶次之、再次為 ai.timeoutMs」之同一順序;不另設設定鍵)
 *
 * @param {Object} settings 輸入已解析之設定(取 ai；可缺)
 * @param {Object} [seat] 輸入席位 { use, fallback?, timeoutMs? }(非物件者略過，以 ai.timeoutMs → 300000 計)
 * @returns {Number} 回傳毫秒數(正有限數)
 * @example
 * const ai = { timeoutMs: 120000, providerTimeouts: { 'x:a': 45000 }, extraProviders: [{ id: 'x:c', timeoutMs: 80000 }] }
 * console.log(summarizeCallMsOf({ ai }, { use: 'x:a' }), summarizeCallMsOf({ ai }, { use: 'x:a', timeoutMs: 9000 }), summarizeCallMsOf({ ai }, { use: 'x:c' }), summarizeCallMsOf({ ai }, { use: 'x:b' }), summarizeCallMsOf({}, null))
 * // => 45000 9000 80000 120000 300000
 */
export function summarizeCallMsOf(settings, seat) {
    const ai = isobj(settings?.ai) ? settings.ai : {}
    const pos = (v) => {
        const n = Number(v)
        return Number.isFinite(n) && n > 0 ? n : 0
    }
    const s = isobj(seat) ? seat : {}
    const own = typeof s.use === 'string' && Array.isArray(ai.extraProviders) ? ai.extraProviders.find((e) => isobj(e) && e.id === s.use) : null
    return pos(s.timeoutMs) || pos(ai.providerTimeouts?.[s.use]) || pos(own?.timeoutMs) || pos(ai.timeoutMs) || CALL_TIMEOUT_FALLBACK_MS
}

/**
 * 子階段之保留時間取值器:opt.reserveMs 明給者優先(含 0;建構即檢核,不合法拋出)、未給(undefined／null)則每輪取 ctx.deps.reserveMs
 *   (組裝者之依賴;不合法於該輪拋出)、皆未給為 0。取值規則取抓取套件之 reserveMsOf(各段同一份);保留多少屬組裝者,本件不讀他工作之設定
 *
 * @param {Object} opt 輸入子階段之 opt(取 reserveMs：非負毫秒數或 (ctx) => 毫秒數)
 * @param {String} stageName 輸入子階段函數名(錯誤訊息用，如 'stageTriage')
 * @returns {Function} 回傳 (ctx) => 非負毫秒數
 * @throws {Error} opt.reserveMs 給了而非非負有限數亦非函數時拋出;回傳之函數於 opt／deps 之值不合時拋出
 * @example
 * const of = reserveFnOf({ reserveMs: 900000 }, 'stageTriage')
 * const dep = reserveFnOf({}, 'stageTriage')
 * console.log(of({ deps: {} }), dep({ deps: { reserveMs: 600000 } }), dep({ deps: {} }), reserveFnOf({ reserveMs: 0 }, 'stageTriage')({ deps: { reserveMs: 1 } }))
 * // => 900000 600000 0 0
 */
export function reserveFnOf(opt, stageName) {
    const own = opt?.reserveMs === undefined || opt?.reserveMs === null ? null : reserveMsOf(opt.reserveMs, `${stageName} 之 opt.reserveMs`)
    return (ctx) => (own || reserveMsOf(ctx?.deps?.reserveMs, `${stageName} 之 deps.reserveMs`))(ctx)
}

/**
 * 本段本輪之守門閘:扣掉保留(keepMs)後之剩餘為本段可用;保留 > 0 時開工須「剩餘 ≥ 一次呼叫之估計」,保留為 0 時恆只看整輪是否逾期
 *   (與直接用 budgetOf 完全相同——不加一次呼叫之門檻)。每次呼叫皆以當下之剩餘求值(不在建構時取一次)。
 *   「因保留而延後」之判讀(detail.deferred)由呼叫端以「保留 > 0、整輪未逾期、此刻 shouldStop 仍為真」判定,不在閘內記狀態
 *
 * @param {Object} ctx 輸入管道脈絡(同 budgetOf)
 * @param {Number} keepMs 輸入保留毫秒數(非負;非有限值或非正數視為 0)
 * @returns {Object} 回傳 { keep:Number 生效之保留毫秒數, remainingMs:()=>Number 扣保留後之剩餘(無截止為 Infinity), expired:()=>Boolean 整輪是否已逾期,
 *   canStart:(callMs)=>Boolean, shouldStop:(callMs)=>Boolean 即 !canStart }
 * @example
 * const g = reserveGateOf({ remainingMs: () => 1_200_000, expired: () => false }, 900_000)
 * console.log(g.keep, g.remainingMs(), g.canStart(300_000), g.canStart(300_001))
 * // => 900000 300000 true false
 *
 * const off = reserveGateOf({ remainingMs: () => 60_000, expired: () => false }, 0)
 * console.log(off.canStart(300_000), off.shouldStop(300_000))
 * // => true false
 */
export function reserveGateOf(ctx, keepMs) {
    const keep = Number.isFinite(keepMs) && keepMs > 0 ? keepMs : 0
    const base = budgetOf(ctx)
    const sub = reserveOf(ctx, keep)
    // 保留為 0 時門檻恆 0(只看整輪是否逾期)
    const need = (callMs) => (keep > 0 && Number.isFinite(callMs) && callMs > 0 ? callMs : 0)
    const shouldStop = (callMs) => sub.shouldStop(need(callMs))
    return { keep, remainingMs: sub.remainingMs, expired: base.expired, canStart: (callMs) => !shouldStop(callMs), shouldStop }
}

export default { summarizeCallMsOf, reserveFnOf, reserveGateOf }
