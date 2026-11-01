// noteStandards.mjs — 摘要之檢定標準(筆記):純函數,輸入＝落地形態(md 之 front／body＋記錄),新進守門與符合度掃描共用
//
// 【檢查落地形態,不檢查 AI 原始輸出】`[object Object]`、參數表空白列等只在渲染後才看得見;新進時於 buildNote 之後、寫檔之前呼叫,
//   存量掃描呼叫同一函數,輸入形態相同。
// 【內容章】core/md/noteContent:去掉程式產生之「來源」章與下游投影之「關聯」「⚠ 衝突與反例」章。
// 【標準】(標準定義改變即升 NOTE_STANDARDS 之 v)
//   SS2 欄位完整與型別:標題、一句話重點非空;核心知識 ≥1 條;概念個數在 CONCEPT_COUNT 範圍內且皆字串;內容類型與證據等級在詞彙表清單內;
//       內容無 [object Object];參數表無空白列
//   SS3 正體:內容章、標題、概念之簡體專用字與同形字誤用數＝0(抓取套件之 textForms;`[[連結]]` 與網址不計——他篇 id 與外部網址
//       非本篇之文字,存量修正亦不轉);只適用於臺灣正體之字形政策(appliesTo;ctx.locale 非繁體中文 → 不適用,抓取套件之 core/locale)
//   SS4 數字紮根於原文:內容章與概念之數字事實須見於「原文標題＋摘要當時送出之內文」(core/standards/numbers);原文不可得 → 未能判定
//   SS6 概念標籤形式:無計數尾碼「名稱(N)」(N≥10 且非 1000～2100 之年份)、一標籤一概念(無「, 」「、」等分隔)、
//       無跨文字系統之括號註記(中文名＋英文括號或反之;同文字系統之階數或參數如 Beta(1,1)、多項式(2) 合法)
//   SS11 證據等級與限制相符:最高證據等級之要件與「caveat 自承無此要件」之判準取自詞彙表之 evidenceRule(core/standards/evidenceRules
//       為單一實作;未給規則＝不啟用 → 不適用)
// 【詞彙之送達】本層各函數(standards/*)所讀之詞彙須為本套件解析後之詞彙表(resolveSummarizeVocab 之產物;未經解析即拋錯——證據規則
//   不得靜默退回不啟用);未給詞彙(undefined／null)＝依賴詞彙之判定略過(清單檢查不做、證據等級不降、SS11 不適用)。取用一律經 standardsVocabOf。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import { noteContentText, sectionBodyOf, originalTitleOf, evidenceNoteOf, NOTE_SECTION_TITLES } from '../core/md/noteContent.mjs'
import { STATUS, result, fromProblems, withoutForeignSpans, scriptOf, scriptApplies, SCRIPT_NA_DETAIL } from '../core/capturePackage.mjs'
import { ungroundedNumbers } from '../core/standards/numbers.mjs'
import { assertSummarizeVocab } from '../core/vocab/summarizeVocab.mjs'

/** 筆記標準之版本(標準定義改變即升;符合度報告與檢核紀錄以此判斷須否重檢) */
export const NOTE_STANDARDS = [
    { id: 'SS2', title: '欄位完整與型別', kind: 'program', v: 1 },
    { id: 'SS3', title: '正體', kind: 'program', v: 2, appliesTo: ['zh-Hant-TW'] },
    { id: 'SS4', title: '數字紮根於原文', kind: 'program', v: 1 },
    { id: 'SS6', title: '概念標籤形式', kind: 'program', v: 1 },
    { id: 'SS11', title: '證據等級與限制相符', kind: 'program', v: 1 },
]

/**
 * 一篇筆記之概念個數範圍(SS2;落地檢定、AI 輸出端之硬性欄位、正規化與組裝之上限、納入閘之致命條件與提示詞所載同讀此處)
 *
 * @type {Object}
 */
export const CONCEPT_COUNT = Object.freeze({ min: 2, max: 6 })

/**
 * 概念個數不合之說明(SS2;落地檢定與 AI 輸出端之硬性欄位同一字樣)
 *
 * @param {Integer} n 輸入概念個數
 * @returns {String} 回傳說明,如「概念 1 個（須 2～6）」
 * @example
 * console.log(conceptCountDetail(1))
 * // => 概念 1 個（須 2～6）
 */
