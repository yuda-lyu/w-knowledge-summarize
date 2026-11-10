// stageReserve.mjs — 預篩、摘要(含第二席確認、修補、忠實性覆核)扣保留給後段之時間的取值器
//
// 【為何】整輪預算由 w-data-pipeline 之 ctx 持有;組裝者(跨工作之時間分配)可保留一段時間給後段工作(opt.reserveMs 或每輪依賴 deps.reserveMs),
//   本段之開工判斷與每次呼叫之封頂都須扣掉它——否則本段一路跑到容量用完或整輪截止,後段無從開工。重標段早已扣保留(stages/retagStage);
//   預篩與摘要比照,取值規則同一份(抓取套件之 reserveMsOf／reserveOf):opt.reserveMs 明給者優先、未給(或 null)取 ctx.deps.reserveMs、皆未給為 0。
// 【守門閘、一次呼叫之估計、AI 呼叫之包裝皆取抓取套件之同一份】守門閘＝stageReserveGateOf(保留為 0 時只看整輪是否逾期,與直接用整輪預算相同)、
//   一次 AI 呼叫之估計＝captureCallMsOf(席位 timeoutMs → ai.providerTimeouts[席位 use] → ai.extraProviders 該條目自帶之 timeoutMs → ai.timeoutMs → 300000)、
//   扣保留之 AI 呼叫＝reservedAiCallOf(進門、遞補鏈內續派判停、預算封頂),皆經 core/capturePackage 取用;本套件不另寫一份。
// 【時間不足是少做,不是縮容量】開工前不成立 → 本段不開工;批次調度每輪(wave)開工前同判 → 少做幾輪;未取件者原樣留池待下輪。容量鍵不變。

import { reserveMsOf } from '../capturePackage.mjs'

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

export default { reserveFnOf }
