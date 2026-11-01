// audit.mjs — 摘要檢定標準之符合度掃描(唯讀,不寫任何知識庫檔案)
//
// 【單一實作】新進閘、筆記同步、還原筆記與本掃描呼叫同一判定(standards/noteStandards 之 checkNote),輸入同為落地形態(md 之 front／body
//   ＋筆記記錄)——掃描之結果即「現行標準下存量之真實違反數」,不另寫一份量測。SS4 之材料與新進同一定義(noteMaterialOf:原文標題＋摘要
//   當時送出之內文;原文取抓取套件之 docTextOf)。
// 【回報】逐標準:總量、四態計數、版本、完整 id(不合格與未能判定皆列);讀不到材料者記未能判定,不報為零(md 讀不到 → 該篇各標準未能判定;
//   原文不可得 → SS4 未能判定;opt.material 為 false → SS4 未能判定並註明未讀原文)。不合格或未能判定而該篇該標準有使用者豁免(holds 之
//   waived;鍵 note:<筆記 id>:<標準> 或 doc:<文件 id>:<標準>,集合可缺)者記「已豁免」(逐一列出)——豁免是裁示,不是合格。
// 【SS11 附規則指紋】判定依詞彙表之 evidenceRule(未給詞彙或規則停用 → 不適用);該條另附 fp(規則之指紋,停用者為空字串),報表之讀者
//   據以判讀「違反數之變化是規則變了還是筆記變了」。
// 【AI 標準只計待判】SS5、SS9、SS14 之判定在當下(預篩確認、重標、忠實性覆核),本套件不寫檢核紀錄——只列各自之待判(ai[標準]):
//   SS14、SS9 取待判登錄(holds;未結 open、已豁免 waived);SS5 取待確認席再判之文件(預篩判定 reject-pending 之 raw 文件;無待判登錄與豁免,
//   waived 為 null)。來源集合未給者記 null(無從計,不報為零)。
// 【總覽之形狀】summarizeScanOf:標準列之對象為 SUMMARIZE_SCAN_OBJECT;AI 列只取來源為待判登錄者映射為各工作同一形狀(未結 → holdsOpen、
//   已豁免 → holdsWaived;來源集合未給者無從計、SS5 之來源為文件之預篩判定而非待判,皆不列;有待判者才列)——總組裝之每輪掃描與編排層之合併同讀。
// 【累計】桶、四態、豁免之映射與逐態 id 上限取抓取套件之 createStandardsTally(四工作同一份)。
// 【詞彙】deps.vocab 給了須為本套件解析後之詞彙表(resolveSummarizeVocab 之產物;未經解析即拋——證據規則不得在掃描無聲失效);
//   未給 → 依賴詞彙之判定略過(內容類型／證據等級之清單、SS11)。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { STATUS, result, docTextOf, createStandardsTally, standardsScanOf } from '../core/capturePackage.mjs'
import { readMd } from '../core/md/md.mjs'
import { checkNote, noteMaterialOf, standardsVocabOf } from './noteStandards.mjs'
import { SS14 } from './faithCheck.mjs'
import { RETAG_HOLD_STD } from '../stores/noteHolds.mjs'
import { SUMMARIZE_DOC_STATUS, TRIAGE_STATE } from '../stores/docStatus.mjs'
import { SUMMARIZE_STANDARDS } from './registry.mjs'

/** 本掃描逐件判定之標準 id(registry 之 scan 為 true 者;依 registry 之序) */
export const SUMMARIZE_AUDITED_STANDARD_IDS = Object.freeze(SUMMARIZE_STANDARDS.filter((s) => s.scan).map((s) => s.id))

/** 本掃描只計待判之 AI 標準 id(依 registry 之序) */
export const SUMMARIZE_AI_PENDING_STANDARD_IDS = Object.freeze(['SS5', 'SS9', 'SS14'])

/** 掃描結果之物件名(併入總覽時之對象欄) */
export const SUMMARIZE_SCAN_OBJECT = 'notes'

