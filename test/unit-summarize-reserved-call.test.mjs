// unit-summarize-reserved-call.test.mjs — 預篩、第二席確認(SS5)、摘要、修補、忠實性覆核(SS14)扣保留之 AI 呼叫一律經抓取套件之 reservedAiCallOf
//   (重標之接線案見 unit-summarize-retag〈扣保留之 AI 呼叫〉;保留時間之開工、每輪、延後歸因各案見 unit-summarize-reserve)
// 規則(出自 stages/triageStage、stages/noteStage 檔頭與抓取套件 core/ai/reservedCall 之 JSDoc;設計:跨套件之扣保留 AI 呼叫之單一包裝):
//   W1 進門:每次送出前以該席位一次呼叫之估計(抓取套件 captureCallMsOf;保留為 0 時為 0)判「扣保留後剩餘 ≥ 估計」,不成立 → 不送出(同調度層之略過);
//     保留為 0 時只看整輪是否逾期(已逾期者每次送出前即不送出);判定小組之呼叫次數(confirmCalls、faithCalls)只計確實送出者
//   W2 鏈內:交調度層之 shouldStop 以續派門檻判——min(進門門檻, 席位 minAttemptMs ?? 60 秒);扣保留後剩餘 ≥ 續派門檻 → false、< → true
//     (改前以進門門檻判:主席等滿逾時後之剩餘即小於它,遞補一律被中止);各席各用自己之進門門檻與席位
//   W3 預算:budgetMs＝扣保留後剩餘
//   W4 覆寫之 callAI 收到之 callOpt 鍵與改前同:預篩主呼叫與摘要主呼叫不含 spec;確認、修補、覆核含 spec 與 segment;皆不含 startMs、minAttemptMs
//   W5 忠實性覆核之執行器:第一席同步拋出 → 第二席不被呼叫(包裝不得為 async)
//   W6 接縫(不用替身:真調度層＝抓取套件 createAiAdapter＋w-dispatch-ai,AI 為本機假 OpenAI 相容伺服器):主席失敗後,扣保留後剩餘 ≥ 續派門檻即派遞補
//     (伺服器收到第二家之請求)、< 即不派(本批略過,文件留 raw、不記 tries)
//   W7 舊件已刪(不留相容層):主入口不再匯出 summarizeCallMsOf、reserveGateOf;保留時間取值器 reserveFnOf 照舊
//   W8 內建調度層之路徑(未覆寫 callAI):callJson 收到 spec(該席位)、budgetMs(扣保留後剩餘,有限值)、以續派門檻判之 shouldStop;不帶 segment
// 時間以可控之 ctx 時鐘同步(先以足夠時間進門,再於呼叫中推進時鐘後呼叫 callOpt.shouldStop()),不用真實等待。各席之估計與續派門檻取兩組設定:
//   一組「估計 > 續派門檻」(改回舊寫法即可分辨)、一組「估計 < 60 秒」(改用他席之估計即可分辨),並含席位 minAttemptMs 高於 60 秒者
// 執行:自套件根 node node_modules/mocha/bin/mocha.js test/unit-summarize-reserved-call.test.mjs(暫存 test/_tmp/summarize-reserved-call-<pid>,測完即刪;
//   W6 監聽固定埠 8847〔本檔專屬〕)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memStore, createAiAdapter, genClockTZ, startServer } from './tools/captureForTest.mjs'
import { recLog } from './tools/stageKit.mjs'
import { resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { checkRepairReply } from '../src/standards/noteRepair.mjs'
import { checkFaithChecks } from '../src/standards/faithCheck.mjs'
import { stageTriage } from '../src/stages/triageStage.mjs'
import { stageSummarize } from '../src/stages/noteStage.mjs'
import * as WKS from '../src/WKnowledgeSummarize.mjs'

const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/summarize-reserved-call-${process.pid}`).replace(/\\/g, '/')
const REST_PORT = 8847 // 本機假 REST(固定埠;本檔專屬)
const MIN = 60_000
const RES = 15 * MIN // 保留
const NOW = '2026-11-11T10:00:00+08:00'
const clock = { iso8: () => NOW }
const VOCAB = { claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] }
let seq = 0

/** 可控之 ctx 時鐘:剩餘毫秒數由測試直接設定 */
function ctl(totalMs) {
    let left = totalMs
    return {
        remainingMs: () => left,
        expired: () => left <= 0,
        get: () => left,
        set: (ms) => {
            left = ms
        },
    }
}

/**
 * 於呼叫中(已以足夠時間進門)推進時鐘並呼叫 callOpt.shouldStop():回 [扣保留後剩餘＝續派門檻 時之值, ＝門檻−1 毫秒 時之值];完後還原時鐘
 *
 * @param {Object} co 輸入 callAI／callJson 收到之 callOpt
 * @param {Object} ck 輸入 ctl 時鐘
 * @param {Number} stepMs 輸入預期之續派門檻
 * @param {Number} [keep=RES] 輸入保留毫秒數
 * @returns {Array} 回傳 [Boolean, Boolean]
 */
function probe(co, ck, stepMs, keep = RES) {
    const saved = ck.get()
    ck.set(keep + stepMs)
    const at = co.shouldStop()
    ck.set(keep + stepMs - 1)
    const below = co.shouldStop()
    ck.set(saved)
    return [at, below]
}

const rawDocs = (n) => Array.from({ length: n }, (_, i) => ({ id: `d${i + 1}`, status: 'raw', title: `文件${i + 1}`, collectedAt: `2026-11-01T00:0${i}:00+08:00` }))
const JUDGE_OFF = (n) => Array.from({ length: n }, (_, i) => ({ index: i + 1, relevant: false, reason: '測試：判非知識' }))
const SUM_DOMAIN = { buildPrompt: async () => 'p', isValidItem: () => true }
const TRI_DOMAIN = {
    buildPrompt: async (batch) => batch.map((d) => d.title).join('\n'),
    isValidItem: (it, n) => !!it && Number.isInteger(it.index) && it.index >= 1 && it.index <= n && typeof it.relevant === 'boolean',
    reasonOf: (it) => it.reason || '無關',
}
const keysOf = (co) => Object.keys(co).sort()
const faithIdx = (prompt) => [...prompt.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => Number(m[1]))

describe('unit-summarize-reserved-call', function() {

    before(() => fs.mkdirSync(TMP, { recursive: true }))
    after(() => fs.rmSync(TMP, { recursive: true, force: true }))

    // ══════════════════════════ 預篩(stageTriage)與第二席確認(SS5) ══════════════════════════
    describe('預篩主呼叫與 SS5 第一／第三席', () => {
        const TRI_SEAT = { use: 'x:tri', timeoutMs: 6 * MIN }

        /** 跑一輪預篩:覆寫之 callAI(或 deps.ai)由測試給;settings 之預篩席 seat、確認席 confirm(給了即開確認) */
        async function runTri({ ck, callAI, ai, seat = TRI_SEAT, confirm, n = 1, parallel = 1, batch = 1, reserve = RES }) {
            const docs = memStore(rawDocs(n))
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: true, ai: seat }, ai: { use: 'x:main' }, ...(confirm ? { standards: { triageConfirm: { enabled: true, ai: confirm } } } : {}) }, ai: { parallel } })
            const log = recLog()
            const rep = await stageTriage({ domain: TRI_DOMAIN, docsPerBatch: batch, parallel, rounds: 1, ...(callAI ? { callAI } : {}) })
                .run({ deps: { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings, reserveMs: reserve, ...(ai ? { ai } : {}) }, log, remainingMs: ck.remainingMs, expired: ck.expired })
            return { rep, docs, log, settings }
        }

        it('W2／W3／W4 預篩主呼叫:扣保留後剩餘＝續派門檻(席位無 minAttemptMs → 60 秒;20 秒 → 20 秒;90 秒 → 90 秒)時 shouldStop 為 false、少 1 毫秒為 true;budgetMs＝剩餘−保留;callOpt 鍵不變(無 spec)', async () => {
            for (const [seat, step] of [[TRI_SEAT, 60_000], [{ ...TRI_SEAT, minAttemptMs: 20_000 }, 20_000], [{ ...TRI_SEAT, minAttemptMs: 90_000 }, 90_000]]) {
                const ck = ctl(30 * MIN)
                const seen = []
                const callAI = async (p, c, co) => {
                    seen.push({ keys: keysOf(co), budgetMs: co.budgetMs, probe: probe(co, ck, step) })
                    return { ok: true, data: [{ index: 1, relevant: true }] }
                }
                const r = await runTri({ ck, callAI, seat })
                assert.equal(seen.length, 1)
                assert.deepEqual(seen[0].keys, ['acceptTruncated', 'budgetMs', 'shouldStop'], 'W4:覆寫之 callAI 不收 spec、startMs、minAttemptMs')
                assert.equal(seen[0].budgetMs, 15 * MIN, 'W3:30 分−保留 15 分')
                assert.deepEqual(seen[0].probe, [false, true], `W2:續派門檻 ${step}(席位 ${JSON.stringify(seat)})`)
                assert.equal((await r.docs.get('d1')).triage, 'relevant')
            }
        })

        it('W1 預篩主呼叫逐次進門:同一輪兩批並行,第一批送出後扣保留後剩餘不足一次呼叫(6 分)→ 第二批不送出(未預篩、不記次);恰等於 → 送出', async () => {
            for (const [spend, sent] of [[4 * MIN, 2], [4 * MIN + 1, 1]]) {
                const ck = ctl(RES + 10 * MIN)
                const calls = []
                const callAI = async (p, c, co) => {
                    calls.push(p)
                    ck.set(ck.get() - spend) // 送出即耗時(同步推進)
                    return { ok: true, data: [{ index: 1, relevant: true }] }
                }
                const r = await runTri({ ck, callAI, n: 2, parallel: 2 })
                assert.equal(calls.length, sent, `第一批耗 ${spend} 毫秒`)
                if (sent === 1) {
                    const left = calls[0].includes('文件1') ? 'd2' : 'd1'
                    const d = await r.docs.get(left)
                    assert.deepEqual([d.triage, d.triageTries || 0], [undefined, 0], '未送出者留池、不記次')
                }
            }
        })

        it('W2／W4 SS5 第一席與第三席各用自己之進門門檻與續派門檻(兩組:第一席 45 秒 → 45 秒、第三席 4 分＋minAttemptMs 90 秒 → 90 秒;第一席 5 分 → 60 秒、第三席 30 秒 → 30 秒);callOpt 含 spec 與 segment:triageConfirm', async () => {
            const GROUPS = [
                { first: { use: 'x:c1', timeoutMs: 45_000 }, third: { use: 'x:c3', timeoutMs: 4 * MIN, minAttemptMs: 90_000 }, steps: { 'x:c1': 45_000, 'x:c3': 90_000 } },
                { first: { use: 'x:c1', timeoutMs: 5 * MIN }, third: { use: 'x:c3', timeoutMs: 30_000 }, steps: { 'x:c1': 60_000, 'x:c3': 30_000 } },
            ]
            for (const g of GROUPS) {
                const ck = ctl(30 * MIN)
                const seen = []
                const callAI = async (p, c, co) => {
                    if (co.segment !== 'triageConfirm') return { ok: true, providerId: 'p-tri', data: [{ index: 1, relevant: false, reason: '無關' }] } // 預篩席判無關 → 待確認
                    seen.push({ use: co.spec.use, keys: keysOf(co), budgetMs: co.budgetMs, probe: probe(co, ck, g.steps[co.spec.use]) })
                    return { ok: true, providerId: `p-${co.spec.use}`, data: [{ index: 1, relevant: true }] } // 第一席判相關 → 不一致 → 第三席
                }
                const r = await runTri({ ck, callAI, confirm: { first: g.first, third: g.third } })
                const tag = JSON.stringify(g.steps)
                assert.deepEqual(seen.map((x) => x.use), ['x:c1', 'x:c3'], tag)
                for (const x of seen) {
                    assert.deepEqual(x.keys, ['acceptTruncated', 'budgetMs', 'segment', 'shouldStop', 'spec'], `W4 ${x.use} ${tag}`)
                    assert.equal(x.budgetMs, 15 * MIN, `W3 ${x.use} ${tag}`)
                    assert.deepEqual(x.probe, [false, true], `W2 ${x.use}:續派門檻 ${g.steps[x.use]}`)
                }
                assert.deepEqual([(await r.docs.get('d1')).triage, r.rep.detail.confirmCalls], ['relevant', 2], '兩席成立相關 → 放行;送出 2 次')
            }
        })

        it('W1 SS5 保留為 0:第一席送出後整輪逾期 → 第三席不送出(待確認者留待下輪);confirmCalls 只計確實送出者(1)', async () => {
            const ck = ctl(30 * MIN)
            const confirmed = []
            const callAI = async (p, c, co) => {
                if (co.segment !== 'triageConfirm') return { ok: true, providerId: 'p-tri', data: [{ index: 1, relevant: false, reason: '無關' }] }
                confirmed.push(co.spec.use)
                ck.set(0) // 第一席送出後整輪逾期
                return { ok: true, providerId: `p-${co.spec.use}`, data: [{ index: 1, relevant: true }] }
            }
            const r = await runTri({ ck, callAI, reserve: 0, confirm: { first: { use: 'x:c1', timeoutMs: 5 * MIN }, third: { use: 'x:c3', timeoutMs: 5 * MIN } } })
            assert.deepEqual(confirmed, ['x:c1'], '第三席未送出')
            assert.equal(r.rep.detail.confirmCalls, 1)
            assert.equal((await r.docs.get('d1')).triage, 'reject-pending', '須第三席之篇留待下輪')
        })

        it('W8 內建調度層之路徑(未覆寫 callAI):預篩主呼叫與 SS5 兩席之 callJson 收到 spec(該席位)、budgetMs(有限)、以續派門檻判之 shouldStop、acceptTruncated;不帶 segment', async () => {
            const ck = ctl(30 * MIN)
            const confirm = { first: { use: 'x:c1', timeoutMs: 45_000 }, third: { use: 'x:c3', timeoutMs: 4 * MIN, minAttemptMs: 90_000 } }
            const steps = { 'x:tri': 60_000, 'x:c1': 45_000, 'x:c3': 90_000 }
            const seen = []
            const ai = {
                callJson: (p, c, o) => {
                    seen.push({ spec: o.spec, keys: keysOf(o), budgetMs: o.budgetMs, probe: probe(o, ck, steps[o.spec?.use]) })
                    const relevant = o.spec?.use !== 'x:tri' // 預篩席判無關 → 第一席判相關 → 第三席
                    return Promise.resolve({ ok: true, providerId: `p-${o.spec?.use}`, data: [{ index: 1, relevant, reason: '無關' }] })
                },
            }
            const r = await runTri({ ck, ai, confirm })
            const seatOf = { 'x:tri': r.settings.summarize.triage.ai, 'x:c1': r.settings.summarize.standards.triageConfirm.ai.first, 'x:c3': r.settings.summarize.standards.triageConfirm.ai.third }
            assert.deepEqual(seen.map((x) => x.spec.use), ['x:tri', 'x:c1', 'x:c3'])
            for (const x of seen) {
                assert.deepEqual(x.spec, seatOf[x.spec.use], `spec 為該席位 ${x.spec.use}`)
                assert.deepEqual(x.keys, ['acceptTruncated', 'budgetMs', 'shouldStop', 'spec'], `鍵 ${x.spec.use}(不帶 segment)`)
                assert.equal(x.budgetMs, 15 * MIN, `budgetMs ${x.spec.use}`)
                assert.deepEqual(x.probe, [false, true], `續派門檻 ${x.spec.use}:${steps[x.spec.use]}`)
            }
        })
    })

    // ══════════════════════════ 摘要(stageSummarize):主呼叫、修補、忠實性覆核 ══════════════════════════
    describe('摘要主呼叫、修補、SS14 三席', () => {
        const SUM_SEAT = { use: 'x:main', timeoutMs: 6 * MIN }
        const SRC = 'Taiwan momentum 12-1 earns 8.2% annual excess return over 2010-2024; Sharpe 0.71; costs 0.15%.'
        const ITEM = { index: 1, relevant: true, title: '動量因子之台股實證', summary: '台股動量年化超額 8.2%', key_points: ['年化超額 8.2%'], concepts: ['動量因子', '回測'], claim_type: '實證研究', evidence_level: '中' }
        const ITEM_REPAIR = { ...ITEM, key_points: ['年化超額 8.2%', '夏普 1.9'] } // 原文沒有之數字 → 須修補

        /** 跑一輪摘要(只一篇有原文之文件;standards 為 summarize.standards;覆寫之 callAI 或 deps.ai 擇一) */
        async function runNote({ ck, callAI, ai, seat = SUM_SEAT, standards = {}, reserve = RES }) {
            const docs = memStore([{ id: 'd1', status: 'raw', title: '動量研究', text: SRC, url: 'https://e.com/d1', sourceName: 's', sourceTier: 1, collectedAt: NOW }])
            const notes = memStore()
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: false }, ai: seat, standards }, capture: { browser: { perRun: 0 } } })
            const log = recLog()
            const rep = await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, maxTries: 3, ...(callAI ? { callAI } : {}) })
                .run({ deps: { stores: { docs, notes, frontier: memStore(), holds: memStore() }, settings, clock, dirs: { notes: `${TMP}/n${++seq}` }, domains: { summarize: createSummarizeDomain({ vocab: VOCAB }) }, reserveMs: reserve, ...(ai ? { ai } : {}) }, log, remainingMs: ck.remainingMs, expired: ck.expired })
            return { rep, docs, notes, log, settings }
        }

        it('W2／W3／W4 摘要主呼叫:續派門檻 min(摘要席一次呼叫, 席位 minAttemptMs ?? 60 秒)(60 秒／30 秒／90 秒);budgetMs＝剩餘−保留;callOpt 鍵不變(無 spec;末次重試之 avoid 照給)', async () => {
            for (const [seat, step] of [[SUM_SEAT, 60_000], [{ ...SUM_SEAT, minAttemptMs: 30_000 }, 30_000], [{ ...SUM_SEAT, minAttemptMs: 90_000 }, 90_000]]) {
                const ck = ctl(30 * MIN)
                const seen = []
                const callAI = async (p, c, co) => {
                    seen.push({ keys: keysOf(co), budgetMs: co.budgetMs, probe: probe(co, ck, step) })
                    return { ok: true, data: [ITEM], providerId: 'p-sum' }
                }
                const r = await runNote({ ck, callAI, seat })
                assert.equal(seen.length, 1)
                assert.deepEqual(seen[0].keys, ['acceptTruncated', 'budgetMs', 'shouldStop'], 'W4')
                assert.equal(seen[0].budgetMs, 15 * MIN, 'W3')
                assert.deepEqual(seen[0].probe, [false, true], `W2:續派門檻 ${step}`)
                assert.equal((await r.docs.get('d1')).status, 'noted')
            }
            // 末次重試避開曾產出不合格者之供應者(avoid;站特有之語意)經包裝原樣轉交
            const ck = ctl(30 * MIN)
            const docs = memStore([{ id: 'd1', status: 'raw', title: '動量研究', text: SRC, url: 'https://e.com/d1', sourceName: 's', collectedAt: NOW, summarizeTries: 2, summarizeProviders: 'p-bad' }])
            const got = []
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: false }, ai: SUM_SEAT }, capture: { browser: { perRun: 0 } } })
            const callAI = async (p, c, co) => {
                got.push(co.avoid)
                return { ok: true, data: [ITEM], providerId: 'p-sum' }
            }
            await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, maxTries: 3, callAI }).run({ deps: { stores: { docs, notes: memStore(), frontier: memStore(), holds: memStore() }, settings, clock, dirs: { notes: `${TMP}/n${++seq}` }, domains: { summarize: createSummarizeDomain({ vocab: VOCAB }) }, reserveMs: RES }, log: recLog(), remainingMs: ck.remainingMs, expired: ck.expired })
            assert.deepEqual(got, [['p-bad']])
        })

        it('W1 摘要主呼叫逐次進門:同一輪兩批並行,第一批送出後扣保留後剩餘不足摘要席一次呼叫(6 分)→ 第二批不送出(留 raw、不記 tries);恰等於 → 送出;保留為 0 而第一批送出後整輪逾期 → 第二批亦不送出', async () => {
            for (const [reserve, spend, sent] of [[RES, 4 * MIN, 2], [RES, 4 * MIN + 1, 1], [0, Infinity, 1]]) {
                const ck = ctl(RES + 10 * MIN)
                const calls = []
                const callAI = async (p, c, co) => {
                    calls.push(1)
                    ck.set(Math.max(0, ck.get() - spend))
                    return { ok: true, data: JUDGE_OFF(1) }
                }
                const docs = memStore(rawDocs(2))
                const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: false }, ai: SUM_SEAT }, ai: { parallel: 2 } })
                const rep = await stageSummarize({ domain: SUM_DOMAIN, docsPerBatch: 1, parallel: 2, rounds: 1, callAI, packByChars: false })
                    .run({ deps: { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings, reserveMs: reserve }, log: recLog(), remainingMs: ck.remainingMs, expired: ck.expired })
                const tag = `保留 ${reserve}、第一批耗 ${spend}`
                assert.equal(calls.length, sent, tag)
                const st = await Promise.all(['d1', 'd2'].map((id) => docs.get(id)))
                if (sent === 1) {
                    assert.deepEqual(st.map((d) => d.status).sort(), ['raw', 'skip'], `${tag}:未送出者留 raw`)
                    assert.deepEqual(st.map((d) => d.summarizeTries || 0), [0, 0], `${tag}:不記 tries`)
                    assert.equal(rep.detail.aborted, true, tag)
                }
            }
        })

        it('W2／W4 修補:席位＝摘要席;事前預判照舊(主呼叫後剩餘足一次呼叫才送出);送出後續派門檻 min(摘要席估計, 席位 minAttemptMs ?? 60 秒)(60 秒／90 秒);callOpt 含 spec 與 segment:summarizeRepair', async () => {
            for (const [seat, step] of [[SUM_SEAT, 60_000], [{ ...SUM_SEAT, minAttemptMs: 90_000 }, 90_000]]) {
                const ck = ctl(30 * MIN)
                const seen = []
                const callAI = async (p, c, co) => {
                    if (co.segment === 'summarizeRepair') {
                        seen.push({ keys: keysOf(co), use: co.spec?.use, budgetMs: co.budgetMs, probe: probe(co, ck, step) })
                        return { ok: true, data: { repairs: [{ no: 1, value: '夏普值 0.71' }] }, providerId: 'p-sum' }
                    }
                    return { ok: true, data: [ITEM_REPAIR], providerId: 'p-sum' }
                }
                const r = await runNote({ ck, callAI, seat, standards: { repair: { enabled: true } } })
                assert.equal(seen.length, 1, '修補呼叫一次')
                assert.deepEqual(seen[0].keys, ['budgetMs', 'segment', 'shouldStop', 'spec'], 'W4(物件輸出,不給截斷放行)')
                assert.equal(seen[0].use, 'x:main')
                assert.equal(seen[0].budgetMs, 15 * MIN)
                assert.deepEqual(seen[0].probe, [false, true], `W2:續派門檻 ${step}`)
                assert.equal((await r.docs.get('d1')).status, 'noted')
            }
        })

        it('W2／W4 SS14 三席各用自己之進門門檻與續派門檻(兩組:f1 6 分 → 60 秒、f2 5 分＋minAttemptMs 40 秒 → 40 秒、f3 30 秒 → 30 秒;f1 45 秒 → 45 秒、f2 50 秒 → 50 秒、f3 5 分＋minAttemptMs 90 秒 → 90 秒);callOpt 含 spec 與 segment:summarizeFaith', async () => {
            const GROUPS = [
                { first: { use: 'f1', timeoutMs: 6 * MIN }, second: { use: 'f2', timeoutMs: 5 * MIN, minAttemptMs: 40_000 }, third: { use: 'f3', timeoutMs: 30_000 }, steps: { f1: 60_000, f2: 40_000, f3: 30_000 } },
                { first: { use: 'f1', timeoutMs: 45_000 }, second: { use: 'f2', timeoutMs: 50_000 }, third: { use: 'f3', timeoutMs: 5 * MIN, minAttemptMs: 90_000 }, steps: { f1: 45_000, f2: 50_000, f3: 90_000 } },
            ]
            const verdict = { f1: 'faithful', f2: 'unfaithful', f3: 'faithful' } // 兩席不一致 → 第三席
            for (const g of GROUPS) {
                const ck = ctl(30 * MIN)
                const seen = []
                const callAI = async (prompt, c, co) => {
                    if (co.segment === 'summarizeFaith') {
                        seen.push({ use: co.spec.use, keys: keysOf(co), budgetMs: co.budgetMs, probe: probe(co, ck, g.steps[co.spec.use]) })
                        return { ok: true, providerId: `p-${co.spec.use}`, data: { checks: faithIdx(prompt).map((index) => ({ index, verdict: verdict[co.spec.use], reason: '筆記與原文不符之說明文字足夠長' })) } }
                    }
                    return { ok: true, data: [ITEM], providerId: 'p-sum' }
                }
                const r = await runNote({ ck, callAI, standards: { faithCheck: { enabled: true, ai: { first: g.first, second: g.second, third: g.third } } } })
                const tag = JSON.stringify(g.steps)
                assert.deepEqual(seen.map((x) => x.use), ['f1', 'f2', 'f3'], tag)
                for (const x of seen) {
                    assert.deepEqual(x.keys, ['budgetMs', 'segment', 'shouldStop', 'spec'], `W4 ${x.use} ${tag}`)
                    assert.equal(x.budgetMs, 15 * MIN, `W3 ${x.use} ${tag}`)
                    assert.deepEqual(x.probe, [false, true], `W2 ${x.use}:續派門檻 ${g.steps[x.use]}`)
                }
                assert.deepEqual([(await r.docs.get('d1')).status, r.rep.detail.faithCalls], ['noted', 3], `${tag}:兩席對一席判忠實 → 納入;送出 3 次`)
            }
        })

        it('W1 SS14 保留為 0:第一席送出後整輪逾期 → 第二席不送出(覆核中止、本批不套用、不記 tries);faithCalls 只計確實送出者(1)', async () => {
            const ck = ctl(30 * MIN)
            const faith = []
            const callAI = async (prompt, c, co) => {
                if (co.segment === 'summarizeFaith') {
                    faith.push(co.spec.use)
                    ck.set(0) // 第一席送出後整輪逾期(第二席之進門在同一同步段內判)
                    return { ok: true, providerId: `p-${co.spec.use}`, data: { checks: faithIdx(prompt).map((index) => ({ index, verdict: 'faithful', reason: '與原文相符' })) } }
                }
                return { ok: true, data: [ITEM], providerId: 'p-sum' }
            }
            const r = await runNote({ ck, callAI, reserve: 0, standards: { faithCheck: { enabled: true, ai: { first: { use: 'f1', timeoutMs: 6 * MIN }, second: { use: 'f2', timeoutMs: 6 * MIN } } } } })
            assert.deepEqual(faith, ['f1'], '第二席未送出')
            assert.equal(r.rep.detail.faithCalls, 1)
            const d = await r.docs.get('d1')
            assert.deepEqual([d.status, d.summarizeTries || 0, d.faithTries || 0], ['raw', 0, 0], '本批不套用、不記 tries')
        })

        it('W5 SS14 第一席同步拋出 → 第二席不被呼叫(保留 15 分與保留 0 皆然);本批記為批次異常', async () => {
            for (const reserve of [RES, 0]) {
                const ck = ctl(30 * MIN)
                const faith = []
                // 非 async:第一席於呼叫時同步拋出
                const callAI = (prompt, c, co) => {
                    if (co.segment === 'summarizeFaith') {
                        faith.push(co.spec.use)
                        if (co.spec.use === 'f1') throw new Error('第一席同步拋出（替身）')
                        return Promise.resolve({ ok: true, providerId: 'p-f2', data: { checks: [] } })
                    }
                    return Promise.resolve({ ok: true, data: [ITEM], providerId: 'p-sum' })
                }
                const faithCheck = { enabled: true, ai: { first: { use: 'f1', timeoutMs: 6 * MIN }, second: { use: 'f2', timeoutMs: 6 * MIN } } }
                const r = await runNote({ ck, callAI, standards: { faithCheck }, reserve })
                assert.deepEqual(faith, ['f1'], `保留 ${reserve}:第二席未被呼叫`)
                assert.ok(r.log.lines.some((l) => /批次異常：第一席同步拋出（替身）/.test(l)), r.log.lines.join('\n'))
            }
        })

        it('W8 內建調度層之路徑(未覆寫 callAI):摘要主呼叫、修補、SS14 兩席之 callJson 收到 spec(該席位)、budgetMs(有限)、以續派門檻判之 shouldStop;不帶 segment;主呼叫另帶 acceptTruncated', async () => {
            const ck = ctl(30 * MIN)
            const seat = { ...SUM_SEAT, minAttemptMs: 90_000 }
            const faith = { first: { use: 'f1', timeoutMs: 45_000 }, second: { use: 'f2', timeoutMs: 5 * MIN, minAttemptMs: 40_000 } }
            const seen = []
            const ai = {
                callJson: (prompt, c, o) => {
                    const step = { 'x:main': 90_000, 'f1': 45_000, 'f2': 40_000 }[o.spec?.use]
                    const kind = c === checkRepairReply ? 'repair' : c === checkFaithChecks ? `faith:${o.spec?.use}` : 'main'
                    seen.push({ kind, spec: o.spec, keys: keysOf(o), budgetMs: o.budgetMs, probe: probe(o, ck, step) })
                    if (kind === 'repair') return Promise.resolve({ ok: true, data: { repairs: [{ no: 1, value: '夏普值 0.71' }] }, providerId: 'p-sum' })
                    if (kind.startsWith('faith')) return Promise.resolve({ ok: true, providerId: `p-${o.spec.use}`, data: { checks: faithIdx(prompt).map((index) => ({ index, verdict: 'faithful', reason: '與原文相符' })) } })
                    return Promise.resolve({ ok: true, data: [ITEM_REPAIR], providerId: 'p-sum' })
                },
            }
            const r = await runNote({ ck, ai, seat, standards: { repair: { enabled: true }, faithCheck: { enabled: true, ai: faith } } })
            assert.deepEqual(seen.map((x) => x.kind), ['main', 'repair', 'faith:f1', 'faith:f2'])
            const seatOf = { 'main': r.settings.summarize.ai, 'repair': r.settings.summarize.ai, 'faith:f1': r.settings.summarize.standards.faithCheck.ai.first, 'faith:f2': r.settings.summarize.standards.faithCheck.ai.second }
            for (const x of seen) {
                assert.deepEqual(x.spec, seatOf[x.kind], `spec 為該席位 ${x.kind}`)
                assert.deepEqual(x.keys, x.kind === 'main' ? ['acceptTruncated', 'budgetMs', 'shouldStop', 'spec'] : ['budgetMs', 'shouldStop', 'spec'], `鍵 ${x.kind}(不帶 segment)`)
                assert.equal(x.budgetMs, 15 * MIN, `budgetMs ${x.kind}`)
                assert.deepEqual(x.probe, [false, true], `續派門檻 ${x.kind}`)
            }
            assert.equal((await r.docs.get('d1')).status, 'noted')
        })
    })

    // ══════════════════════════ 接縫:真調度層(不用替身) ══════════════════════════
    describe('W6 接縫:抓取套件之調度層＋w-dispatch-ai(本機假 OpenAI 相容伺服器)', function() {
        this.timeout(60_000)
        let srv = null
        let onPlain = () => {}
        before(async () => {
            // 主席(model plain)回非 JSON → 驗證不過 → 遞補層於下一家之前問 shouldStop;收件時先推進 ctx 時鐘(模擬主席耗時)
            srv = await startServer({
                port: REST_PORT,
                sceneOf: (scene) => {
                    if (scene === 'plain') {
                        onPlain()
                        return undefined
                    }
                    if (scene === 'judge') return { fr: 'stop', content: JSON.stringify(JUDGE_OFF(1)) }
                    return undefined
                },
            })
        })
        after(async () => {
            await srv.close()
        })

        /** 跑一輪摘要:主席 rest:plain、遞補 rest:judge;主席收件時把扣保留後剩餘推到 leftAfterMs */
        async function runSeam(leftAfterMs) {
            const ck = ctl(30 * MIN)
            onPlain = () => ck.set(RES + leftAfterMs)
            const dir = `${TMP}/seam-${++seq}`
            fs.mkdirSync(dir, { recursive: true })
            const entries = ['plain', 'judge'].map((m) => ({ id: `rest:${m}`, model: m, kind: 'api-openai-compat', baseURL: srv.base, envVar: 'FAKE_ONE' }))
            const ai = createAiAdapter({ ai: { extraProviders: entries, cooldownMs: 900_000, maxRetries: 0 }, env: { FAKE_ONE: 'k1' }, workspace: dir, clock: genClockTZ('Asia/Taipei') })
            const docs = memStore(rawDocs(1))
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: false }, ai: { use: 'rest:plain', fallback: ['rest:judge'], timeoutMs: 6 * MIN } }, ai: { parallel: 1 } })
            const hits0 = srv.hits.length
            const rep = await stageSummarize({ domain: SUM_DOMAIN, docsPerBatch: 1, parallel: 1, rounds: 1 })
                .run({ deps: { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings, ai, reserveMs: RES }, log: recLog(), remainingMs: ck.remainingMs, expired: ck.expired })
            return { rep, doc: await docs.get('d1'), models: srv.hits.slice(hits0).map((h) => h.model) }
        }

        it('主席失敗後扣保留後剩餘 90 秒(≥ 續派門檻 60 秒、< 進門門檻 6 分)→ 派遞補(伺服器收到第二家)、本篇判定落帳;59.999 秒 → 不派遞補、本批略過(留 raw、不記 tries)', async () => {
            const a = await runSeam(90_000)
            assert.deepEqual(a.models, ['plain', 'judge'], '遞補被派出')
            assert.equal(a.doc.status, 'skip', '遞補之判定落帳')
            const b = await runSeam(60_000 - 1)
            assert.deepEqual(b.models, ['plain'], '剩餘不足續派門檻 → 不派遞補')
            assert.deepEqual([b.doc.status, b.doc.summarizeTries || 0, b.rep.detail.aborted], ['raw', 0, true], '略過不記失敗')
        })
    })

    // ══════════════════════════ 舊件已刪 ══════════════════════════
    describe('W7 舊件已刪(不留相容層)', () => {
        it('主入口不再匯出 summarizeCallMsOf、reserveGateOf;保留時間取值器 reserveFnOf 照舊', () => {
            assert.equal('summarizeCallMsOf' in WKS, false)
            assert.equal('reserveGateOf' in WKS, false)
            assert.equal(typeof WKS.reserveFnOf, 'function')
            assert.equal('summarizeCallMsOf' in WKS.default, false)
            assert.equal('reserveGateOf' in WKS.default, false)
        })
    })
})
