// taxonomy.mjs — 分類法之版本、狀態與差異(分類得要能擴充;分類器之調整與擴充要能觸發既有知識之調整)
//
// 【版本】分類法＝categories／claimTypes／evidenceLevels／fallbackCategory 與變更宣告(categoryRenames、categoryRetire、categoryHints、
//   claimTypeRenames、evidenceLevelRenames)之排序後序列化;版本＝其雜湊。只含清單與對照表:guide 措辭變動不自動重標
//   (改由維運之 requeue 明示排入);清單只換順序不算變動。
// 【狀態】<state 目錄>/TAXONOMY_STATE_FILE:已套用之清單(applied)、版本、工作(jobs)、未宣告之移除(pending)、md 待修補(mdStale)、歷史(history)。
//   真理檔:原子寫;檔案存在而解析失敗即拋錯(不得當作首次而重建——工作進度會靜默丟失)。檔名只定義於此(子階段與維運同讀)。
// 【差異 → 工作】類別改名、內容類型改名、證據等級改名 → 機械(rename);新增類別 → AI 重判(rejudge/add:落點類別之筆記
//   ＋categoryHints 相符者,另 categoryRaw 恰為該類別者直接機械改,零 AI);退役類別 → AI 重判(rejudge/retire:該類筆記);
//   自清單移除而未宣告去向者 → 守門(pending,每輪 WARN 至宣告或恢復為止,資料不動)。首次記錄只建狀態、不重判既有筆記。
// 【連續改版】工作於處理時依「現行」分類法重新定界(resolveJob):改名之目標已不在清單 → 循現行改名對照前進;類別目標已退役／
//   無對照 → 轉為退役重判;新增類別又被移除 → 作廢。新版到來時未完工作保留。
// 【可採類別】(retagTargetOf)新增類別之工作,非落點之筆記只在「原類別／新類別」間判:新增 Y 不改變兩個既有類別之相對適合度;
//   只因含關鍵詞而被重判者若被平移,同型而不含關鍵詞者卻不動——同一語意兩種處置。落點類別之筆記(新類別可能終於有合適者)、
//   原類別不在清單者、退役與維運排入之重判:清單內任一類別皆可。

import fs from 'fs'
import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { sha1, readJson, writeFileAtomic } from '../core/capturePackage.mjs'

/** 狀態檔格式版本 */
export const TAXONOMY_STATE_VERSION = 1

/** 狀態檔之檔名(位於 state 目錄;單一來源:重標子階段與維運之狀態預覽／排入重判同讀) */
export const TAXONOMY_STATE_FILE = 'taxonomy.json'

/**
 * 機械改名之欄位對照:工作欄位 → { 筆記記錄欄位, frontmatter 鍵, 品質章行首(無則只改 frontmatter), 顯示名, 去向之宣告處(守門訊息用) }
 */
export const RENAME_FIELDS = {
    category: { record: 'category', front: 'category', line: '', label: '類別', decl: 'vocab.categoryRenames 或 categoryRetire' },
    claimType: { record: 'claimType', front: 'claim_type', line: '內容類型：', label: '內容類型', decl: 'vocab.claimTypeRenames' },
    evidenceLevel: { record: 'evidenceLevel', front: 'evidence_level', line: '證據等級：', label: '證據等級', decl: 'vocab.evidenceLevelRenames' },
}

/** 重判工作之原因 → 顯示名 */
export const REJUDGE_REASON_LABELS = Object.freeze({ add: '新增類別', retire: '退役類別', requeue: '重判類別' })

/**
 * 重標工作之名稱(單一來源:重標子階段之日誌、維運之狀態預覽同用)——改名「<欄位>改名「舊」→「新」」、重判「<原因>「類別」」
 *
 * @param {Object} j 輸入工作 { kind:'rename'|'rejudge', field?, from?, to?, reason?, category? }
 * @returns {String} 回傳名稱
 * @example
 * console.log(retagJobLabelOf({ kind: 'rename', field: 'claimType', from: '甲', to: '乙' }))
 * // => 內容類型改名「甲」→「乙」
 */
