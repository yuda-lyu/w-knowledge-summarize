// noteStockFix.mjs — 筆記之存量確定性修正(檢定標準 SS2 可確定者、SS3、SS4〔須材料〕、SS6、SS11)
//
// 【純函數】輸入 md(front／body)與記錄,回傳修正後之 front／body 與逐項變更;寫入、記錄同步與對下游之連鎖由呼叫端負責(本套件之筆記同步、
//   還原閘與存量處置皆呼叫本函數;回傳之 titleChanged／contentChanged／conceptKeys 供其列出受影響之下游產物)。判準與新進同一實作:
//   正體 toTw(只改違規處)、概念 normConcepts(standards/noteNormalize)、證據等級改寫 rewriteFieldOf(stores/taxonomy;重標同一實作)、
//   SS11 之降級取詞彙表之證據規則(evidenceRule.downgrade;判定、新進降級與存量降級同一規則、同一組訊息)。
// 【只動內容】內容章(去程式產生之來源章與下游投影之章——core/md/noteContent 之 NON_CONTENT_SECTIONS)、標題(front＋H1)、概念、
//   樣本期間與限制(front)、證據等級;`[[連結]]` 與網址不轉(他篇 id、外部網址不是本篇之文字;抓取套件之 toTwKeepLinks——SS3 之檢查
//   同一定義,不計此類片段)。
// 【分群鍵斷言】SS3 轉正體之概念,逐個斷言 normalizeConcept 分群鍵不變;變了即不改該概念(記 skipped)——轉正體不得暗中改分群;
//   SS6 之修正(去尾碼、拆標籤、去括號註記)本就改分群,變更列 conceptKeys 供呼叫端列出受影響之下游產物。
// 【SS6 之三類】①去計數尾碼 ②擠標籤須各段(修正後)皆為既有概念才拆(ctx.knownConcept;不符則原樣、列為修不了)、保序、第一段為主概念、
//   逾 CONCEPT_COUNT.max 截前段 ③去跨文字系統之括號註記;同文字系統之括號(Beta(1,1)、多項式(2))不動。
// 【SS2 只修無內容之壞行】`[object Object]` 行(原值已失,刪行不失資訊)、參數表之空白列、概念逾上限(截);缺欄位(內容類型／證據等級
//   空白或不在清單、概念不足、缺一句話重點)須判讀,不在此修。
// 【詞彙】ctx.vocab 同 standards/noteStandards【詞彙之送達】:給了須為本套件解析後之詞彙表(未經解析即拋);未給＝SS11 不修。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import { NON_CONTENT_SECTIONS, NOTE_SECTION_TITLES, NOTE_QUALITY_LABELS, noteContentText, evidenceNoteOf } from '../core/md/noteContent.mjs'
import { scriptOf, normalizeConcept } from '../core/capturePackage.mjs'
import { ungroundedNumbers } from '../core/standards/numbers.mjs'
import { normConcepts, NOTE_PLACEHOLDERS } from '../standards/noteNormalize.mjs'
import { conceptLabelProblem, CONCEPT_COUNT, standardsVocabOf } from '../standards/noteStandards.mjs'
import { RENAME_FIELDS, rewriteFieldOf } from '../stores/taxonomy.mjs'

/** 本模組可修之標準(SS4 須呼叫端給材料 ctx.material;未給即不修 SS4) */
export const NOTE_FIX_STDS = Object.freeze(['SS2', 'SS3', 'SS4', 'SS6', 'SS11'])

/**
 * 只對內容章(與 H1 所在之開頭段)套用 fn;非內容章(來源章與下游投影之章)原樣
 *
 * @param {*} body 輸入 md 本文
 * @param {Function} fn 輸入 (段落文字) => 新文字
 * @returns {String} 回傳新本文
 * @example
 * let body = '# 標題\n\n## 核心知識\n\n- 甲\n\n## 來源\n\n- 乙'
 * console.log(JSON.stringify(mapContentSections(body, (p) => p.replace(/- /g, '* '))))
 * // => "# 標題\n\n## 核心知識\n\n* 甲\n\n## 來源\n\n- 乙"
 */
