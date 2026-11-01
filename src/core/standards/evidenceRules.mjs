// evidenceRules.mjs — 證據等級與限制相符(SS11)之單一實作:規則參數化,判定、新進降級、存量降級、回饋與訊息皆由此出
//
// 【規則】安裝方定義「最高證據等級(詞彙表 evidenceLevels 第一項)須有 {check}」時,筆記之 caveats(內容品質問題)明確自承無 {check}
//   即與證據等級自相矛盾。
//   判定(筆記檢定、符合度掃描):嚴式命中 → 不合格;只命中寬式(涉及 {subject} 而未明確自承)→ 未能判定(交模型明確化或使用者判讀);
//   皆未命中 → 合格;非最高級 → 不適用。
//   降級(新進正規化、存量修正):只在嚴式命中時降一級(往保守方向);只命中寬式者不改——新進與存量同一判準。
// 【預設不啟用】最高級之定義因領域而異(通用預設之「高」為數種證據擇一即可),任何單一「無某種驗證」之通用規則都會把合乎定義之筆記
//   系統性誤判;故未給規則時為停用之規則物件:判定恆為不適用、不降級、回饋不附更正方向。安裝方於詞彙表給 evidenceRule 才啟用。
// 【嚴式不得誤判、寬式寧寬】嚴式命中即判不合格或自動降級,故安裝方之嚴式樣式須無誤判;寬式命中只到「未能判定」,誤中之代價是
//   多一次明確化,可放寬(如否定詞後若干字內出現即算)。
// 【比對前正規化】文字先 NFKC 再轉正體(抓取套件之 toTw):簡體與全形寫法亦命中,樣式只需以正體書寫。
// 【規則之形狀】vocab.evidenceRule = { subject, check, strict, loose, alt? }(前四鍵皆須給;loose 可為空陣列＝不設未能判定):subject 為訊息
//   「caveat 涉及{subject}而未明確自承」之詞,check 為「自承無{check}」「是否做過{check}」之詞;strict／loose／alt 為樣式陣列
//   (RegExp 或 JSON 可寫之 { p, f? })。判定與訊息即逐字為安裝方所定。
// 【另一種合格證據(alt;選用)】最高級之定義常為「A 或 B」(如「經隨機對照試驗或長期世代追蹤證實」):只自承無 A 而肯定陳述了 B 者不矛盾。
//   alt 為 B 之肯定陳述之樣式,逐句(以，,；;。！？!? 與換行切句)比對筆記之證據說明(md「證據等級：X（說明）」之說明、新進項目之
//   evidence_note)與 caveats;任一句命中 → 判合格、不降級。否定須由樣式自身排除(句中有「未」「無」者不算——「未提及隨機對照試驗或
//   世代追蹤結果」不是 B 之肯定陳述)。未給 alt 者行為與正規形(及指紋)皆與加入 alt 之前相同。
// 【設定形與執行形】evidenceRuleOf 回傳已編譯之規則物件(凍結、帶標記,isEvidenceRule 可辨認):config 為 JSON 可序列化之正規形
//   (JSON.stringify 該物件即得 config;停用者得 null),fp 為規則內容之指紋(config 之 sha1 前 16 碼;停用者為空字串,供報表標示所用之規則)。
//   以同一 config 重複呼叫 evidenceRuleOf 取得同一已編譯物件(不重編譯)。
//
// 呼叫端(規則一律取自已解析之詞彙表:assertSummarizeVocab(vocab).evidenceRule——未經本套件解析之詞彙即拋錯,不靜默退回停用):
//   筆記判定 checkNote ── rule.judge({ level: front.evidence_level, levels: vocab.evidenceLevels, caveats: rule.caveatsOf(front, record), evidence: evidenceNoteOf(body) })
//   回饋 noteFeedbackOf ── 基本回饋;rule.feedbackHintOf(r) 非空者接「——」與之
//   新進正規化 normalizeNoteItem ── rule.downgrade({ level: k.evidence_level, levels: vocab.evidenceLevels, caveats: k.caveats || [], evidence: k.evidence_note }) → d.to、d.fix
//   存量修正 noteFixOf ── rule.downgrade({ level: front.evidence_level, levels, caveats: rule.caveatsOf(front, record), evidence: evidenceNoteOf(body) }) → d.to、d.change
//   下游判讀 noTopEvidenceOf ── noTopEvidenceOf({ caveats: evidenceCaveatsOf(front, record), evidence: evidenceNoteOf(body) }, vocab.evidenceRule) → 出處是否
//     自承無 {check}(嚴式或寬式命中、且無另一種合格證據;與最高級之 judge 判不合格或未能判定同一條件)

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { toTw, toPatterns, sha1, STATUS, result, checkKeys } from '../capturePackage.mjs'

