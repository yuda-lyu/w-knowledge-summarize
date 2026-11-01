// taxonomyOps.mjs — 分類法之維運能力:狀態預覽、排入重判、類別提案彙整
//
// 【維運只排工作、不呼叫 AI】重判由管線之重標子階段(stages/retagStage)於時間允許時執行(席位、批次、時間守門同一套);
//   寫入(requeueCategory)須由呼叫端取整輪執行鎖(與管線互斥)。預覽(taxonomyStatus)不寫檔:以 syncTaxonomy 於記憶體試算「若現在跑會排哪些工作」。
// 【類別提案】模型給之清單外類別存於筆記 categoryRaw(stores/noteBuild);彙整後人工採納(加進 vocab.categories)即觸發重標——
//   categoryRaw 恰為新類別者機械改、其餘落點類別之筆記 AI 重判(stores/taxonomy 之 jobScope)。
// 【狀態檔】與重標子階段同一份(<state 目錄>/TAXONOMY_STATE_FILE;檔名只定義於 stores/taxonomy)。

import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { TAXONOMY_STATE_FILE, taxonomyOf, createTaxonomyStore, syncTaxonomy, queueRejudge, jobScope } from '../stores/taxonomy.mjs'
import { SUMMARIZE_DEFAULT } from '../core/summarizeSettings.mjs'

/**
 * 狀態檔路徑(與重標子階段同一份)
 *
 * @param {Object} dirs 輸入目錄物件(取 state)
 * @returns {String} 回傳路徑
 */
const stateFileOf = (dirs) => path.join(dirs.state, TAXONOMY_STATE_FILE)

/**
 * 分類法狀態預覽(唯讀):已套用版本、現行版本、本次將排入之工作與守門、各工作之待處理篇數與預估 AI 呼叫數
 *
 * @param {Object} deps 輸入 { stores:{notes}, dirs:{state}, vocab(resolveSummarizeVocab 之產出), settings? }
 * @param {Object} [opt={}] 輸入 { nowIso }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { initialized, appliedVersion, version, toAdd, voided, guards, jobs:[{ id, kind, field?, from?, to?, reason?, category?, mechanical, ai, judged }], aiCallsEstimate }
 * @throws {Error} deps 不全，或狀態檔存在而無法解析時拋出
 * @example
 * import fs from 'fs'
 * import os from 'os'
 * import path from 'path'
 *
 * let dirs = { state: fs.mkdtempSync(path.join(os.tmpdir(), 'tax-')) }
 * let vocab = resolveSummarizeVocab({ categories: ['天體物理', '宇宙學', '其他'], fallbackCategory: '其他' })
 * let notes = { select: async () => [{ id: 'a', title: '甲', category: '其他' }] }
 * let s = await taxonomyStatus({ stores: { notes }, dirs, vocab }, { nowIso: 'T0' })
 * console.log(s.initialized, s.jobs.length, s.aiCallsEstimate)
 * // => true 0 0
 *
 * requeueCategory({ dirs, vocab }, '其他', { nowIso: 'T0' })
 * let s2 = await taxonomyStatus({ stores: { notes }, dirs, vocab }, { nowIso: 'T0' })
 * console.log(s2.jobs.map((j) => [j.id, j.ai]), s2.aiCallsEstimate)
 * // => [ [ 'rejudge:requeue:其他', 1 ] ] 1
 * fs.rmSync(dirs.state, { recursive: true, force: true })
 */
export async function taxonomyStatus(deps, opt = {}) {
    if (!isobj(deps) || !isobj(deps.stores) || !isobj(deps.dirs) || !isobj(deps.vocab)) throw new Error('taxonomyStatus 需要 { stores, dirs, vocab }')
    const store = createTaxonomyStore(stateFileOf(deps.dirs))
    const before = store.load()
    const sync = syncTaxonomy(before, deps.vocab, opt.nowIso || '')
    const cur = taxonomyOf(deps.vocab)
    const notes = await deps.stores.notes.select()
    const jobs = sync.state.jobs.map((j) => {
        const s = jobScope(j, notes, cur)
        return { ...j, judged: (j.judged || []).length, fails: undefined, mechanical: s.mechanical.length, ai: s.ai.length }
    })
    const batch = deps.settings?.summarize?.retag?.notesPerCall || SUMMARIZE_DEFAULT.retag.notesPerCall
    const guards = sync.pending.map((p) => {
        const field = { category: 'category', claimType: 'claimType', evidenceLevel: 'evidenceLevel' }[p.field]
        return { ...p, notes: notes.filter((n) => n[field] === p.name).length }
    })
    return {
        initialized: !before,
        appliedVersion: before?.version || '',
        version: sync.state.version,
        toAdd: sync.added.map((j) => j.id),
        voided: sync.voided.map((j) => j.id),
        guards,
        jobs,
        aiCallsEstimate: Math.ceil(jobs.reduce((n, j) => n + j.ai, 0) / batch),
    }
}

