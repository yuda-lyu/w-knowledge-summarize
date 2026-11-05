// summarizeObject.mjs — 摘要物件:子階段序列(triage → summarize → retag → sync)
//
// ════════════════ 分形組裝:物件=子階段序列,子階段=動作鏈 ════════════════
//
// 工廠零參數即可用(內建預設子階段與動作鏈);opt 逐層覆寫:
//   opt.stages           整組重排子階段(混入自寫 {name, run(ctx)} 單元)
//   opt.<子階段名>       透傳該子階段工廠(其內 tap/chain/單元 opts;鍵見 SUMMARIZE_STAGE_KEYS)
//   opt.name/onError…    階段契約欄位
//   其餘平鋪鍵           只給摘要子階段;其中 SUMMARIZE_SHARED_KEYS 另同給預篩
//
// 【依賴一律走 ctx.deps】stores/clock/dirs/settings/data/vocab/ai/domains 由總組裝每輪開啟交入;套件子階段與自寫子階段同一條注入通道。
// 【子階段失敗預設隔離】單一子階段倒了記於 detail、續跑後續子階段;子階段宣告 onError:'abort' 才中止整個物件。物件本身預設
//   onError:'continue'(摘要失敗不阻斷同一管線之後段)。
// 【物件 report 形狀】{ ok, stats, detail: <子階段名 → 子階段 report>, summary }——子階段序列執行、統計彙總、摘要組裝與物件 report
//   取自抓取套件之物件共用件(兩物件同一份規則);固定格式摘要(summarizeSummaryOf)為對外契約,見其 JSDoc。
// 【平鋪鍵不灌進預篩】平鋪之 tap(摘要之錨點)、domain、批量與輪數等摘要專屬鍵若一併給預篩,預篩鏈會於組裝期拋「無錨點」、改用摘要之
//   domain、批量被改成摘要之值;故預篩只吃 opt.triage 與平鋪之共用鍵(SUMMARIZE_SHARED_KEYS)。
// 【平鋪 tap 與子階段 tap 合併而非覆蓋】呼叫端可能同時給平鋪之 tap 與 opt.summarize.tap(兩方各自組 opt 時);二擇一會使其一靜默失效,
//   故以 mergeTaps 合併(同錨點 before／after 串接,雙方皆 replace 即拋錯)。

import isobj from 'wsemi/src/isobj.mjs'
import { subOpt, stageFields, runSubStages, summaryOf, objectReport } from './core/capturePackage.mjs'
import { stageTriage } from './stages/triageStage.mjs'
import { stageSummarize } from './stages/noteStage.mjs'
import { stageRetag } from './stages/retagStage.mjs'
import { stageSync } from './stages/syncStage.mjs'
import { SUMMARIZE_REPORT_KEYS } from './logContract.mjs'

/**
 * 內建子階段之鍵(依執行順序;亦為 opt.<子階段名> 與總組裝 cfg.stageOpts 之可用鍵)——即日誌契約之 report 子階段鍵(SUMMARIZE_REPORT_KEYS.subStages,
 *   同一實體;子階段之鍵與階段名只在日誌契約定義一次)
 *
 * @type {Array}
 */
export const SUMMARIZE_STAGE_KEYS = SUMMARIZE_REPORT_KEYS.subStages

/**
 * 有動作鏈(hook 錨點)之內建子階段:opt.<子階段>.tap 只能掛在這些子階段(錨點名列於各 stages/*.mjs 檔頭)。
 * retag(分類法同步與重標)與 sync(筆記內容變更之偵測)為機制性子階段、無動作鏈,其工廠拒收 tap／chain(抓取套件之 rejectChainOpts)
 *
 * @type {Array}
 */
export const SUMMARIZE_TAP_STAGE_KEYS = Object.freeze(['triage', 'summarize'])

/**
 * 平鋪 opts 中預篩與摘要共用之通用鍵(其餘平鋪鍵只給摘要;預篩專屬設定一律走 opt.triage):
 *   callAI＝同一 AI 替身／調度、parallel＝同一併發數、statuses＝同一待處理狀態名
 *
 * @type {Array}
 */
export const SUMMARIZE_SHARED_KEYS = Object.freeze(['callAI', 'parallel', 'statuses'])

