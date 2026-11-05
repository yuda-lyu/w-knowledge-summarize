// unit-summarize-reserve-gate.test.mjs — 預篩、摘要扣保留時間之共用件(core/stages/stageReserve):一次呼叫之估計、保留時間取值器、守門閘
//   (子階段接線另見 unit-summarize-reserve;重標之保留案見 unit-summarize-retag)
// 規則(出自 core/stages/stageReserve 檔頭與 JSDoc):
//   G1 一次呼叫之估計＝席位 timeoutMs → ai.providerTimeouts[席位 use] → ai.extraProviders 該條目自帶 timeoutMs → ai.timeoutMs → 300000;
//     非正數／非數值／缺設定者略過、落到下一層
//   G2 取值器:opt.reserveMs 明給者優先(含 0)、未給(或 null)每輪取 ctx.deps.reserveMs、皆未給為 0;數字或 (ctx) => 毫秒數;不合法 → opt 建構即拋、deps／函數回傳於呼叫時拋
//   G3 守門閘:保留 > 0 時「扣保留後剩餘 ≥ 估計」才可開工(含恰等於);保留為 0 時與直接用整輪預算(budgetOf)完全相同(不加門檻);非正／非有限之保留視為 0
//   G5 無截止(ctx 缺 remainingMs／為 null／回 Infinity)→ 剩餘恆為 Infinity、不拒絕
// 執行:自套件根 node <mocha> test/unit-summarize-reserve-gate.test.mjs(純函數,無暫存、不連網)

import assert from 'node:assert/strict'
import { budgetOf } from '../src/core/capturePackage.mjs'
import { summarizeCallMsOf, reserveFnOf, reserveGateOf } from '../src/core/stages/stageReserve.mjs'

const MIN = 60_000
const ctxOf = (remaining, expired = false) => ({ remainingMs: () => remaining, expired: () => expired })

