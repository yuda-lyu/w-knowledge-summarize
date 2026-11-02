// strictWsemi.mjs — wsemi「第 3 輪嚴格版」之替身(前瞻驗證用;排程第 271 項,dspec〈輸入參數之檢測機制〉§11 第 18 項之第三級流程)
//
// 【為何有它】wsemi 第 3 輪將把 strTruncate 之 maxLen 改為必須參數:以 iseint 之 count 判定,未給或非預期即拋錯(訊息不帶值)——現行為「原樣回傳不截斷」。
//   下游須先確認傳入值皆已清理好;本替身依該契約實作,配 strictWsemiHook.mjs 在子行程中把 `wsemi/src/strTruncate.mjs` 換成它,
//   即可在 wsemi 尚未改之前驗證:本套件改後在嚴格版下行為仍不變、不拋錯。
// 【契約出處】主控 dspec〈輸入參數之檢測機制〉§11(使用者 2026-11-02)與本輪派工:`strTruncate(str, maxLen, opt)`——maxLen 必須參數、以 iseint 之 count
//   (0～4294967295)判定,未給或非預期即拋 `invalid maxLen: must be a non-negative integer`;其餘行為(非字串回 ''、未超長原樣回傳、補刪節號)不變,
//   故通過判定後交真正的 strTruncate 處理(取值依 wsemi 規格:先判定、再 Number)。

import iseint from 'wsemi/src/iseint.mjs'
import strTruncate from 'wsemi/src/strTruncate.mjs'

/**
 * 嚴格版 strTruncate(wsemi 第 3 輪契約之替身)
 *
 * @param {String} str 輸入待裁切字串
 * @param {Integer} maxLen 輸入裁切後最大保留長度(必須;iseint count 判定,未給或非預期即拋錯)
 * @param {Object} [opt={}] 輸入設定物件(原樣轉傳)
 * @returns {String} 回傳裁切後字串
 * @throws {Error} maxLen 未給或非預期時拋出(`invalid maxLen: must be a non-negative integer`)
 */
export function strictStrTruncate(str, maxLen, opt = {}) {
    if (!iseint(maxLen, { use: 'count' })) {
        throw new Error('invalid maxLen: must be a non-negative integer')
    }
    return strTruncate(str, Number(maxLen), opt)
}

export default strictStrTruncate