/** AI 標準之待判來源:holds 之登錄標準,或文件之預篩判定 */
const AI_PENDING_SOURCE = Object.freeze({
    SS5: { source: 'docs' },
    SS9: { source: 'holds', std: RETAG_HOLD_STD },
    SS14: { source: 'holds', std: SS14.std },
})

/** opt.material 為 false 時 SS4 之未能判定說明 */
const NO_MATERIAL_DETAIL = '未讀原文（material:false），數字紮根無從判定'

/**
 * 摘要檢定標準之符合度掃描(唯讀)
 *
 * @param {Object} deps 輸入 { stores:{ notes, docs?, docTexts?, holds? }, vocab?(resolveSummarizeVocab 之產物), locale?(語言設定;SS3 只適用於臺灣正體,
 *   其餘逐篇列不適用;未給＝正體), dirs?(不讀;同形之依賴物件可原樣傳入) }
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Array} [opt.only] 輸入只跑這些標準 id(未給或空陣列＝全部:可掃描之標準與 AI 標準之待判;不認得之 id 略過)
 * @param {Boolean} [opt.material=true] 輸入 SS4 是否讀原文(docs 或 docTexts);false 時 SS4 每篇記未能判定
 * @param {Integer} [opt.maxIds] 輸入每態列出之 id 上限(非負整數;預設全部)
 * @param {Function} [opt.onNote] 輸入每篇讀得到 md 之筆記之回呼 (record, md) => void:他工作於同一次走訪取其所需(如自筆記內容建材料快取),
 *   不另讀一次 md;只在範圍內有逐件判定之標準時走訪(未走訪即不呼叫)
 * @returns {Promise} 回傳 Promise,resolve 回傳 { counts:{ notes }, standards:{ [id]: { id, title, kind, v, module:'summarize', object,
 *   total, pass, violation, undetermined, na, waived, violations:[{ id, detail }], undetermineds:[{ id, detail }], waiveds:[{ id, detail }],
 *   fp?(SS11:規則指紋,停用者 '') } }, ai?:{ [AI 標準]: { id, title, kind, v, module:'summarize', object, source:'holds'|'docs',
 *   open:Integer|null, waived:Integer|null } }(範圍內有 AI 標準時才有) }
 * @throws {Error} deps.stores.notes 缺 select 方法、或 deps.vocab 給了而非本套件解析後之詞彙表時拋出
 * @example
 * need test in nodejs.
 *
 * const rep = await auditSummarizeStandards({ stores, vocab }, { maxIds: 50 })
 * console.log(rep.standards.SS3.violation, rep.standards.SS11.fp, rep.ai.SS14.open)
 */