export function retagJobLabelOf(j) {
    return j?.kind === 'rename'
        ? `${RENAME_FIELDS[j.field]?.label || j?.field}改名「${j.from}」→「${j.to}」`
        : `${REJUDGE_REASON_LABELS[j?.reason] || j?.reason}「${j?.category}」`
}

const sortedObj = (o) => Object.fromEntries(Object.entries(isobj(o) ? o : {}).sort(([a], [b]) => a.localeCompare(b)))
const sortedArr = (a) => [...(isarr(a) ? a : [])].map(String).sort((x, y) => x.localeCompare(y))

/**
 * 由詞彙表取分類法之正準形(排序;版本雜湊與差異之輸入)
 *
 * @param {Object} vocab 輸入詞彙表(resolveSummarizeVocab 之產出)
 * @returns {Object} 回傳 { categories, claimTypes, evidenceLevels, fallbackCategory, categoryRenames, categoryRetire, categoryHints, claimTypeRenames, evidenceLevelRenames }
 * @example
 * let a = taxonomyOf({ categories: ['恆星', '行星', '其他'], fallbackCategory: '其他' })
 * let b = taxonomyOf({ categories: ['其他', '行星', '恆星'], fallbackCategory: '其他' })
 * console.log(JSON.stringify(a) === JSON.stringify(b), a.categories.length, a.fallbackCategory)
 * // => true 3 其他
 */
export function taxonomyOf(vocab) {
    const v = isobj(vocab) ? vocab : {}
    return {
        categories: sortedArr(v.categories),
        claimTypes: sortedArr(v.claimTypes),
        evidenceLevels: sortedArr(v.evidenceLevels),
        fallbackCategory: String(v.fallbackCategory || ''),
        categoryRenames: sortedObj(v.categoryRenames),
        categoryRetire: sortedArr(v.categoryRetire),
        categoryHints: Object.fromEntries(Object.entries(sortedObj(v.categoryHints)).map(([k, kws]) => [k, sortedArr(kws)])),
        claimTypeRenames: sortedObj(v.claimTypeRenames),
        evidenceLevelRenames: sortedObj(v.evidenceLevelRenames),
    }
}

/**
 * 分類法版本(正準形之雜湊前 12 碼)
 *
 * @param {Object} tax 輸入 taxonomyOf 之產出
 * @returns {String} 回傳版本字串
 * @example
 * let v1 = taxonomyVersion(taxonomyOf({ categories: ['恆星', '行星', '其他'], fallbackCategory: '其他' }))
 * let v2 = taxonomyVersion(taxonomyOf({ categories: ['其他', '行星', '恆星'], fallbackCategory: '其他' }))
 * let v3 = taxonomyVersion(taxonomyOf({ categories: ['恆星', '行星', '星系', '其他'], fallbackCategory: '其他' }))
 * console.log(v1.length, v1 === v2, v1 === v3)
 * // => 12 true false
 */
export function taxonomyVersion(tax) {
    return sha1(JSON.stringify(tax)).slice(0, 12)
}

/** 工作識別碼(同一事件之工作只排一次) */
const jobIdOf = (j) => (j.kind === 'rename' ? `rename:${j.field}:${j.from}` : `rejudge:${j.reason}:${j.category}`)

