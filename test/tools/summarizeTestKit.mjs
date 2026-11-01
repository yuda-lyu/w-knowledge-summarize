// summarizeTestKit.mjs — 摘要整合測試之共用件(不帶 .test. 中綴;只 import 套件內之檔案與 node_modules 套件)
//
// 【為何走總組裝】整合測試跑的是套件對外之總組裝 createKnowledgeSummarize(設定、詞彙、domain、鎖、日誌、執行摘要皆為真實件;集合為真 LMDB),
//   只換三件事:①workDir 換成 test/_tmp/<案名>-<pid>(LMDB、目錄、鎖檔與日誌皆落此,與他測試隔離)②AI 調度層換成腳本化替身(不發網路、
//   不燒額度)③不做本機網路探測(netGuard:null;斷網情境由測試明給判斷器)。
// 【替身依提示詞之角色作答】預篩、摘要、忠實性覆核、修補、重標之提示詞首句各不相同(你是…的預篩器／萃取器／忠實性核對員／分類器),
//   替身據以判角色並解析出本批之標題,依測試給之劇本作答;回覆經呼叫端傳入之 check 驗證(與生產同一驗證函數),不合即回失敗。
//   替身之機制(呼叫紀錄、結果形狀、check、失敗／額度用盡、延遲、席位檢核)取抓取套件之 stubAdapter(四套件同一份),本檔只給角色表、本批之解析與預設作答。
// 【文件即抓取套件交出之 raw】rawDoc 之欄位同抓取套件寫入之文件(status raw、rawAt、textFrom…);直接寫入 docs 集合即本套件之輸入。
// 【暫存】各測試自建專用資料夾(tmpRoot)、測完即刪(removeRoots;刪不掉者只警示)。
// 【位置無關之共用件】日誌之替身(silentLog、recLog、logsOf、fileLogFactory)、暫存根之工廠與刪除、固定時鐘、概念折疊之還原、子階段 report、集合之開關、日誌目錄之檔、讀 JSON 皆取自抓取套件之 test/tools/testKit(經 test/tools/captureForTest 轉出;四套件同一份),本檔只轉出之,不另寫一份。

import { createKnowledgeSummarize } from '../../src/createKnowledgeSummarize.mjs'
import { silentLog, withStores, pkgRootOf, tmpRootsOf, stubAdapter } from './captureForTest.mjs'

export { silentLog, recLog, logsOf, fileLogFactory, removeRoots, resetConceptFold, subReport, withStores, findFiles, readJsonFile, FIXED_CLOCK } from './captureForTest.mjs'

/** 套件根(以本檔位置推導,與 cwd 無關;正斜線) */
export const PKG_ROOT = pkgRootOf(import.meta.url)

/** 專用暫存根之建立:tmpRoot(name) → 套件內 test/_tmp/<name>-<pid>(絕對路徑,正斜線;已存在者清掉重建;帶 pid 使並行互不干擾;案名由各測試檔自取互異之名) */
export const { tmpRoot } = tmpRootsOf(PKG_ROOT)

/** 無人監聽之本機埠(本套件之固定埠 8841～8849 之一;連線即被拒):內建調度層之條目指向它即「整鏈皆敗」 */
export const DEAD_PORT = 8841

/**
 * 抓取套件交出之 raw 文件(欄位同抓取套件寫入者;內文不含數字,摘要之數字紮根恆成立)
 *
 * @param {String} id 輸入文件 id
 * @param {Object} [o={}] 輸入覆寫欄位(title、text、triage、summarizeTries、rawAt…)
 * @returns {Object} 回傳文件記錄
 */
export function rawDoc(id, o = {}) {
    const title = o.title || `測試文件${id}`
    return {
        id,
        url: `https://example.com/${id}`,
        title,
        text: `${title}。本文說明方法之步驟、適用條件與限制，並討論其優點與缺點。`.repeat(4),
        status: 'raw',
        sourceName: '測試來源',
        sourceTier: 1,
        collectedAt: '2026-09-01T00:00:00+08:00',
        rawAt: '2026-09-01T00:00:00+08:00',
        textFrom: 'full',
        ...o,
    }
}

/**
 * 合格之摘要項目(過納入閘:標題取自原文標題、無原文沒有之數字、概念兩個、清單內之標注)
 *
 * @param {Integer} index 輸入批內編號(1 起)
 * @param {String} title 輸入原文標題
 * @param {Object} [o={}] 輸入覆寫欄位
 * @returns {Object} 回傳項目
 */
export function itemOf(index, title, o = {}) {
    return {
        index,
        relevant: true,
        reason: '',
        title: `${title}之重點`,
        summary: '說明方法之步驟與限制',
        key_points: ['方法之步驟', '適用條件'],
        concepts: ['研究方法', '適用條件'],
        category: '方法與技術',
        claim_type: '實證研究',
        evidence_level: '中',
        evidence_note: '單一研究',
        caveats: ['適用範圍狹窄'],
        sample_period: '未載明',
        explore: [],
        ...o,
    }
}

/**
 * 提示詞之角色(依首句判):triage／summarize／repair／faith／retag;其餘 other
 *
 * @param {String} prompt 輸入提示詞
 * @returns {String} 回傳角色
 */