export function conceptCountDetail(n) {
    return `概念 ${n} 個（須 ${CONCEPT_COUNT.min}～${CONCEPT_COUNT.max}）`
}

/**
 * 本層之詞彙取用(檔頭【詞彙之送達】):未給(undefined／null)回 null;給了須為 resolveSummarizeVocab 之產物
 *
 * @param {*} vocab 輸入詞彙表
 * @param {String} [where='vocab'] 輸入呼叫處之名稱(錯誤訊息用)
 * @returns {Object|null} 回傳同一詞彙表,未給回 null
 * @throws {Error} 給了而非本套件解析後之詞彙表(含 {}、他段之詞彙表、JSON 往返之複本、非物件)時拋出
 * @example
 * console.log(standardsVocabOf(undefined))
 * // => null
 */
export function standardsVocabOf(vocab, where = 'vocab') {
    if (vocab === undefined || vocab === null) return null
    return assertSummarizeVocab(vocab, where)
}

const bulletsOf = (text) => String(text || '').split('\n').filter((l) => /^\s*-\s+\S/.test(l))

/**
 * 概念標籤之形式問題(SS6)
 *
 * @param {*} label 輸入概念標籤
 * @returns {String} 回傳問題說明(無問題回 '')
 * @example
 * console.log(['主序星', '主序星(12)', '主序星、赫羅圖'].map(conceptLabelProblem))
 * // => [ '', '計數尾碼「主序星(12)」', '多概念擠一標籤「主序星、赫羅圖」' ]
 * console.log(conceptLabelProblem('主序星(main sequence)'))
 * // => 跨文字系統之括號註記「主序星(main sequence)」
 */
export function conceptLabelProblem(label) {
    const s = String(label ?? '').normalize('NFKC').trim()
    if (!s) return '空白標籤'
    const suf = /^(.+?)\s*\((\d+)\)$/.exec(s)
    if (suf) {
        const n = Number(suf[2])
        if (n >= 10 && !(n >= 1000 && n <= 2100)) return `計數尾碼「${s}」`
    }
    if (/[,，、;；]/.test(s.replace(/\([^()]*\)/g, ''))) return `多概念擠一標籤「${s}」` // 括號內之逗號是參數(如 Beta(1,1)),不算
    const ann = /^(.+?)\s*\(([^()]+)\)$/.exec(s)
    if (ann) {
        const baseCjk = /\p{Script=Han}/u.test(ann[1])
        const parenLatin = /[A-Za-z]/.test(ann[2])
        const baseLatin = /^[\sA-Za-z0-9\-_.&/+]+$/.test(ann[1])
        const parenCjk = /\p{Script=Han}/u.test(ann[2])
        if ((baseCjk && parenLatin && !parenCjk) || (baseLatin && parenCjk)) return `跨文字系統之括號註記「${s}」`
    }
    return ''
}

/**
 * 檢定一篇筆記(SS2、SS3、SS4、SS6、SS11)
 *
 * @param {Object} note 輸入 { front, body, record, text }(front／body 為 readMd 之產物;record 為筆記記錄,可缺;text 為無 md 之產物〔自訂契約〕供
 *        SS3／SS4 讀之內容文字——有 body 時不讀)
 * @param {Object} [ctx={}] 輸入 { vocab:resolveSummarizeVocab 之產物(未給＝清單檢查不做、SS11 不適用), material:String|null|undefined
 *        (SS4 之原文;undefined＝不檢 SS4,null＝原文不可得 → 未能判定), only:Array(只跑所列之標準 id;未給＝全部——契約之 standards),
 *        locale:語言設定或字形政策(抓取套件之 core/locale;SS3 只適用於臺灣正體,其餘列不適用;未給＝正體) }
 * @returns {Array} 回傳判定結果陣列(每條標準一筆;見抓取套件之 verdict)
 * @throws {Error} ctx.vocab 給了而非本套件解析後之詞彙表、或 ctx.locale 不合時拋出
 * @example
 * let note = { front: { title: '恆星分類', concepts: ['主序星', '赫羅圖'], claim_type: '理論模型', evidence_level: '中' }, body: '## 一句話重點\n\n依光譜型分類恆星。\n\n## 核心知識\n\n- 主序星以氫核融合維持亮度' }
 * console.log(checkNote(note).map((r) => `${r.std}:${r.status}`).join(' '))
 * // => SS2:pass SS3:pass SS6:pass SS11:na
 *
 * let bad = checkNote({ front: { title: '恆星', concepts: ['主序星'] }, body: '## 核心知識\n\n- 質量約 8 倍太陽' }, { material: '質量約 5 倍太陽', only: ['SS2', 'SS4'] })
 * console.log(bad.map((r) => `${r.std}:${r.status} ${r.detail}`).join('\n'))
 * // => SS2:violation 缺一句話重點；概念 1 個（須 2～6）
 * // => SS4:violation 原文沒有之數字：8 倍
 */