/**
 * 排入重判工作(就地修改狀態並記沿革;同一 id 已在則不重複)——維運之 requeue(ops/taxonomyOps)與重標待判之重試
 *   (stages/retagStage;退役類別逾次未成者)共用,工作 id 只由 jobIdOf 產生
 *
 * @param {Object} state 輸入分類法狀態(syncTaxonomy 之產物;jobs、history 就地增)
 * @param {String} reason 輸入重判原因('requeue'|'retire'|'add')
 * @param {String} category 輸入類別
 * @param {String} nowIso 輸入現在時刻
 * @param {String} [event=reason] 輸入沿革事件名
 * @returns {Object} 回傳 { added:Boolean, id }
 * @example
 * let state = { version: 'v1', jobs: [], history: [] }
 * let nowIso = new Date().toISOString()
 * console.log(queueRejudge(state, 'requeue', '恆星', nowIso), queueRejudge(state, 'requeue', '恆星', nowIso))
 * // => { added: true, id: 'rejudge:requeue:恆星' } { added: false, id: 'rejudge:requeue:恆星' }
 * console.log(state.jobs.length, state.history.map((h) => [h.event, h.job]))
 * // => 1 [ [ 'requeue', 'rejudge:requeue:恆星' ] ]
 */
export function queueRejudge(state, reason, category, nowIso, event = reason) {
    const job = { kind: 'rejudge', reason, category }
    const id = jobIdOf(job)
    if (state.jobs.some((j) => j.id === id)) return { added: false, id }
    state.jobs.push({ ...job, id, createdAt: nowIso, judged: [], fails: {} })
    state.history.push({ at: nowIso, version: state.version, event, job: id })
    return { added: true, id }
}

/**
 * 移除之名稱 → 工作或守門(依現行宣告)
 *
 * @param {String} field 輸入欄位('category'|'claimType'|'evidenceLevel')
 * @param {String} name 輸入已自清單移除之名稱
 * @param {Object} cur 輸入現行分類法(taxonomyOf)
 * @returns {Object|null} 回傳工作物件；未宣告去向回 null
 */
function jobForRemoved(field, name, cur) {
    const renames = { category: cur.categoryRenames, claimType: cur.claimTypeRenames, evidenceLevel: cur.evidenceLevelRenames }[field]
    if (Object.hasOwn(renames, name)) return { kind: 'rename', field, from: name, to: renames[name] }
    if (field === 'category' && cur.categoryRetire.includes(name)) return { kind: 'rejudge', reason: 'retire', category: name }
    return null
}

/**
 * 已套用清單 vs 現行分類法 → 新工作與未宣告之移除
 *
 * @param {Object} applied 輸入已套用之清單 { categories, claimTypes, evidenceLevels }
 * @param {Object} cur 輸入現行分類法(taxonomyOf)
 * @returns {Object} 回傳 { jobs:Array, pending:Array<{field,name}> }
 * @example
 * let applied = { categories: ['恆星', '彗星', '其他'], claimTypes: [], evidenceLevels: [] }
 * let cur = taxonomyOf({ categories: ['恆星', '小天體', '星系', '其他'], fallbackCategory: '其他', categoryRenames: { 彗星: '小天體' } })
 * let d = diffTaxonomy(applied, cur)
 * console.log(d.jobs.map(retagJobLabelOf), d.pending)
 * // => [ '類別改名「彗星」→「小天體」', '新增類別「星系」' ] []
 * console.log(diffTaxonomy(applied, taxonomyOf({ categories: ['恆星', '其他'], fallbackCategory: '其他' })).pending)
 * // => [ { field: 'category', name: '彗星' } ]
 */
export function diffTaxonomy(applied, cur) {
    const jobs = []
    const pending = []
    const lists = { category: 'categories', claimType: 'claimTypes', evidenceLevel: 'evidenceLevels' }
    for (const [field, key] of Object.entries(lists)) {
        const was = sortedArr(applied?.[key])
        for (const name of was.filter((x) => !cur[key].includes(x))) {
            const j = jobForRemoved(field, name, cur)
            if (j) jobs.push(j)
            else pending.push({ field, name })
        }
    }
    // 新增類別:改名之目標(舊名在已套用清單者)不算新增——改名不是新類別,否則會白白觸發落點類別之全量 AI 重判
    const was = sortedArr(applied?.categories)
    const renamedInto = new Set(jobs.filter((j) => j.kind === 'rename' && j.field === 'category').map((j) => resolveJob(j, cur)?.to).filter(Boolean))
    for (const c of cur.categories.filter((x) => !was.includes(x) && !renamedInto.has(x))) {
        jobs.push({ kind: 'rejudge', reason: 'add', category: c })
    }
    return { jobs, pending }
}

