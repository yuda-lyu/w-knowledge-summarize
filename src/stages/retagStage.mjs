// retagStage.mjs — 摘要物件之子階段 retag:分類法變更 → 既有筆記重標(分類得要能擴充;分類器之調整與擴充要觸發既有知識之調整)
//
// 【做什麼】每輪先以現行詞彙表同步分類法狀態(stores/taxonomy:首次只記錄、版本變動轉工作、未宣告之移除守門),再於時間允許時處理工作:
//   改名(類別／內容類型／證據等級)機械改寫;新增類別之 categoryRaw 恰為該類別者機械改;新增／退役類別與維運排入之重判經 AI
//   (席位 summarize.retag.ai,未給沿用摘要席位 summarize.ai;批次調度沿用 core/stages/aiBatchStage);新增類別之工作,非落點筆記只在
//   原類別／新類別間判(回覆平移至另一既有類別者不採、維持原類別;taxonomy.retagTargetOf)。
// 【落地】先 record(含 tagChangedAt)後 md(frontmatter 與品質章),record 回驗後才算完成;md 失敗記 mdStale、每輪先修補(md 改寫依 record
//   現值整行改寫,不依舊值比對)。重標不是知識內容變更(內容變更由同步子階段偵測,欄位 knowledgeChangedAt):下游以記錄欄 tagChangedAt
//   判分類已改(跨套件之契約);同一管線內另有 ctx 旗標 SUMMARIZE_CTX_FLAGS.tagChanged(logContract;本輪重標篇數之累計)。
// 【時間】扣掉保留給後段之時間(opt.reserveMs,未給取每輪依賴之 deps.reserveMs;由組裝者注入,本段不讀他工作之設定)後剩不到 5 分即不開工
//   (同步與守門照做),每次 AI 呼叫以
//   「剩餘−保留」封頂;AI 每輪至多 summarize.retag.perRun 篇、每批 summarize.retag.notesPerCall 篇;機械每輪至多 summarize.retag.mechanicalPerRun 篇
//   (分頁,下輪續)。
// 【陣列輸出之呼叫逐次截斷放行】重標之輸出為逐篇之 JSON 陣列:每次呼叫給 acceptTruncated:true(調度層於輸出截斷時收前段完整項目,未涵蓋者
//   記失敗、下批再判);逐次給、不在建構期開。
// 【守門】類別／內容類型／證據等級自清單移除而未宣告去向 → 每輪 WARN「分類法守門：…」,資料不動。
// 【待判(SS9)】AI 重判 RETAG_MAX_FAILS(2)次未成者本工作略過;退役類別之工作略過即留在清單外 → 登錄待判(使用者;stores/noteHolds 之 putRetagHold)。
//   每輪開頭:已不在或已回清單者結案、使用者要求重試者重排該退役類別之重判(taxonomy.queueRejudge)。
// 【退路之 domain 與詞彙】未給 opt.domain 且 deps.domains.retag 缺者,以已解析之 deps.vocab(無則取 deps.data.vocab 中本套件所讀之鍵)現建;
//   分類法取 domain 之詞彙表,其次 deps.vocab。

import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import { stdReport, stageFields, rejectChainOpts, reserveOf, reserveMsOf, oneline } from '../core/capturePackage.mjs'
import { runAiBatchStage } from '../core/stages/aiBatchStage.mjs'
import { SUMMARIZE_CTX_FLAGS } from '../logContract.mjs'
import { readMd, writeMd, sectionOf } from '../core/md/md.mjs'
import { NOTE_SECTION_TITLES } from '../core/md/noteContent.mjs'
import { resolveSummarizeVocab, pickSummarizeVocab } from '../core/vocab/summarizeVocab.mjs'
import { createRetagDomain } from '../domain/retagDomain.mjs'
import {
    TAXONOMY_STATE_FILE, RENAME_FIELDS, retagJobLabelOf, taxonomyOf, createTaxonomyStore, syncTaxonomy, queueRejudge, jobScope, rewriteFieldOf, retagTargetOf,
} from '../stores/taxonomy.mjs'
import { putRetagHold, settleRetagHolds, RETAG_MAX_FAILS } from '../stores/noteHolds.mjs'
import { SUMMARIZE_DEFAULT, summarizeSeatOf } from '../core/summarizeSettings.mjs'

