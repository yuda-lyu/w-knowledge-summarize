// stageKit.mjs — 子階段與維運測試之共用件(不帶 .test. 中綴:共用層,避免被 runner 當測試檔抓取)
//
// recLog:記錄型 logger(日誌行為 `<等級> <訊息>`),取自抓取套件之 test/tools/testKit(經 test/tools/captureForTest;四套件同一份),本檔只轉出之;
//   bagCtx:子階段之 ctx(get／set 以 Map 為底,可斷言 ctx 旗標);NEUTRAL_RULE:中立題材之 SS11 規則(詞彙表之 evidenceRule),
//   唯一一份在 test/tools/neutralRule,本檔只轉出之——本套件預設不啟用,SS11 相關之案以之給回。

import { recLog } from './captureForTest.mjs'

export { recLog } from './captureForTest.mjs'
export { NEUTRAL_RULE } from './neutralRule.mjs'

/**
 * 子階段之 ctx:deps、log 與以 Map 為底之 get／set(旗標可於 bag 斷言);o 之其餘鍵(remainingMs、expired…)併入
 *
 * @param {Object} deps 輸入 ctx.deps
 * @param {Object} [log] 輸入 logger(未給用 recLog)
 * @param {Object} [o={}] 輸入其餘 ctx 成員
 * @returns {Object} 回傳 { deps, log, get, set, bag:Map, ...o }
 */
export function bagCtx(deps, log, o = {}) {
    const bag = new Map()
    return { deps, log: log || recLog(), get: (k, f) => (bag.has(k) ? bag.get(k) : f), set: (k, v) => bag.set(k, v), bag, ...o }
}

// 預設匯出只列本檔定義或匯入之名;NEUTRAL_RULE 請具名匯入
export default { recLog, bagCtx }
