// materialPolicy.mjs — 摘要端「素材壞了」之判定與回報抓取
//
// 【為何需要】格式未處理乾淨之素材得要能偵測識別並回報抓取任務,否則材料會被當成非知識丟掉。抓取之健全閘擋得到之雜訊不會進 raw;
//   閘擋不到、由 AI 讀了才看出素材壞了者(亂碼殘段、正文未載入只剩導覽、內文被截斷…),若一律轉 skip,材料就此丟掉。
// 【回報＝換一種抓法再抓一次;抓取端之欄位由抓取套件決定】摘要只判「理由是否直指素材壞了」(本檔之樣式)與退回上限;能否換法重抓、
//   排除哪個方法(產生該素材之方法不再用)、進瀏覽器佇列之路由欄位、瀏覽器佇列是否開啟,一律交抓取套件之 refetchRequestOf
//   (經 core/capturePackage);本檔不自組抓取欄位、不自判取得方式、不自讀抓取設定。單純退回佇列而不排除方法時,同一抓法會原樣取回
//   同一份素材,故須排除方法。
// 【不退回者】抓取套件判不可換法者(如學術摘要、feed 退路、站台 adapter、安裝方指名之自訂抓取器、瀏覽器佇列停用)、已退回達上限
//   (summarize.refetch.max)、理由指存取限制(付費牆／須登入,換抓法也取不到)——照常轉 skip(skipKind 取抓取套件之 SKIP_KIND_MATERIAL)。
// 【摘要自身之欄位】退回時清預篩與摘要之舊判定(triage／triagedAt／triageTries／summarizeTries／skipReason)、記 formatRefetches;
//   lastError 留作稽核(成功後不清)。

import isobj from 'wsemi/src/isobj.mjs'
import { toPatterns, refetchRequestOf } from '../core/capturePackage.mjs'

/**
 * 內建「素材壞了」之理由樣式(保守:須直指素材本身,不收題材判斷;中英)
 */
export const MATERIAL_PROBLEM_PATTERNS_DEFAULT = [
    { p: '亂碼|編碼(錯誤|異常|問題|錯亂|損毀)|无法辨识|無法辨識(的|之)?(文字|內容)', f: 'i' },
    // 須有主詞(內文／頁面…)在 6 字內:裸「未載入」會收到「模型未載入預訓練權重」這類題材判斷
    { p: '(內容|內文|正文|頁面|文章|網頁)[^，。,.；;]{0,6}((無法|未能|未成功|沒有|未)(完整)?載入|載入(失敗|錯誤))', f: 'i' },
    { p: '(需|需要|啟用)\\s*javascript|javascript\\s*(is\\s+required|啟用|渲染)', f: 'i' },
    { p: '(內文|正文|內容|文章|原文)(被|遭)?截斷|截斷(之|的)?(內文|正文)|截斷於|(語句|句子)中斷', f: 'i' },
    // 「內容」只收為空／空白:「方法論內容缺失」是題材判斷
    { p: '(內文|正文)(為空|空白|缺失|闕如)|內容(為空|空白)|無(實質)?(正文|內文)|未(能)?(抓到|取得|擷取到?)[^，。,.]{0,4}(內文|正文)', f: 'i' },
    { p: '(僅|只)(擷取|抓取|抓|取得)到?[^，。,.]{0,24}(導覽|選單|側邊欄)', f: 'i' },
    { p: '(僅|只)(有|為|包含|顯示)?[^，。,.]{0,8}(佔位|殼頁|錯誤(提示|訊息)|驗證頁|啟用提示)', f: 'i' },
    // 英文(提示詞要求繁體,英文理由少見,作保險):「no body」須接 text／content(「no body of evidence」是題材判斷)
    { p: 'garbled|mojibake|encoding\\s*(error|issue|錯誤|異常|問題|損毀)|(content|page)\\s+(failed\\s+to\\s+load|not\\s+loaded)|truncated\\s+(text|content|article)|no\\s+(article\\s+)?body\\s+(text|content)', f: 'i' },
]

/**
 * 內建排除樣式:理由指存取限制(付費牆、須登入)者——換抓法也取不到正文,退回只是白耗一次瀏覽器名額
 * (如「付費牆阻擋…無實質內文」「僅為社群網站之登入頁面」)。命中即不退回,照常轉 skip
 */
