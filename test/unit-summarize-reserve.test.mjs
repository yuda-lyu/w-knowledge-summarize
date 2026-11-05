// unit-summarize-reserve.test.mjs — 預篩(含第二席確認)、摘要(含修補、忠實性覆核)扣保留給後段之時間(opt.reserveMs／ctx.deps.reserveMs),與重標同法
//   (重標之保留案見 unit-summarize-retag;取值器與守門件另見 unit-summarize-reserve-gate)
// 規則(出自 stages/triageStage、stages/noteStage 檔頭與 core/stages/stageReserve):
//   R1 保留生效(>0)時,開工前判「扣保留後剩餘 ≥ 一次呼叫之估計」,不成立 → 本段不開工:文件原樣留池、AI 0 次、日誌寫明、detail.deferred:true
//   R2 批次調度每輪(wave)開工前同判:時間不夠就少做幾輪,容量鍵(rounds、docsPerCall、parallel)不縮;已處理篇數＝已開工各輪之容量
//   R3 每次呼叫之 budgetMs＝剩餘−保留;一次呼叫之估計取該席位鏈首家之單次逾時(席位 timeoutMs → ai.providerTimeouts[use] → ai.timeoutMs → 300000),不另設新鍵
//   R4 第二席確認之迴圈與第三席同判(各席各用自己之估計);不開工者留待下輪、不記次
//   R5 修補、忠實性覆核於時間不足時 → 本批不套用、不記 tries、文件留 raw 池(不把未核對之結果當成已核對);各席用自己之估計
//   R6 保留未給(或 0)→ 行為與未有此機制時完全相同(不加「一次呼叫」門檻、不附 deferred、不多日誌)
//   R7 取值規則同重標:opt.reserveMs 明給者優先(含 0)、未給(或 null)取 ctx.deps.reserveMs、皆未給為 0;不合法 → 建構即拋(opt)／該輪拋出(deps、函數回傳)
// 時間以注入之虛擬時鐘同步(AI 替身每次呼叫耗掉固定虛擬時間),不用真實等待
// 執行:自套件根 node <mocha> test/unit-summarize-reserve.test.mjs(暫存 test/_tmp/summarize-reserve-<pid>,測完即刪;替身 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memStore } from './tools/captureForTest.mjs'
import { recLog } from './tools/stageKit.mjs'
import { resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { stageTriage } from '../src/stages/triageStage.mjs'
import { stageSummarize } from '../src/stages/noteStage.mjs'

const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/summarize-reserve-${process.pid}`).replace(/\\/g, '/')
const MIN = 60_000
const NOW = '2026-11-05T10:00:00+08:00'
const clock = { iso8: () => NOW }
const DEFER_RE = /扣保留時間後剩餘.*不足一次呼叫/
let seq = 0

/** 虛擬時鐘:整輪預算 totalMs;AI 替身每次呼叫 spend 一段(同步推進,不用真實等待) */
function vclock(totalMs) {
    let used = 0
    return {
        remainingMs: () => Math.max(0, totalMs - used),
        expired: () => used >= totalMs,
        spend: (ms) => {
            used += ms
        },
        usedMs: () => used,
    }
}
const seconds = (ms) => Math.round(ms / 1000)
const docIds = (n) => Array.from({ length: n }, (_, i) => `d${String(i + 1).padStart(2, '0')}`)
const rawDocs = (n, extra = {}) => docIds(n).map((id, i) => ({ id, status: 'raw', title: `文件${i + 1}`, collectedAt: `2026-11-01T00:${String(i).padStart(2, '0')}:00+08:00`, ...extra }))
const statusOf = async (docs, ids) => Object.fromEntries(await Promise.all(ids.map(async (id) => [id, (await docs.get(id)).status])))
const count = (st, s) => Object.values(st).filter((x) => x === s).length

// ══════════════════════════ 摘要段 ══════════════════════════
const SUM_SEAT = { use: 'x:main', timeoutMs: 6 * MIN }
const SUM_DOMAIN = { buildPrompt: async () => 'p', isValidItem: () => true }
const JUDGE_OFF = (n) => Array.from({ length: n }, (_, i) => ({ index: i + 1, relevant: false, reason: '測試：判非知識' }))

/**
 * 跑一次摘要段(預篩停用;AI 替身每次呼叫耗 perCallMs 並回「判非知識」→ 文件轉 skip)
 *
 * @param {Object} o 輸入 { total(整輪預算), perCallMs, n(raw 篇數), rounds, parallel, batch, optReserve, depsReserve(皆省略＝不給), seat, extraDeps }
 * @returns {Promise<Object>} 回傳 { rep, calls, docs, log, vc }
 */
async function runSum(o) {
    const { total, perCallMs = 0, n = 20, rounds = 4, parallel = 2, batch = 2, seat = SUM_SEAT } = o
    const vc = vclock(total)
    const docs = memStore(rawDocs(n))
    const calls = []
    const callAI = async (p, c, co) => {
        calls.push({ budgetMs: co.budgetMs, stopNow: co.shouldStop() })
        vc.spend(perCallMs)
        return { ok: true, data: JUDGE_OFF(batch), providerId: 'p-sum' }
    }
    const log = recLog()
    const opt = { domain: SUM_DOMAIN, docsPerBatch: batch, parallel, rounds, callAI, ...('optReserve' in o ? { reserveMs: o.optReserve } : {}) }
    const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: false }, ai: seat }, ai: { parallel } })
    const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings, ...('depsReserve' in o ? { reserveMs: o.depsReserve } : {}), ...(o.extraDeps || {}) }
    const rep = await stageSummarize(opt).run({ deps, log, remainingMs: vc.remainingMs, expired: vc.expired })
    return { rep, calls, docs, log, vc }
}

describe('unit-summarize-reserve', function() {

    before(() => fs.mkdirSync(TMP, { recursive: true }))
    after(() => fs.rmSync(TMP, { recursive: true, force: true }))

    describe('摘要主段(stageSummarize)', () => {

        it('R1 開工前:剩餘 20 分、保留 15 分、一次呼叫 6 分(席位逾時)→ 不開工:AI 0 次、raw 池不動、detail.deferred、日誌寫明(扣保留後剩餘、留下輪篇數)', async () => {
            const r = await runSum({ total: 20 * MIN, perCallMs: 0, depsReserve: 15 * MIN })
            assert.equal(r.calls.length, 0, 'AI 0 次')
            const st = await statusOf(r.docs, docIds(20))
            assert.equal(count(st, 'raw'), 20, 'raw 池不動')
            assert.equal(r.rep.detail.deferred, true)
            assert.equal(r.rep.detail.stopped, true)
            assert.equal(r.rep.stats.aiCalls, 0)
            const line = r.log.lines.find((l) => DEFER_RE.test(l))
            assert.ok(line, r.log.lines.join('\n'))
            assert.ok(line.includes('300s') && line.includes('360s') && line.includes('20 篇'), `扣保留後剩餘 300s、一次呼叫 360s、留下輪 20 篇:${line}`)
            assert.ok(r.log.lines.some((l) => /本輪容量 16/.test(l)), '本輪容量日誌照印')
        })

        it('R1 邊界:剩餘恰為保留＋一次呼叫(21 分)→ 開工;差 1 毫秒 → 不開工', async () => {
            const a = await runSum({ total: 21 * MIN, perCallMs: 0, depsReserve: 15 * MIN })
            assert.ok(a.calls.length > 0 && a.rep.detail.deferred === undefined, '恰等於 → 開工')
            const b = await runSum({ total: 21 * MIN - 1, perCallMs: 0, depsReserve: 15 * MIN })
            assert.deepEqual([b.calls.length, b.rep.detail.deferred], [0, true], '差 1 毫秒 → 不開工')
        })

        it('R2 每輪開工前:剩餘 30 分、保留 15 分、一次呼叫 6 分、每次呼叫耗 5 分 → 第 1 輪(2 批並行)後剩 20 分 < 保留＋6 分,第 2 輪不開工;處理篇數＝parallel×docsPerCall,其餘留池(容量不縮)', async () => {
            const r = await runSum({ total: 30 * MIN, perCallMs: 5 * MIN, depsReserve: 15 * MIN })
            assert.equal(r.calls.length, 2, '第 1 輪 2 批並行,其後不再開工')
            const st = await statusOf(r.docs, docIds(20))
            assert.deepEqual([count(st, 'skip'), count(st, 'raw')], [4, 16], '處理 parallel(2)×docsPerCall(2)＝4 篇,其餘 16 篇留 raw 池')
            assert.deepEqual([r.rep.detail.deferred, r.rep.detail.stopped, r.rep.detail.aborted], [true, true, false])
            assert.ok(r.log.lines.some((l) => /本輪容量 16/.test(l)), '本輪容量日誌照印')
            assert.ok(r.log.lines.some((l) => /因時間提前結束於第 2\/4 輪/.test(l)), `另印提前結束於第幾輪:\n${r.log.lines.join('\n')}`)
        })

        it('R3 每次呼叫以「剩餘−保留」封頂(budgetMs);呼叫內之 shouldStop 同以一次呼叫之估計判(剩餘−保留 < 6 分即真)', async () => {
            const r = await runSum({ total: 30 * MIN, perCallMs: 5 * MIN, depsReserve: 15 * MIN, parallel: 1, n: 4, rounds: 1 })
            assert.deepEqual(r.calls.map((c) => c.budgetMs), [15 * MIN], '30 分 − 保留 15 分')
            assert.equal(r.calls[0].stopNow, false, '呼叫開始時剩餘−保留(15 分)≥ 一次呼叫(6 分)')
            // 呼叫後:剩餘 25 分−保留 15 分＝10 分仍夠;再耗 5 分後 5 分 < 6 分
            const seen = []
            const vc = vclock(30 * MIN)
            const callAI = async (p, c, co) => {
                vc.spend(10 * MIN)
                seen.push(co.shouldStop())
                return { ok: true, data: JUDGE_OFF(2) }
            }
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: false }, ai: SUM_SEAT }, ai: { parallel: 1 } })
            await stageSummarize({ domain: SUM_DOMAIN, docsPerBatch: 2, parallel: 1, rounds: 1, callAI }).run({ deps: { stores: { docs: memStore(rawDocs(2)), notes: memStore(), frontier: memStore() }, clock, settings, reserveMs: 15 * MIN }, log: recLog(), remainingMs: vc.remainingMs, expired: vc.expired })
            assert.deepEqual(seen, [true], '耗 10 分後剩餘−保留＝5 分 < 6 分 → 呼叫內之中止判斷為真')
        })

        it('R6 保留未給(或 0):行為與現版相同——不加一次呼叫門檻(剩餘 1 分仍開工)、budgetMs＝整輪剩餘、不附 deferred、不多日誌', async () => {
            const a = await runSum({ total: 1 * MIN, perCallMs: 0, parallel: 1, n: 4, rounds: 1 })
            assert.equal(a.calls.length, 1, '未給保留:剩餘 1 分(< 一次呼叫 6 分)仍開工')
            assert.deepEqual(a.calls.map((c) => c.budgetMs), [1 * MIN], 'budgetMs＝整輪剩餘')
            assert.equal('deferred' in a.rep.detail, false)
            assert.ok(!a.log.lines.some((l) => DEFER_RE.test(l) || /因時間提前結束/.test(l)))
            // 明給 0 與未給同;每輪之容量照走完
            const b = await runSum({ total: 60 * MIN, perCallMs: 5 * MIN, optReserve: 0 })
            assert.deepEqual([b.calls.length, count(await statusOf(b.docs, docIds(20)), 'skip'), 'deferred' in b.rep.detail], [8, 16, false], '未保留:4 輪×2 批全數走完')
            // 整輪已逾期:維持原有之一輪都不開工(stopped),不附 deferred
            const c = await runSum({ total: 0, perCallMs: 0, depsReserve: 15 * MIN })
            assert.deepEqual([c.calls.length, c.rep.detail.stopped, 'deferred' in c.rep.detail], [0, true, false], '整輪逾期屬一般截止,非保留所致')
        })

        it('R7 取值:opt.reserveMs 明給者優先(含 0);null 取 deps;函數每輪以本輪 ctx 求值;deps 為數字或函數', async () => {
            const hold = await runSum({ total: 20 * MIN, depsReserve: 15 * MIN, optReserve: 0 })
            assert.ok(hold.calls.length > 0 && !('deferred' in hold.rep.detail), 'opt 之 0 優先於依賴')
            const viaNull = await runSum({ total: 20 * MIN, depsReserve: 15 * MIN, optReserve: null })
            assert.deepEqual([viaNull.calls.length, viaNull.rep.detail.deferred], [0, true], 'opt 為 null 取 deps')
            const seen = []
            const viaOpt = await runSum({ total: 20 * MIN, optReserve: (ctx) => {
                seen.push(ctx)
                return 15 * MIN
            } })
            assert.deepEqual([viaOpt.calls.length, viaOpt.rep.detail.deferred, seen.length], [0, true, 1])
            assert.equal(typeof seen[0].remainingMs, 'function', '以本輪之 ctx 求值')
            const viaDepsFn = await runSum({ total: 20 * MIN, depsReserve: (ctx) => (ctx.deps ? 15 * MIN : -1) })
            assert.deepEqual([viaDepsFn.calls.length, viaDepsFn.rep.detail.deferred], [0, true])
        })

        it('R7 不合法:opt 非非負有限數亦非函數 → 建構即拋;函數回傳不合法 → 該輪拋出;deps 不合法 → 該輪拋出', async () => {
            for (const bad of [-1, Number.NaN, Infinity, '900000', true, {}]) {
                assert.throws(() => stageSummarize({ reserveMs: bad }), /stageSummarize 之 opt\.reserveMs 須為非負毫秒數或 \(ctx\) => 毫秒數/, String(bad))
            }
            assert.doesNotThrow(() => stageSummarize({ reserveMs: 0 }))
            await assert.rejects(() => runSum({ total: 20 * MIN, optReserve: () => -5 }), /stageSummarize 之 opt\.reserveMs 函數須回傳非負毫秒數，收到 -5/)
            await assert.rejects(() => runSum({ total: 20 * MIN, depsReserve: -1 }), /stageSummarize 之 deps\.reserveMs 須為非負毫秒數或 \(ctx\) => 毫秒數，收到 -1/)
        })

        it('R5 修補:主呼叫後剩餘−保留 < 一次呼叫 → 不發修補呼叫、本批不套用、不記 tries、文件留 raw、deferred(未核對之結果不落地)', async () => {
            const SRC = 'Taiwan momentum 12-1 earns 8.2% annual excess return over 2010-2024; Sharpe 0.71; costs 0.15%.'
            const ITEM = { index: 1, relevant: true, title: '動量因子之台股實證', summary: '台股動量年化超額 8.2%', key_points: ['年化超額 8.2%', '夏普 1.9'], concepts: ['動量因子', '回測'], claim_type: '實證研究', evidence_level: '中' }
            const run = async (mainSpendMs) => {
                const vc = vclock(30 * MIN)
                const docs = memStore([{ id: 'd1', status: 'raw', title: '動量研究', text: SRC, url: 'https://e.com/d1', sourceName: 's', sourceTier: 1, collectedAt: NOW }])
                const notes = memStore()
                const calls = []
                const callAI = async (p, c, co) => {
                    calls.push(co.segment || 'summarize')
                    if (co.segment === 'summarizeRepair') return { ok: true, data: { repairs: [{ no: 1, value: '夏普值 0.71' }] }, providerId: 'p-sum' }
                    vc.spend(mainSpendMs)
                    return { ok: true, data: [ITEM], providerId: 'p-sum' }
                }
                const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: false }, ai: SUM_SEAT, standards: { repair: { enabled: true } } }, capture: { browser: { perRun: 0 } } })
                const log = recLog()
                const rep = await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, maxTries: 3, callAI })
                    .run({ deps: { stores: { docs, notes, frontier: memStore(), holds: memStore() }, settings, clock, dirs: { notes: `${TMP}/n${++seq}` }, domains: { summarize: createSummarizeDomain({ vocab: { claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] } }) }, reserveMs: 15 * MIN }, log, remainingMs: vc.remainingMs, expired: vc.expired })
                return { rep, calls, docs, notes, log }
            }
            // 主呼叫耗 10 分:剩 20 分−保留 15 分＝5 分 < 修補席(摘要席)一次呼叫 6 分
            const a = await run(10 * MIN)
            assert.deepEqual(a.calls, ['summarize'], '不發修補呼叫')
            const d = await a.docs.get('d1')
            assert.deepEqual([d.status, d.summarizeTries || 0, (await a.notes.select()).length], ['raw', 0, 0], '本批不套用、不記 tries、無筆記')
            assert.deepEqual([a.rep.detail.deferred, a.rep.detail.aborted], [true, true])
            assert.ok(a.log.lines.some((l) => /摘要修補/.test(l) && DEFER_RE.test(l)), a.log.lines.join('\n'))
            // 對照:主呼叫耗 5 分:剩 25 分−保留 15 分＝10 分 ≥ 6 分 → 照常修補、納入
            const b = await run(5 * MIN)
            assert.deepEqual(b.calls, ['summarize', 'summarizeRepair'])
            assert.equal((await b.docs.get('d1')).status, 'noted')
            assert.equal('deferred' in b.rep.detail, false)
        })

        it('R5 忠實性覆核:各席用自己之估計——覆核席逾時 10 分 > 剩餘−保留 8 分 → 不呼叫覆核、本批不套用、不記 tries、文件留 raw;覆核席逾時 6 分 → 照常覆核', async () => {
            const SRC = 'Taiwan momentum 12-1 earns 8.2% annual excess return over 2010-2024; Sharpe 0.71.'
            const ITEM = { index: 1, relevant: true, title: '動量因子之台股實證', summary: '台股動量年化超額 8.2%', key_points: ['年化超額 8.2%'], concepts: ['動量因子', '回測'], claim_type: '實證研究', evidence_level: '中' }
            const run = async (faithMs) => {
                const vc = vclock(30 * MIN)
                const docs = memStore([{ id: 'd1', status: 'raw', title: '動量研究', text: SRC, url: 'https://e.com/d1', sourceName: 's', sourceTier: 1, collectedAt: NOW }])
                const notes = memStore()
                const calls = []
                const callAI = async (prompt, c, co) => {
                    calls.push(co.segment === 'summarizeFaith' ? `faith:${co.spec.use}` : 'summarize')
                    if (co.segment === 'summarizeFaith') {
                        const idx = [...prompt.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => Number(m[1]))
                        return { ok: true, providerId: `p-${co.spec.use}`, data: { checks: idx.map((index) => ({ index, verdict: 'faithful', reason: '與原文相符' })) } }
                    }
                    vc.spend(7 * MIN)
                    return { ok: true, data: [ITEM], providerId: 'p-sum' }
                }
                const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: false }, ai: SUM_SEAT, standards: { faithCheck: { enabled: true, ai: { first: { use: 'f1', timeoutMs: faithMs }, second: { use: 'f2', timeoutMs: faithMs } } } } }, capture: { browser: { perRun: 0 } } })
                const log = recLog()
                const rep = await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, maxTries: 3, callAI })
                    .run({ deps: { stores: { docs, notes, frontier: memStore(), holds: memStore() }, settings, clock, dirs: { notes: `${TMP}/n${++seq}` }, domains: { summarize: createSummarizeDomain({ vocab: { claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] } }) }, reserveMs: 15 * MIN }, log, remainingMs: vc.remainingMs, expired: vc.expired })
                return { rep, calls, docs, notes, log }
            }
            const a = await run(10 * MIN)
            assert.deepEqual(a.calls, ['summarize'], '覆核席估計 10 分 > 8 分 → 不呼叫覆核')
            const d = await a.docs.get('d1')
            assert.deepEqual([d.status, d.summarizeTries || 0, d.faithTries || 0, (await a.notes.select()).length], ['raw', 0, 0, 0], '未核對之結果不落地、不記次')
            assert.deepEqual([a.rep.detail.deferred, a.rep.detail.faithCalls, a.rep.detail.faithChecked], [true, 0, 0])
            assert.ok(a.log.lines.some((l) => /摘要忠實性覆核/.test(l) && DEFER_RE.test(l)), a.log.lines.join('\n'))
            const b = await run(6 * MIN)
            assert.deepEqual(b.calls, ['summarize', 'faith:f1', 'faith:f2'], '主席估計 6 分、覆核席 6 分 ≤ 8 分 → 照常覆核')
            assert.equal((await b.docs.get('d1')).status, 'noted')
        })
    })

    describe('摘要主段:延後之歸因與不延後之情形(不把他因之略過、無待摘要者算成因時間延後)', () => {
        const SRC = 'Taiwan momentum 12-1 earns 8.2% annual excess return over 2010-2024; Sharpe 0.71; costs 0.15%.'
        const VOCAB = { claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] }
        const ITEM = { index: 1, relevant: true, title: '動量因子之台股實證', summary: '台股動量年化超額 8.2%', key_points: ['年化超額 8.2%', '夏普 1.9'], concepts: ['動量因子', '回測'], claim_type: '實證研究', evidence_level: '中' }
        /** 修補或覆核呼叫回「略過」:spendMs＝該呼叫耗掉之虛擬時間(耗盡剩餘−保留＝時間所致;不耗＝額度等他因) */
        async function runSkip({ step, spendMs }) {
            const vc = vclock(30 * MIN)
            const docs = memStore([{ id: 'd1', status: 'raw', title: '動量研究', text: SRC, url: 'https://e.com/d1', sourceName: 's', sourceTier: 1, collectedAt: NOW }])
            const callAI = async (p, c, co) => {
                if (co.segment === 'summarizeRepair' || co.segment === 'summarizeFaith') {
                    await null // 兩席並行之覆核:先讓兩席皆通過送出前之判斷,時間才耗盡——歸因只能靠「呼叫中被略過」之判斷
                    vc.spend(spendMs)
                    return { ok: false, error: '略過（替身）', skipped: true, attempts: 1 }
                }
                return { ok: true, data: [step === 'repair' ? ITEM : { ...ITEM, key_points: ['年化超額 8.2%'] }], providerId: 'p-sum' }
            }
            const standards = step === 'repair' ? { repair: { enabled: true } } : { faithCheck: { enabled: true, ai: { first: { use: 'f1', timeoutMs: 6 * MIN }, second: { use: 'f2', timeoutMs: 6 * MIN } } } }
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: false }, ai: SUM_SEAT, standards }, capture: { browser: { perRun: 0 } } })
            const log = recLog()
            const rep = await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, maxTries: 3, callAI })
                .run({ deps: { stores: { docs, notes: memStore(), frontier: memStore(), holds: memStore() }, settings, clock, dirs: { notes: `${TMP}/n${++seq}` }, domains: { summarize: createSummarizeDomain({ vocab: VOCAB }) }, reserveMs: 15 * MIN }, log, remainingMs: vc.remainingMs, expired: vc.expired })
            return { rep, docs, log }
        }

        /** 忠實性覆核情境:摘要席估計 6 分(SUM_SEAT);覆核席 f1／f2(／f3)之逾時各給;主呼叫耗 mainSpend、每次覆核呼叫耗 faithSpend(皆同步推進虛擬時間);verdict＝各席之裁決 */
        async function runFaith({ firstMs = 6 * MIN, secondMs = 6 * MIN, thirdMs = 0, mainSpend = 0, faithSpend = 0, verdict = { f1: 'faithful', f2: 'faithful', f3: 'faithful' } }) {
            const vc = vclock(30 * MIN)
            const docs = memStore([{ id: 'd1', status: 'raw', title: '動量研究', text: SRC, url: 'https://e.com/d1', sourceName: 's', sourceTier: 1, collectedAt: NOW }])
            const calls = []
            const callAI = async (prompt, c, co) => {
                if (co.segment === 'summarizeFaith') {
                    calls.push(`faith:${co.spec.use}`)
                    vc.spend(faithSpend)
                    const idx = [...prompt.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => Number(m[1]))
                    return { ok: true, providerId: `p-${co.spec.use}`, data: { checks: idx.map((index) => ({ index, verdict: verdict[co.spec.use], reason: '筆記與原文不符之說明文字足夠長' })) } }
                }
                calls.push('summarize')
                vc.spend(mainSpend)
                return { ok: true, data: [{ ...ITEM, key_points: ['年化超額 8.2%'] }], providerId: 'p-sum' }
            }
            const ai = { first: { use: 'f1', timeoutMs: firstMs }, second: { use: 'f2', timeoutMs: secondMs }, ...(thirdMs ? { third: { use: 'f3', timeoutMs: thirdMs } } : {}) }
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: false }, ai: SUM_SEAT, standards: { faithCheck: { enabled: true, ai } } }, capture: { browser: { perRun: 0 } } })
            const log = recLog()
            const rep = await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, maxTries: 3, callAI })
                .run({ deps: { stores: { docs, notes: memStore(), frontier: memStore(), holds: memStore() }, settings, clock, dirs: { notes: `${TMP}/n${++seq}` }, domains: { summarize: createSummarizeDomain({ vocab: VOCAB }) }, reserveMs: 15 * MIN }, log, remainingMs: vc.remainingMs, expired: vc.expired })
            return { rep, calls, docs, log }
        }

        it('修補呼叫被略過:此刻扣保留後剩餘仍不足一次呼叫(時間所致)→ 記 deferred 並寫日誌;剩餘仍足(額度等他因)→ 同樣中止本批,但不算因時間延後(無 deferred、無該行日誌)', async () => {
            const byTime = await runSkip({ step: 'repair', spendMs: 20 * MIN })
            assert.equal(byTime.rep.detail.deferred, true)
            assert.ok(byTime.log.lines.some((l) => /摘要修補/.test(l) && DEFER_RE.test(l)), byTime.log.lines.join('\n'))
            const byOther = await runSkip({ step: 'repair', spendMs: 0 })
            assert.deepEqual([byOther.rep.detail.aborted, 'deferred' in byOther.rep.detail], [true, false], '他因略過:本批仍中止,但不是時間')
            assert.ok(!byOther.log.lines.some((l) => DEFER_RE.test(l)))
            for (const r of [byTime, byOther]) assert.deepEqual([(await r.docs.get('d1')).status, (await r.docs.get('d1')).summarizeTries || 0], ['raw', 0], '本批不套用、不記 tries')
        })

        it('忠實性覆核之呼叫被略過:同上之歸因——時間所致 → deferred 與日誌;他因 → 不附', async () => {
            const byTime = await runSkip({ step: 'faith', spendMs: 10 * MIN }) // 兩席各耗 10 分:剩餘 10 分−保留 15 分＝0 < 6 分,而整輪(30 分)未逾期
            assert.equal(byTime.rep.detail.deferred, true)
            assert.ok(byTime.log.lines.some((l) => /摘要忠實性覆核/.test(l) && DEFER_RE.test(l)), byTime.log.lines.join('\n'))
            const byOther = await runSkip({ step: 'faith', spendMs: 0 })
            assert.deepEqual([byOther.rep.detail.aborted, 'deferred' in byOther.rep.detail], [true, false])
            assert.ok(!byOther.log.lines.some((l) => DEFER_RE.test(l)))
            for (const r of [byTime, byOther]) assert.deepEqual([(await r.docs.get('d1')).status, (await r.docs.get('d1')).summarizeTries || 0, (await r.docs.get('d1')).faithTries || 0], ['raw', 0, 0])
        })

        it('無待摘要者(raw 池空,或只取已預篩放行而池中皆未預篩)→ 即使扣保留後剩餘不足一次呼叫,也不算延後、也不回報 stopped:無 deferred、無延後日誌、無「逾時間預算」WARN(與保留未給時相同)、不呼叫 AI', async () => {
            for (const [name, pool] of [['池空', []], ['皆未預篩', rawDocs(4)]]) {
                for (const reserve of [15 * MIN, 0]) {
                    const vc = vclock(20 * MIN)
                    const docs = memStore(pool) // 預篩啟用:「皆未預篩」時本段取不到件(另有 WARN 提示預篩段未執行)
                    const calls = []
                    const settings = resolveSummarizeSettings({ summarize: { ai: SUM_SEAT }, ai: { parallel: 1 } })
                    const log = recLog()
                    const rep = await stageSummarize({ domain: SUM_DOMAIN, docsPerBatch: 2, parallel: 1, rounds: 1, callAI: async () => {
                        calls.push(1)
                        return { ok: true, data: JUDGE_OFF(2) }
                    } }).run({ deps: { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings, reserveMs: reserve }, log, remainingMs: vc.remainingMs, expired: vc.expired })
                    const tag = `${name} 保留 ${reserve}`
                    assert.deepEqual([calls.length, 'deferred' in rep.detail, rep.detail.stopped, rep.detail.ready], [0, false, false, 0], tag)
                    assert.ok(!log.lines.some((l) => DEFER_RE.test(l) || /逾時間預算/.test(l)), `${tag}\n${log.lines.join('\n')}`)
                }
            }
        })

        it('主呼叫中途用盡扣保留後之預算而被調度層略過(skipped):此刻剩餘仍不足 → 記 deferred 與日誌、文件留 raw 不記 tries;他因略過(剩餘仍足)→ 不附 deferred', async () => {
            const run = async (spendMs) => {
                const vc = vclock(30 * MIN)
                const docs = memStore(rawDocs(4))
                const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: false }, ai: SUM_SEAT }, ai: { parallel: 1 } })
                const log = recLog()
                const callAI = async () => {
                    vc.spend(spendMs)
                    return { ok: false, error: '略過（替身）', skipped: true, attempts: 1 }
                }
                const rep = await stageSummarize({ domain: SUM_DOMAIN, docsPerBatch: 2, parallel: 1, rounds: 2, callAI })
                    .run({ deps: { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings, reserveMs: 15 * MIN }, log, remainingMs: vc.remainingMs, expired: vc.expired })
                return { rep, docs, log }
            }
            const byTime = await run(20 * MIN) // 耗 20 分:剩餘 10 分−保留 15 分＝0 < 6 分,而整輪(30 分)未逾期
            assert.deepEqual([byTime.rep.detail.deferred, byTime.rep.detail.aborted, byTime.rep.detail.stopped], [true, true, false])
            assert.ok(byTime.log.lines.some((l) => /^INFO 摘要：第 1\/2 輪之呼叫因扣保留時間後之預算用盡而中止/.test(l) && /raw 池 4 篇留下輪/.test(l)), byTime.log.lines.join('\n'))
            const byOther = await run(0)
            assert.deepEqual([byOther.rep.detail.aborted, 'deferred' in byOther.rep.detail], [true, false], '他因略過:剩餘仍足 → 不是時間')
            for (const r of [byTime, byOther]) {
                const st = await statusOf(r.docs, docIds(4))
                assert.equal(count(st, 'raw'), 4, '文件留 raw 池')
                for (const id of docIds(4)) assert.equal((await r.docs.get(id)).summarizeTries || 0, 0, '不記 tries')
            }
        })

        it('忠實性覆核之第一、二席並行:兩席估計不同時以較大者判一次、同進退——不會一席送出、另一席被拒而白耗(剩餘−保留 8 分;first 6 分、second 10 分 → 兩席皆不呼叫)', async () => {
            const a = await runFaith({ firstMs: 6 * MIN, secondMs: 10 * MIN, mainSpend: 7 * MIN })
            assert.deepEqual(a.calls, ['summarize'], '兩席皆不呼叫')
            assert.deepEqual([a.rep.detail.deferred, a.rep.detail.faithCalls, (await a.docs.get('d1')).status], [true, 0, 'raw'])
            assert.ok(a.log.lines.some((l) => /摘要忠實性覆核/.test(l) && DEFER_RE.test(l) && l.includes('600s')), `日誌指出較大之估計(600s):\n${a.log.lines.join('\n')}`)
            // 對照:較大者 8 分 ≤ 8 分 → 兩席皆呼叫
            const b = await runFaith({ firstMs: 6 * MIN, secondMs: 8 * MIN, mainSpend: 7 * MIN })
            assert.deepEqual(b.calls, ['summarize', 'faith:f1', 'faith:f2'])
        })

        it('忠實性覆核之第三席用自己之估計:兩席不一致須第三席,第三席估計 12 分 > 兩席耗時後之剩餘−保留 11 分 → 不呼叫第三席、本批不套用、不記次;估計 8 分 → 照常呼叫', async () => {
            const verdict = { f1: 'faithful', f2: 'unfaithful', f3: 'faithful' }
            const a = await runFaith({ thirdMs: 12 * MIN, faithSpend: 2 * MIN, verdict })
            assert.deepEqual(a.calls, ['summarize', 'faith:f1', 'faith:f2'], '第三席不呼叫')
            const d = await a.docs.get('d1')
            assert.deepEqual([a.rep.detail.deferred, d.status, d.summarizeTries || 0, d.faithTries || 0], [true, 'raw', 0, 0])
            const b = await runFaith({ thirdMs: 8 * MIN, faithSpend: 2 * MIN, verdict })
            assert.deepEqual(b.calls, ['summarize', 'faith:f1', 'faith:f2', 'faith:f3'])
            assert.equal((await b.docs.get('d1')).status, 'noted')
        })
    })

    // ══════════════════════════ 預篩段 ══════════════════════════
    describe('預篩(stageTriage)與第二席確認', () => {
        const TRI_SEAT = { use: 'x:main', timeoutMs: 6 * MIN }
        const TRI_DOMAIN = {
            buildPrompt: async (batch) => batch.map((d) => d.title).join('\n'),
            isValidItem: (it, n) => !!it && Number.isInteger(it.index) && it.index >= 1 && it.index <= n && typeof it.relevant === 'boolean',
            reasonOf: (it) => it.reason || '無關',
        }
        const titlesOf = async (p) => (await p).split('\n').filter(Boolean)

        /** 跑一次預篩(AI 替身每次耗 perCallMs 並全判相關) */
        async function runTri(o) {
            const { total, perCallMs = 0, n = 20, rounds = 4, parallel = 2, batch = 2 } = o
            const vc = vclock(total)
            const docs = memStore(o.docs || rawDocs(n))
            const calls = []
            const callAI = async (p, c, co) => {
                const ts = await titlesOf(p)
                calls.push({ budgetMs: co.budgetMs, n: ts.length })
                vc.spend(perCallMs)
                return { ok: true, providerId: 'p-tri', data: ts.map((t, i) => ({ index: i + 1, relevant: true })) }
            }
            const log = recLog()
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: true }, ai: TRI_SEAT }, ai: { parallel } })
            const opt = { domain: TRI_DOMAIN, docsPerBatch: batch, parallel, rounds, callAI, ...('optReserve' in o ? { reserveMs: o.optReserve } : {}) }
            const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings, ...('depsReserve' in o ? { reserveMs: o.depsReserve } : {}) }
            const rep = await stageTriage(opt).run({ deps, log, remainingMs: vc.remainingMs, expired: vc.expired })
            return { rep, calls, docs, log, vc }
        }
        const triaged = async (docs, ids) => (await Promise.all(ids.map((id) => docs.get(id)))).filter((d) => d.triage).length

        it('R1 開工前:剩餘 20 分、保留 15 分、一次呼叫 6 分 → 不開工:AI 0 次、待預篩池不動、detail.deferred、日誌寫明', async () => {
            const r = await runTri({ total: 20 * MIN, depsReserve: 15 * MIN })
            assert.equal(r.calls.length, 0)
            assert.equal(await triaged(r.docs, docIds(20)), 0, '未預篩者原樣留池')
            assert.deepEqual([r.rep.detail.deferred, r.rep.detail.stopped, r.rep.stats.aiCalls], [true, true, 0])
            const line = r.log.lines.find((l) => DEFER_RE.test(l))
            assert.ok(line && line.includes('300s') && line.includes('360s') && line.includes('20 篇'), r.log.lines.join('\n'))
            assert.ok(r.log.lines.some((l) => /預篩池 20 篇，本輪容量 16/.test(l)), '本輪容量日誌照印')
        })

        it('R2 每輪開工前:剩餘 30 分、保留 15 分、一次呼叫 6 分、每次耗 5 分 → 第 1 輪(2 批)後第 2 輪不開工;預篩 parallel×docsPerCall＝4 篇,其餘留池', async () => {
            const r = await runTri({ total: 30 * MIN, perCallMs: 5 * MIN, depsReserve: 15 * MIN })
            assert.equal(r.calls.length, 2)
            assert.equal(await triaged(r.docs, docIds(20)), 4)
            assert.deepEqual([r.rep.detail.deferred, r.rep.detail.stopped, r.rep.detail.processed], [true, true, 4])
            assert.ok(r.log.lines.some((l) => /預篩：因時間提前結束於第 2\/4 輪/.test(l)), r.log.lines.join('\n'))
            assert.deepEqual(r.calls.map((c) => c.budgetMs), [15 * MIN, 15 * MIN], 'budgetMs＝剩餘−保留')
        })

        it('R6 保留未給:行為不變——剩餘 1 分仍開工、budgetMs＝整輪剩餘、4 輪全走、不附 deferred', async () => {
            const a = await runTri({ total: 1 * MIN, parallel: 1, n: 4, rounds: 1 })
            assert.deepEqual([a.calls.length, a.calls[0].budgetMs, 'deferred' in a.rep.detail], [1, 1 * MIN, false])
            const b = await runTri({ total: 60 * MIN, perCallMs: 5 * MIN })
            assert.deepEqual([b.calls.length, await triaged(b.docs, docIds(20)), 'deferred' in b.rep.detail], [8, 16, false])
        })

        it('R7 取值同重標:opt 優先(含 0)、null 取 deps、函數每輪求值;不合法 → 建構即拋／該輪拋出', async () => {
            const hold = await runTri({ total: 20 * MIN, depsReserve: 15 * MIN, optReserve: 0 })
            assert.ok(hold.calls.length > 0 && !('deferred' in hold.rep.detail))
            const viaNull = await runTri({ total: 20 * MIN, depsReserve: 15 * MIN, optReserve: null })
            assert.deepEqual([viaNull.calls.length, viaNull.rep.detail.deferred], [0, true])
            const viaFn = await runTri({ total: 20 * MIN, optReserve: () => 15 * MIN })
            assert.deepEqual([viaFn.calls.length, viaFn.rep.detail.deferred], [0, true])
            for (const bad of [-1, Number.NaN, Infinity, '900000', true, {}]) {
                assert.throws(() => stageTriage({ reserveMs: bad }), /stageTriage 之 opt\.reserveMs 須為非負毫秒數或 \(ctx\) => 毫秒數/, String(bad))
            }
            await assert.rejects(() => runTri({ total: 20 * MIN, depsReserve: -1 }), /stageTriage 之 deps\.reserveMs 須為非負毫秒數或 \(ctx\) => 毫秒數，收到 -1/)
            // 停用預篩者不取值(不因依賴不合而拋)
            const off = await stageTriage({ enabled: false }).run({ deps: { settings: resolveSummarizeSettings({}), reserveMs: -1 }, log: recLog() })
            assert.equal(off.detail.disabled, true)
        })

        // ── 第二席確認(SS5):待確認者來自前輪(池中無待預篩者) ──
        const CONFIRM = (extra = {}) => ({ standards: { triageConfirm: { enabled: true, ai: { first: { use: 'cf', timeoutMs: 6 * MIN }, third: { use: 'cf3', timeoutMs: 12 * MIN }, ...extra } } } })
        const pending = (ids) => ids.map((id, i) => ({ id, status: 'raw', title: `待確認${id}`, collectedAt: '2026-11-01T00:00:00+08:00', triage: 'reject-pending', triagedAt: `2026-11-01T01:0${i}:00+08:00`, triageRejectBy: 'p-tri', triageRejectReason: '與知識庫無關之例行公告' }))
        /** 只跑確認段:cfVerdict／cf3Verdict 為各席對每篇之判定;每次呼叫耗 spendMs */
        async function runConfirm({ ids, total, spendMs = 0, cfVerdict = false, cf3Verdict = false, batch = 2, rounds = 2, third = {}, reserve = 15 * MIN, skipCf = false }) {
            const vc = vclock(total)
            const docs = memStore(pending(ids))
            const calls = []
            const callAI = async (p, c, co) => {
                const ts = await titlesOf(p)
                calls.push(co.spec.use)
                vc.spend(spendMs)
                if (skipCf) return { ok: false, error: '略過（替身）', skipped: true, attempts: 1 }
                const v = co.spec.use === 'cf' ? cfVerdict : cf3Verdict
                return { ok: true, providerId: `p-${co.spec.use}`, data: ts.map((t, i) => ({ index: i + 1, relevant: v, reason: '與知識庫無關之例行公告' })) }
            }
            const log = recLog()
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: true }, ai: TRI_SEAT, ...CONFIRM(third) }, ai: { parallel: 1 } })
            const rep = await stageTriage({ domain: TRI_DOMAIN, docsPerBatch: batch, parallel: 1, rounds, maxTries: 3, callAI })
                .run({ deps: { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings, reserveMs: reserve }, log, remainingMs: vc.remainingMs, expired: vc.expired })
            return { rep, calls, docs, log }
        }

        it('R4 確認段開工前:剩餘−保留 5 分 < 確認席 6 分 → 不確認:AI 0 次、待確認者原樣留待下輪(不記次)、deferred、日誌寫明篇數', async () => {
            const r = await runConfirm({ ids: ['a', 'b', 'c', 'd'], total: 20 * MIN })
            assert.equal(r.calls.length, 0)
            const st = await statusOf(r.docs, ['a', 'b', 'c', 'd'])
            assert.equal(count(st, 'raw'), 4)
            for (const id of ['a', 'b', 'c', 'd']) assert.deepEqual([(await r.docs.get(id)).triage, (await r.docs.get(id)).triageConfirmTries || 0], ['reject-pending', 0])
            assert.equal(r.rep.detail.deferred, true)
            const line = r.log.lines.find((l) => /預篩第二席確認/.test(l) && DEFER_RE.test(l))
            assert.ok(line && line.includes('4 篇'), r.log.lines.join('\n'))
            assert.ok(!r.log.lines.some((l) => /^INFO 預篩：扣保留時間後剩餘/.test(l)), '預篩池空:不寫「本輪不預篩」(只有確認段延後)')
        })

        it('R6 確認段迴圈(保留未給):整輪逾期後其餘批次不再開工(維持現版之逾期守門)——第 1 批耗盡整輪預算 → 第 2 批不確認、不呼叫 AI', async () => {
            const r = await runConfirm({ ids: ['a', 'b', 'c', 'd'], total: 10 * MIN, spendMs: 10 * MIN, reserve: 0 })
            assert.deepEqual(r.calls, ['cf'])
            const st = await statusOf(r.docs, ['a', 'b', 'c', 'd'])
            assert.deepEqual([st.a, st.b, st.c, st.d], ['skip', 'skip', 'raw', 'raw'])
            assert.equal('deferred' in r.rep.detail, false, '逾期屬一般截止,非保留所致')
        })

        it('整輪已逾期(保留 > 0):一輪都不開工(維持批次調度之既有守門);非因保留,故無 deferred、無延後日誌', async () => {
            const r = await runTri({ total: 0, depsReserve: 15 * MIN })
            assert.deepEqual([r.calls.length, r.rep.detail.stopped, 'deferred' in r.rep.detail], [0, true, false])
            assert.ok(!r.log.lines.some((l) => DEFER_RE.test(l)))
        })

        it('R4 確認段迴圈:每批開工前同判——第 1 批耗 10 分後剩餘−保留 5 分 < 6 分 → 第 2 批不確認,其餘留待下輪;已確認者照常落帳', async () => {
            const r = await runConfirm({ ids: ['a', 'b', 'c', 'd'], total: 30 * MIN, spendMs: 10 * MIN })
            assert.deepEqual(r.calls, ['cf'], '只呼叫第 1 批')
            const st = await statusOf(r.docs, ['a', 'b', 'c', 'd'])
            assert.deepEqual([st.a, st.b, st.c, st.d], ['skip', 'skip', 'raw', 'raw'], 'a、b 兩席同判無關 → 攔下;c、d 留待下輪')
            assert.equal((await r.docs.get('c')).triageConfirmTries || 0, 0, '不記次')
            assert.deepEqual([r.rep.detail.confirmed, r.rep.detail.deferred], [2, true])
            assert.ok(r.log.lines.some((l) => /預篩第二席確認：因時間提前結束/.test(l)), r.log.lines.join('\n'))
        })

        it('R4 第三席用自己之估計:第三席逾時 12 分 > 剩餘−保留 10 分 → 不呼叫第三席,須第三席之篇留待下輪(不記次);第三席逾時 8 分 → 照常呼叫', async () => {
            const a = await runConfirm({ ids: ['x'], total: 30 * MIN, spendMs: 5 * MIN, cfVerdict: true, cf3Verdict: false, batch: 1, rounds: 1 })
            assert.deepEqual(a.calls, ['cf'], '第三席不呼叫')
            const x = await a.docs.get('x')
            assert.deepEqual([x.status, x.triage, x.triageConfirmTries || 0, a.rep.detail.deferred], ['raw', 'reject-pending', 0, true])
            const b = await runConfirm({ ids: ['x'], total: 30 * MIN, spendMs: 5 * MIN, cfVerdict: true, cf3Verdict: false, batch: 1, rounds: 1, third: { third: { use: 'cf3', timeoutMs: 8 * MIN } } })
            assert.deepEqual(b.calls, ['cf', 'cf3'])
            assert.equal((await b.docs.get('x')).status, 'skip', '預篩席與第三席同判無關 → 攔下')
            assert.equal('deferred' in b.rep.detail, false)
        })

        it('呼叫中途用盡扣保留後之預算而被略過(skipped):預篩主迴圈與確認席皆——此刻剩餘仍不足 → 記 deferred 與日誌、文件原樣留池不記次;他因略過(剩餘仍足)→ 不附 deferred', async () => {
            const runMain = async (spendMs) => {
                const vc = vclock(30 * MIN)
                const docs = memStore(rawDocs(4))
                const log = recLog()
                const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: true }, ai: TRI_SEAT }, ai: { parallel: 1 } })
                const callAI = async () => {
                    vc.spend(spendMs)
                    return { ok: false, error: '略過（替身）', skipped: true, attempts: 1 }
                }
                const rep = await stageTriage({ domain: TRI_DOMAIN, docsPerBatch: 2, parallel: 1, rounds: 2, callAI })
                    .run({ deps: { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings, reserveMs: 15 * MIN }, log, remainingMs: vc.remainingMs, expired: vc.expired })
                return { rep, docs, log }
            }
            const byTime = await runMain(20 * MIN)
            assert.deepEqual([byTime.rep.detail.deferred, byTime.rep.detail.aborted, byTime.rep.detail.stopped], [true, true, false])
            assert.ok(byTime.log.lines.some((l) => /^INFO 預篩：第 1\/2 輪之呼叫因扣保留時間後之預算用盡而中止/.test(l) && /未預篩者 4 篇留下輪/.test(l)), byTime.log.lines.join('\n'))
            const byOther = await runMain(0)
            assert.deepEqual([byOther.rep.detail.aborted, 'deferred' in byOther.rep.detail], [true, false])
            for (const r of [byTime, byOther]) {
                assert.equal(await triaged(r.docs, docIds(4)), 0, '未預篩者原樣留池')
                for (const id of docIds(4)) assert.equal((await r.docs.get(id)).triageTries || 0, 0, '不記次')
            }
            // 確認席(first):耗 20 分後被略過 → 其後不再呼叫;待確認者留待下輪不記次
            const c1 = await runConfirm({ ids: ['a', 'b'], total: 30 * MIN, spendMs: 20 * MIN, skipCf: true, batch: 2, rounds: 1 })
            assert.deepEqual([c1.calls, c1.rep.detail.deferred, (await c1.docs.get('a')).triage, (await c1.docs.get('a')).triageConfirmTries || 0], [['cf'], true, 'reject-pending', 0])
            assert.ok(c1.log.lines.some((l) => /預篩第二席確認：因時間提前結束/.test(l)), c1.log.lines.join('\n'))
            const c2 = await runConfirm({ ids: ['a', 'b'], total: 30 * MIN, spendMs: 0, skipCf: true, batch: 2, rounds: 1 })
            assert.deepEqual([c2.calls, 'deferred' in c2.rep.detail], [['cf'], false], '他因略過:不是時間')
        })

        it('R4 無待確認者:確認席門檻不成立也不算延後——預篩全數放行、無待確認 → 無 deferred、無確認段日誌', async () => {
            const vc = vclock(20 * MIN)
            const docs = memStore(rawDocs(2))
            const log = recLog()
            // 預篩席逾時 1 分(扣保留後 5 分足夠),確認席 first 逾時 6 分(5 分不足)
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: true }, ai: { use: 'x:main', timeoutMs: 1 * MIN }, ...CONFIRM() }, ai: { parallel: 1 } })
            const callAI = async (p) => ({ ok: true, providerId: 'p-tri', data: (await titlesOf(p)).map((t, i) => ({ index: i + 1, relevant: true })) })
            const rep = await stageTriage({ domain: TRI_DOMAIN, docsPerBatch: 2, parallel: 1, rounds: 1, callAI })
                .run({ deps: { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings, reserveMs: 15 * MIN }, log, remainingMs: vc.remainingMs, expired: vc.expired })
            assert.deepEqual([rep.detail.relevant, rep.detail.confirmCalls, 'deferred' in rep.detail], [2, 0, false])
            assert.ok(!log.lines.some((l) => /預篩第二席確認：/.test(l) && DEFER_RE.test(l)), log.lines.join('\n'))
        })

        it('R6 確認段保留未給:行為不變——剩餘 1 分仍確認、不附 deferred', async () => {
            const r = await runConfirm({ ids: ['a', 'b'], total: 1 * MIN, reserve: 0, batch: 2, rounds: 1 })
            assert.deepEqual(r.calls, ['cf'])
            assert.deepEqual([(await r.docs.get('a')).status, 'deferred' in r.rep.detail], ['skip', false])
        })
    })
})