/**
 * 工作依現行分類法重新定界(檔頭【連續改版】)
 *
 * @param {Object} job 輸入工作
 * @param {Object} cur 輸入現行分類法(taxonomyOf)
 * @returns {Object|null} 回傳現行有效之工作(可能已改寫目標或種類)；作廢回 null
 * @example
 * let cur = taxonomyOf({ categories: ['恆星', '其他'], fallbackCategory: '其他' })
 * let r = resolveJob({ kind: 'rename', field: 'category', from: '彗星', to: '小天體' }, cur)
 * console.log(r.kind, r.reason, r.category)
 * // => rejudge retire 彗星
 * console.log(resolveJob({ kind: 'rejudge', reason: 'add', category: '星系' }, cur))
 * // => null
 */
export function resolveJob(job, cur) {
    if (job.kind === 'rename') {
        const lists = { category: cur.categories, claimType: cur.claimTypes, evidenceLevel: cur.evidenceLevels }
        // 舊名又放回清單:不再搬離(已搬者留在新名,由安裝方決定是否另行改名)
        if (lists[job.field].includes(job.from)) return null
        const renames = { category: cur.categoryRenames, claimType: cur.claimTypeRenames, evidenceLevel: cur.evidenceLevelRenames }[job.field]
        let to = job.to
        const seen = new Set([job.from])
        while (!lists[job.field].includes(to) && Object.hasOwn(renames, to) && !seen.has(to)) {
            seen.add(to)
            to = renames[to]
        }
        if (lists[job.field].includes(to)) return to === job.to ? job : { ...job, to }
        // 目標已不在清單且無對照:類別轉為退役重判(舊類別之筆記依現行清單由 AI 重判);其餘欄位作廢(由守門揭露)
        return job.field === 'category' ? { ...job, kind: 'rejudge', reason: 'retire', category: job.from } : null
    }
    if (job.reason === 'add') return cur.categories.includes(job.category) ? job : null
    if (job.reason === 'retire') return cur.categories.includes(job.category) ? null : job // 退役類別又放回清單:不必重判
    return job // requeue:恆有效
}

/**
 * 建立分類法狀態檔之讀寫器
 *
 * @param {String} file 輸入狀態檔路徑(<state 目錄>/TAXONOMY_STATE_FILE)
 * @returns {Object} 回傳 { file, load():Object|null, save(state) }
 * @throws {Error} file 非有效字串時拋出
 * @example
 * console.log(createTaxonomyStore('./tmp/none/taxonomy.json').load())
 * // => null
 * let store = createTaxonomyStore('./tmp/taxonomy.json')
 * store.save({ version: 'v1', jobs: [] })
 * let s = store.load()
 * console.log(s.version, s.stateVersion, s.pending, s.mdStale)
 * // => v1 1 [] []
 */
export function createTaxonomyStore(file) {
    if (!isestr(file)) throw new Error('createTaxonomyStore 需要狀態檔路徑')
    return {
        file,
        /**
         * 讀狀態;檔案不存在回 null(首次);存在而解析失敗或格式版本不符即拋錯(真理檔,見檔頭)
         * @returns {Object|null} 回傳狀態物件或 null
         */
        load: () => {
            if (!fs.existsSync(file)) return null
            const s = readJson(file, undefined)
            if (!isobj(s) || s.stateVersion !== TAXONOMY_STATE_VERSION) {
                throw new Error(`分類法狀態檔無法解析或格式版本不符（${file}）：請自備份還原或刪除後重新記錄（刪除即以現行分類法為已套用，未完工作作廢）`)
            }
            return { jobs: [], pending: [], mdStale: [], history: [], ...s }
        },
        /**
         * 原子寫入狀態
         * @param {Object} s 輸入狀態物件
         */
        save: (s) => {
            writeFileAtomic(file, JSON.stringify({ ...s, stateVersion: TAXONOMY_STATE_VERSION }, null, 2))
        },
    }
}