/** 本規則之標準 ID(判定結果之 std;待判鍵與回饋據此辨認) */
export const EVIDENCE_STD = 'SS11'

/** vocab.evidenceRule 之鍵(前四鍵皆須給、alt 選用;evidenceRuleOf 據此拒絕不認得之鍵) */
export const EVIDENCE_RULE_KEYS = Object.freeze(['subject', 'check', 'strict', 'loose', 'alt'])

/** 另一種合格證據之切句(逐句比對 alt) */
const CLAUSE_SPLIT = /[，,；;。！？!?\n]/

/**
 * 另一種合格證據之比對材料:證據說明(字串或陣列)與 caveats(非陣列視為無)之非空項——判定、降級與 noTopEvidenceOf 同一取法(只此一份)
 *
 * @param {*} evidence 輸入證據說明(字串或陣列)
 * @param {*} caveats 輸入 caveats
 * @returns {Array} 回傳非空之項(證據說明在前、caveats 在後)
 */
function evidenceTexts(evidence, caveats) {
    return [...(isarr(evidence) ? evidence : [evidence]), ...(isarr(caveats) ? caveats : [])].filter((x) => x !== undefined && x !== null && String(x).trim())
}

/**
 * 預設規則:無(停用)。詞彙表未給 evidenceRule 即為此值;evidenceRuleOf(null) 回停用之規則物件
 *
 * @type {null}
 */
export const EVIDENCE_RULE_DEFAULT = null

/** 已編譯規則之標記(isEvidenceRule 據此辨認;evidenceRuleOf 收到已編譯者原樣回傳) */
const COMPILED = Symbol('evidenceRule')

/** 正規形(本檔產生、已深凍結之 config)→ 已編譯規則;使用方之物件不入快取(可能被就地修改) */
const CACHE = new WeakMap()

/**
 * 深凍結(物件與陣列逐層;回傳同一物件)
 *
 * @param {*} o 輸入值
 * @returns {*} 回傳凍結後之同一值
 */
function deepFreeze(o) {
    if (o && typeof o === 'object') {
        for (const v of Object.values(o)) deepFreeze(v)
        Object.freeze(o)
    }
    return o
}

/**
 * 驗證規則之兩個用詞(subject、check)
 *
 * @param {Object} rule 輸入 { subject, check }
 * @param {String} name 輸入設定名(錯誤訊息用)
 * @returns {Object} 回傳 { subject, check }
 * @throws {Error} 任一非非空字串時拋出
 */
function wordsOf(rule, name) {
    for (const k of ['subject', 'check']) {
        if (!isestr(rule?.[k]) || !rule[k].trim()) throw new Error(`${name}.${k} 須為非空字串`)
    }
    return { subject: rule.subject, check: rule.check }
}

/**
 * 樣式陣列之驗證與正規化:形狀與語法交抓取套件之 toPatterns 驗;另拒絕帶狀態之旗標(g、y:同一句之 test 結果隨呼叫次數改變)
 *   與命中空字串之樣式(任何文字皆命中)。正規形為 { p, f? }(RegExp 取其 source／flags;{ p, f } 原樣保留 p)
 *
 * @param {*} list 輸入樣式陣列
 * @param {String} name 輸入設定名(錯誤訊息用)
 * @param {Boolean} needOne 輸入是否至少須一個樣式
 * @returns {Object} 回傳 { config:Array({ p, f? }), res:Array(RegExp) }
 * @throws {Error} 非陣列、needOne 而為空、任一項形狀或語法不合、帶 g／y 旗標、或命中空字串時拋出
 */
