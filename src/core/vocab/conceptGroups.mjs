// conceptGroups.mjs — 概念詞彙表、概念標籤清理建議與可疑標籤判定(摘要段用)
//
// 【概念鍵一律走 normalizeConcept】標籤只要對不起來,同一概念就會分裂成多個詞彙;
//   詞彙表依鍵計數、依最常見之寫法顯示,摘要時餵回 prompt 令標籤收斂成共用詞彙。
// 【摘要段只計數、不改資料】可疑標籤(tagSuspects)於摘要時只計數並記日誌;存量之清理建議(suggestConceptRenames)
//   供安裝方審閱後貼入 vocab.conceptRenames／conceptAliases——二者共用同一判準(annotationOf、splitTopLevel)。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import ispint from 'wsemi/src/ispint.mjs'
import cint from 'wsemi/src/cint.mjs'
import { normalizeConcept } from '../capturePackage.mjs'

/**
 * 既有概念詞彙表（依使用篇數降冪），餵回摘要 prompt 令標籤收斂成共用詞彙
 *
 * 【預設只回名稱】回「名稱(篇數)」並餵回摘要 prompt 時，模型會把「(743)」照抄進標籤，
 *   產生「資料結構(743)」這類分身概念；篇數之訊號改由排序表達。
 *
 * @param {Object} notes 輸入筆記集合，需具 select 方法
 * @param {Integer} [limit=60] 輸入回傳最多幾條，非正整數則用預設 60
 * @param {Object} [opt={}] 輸入設定物件，非物件視為{}
 * @param {Boolean} [opt.counts=false] 輸入是否附使用篇數(維運顯示用；勿餵回 prompt)
 * @returns {Promise} 回傳 Promise，resolve 回傳字串陣列(依使用篇數降冪)，格式為 '<顯示寫法>'；opt.counts 為 true 時為 '<顯示寫法>(<使用篇數>)'
 * @throws {Error} notes 缺 select 方法時拋出
 * @example
 * const notes = { select: async () => [{ concepts: ['太陽黑子', '日冕'] }, { concepts: ['太陽黑子'] }, { concepts: ['彗星'] }] }
 * console.log(await conceptVocabulary(notes, 2))
 * // => [ '太陽黑子', '日冕' ]
 *
 * console.log(await conceptVocabulary(notes, 2, { counts: true }))
 * // => [ '太陽黑子(2)', '日冕(1)' ]
 */
export async function conceptVocabulary(notes, limit = 60, opt = {}) {

    //check
    if (!isfun(notes?.select)) {
        throw new Error('conceptVocabulary 需要 notes 集合（具 select 方法）')
    }
    if (!ispint(limit)) {
        limit = 60
    }
    limit = cint(limit)
    if (!isobj(opt)) {
        opt = {}
    }

    const all = await notes.select()
    const count = new Map()
    const forms = new Map() // key → Map(原始寫法 → 次數)
    for (const n of all) {
        const seenKeys = new Set() // 同一篇筆記之多個標籤折疊成同一鍵時只計一次(計的是「使用篇數」)
        for (const c of n.concepts || []) {
            const key = normalizeConcept(c)
            if (!key || seenKeys.has(key)) continue
            seenKeys.add(key)
            count.set(key, (count.get(key) || 0) + 1)
            if (!forms.has(key)) forms.set(key, new Map())
            const f = String(c).trim()
            forms.get(key).set(f, (forms.get(key).get(f) || 0) + 1)
        }
    }
    // display 取「最常見的原始寫法」而非首見：字形折疊後同鍵可能混著繁簡兩種寫法，
    // 首見若是簡體，詞彙表回饋 prompt 反而會鼓勵模型續用簡體——取多數寫法才會收斂
    const displayOf = (key) => [...forms.get(key).entries()].sort((a, b) => b[1] - a[1])[0][0]
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
        .map(([k, v]) => (opt.counts === true ? `${displayOf(k)}(${v})` : displayOf(k)))
}

/**
 * 概念標籤之清理建議(維運用;不自動改任何資料):供安裝方審閱後貼入 vocab.conceptRenames／conceptAliases
 *
 * 【為何不自動】「名稱(743)」之數字與年份、階數不可辨(奧運(2008)、多項式(2)／多項式(3)),自動去尾會誤併;
 *   折疊(tw→cn)之同鍵裡亦有繁體語意不同者(曆年／歷年、回復率／回覆率)。輸出原字形(改名以折疊前之原字形精確比對)。
 *
 * 另列兩類只供人審之候選:
 *   annotated——「名稱(說明)」之括號說明、英文對照或「是否在清單中」之註記(分群鍵保留括號內容,與「名稱」分成兩鍵);
 *     括號內只有數字／分隔符者(多項式(2)、Beta(1,1)、f(0)、(2008)、(743))不列;限定語(如「平均(加權)」)可能是不同概念,故不併入 renames;
 *   multi——括號外以「,」「，」「、」「;」「；」串接多個概念之單一標籤;改名對照只能一對一,拆分屬使用方之資料整理。
 *
 * @param {Array} notes 輸入筆記陣列，非陣列視為空
 * @param {Object} [opt={}] 輸入設定物件
 * @param {Integer} [opt.minSuffix=10] 輸入「名稱(N)」之 N 至少多少才列入(篇數照抄多為兩位數以上)
 * @returns {Object} 回傳 { renames:{ 原寫法: 基名 }, renameDetail:Array({ form, base, notes, yearLike }), foldGroups:Array({ key, forms:Array({ form, notes }) }),
 *   annotated:Array({ form, base, inner, notes, baseUsed }), multi:Array({ form, parts, notes }) }；yearLike＝N 看似年份(1000～2100,如「奧運(2008)」,多為誤報)
 * @example
 * const notes = [{ concepts: ['資料結構'] }, { concepts: ['資料結構(743)'] }, { concepts: ['k-means(3)'] }]
 * console.log(suggestConceptRenames(notes).renames)
 * // => { '資料結構(743)': '資料結構' }
 */