export const MATERIAL_EXCLUDE_PATTERNS_DEFAULT = [
    { p: '付費牆|paywall|訂閱(後|才|方)(可|能)|登入(頁|牆|後|才)|須登入|需登入|login|log\\s+in|sign\\s+in', f: 'i' },
]

/**
 * 建立素材問題判定器
 *
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Array} [opt.patterns=[]] 輸入安裝方追加之樣式({p,f} 或 RegExp;settings.summarize.refetch.patterns),接在內建之後
 * @param {Integer} [opt.max=1] 輸入同一篇至多退回幾次(settings.summarize.refetch.max;0＝停用回報)
 * @returns {Object} 回傳 { problemOf(reason):String(命中片段或 ''), refetchPatchOf(doc, reason, { nowIso, capture }):Object|null }
 * @throws {Error} 追加樣式形狀不合法時拋出
 * @example
 * const policy = createMaterialPolicy()
 * console.log(JSON.stringify(policy.problemOf('內文為亂碼，無法判讀')))
 * // => "亂碼"
 *
 * console.log(JSON.stringify(policy.problemOf('付費牆阻擋，無實質內文')))
 * // => ""
 *
 * const o = { nowIso: new Date().toISOString(), capture: { browser: { perRun: 3 } } }
 * const patch = policy.refetchPatchOf({ id: 'd1', textFrom: 'article' }, '內文為亂碼，無法判讀', o)
 * console.log(patch.fetcher, patch.refetchSkip, patch.formatRefetches)
 * // => browser [ 'curl' ] 1
 */
export function createMaterialPolicy(opt = {}) {
    if (!isobj(opt)) opt = {}
    const patterns = [...toPatterns(MATERIAL_PROBLEM_PATTERNS_DEFAULT, 'MATERIAL_PROBLEM_PATTERNS_DEFAULT'), ...toPatterns(opt.patterns, 'settings.summarize.refetch.patterns')]
    const excludes = toPatterns(MATERIAL_EXCLUDE_PATTERNS_DEFAULT, 'MATERIAL_EXCLUDE_PATTERNS_DEFAULT')
    const max = Number.isInteger(opt.max) && opt.max >= 0 ? opt.max : 1

    /**
     * 理由是否直指素材壞了(且非存取限制)
     *
     * @param {String} reason 輸入 AI 給之理由
     * @returns {String} 回傳命中片段,未命中或命中排除樣式回 ''
     */
    function problemOf(reason) {
        const s = String(reason || '')
        if (excludes.some((r) => r.test(s))) return ''
        const re = patterns.find((r) => r.test(s))
        return re ? String(s.match(re)?.[0] || '').slice(0, 40) : ''
    }

    /**
     * 判非知識且素材壞了時之退回欄位:抓取端之欄位取自抓取套件之 refetchRequestOf(檔頭),本函數只併入摘要自身之欄位;
     *   不適用(不是素材問題、已達上限、抓取套件判不可換法重抓或瀏覽器佇列停用)回 null
     *
     * @param {Object} doc 輸入文件記錄
     * @param {String} reason 輸入 AI 給之理由
     * @param {Object} o 輸入 { nowIso, capture: settings.capture }
     * @returns {Object|null} 回傳 docs.patch 之欄位或 null
     */
    function refetchPatchOf(doc, reason, o = {}) {
        if (max <= 0) return null
        const hit = problemOf(reason)
        if (!hit) return null
        const n = Number(doc?.formatRefetches) || 0
        if (n >= max) return null
        const req = refetchRequestOf(doc, { capture: o?.capture, nowIso: o?.nowIso || '', note: `摘要回報素材問題（${hit}）：${String(reason || '').slice(0, 150)}` })
        if (!req) return null
        return {
            ...req,
            formatRefetches: n + 1,
            triage: null,
            triagedAt: null,
            triageTries: 0,
            summarizeTries: 0,
            skipReason: '',
        }
    }

    return { problemOf, refetchPatchOf }
}

export default { MATERIAL_PROBLEM_PATTERNS_DEFAULT, MATERIAL_EXCLUDE_PATTERNS_DEFAULT, createMaterialPolicy }