function patternsOf(list, name, needOne) {
    if (!isarr(list)) throw new Error(`${name} 須為樣式陣列（RegExp 或 { p: 樣式字串, f?: 旗標 }）`)
    if (needOne && list.length === 0) throw new Error(`${name} 至少須有一個樣式（嚴式為空即永不判不合格、永不降級；不啟用規則請不給 evidenceRule）`)
    const res = toPatterns(list, name)
    const config = list.map((x, i) => {
        const re = res[i]
        if (/[gy]/.test(re.flags)) throw new Error(`${name}[${i}] 之旗標不可含 g 或 y（帶狀態之比對會使同一句之結果隨呼叫次數改變）`)
        if (re.test('')) throw new Error(`${name}[${i}] 會命中空字串（任何文字皆命中）`)
        const p = x instanceof RegExp ? x.source : x.p
        const f = x instanceof RegExp ? x.flags : (x.f || '')
        return f ? { p, f } : { p }
    })
    return { config, res: config.map((x) => new RegExp(x.p, x.f || '')) }
}

/**
 * 筆記之 caveats(front 優先,其次記錄;皆非陣列為 [])——判定與存量修正取同一來源
 *
 * @param {Object} [front] 輸入 md 之 frontmatter
 * @param {Object} [record] 輸入筆記記錄
 * @returns {Array} 回傳 caveats 陣列(原陣列,不複製)
 * @example
 * console.log(evidenceCaveatsOf({}, { caveats: ['甲'] }))
 * // => [ '甲' ]
 */
export function evidenceCaveatsOf(front, record) {
    if (isarr(front?.caveats)) return front.caveats
    return isarr(record?.caveats) ? record.caveats : []
}

/**
 * 本規則之訊息產生函數(判定之說明、回饋之更正方向、新進修正說明、存量變更說明);caveat 原文取前 60 字
 *
 * @param {Object} rule 輸入 { subject, check }(evidenceRuleOf 之 config 或同形物件)
 * @returns {Object} 回傳 {
 *   violation(top, caveat)        不合格之說明:「證據等級「<top>」卻自承：<caveat>」,
 *   undetermined(caveat)          未能判定之說明:「caveat 涉及<subject>而未明確自承(須判讀)：<caveat>」,
 *   feedback()                    未能判定時附於回饋之更正方向:「請明確寫出是否做過<check>，或降低證據等級」,
 *   downgradeFix(from, to)        新進正規化之修正說明:「證據等級「<from>」與 caveat 自承無<check>矛盾 → 降為「<to>」」,
 *   downgradeChange(from, to, caveat) 存量修正之變更說明:「證據等級「<from>」→「<to>」（自承：<caveat>）」 }
 * @throws {Error} subject 或 check 非非空字串時拋出
 * @example
 * console.log(evidenceMessagesOf({ subject: '外部驗證', check: '外部驗證' }).feedback())
 * // => 請明確寫出是否做過外部驗證，或降低證據等級
 */
export function evidenceMessagesOf(rule) {
    const { subject, check } = wordsOf(rule, 'evidenceRule')
    const cut = (s) => String(s).slice(0, 60)
    return Object.freeze({
        violation: (top, caveat) => `證據等級「${top}」卻自承：${cut(caveat)}`,
        undetermined: (caveat) => `caveat 涉及${subject}而未明確自承(須判讀)：${cut(caveat)}`,
        feedback: () => `請明確寫出是否做過${check}，或降低證據等級`,
        downgradeFix: (from, to) => `證據等級「${from}」與 caveat 自承無${check}矛盾 → 降為「${to}」`,
        downgradeChange: (from, to, caveat) => `證據等級「${from}」→「${to}」（自承：${cut(caveat)}）`,
    })
}

/**
 * 是否為已編譯之規則物件(evidenceRuleOf 之產物,含停用者)
 *
 * @param {*} x 輸入任意值
 * @returns {Boolean} 回傳是否為已編譯之規則
 * @example
 * console.log(isEvidenceRule(evidenceRuleOf(null)), isEvidenceRule({ subject: '甲' }))
 * // => true false
 */
export function isEvidenceRule(x) {
    return isobj(x) && x[COMPILED] === true
}