/**
 * 分類法狀態之唯讀快照(巡檢、近況總覽用;不同步、不讀筆記、不拋錯——狀態檔之格式只在本檔解讀)
 *
 * @param {String} stateDir 輸入 state 目錄(狀態檔為其下之 TAXONOMY_STATE_FILE)
 * @returns {Object|null} 回傳 { version, jobs:待處理之重標工作數, guards:未宣告移除之守門數, mdStale:md 待修補數 };狀態檔不存在、
 *   無法解析或格式版本不符回 null
 * @example
 * createTaxonomyStore('./tmp/taxonomy.json').save({ version: 'v1', jobs: [{ id: 'j1' }] })
 * console.log(taxonomySnapshotOf('./tmp'), taxonomySnapshotOf('./tmp/none'))
 * // => { version: 'v1', jobs: 1, guards: 0, mdStale: 0 } null
 */
export function taxonomySnapshotOf(stateDir) {
    try {
        const s = createTaxonomyStore(path.join(String(stateDir || ''), TAXONOMY_STATE_FILE)).load()
        if (!s) return null
        return { version: String(s.version || ''), jobs: isarr(s.jobs) ? s.jobs.length : 0, guards: isarr(s.pending) ? s.pending.length : 0, mdStale: isarr(s.mdStale) ? s.mdStale.length : 0 }
    }
    catch {
        return null
    }
}

/**
 * 依現行詞彙表同步狀態:首次只記錄;版本變動即差異轉工作;未宣告之移除逐輪重驗(已宣告轉工作、已恢復撤銷);工作重新定界
 *
 * @param {Object|null} state 輸入既有狀態(load 之產出；null＝首次)
 * @param {Object} vocab 輸入現行詞彙表
 * @param {String} nowIso 輸入現在時刻
 * @returns {Object} 回傳 { state, initialized:Boolean, changed:Boolean, added:Array, voided:Array, pending:Array }
 * @example
 * let nowIso = new Date().toISOString()
 * let first = syncTaxonomy(null, { categories: ['恆星', '其他'], fallbackCategory: '其他' }, nowIso)
 * console.log(first.initialized, first.state.jobs.length)
 * // => true 0
 * let next = syncTaxonomy(first.state, { categories: ['恆星', '星系', '其他'], fallbackCategory: '其他' }, nowIso)
 * console.log(next.initialized, next.changed, next.added.map(retagJobLabelOf))
 * // => false true [ '新增類別「星系」' ]
 * console.log(syncTaxonomy(next.state, { categories: ['其他', '星系', '恆星'], fallbackCategory: '其他' }, nowIso).changed)
 * // => false
 */