/**
 * 摘要之固定格式摘要(預設子階段全數成功時):格式為對外契約——外部巡檢之正則退路依此解析逐輪統計(logContract 之 SUMMARIZE_LOG_PARSE),
 * 既有段落不動,新增段落一律附於句尾、>0 才附。摘要數字在前(巡檢以第一個「（AI N 次）」取摘要之呼叫數),預篩附於其後
 *
 * 段落(依序;第一段恆在,其餘 >0 才附):
 *   「處理 N、新知識 N、略過 N、線索 N（AI N 次）」(摘要)｜「預篩 N 篇放行 N（AI N 次）」｜「素材退回 N」(預篩＋摘要)｜「長文截斷 N」｜
 *   「重標 N 篇（AI N 次）」｜「內容變更 N 篇」(同步)｜「標準修正 N、未達標準 N」(納入閘)｜
 *   「忠實性覆核 N 篇（不忠實 N、待判 N、重試 N）」｜「修補 N 篇合格、N 篇仍不合格」｜「入待判 N（轉使用者 N）」｜
 *   「同步標準修正 N 篇、待判 N 項」｜「確認席關閉而依預篩攔下 N」｜
 *   「預篩確認 N 篇（兩席攔下 N、推翻放行 N、不一致放行 N、留待下輪 N）」(SS5 開啟時;「預篩 N 篇放行 N」之放行只計預篩席放行者,
 *   被第二席推翻或兩席不一致而放行者見此段)
 *
 * @param {Object} reports 輸入子階段名 → report 之對照物件
 * @returns {String} 回傳摘要字串；缺 summarize 之 detail(或 reports 非物件)時回 ''(由 summaryOf 退用通用摘要)
 * @example
 * let reports = {
 *     triage: { stats: { aiCalls: 1 }, detail: { processed: 4, relevant: 2, materialRefetch: 0 } },
 *     summarize: { stats: { aiCalls: 2 }, detail: { processed: 2, notes: 1, skipped: 1, explore: 3, materialRefetch: 0, truncated: 0 } },
 * }
 * console.log(summarizeSummaryOf(reports))
 * // => 處理 2、新知識 1、略過 1、線索 3（AI 2 次）｜預篩 4 篇放行 2（AI 1 次）
 */
export function summarizeSummaryOf(reports) {

    //check
    if (!isobj(reports)) {
        return ''
    }

    const e = reports.summarize?.detail
    const t = reports.triage?.detail
    const g = reports.retag?.detail
    const sy = reports.sync?.detail
    if (!e) return ''
    const tm = (t?.materialRefetch || 0) + (e.materialRefetch || 0)
    // 預篩攔下之第二席確認(SS5):本輪經確認之篇數(四種去處之和)
    const cn = (t?.confirmed || 0) + (t?.overturned || 0) + (t?.confirmUndetermined || 0) + (t?.confirmRetry || 0)
    return `處理 ${e.processed}、新知識 ${e.notes}、略過 ${e.skipped}、線索 ${e.explore}（AI ${reports.summarize.stats.aiCalls} 次）` +
        (t && t.processed > 0 ? `｜預篩 ${t.processed} 篇放行 ${t.relevant}（AI ${reports.triage.stats.aiCalls} 次）` : '') +
        (tm > 0 ? `｜素材退回 ${tm}` : '') +
        (e.truncated > 0 ? `｜長文截斷 ${e.truncated}` : '') +
        (g?.changed > 0 ? `｜重標 ${g.changed} 篇（AI ${reports.retag.stats?.aiCalls ?? 0} 次）` : '') +
        (sy?.changed > 0 ? `｜內容變更 ${sy.changed} 篇` : '') +
        // 檢定標準之納入閘:修正後納入／未達標準而不納入(該篇 tries＋1、下次附回饋重試)
        (e.stdFixed > 0 || e.stdRejected > 0 ? `｜標準修正 ${e.stdFixed || 0}、未達標準 ${e.stdRejected || 0}` : '') +
        // 筆記忠實性覆核(檢定標準 SS14;開啟且有受檢者才附)
        (e.faithChecked > 0 ? `｜忠實性覆核 ${e.faithChecked} 篇（不忠實 ${e.faithRejected || 0}、待判 ${e.faithHeld || 0}、重試 ${e.faithRetry || 0}）` : '') +
        // 欄位定向修補呼叫(SS2／SS4;開啟且有修補才附)、閘門待判之登錄與終態轉使用者(有異動才附)
        (e.stdRepaired > 0 || e.stdRepairFailed > 0 ? `｜修補 ${e.stdRepaired || 0} 篇合格、${e.stdRepairFailed || 0} 篇仍不合格` : '') +
        (e.stdHeld > 0 || e.stdHoldsEscalated > 0 ? `｜入待判 ${e.stdHeld || 0}（轉使用者 ${e.stdHoldsEscalated || 0}）` : '') +
        // 同步入口之筆記標準(確定性修正、仍不合格之待判);預篩確認席關閉時依預篩判定攔下之待確認件
        (sy?.stdFixed > 0 || sy?.stdHeld > 0 ? `｜同步標準修正 ${sy.stdFixed || 0} 篇、待判 ${sy.stdHeld || 0} 項` : '') +
        (t?.confirmClosed > 0 ? `｜確認席關閉而依預篩攔下 ${t.confirmClosed}` : '') +
        // 預篩攔下之第二席確認(SS5;開啟且本輪有經確認者才附——同 SS14 之忠實性覆核段)
        (cn > 0 ? `｜預篩確認 ${cn} 篇（兩席攔下 ${t.confirmed || 0}、推翻放行 ${t.overturned || 0}、不一致放行 ${t.confirmUndetermined || 0}、留待下輪 ${t.confirmRetry || 0}）` : '')
}