describe('unit-summarize-reserve-gate', function() {

    describe('summarizeCallMsOf(一次呼叫之估計)', () => {
        const ai = { timeoutMs: 120_000, providerTimeouts: { 'x:a': 45_000 } }

        it('G1 順序:席位 timeoutMs → providerTimeouts[use] → ai.timeoutMs → 300000', () => {
            assert.equal(summarizeCallMsOf({ ai }, { use: 'x:a', timeoutMs: 9_000 }), 9_000, '席位逾時最優先(調度層以之覆寫鏈內各條目)')
            assert.equal(summarizeCallMsOf({ ai }, { use: 'x:a' }), 45_000, '逐 id 逾時次之')
            assert.equal(summarizeCallMsOf({ ai }, { use: 'x:b' }), 120_000, '再次為 ai.timeoutMs')
            assert.equal(summarizeCallMsOf({ ai: {} }, { use: 'x:b' }), 300_000, '皆無 → 300000')
            assert.equal(summarizeCallMsOf({}, null), 300_000)
            assert.equal(summarizeCallMsOf(undefined, undefined), 300_000)
        })

        it('G1 條目自帶之逾時(ai.extraProviders):次於席位與逐 id 逾時、先於 ai.timeoutMs;以 id 比對(席位未給 use 者不誤配無 id 之條目)', () => {
            const settings = { ai: { timeoutMs: 120_000, providerTimeouts: { 'x:a': 45_000 }, extraProviders: [{ id: 'x:a', timeoutMs: 1_000 }, { id: 'x:c', timeoutMs: 80_000 }, { model: 'm', timeoutMs: 7_000 }, 'x:d', null] } }
            assert.equal(summarizeCallMsOf(settings, { use: 'x:c' }), 80_000, '條目自帶')
            assert.equal(summarizeCallMsOf(settings, { use: 'x:c', timeoutMs: 9_000 }), 9_000, '席位逾時優先')
            assert.equal(summarizeCallMsOf(settings, { use: 'x:a' }), 45_000, '逐 id 逾時優先於條目自帶')
            assert.equal(summarizeCallMsOf(settings, { use: 'x:d' }), 120_000, '條目無逾時 → ai.timeoutMs')
            assert.equal(summarizeCallMsOf(settings, {}), 120_000, '席位未給 use:不誤配無 id 之條目')
            assert.equal(summarizeCallMsOf({ ai: { extraProviders: 'x' } }, { use: 'x:c' }), 300_000, 'extraProviders 非陣列 → 略過')
        })

        it('G1 只取鏈首家(席位 use)之值,不取 fallback 之逾時', () => {
            const settings = { ai: { timeoutMs: 100_000, providerTimeouts: { 'x:first': 30_000, 'x:slow': 900_000 } } }
            assert.equal(summarizeCallMsOf(settings, { use: 'x:first', fallback: ['x:slow'] }), 30_000)
        })

        it('G1 非正數／非數值／非物件者略過、落到下一層', () => {
            for (const bad of [0, -5, Number.NaN, Infinity * 0, 'abc', null, undefined, {}, [], false]) {
                assert.equal(summarizeCallMsOf({ ai }, { use: 'x:a', timeoutMs: bad }), 45_000, `席位 timeoutMs=${String(bad)}`)
                assert.equal(summarizeCallMsOf({ ai: { timeoutMs: bad } }, { use: 'x:a' }), 300_000, `ai.timeoutMs=${String(bad)}`)
            }
            assert.equal(summarizeCallMsOf({ ai: 'x' }, { use: 'x:a' }), 300_000, 'ai 非物件')
            assert.equal(summarizeCallMsOf({ ai }, 'x:a'), 120_000, '席位非物件')
        })
    })

    describe('reserveFnOf(保留時間取值器)', () => {
        it('G2 opt 明給者優先(含 0);未給或 null 取 ctx.deps.reserveMs;皆未給為 0', () => {
            assert.equal(reserveFnOf({ reserveMs: 900_000 }, 'stageX')({ deps: { reserveMs: 1 } }), 900_000)
            assert.equal(reserveFnOf({ reserveMs: 0 }, 'stageX')({ deps: { reserveMs: 1 } }), 0, '明給 0 優先於依賴')
            for (const opt of [{}, { reserveMs: null }, { reserveMs: undefined }, undefined, null]) {
                assert.equal(reserveFnOf(opt, 'stageX')({ deps: { reserveMs: 600_000 } }), 600_000, JSON.stringify(opt))
                assert.equal(reserveFnOf(opt, 'stageX')({ deps: {} }), 0)
                assert.equal(reserveFnOf(opt, 'stageX')({}), 0, '無 deps')
                assert.equal(reserveFnOf(opt, 'stageX')(undefined), 0, '無 ctx')
            }
        })

        it('G2 函數形式每輪以本輪 ctx 求值(opt 與 deps 同)', () => {
            const seen = []
            const fn = (ctx) => {
                seen.push(ctx)
                return 7
            }
            const c1 = { deps: {} }
            const c2 = { deps: { reserveMs: fn } }
            assert.equal(reserveFnOf({ reserveMs: fn }, 'stageX')(c1), 7)
            assert.equal(reserveFnOf({}, 'stageX')(c2), 7)
            assert.deepEqual(seen, [c1, c2])
        })

        it('G2 不合法:opt 建構即拋(訊息帶函數名);deps 與函數回傳於呼叫時拋', () => {
            for (const bad of [-1, Number.NaN, Infinity, '900000', true, {}, []]) {
                assert.throws(() => reserveFnOf({ reserveMs: bad }, 'stageX'), /stageX 之 opt\.reserveMs 須為非負毫秒數或 \(ctx\) => 毫秒數/, String(bad))
                assert.throws(() => reserveFnOf({}, 'stageX')({ deps: { reserveMs: bad } }), /stageX 之 deps\.reserveMs 須為非負毫秒數或 \(ctx\) => 毫秒數/, String(bad))
            }
            assert.throws(() => reserveFnOf({ reserveMs: () => -5 }, 'stageX')({ deps: {} }), /stageX 之 opt\.reserveMs 函數須回傳非負毫秒數，收到 -5/)
            assert.throws(() => reserveFnOf({}, 'stageX')({ deps: { reserveMs: () => Number.NaN } }), /stageX 之 deps\.reserveMs 函數須回傳非負毫秒數，收到 NaN/)
        })
    })

    describe('reserveGateOf(守門閘)', () => {
        it('G3 保留 > 0:扣保留後剩餘 ≥ 估計才可開工;恰等於 → 可;差 1 毫秒 → 不可;remainingMs＝剩餘−保留(下限 0)', () => {
            const g = reserveGateOf(ctxOf(21 * MIN), 15 * MIN)
            assert.deepEqual([g.keep, g.remainingMs(), g.canStart(6 * MIN), g.shouldStop(6 * MIN)], [15 * MIN, 6 * MIN, true, false], '恰等於')
            const g2 = reserveGateOf(ctxOf(21 * MIN - 1), 15 * MIN)
            assert.deepEqual([g2.remainingMs(), g2.canStart(6 * MIN), g2.shouldStop(6 * MIN)], [6 * MIN - 1, false, true], '差 1 毫秒')
            const g3 = reserveGateOf(ctxOf(10 * MIN), 15 * MIN)
            assert.deepEqual([g3.remainingMs(), g3.canStart(0), g3.canStart(1)], [0, true, false], '剩餘小於保留 → 扣後為 0;估計 0 恆可(整輪未逾期)')
        })

        it('G3 保留為 0(未給、0、負、NaN、Infinity、非數值):與直接用整輪預算完全相同——不加門檻(估計值被忽略)', () => {
            for (const keep of [0, undefined, null, -1, Number.NaN, Infinity, '900000']) {
                for (const [remaining, expired] of [[60_000, false], [0, false], [0, true], [Infinity, false], [3 * MIN, true]]) {
                    const base = budgetOf(ctxOf(remaining, expired))
                    const g = reserveGateOf(ctxOf(remaining, expired), keep)
                    assert.equal(g.keep, 0, `keep=${String(keep)}(非正／非有限視為 0)`)
                    assert.equal(g.remainingMs(), base.remainingMs(), `剩餘 ${remaining} keep=${String(keep)}`)
                    assert.equal(g.expired(), base.expired())
                    for (const callMs of [0, 1, 6 * MIN, 36_000_000, undefined, Number.NaN]) {
                        assert.equal(g.shouldStop(callMs), base.shouldStop(), `剩餘 ${remaining} 逾期 ${expired} 估計 ${String(callMs)}`)
                        assert.equal(g.canStart(callMs), !base.shouldStop())
                    }
                }
            }
        })

        it('G3 整輪已逾期 → 不可開工(不論保留與估計)', () => {
            const g = reserveGateOf(ctxOf(60 * MIN, true), 15 * MIN)
            assert.deepEqual([g.canStart(0), g.canStart(MIN), g.expired()], [false, false, true])
        })

        it('G5 無截止:ctx 為 null／缺 remainingMs／回 Infinity → 剩餘恆 Infinity、不拒絕', () => {
            for (const ctx of [null, undefined, {}, { expired: () => false }, ctxOf(Infinity)]) {
                const g = reserveGateOf(ctx, 15 * MIN)
                assert.deepEqual([g.remainingMs(), g.canStart(6 * MIN), g.shouldStop(36_000_000)], [Infinity, true, false])
            }
        })

        it('G5 閘於每次呼叫時以當下之剩餘求值(不在建構時取一次——序列後段拿到的是當時剩餘;耗盡後再判仍準)', () => {
            let remaining = 30 * MIN
            const g = reserveGateOf({ remainingMs: () => remaining, expired: () => false }, 15 * MIN)
            assert.deepEqual([g.remainingMs(), g.canStart(6 * MIN)], [15 * MIN, true])
            remaining = 18 * MIN
            assert.deepEqual([g.remainingMs(), g.canStart(6 * MIN)], [3 * MIN, false])
            remaining = 60 * MIN
            assert.deepEqual([g.remainingMs(), g.canStart(6 * MIN)], [45 * MIN, true], '閘不記狀態')
        })
    })
})