export function syncTaxonomy(state, vocab, nowIso) {
    const cur = taxonomyOf(vocab)
    const version = taxonomyVersion(cur)
    const applied = { categories: cur.categories, claimTypes: cur.claimTypes, evidenceLevels: cur.evidenceLevels }
    if (!state) {
        return {
            state: { version, applied, jobs: [], pending: [], mdStale: [], history: [{ at: nowIso, version, event: 'init' }] },
            initialized: true, changed: true, added: [], voided: [], pending: [],
        }
    }
    const s = { ...state, jobs: [...(state.jobs || [])], pending: [...(state.pending || [])], history: [...(state.history || [])] }
    const added = []
    const addJob = (j) => {
        const id = jobIdOf(j)
        if (s.jobs.some((x) => x.id === id)) return
        const job = { ...j, id, createdAt: nowIso, judged: [], fails: {} }
        s.jobs.push(job)
        added.push(job)
    }
    const versionChanged = s.version !== version
    if (versionChanged) {
        const d = diffTaxonomy(s.applied, cur)
        for (const j of d.jobs) addJob(j)
        for (const p of d.pending) if (!s.pending.some((x) => x.field === p.field && x.name === p.name)) s.pending.push(p)
        s.history.push({ at: nowIso, from: s.version, version, event: 'change', jobs: d.jobs.length, pending: d.pending.length })
        s.version = version
        s.applied = applied
    }
    // 未宣告之移除:已恢復 → 撤銷;已宣告 → 轉工作;其餘留著(每輪守門)
    const lists = { category: cur.categories, claimType: cur.claimTypes, evidenceLevel: cur.evidenceLevels }
    s.pending = s.pending.filter((p) => {
        if (lists[p.field].includes(p.name)) return false
        const j = jobForRemoved(p.field, p.name, cur)
        if (j) {
            addJob(j)
            return false
        }
        return true
    })
    // 工作重新定界(連續改版)
    const voided = []
    s.jobs = s.jobs.flatMap((j) => {
        const r = resolveJob(j, cur)
        if (!r) {
            voided.push(j)
            return []
        }
        if (r !== j) {
            const id = jobIdOf(r)
            if (s.jobs.some((x) => x !== j && x.id === id)) {
                voided.push(j)
                return []
            }
            return [{ ...r, id }]
        }
        return [j]
    })
    return { state: s, initialized: false, changed: versionChanged || added.length > 0 || voided.length > 0, added, voided, pending: s.pending }
}

/**
 * 筆記是否落在新增類別之重判範圍:落點類別、或標題／概念／一句話重點含 categoryHints 之關鍵詞
 *
 * @param {Object} note 輸入筆記記錄
 * @param {String} category 輸入新增之類別
 * @param {Object} cur 輸入現行分類法(taxonomyOf)
 * @returns {Boolean} 回傳是否在範圍內
 * @example
 * let cur = taxonomyOf({ categories: ['恆星', '星系', '其他'], fallbackCategory: '其他', categoryHints: { 星系: ['星系', '銀河'] } })
 * console.log(inAddScope({ category: '其他', title: '未歸類' }, '星系', cur))
 * // => true
 * console.log(inAddScope({ category: '恆星', title: '銀河旋臂' }, '星系', cur), inAddScope({ category: '恆星', title: '主序星' }, '星系', cur))
 * // => true false
 */
export function inAddScope(note, category, cur) {
    if (!note || note.category === category) return false
    if (note.category === cur.fallbackCategory) return true
    const kws = cur.categoryHints[category] || []
    if (!kws.length) return false
    const hay = [note.title, ...(isarr(note.concepts) ? note.concepts : []), note.summary].map((x) => String(x || '')).join('\n').toLowerCase()
    return kws.some((k) => hay.includes(String(k).toLowerCase()))
}

/**
 * 工作之待處理範圍(子階段處理與維運預覽同一份):機械＝改名之舊值筆記、新增類別之 categoryRaw 恰為該類別者;AI＝新增類別之落點／關鍵詞相符者、
 * 退役或維運排入之該類筆記;皆排除本工作已判過者
 *
 * @param {Object} job 輸入工作
 * @param {Array} notes 輸入全部筆記記錄
 * @param {Object} cur 輸入現行分類法(taxonomyOf)
 * @returns {Object} 回傳 { mechanical:Array, ai:Array }(筆記記錄陣列)
 * @example
 * let cur = taxonomyOf({ categories: ['恆星', '星系', '其他'], fallbackCategory: '其他', categoryHints: { 星系: ['星系', '銀河'] } })
 * let notes = [{ id: 'n1', category: '其他', title: '未歸類' }, { id: 'n2', category: '恆星', title: '銀河旋臂' }, { id: 'n3', category: '恆星', title: '主序星' }, { id: 'n4', category: '其他', categoryRaw: '星系' }]
 * let s = jobScope({ kind: 'rejudge', reason: 'add', category: '星系' }, notes, cur)
 * console.log(s.mechanical.map((n) => n.id), s.ai.map((n) => n.id))
 * // => [ 'n4' ] [ 'n1', 'n2' ]
 * let s2 = jobScope({ kind: 'rejudge', reason: 'retire', category: '恆星', judged: ['n2'] }, notes, cur)
 * console.log(s2.mechanical, s2.ai.map((n) => n.id))
 * // => [] [ 'n3' ]
 */