export function checkNote(note, ctx = {}) {
    const vocab = standardsVocabOf(ctx.vocab, 'checkNote 之 ctx.vocab')
    const script = scriptOf(ctx.locale, 'checkNote 之 ctx.locale')
    const v = vocab || {}
    const front = isobj(note?.front) ? note.front : {}
    const body = String(note?.body ?? '')
    const record = isobj(note?.record) ? note.record : {}
    const content = body ? noteContentText(body) : String(note?.text ?? '')
    const concepts = isarr(front.concepts) ? front.concepts : (isarr(record.concepts) ? record.concepts : [])
    const title = String(front.title ?? record.title ?? '').trim()
    const only = isarr(ctx.only) ? new Set(ctx.only) : null
    const want = (id) => !only || only.has(id)
    const T = NOTE_SECTION_TITLES
    const out = []

    // SS2 欄位完整與型別
    if (want('SS2')) {
        const p2 = []
        if (!title || title.includes('[object Object]')) p2.push('標題空白或非字串')
        if (!sectionBodyOf(body, T.summary)) p2.push(`缺${T.summary}`)
        if (!bulletsOf(sectionBodyOf(body, T.keyPoints)).length) p2.push(`${T.keyPoints}為空`)
        if (concepts.length < CONCEPT_COUNT.min || concepts.length > CONCEPT_COUNT.max) p2.push(conceptCountDetail(concepts.length))
        if (concepts.some((c) => typeof c !== 'string')) p2.push('概念含非字串元素')
        if (isarr(v.claimTypes) && !v.claimTypes.includes(front.claim_type)) p2.push(`內容類型「${front.claim_type ?? ''}」不在清單`)
        if (isarr(v.evidenceLevels) && !v.evidenceLevels.includes(front.evidence_level)) p2.push(`證據等級「${front.evidence_level ?? ''}」不在清單`)
        if (content.includes('[object Object]')) p2.push('內容含 [object Object]')
        if (/^\|\s*\|\s*\|\s*\|\s*$/m.test(sectionBodyOf(body, T.parameters))) p2.push('參數表有空白列')
        out.push(fromProblems('SS2', p2, 8))
    }

    // SS3 正體(不計 `[[連結]]` 與網址——他篇 id、外部網址不是本篇之文字;與存量修正 fixKeepLinks 同一定義);字形政策非臺灣正體 → 不適用
    if (want('SS3')) {
        if (!scriptApplies(NOTE_STANDARDS.find((s) => s.id === 'SS3'), script)) out.push(result('SS3', STATUS.NA, SCRIPT_NA_DETAIL))
        else {
            const p3 = []
            for (const [field, text] of [['標題', title], ['內容', content], ['概念', concepts.map(String).join('、')]]) {
                const pr = script.problems(withoutForeignSpans(text))
                if (pr.count) p3.push(`${field} ${pr.count} 處（${[...pr.only.map((x) => x.c), ...pr.practical.map((x) => x.c), ...pr.phrases.map((x) => x.cn)].slice(0, 6).join('')}）`)
            }
            out.push(fromProblems('SS3', p3))
        }
    }

    // SS4 數字紮根於原文
    if (want('SS4')) {
        if (ctx.material === null) out.push(result('SS4', STATUS.UNDETERMINED, '原文不可得'))
        else if (typeof ctx.material === 'string') {
            const ung = ungroundedNumbers(`${content}\n${concepts.map(String).join('\n')}`, ctx.material)
            out.push(ung.length ? result('SS4', STATUS.VIOLATION, `原文沒有之數字：${ung.slice(0, 8).join('、')}${ung.length > 8 ? `…共 ${ung.length} 處` : ''}`) : result('SS4', STATUS.PASS))
        }
    }

    // SS6 概念標籤形式
    if (want('SS6')) out.push(fromProblems('SS6', concepts.map(conceptLabelProblem)))

    // SS11 證據等級與限制相符(規則之判定、說明與 caveats 之來源皆出自詞彙表之 evidenceRule;未給詞彙 → 不適用;
    //   證據說明取 md 之「證據等級：X（說明）」,供規則辨認另一種合格證據)
    if (want('SS11')) {
        if (!vocab) out.push(result('SS11', STATUS.NA))
        else {
            const rule = vocab.evidenceRule
            out.push(rule.judge({ level: front.evidence_level, levels: vocab.evidenceLevels, caveats: rule.caveatsOf(front, record), evidence: evidenceNoteOf(body) }))
        }
    }
    return out
}