/** 開工門檻:扣保留後之剩餘須達此毫秒數 */
const MIN_START_MS = 300_000

/**
 * 工作之一句描述(日誌用):工作名稱(retagJobLabelOf)＋處理方式
 * @param {Object} j 輸入工作
 * @returns {String} 回傳描述
 */
const describe = (j) => `${retagJobLabelOf(j)}${j.kind === 'rename' ? '（機械）' : '（AI 重判）'}`

/**
 * 依 record 現值改寫 md 之單一欄位(frontmatter;有品質章行者整行改寫)並回驗
 *
 * @param {String} file 輸入 md 路徑
 * @param {Object} f 輸入 RENAME_FIELDS 之一項
 * @param {String} value 輸入新值
 * @throws {Error} 檔案不存在、讀寫失敗或回驗不符時拋出
 */
function rewriteMdField(file, f, value) {
    const md = readMd(file)
    if (!md) throw new Error('md 不存在或無法讀取')
    // 品質章之行:「- 內容類型：X」「- 證據等級：X（說明）」——整行之值改寫至「（」或行尾(taxonomy.rewriteFieldOf;存量修正同一實作)
    const { front, body } = rewriteFieldOf(md, f, value)
    writeMd(file, front, body)
    if (readMd(file)?.front?.[f.front] !== value) throw new Error('md 回驗不符')
}

/**
 * 重標子階段:分類法同步(每輪)＋工作處理(時間允許時)。hook 錨點:無(機制性子階段,整段可由 opt.enabled:false 停用)
 *
 * @param {Object} [opt={}] 輸入設定物件，非物件則視為{}
 * @param {Boolean} [opt.enabled=true] 輸入是否啟用
 * @param {Object} [opt.domain] 輸入整組置換之重標領域物件(buildPrompt/isValidItem/vocab)，未給則用 ctx.deps.domains.retag
 * @param {Function} [opt.callAI] 輸入覆寫之 AI 呼叫函數 (prompt, check, callOpt) => Promise，未給則用 ai.callJson;callOpt 同正式呼叫
 *   { shouldStop, budgetMs, acceptTruncated:true }(席位 spec 由正式呼叫補)
 * @param {Object} [opt.store] 輸入分類法狀態讀寫器(createTaxonomyStore 之產物)，未給則用 <dirs.state>/TAXONOMY_STATE_FILE
 * @param {Integer} [opt.perRun] 輸入 AI 每輪至多重判篇數，未給用 settings.summarize.retag.perRun
 * @param {Integer} [opt.batch] 輸入 AI 每批篇數，未給用 settings.summarize.retag.notesPerCall
 * @param {Integer} [opt.mechanicalPerRun] 輸入機械每輪至多改寫篇數，未給用 settings.summarize.retag.mechanicalPerRun
 * @param {Number|Function} [opt.reserveMs] 輸入保留給後段之毫秒數(非負)，或 (ctx) => 毫秒數(每輪求值):扣保留後剩餘不足 5 分即不開工、
 *   每次 AI 呼叫以「剩餘−保留」封頂;由組裝者注入(如後段工作之最低時間),本段不讀他工作之設定。未給則取每輪依賴之 ctx.deps.reserveMs
 *   (同形;組裝者於依賴給一次,自組之管線與預設管線一體適用),皆未給為 0
 * @returns {Object} 回傳 stage 物件 { name, run }
 * @throws {Error} 給了 tap／chain(本段無動作鏈)、或 opt.reserveMs 非非負毫秒數亦非函數時拋出(deps.reserveMs 不合者於執行期拋出)
 * @example
 * import fs from 'fs'
 * import os from 'os'
 * import path from 'path'
 *
 * let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retag-'))
 * let file = path.join(dir, 'n1.md')
 * writeMd(file, { title: '星系', category: '宇宙學' }, '# 星系\n\n## 核心知識\n\n- 要點')
 * let rows = new Map([['n1', { id: 'n1', file, title: '星系', category: '宇宙學' }]])
 * let notes = {
 *     select: async () => [...rows.values()],
 *     get: async (id) => rows.get(id),
 *     patch: async (id, o) => Object.assign(rows.get(id), o),
 * }
 * let runWith = (vocab) => stageRetag().run({
 *     deps: { stores: { notes }, settings: resolveSummarizeSettings({}), dirs: { state: dir }, clock: { iso8: () => 'T0' }, ai: {}, vocab },
 *     log: { info() {}, warn() {} }, get: (k, d) => d, set() {}, remainingMs: () => Infinity, expired: () => false,
 * })
 * let r1 = await runWith(resolveSummarizeVocab({ categories: ['天體物理', '宇宙學', '其他'] }))
 * console.log(r1.detail.initialized, r1.detail.jobsAdded)
 * // => true 0
 *
 * let r2 = await runWith(resolveSummarizeVocab({ categories: ['天體物理', '宇宙論', '其他'], categoryRenames: { 宇宙學: '宇宙論' } }))
 * console.log(r2.detail.mechChanged, rows.get('n1').category, readMd(file).front.category)
 * // => 1 宇宙論 宇宙論
 *
 * try { stageRetag({ chain: [] }) } catch (e) { console.log(e.message) }
 * // => 子階段[retag] 無動作鏈(hook 錨點),不可給 chain
 * fs.rmSync(dir, { recursive: true, force: true })
 */