/**
 * 停用之規則物件(未給規則):判定恆為不適用、不降級、回饋不附更正方向;形狀同已編譯之規則
 *
 * @type {Object}
 */
const DISABLED = Object.freeze({
    [COMPILED]: true,
    enabled: false,
    std: EVIDENCE_STD,
    subject: '',
    check: '',
    config: null,
    fp: '',
    states: () => false,
    admits: () => false,
    supports: () => false,
    caveatsOf: evidenceCaveatsOf,
    judge: () => result(EVIDENCE_STD, STATUS.NA),
    downgrade: () => null,
    messages: Object.freeze({ violation: () => '', undetermined: () => '', feedback: () => '', downgradeFix: () => '', downgradeChange: () => '' }),
    feedbackHintOf: () => '',
    toJSON: () => null,
})

/**
 * 由已驗證之正規形組出執行用之規則物件
 *
 * @param {Object} config 輸入正規形(已深凍結)
 * @param {Array} strictRes 輸入嚴式 RegExp 陣列
 * @param {Array} looseRes 輸入寬式 RegExp 陣列
 * @param {Array} [altRes=[]] 輸入另一種合格證據之 RegExp 陣列
 * @returns {Object} 回傳已編譯規則(見 evidenceRuleOf)
 */
function compile(config, strictRes, looseRes, altRes = []) {
    const messages = evidenceMessagesOf(config)
    const fold = (text) => toTw(String(text ?? '').normalize('NFKC'))
    const states = (text) => {
        const t = fold(text)
        return strictRes.some((re) => re.test(t))
    }
    const admits = (text) => {
        const t = fold(text)
        return looseRes.some((re) => re.test(t))
    }
    // 另一種合格證據:證據說明與 caveats 逐句比對 alt(未給 alt 恆 false)
    const supports = (texts) => altRes.length > 0 && (isarr(texts) ? texts : [texts])
        .some((x) => fold(x).split(CLAUSE_SPLIT).some((c) => c.trim() && altRes.some((re) => re.test(c))))
    // 第一個命中之 caveat(以命中與否為準,不以元素真假為準)
    const firstOf = (caveats, test) => {
        const i = caveats.findIndex((c) => test(c))
        return i < 0 ? { hit: false } : { hit: true, caveat: caveats[i] }
    }
    const judge = ({ level, levels, caveats, evidence } = {}) => {
        const top = isarr(levels) ? levels[0] : ''
        if (!top || level !== top) return result(EVIDENCE_STD, STATUS.NA)
        const cv = isarr(caveats) ? caveats : []
        // 肯定陳述了另一種合格證據 → 自承無 {check} 不構成矛盾
        if (supports(evidenceTexts(evidence, cv))) return result(EVIDENCE_STD, STATUS.PASS)
        const strict = firstOf(cv, states)
        if (strict.hit) return result(EVIDENCE_STD, STATUS.VIOLATION, messages.violation(top, strict.caveat))
        const loose = firstOf(cv, admits)
        if (loose.hit) return result(EVIDENCE_STD, STATUS.UNDETERMINED, messages.undetermined(loose.caveat))
        return result(EVIDENCE_STD, STATUS.PASS)
    }
    const downgrade = ({ level, levels, caveats, evidence } = {}) => {
        const lv = isarr(levels) ? levels : []
        if (!(lv.length > 1 && level === lv[0])) return null
        if (supports(evidenceTexts(evidence, caveats))) return null
        const strict = firstOf(isarr(caveats) ? caveats : [], states)
        if (!strict.hit) return null
        const [from, to] = lv
        return { from, to, caveat: strict.caveat, fix: messages.downgradeFix(from, to), change: messages.downgradeChange(from, to, strict.caveat) }
    }
    const feedbackHintOf = (r) => (r?.std === EVIDENCE_STD && r.status === STATUS.UNDETERMINED ? messages.feedback() : '')
    return Object.freeze({
        [COMPILED]: true,
        enabled: true,
        std: EVIDENCE_STD,
        subject: config.subject,
        check: config.check,
        config,
        fp: sha1(JSON.stringify(config)).slice(0, 16),
        states,
        admits,
        supports,
        caveatsOf: evidenceCaveatsOf,
        judge,
        downgrade,
        messages,
        feedbackHintOf,
        toJSON: () => config,
    })
}