export function jobScope(job, notes, cur) {
    const list = isarr(notes) ? notes : []
    if (job.kind === 'rename') {
        const field = RENAME_FIELDS[job.field]?.record
        return { mechanical: list.filter((n) => n?.[field] === job.from), ai: [] }
    }
    const judged = new Set(isarr(job.judged) ? job.judged : [])
    const open = list.filter((n) => n && !judged.has(n.id))
    if (job.reason === 'add') {
        const mechanical = open.filter((n) => n.categoryRaw === job.category && n.category !== job.category)
        const mech = new Set(mechanical)
        return { mechanical, ai: open.filter((n) => !mech.has(n) && inAddScope(n, job.category, cur)) }
    }
    return { mechanical: [], ai: open.filter((n) => n.category === job.category) }
}

/**
 * 依新值改寫 md 之單一分類欄位(純函數):frontmatter 該鍵;有品質章行者(內容類型／證據等級)整行之值改寫至「（」或行尾
 *   ——重標(retagStage)與存量修正(ops/noteStockFix 之 SS11)同一實作
 *
 * @param {Object} md 輸入 readMd 之產物 { front, body }
 * @param {Object} f 輸入 RENAME_FIELDS 之一項
 * @param {String} value 輸入新值
 * @returns {Object} 回傳 { front, body }(新物件)
 * @example
 * let md = { front: { title: '恆星', claim_type: '理論模型' }, body: '- 內容類型：理論模型（需驗證）\n- 證據等級：中' }
 * let r = rewriteFieldOf(md, RENAME_FIELDS.claimType, '實證研究')
 * console.log(r.front.claim_type, r.body.split('\n')[0])
 * // => 實證研究 - 內容類型：實證研究（需驗證）
 * console.log(rewriteFieldOf({ front: { category: '舊' }, body: 'x' }, RENAME_FIELDS.category, '新').front.category)
 * // => 新
 */
export function rewriteFieldOf(md, f, value) {
    const front = { ...(md?.front || {}), [f.front]: value }
    let body = String(md?.body ?? '')
    if (f.line) {
        const re = new RegExp(`^(- ${f.line})[^（\\n]*`, 'm')
        if (re.test(body)) body = body.replace(re, `$1${value}`)
    }
    return { front, body }
}

/**
 * 管線外寫入入口(如還原筆記)之分類欄位確定性對應(純函數;檢定標準 SS9):依現行分類法——
 *   類別:在清單內不動;改名對照(可連續,如 甲→乙→丙)→ 新名;仍在清單外(含已退役、未宣告)→ 後備類別並保留原值於 categoryRaw
 *   (與摘要新進之 categoryOf 同一落點規則;之後新增類別之重標以 categoryRaw 機械改回);
 *   內容類型／證據等級:改名對照 → 新名;清單外而無對照者不動(由 SS2 之清單檢查判,非確定性可修)。
 *   重標子階段只處理分類法變更當下之存量;封存期間錯過重標之筆記,還原時以本函數補上
 *
 * @param {Object} record 輸入筆記記錄(取 category、categoryRaw、claimType、evidenceLevel)
 * @param {Object} cur 輸入現行分類法(taxonomyOf 之產出)
 * @returns {Object} 回傳 { patch:{ 記錄欄位: 新值 }, fields:[{ field:'category'|'claimType'|'evidenceLevel', from, to, how:'rename'|'fallback' }] }
 * @example
 * let cur = taxonomyOf({ categories: ['乙', '其他'], fallbackCategory: '其他', categoryRenames: { 甲: '乙' } })
 * console.log(taxonomyFixOf({ category: '甲' }, cur).patch, taxonomyFixOf({ category: '丁' }, cur).patch)
 * // => { category: '乙' } { category: '其他', categoryRaw: '丁' }
 */