/**
 * 判定結果之回饋文字(附於下次摘要提示詞;摘要段之不納入與人工匯入之訊息共用):`<標準> <說明>`;證據等級之未能判定(SS11:涉及要件而
 *   未明確自承)另附明確之更正方向——方向之措辭出自詞彙表之 evidenceRule,故須給詞彙(新進寬式只命中者不自動降級,交模型明確化)
 *
 * @param {Object} r 輸入 checkNote 之一筆結果
 * @param {Object} [opt] 輸入 { vocab:resolveSummarizeVocab 之產物(未給＝不附更正方向) }
 * @returns {String} 回傳回饋文字
 * @throws {Error} opt 給了而非物件(如以 .map(noteFeedbackOf) 直接傳入,陣列索引成為第二參數)、或 opt.vocab 非本套件解析後之詞彙表時拋出
 * @example
 * console.log(noteFeedbackOf({ std: 'SS6', status: 'violation', detail: '多概念擠一標籤「甲、乙」' }))
 * // => SS6 多概念擠一標籤「甲、乙」
 */
export function noteFeedbackOf(r, opt) {
    if (opt !== undefined && opt !== null && !isobj(opt)) {
        throw new Error('noteFeedbackOf 之第二參數須為 { vocab }（勿以 .map(noteFeedbackOf) 直接傳入：陣列索引會成為第二參數）')
    }
    const base = `${r?.std || ''} ${r?.detail || ''}`.trim()
    const vocab = standardsVocabOf(opt?.vocab, 'noteFeedbackOf 之 opt.vocab')
    const hint = vocab ? vocab.evidenceRule.feedbackHintOf(r) : ''
    return hint ? `${base}——${hint}` : base
}

/**
 * 數字紮根之材料:原文標題＋摘要當時送出之內文(processedChars 有值者只取前段——與摘要提示詞之截斷同一位置)。
 * 「今日之頁面」(抓取套件 docTextOf 之 currentPage:原文回溯之網頁重取)不能證明為摘要當時之材料(頁面會改版:今日新增之數字使當時
 * 無據者通過、刪改者使當時有據者違反)→ 視同材料不可得(未能判定;寧缺勿錯)。
 * 取得方式之語意由抓取套件判(API 依編號重取者為同一記錄,不標 currentPage,照用);本檔不自解讀 textFrom。
 *
 * @param {Object} src 輸入 { title, text, feedText, currentPage }(抓取套件之 docTextOf 之結果;null 表原文不可得)
 * @param {Object} [record={}] 輸入筆記記錄(取 processedChars)
 * @param {*} [body=''] 輸入 md 本文(原文標題以來源章為準;src 無標題時用)
 * @returns {String|null} 回傳材料文字;原文不可得(含今日之頁面)回 null
 * @example
 * console.log(noteMaterialOf({ title: '恆星', text: '主序星佔多數。紅巨星為晚期階段。' }, { processedChars: 6 }))
 * // => 恆星
 * // => 主序星佔多數
 * console.log(noteMaterialOf({ text: '主序星佔多數。', currentPage: true }), noteMaterialOf(null))
 * // => null null
 */
export function noteMaterialOf(src, record = {}, body = '') {
    if (!isobj(src) || !(src.text || src.feedText)) return null
    if (src.currentPage === true) return null
    const text = String(src.text || src.feedText || '')
    const n = Number(record?.processedChars) || 0
    const sent = n > 0 && n < text.length ? text.slice(0, n) : text
    return `${src.title || originalTitleOf(body)}\n${sent}`
}

export default { NOTE_STANDARDS, CONCEPT_COUNT, conceptCountDetail, standardsVocabOf, conceptLabelProblem, checkNote, noteFeedbackOf, noteMaterialOf }
