// unit-summarize-reserve-gate.test.mjs — 預篩、摘要扣保留時間之共用件:保留時間取值器(core/stages/stageReserve),以及本套件依之之抓取套件共用件
//   (經 core/capturePackage:一次呼叫之估計 captureCallMsOf、守門閘 stageReserveGateOf;本套件不另寫一份——規則帳本 SUM-14 依其語意,
//   故於此釘住所依之契約)(子階段接線另見 unit-summarize-reserve、unit-summarize-reserved-call;
//   重標之保留案見 unit-summarize-retag)
// 規則(出自 core/stages/stageReserve 檔頭與 JSDoc、規則帳本 SUM-14):
//   G1 一次呼叫之估計＝席位 timeoutMs → ai.providerTimeouts[席位 use] → ai.extraProviders 該條目自帶 timeoutMs → ai.timeoutMs → 300000;
//     非正數／非數值／缺設定者略過、落到下一層
//   G2 取值器:opt.reserveMs 明給者優先(含 0)、未給(或 null)每輪取 ctx.deps.reserveMs、皆未給為 0;數字或 (ctx) => 毫秒數;不合法 → opt 建構即拋、deps／函數回傳於呼叫時拋
//   G3 守門閘:保留 > 0 時「扣保留後剩餘 ≥ 估計」才可開工(含恰等於;shouldStop 為 false);保留為 0 時與直接用整輪預算(budgetOf)完全相同(不加門檻);
//     非正／非有限之保留視為 0;cut(因保留而停)＝保留 > 0、整輪未逾期、扣保留後剩餘 < 估計
//   G5 無截止(ctx 缺 remainingMs／為 null／回 Infinity)→ 剩餘恆為 Infinity、不拒絕
// 執行:自套件根 node <mocha> test/unit-summarize-reserve-gate.test.mjs(純函數,無暫存、不連網)

import assert from 'node:assert/strict'
import { captureCallMsOf, stageReserveGateOf } from '../src/core/capturePackage.mjs'
import { budgetOf } from './tools/captureForTest.mjs'
import { reserveFnOf } from '../src/core/stages/stageReserve.mjs'

const MIN = 60_000
const ctxOf = (remaining, expired = false) => ({ remainingMs: () => remaining, expired: () => expired })