/**
 * 驗證並編譯證據規則(vocab.evidenceRule)
 *
 * 可重複套用:evidenceRuleOf(evidenceRuleOf(x)) 為同一物件;evidenceRuleOf(evidenceRuleOf(x).config) 亦為同一物件;
 * evidenceRuleOf(JSON.parse(JSON.stringify(evidenceRuleOf(x)))) 之 fp 與原規則相同
 *
 * @param {Object|null} [rule] 輸入規則 { subject:String, check:String, strict:Array, loose:Array, alt?:Array }(前四鍵皆須給;樣式為 RegExp 或 { p, f? };
 *   loose 可為 [];alt 選用＝另一種合格證據之肯定陳述,見檔頭)；undefined／null 代表不啟用(停用之規則物件);亦可為本函數之回傳值(原樣回傳)
 * @param {String} [name='vocab.evidenceRule'] 輸入設定名(錯誤訊息用)
 * @returns {Object} 回傳已編譯規則(凍結;isEvidenceRule 為真):{
 *   enabled:Boolean(停用者 false), std:'SS11', subject, check(停用者為 ''),
 *   config:{ subject, check, strict:[{ p, f? }], loose:[{ p, f? }], alt?:[{ p, f? }] }|null(JSON 可序列化之正規形,已深凍結;alt 只在非空時帶;
 *       JSON.stringify 規則物件即得此值),
 *   fp:String(config 之 sha1 前 16 碼;停用者為 ''),
 *   states(text):Boolean      明確自承(嚴式;先 NFKC＋轉正體;停用者恆 false),
 *   admits(text):Boolean      涉及而未必明確(寬式;不含嚴式——判定先看嚴式;停用者恆 false),
 *   supports(texts):Boolean   肯定陳述了另一種合格證據(alt 逐句比對;未給 alt 或停用者恆 false),
 *   caveatsOf(front, record):Array   筆記之 caveats(front 優先,其次記錄),
 *   judge({ level, levels, caveats, evidence? }):Object   判定結果 { std, status, detail, field }——停用、非最高級(或 levels 無第一項)→ na;
 *       證據說明或 caveats 肯定陳述另一種合格證據(alt)→ pass;嚴式命中 → violation(detail 列第一個命中者);只命中寬式 → undetermined;否則 pass,
 *   downgrade({ level, levels, caveats, evidence? }):Object|null   啟用、等級有兩級以上、為最高級、無另一種合格證據且嚴式命中 →
 *       { from:最高級, to:次高級, caveat:第一個嚴式命中者, fix:新進修正說明, change:存量變更說明 };否則 null,
 *   messages:見 evidenceMessagesOf(停用者各函數回 ''),
 *   feedbackHintOf(r):String   r 為本規則之未能判定 → 附於回饋之更正方向;否則(含停用)'' }
 * @throws {Error} 非物件、含不認得之鍵(附可用鍵)、subject／check 非非空字串、strict 非非空樣式陣列、loose 非樣式陣列、
 *   任一樣式形狀或語法不合、帶 g／y 旗標或命中空字串時拋出
 * @example
 * let off = evidenceRuleOf(null)
 * console.log(off.enabled, off.judge({ level: '高', levels: ['高', '中'], caveats: ['未經外部驗證'] }).status, off.fp)
 * // => false na
 *
 * let rule = evidenceRuleOf({ subject: '外部驗證', check: '外部驗證', strict: [{ p: '(?:未經|沒有|無)外部驗證' }], loose: [{ p: '(?:未|無)[^；;。]{0,10}外部驗證' }] })
 * let r = rule.judge({ level: '高', levels: ['高', '中', '低'], caveats: ['未說明是否經外部驗證'] })
 * console.log(r.status, r.detail)
 * // => undetermined caveat 涉及外部驗證而未明確自承(須判讀)：未說明是否經外部驗證
 *
 * console.log(rule.downgrade({ level: '高', levels: ['高', '中', '低'], caveats: ['未經外部驗證'] }).fix)
 * // => 證據等級「高」與 caveat 自承無外部驗證矛盾 → 降為「中」
 */