export async function auditSummarizeStandards(deps, opt = {}) {

    //check
    const stores = deps?.stores
    if (!isobj(stores) || !isfun(stores.notes?.select)) {
        throw new Error('auditSummarizeStandards 需要 deps.stores.notes（具 select 方法）')
    }
    const vocab = standardsVocabOf(deps.vocab, 'auditSummarizeStandards 之 deps.vocab')
    if (!isobj(opt)) {
        opt = {}
    }

    const only = isarr(opt.only) && opt.only.length ? new Set(opt.only) : null
    const useMaterial = opt.material !== false
    const onNote = isfun(opt.onNote) ? opt.onNote : null

    // 待判登錄(一次讀;集合可缺):使用者豁免映射回四態(累計器;refs＝該筆記於待判登錄之 [物件, id],可多個)、AI 標準之待判數
    const allHolds = isfun(stores.holds?.select) ? await stores.holds.select() : null
    const { std, add } = createStandardsTally(SUMMARIZE_STANDARDS, { module: 'summarize', only, holds: allHolds, maxIds: opt.maxIds })
    // 規則指紋(判讀規則變更;停用或未給詞彙 → '')
    if (std.SS11) std.SS11.fp = vocab ? vocab.evidenceRule.fp : ''
    const want = (id) => !!std[id]
    const scanIds = Object.keys(std)
    const aiIds = SUMMARIZE_AI_PENDING_STANDARD_IDS.filter((id) => !only || only.has(id))

    // ── 筆記:SS2／SS3／SS4／SS6／SS11(與新進閘同一判定)──
    const notes = await stores.notes.select()
    for (const n of scanIds.length ? notes : []) {
        const md = readMd(n?.file)
        if (!md) {
            for (const id of scanIds) add(n.id, result(id, STATUS.UNDETERMINED, 'md 讀不到'))
            continue
        }
        if (onNote) onNote(n, md)
        const refs = [['note', n.id], ...(n.docId ? [['doc', n.docId]] : [])]
        // SS4 之材料:只在範圍內含 SS4 時讀(每篇一次原文取得);未讀原文者另記未能判定(checkNote 未給材料即不產 SS4)
        let material
        if (want('SS4')) {
            if (useMaterial) material = noteMaterialOf(n.docId ? await docTextOf(stores, n.docId) : null, n, md.body)
            else add(n.id, result('SS4', STATUS.UNDETERMINED, NO_MATERIAL_DETAIL), refs)
        }
        for (const r of checkNote({ front: md.front, body: md.body, record: n }, { vocab, material, locale: deps.locale })) add(n.id, r, refs)
    }

    const out = { counts: { notes: notes.length }, standards: std }

    // ── AI 標準:只計待判(檔頭)──
    if (aiIds.length) {
        const pendingDocs = aiIds.includes('SS5') && isfun(stores.docs?.select)
            ? (await stores.docs.select({ triage: TRIAGE_STATE.rejectPending })).filter((d) => d?.status === SUMMARIZE_DOC_STATUS.pending)
            : null
        out.ai = {}
        for (const id of aiIds) {
            const s = SUMMARIZE_STANDARDS.find((x) => x.id === id)
            const src = AI_PENDING_SOURCE[id]
            let open = null
            let waived = null
            if (src.source === 'holds' && allHolds) {
                const mine = allHolds.filter((h) => h.std === src.std)
                open = mine.filter((h) => h.status === 'open').length
                waived = mine.filter((h) => h.status === 'waived').length
            }
            if (src.source === 'docs' && pendingDocs) open = pendingDocs.length
            out.ai[id] = { id, title: s.title, kind: s.kind, v: s.v, module: 'summarize', object: s.object, source: src.source, open, waived }
        }
    }
    return out
}

/**
 * 掃描結果 → 總覽之形狀(檔頭【總覽之形狀】;抓取套件之 standardsScanOf):標準列之對象為 SUMMARIZE_SCAN_OBJECT;AI 列只取來源為待判登錄而
 *   有待判(未結或已豁免)者,映射為各工作同一形狀(已檢與四態為 0、holdsOpen＝未結、holdsWaived＝已豁免)
 *
 * @param {Object} rep 輸入 auditSummarizeStandards 之產物
 * @returns {Object} 回傳 { counts:{ notes }, standards:{ [id]: 標準列(object 'notes') }, ai:{ [id]: { checked, pass, violation, undetermined, na, stale,
 *   holdsOpen, holdsWaived, v } } }
 * @example
 * const s = summarizeScanOf({ counts: { notes: 2 }, standards: {}, ai: { SS5: { source: 'docs', open: 3, waived: null, v: 1 }, SS14: { source: 'holds', open: 1, waived: 0, v: 1 } } })
 * console.log(Object.keys(s.ai), s.ai.SS14.holdsOpen)
 * // => [ 'SS14' ] 1
 */
export function summarizeScanOf(rep) {
    const r = isobj(rep) ? rep : {}
    const ai = {}
    for (const [id, a] of Object.entries(isobj(r.ai) ? r.ai : {})) {
        if (!isobj(a) || a.source !== 'holds' || a.open === null || !(a.open || a.waived)) continue
        ai[id] = { checked: 0, pass: 0, violation: 0, undetermined: 0, na: 0, stale: 0, holdsOpen: a.open, holdsWaived: a.waived ?? 0, v: a.v }
    }
    return standardsScanOf({ counts: r.counts, standards: r.standards, ai }, { object: SUMMARIZE_SCAN_OBJECT })
}

export default { SUMMARIZE_AUDITED_STANDARD_IDS, SUMMARIZE_AI_PENDING_STANDARD_IDS, SUMMARIZE_SCAN_OBJECT, auditSummarizeStandards, summarizeScanOf }