describe('unit-summarize-reserve-gate', function() {

    describe('captureCallMsOf(一次呼叫之估計;抓取套件,經抓取埠)', () => {
        const ai = { timeoutMs: 120_000, providerTimeouts: { 'x:a': 45_000 } }

        it('G1 順序:席位 timeoutMs → providerTimeouts[use] → ai.timeoutMs → 300000', () => {
            assert.equal(captureCallMsOf({ ai }, { use: 'x:a', timeoutMs: 9_000 }), 9_000, '席位逾時最優先(調度層以之覆寫鏈內各條目)')
            assert.equal(captureCallMsOf({ ai }, { use: 'x:a' }), 45_000, '逐 id 逾時次之')
            assert.equal(captureCallMsOf({ ai }, { use: 'x:b' }), 120_000, '再次為 ai.timeoutMs')
            assert.equal(captureCallMsOf({ ai: {} }, { use: 'x:b' }), 300_000, '皆無 → 300000')
            assert.equal(captureCallMsOf({}, null), 300_000)
            assert.equal(captureCallMsOf(undefined, undefined), 300_000)
        })

        it('G1 條目自帶之逾時(ai.extraProviders):次於席位與逐 id 逾時、先於 ai.timeoutMs;以 id 比對(席位未給 use 者不誤配無 id 之條目)', () => {
            const settings = { ai: { timeoutMs: 120_000, providerTimeouts: { 'x:a': 45_000 }, extraProviders: [{ id: 'x:a', timeoutMs: 1_000 }, { id: 'x:c', timeoutMs: 80_000 }, { model: 'm', timeoutMs: 7_000 }, 'x:d', null] } }
            assert.equal(captureCallMsOf(settings, { use: 'x:c' }), 80_000, '條目自帶')
            assert.equal(captureCallMsOf(settings, { use: 'x:c', timeoutMs: 9_000 }), 9_000, '席位逾時優先')
            assert.equal(captureCallMsOf(settings, { use: 'x:a' }), 45_000, '逐 id 逾時優先於條目自帶')
            assert.equal(captureCallMsOf(settings, { use: 'x:d' }), 120_000, '條目無逾時 → ai.timeoutMs')
            assert.equal(captureCallMsOf(settings, {}), 120_000, '席位未給 use:不誤配無 id 之條目')
            assert.equal(captureCallMsOf({ ai: { extraProviders: 'x' } }, { use: 'x:c' }), 300_000, 'extraProviders 非陣列 → 略過')
        })

        it('G1 只取鏈首家(席位 use)之值,不取 fallback 之逾時', () => {
            const settings = { ai: { timeoutMs: 100_000, providerTimeouts: { 'x:first': 30_000, 'x:slow': 900_000 } } }
            assert.equal(captureCallMsOf(settings, { use: 'x:first', fallback: ['x:slow'] }), 30_000)
        })

        it('G1 非正數／非數值／非物件者略過、落到下一層', () => {
            for (const bad of [0, -5, Number.NaN, Infinity * 0, 'abc', null, undefined, {}, [], false]) {
                assert.equal(captureCallMsOf({ ai }, { use: 'x:a', timeoutMs: bad }), 45_000, `席位 timeoutMs=${String(bad)}`)
                assert.equal(captureCallMsOf({ ai: { timeoutMs: bad } }, { use: 'x:a' }), 300_000, `ai.timeoutMs=${String(bad)}`)
            }
            assert.equal(captureCallMsOf({ ai: 'x' }, { use: 'x:a' }), 300_000, 'ai 非物件')
            assert.equal(captureCallMsOf({ ai }, 'x:a'), 120_000, '席位非物件')
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

    describe('stageReserveGateOf(守門閘;抓取套件,經抓取埠)', () => {
        it('G3 保留 > 0:扣保留後剩餘 ≥ 估計才可開工;恰等於 → 可;差 1 毫秒 → 不可(且為因保留而停 cut);remainingMs＝剩餘−保留(下限 0)', () => {
            const g = stageReserveGateOf(ctxOf(21 * MIN), 15 * MIN)
            assert.deepEqual([g.keep, g.remainingMs(), g.shouldStop(6 * MIN), g.cut(6 * MIN)], [15 * MIN, 6 * MIN, false, false], '恰等於')
            const g2 = stageReserveGateOf(ctxOf(21 * MIN - 1), 15 * MIN)
            assert.deepEqual([g2.remainingMs(), g2.shouldStop(6 * MIN), g2.cut(6 * MIN)], [6 * MIN - 1, true, true], '差 1 毫秒')
            const g3 = stageReserveGateOf(ctxOf(10 * MIN), 15 * MIN)
            assert.deepEqual([g3.remainingMs(), g3.shouldStop(0), g3.shouldStop(1)], [0, false, true], '剩餘小於保留 → 扣後為 0;估計 0 恆可(整輪未逾期)')
        })

        it('G3 保留為 0(未給、0、負、NaN、Infinity、非數值):與直接用整輪預算完全相同——不加門檻(估計值被忽略)、不歸因於保留(cut 恆 false)', () => {
            for (const keep of [0, undefined, null, -1, Number.NaN, Infinity, '900000']) {
                for (const [remaining, expired] of [[60_000, false], [0, false], [0, true], [Infinity, false], [3 * MIN, true]]) {
                    const base = budgetOf(ctxOf(remaining, expired))
                    const g = stageReserveGateOf(ctxOf(remaining, expired), keep)
                    assert.equal(g.keep, 0, `keep=${String(keep)}(非正／非有限視為 0)`)
                    assert.equal(g.remainingMs(), base.remainingMs(), `剩餘 ${remaining} keep=${String(keep)}`)
                    assert.equal(g.expired(), base.expired())
                    for (const callMs of [0, 1, 6 * MIN, 36_000_000, undefined, Number.NaN]) {
                        assert.equal(g.shouldStop(callMs), base.shouldStop(), `剩餘 ${remaining} 逾期 ${expired} 估計 ${String(callMs)}`)
                        assert.equal(g.cut(callMs), false)
                    }
                }
            }
        })

        it('G3 整輪已逾期 → 不可開工(不論保留與估計);非因保留(cut 為 false)', () => {
            const g = stageReserveGateOf(ctxOf(60 * MIN, true), 15 * MIN)
            assert.deepEqual([g.shouldStop(0), g.shouldStop(MIN), g.expired(), g.cut(MIN)], [true, true, true, false])
        })

        it('G5 無截止:ctx 為 null／缺 remainingMs／回 Infinity → 剩餘恆 Infinity、不拒絕', () => {
            for (const ctx of [null, undefined, {}, { expired: () => false }, ctxOf(Infinity)]) {
                const g = stageReserveGateOf(ctx, 15 * MIN)
                assert.deepEqual([g.remainingMs(), g.shouldStop(6 * MIN), g.shouldStop(36_000_000)], [Infinity, false, false])
            }
        })

        it('G5 閘於每次呼叫時以當下之剩餘求值(不在建構時取一次——序列後段拿到的是當時剩餘;耗盡後再判仍準)', () => {
            let remaining = 30 * MIN
            const g = stageReserveGateOf({ remainingMs: () => remaining, expired: () => false }, 15 * MIN)
            assert.deepEqual([g.remainingMs(), g.shouldStop(6 * MIN)], [15 * MIN, false])
            remaining = 18 * MIN
            assert.deepEqual([g.remainingMs(), g.shouldStop(6 * MIN)], [3 * MIN, true])
            remaining = 60 * MIN
            assert.deepEqual([g.remainingMs(), g.shouldStop(6 * MIN)], [45 * MIN, false], '閘不記狀態')
        })
    })
})
