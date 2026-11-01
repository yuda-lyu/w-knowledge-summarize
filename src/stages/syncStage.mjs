// syncStage.mjs — 摘要物件之子階段 sync:筆記內容變更之偵測與同步(無 AI)
//
// 每輪於重標之後執行:以 md 之標題、概念、一句話重點回填或比對同步雜湊,變更者先過筆記標準(確定性修正寫回 md、仍不合格者
// 登錄待判;ops/syncNotes 檔頭)再同步回記錄並寫 knowledgeChangedAt。掃描與維運共用 ops/syncNotes。hook 錨點:無(機制性子階段,
// opt.enabled:false 停用)。
// 【詞彙】先取生效之摘要 domain 之詞彙表(deps.domains.summarize.vocab),再取 deps.vocab(總組裝中兩者為同一份)。
// 【讀者】下游讀筆記記錄者以記錄欄 knowledgeChangedAt 判該篇內容已變(跨套件之契約);同一管線內另有 ctx 旗標
//   SUMMARIZE_CTX_FLAGS.contentChanged(logContract;本輪內容變更篇數之累計)。

import isobj from 'wsemi/src/isobj.mjs'
import { stdReport, stageFields, rejectChainOpts } from '../core/capturePackage.mjs'
import { syncNotes } from '../ops/syncNotes.mjs'
import { SUMMARIZE_CTX_FLAGS } from '../logContract.mjs'

/**
 * 筆記同步子階段
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Boolean} [opt.enabled=true] 輸入是否啟用
 * @returns {Object} 回傳 stage 物件 { name, run }
 * @example
 * import fs from 'fs'
 * import os from 'os'
 * import path from 'path'
 *
 * let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'))
 * let file = path.join(dir, 'n1.md')
 * let bodyOf = (t) => `# ${t}\n\n## 一句話重點\n\n星系是恆星的集合\n\n## 核心知識\n\n- 要點`
 * writeMd(file, { title: '星系', concepts: ['星系', '黑洞'] }, bodyOf('星系'))
 * let rows = new Map([['n1', { id: 'n1', file, title: '星系', concepts: ['星系', '黑洞'], summary: '星系是恆星的集合' }]])
 * let notes = {
 *     select: async () => [...rows.values()],
 *     get: async (id) => rows.get(id),
 *     patch: async (id, o) => Object.assign(rows.get(id), o),
 * }
 * let bag = {}
 * let stage = stageSync()
 * let ctx = { deps: { stores: { notes }, dirs: { state: dir }, clock: { iso8: () => 'T0' } }, log: { info() {}, warn() {} }, get: (k, d) => bag[k] ?? d, set: (k, v) => { bag[k] = v } }
 * let r1 = await stage.run(ctx)
 * console.log(stage.name, r1.detail.backfilled, r1.stats.out)
 * // => sync 1 0
 *
 * writeMd(file, { title: '星系與黑洞', concepts: ['星系', '黑洞'] }, bodyOf('星系與黑洞'))
 * let r2 = await stage.run(ctx)
 * console.log(r2.stats.out, rows.get('n1').title, bag[SUMMARIZE_CTX_FLAGS.contentChanged])
 * // => 1 星系與黑洞 1
 *
 * console.log((await stageSync({ enabled: false }).run(ctx)).detail)
 * // => { disabled: true }
 * fs.rmSync(dir, { recursive: true, force: true })
 */
export function stageSync(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }
    // 機制性子階段、無動作鏈:tap／chain 給了即拋(不靜默無效)
    rejectChainOpts('sync', opt)

    return {
        ...stageFields(opt, { name: 'sync' }),
        run: async (ctx) => {
            if (opt.enabled === false) return stdReport({ detail: { disabled: true } })
            const { stores, dirs, clock } = ctx.deps
            const log = ctx.log
            // 語言設定(每輪依賴 deps.locale;與納入閘同一來源):同步路徑之 SS3 判定與確定性修正依之,非繁體中文不轉字形
            const det = await syncNotes({ stores, dirs, clock, log, vocab: ctx.deps.domains?.summarize?.vocab || ctx.deps.vocab, locale: ctx.deps.locale })
            if (det.mdMissing > 0) log.warn(`筆記同步：${det.mdMissing} 篇筆記之 md 讀不到（記錄仍在；例 ${det.missingSample.join('、')}）——不自動視為刪除，請還原 md，或確認不要後明示刪除其記錄`)
            if (det.backfilled > 0) log.info(`筆記同步：回填同步雜湊 ${det.backfilled} 篇（首見，不視為變更）`)
            if (det.stdFixed + det.stdHeld + det.stdResolved > 0) log.info(`筆記同步之檢定標準：確定性修正 ${det.stdFixed} 篇、登錄待判 ${det.stdHeld} 項、待判結案 ${det.stdResolved} 項`)
            if (det.changed > 0) {
                ctx.set(SUMMARIZE_CTX_FLAGS.contentChanged, (ctx.get(SUMMARIZE_CTX_FLAGS.contentChanged, 0) || 0) + det.changed)
                log.info(`筆記同步：內容變更 ${det.changed} 篇${det.touchExtracted ? `（其中 ${det.touchExtracted} 篇已有下游處理時刻 extractedAt；下游可依 knowledgeChangedAt 重判）` : ''}`)
            }
            const { changedIds: _ids, missingSample: _s, ...detail } = det
            return stdReport({ stats: { in: det.read, out: det.changed, skip: 0, fail: 0, aiCalls: 0 }, detail })
        },
    }
}

export default stageSync
