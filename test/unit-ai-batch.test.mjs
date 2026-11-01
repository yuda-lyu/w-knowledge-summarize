// unit-ai-batch.test.mjs — 批次 AI 處理 harness(core/stages/aiBatchStage.runAiBatchStage)
//   機制:部分接受、同 index 去重、隊頭防阻塞(onBatchFailed／onMissed)、額度中止與零進度守門、逐項鏈異常不算進度、
//   例外只對未套用者落帳、依重量打包(packBatches)、套用前之批次覆核(reviewItems)、時間預算守門(shouldStop)
// 執行:自套件根 npx mocha test/unit-ai-batch.test.mjs(全檔為純函數與記憶體替身,不建暫存、不發網路、不呼叫 AI)

import assert from 'node:assert/strict'
import { nullLogger } from './tools/captureForTest.mjs'
import { runAiBatchStage } from '../src/core/stages/aiBatchStage.mjs'

const log = nullLogger()

describe('unit-ai-batch', function() {

    // ── 輸入檢查(cfg 形狀) ──
    describe('輸入檢查', function() {

        const validBase = () => ({
            pickPool: async () => [],
            buildPrompt: async () => '',
            callAI: async () => ({ ok: true, data: [] }),
            checkResult: () => true,
            isValidItem: () => true,
            indexOf: (it) => it.index,
            applyItem: async () => ({}),
            onMissed: async () => {},
            batchSize: 2,
            parallel: 1,
            rounds: 1,
            log,
        })

        it('runAiBatchStage：cfg 非物件拋錯；必要函數缺席逐一拋錯', async () => {
            await assert.rejects(() => runAiBatchStage(undefined), /runAiBatchStage 需要 cfg 物件/)
            for (const name of ['pickPool', 'buildPrompt', 'callAI', 'checkResult', 'isValidItem', 'indexOf', 'applyItem', 'onMissed']) {
                await assert.rejects(() => runAiBatchStage({ ...validBase(), [name]: 'not-fn' }), new RegExp(`runAiBatchStage 需要 ${name} 函數`))
            }
        })

        it('runAiBatchStage：batchSize／parallel 非正整數拋錯；rounds 非非負整數拋錯；log 缺 info/warn 拋錯', async () => {
            await assert.rejects(() => runAiBatchStage({ ...validBase(), batchSize: 0 }), /runAiBatchStage 需要 cfg\.batchSize 正整數/)
            await assert.rejects(() => runAiBatchStage({ ...validBase(), parallel: -1 }), /runAiBatchStage 需要 cfg\.parallel 正整數/)
            await assert.rejects(() => runAiBatchStage({ ...validBase(), rounds: -1 }), /runAiBatchStage 需要 cfg\.rounds 非負整數/)
            await assert.rejects(() => runAiBatchStage({ ...validBase(), log: { info: () => {} } }), /runAiBatchStage 需要 cfg\.log（具 info\/warn 函數）/)
        })

        it('runAiBatchStage：onBatchFailed／shouldStop 非函數時視為未給（不拋錯，僅記日誌後續照跑）', async () => {
            const r = await runAiBatchStage({
                ...validBase(),
                pickPool: async () => [{ id: 'a' }],
                callAI: async () => ({ ok: false, error: 'boom', skipped: false }),
                onBatchFailed: 'not-a-function',
                shouldStop: 'not-a-function',
            })
            assert.equal(r.failedBatches, 1, '非函數之 onBatchFailed 視為未給，仍正常記錄失敗批次不拋錯')
        })

        it('runAiBatchStage：有效輸入之部分接受／未涵蓋行為不變', async () => {
            const applied = []
            const missed = []
            const r = await runAiBatchStage({
                ...validBase(),
                batchSize: 3,
                pickPool: async () => [{ index: 1 }, { index: 2 }, { index: 3 }],
                callAI: async () => ({ ok: true, data: [{ index: 1 }, { index: 2 }] }),
                isValidItem: (it) => it.index <= 2,
                applyItem: async (item) => {
                    applied.push(item.index); return { noted: 1 }
                },
                onMissed: async (t) => missed.push(t.index),
            })
            assert.deepEqual(applied, [1, 2])
            assert.deepEqual(missed, [3])
            assert.equal(r.applied.noted, 2)
        })
    })

    // ── harness 機制 ──
    describe('harness', function() {

        it('harness：部分接受＋未涵蓋記 tries＋同 index 取第一', async () => {
            const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
            const applied = []
            const missed = []
            const r = await runAiBatchStage({
                log,
                batchSize: 3,
                parallel: 1,
                rounds: 1,
                pickPool: async () => pool,
                buildPrompt: async () => 'p',
                callAI: async () => ({
                    ok: true,
                    data: [
                        { index: 1, v: '首' }, { index: 1, v: '重複' }, { index: 2, bad: true }, // index2 不完整
                    ]
                }),
                checkResult: (d) => Array.isArray(d),
                isValidItem: (it) => !it.bad,
                indexOf: (it) => it.index,
                applyItem: async (it, t) => {
                    applied.push(`${t.id}:${it.v}`); return { done: 1 }
                },
                onMissed: async (t) => missed.push(t.id),
            })
            assert.deepEqual(applied, ['a:首'], '同 index 取第一；不完整項不採用')
            assert.deepEqual(missed.sort(), ['b', 'c'], '未涵蓋者交 onMissed 記 tries')
            assert.equal(r.applied.done, 1)
        })

        it('harness：套用前之批次覆核(reviewItems,檔頭⑨)——不通過之項不套用、交 onReviewRejected(未給交 onMissed);覆核中止 → 本批不套用、aborted、不記 tries;未給＝不覆核', async () => {
            const pool = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
            const base = {
                log, batchSize: 3, parallel: 1, rounds: 1, pickPool: async () => pool, buildPrompt: async () => 'p',
                callAI: async () => ({ ok: true, providerId: 'p1', data: [{ index: 1 }, { index: 2 }] }),
                checkResult: () => true, isValidItem: () => true, indexOf: (it) => it.index,
            }
            const applied = []
            const missed = []
            const rejected = []
            const seen = []
            const r = await runAiBatchStage({
                ...base,
                applyItem: async (it, t) => {
                    applied.push(t.id); return { done: 1 }
                },
                onMissed: async (t) => missed.push(t.id),
                reviewItems: async (entries, h) => {
                    seen.push([entries.map((e) => [e.index, e.target.id]), h.providerId, h.batch.length])
                    return { rejected: new Map([[2, { why: '不忠實' }]]) }
                },
                onReviewRejected: async (t, why, h) => rejected.push([t.id, why.why, h.providerId]),
            })
            assert.deepEqual(seen, [[[[1, 'a'], [2, 'b']], 'p1', 3]], '覆核一次收全批合格項(含供應者)')
            assert.deepEqual([applied, rejected, missed], [['a'], [['b', '不忠實', 'p1']], ['c']])
            assert.equal(r.reviewRejected, 1)
            // 未給 onReviewRejected → 交 onMissed
            const missed2 = []
            await runAiBatchStage({ ...base, applyItem: async () => ({}), onMissed: async (t) => missed2.push(t.id), reviewItems: async () => ({ rejected: new Map([[1, 'x']]) }) })
            assert.deepEqual(missed2.sort(), ['a', 'c'])
            // 覆核中止 → 本批不套用、aborted、不記 tries(onMissed／onBatchFailed 皆不呼叫)
            const calls = []
            const r3 = await runAiBatchStage({ ...base, rounds: 3, applyItem: async () => calls.push('apply'), onMissed: async () => calls.push('missed'), onBatchFailed: async () => calls.push('failed'), reviewItems: async () => ({ stopped: true }) })
            assert.deepEqual([calls, r3.aborted, r3.rounds], [[], true, 1])
            // 未給 reviewItems → 不覆核
            const applied4 = []
            await runAiBatchStage({ ...base, applyItem: async (it, t) => applied4.push(t.id), onMissed: async () => {} })
            assert.deepEqual(applied4, ['a', 'b'])
        })

        it('harness：額度用盡中止且不記 tries；一般失敗走 onBatchFailed', async () => {
            let batchFailed = 0
            const r1 = await runAiBatchStage({
                log,
                batchSize: 2,
                parallel: 1,
                rounds: 3,
                pickPool: async () => [{ id: 'a' }],
                buildPrompt: async () => 'p',
                callAI: async () => ({ ok: false, error: 'quota', skipped: true }),
                checkResult: () => true,
                isValidItem: () => true,
                indexOf: (it) => it.index,
                applyItem: async () => ({}),
                onMissed: async () => {},
                onBatchFailed: async () => {
                    batchFailed++
                },
            })
            assert.equal(r1.aborted, true, '額度用盡須中止後續輪')
            assert.equal(r1.rounds, 1)
            assert.equal(batchFailed, 0, '額度問題不是這批的錯，不可記 tries')

            await runAiBatchStage({
                log,
                batchSize: 2,
                parallel: 1,
                rounds: 1,
                pickPool: async () => [{ id: 'a' }],
                buildPrompt: async () => 'p',
                callAI: async () => ({ ok: false, error: 'truncated' }),
                checkResult: () => true,
                isValidItem: () => true,
                indexOf: (it) => it.index,
                applyItem: async () => ({}),
                onMissed: async () => {},
                onBatchFailed: async () => {
                    batchFailed++
                },
            })
            assert.equal(batchFailed, 1, '一般失敗須走 onBatchFailed（整批降序）')
        })

        it('harness：shouldStop 於每輪開工前守門(stopped)；failedBatches／missed 計數供 report 之 fail', async () => {
            let prompts = 0
            const r = await runAiBatchStage({
                log,
                batchSize: 2,
                parallel: 1,
                rounds: 5,
                shouldStop: () => prompts >= 2, // 第 3 輪開工前逾時間預算
                pickPool: async () => [{ id: 'a' }, { id: 'b' }],
                buildPrompt: async () => {
                    prompts++; return 'p'
                },
                callAI: async () => ({ ok: true, data: [{ index: 1, v: 1 }] }), // 只涵蓋第 1 項,第 2 項未涵蓋
                checkResult: () => true,
                isValidItem: () => true,
                indexOf: (it) => it.index,
                applyItem: async () => ({ done: 1 }),
                onMissed: async () => {},
            })
            assert.equal(r.rounds, 2, '守門前已跑 2 輪')
            assert.equal(r.stopped, true, '逾預算停止須可辨識(與額度中止 aborted 分開)')
            assert.equal(r.aborted, false)
            assert.equal(r.missed, 2, '每輪 1 項未涵蓋 × 2 輪')
            assert.equal(r.failedBatches, 0)

            const r2 = await runAiBatchStage({
                log,
                batchSize: 1,
                parallel: 1,
                rounds: 3,
                pickPool: async () => [{ id: 'a' }],
                buildPrompt: async () => 'p',
                callAI: async () => ({ ok: false, error: 'truncated' }),
                checkResult: () => true,
                isValidItem: () => true,
                indexOf: (it) => it.index,
                applyItem: async () => ({}),
                onMissed: async () => {},
            })
            assert.equal(r2.failedBatches, 1, '失敗批次須計數——否則階段 report 恆 fail:0,批次失敗被吸收成正常')
            assert.equal(r2.stopped, false)
        })

        it('harness：buildPrompt／callAI 拋錯亦落帳（failedBatches＋onBatchFailed），與 ok:false 分支對稱', async () => {
            const failedWith = []
            let calls = 0
            const r = await runAiBatchStage({
                log,
                batchSize: 2,
                parallel: 1,
                rounds: 3,
                pickPool: async () => [{ id: 'a' }, { id: 'b' }],
                buildPrompt: async () => {
                    calls++; throw new Error('席位解析失敗')
                },
                callAI: async () => ({ ok: true, data: [] }),
                checkResult: () => true,
                isValidItem: () => true,
                indexOf: (it) => it.index,
                applyItem: async () => ({}),
                onMissed: async () => {},
                onBatchFailed: async (batch, err) => failedWith.push(`${batch.map((t) => t.id).join('+')}:${err.error}`),
            })
            assert.equal(r.failedBatches, 1, '例外批次計入 failedBatches——否則只記日誌,report 之 fail 不含它')
            assert.deepEqual(failedWith, ['a+b:席位解析失敗'], '例外亦走 onBatchFailed(記 tries 出隊),否則同一批永久空轉')
            assert.equal(calls, 1, '零進度守門仍生效(不重複空轉)')
        })

        it('harness：零進度守門——整輪掛零即停損', async () => {
            let calls = 0
            await runAiBatchStage({
                log,
                batchSize: 1,
                parallel: 1,
                rounds: 5,
                pickPool: async () => [{ id: 'a' }],
                buildPrompt: async () => 'p',
                callAI: async () => {
                    calls++; return { ok: false, error: 'validation' }
                },
                checkResult: () => true,
                isValidItem: () => true,
                indexOf: (it) => it.index,
                applyItem: async () => ({}),
                onMissed: async () => {},
            })
            assert.equal(calls, 1, '掛零即停——下一輪大概率挑到同一批再敗')
        })

        it('harness：逐項鏈異常(applyItem 回 _chainFailed)不算進度——零進度守門停損、計入 chainFailed', async () => {
            let calls = 0
            const r = await runAiBatchStage({
                log,
                batchSize: 2,
                parallel: 1,
                rounds: 3,
                pickPool: async () => [{ id: 'a' }, { id: 'b' }],
                buildPrompt: async () => {
                    calls++; return 'p'
                },
                callAI: async () => ({ ok: true, data: [{ index: 1 }, { index: 2 }] }),
                checkResult: () => true,
                isValidItem: () => true,
                indexOf: (it) => it.index,
                applyItem: async () => ({ processed: 1, _chainFailed: true }),
                onMissed: async () => {},
            })
            assert.equal(calls, 1, '整輪皆鏈異常＝零進度,不再開下一輪空轉')
            assert.equal(r.chainFailed, 2)
            assert.equal(r.applied.processed, 2, '執行端自報之計數照併入(它自己決定要不要計)')
            assert.equal(r.applied._chainFailed, undefined, '旗標不是計數')
        })

        it('harness：批內部分項目已套用後拋錯 → onBatchFailed 只收尚未進 applyItem 者(已套用者再記一次失敗會把 noted 覆寫成終態)', async () => {
            const failed = []
            const applied = []
            const r = await runAiBatchStage({
                log,
                batchSize: 3,
                parallel: 1,
                rounds: 1,
                pickPool: async () => [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
                buildPrompt: async () => 'p',
                callAI: async () => ({ ok: true, data: [{ index: 1 }, { index: 2 }, { index: 3 }] }),
                checkResult: () => true,
                isValidItem: () => true,
                indexOf: (it) => it.index,
                applyItem: async (it, t) => {
                    if (t.id === 'b') throw new Error('寫入中拋錯')
                    applied.push(t.id); return { done: 1 }
                },
                onMissed: async () => {},
                onBatchFailed: async (batch) => failed.push(...batch.map((t) => t.id)),
            })
            assert.deepEqual(applied, ['a'])
            assert.deepEqual(failed, ['c'], 'a 已套用、b 拋錯當下已進套用(可能部分套用),皆不再落帳;只有 c 記失敗')
            assert.equal(r.failedBatches, 1)
        })
    })

    // ── 依重量打包 ──
    describe('runAiBatchStage.packBatches', function() {

        const base = (over) => ({
            log, batchSize: 3, parallel: 2, rounds: 1,
            buildPrompt: async (b) => b.join(','),
            checkResult: () => true, isValidItem: () => true, indexOf: (it) => it.index,
            callAI: async (p) => ({ ok: true, data: p.split(',').map((_, i) => ({ index: i + 1 })) }),
            ...over,
        })

        it('只跑前 parallel 批;其餘未觸碰(不計 missed、不呼叫 onMissed,原樣留佇列);未給即依 batchSize 等分', async () => {
            const applied = []
            const missed = []
            const prompts = []
            const r = await runAiBatchStage(base({
                pickPool: async (n) => ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, n),
                packBatches: (pool) => [[pool[0]], [pool[1], pool[2]], [pool[3], pool[4], pool[5]]],
                buildPrompt: async (b) => {
                    prompts.push(b.join(',')); return b.join(',')
                },
                applyItem: async (it, t) => {
                    applied.push(t); return { n: 1 }
                },
                onMissed: async (t) => missed.push(t),
            }))
            assert.deepEqual(prompts.sort(), ['a', 'b,c'])
            assert.deepEqual(applied.sort(), ['a', 'b', 'c'])
            assert.deepEqual([missed, r.missed, r.batches, r.aiCalls], [[], 0, 2, 2])
            // 對照:未給 packBatches → chunk(pool, 3) 兩批
            const p2 = []
            await runAiBatchStage(base({ pickPool: async (n) => ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, n), buildPrompt: async (b) => {
                p2.push(b.join(',')); return b.join(',')
            }, applyItem: async () => ({}), onMissed: async () => {} }))
            assert.deepEqual(p2.sort(), ['a,b,c', 'd,e,f'])
        })

        it('打包結果不合規格即拋錯:非陣列、空批、池外項目、重複項目', async () => {
            const run = (pack) => runAiBatchStage(base({ pickPool: async () => ['a', 'b'], packBatches: pack, applyItem: async () => ({}), onMissed: async () => {} }))
            await assert.rejects(run(() => 'x'), /packBatches 須回傳批次陣列/)
            await assert.rejects(run(() => [[]]), /每批須為非空陣列/)
            await assert.rejects(run(() => [['z']]), /須取自本輪池且至多出現一次/)
            await assert.rejects(run(() => [['a'], ['a']]), /須取自本輪池且至多出現一次/)
        })
    })

    // ── 呼叫契約:aiAttempts 計帳、失敗 WARN 字樣(日誌契約)、onMissed 之第二參數、全批不合格 ──
    describe('呼叫契約', function() {

        const cfgOf = (over) => ({
            log, batchSize: 2, parallel: 1, rounds: 1,
            pickPool: async () => [{ id: 'a' }, { id: 'b' }],
            buildPrompt: async () => 'p',
            checkResult: () => true, isValidItem: () => true, indexOf: (it) => it.index,
            applyItem: async () => ({}), onMissed: async () => {},
            ...over,
        })

        it('aiAttempts:呼叫端回報之 attempts(含 0)照記;缺欄(替身)才記 1;aiCalls 恆為批數', async () => {
            const run = (r) => runAiBatchStage(cfgOf({ callAI: async () => r }))
            const a = await run({ ok: false, error: 'x', attempts: 3 })
            assert.deepEqual([a.aiCalls, a.aiAttempts], [1, 3])
            const z = await run({ ok: false, error: 'x', skipped: true, attempts: 0 })
            assert.deepEqual([z.aiCalls, z.aiAttempts], [1, 0], '呼叫前即判不可行(未 spawn)不算一次嘗試')
            const m = await run({ ok: false, error: 'x' })
            assert.deepEqual([m.aiCalls, m.aiAttempts], [1, 1], '缺 attempts 欄(替身)記 1')
        })

        it('失敗批次之 WARN 字樣:前綴「批次 AI 失敗（」不變(日誌契約依此辨識);附 errors 時接「；歷程」,preview 接於「→ 」之後', async () => {
            const warns = []
            const spy = { info: () => {}, warn: (s) => warns.push(s), error: () => {} }
            await runAiBatchStage(cfgOf({ log: spy, callAI: async () => ({ ok: false, error: 'HTTP 401', attempts: 2, errors: ['k1:http(0.1s)', 'k2:http(0.2s)'], preview: 'P' }) }))
            assert.equal(warns.length, 1)
            assert.equal(warns[0], '批次 AI 失敗（HTTP 401，試 2 次；歷程 k1:http(0.1s)、k2:http(0.2s)）→ P')
            warns.length = 0
            await runAiBatchStage(cfgOf({ log: spy, callAI: async () => ({ ok: false, error: 'E' }) }))
            assert.equal(warns[0], '批次 AI 失敗（E，試 ? 次）→ ', '無 errors、無 preview 者不附歷程')
        })

        it('onMissed 之第二參數帶成交供應者 { providerId };覆核不通過而未給 onReviewRejected 者,第二參數為 { batch, providerId }', async () => {
            const seen = []
            await runAiBatchStage(cfgOf({
                callAI: async () => ({ ok: true, providerId: 'p9', data: [{ index: 1 }] }),
                applyItem: async () => ({ done: 1 }),
                onMissed: async (t, h) => seen.push([t.id, h]),
            }))
            assert.deepEqual(seen, [['b', { providerId: 'p9' }]], '未涵蓋者(b)')
            const seen2 = []
            await runAiBatchStage(cfgOf({
                callAI: async () => ({ ok: true, providerId: 'p9', data: [{ index: 1 }, { index: 2 }] }),
                reviewItems: async () => ({ rejected: new Map([[2, 'x']]) }),
                onMissed: async (t, h) => seen2.push([t.id, h.providerId, h.batch.map((x) => x.id)]),
            }))
            assert.deepEqual(seen2, [['b', 'p9', ['a', 'b']]])
        })

        it('r.data 內無完整項(全部不合格)→ 全批未涵蓋、零進度即停(不空轉下一輪)', async () => {
            let calls = 0
            const missed = []
            const r = await runAiBatchStage(cfgOf({
                rounds: 3,
                isValidItem: () => false,
                callAI: async () => {
                    calls++; return { ok: true, data: [{ index: 1 }, { index: 2 }] }
                },
                onMissed: async (t) => missed.push(t.id),
            }))
            assert.deepEqual([calls, missed.sort(), r.missed, r.failedBatches, r.aborted], [1, ['a', 'b'], 2, 0, false])
        })
    })
})