export function evidenceRuleOf(rule, name = 'vocab.evidenceRule') {

    //check
    if (rule === undefined || rule === null) {
        return DISABLED
    }
    if (isEvidenceRule(rule)) {
        return rule
    }
    if (!isobj(rule)) {
        throw new Error(`${name} 須為物件 { ${EVIDENCE_RULE_KEYS.map((k) => (k === 'alt' ? 'alt?' : k)).join(', ')} } 或 null（不啟用）`)
    }
    const cached = CACHE.get(rule)
    if (cached) {
        return cached
    }
    checkKeys(rule, EVIDENCE_RULE_KEYS, name)

    const { subject, check } = wordsOf(rule, name)
    const strict = patternsOf(rule.strict, `${name}.strict`, true)
    const loose = patternsOf(rule.loose, `${name}.loose`, false)
    // alt 選用:未給(undefined／null)＝無;給了須為樣式陣列。正規形只在非空時帶 alt(未給者之正規形與指紋不變)
    const alt = rule.alt === undefined || rule.alt === null ? { config: [], res: [] } : patternsOf(rule.alt, `${name}.alt`, false)
    const config = deepFreeze({ subject, check, strict: strict.config, loose: loose.config, ...(alt.config.length ? { alt: alt.config } : {}) })
    const compiled = compile(config, strict.res, loose.res, alt.res)
    CACHE.set(config, compiled)
    return compiled
}

/**
 * 是否自承無最高證據等級之要件(且無另一種合格證據):caveats 有一則命中嚴式或寬式(states／admits),而證據說明與 caveats 皆無一句肯定陳述
 *   另一種合格證據(alt)。與判定之關係:同一 caveats 與證據說明下,最高級之 judge 判不合格或未能判定 ⟺ 本函數為真(不看等級)——下游據以
 *   判讀出處之證據強度時與 SS11 同一判準,不另寫一份
 *
 * @param {Object} [o={}] 輸入 { caveats:Array(筆記之 caveats;讀法同 evidenceCaveatsOf), evidence?:String|Array(證據說明;md 取 evidenceNoteOf、
 *   新進項目取 evidence_note) };非物件視為 {}
 * @param {Object|null} [rule] 輸入證據規則(evidenceRuleOf 之產物或其可編譯之設定;未給或 null 為停用)
 * @returns {Boolean} 回傳是否自承無要件;規則未給或停用、caveats 非陣列或為空 → false
 * @throws {Error} rule 為不合規格之設定時拋出(同 evidenceRuleOf;不靜默當成停用)
 * @example
 * let rule = evidenceRuleOf({ subject: '外部驗證', check: '外部驗證', strict: [{ p: '(?:未經|沒有|無)外部驗證' }], loose: [{ p: '(?:未|無)[^；;。]{0,10}外部驗證' }] })
 * console.log(noTopEvidenceOf({ caveats: ['未說明是否經外部驗證'] }, rule), noTopEvidenceOf({ caveats: ['觀測期間短'] }, rule), noTopEvidenceOf({ caveats: ['未經外部驗證'] }, null))
 * // => true false false
 *
 * let alt = evidenceRuleOf({ ...rule.config, alt: [{ p: '^(?!.*(?:未|無)).*獨立重現' }] })
 * console.log(noTopEvidenceOf({ caveats: ['未經外部驗證'], evidence: '已獲兩個團隊獨立重現' }, alt))
 * // => false
 */
export function noTopEvidenceOf(o = {}, rule) {
    const r = evidenceRuleOf(rule)
    const caveats = o?.caveats
    if (!r.enabled || !isarr(caveats) || caveats.length === 0) return false
    return !r.supports(evidenceTexts(o.evidence, caveats)) && caveats.some((c) => r.states(c) || r.admits(c))
}

export default { EVIDENCE_STD, EVIDENCE_RULE_KEYS, EVIDENCE_RULE_DEFAULT, evidenceCaveatsOf, evidenceMessagesOf, isEvidenceRule, evidenceRuleOf, noTopEvidenceOf }