export function taxonomyFixOf(record, cur) {
    const patch = {}
    const fields = []
    if (!isobj(record) || !isobj(cur)) return { patch, fields }
    const lists = { category: cur.categories, claimType: cur.claimTypes, evidenceLevel: cur.evidenceLevels }
    const renamesOf = { category: cur.categoryRenames, claimType: cur.claimTypeRenames, evidenceLevel: cur.evidenceLevelRenames }
    for (const field of Object.keys(RENAME_FIELDS)) {
        const key = RENAME_FIELDS[field].record
        const from = record[key]
        const list = isarr(lists[field]) ? lists[field] : []
        if (typeof from !== 'string' || from === '' || list.includes(from)) continue
        // 改名對照(可連續;防環)
        const renames = isobj(renamesOf[field]) ? renamesOf[field] : {}
        let to = from
        const seen = new Set([to])
        while (!list.includes(to) && Object.hasOwn(renames, to) && !seen.has(renames[to])) {
            to = renames[to]
            seen.add(to)
        }
        if (list.includes(to)) {
            patch[key] = to
            if (field === 'category' && record.categoryRaw === to) patch.categoryRaw = null
            fields.push({ field, from, to, how: 'rename' })
            continue
        }
        // 類別仍在清單外:落後備類別、原值存 categoryRaw(同 categoryOf);內容類型／證據等級不動
        if (field === 'category' && cur.fallbackCategory && list.includes(cur.fallbackCategory)) {
            patch[key] = cur.fallbackCategory
            patch.categoryRaw = from
            fields.push({ field, from, to: cur.fallbackCategory, how: 'fallback' })
        }
    }
    return { patch, fields }
}

/**
 * 重標回覆之可採類別(見檔頭【可採類別】):新增類別之工作,非落點之筆記(原類別在清單且非落點類別)回覆平移至另一既有類別者 → 維持原類別
 *
 * @param {Object} job 輸入工作({ reason, category })
 * @param {Object} note 輸入筆記記錄(取 category)
 * @param {String} category 輸入模型回覆之類別(已驗在清單)
 * @param {Object} cur 輸入現行分類法(taxonomyOf)
 * @returns {String} 回傳採用之類別(平移者回原類別)
 * @example
 * let cur = taxonomyOf({ categories: ['恆星', '星系', '行星', '其他'], fallbackCategory: '其他' })
 * let job = { reason: 'add', category: '星系' }
 * console.log(retagTargetOf(job, { category: '恆星' }, '行星', cur), retagTargetOf(job, { category: '恆星' }, '星系', cur), retagTargetOf(job, { category: '其他' }, '行星', cur))
 * // => 恆星 星系 行星
 */
export function retagTargetOf(job, note, category, cur) {
    if (job?.reason !== 'add' || category === note?.category || category === job.category) return category
    if (note?.category === cur?.fallbackCategory || !(isarr(cur?.categories) && cur.categories.includes(note?.category))) return category
    return note.category
}

export default { TAXONOMY_STATE_VERSION, TAXONOMY_STATE_FILE, RENAME_FIELDS, REJUDGE_REASON_LABELS, retagJobLabelOf, taxonomySnapshotOf, taxonomyOf, taxonomyVersion, diffTaxonomy, resolveJob, createTaxonomyStore, syncTaxonomy, queueRejudge, inAddScope, jobScope, rewriteFieldOf, taxonomyFixOf, retagTargetOf }
