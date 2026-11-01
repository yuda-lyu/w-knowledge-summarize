// notePatch.mjs — 筆記記錄之寫入(陣列欄先清後寫＋寫後回驗;同步與存量處置共用之單一實作)
//
// 【為何陣列欄先清】集合之 patch 為深合併、陣列依索引合併:概念由 [甲,乙] 改為 [丙] 時直接 patch 會殘留成 [丙,乙]。
//   陣列欄有變者先以一次寫入清為 null、再寫新值。不用 replace:先刪後插為兩次寫入,中途中斷即遺失真理記錄。
// 【寫後回驗】寫入後讀回逐欄比對(預設比對 patch 之全部欄;呼叫端可限定欄位),不符即拋——只驗雜湊會放過殘留之舊值。

import isarr from 'wsemi/src/isarr.mjs'

/** 筆記記錄之陣列欄位(有變先清為 null 再寫) */
export const NOTE_ARRAY_FIELDS = Object.freeze(['concepts', 'caveats', 'stdFixes'])

const json = (v) => JSON.stringify(v ?? null)

/**
 * 寫入筆記記錄之欄位:陣列欄有變先清為 null 再寫,寫後讀回逐欄回驗
 *
 * @param {Object} store 輸入筆記集合(具 patch、get)
 * @param {Object} cur 輸入現值記錄(須含 id)
 * @param {Object} patch 輸入欲寫之欄位
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Array} [opt.verify] 輸入回驗之欄位(未給＝patch 之全部欄)
 * @param {String} [opt.label=''] 輸入錯誤訊息之用途字樣(如 '同步')
 * @returns {Promise} 回傳 Promise，resolve 回傳寫後讀回之記錄
 * @throws {Error} cur 無 id、或回驗不符時拋出(訊息含筆記 id 與欄名)
 * @example
 * need test in nodejs.
 *
 * const back = await patchNoteRecord(stores.notes, rec, { concepts: ['丙'], syncHash: 'h' }, { verify: ['concepts', 'syncHash'], label: '同步' })
 */
export async function patchNoteRecord(store, cur, patch, opt = {}) {

    //check
    if (!cur?.id) {
        throw new Error('patchNoteRecord 需要現值記錄(含 id)')
    }
    if (opt === null || typeof opt !== 'object') {
        opt = {}
    }

    const clear = {}
    for (const k of NOTE_ARRAY_FIELDS) {
        if (k in patch && json(cur[k]) !== json(patch[k])) clear[k] = null
    }
    if (Object.keys(clear).length) await store.patch(cur.id, clear)
    await store.patch(cur.id, patch)
    const back = await store.get(cur.id)
    const keys = isarr(opt.verify) ? opt.verify : Object.keys(patch)
    for (const k of keys) {
        if (json(back?.[k]) !== json(patch[k])) throw new Error(`筆記 ${cur.id} 之${String(opt.label || '')}寫入後回驗不符（${k}）`)
    }
    return back
}

export default { NOTE_ARRAY_FIELDS, patchNoteRecord }