export function suggestConceptRenames(notes, opt = {}) {
    if (!isarr(notes)) notes = []
    if (!isobj(opt)) opt = {}
    const minSuffix = Number.isInteger(opt.minSuffix) ? opt.minSuffix : 10
    const byKey = new Map() // key → Map(原字形 → 篇數)
    for (const n of notes) {
        const seen = new Set()
        for (const c of n?.concepts || []) {
            const form = String(c).trim()
            const key = normalizeConcept(form)
            if (!key || seen.has(`${key}|${form}`)) continue
            seen.add(`${key}|${form}`)
            if (!byKey.has(key)) byKey.set(key, new Map())
            byKey.get(key).set(form, (byKey.get(key).get(form) || 0) + 1)
        }
    }
    const renames = {}
    const renameDetail = []
    for (const forms of byKey.values()) {
        for (const [form, cnt] of forms) {
            const m = form.normalize('NFKC').match(/^(.+?)\s*\((\d+)\)$/)
            if (!m || Number(m[2]) < minSuffix) continue
            const baseForms = byKey.get(normalizeConcept(m[1]))
            if (!baseForms) continue
            const base = [...baseForms.entries()].sort((a, b) => b[1] - a[1])[0][0]
            renames[form] = base
            const n = Number(m[2])
            renameDetail.push({ form, base, notes: cnt, yearLike: n >= 1000 && n <= 2100 })
        }
    }
    const foldGroups = [...byKey.entries()]
        .filter(([, forms]) => new Set([...forms.keys()].map((f) => f.normalize('NFKC').replace(/\s+/g, '').toLowerCase())).size > 1)
        .map(([key, forms]) => ({ key, forms: [...forms.entries()].map(([form, n]) => ({ form, notes: n })).sort((a, b) => b.notes - a.notes) }))
        .sort((a, b) => b.forms.reduce((s, x) => s + x.notes, 0) - a.forms.reduce((s, x) => s + x.notes, 0))
    const annotated = []
    const multi = []
    for (const forms of byKey.values()) {
        for (const [form, cnt] of forms) {
            const a = annotationOf(form)
            if (a) annotated.push({ form, base: a.base, inner: a.inner, notes: cnt, baseUsed: byKey.has(normalizeConcept(a.base)) })
            const parts = splitTopLevel(form.normalize('NFKC'))
            if (parts.length >= 2) multi.push({ form, parts, notes: cnt })
        }
    }
    annotated.sort((a, b) => Number(b.baseUsed) - Number(a.baseUsed) || b.notes - a.notes || a.form.localeCompare(b.form))
    multi.sort((a, b) => b.notes - a.notes || a.form.localeCompare(b.form))
    return { renames, renameDetail, foldGroups, annotated, multi }
}

/**
 * 標籤之末尾括號說明:「名稱(說明)」且括號內不是只有數字／分隔符(排除 多項式(2)、Beta(1,1)、f(0)、(2008)、(743))
 *
 * @param {String} tag 輸入標籤原字形
 * @returns {Object|null} 回傳 { base, inner } 或 null
 */
function annotationOf(tag) {
    const m = String(tag || '').normalize('NFKC').trim().match(/^(.+?)\s*\(([^()]+)\)$/)
    if (!m || /^[\p{N}\s,.\-+:/·]+$/u.test(m[2])) return null
    return { base: m[1].trim(), inner: m[2].trim() }
}

/**
 * 可疑之概念標籤(括號說明／英文對照,或一個標籤擠多個概念;摘要段只計數、不改資料——判準同 suggestConceptRenames 之 annotated／multi)
 *
 * @param {Array} tags 輸入標籤陣列，非陣列視為空
 * @returns {Array} 回傳 [{ tag, kind:'annotated'|'multi' }]
 * @example
 * console.log(tagSuspects(['Beta(1,1)', '資料清理(未載入)', '甲, 乙', '多項式(2)']).map((x) => x.kind))
 * // => [ 'annotated', 'multi' ]
 */
export function tagSuspects(tags) {
    const out = []
    for (const t of isarr(tags) ? tags : []) {
        if (annotationOf(t)) out.push({ tag: t, kind: 'annotated' })
        else if (splitTopLevel(String(t || '').normalize('NFKC')).length >= 2) out.push({ tag: t, kind: 'multi' })
    }
    return out
}

/**
 * 以括號外之「,」「、」「;」切分(括號／引號內不切,如 Beta(1,1));NFKC 後全形之「，」「；」已轉為半形
 *
 * @param {String} s 輸入字串
 * @returns {Array} 回傳非空片段陣列(去頭尾空白)
 */
function splitTopLevel(s) {
    const OPEN = '([「『【'
    const CLOSE = ')]」』】'
    const parts = []
    let depth = 0
    let cur = ''
    for (const ch of String(s || '')) {
        if (OPEN.includes(ch)) depth++
        else if (CLOSE.includes(ch)) depth = Math.max(0, depth - 1)
        if (depth === 0 && /[,、;]/.test(ch)) {
            parts.push(cur)
            cur = ''
            continue
        }
        cur += ch
    }
    parts.push(cur)
    return parts.map((x) => x.trim()).filter(Boolean)
}

export default { conceptVocabulary, suggestConceptRenames, tagSuspects }