export function stageRetag(opt = {}) {

    //check
    if (!isobj(opt)) {
        opt = {}
    }
    // 機制性子階段、無動作鏈:tap／chain 給了即拋(不靜默無效)
    rejectChainOpts('retag', opt)
    // 保留時間:opt 明給者優先;未給者每輪取 ctx.deps.reserveMs(組裝者之依賴);取值規則取抓取套件之 reserveMsOf(各段同一份)
    const reserveFn = opt.reserveMs === undefined || opt.reserveMs === null ? null : reserveMsOf(opt.reserveMs, 'stageRetag 之 opt.reserveMs')

    return {
        ...stageFields(opt, { name: 'retag' }),
        run: async (ctx) => {
            const { stores, settings, dirs, clock, ai } = ctx.deps
            const log = ctx.log
            if (opt.enabled === false) return stdReport({ detail: { disabled: true } })
            const rt = settings.summarize?.retag || {}
            const domain = opt.domain || ctx.deps.domains?.retag || createRetagDomain({ vocab: ctx.deps.vocab || pickSummarizeVocab(ctx.deps.data?.vocab) })
            const vocab = domain.vocab || ctx.deps.vocab || resolveSummarizeVocab(pickSummarizeVocab(ctx.deps.data?.vocab))
            const cur = taxonomyOf(vocab)
            const store = opt.store || createTaxonomyStore(path.join(dirs.state, TAXONOMY_STATE_FILE))
            const nowIso = clock.iso8()
            const det = { version: '', initialized: false, jobsAdded: 0, jobsVoided: 0, jobsPending: 0, jobsDone: 0, guards: 0, mechChanged: 0, aiJudged: 0, aiChanged: 0, aiKept: 0, aiLateral: 0, mdFailed: 0, mdRepaired: 0, deferred: false, failedBatches: 0, missed: 0, aiAttempts: 0, holdsAdded: 0, holdsResolved: 0, jobsRetried: 0 }

            // ── 同步(每輪;便宜)──
            let state
            try {
                state = store.load()
            }
            catch (e) {
                log.warn(`分類法守門：${e.message}；本輪不重標`)
                return stdReport({ stats: { fail: 1 }, detail: { ...det, loadFailed: true } })
            }
            const sync = syncTaxonomy(state, vocab, nowIso)
            state = sync.state
            det.version = state.version
            det.initialized = sync.initialized
            det.jobsAdded = sync.added.length
            det.jobsVoided = sync.voided.length
            const save = () => store.save(state)
            if (sync.initialized) log.info(`分類法：首次記錄（版本 ${state.version}；類別 ${cur.categories.length}、內容類型 ${cur.claimTypes.length}、證據等級 ${cur.evidenceLevels.length}），既有筆記不重判`)
            for (const j of sync.added) log.info(`分類法：版本 ${state.version}，排入重標工作——${describe(j)}`)
            for (const j of sync.voided) log.info(`分類法：工作「${describe(j)}」依現行分類法作廢`)
            if (sync.changed) save()

            const notesAll = async () => stores.notes.select()
            let notes = await notesAll()
            // 守門:未宣告之移除每輪 WARN 至宣告或恢復為止(資料不動)
            for (const p of sync.pending) {
                const field = RENAME_FIELDS[p.field].record
                const n = notes.filter((x) => x[field] === p.name).length
                log.warn(`分類法守門：${RENAME_FIELDS[p.field].label}「${p.name}」已自清單移除而未宣告去向（請於 ${RENAME_FIELDS[p.field].decl} 宣告），${n} 篇筆記維持原值不動`)
            }
            det.guards = sync.pending.length

            // ── 重標待判(SS9;stores/noteHolds;無 holds 集合者略過):已不在或已回清單者結案;使用者要求重試者重排該退役類別之重判工作
            //   (範圍＝仍在該類別之筆記)。在時間守門之前——不需 AI ──
            const holds = stores.holds || null
            if (holds) {
                const st = await settleRetagHolds(holds, new Map(notes.map((n) => [n.id, n])), cur.categories, { nowIso })
                det.holdsResolved = st.resolved
                for (const c of st.retry) {
                    if (cur.categories.includes(c)) continue
                    const q = queueRejudge(state, 'retire', c, nowIso, 'retry')
                    if (q.added) {
                        det.jobsRetried++
                        log.info(`分類法：使用者要求重試，重排退役類別「${c}」之重判（工作 ${q.id}）`)
                    }
                }
                if (det.jobsRetried) save()
                if (st.resolved) log.info(`分類法：重標待判結案 ${st.resolved} 項（筆記已不在或類別已回清單內）`)
            }

            let changed = 0
            /**
             * 改一篇筆記之一個欄位:先 record(含 tagChangedAt)、回驗,再 md(失敗記 mdStale、WARN,下輪修補)
             * @param {Object} note 輸入筆記記錄
             * @param {String} field 輸入欄位('category'|'claimType'|'evidenceLevel')
             * @param {String} to 輸入新值
             */
            const applyChange = async (note, field, to) => {
                const f = RENAME_FIELDS[field]
                const patch = { [f.record]: to, tagChangedAt: nowIso }
                if (field === 'category' && note.categoryRaw === to) patch.categoryRaw = null // 提案已被採納
                await stores.notes.patch(note.id, patch)
                const back = await stores.notes.get(note.id)
                if (back?.[f.record] !== to) throw new Error(`筆記 ${note.id} 之 ${f.record} 寫入後回驗不符`)
                changed++
                try {
                    rewriteMdField(note.file, f, to)
                }
                catch (e) {
                    det.mdFailed++
                    if (!state.mdStale.some((x) => x.id === note.id && x.field === field)) state.mdStale.push({ id: note.id, field })
                    log.warn(`分類法：筆記 ${note.id} 之 md 改寫失敗（${oneline(e.message, 80)}），記錄已改，下輪修補`)
                }
            }

            // ── md 修補(依 record 現值;便宜,恆做)──
            if (state.mdStale.length) {
                const rest = []
                for (const s of state.mdStale) {
                    const note = await stores.notes.get(s.id)
                    if (!note) continue
                    try {
                        rewriteMdField(note.file, RENAME_FIELDS[s.field], note[RENAME_FIELDS[s.field].record])
                        det.mdRepaired++
                    }
                    catch {
                        rest.push(s)
                    }
                }
                if (det.mdRepaired) log.info(`分類法：修補 md ${det.mdRepaired} 篇${rest.length ? `（仍失敗 ${rest.length}）` : ''}`)
                state.mdStale = rest
                save()
            }

            // ── 時間守門(抓取套件之 reserveOf:扣掉保留後須剩 5 分才開工;每次呼叫以「剩餘−保留」封頂,不吃進後段之時間)──
            const sub = reserveOf(ctx, (reserveFn || reserveMsOf(ctx.deps.reserveMs, 'stageRetag 之 deps.reserveMs'))(ctx))
            const timeOk = () => sub.canStart(MIN_START_MS)
            const pendingJobs = () => state.jobs.length
            if (pendingJobs() > 0 && !timeOk()) {
                det.deferred = true
                det.jobsPending = pendingJobs()
                log.info(`分類法：本輪剩餘時間不足（< 保留時間＋5 分），重標延後（待處理工作 ${pendingJobs()}）`)
                return stdReport({ detail: det })
            }

            const mechCap = opt.mechanicalPerRun ?? rt.mechanicalPerRun ?? SUMMARIZE_DEFAULT.retag.mechanicalPerRun
            const aiCap = opt.perRun ?? rt.perRun ?? SUMMARIZE_DEFAULT.retag.perRun
            const batchSize = opt.batch ?? rt.notesPerCall ?? SUMMARIZE_DEFAULT.retag.notesPerCall
            let mechLeft = mechCap
            let aiLeft = aiCap
            let aiCalls = 0
            const baseCall = (p, c, o) => ai.callJson(p, c, { spec: summarizeSeatOf(settings.summarize, 'retag'), ...o })
            // 陣列輸出:逐次截斷放行(檔頭)
            const callAI = (p, c) => (opt.callAI || baseCall)(p, c, { shouldStop: () => !timeOk(), budgetMs: sub.remainingMs(), acceptTruncated: true })
            const done = []

            for (const job of [...state.jobs]) {
                if (!timeOk()) break
                notes = await notesAll()
                // 機械:改名之舊值筆記;新增類別之 categoryRaw 恰為該類別者(摘要時模型已給過此類別,零 AI)
                const mech = jobScope(job, notes, cur).mechanical.slice(0, mechLeft)
                for (const n of mech) {
                    if (job.kind === 'rename') await applyChange(n, job.field, job.to)
                    else {
                        await applyChange(n, 'category', job.category)
                        job.judged.push(n.id)
                    }
                    det.mechChanged++
                    mechLeft--
                }
                if (mech.length) save()
                const left = jobScope(job, await notesAll(), cur)
                if (left.mechanical.length === 0 && left.ai.length === 0) {
                    done.push(job) // 機械分頁未盡者下輪續
                    continue
                }
                if (job.kind === 'rename' || left.ai.length === 0) continue
                const judged = new Set(job.judged)
                const scopeOf = (list) => jobScope(job, list, cur).ai.filter((n) => !judged.has(n.id))
                if (aiLeft <= 0) continue
                const parallel = Math.max(1, settings.ai?.parallel || 1)
                const rounds = Math.ceil(aiLeft / (batchSize * parallel))
                /**
                 * 判過即記(含失敗達 RETAG_MAX_FAILS 次者;避免永遠卡在同一篇)
                 * @param {Object} n 輸入筆記
                 */
                const markJudged = (n) => {
                    judged.add(n.id)
                    job.judged.push(n.id)
                }
                // 措辭避開批次機制之常態字樣(「未被模型完整涵蓋」等):重標只在分類法變更時發生,失敗須被看見。
                //   退役類別之工作:維持原類別＝留在清單外 → 登錄待判 SS9(使用者;stores/noteHolds)——只記日誌會使之無處可追
                const bumpFail = async (n, why) => {
                    job.fails[n.id] = (job.fails[n.id] || 0) + 1
                    if (job.fails[n.id] >= RETAG_MAX_FAILS) {
                        markJudged(n)
                        const offList = job.reason === 'retire' && !cur.categories.includes(n.category)
                        if (offList && holds) {
                            await putRetagHold(holds, n, { category: n.category, why, fails: job.fails[n.id], nowIso })
                            det.holdsAdded++
                        }
                        log.warn(`分類法：筆記 ${n.id} 重判 ${RETAG_MAX_FAILS} 次未成（${why}），本工作略過之（${offList ? `仍在已退役之類別「${n.category}」${holds ? '，已登錄待判 SS9' : ''}` : '維持原類別'}）`)
                    }
                }
                const r = await runAiBatchStage({
                    log,
                    batchSize,
                    parallel,
                    rounds,
                    shouldStop: () => !timeOk() || aiLeft <= 0,
                    pickPool: async (limit) => scopeOf(await notesAll()).slice(0, Math.min(limit, aiLeft)),
                    buildPrompt: async (batch) => domain.buildPrompt(batch.map((n) => ({
                        title: n.title,
                        category: n.category,
                        summary: n.summary,
                        points: (() => {
                            const body = readMd(n.file)?.body || ''
                            const sec = sectionOf(body, NOTE_SECTION_TITLES.keyPoints)
                            return sec ? sec.text.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2)) : []
                        })(),
                    })), { focus: { reason: job.reason, category: job.category } }),
                    checkResult: (data, batch) => Array.isArray(data) && data.some((it) => domain.isValidItem(it, batch.length)),
                    isValidItem: (it, batch) => domain.isValidItem(it, batch.length),
                    indexOf: (it) => it.index,
                    callAI,
                    applyItem: async (item, n) => {
                        aiLeft--
                        det.aiJudged++
                        // 新增類別之工作:非落點筆記之平移不採(taxonomy.retagTargetOf;維持原類別)
                        const to = retagTargetOf(job, n, item.category, cur)
                        if (to !== item.category) det.aiLateral++
                        if (to !== n.category) {
                            await applyChange(n, 'category', to)
                            det.aiChanged++
                        }
                        else det.aiKept++
                        markJudged(n)
                        save()
                        return { judged: 1 }
                    },
                    onMissed: async (n) => {
                        aiLeft--
                        await bumpFail(n, '模型未涵蓋或回覆不在清單')
                        save()
                    },
                    onBatchFailed: async (batch) => {
                        for (const n of batch) {
                            aiLeft--
                            await bumpFail(n, '重標批次未成')
                        }
                        save()
                    },
                })
                aiCalls += r.aiCalls
                det.aiAttempts += r.aiAttempts
                det.failedBatches += r.failedBatches
                det.missed += r.missed
                if (r.aborted) break
                const after = jobScope(job, await notesAll(), cur)
                if (after.mechanical.length === 0 && after.ai.length === 0) done.push(job)
            }

            if (done.length) {
                const ids = new Set(done.map((j) => j.id))
                state.jobs = state.jobs.filter((j) => !ids.has(j.id))
                for (const j of done) {
                    state.history.push({ at: nowIso, version: state.version, event: 'done', job: j.id, judged: j.judged?.length || 0 })
                    log.info(`分類法：重標工作完成——${describe(j)}`)
                }
                save()
            }
            det.jobsDone = done.length
            det.jobsPending = state.jobs.length
            if (changed > 0) {
                ctx.set(SUMMARIZE_CTX_FLAGS.tagChanged, (ctx.get(SUMMARIZE_CTX_FLAGS.tagChanged, 0) || 0) + changed) // 同一管線之下游據此知本輪有重標(如重建帶類別之總覽)
                log.info(`分類法：本輪重標 ${changed} 篇（機械 ${det.mechChanged}、AI 改 ${det.aiChanged}／判 ${det.aiJudged}${det.aiLateral ? `；平移不採 ${det.aiLateral}` : ''}），待處理工作 ${det.jobsPending}`)
            }
            return stdReport({
                stats: { in: det.mechChanged + det.aiJudged, out: changed, skip: det.aiKept, fail: det.failedBatches + det.missed + det.mdFailed, aiCalls },
                detail: { ...det, changed },
            })
        },
    }
}

export default stageRetag