/**
 * 排入重判:現行清單內之類別,其筆記由 AI 依現行清單重判(如 guide 措辭或類別定義改了而清單未變)
 *
 * @param {Object} deps 輸入 { dirs:{state}, vocab }
 * @param {String} category 輸入類別(須在現行 categories)
 * @param {Object} [opt={}] 輸入 { nowIso }
 * @returns {Object} 回傳 { added:Boolean, id:String }(同一類別已有待處理之重判工作時 added 為 false)
 * @throws {Error} deps 不全、category 不在現行清單，或狀態檔存在而無法解析時拋出
 * @example
 * import fs from 'fs'
 * import os from 'os'
 * import path from 'path'
 *
 * let dirs = { state: fs.mkdtempSync(path.join(os.tmpdir(), 'tax-')) }
 * let vocab = resolveSummarizeVocab({ categories: ['天體物理', '宇宙學', '其他'], fallbackCategory: '其他' })
 * console.log(requeueCategory({ dirs, vocab }, '其他', { nowIso: 'T0' }))
 * // => { added: true, id: 'rejudge:requeue:其他' }
 *
 * console.log(requeueCategory({ dirs, vocab }, '其他', { nowIso: 'T0' }).added)
 * // => false
 *
 * try { requeueCategory({ dirs, vocab }, '不存在') } catch (e) { console.log(e.message) }
 * // => 類別「不存在」不在現行分類清單（天體物理、宇宙學、其他）
 * fs.rmSync(dirs.state, { recursive: true, force: true })
 */
export function requeueCategory(deps, category, opt = {}) {
    if (!isobj(deps) || !isobj(deps.dirs) || !isobj(deps.vocab)) throw new Error('requeueCategory 需要 { dirs, vocab }')
    if (!isestr(category) || !deps.vocab.categories.includes(category)) throw new Error(`類別「${category}」不在現行分類清單（${deps.vocab.categories.join('、')}）`)
    const store = createTaxonomyStore(stateFileOf(deps.dirs))
    const nowIso = opt.nowIso || ''
    const sync = syncTaxonomy(store.load(), deps.vocab, nowIso)
    const s = sync.state
    const q = queueRejudge(s, 'requeue', category, nowIso)
    if (q.added || sync.changed) store.save(s)
    return q
}

/**
 * 類別提案之彙整(純函數;維運與巡檢共用):筆記之 categoryRaw 依篇數降冪
 *
 * @param {Array} notes 輸入筆記記錄陣列，非陣列視為[]
 * @param {Object} [opt={}] 輸入 { top=20, samples=3 }
 * @returns {Array} 回傳 [{ raw, count, samples:[標題] }]
 * @example
 * console.log(proposalsOf([{ categoryRaw: '甲', title: 'a' }, { categoryRaw: '甲', title: 'b' }, { title: 'c' }], { samples: 1 }))
 * // => [ { raw: '甲', count: 2, samples: [ 'a' ] } ]
 */
export function proposalsOf(notes, opt = {}) {
    const top = Number.isInteger(opt.top) && opt.top > 0 ? opt.top : 20
    const k = Number.isInteger(opt.samples) && opt.samples >= 0 ? opt.samples : 3
    const by = new Map()
    for (const n of Array.isArray(notes) ? notes : []) {
        const raw = String(n?.categoryRaw || '').trim()
        if (!raw) continue
        if (!by.has(raw)) by.set(raw, { raw, count: 0, samples: [] })
        const e = by.get(raw)
        e.count++
        if (e.samples.length < k) e.samples.push(n.title)
    }
    return [...by.values()].sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw)).slice(0, top)
}

/**
 * 類別提案:彙整筆記之 categoryRaw(模型給之清單外類別)
 *
 * @param {Object} stores 輸入 { notes }
 * @param {Object} [opt={}] 輸入 { top=20, samples=3 }
 * @returns {Promise} 回傳 Promise，resolve 回傳 [{ raw, count, samples:[標題] }](依篇數降冪)
 * @example
 * let notes = {
 *     select: async () => [
 *         { id: 'a', title: '甲', category: '其他', categoryRaw: '天文儀器' },
 *         { id: 'b', title: '乙', category: '其他', categoryRaw: '天文儀器' },
 *         { id: 'c', title: '丙', category: '宇宙學' },
 *     ],
 * }
 * console.log(await categoryProposals({ notes }, { samples: 1 }))
 * // => [ { raw: '天文儀器', count: 2, samples: [ '甲' ] } ]
 */
export async function categoryProposals(stores, opt = {}) {
    return proposalsOf(await stores.notes.select(), opt)
}

export default { taxonomyStatus, requeueCategory, proposalsOf, categoryProposals }