/**
 * 摘要物件:triage(預篩:標題＋片段攔下明確無關者)→ summarize(放行文件 → md 知識筆記)→ retag(分類法變更 → 既有筆記重標)
 * → sync(筆記內容變更之偵測:md 之標題／概念／一句話重點同步回記錄,knowledgeChangedAt 供下游重判)。
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件時視為{}；摘要子階段之 opts 亦可直接平鋪於 opt(見檔頭)
 * @param {Array} [opt.stages] 輸入整組重排之子階段陣列，給了即取代 triage／summarize／retag／sync 四個內建子階段
 * @param {Object} [opt.triage] 輸入透傳給 stageTriage 之 opt(與平鋪之 SUMMARIZE_SHARED_KEYS 合併，triage 優先)；enabled:false 時摘要自動
 *   requireTriage:false(摘要明給 requireTriage 者從其給)；reserveMs 為保留給後段之時間(扣保留後剩餘不足一次呼叫即不開工),未給取每輪依賴之 deps.reserveMs
 * @param {Object} [opt.summarize] 輸入透傳給 stageSummarize 之 opt(與平鋪 opts 合併，opt.summarize 優先；tap 則與平鋪之 tap 合併)；reserveMs 同預篩
 * @param {Object} [opt.retag] 輸入透傳給 stageRetag 之 opt(enabled:false 即停用重標;reserveMs 為保留給後段之時間,未給取每輪依賴之 deps.reserveMs)
 * @param {Object} [opt.sync] 輸入透傳給 stageSync 之 opt(enabled:false 即停用內容變更偵測)
 * @param {String} [opt.name='摘要'] 輸入階段名稱
 * @param {String} [opt.onError='continue'] 輸入階段失敗處置，'continue'／'abort'
 * @returns {Object} 回傳階段物件 { name, onError, when?, timeoutMs?, always?, run(ctx) }
 * @throws {Error} 平鋪 tap 與 opt.summarize.tap 同錨點皆給 replace、子階段之 tap 對不上錨點、或對無動作鏈之子階段(retag／sync)給 tap／chain 時拋出
 * @example
 * need test in nodejs.
 *
 * let obj = createSummarizeObject({ triage: { enabled: false }, retag: { reserveMs: 600000 } })
 * console.log(obj.name)
 * // => 摘要
 */
export function createSummarizeObject(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }

    // 預篩只吃 opt.triage 與平鋪之共用鍵(檔頭【平鋪鍵不灌進預篩】)
    const shared = {}
    for (const k of SUMMARIZE_SHARED_KEYS) {
        if (opt[k] !== undefined) shared[k] = opt[k]
    }
    const summarizeOpt = subOpt(opt, opt.summarize, 'summarize.summarize')
    // 以 opt.triage.enabled:false 停用預篩者,摘要自動不要求「已放行」(設定之預篩開關仍為開時,否則永遠取不到件);摘要明給 requireTriage 者從其給
    if (opt.triage?.enabled === false && summarizeOpt.requireTriage === undefined) summarizeOpt.requireTriage = false
    const stages = opt.stages || [
        stageTriage({ ...shared, ...(opt.triage || {}) }),
        stageSummarize(summarizeOpt),
        // 重標(分類法變更 → 既有筆記;每輪同步分類法狀態,有工作且時間允許才處理)——不擋當輪摘要
        stageRetag(opt.retag || {}),
        // 內容變更偵測(無 AI;排最末:本輪新建之筆記一併回填同步雜湊)
        stageSync(opt.sync || {}),
    ]
    return {
        ...stageFields(opt, { name: SUMMARIZE_REPORT_KEYS.stage }),
        run: async (ctx) => {
            const reports = await runSubStages(stages, ctx)
            return objectReport(reports, summaryOf(reports, () => summarizeSummaryOf(reports)))
        },
    }
}

export default createSummarizeObject