export function mapContentSections(body, fn) {
    const parts = String(body ?? '').replace(/\r\n/g, '\n').split(/\n(?=## )/)
    const isNon = (p) => NON_CONTENT_SECTIONS.some((h) => p.startsWith(`## ${h}\n`) || p === `## ${h}` || p.startsWith(`## ${h} `))
    return parts.map((p) => (isNon(p) ? p : fn(p))).join('\n')
}

const isObjLine = (l) => l.includes('[object Object]')
const isEmptyParamRow = (l) => /^\|\s*\|\s*\|\s*\|\s*$/.test(l)

/**
 * 一篇筆記之存量確定性修正
 *
 * @param {Object} md 輸入 readMd 之產物 { front, body }
 * @param {Object} [record={}] 輸入筆記記錄(取 caveats、samplePeriod 之記錄值)
 * @param {Object} [ctx={}] 輸入 { stds:Array(要修之標準;預設全部), vocab:resolveSummarizeVocab 之產物(取 evidenceLevels、evidenceRule;
 *   未給＝SS11 不修), knownConcept:(標籤)=>Boolean(既有概念;擠標籤之拆分條件), material:String(SS4 之材料;未給不修 SS4),
 *   locale:語言設定或字形政策(SS3 之轉正體依之;非繁體中文之語言為恆等、不改;未給＝臺灣正體) }
 * @returns {Object} 回傳 { front, body, changes:[{ std, what }], skipped:[{ std, what }], conceptKeys:{ removed:[分群鍵], added:[分群鍵] },
 *   titleChanged, contentChanged, conceptsChanged, evidenceChanged, recordPatch:Object(記錄之對應欄位;不含同步欄位) }
 * @throws {Error} ctx.vocab 給了而非本套件解析後之詞彙表、或 ctx.locale 不合時拋出
 * @example
 * let md = { front: { title: '星系', concepts: ['星系(246)', '黑洞'] }, body: '# 星系\n\n## 一句話重點\n\n重點\n\n## 核心知識\n\n- 要點' }
 * let r = noteFixOf(md, {}, { stds: ['SS6'] })
 * console.log(r.front.concepts, r.changes)
 * // => [ '星系', '黑洞' ] [ { std: 'SS6', what: '概念去計數尾碼「星系(246)」' } ]
 */
export function noteFixOf(md, record = {}, ctx = {}) {
    const vocab = standardsVocabOf(ctx.vocab, 'noteFixOf 之 ctx.vocab')
    const script = scriptOf(ctx.locale, 'noteFixOf 之 ctx.locale')
    // 正體修正一律 fixKeepLinks:`[[連結]]` 與網址指稱他物,轉換即斷連結(標題、內容章、樣本期間、限制、概念同一轉法)
    const toTwKeepLinks = (s) => script.fixKeepLinks(s)
    const stds = new Set(isarr(ctx.stds) && ctx.stds.length ? ctx.stds : NOTE_FIX_STDS)
    let front = { ...(isobj(md?.front) ? md.front : {}) }
    let body = String(md?.body ?? '').replace(/\r\n/g, '\n')
    const body0 = body
    const changes = []
    const skipped = []
    const conceptKeys = { removed: [], added: [] }
    const recordPatch = {}

    // SS2(可確定者):刪內容章中之 [object Object] 行與參數表空白列
    if (stds.has('SS2')) {
        let objN = 0
        let rowN = 0
        body = mapContentSections(body, (p) => p.split('\n').filter((l) => {
            if (isObjLine(l)) {
                objN++
                return false
            }
            if (isEmptyParamRow(l)) {
                rowN++
                return false
            }
            return true
        }).join('\n'))
        if (objN) changes.push({ std: 'SS2', what: `刪 [object Object] 行 ${objN}` })
        if (rowN) changes.push({ std: 'SS2', what: `刪參數表空白列 ${rowN}` })
    }

    // SS3:標題(front＋H1 在內容段)、內容章、樣本期間、限制
    const title0 = String(front.title ?? '')
    if (stds.has('SS3')) {
        const t = toTwKeepLinks(title0)
        if (t !== title0) {
            front.title = t
            changes.push({ std: 'SS3', what: `標題「${title0}」→「${t}」` })
        }
        const b = mapContentSections(body, toTwKeepLinks)
        if (b !== body) {
            changes.push({ std: 'SS3', what: '內容章轉正體' })
            body = b
        }
        if (typeof front.sample_period === 'string') {
            const sp = toTwKeepLinks(front.sample_period)
            if (sp !== front.sample_period) {
                front.sample_period = sp
                recordPatch.samplePeriod = sp
                changes.push({ std: 'SS3', what: '樣本期間轉正體' })
            }
        }
        if (isarr(front.caveats)) {
            const cv = front.caveats.map((c) => (typeof c === 'string' ? toTwKeepLinks(c) : c))
            if (cv.some((c, i) => c !== front.caveats[i])) {
                front.caveats = cv
                recordPatch.caveats = cv
                changes.push({ std: 'SS3', what: '限制轉正體' })
            }
        }
    }

    // 概念:SS6(去尾碼、拆標籤、去括號註記、截至上限——SS2 之概念逾上限同此)與 SS3(轉正體;分群鍵須不變)
    const c0 = isarr(front.concepts) ? front.concepts.map(String) : []
    let concepts = c0
    if (stds.has('SS6') || (stds.has('SS2') && c0.length > CONCEPT_COUNT.max)) {
        if (c0.some((c) => conceptLabelProblem(c)) || c0.length > CONCEPT_COUNT.max) {
            const fixes = []
            // 擠標籤須各段皆為既有概念才拆(檔頭【SS6 之三類】;ctx.knownConcept 由呼叫端以全庫概念給;未給＝不拆擠標籤)
            const known = typeof ctx.knownConcept === 'function' ? ctx.knownConcept : () => false
            const next = normConcepts(c0, fixes, { canSplit: (parts) => parts.every(known), locale: ctx.locale })
            for (const f of fixes) changes.push({ std: /截為/.test(f) ? 'SS2' : 'SS6', what: f })
            concepts = next
        }
    }
    if (stds.has('SS3')) {
        concepts = concepts.map((c) => {
            const t = toTwKeepLinks(c)
            if (t === c) return c
            if (normalizeConcept(t) !== normalizeConcept(c)) {
                skipped.push({ std: 'SS3', what: `概念「${c}」轉正體會改分群鍵（${normalizeConcept(c)} → ${normalizeConcept(t)}），不改` })
                return c
            }
            changes.push({ std: 'SS3', what: `概念「${c}」→「${t}」` })
            return t
        })
    }
    // SS4:數字紮根於原文(須 ctx.material——原文標題＋摘要當時送出之內文,與 checkNote 同一 noteMaterialOf;未給不修)。與新進閘同一處置
    //   (standards/noteGate.dropUngrounded):內容章之清單行與參數列含原文沒有之數字者逐條移除、樣本期間改缺值字樣、概念與限制同;
    //   標題、一句話重點、非清單之行有之,或移除後核心知識為空、概念不足下限 → 修不了(skipped;呼叫端登錄待判),SS4 部分全數不改。
    //   改後以同一判定複驗,仍有則同修不了
    if (stds.has('SS4') && typeof ctx.material === 'string') {
        const g = (s) => ungroundedNumbers(String(s ?? ''), ctx.material)
        const fatal = new Set()
        const removed = []
        if (g(front.title).length) fatal.add('標題')
        const nb = mapContentSections(body, (p) => {
            const heading = (p.match(/^## (.+)$/m) || [])[1] || ''
            return p.split('\n').map((l, i) => {
                if (i === 0 && l.startsWith('## ')) return l
                const nums = g(l)
                if (!nums.length) return l
                if (/^# /.test(l)) {
                    fatal.add('標題')
                    return l
                }
                if (heading === NOTE_SECTION_TITLES.summary) {
                    fatal.add(NOTE_SECTION_TITLES.summary)
                    return l
                }
                if (new RegExp(`^\\s*[-*]\\s*${NOTE_QUALITY_LABELS.samplePeriod}：`).test(l)) {
                    removed.push(`樣本期間（${nums.join('、')}）→ ${NOTE_PLACEHOLDERS.samplePeriod}`)
                    return l.replace(new RegExp(`(${NOTE_QUALITY_LABELS.samplePeriod}：).*`), `$1${NOTE_PLACEHOLDERS.samplePeriod}`)
                }
                if (/^\s*[-*]\s/.test(l) || /^\s*\|/.test(l)) {
                    removed.push(`${heading || '開頭'}：${l.trim().slice(0, 50)}（${nums.join('、')}）`)
                    return null
                }
                fatal.add(`${heading || '開頭'}之非清單行`)
                return l
            }).filter((l) => l !== null).join('\n')
        })
        const keep = concepts.filter((c) => !g(c).length)
        if (keep.length < concepts.length) removed.push(`概念：${concepts.filter((c) => g(c).length).join('、')}`)
        if (keep.length < CONCEPT_COUNT.min) fatal.add(`概念（移除後不足 ${CONCEPT_COUNT.min} 個）`)
        // 核心知識章之清單行數(依章切分;同 mapContentSections 之切法)
        const KP = NOTE_SECTION_TITLES.keyPoints
        const kpOf = (b) => (b.split(/\n(?=## )/).find((x) => x.startsWith(`## ${KP}\n`) || x === `## ${KP}`) || '').split('\n').filter((l) => /^\s*[-*]\s/.test(l)).length
        if (kpOf(body) > 0 && kpOf(nb) === 0) fatal.add(`${KP}（皆含原文沒有之數字）`)
        if (!fatal.size && (removed.length || nb !== body)) {
            const cvs = isarr(front.caveats) ? front.caveats.filter((c) => !(typeof c === 'string' && g(c).length)) : null
            const left = g(`${noteContentText(nb)}\n${keep.join('\n')}`)
            if (left.length) skipped.push({ std: 'SS4', what: `修不了：移除後仍有原文沒有之數字（${left.slice(0, 6).join('、')}）` })
            else {
                body = nb
                concepts = keep
                if (nb.includes(`數據樣本期間：${NOTE_PLACEHOLDERS.samplePeriod}`) && typeof front.sample_period === 'string' && front.sample_period !== NOTE_PLACEHOLDERS.samplePeriod && g(front.sample_period).length) {
                    front.sample_period = NOTE_PLACEHOLDERS.samplePeriod
                    recordPatch.samplePeriod = NOTE_PLACEHOLDERS.samplePeriod
                }
                if (cvs && cvs.length !== front.caveats.length) {
                    front.caveats = cvs
                    recordPatch.caveats = cvs
                }
                changes.push({ std: 'SS4', what: `移除含原文沒有之數字 ${removed.length} 處（${removed.slice(0, 3).join('；')}${removed.length > 3 ? '…' : ''}）` })
            }
        }
        else if (fatal.size) skipped.push({ std: 'SS4', what: `修不了：${[...fatal].join('、')}含原文沒有之數字` })
    }

    const conceptsChanged = JSON.stringify(concepts) !== JSON.stringify(c0)
    if (conceptsChanged) {
        front.concepts = concepts
        const before = new Set(c0.map(normalizeConcept))
        const after = new Set(concepts.map(normalizeConcept))
        conceptKeys.removed = [...before].filter((k) => !after.has(k))
        conceptKeys.added = [...after].filter((k) => !before.has(k))
    }

    // SS11:最高證據等級而 caveat 明確自承無其要件(詞彙表之證據規則,嚴式)→ 次高級(只往保守方向;只命中寬式者屬未能判定,不在此修);
    //   證據說明或 caveats 肯定陳述另一種合格證據(規則之 alt)者不降;規則未啟用或未給詞彙 → 不修
    let evidenceChanged = false
    if (stds.has('SS11') && vocab) {
        const rule = vocab.evidenceRule
        const d = rule.downgrade({ level: front.evidence_level, levels: vocab.evidenceLevels, caveats: rule.caveatsOf(front, record), evidence: evidenceNoteOf(body) })
        if (d) {
            const r = rewriteFieldOf({ front, body }, RENAME_FIELDS.evidenceLevel, d.to)
            front = r.front
            body = r.body
            recordPatch.evidenceLevel = d.to
            evidenceChanged = true
            changes.push({ std: 'SS11', what: d.change })
        }
    }

    return {
        front, body, changes, skipped, conceptKeys,
        titleChanged: String(front.title ?? '') !== title0,
        contentChanged: body !== body0,
        conceptsChanged,
        evidenceChanged,
        recordPatch,
    }
}

export default { NOTE_FIX_STDS, mapContentSections, noteFixOf }