function roleOf(prompt) {
    const p = String(prompt || '')
    if (/的預篩器。以下 \d+ 篇/.test(p)) return 'triage'
    if (/的萃取器。請閱讀以下 \d+ 篇資料/.test(p)) return 'summarize'
    if (/的萃取器。下列【筆記】/.test(p)) return 'repair'
    if (/的忠實性核對員/.test(p)) return 'faith'
    if (/的分類器。以下 \d+ 篇知識筆記/.test(p)) return 'retag'
    return 'other'
}

/**
 * 解析提示詞中本批之標題(依角色之版型;依批內順序)
 *
 * @param {String} prompt 輸入提示詞
 * @returns {Array} 回傳標題陣列
 */
export function titlesOf(prompt) {
    const p = String(prompt || '')
    const role = roleOf(p)
    if (role === 'triage' || role === 'retag') return [...p.matchAll(/^\d+\. 【(.+?)】/gm)].map((m) => m[1])
    if (role === 'summarize') return [...p.matchAll(/^--- 第\d+篇 ---\n標題：(.*)$/gm)].map((m) => m[1])
    if (role === 'faith') return [...p.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => m[1])
    return []
}

/**
 * 各角色之預設作答:預篩全放行、摘要逐篇合格項目、忠實性全判忠實、修補不改、重標維持原類別
 *
 * @param {String} role 輸入角色
 * @param {String} prompt 輸入提示詞
 * @returns {*} 回傳作答(JSON)
 */
function defaultAnswer(role, prompt) {
    const ts = titlesOf(prompt)
    if (role === 'triage') return ts.map((t, i) => ({ index: i + 1, relevant: true, reason: '' }))
    if (role === 'summarize') return ts.map((t, i) => itemOf(i + 1, t))
    if (role === 'faith') return { checks: ts.map((n) => ({ index: Number(n), verdict: 'faithful', reason: '筆記之結論與原文相符' })) }
    if (role === 'repair') return { repairs: [] }
    if (role === 'retag') return [...String(prompt).matchAll(/^(\d+)\. 【.+?】（原類別：(.*?)）$/gm)].map((m) => ({ index: Number(m[1]), category: m[2] }))
    return []
}

/**
 * 依本套件提示詞之角色作答之 AI 替身(整組置換 cfg.aiAdapter):抓取套件之 stubAdapter＋本套件之角色表、標題解析與預設作答
 *
 * 劇本 script(role, prompt, callOpt, titles) 回:作答之 JSON｜undefined(用預設作答)｜'fail'(失敗)｜'skip'(額度／時間用盡:skipped);拋錯視為失敗。
 * 回覆經呼叫端傳入之 check 驗證(回 true 才合格)。providerId 取席位之 use(未給席位者 'stub')
 *
 * @param {Function} [script] 輸入劇本
 * @param {Object} [opt={}] 輸入設定物件(交 stubAdapter)
 * @param {Boolean} [opt.validateSeats=false] 輸入是否具備 validateSeats(啟動期席位檢核;記錄於 seatChecks)
 * @param {Number} [opt.delayMs=0] 輸入每次作答前之延遲(時間預算之案用)
 * @returns {Object} 回傳替身 { calls:Array({ role, prompt, spec, opt }), seatChecks:Array, callJson, drainStats, aiUsageToday, validateSeats? }
 */
export function scriptedAi(script, opt = {}) {
    const answer = async (prompt, callOpt, role) => {
        const data = typeof script === 'function' ? await script(role, prompt, callOpt, titlesOf(prompt)) : undefined
        return data === undefined ? defaultAnswer(role, prompt) : data
    }
    return stubAdapter(answer, { ...opt, roleOf })
}

/**
 * 以總組裝建立測試用之摘要流程
 *
 * overrides 之鍵即 cfg 之鍵(見 createKnowledgeSummarize 之 CFG_KEYS),另有測試專用鍵 log(日誌物件,給了即取代靜音日誌;每輪共用同一個)。
 * 預設:afterRun false、鎖檔在 <root>/tmp/run.lock、AI 為預設作答之替身、netGuard null
 *
 * @param {String} root 輸入暫存根(tmpRoot 之產物或其子目錄)
 * @param {Object} [overrides={}] 輸入 cfg 覆寫
 * @returns {Object} 回傳 { flow, cfg, ai }：ai 為實際使用之 AI 調度層
 */
export function buildTestSummarize(root, overrides = {}) {
    const { log, ...rest } = overrides
    const cfg = {
        workDir: root,
        afterRun: false,
        logFactory: () => log || silentLog,
        lock: `${root}/tmp/run.lock`,
        aiAdapter: scriptedAi(),
        netGuard: null,
        ...rest,
    }
    return { flow: createKnowledgeSummarize(cfg), cfg, ai: cfg.aiAdapter }
}

/**
 * 寫入文件(抓取套件交出之 raw 等)
 *
 * @param {Object} flow 輸入總組裝
 * @param {Array} docs 輸入文件陣列
 * @returns {Promise} 回傳 Promise
 */
export async function seedDocs(flow, docs) {
    await withStores(flow, async (s) => {
        await s.docs.insertNew(docs)
    })
}

// 預設匯出只列本檔定義或匯入之名;自 captureForTest 轉出之共用件(recLog、logsOf、fileLogFactory、removeRoots、resetConceptFold、subReport、findFiles、readJsonFile、FIXED_CLOCK)請具名匯入
export default {
    PKG_ROOT, DEAD_PORT, silentLog, tmpRoot, rawDoc, itemOf, titlesOf,
    scriptedAi, buildTestSummarize, withStores, seedDocs,
}
