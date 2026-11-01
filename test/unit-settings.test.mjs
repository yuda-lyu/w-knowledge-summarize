// unit-settings.test.mjs — 摘要之設定(core/summarizeSettings):預設值、逐鍵覆寫、設定錯誤一律拋錯(訊息含完整路徑與可用鍵)、免費席位、
//   容量推導與容量自洽警告、判定小組同家警告、席位表、抓取設定交抓取套件驗、實例互不汙染
// 規則(出自 summarizeSettings 之設計):
//   ①三段 ai(抓取套件之 ai 段＋parallel＋健康降序 3)、summarize、capture(交抓取套件之 resolveCaptureSettings);只收此三段(他段即拋);
//     合併與型別規則取抓取套件之 mergeSettingsGroup／SETTING_TYPES;ai 段給 providerPick 即拋(摘要恆以席位呼叫 AI)
//   ②組逐鍵遞迴合併、葉給了即整個取代;不認得之鍵、型別或值域不符、組形狀錯一律拋錯,絕不靜默改用預設
//   ③預設席位全為免費模型(opencode 匿名存取);預篩、重標未給即沿用摘要席位(null;取法一份 summarizeSeatOf);判定小組預設全空且關閉;
//     預篩確認無 second
//   ④容量:預篩＝triage.rounds×ai.parallel×triage.docsPerCall(啟用判準 === true)、摘要＝rounds×ai.parallel×docsPerCall、
//     筆記產出上界＝round(摘要容量×yieldRate);raw 進料上界取抓取套件之 captureCapacityOf;下游之筆記進料上界與其形狀之判準各一份
//     (notesInflowOf／notesInflowProblem)
//   ⑤警告:預篩容量 < raw 進料(W1)、預篩放行上界 > 摘要容量(W2)、無預篩時 raw 進料 > 摘要容量(W3);只警告「進料 > 容量」;
//     已開啟之判定小組兩席首選同家且無不同家之第三席 → 警告永遠無法成立
//   ⑥各實例拿到之設定互不共用預設常數之參照
// 執行:自套件根 node <mocha> test/unit-settings.test.mjs(純函數,不連網、不寫檔)

import assert from 'node:assert/strict'
import providers from 'w-dispatch-ai/src/providers.mjs'
import {
    SUMMARIZE_AI_DEFAULT, SUMMARIZE_AI_SCHEMA, SUMMARIZE_DEFAULT, SUMMARIZE_SCHEMA,
    resolveSummarizeSettings, triageEnabledOf, summarizeCapacityOf, summarizePanelsOf, SUMMARIZE_SEAT_LABELS, summarizeSeatsOf, summarizeSeatOf,
    SUMMARIZE_CAPACITY_DESC, summarizeWarningsOf, SUMMARIZE_FEATURES, summarizeFeatureProblems, notesInflowOf, notesInflowProblem,
} from '../src/core/summarizeSettings.mjs'
import { AI_SCHEMA, AI_DEFAULT, resolveCaptureSettings, captureCapacityOf } from '../src/core/capturePackage.mjs'
import { showSettingValue, SETTING_TYPES, msgOf } from './tools/captureForTest.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { createTriageDomain } from '../src/domain/triageDomain.mjs'

const RS = (cfg) => resolveSummarizeSettings(cfg)

/**
 * 序列化供比對:函數以原始碼、RegExp 以樣式與旗標表示,undefined 亦保留
 *
 * @param {*} v 輸入任意值
 * @returns {String} 回傳序列化字串
 */
const snap = (v) => JSON.stringify(v, (k, x) => {
    if (typeof x === 'function') return `fn:${x.toString()}`
    if (x instanceof RegExp) return `re:${x.source}/${x.flags}`
    return x === undefined ? '__undefined__' : x
})

/**
 * schema 之全部葉:路徑、型別、預設值
 *
 * @param {Object} schema 輸入 schema(鍵 → 型別名或子組 schema)
 * @param {Object} dflt 輸入同形之預設值
 * @param {Array} [prefix=[]] 輸入路徑前綴
 * @returns {Array} 回傳 [{ path:Array, type:String, dflt:* }]
 */
function leavesOf(schema, dflt, prefix = []) {
    const out = []
    for (const [k, node] of Object.entries(schema)) {
        if (typeof node === 'string') out.push({ path: [...prefix, k], type: node, dflt: dflt?.[k] })
        else out.push(...leavesOf(node, dflt?.[k], [...prefix, k]))
    }
    return out
}

/**
 * schema 之全部組(含根):路徑與其 schema、預設值
 *
 * @param {Object} schema 輸入 schema
 * @param {Object} dflt 輸入同形之預設值
 * @param {Array} [prefix=[]] 輸入路徑前綴
 * @returns {Array} 回傳 [{ path:Array, schema:Object, dflt:Object }]
 */
function groupsOf(schema, dflt, prefix = []) {
    const out = [{ path: prefix, schema, dflt }]
    for (const [k, node] of Object.entries(schema)) {
        if (typeof node !== 'string') out.push(...groupsOf(node, dflt?.[k], [...prefix, k]))
    }
    return out
}

/** 由路徑與值組出巢狀覆寫物件 */
const nest = (p, value) => p.reduceRight((acc, k) => ({ [k]: acc }), value)
/** 依路徑取值 */
const getAt = (obj, p) => p.reduce((o, k) => o?.[k], obj)
/** 設定值之顯示字串:合併規則之錯誤訊息所用之同一函數(抓取套件之 showSettingValue,經測試專用之橋接) */
const show = showSettingValue

// 各型別之邊界樣本(合格樣本須通過型別判準、不合格樣本須不通過——判準取抓取套件,樣本先經其篩過再用;各型別須至少各留一個)
const SAMPLES = {
    pint: { valid: [7, 8], invalid: [0, -1, 1.5, '5', NaN, null, Infinity] },
    p0int: { valid: [7, 8], invalid: [-1, 1.5, '5', NaN, null] },
    p0num: { valid: [0.5, 2.5], invalid: [-0.1, '1', NaN, Infinity, null] },
    ratio: { valid: [0.3, 0.7], invalid: [1.5, -0.1, '0.5', NaN, null] },
    bool: { valid: [true, false], invalid: ['true', 1, 0, null] },
    str: { valid: ['custom', 'custom2'], invalid: [1, null, ['x']] },
    strArr: { valid: [['a'], ['b', 'c']], invalid: ['a', [1], [null], null, {}] },
    objArr: { valid: [[{ id: 'x' }], [{ a: 1 }, { b: 2 }]], invalid: [{}, [1], ['x'], 'x', null] },
    obj: { valid: [{ a: 1 }, { b: 2 }], invalid: ['x', [], null, 1] },
    patterns: { valid: [[/custom/i], [{ p: 'custom', f: 'i' }]], invalid: [['x'], [{ f: 'i' }], [{ p: 'x', f: 1 }], [null], 'x', null] },
    timeouts: { valid: [{ 'x:y': 1000 }], invalid: [{ a: 0 }, { a: 1.5 }, { a: '5' }, [], 'x', null] },
    pools: { valid: [{ oc: { log: 'auto' } }, { oc: { log: 'auto', resetUtcHour: 0 } }], invalid: ['x', [], null, 1, { xx: {} }, { oc: { resetUtcHour: 24 } }] },
    limits: { valid: [{ 'x:y': 30000 }, { a: 1 }], invalid: [{ a: 0 }, { a: 1.5 }, { a: '5' }, [], 'x', null] },
    seat: {
        valid: [{ use: 'x:y' }, { use: 'x:y', fallback: ['a:b'], timeoutMs: 1 }],
        invalid: ['x', {}, { use: '' }, { use: 'a', typo: 1 }, { use: 'a', fallback: 'b' }, { use: 'a', fallback: [1] }, { use: 'a', timeoutMs: 0 }, null],
    },
    seatOrNull: {
        valid: [{ use: 'x:y' }, null, { use: 'x:y', fallback: ['a:b'], budgetMs: 1 }],
        invalid: ['x', {}, { use: '' }, { use: 'a', typo: 1 }, { use: 'a', fallback: 'b' }, { use: 'a', timeoutMs: 0 }, 0, false],
    },
}

/**
 * 某型別之樣本(經型別判準篩過)
 *
 * @param {String} type 輸入型別名
 * @returns {Object} 回傳 { valid:Array, invalid:Array }
 */
function samplesOf(type) {
    const t = SETTING_TYPES[type]
    const s = SAMPLES[type]
    assert.ok(t, `型別「${type}」須在 SETTING_TYPES`)
    assert.ok(s, `型別「${type}」缺邊界樣本(新增型別須補 SAMPLES)`)
    return { valid: s.valid.filter((v) => t.test(v)), invalid: s.invalid.filter((v) => !t.test(v)) }
}

const SECTIONS = [
    ['ai', SUMMARIZE_AI_SCHEMA, SUMMARIZE_AI_DEFAULT],
    ['summarize', SUMMARIZE_SCHEMA, SUMMARIZE_DEFAULT],
]
const LEAVES = SECTIONS.flatMap(([name, schema, dflt]) => leavesOf(schema, dflt, [name]))
const GROUPS = SECTIONS.flatMap(([name, schema, dflt]) => groupsOf(schema, dflt, [name]))

// 預設抓取設定之 raw 進料上界(抓取套件之推導;本檔之期望值皆由此算,不寫死抓取之預設數字)
const CC0 = captureCapacityOf(resolveCaptureSettings())

describe('unit-settings', function() {

    describe('① 預設值', function() {

        it('回傳 ai、summarize、capture、capacity、warnings;未給 cfg、給 {}、給非物件皆同;預設設定無警告', () => {
            const s = RS({})
            assert.deepEqual(Object.keys(s), ['ai', 'summarize', 'capture', 'capacity', 'warnings'])
            assert.equal(snap(RS()), snap(s))
            assert.equal(snap(RS('x')), snap(s))
            assert.deepEqual(s.warnings, [])
            assert.equal(snap(s.capture), snap(resolveCaptureSettings()), 'capture 段即抓取套件之預設')
        })

        it('預設與 schema 之鍵集逐組一致,且每個預設值本身通過所屬型別之判準', () => {
            for (const g of GROUPS) assert.deepEqual(Object.keys(g.dflt).sort(), Object.keys(g.schema).sort(), `${g.path.join('.')}:預設鍵集應等於 schema 鍵集`)
            for (const l of LEAVES) {
                assert.ok(SETTING_TYPES[l.type], `${l.path.join('.')}:型別「${l.type}」須在抓取套件之 SETTING_TYPES`)
                assert.ok(SETTING_TYPES[l.type].test(l.dflt), `${l.path.join('.')} 之預設值須合型別「${l.type}」`)
            }
        })

        it('ai 段:抓取套件之 ai 段＋parallel(預設 3)＋健康降序預設 3(抓取套件之預設為不開;無條件式——抓取套件之 ai 段恆有此鍵)', () => {
            assert.deepEqual(SUMMARIZE_AI_SCHEMA, { ...AI_SCHEMA, parallel: 'pint' })
            assert.ok('healthStreak' in AI_SCHEMA, '前提:抓取套件之 ai 段有健康降序之鍵')
            const { healthStreak, parallel, ...rest } = SUMMARIZE_AI_DEFAULT
            assert.deepEqual([parallel, healthStreak, AI_DEFAULT.healthStreak], [3, 3, 0])
            assert.equal(snap(rest), snap(Object.fromEntries(Object.entries(AI_DEFAULT).filter(([k]) => k !== 'healthStreak'))))
            assert.notEqual(SUMMARIZE_AI_DEFAULT.providerTimeouts, AI_DEFAULT.providerTimeouts, '不共用抓取套件預設之參照')
        })

        it('summarize 段之數值預設', () => {
            const s = RS({}).summarize
            assert.deepEqual([s.rounds, s.docsPerCall, s.yieldRate, s.charsPerDoc], [6, 3, 0.5, 6000])
            assert.deepEqual(s.triage, { enabled: true, rounds: 2, docsPerCall: 20, charsPerDoc: 400, maxTries: 2, passRate: 0.5, ai: null })
            assert.deepEqual(s.refetch, { patterns: [], max: 1 })
            assert.deepEqual(s.retag, { perRun: 60, notesPerCall: 20, mechanicalPerRun: 500, ai: null })
            assert.deepEqual(s.standards, {
                triageConfirm: { enabled: false, ai: { first: null, third: null } },
                faithCheck: { enabled: false, maxTries: 3, ai: { first: null, second: null, third: null } },
                repair: { enabled: false },
                scanEachRun: false,
            })
        })

        it('免費 AI 為主:摘要之預設席位全為 opencode 匿名免費條目(w-dispatch-ai 內建目錄,免金鑰),有遞補;預篩／重標沿用(null);判定小組關閉且空席', () => {
            const s = RS({}).summarize
            const ids = [s.ai.use, ...s.ai.fallback]
            assert.deepEqual(ids, ['oc:opencode/mimo-v2.6-flash-free', 'oc:opencode/big-pickle'])
            const catalogue = new Map(providers.map((p) => [p.id, p]))
            for (const id of ids) {
                assert.ok(id.startsWith('oc:opencode/'), id)
                const e = catalogue.get(id)
                assert.ok(e, `預設席位 ${id} 須在 w-dispatch-ai 內建目錄`)
                assert.deepEqual([e.kind, e.useStoredAuth, e.envVar], ['opencode', false, undefined], `預設席位 ${id} 須為匿名免金鑰之免費存取`)
            }
            assert.deepEqual([s.triage.ai, s.retag.ai], [null, null])
            for (const p of [s.standards.triageConfirm, s.standards.faithCheck]) {
                assert.equal(p.enabled, false)
                assert.ok(Object.values(p.ai).every((x) => x === null))
            }
            assert.deepEqual(Object.keys(summarizeSeatsOf(RS({}))), ['summarize.ai'], '預設只有摘要席位一席')
        })
    })

    describe('② 逐鍵覆寫與型別錯誤(兩段 × 全部葉)', function() {

        for (const [name, schema, dflt] of SECTIONS) {
            it(`${name}:每個葉逐一覆寫 → 該葉取給定值,其餘全部葉維持預設`, () => {
                const base = RS({})
                for (const leaf of leavesOf(schema, dflt, [name])) {
                    const sample = samplesOf(leaf.type).valid.find((v) => snap(v) !== snap(leaf.dflt))
                    assert.notEqual(sample, undefined, `${leaf.path.join('.')}:找不到與預設不同之合格樣本`)
                    const r = RS(nest(leaf.path, sample))
                    assert.equal(snap(getAt(r, leaf.path)), snap(sample), `${leaf.path.join('.')} 應取給定值`)
                    for (const other of LEAVES) {
                        if (other.path.join('.') !== leaf.path.join('.')) assert.equal(snap(getAt(r, other.path)), snap(getAt(base, other.path)), `${other.path.join('.')} 不應受 ${leaf.path.join('.')} 影響`)
                    }
                }
            })

            it(`${name}:每個葉給不合格值 → 拋錯,訊息含完整路徑、型別說明與收到之值`, () => {
                for (const leaf of leavesOf(schema, dflt, [name])) {
                    const { invalid } = samplesOf(leaf.type)
                    assert.ok(invalid.length, `${leaf.path.join('.')}:缺不合格樣本`)
                    for (const bad of invalid) {
                        const m = msgOf(() => RS(nest(leaf.path, bad)))
                        const prefix = `settings.${leaf.path.join('.')} 須為${SETTING_TYPES[leaf.type].desc}，收到 ${show(bad)}`
                        assert.ok(m && m.startsWith(prefix), `${leaf.path.join('.')}=${snap(bad)}:${m}`)
                    }
                }
            })
        }

        it('組之形狀錯 → 拋(訊息含路徑);undefined／null 之組視為未給', () => {
            assert.equal(msgOf(() => RS({ summarize: 'x' })), 'settings.summarize 須為物件，收到 "x"')
            assert.equal(msgOf(() => RS({ summarize: { triage: 5 } })), 'settings.summarize.triage 須為物件，收到 5')
            assert.equal(msgOf(() => RS({ summarize: { standards: { faithCheck: { ai: [] } } } })), 'settings.summarize.standards.faithCheck.ai 須為物件，收到 array')
            assert.equal(msgOf(() => RS({ ai: true })), 'settings.ai 須為物件，收到 true')
            assert.equal(snap(RS({ summarize: { triage: null, standards: undefined } }).summarize), snap(RS({}).summarize))
        })

        it('不認得之鍵 → 拋並列該組之可用鍵(每一組皆然;鍵放錯組亦拒)', () => {
            for (const g of GROUPS) {
                const where = g.path.join('.')
                assert.equal(msgOf(() => RS(nest(g.path, { zz: 1 }))), `settings.${where} 含不認得之鍵：zz（可用：${Object.keys(g.schema).join('、')}）`, where)
            }
            assert.match(msgOf(() => RS({ summarize: { parallel: 3 } })), /^settings\.summarize 含不認得之鍵：parallel/, 'parallel 在 ai 段')
        })

        it('只收 ai、summarize、capture 三段:他段(打錯之段名、他工作之段;值為 undefined 者亦檢)→ 拋並列可用之段(總組裝只交原給之段)', () => {
            assert.equal(msgOf(() => RS({ sumarize: { rounds: 2 } })), 'settings 含不認得之鍵：sumarize（可用：ai、summarize、capture）')
            assert.equal(msgOf(() => RS({ relate: {}, workDir: 'x' })), 'settings 含不認得之鍵：relate、workDir（可用：ai、summarize、capture）')
            assert.equal(msgOf(() => RS({ extract: undefined })), 'settings 含不認得之鍵：extract（可用：ai、summarize、capture）', '值為 undefined 之段亦檢')
            assert.equal(snap(RS({ ai: undefined, summarize: undefined, capture: undefined })), snap(RS({})))
        })

        it('ai 段不收 providerPick(摘要恆以席位呼叫 AI);預篩確認無 second(預篩席即另一票)', () => {
            assert.equal(msgOf(() => RS({ ai: { providerPick: ['claude:sonnet'] } })), `settings.ai 含不認得之鍵：providerPick（可用：${Object.keys(SUMMARIZE_AI_SCHEMA).join('、')}）`)
            assert.equal(msgOf(() => RS({ summarize: { standards: { triageConfirm: { ai: { second: { use: 'x:y' } } } } } })), 'settings.summarize.standards.triageConfirm.ai 含不認得之鍵：second（可用：first、third）')
            assert.equal(msgOf(() => RS({ summarize: { standards: { triageConfirm: { ai: { second: null } } } } })), 'settings.summarize.standards.triageConfirm.ai 含不認得之鍵：second（可用：first、third）', 'null 亦拒(收下卻無效之鍵)')
        })

        it('葉給了即整個取代:席位、樣式陣列不逐層合併', () => {
            const s = RS({ summarize: { ai: { use: 'claude:sonnet' }, refetch: { patterns: [{ p: '亂碼' }] } } })
            assert.deepEqual(s.summarize.ai, { use: 'claude:sonnet' }, '未給 fallback 即無遞補(不沿用預設之 fallback)')
            assert.deepEqual(s.summarize.refetch, { patterns: [{ p: '亂碼' }], max: 1 })
        })

        it('capture 段交抓取套件驗:打錯之抓取鍵、型別錯亦拋(抓取套件之訊息);合法覆寫生效並進入 raw 進料上界', () => {
            assert.match(msgOf(() => RS({ capture: { sourcez: {} } })), /^settings\.capture 含不認得之鍵：sourcez（可用：sources、/)
            assert.equal(msgOf(() => RS({ capture: { sources: { perRun: -1 } } })), 'settings.capture.sources.perRun 須為非負整數，收到 -1')
            const s = RS({ capture: { articles: { perRun: 40 } } })
            assert.equal(s.capture.articles.perRun, 40)
            assert.equal(s.capacity.rawInflowMax, captureCapacityOf(s.capture).rawInflowMax)
            assert.equal(s.capacity.rawInflowMax, CC0.rawInflowMax + 13)
        })
    })

    describe('③ 容量推導', function() {

        it('預設:raw 進料取抓取套件之推導;預篩 2×3×20＝120、摘要 6×3×3＝54、筆記產出上界 round(54×0.5)＝27', () => {
            const s = RS({})
            assert.deepEqual(s.capacity, { rawInflowMax: CC0.rawInflowMax, gridInflowMax: CC0.gridInflowMax, rawInflowDesc: CC0.rawInflowDesc, triage: 120, summarize: 54, notesOut: 27 })
            assert.deepEqual(summarizeCapacityOf(s), s.capacity)
        })

        it('公式:ai.parallel 參與兩段;預篩未啟用為 0;yieldRate 四捨五入', () => {
            const s = RS({ ai: { parallel: 2 }, summarize: { rounds: 5, docsPerCall: 4, yieldRate: 0.33, triage: { rounds: 3, docsPerCall: 7 } } })
            assert.deepEqual([s.capacity.triage, s.capacity.summarize, s.capacity.notesOut], [42, 40, 13])
            assert.equal(RS({ summarize: { triage: { enabled: false } } }).capacity.triage, 0)
            assert.equal(RS({ summarize: { yieldRate: 0.25, rounds: 2 } }).capacity.notesOut, Math.round(18 * 0.25))
        })

        it('notesInflowOf:下游關卡(關聯、提煉)之筆記進料上界＝notesOut＋推導式說明(唯一一份;組裝者交 *WarningsOf 之 opt.inflow);notesInflowProblem:其形狀之判準(關聯、提煉同讀)', () => {
            assert.deepEqual(notesInflowOf(RS({})), { max: 27, desc: '摘要容量 54×產出率 0.5' })
            const s = RS({ ai: { parallel: 2 }, summarize: { rounds: 5, docsPerCall: 4, yieldRate: 0.33 } })
            assert.deepEqual(notesInflowOf(s), { max: 13, desc: '摘要容量 40×產出率 0.33' })
            assert.equal(notesInflowOf(s).max, summarizeCapacityOf(s).notesOut)
            for (const ok of [{ max: 0, desc: 'x' }, { max: 27.5, desc: '上游' }]) assert.equal(notesInflowProblem(ok), '', JSON.stringify(ok))
            const W = '須為 { max: 非負數（筆記進料上界，篇/輪）, desc: 非空字串（其推導式說明） }'
            for (const bad of [null, 5, 'x', [], {}, { max: -1, desc: 'x' }, { max: 1 }, { max: 1, desc: '' }, { max: Number.NaN, desc: 'x' }, { max: '1', desc: 'x' }]) {
                assert.equal(notesInflowProblem(bad), W, JSON.stringify(bad))
            }
        })
    })

    describe('④ 容量自洽警告(只警告進料 > 容量;訊息逐字)', function() {
        const inflow = CC0.rawInflowMax
        const desc = CC0.rawInflowDesc
        const W1 = (cap) => `預篩容量 ${cap}（summarize.triage.rounds×ai.parallel×summarize.triage.docsPerCall）小於 raw 進料 ${inflow}（${desc}）：raw 會在預篩關堆積；調高預篩容量或降名額`
        const W3 = (cap, inf = inflow, d = desc) => `raw 進料 ${inf}（${d}）大於摘要容量 ${cap}（summarize.rounds×ai.parallel×summarize.docsPerCall）：抓進來萃不完，raw 會逐輪堆積；調高容量或降名額`

        it('W1:預篩容量 < raw 進料 → 警告;等於 → 不警告', () => {
            const tri = (rounds, docsPerCall) => RS({ summarize: { triage: { rounds, docsPerCall } }, ai: { parallel: 1 } })
            const lt = tri(1, inflow - 1)
            assert.deepEqual(lt.warnings.filter((w) => w.startsWith('預篩容量')), [W1(inflow - 1)])
            assert.deepEqual(tri(1, inflow).warnings.filter((w) => w.startsWith('預篩容量')), [])
        })

        it('W2:預篩放行上界(min(預篩容量, 進料)×放行率,四捨五入)> 摘要容量 → 警告;等於 → 不警告', () => {
            // 進料 30(補全文 30、瀏覽器與網格 0);預篩 120 → 放行上界 round(30×0.5)＝15
            const cap = { articles: { perRun: 30 }, browser: { perRun: 0 }, areas: { perRun: 0 } }
            const d30 = captureCapacityOf(resolveCaptureSettings(cap)).rawInflowDesc
            assert.deepEqual(RS({ capture: cap, summarize: { rounds: 5, docsPerCall: 1 } }).warnings, [], '摘要 15 ＝ 放行上界 15')
            assert.deepEqual(RS({ capture: cap, summarize: { rounds: 4, docsPerCall: 1 } }).warnings, [
                '預篩放行上界約 15 篇（每輪進料 30×放行率 0.5）大於摘要容量 12（summarize.rounds×ai.parallel×summarize.docsPerCall）：放行者萃不完會在摘要關堆積；調高 summarize.rounds 或降 capture.articles.perRun',
            ])
            assert.ok(d30.startsWith('capture.articles.perRun 30＋瀏覽器名額 capture.browser.perRun 0＋grid 直入上界 0'))
            // 預設進料與預篩容量,摘要縮至 9:放行上界 round(min(120, 進料)×0.5)
            const passed = Math.round(Math.min(120, inflow) * 0.5)
            assert.deepEqual(RS({ summarize: { rounds: 1 } }).warnings, [`預篩放行上界約 ${passed} 篇（每輪進料 ${inflow}×放行率 0.5）大於摘要容量 9（summarize.rounds×ai.parallel×summarize.docsPerCall）：放行者萃不完會在摘要關堆積；調高 summarize.rounds 或降 capture.articles.perRun`])
        })

        it('W3:預篩未啟用(或預篩容量為 0)時 raw 進料 > 摘要容量 → 警告;等於 → 不警告', () => {
            const off = (o) => RS({ ai: { parallel: 1 }, summarize: { docsPerCall: 1, ...o } })
            assert.deepEqual(off({ rounds: inflow - 1, triage: { enabled: false } }).warnings, [W3(inflow - 1)])
            assert.deepEqual(off({ rounds: inflow, triage: { enabled: false } }).warnings, [])
            assert.deepEqual(off({ rounds: inflow - 1, triage: { rounds: 0 } }).warnings, [W3(inflow - 1)], '啟用而容量 0 同未啟用(raw 全數進摘要關)')
        })

        it('只警告「進料 > 容量」:容量遠大於進料不警告', () => {
            assert.deepEqual(RS({ summarize: { rounds: 100, triage: { rounds: 100 } } }).warnings, [])
        })
    })

    describe('⑤ 判定小組之同家警告(已開啟之小組;訊息逐字)', function() {
        const FAITH = (ai) => ({ summarize: { standards: { faithCheck: { enabled: true, ai } } } })
        const faithW = (use) => `筆記忠實性覆核（summarize.standards.faithCheck.ai）：first 與 second 之首選同為「${use}」且無首選不同之第三席（third）——兩票為同一供應者，判定小組永遠無法成立（只會逐輪重試、逾次轉使用者）；請改其一席之 use，或設首選不同之 third`
        const confirmW = (use) => `預篩攔下之第二席確認（summarize.standards.triageConfirm.ai）：預篩席（summarize.triage.ai，未設即 summarize.ai） 與 first 之首選同為「${use}」且無首選不同之第三席（third）——兩票為同一供應者，判定小組永遠無法成立（只會逐輪重試、逾次轉使用者）；請改其一席之 use，或設首選不同之 third`

        it('忠實性覆核:first 與 second 首選同家且無第三席、或第三席亦同家 → 警告;第三席不同家、兩席不同家、未開啟、缺席 → 不警告', () => {
            const a = { use: 'x:a', fallback: ['x:b'] }
            assert.deepEqual(RS(FAITH({ first: a, second: { use: 'x:a', fallback: ['x:c'] } })).warnings, [faithW('x:a')], '遞補不同仍以首選判同家')
            assert.deepEqual(RS(FAITH({ first: a, second: a, third: { use: 'x:a' } })).warnings, [faithW('x:a')])
            assert.deepEqual(RS(FAITH({ first: a, second: a, third: { use: 'x:c' } })).warnings, [])
            assert.deepEqual(RS(FAITH({ first: a, second: { use: 'x:b' } })).warnings, [])
            assert.deepEqual(RS(FAITH({ first: a, second: null })).warnings, [], '缺席屬組裝者之啟動期檢核')
            assert.deepEqual(RS({ summarize: { standards: { faithCheck: { enabled: false, ai: { first: a, second: a } } } } }).warnings, [], '未開啟不判')
        })

        it('預篩確認:第一票為預篩席(未設即摘要席),確認席 first 同家且無不同家之第三席 → 警告', () => {
            const confirm = (cai) => RS({ summarize: { standards: { triageConfirm: { enabled: true, ai: cai } } } })
            const sumUse = RS({}).summarize.ai.use
            // 預篩席未設 → 摘要席(預設之首選)與確認席同家
            assert.deepEqual(confirm({ first: { use: sumUse } }).warnings, [confirmW(sumUse)])
            assert.deepEqual(confirm({ first: { use: sumUse }, third: { use: 'x:c' } }).warnings, [])
            assert.deepEqual(confirm({ first: { use: 'x:b' } }).warnings, [])
            // 預篩席有設 → 以預篩席比
            assert.deepEqual(RS({ summarize: { triage: { ai: { use: 'x:b' } }, standards: { triageConfirm: { enabled: true, ai: { first: { use: 'x:b' } } } } } }).warnings, [confirmW('x:b')])
            assert.deepEqual(RS({ summarize: { triage: { ai: { use: 'x:b' } }, standards: { triageConfirm: { enabled: true, ai: { first: { use: sumUse } } } } } }).warnings, [])
            assert.deepEqual(RS({ summarize: { standards: { triageConfirm: { enabled: false, ai: { first: { use: sumUse } } } } } }).warnings, [], '未開啟不判')
        })

        it('summarizeWarningsOf(他總組裝以自解析之同形設定取同一組警告;其 ai 段可另有本套件不收之鍵)＝resolveSummarizeSettings 之 warnings;容量推導式說明為常數', () => {
            const a = { use: 'x:a' }
            const s = RS({ summarize: { rounds: 1, triage: { ai: a }, standards: { triageConfirm: { enabled: true, ai: { first: a } } } } })
            assert.deepEqual(summarizeWarningsOf(s), s.warnings)
            assert.deepEqual(summarizeWarningsOf({ ...s, ai: { ...s.ai, providerPick: ['x:a'] } }), s.warnings, 'ai 段多出之鍵不影響')
            assert.deepEqual(summarizeWarningsOf(RS({})), RS({}).warnings)
            assert.deepEqual(SUMMARIZE_CAPACITY_DESC, { triage: 'summarize.triage.rounds×ai.parallel×summarize.triage.docsPerCall', summarize: 'summarize.rounds×ai.parallel×summarize.docsPerCall', notesOut: 'round(摘要容量×summarize.yieldRate)' })
            assert.ok(s.warnings[0].includes(`（${SUMMARIZE_CAPACITY_DESC.summarize}）`), '警告引用同一說明')
        })

        it('多條警告之順序:容量警告在前,其次預篩確認、忠實性覆核', () => {
            const a = { use: 'x:a' }
            const s = RS({ summarize: { rounds: 1, triage: { ai: a }, standards: { triageConfirm: { enabled: true, ai: { first: a } }, faithCheck: { enabled: true, ai: { first: a, second: a } } } } })
            assert.equal(s.warnings.length, 3)
            assert.ok(s.warnings[0].startsWith('預篩放行上界約'))
            assert.deepEqual(s.warnings.slice(1), [confirmW('x:a'), faithW('x:a')])
        })
    })

    describe('⑥ 席位表', function() {

        it('SUMMARIZE_SEAT_LABELS:全部可設之席位(路徑 → 顯示名),序同組裝者列席位之序;預篩確認無 second', () => {
            assert.deepEqual(SUMMARIZE_SEAT_LABELS, {
                'summarize.ai': '摘要',
                'summarize.triage.ai': '預篩',
                'summarize.retag.ai': '重標',
                'summarize.standards.triageConfirm.ai.first': '預篩確認席',
                'summarize.standards.triageConfirm.ai.third': '預篩確認第三席',
                'summarize.standards.faithCheck.ai.first': '忠實性覆核第一席',
                'summarize.standards.faithCheck.ai.second': '忠實性覆核第二席',
                'summarize.standards.faithCheck.ai.third': '忠實性覆核第三席',
            })
            assert.ok(Object.isFrozen(SUMMARIZE_SEAT_LABELS))
        })

        it('summarizeSeatsOf:只列已設之席位(null 不列),值即設定之席位;全設時路徑與席位表一致', () => {
            const seat = (n) => ({ use: `x:${n}` })
            const s = RS({
                summarize: {
                    triage: { ai: seat('t') }, retag: { ai: seat('r') },
                    standards: { triageConfirm: { ai: { first: seat('c1'), third: seat('c3') } }, faithCheck: { ai: { first: seat('f1'), second: seat('f2'), third: seat('f3') } } },
                },
            })
            const seats = summarizeSeatsOf(s)
            assert.deepEqual(Object.keys(seats), Object.keys(SUMMARIZE_SEAT_LABELS))
            assert.deepEqual(Object.values(seats).map((x) => x.use), [s.summarize.ai.use, 'x:t', 'x:r', 'x:c1', 'x:c3', 'x:f1', 'x:f2', 'x:f3'])
            assert.deepEqual(Object.keys(summarizeSeatsOf(RS({ summarize: { standards: { faithCheck: { ai: { second: seat('f2') } } } } }))), ['summarize.ai', 'summarize.standards.faithCheck.ai.second'])
            assert.deepEqual(summarizeSeatsOf({}), {}, '無 summarize 段 → 空')
        })

        it('summarizeSeatOf:預篩、重標之生效席位(未設即沿用摘要席位;明給者優先);其餘步與未給為摘要席位;取法唯一一份(子階段之呼叫與判定小組之預篩席同讀)', () => {
            const d = RS({}).summarize
            assert.deepEqual([summarizeSeatOf(d, 'triage'), summarizeSeatOf(d, 'retag'), summarizeSeatOf(d)], [d.ai, d.ai, d.ai])
            const own = RS({ summarize: { triage: { ai: { use: 'x:t' } }, retag: { ai: { use: 'x:r' } } } }).summarize
            assert.deepEqual([summarizeSeatOf(own, 'triage').use, summarizeSeatOf(own, 'retag').use, summarizeSeatOf(own, 'faithCheck')], ['x:t', 'x:r', own.ai], '他步不取其段之 ai')
            assert.deepEqual([summarizeSeatOf(undefined, 'triage'), summarizeSeatOf({}, 'retag')], [undefined, undefined])
            assert.equal(summarizePanelsOf(RS({ summarize: { triage: { ai: { use: 'x:t' } } } }))[0].members[0].seat.use, 'x:t', '判定小組之預篩席同讀')
        })

        it('summarizePanelsOf:兩組判定小組(預篩確認 SS5、忠實性覆核 SS14)之開啟、成員(預篩確認之第一票＝預篩席,未設即摘要席)、必填與投票組合;同家警告讀同一份', () => {
            const seat = (n) => ({ use: `x:${n}` })
            const off = summarizePanelsOf(RS({}))
            assert.deepEqual(off.map((g) => [g.std, g.path, g.on]), [['SS5', 'summarize.standards.triageConfirm.ai', false], ['SS14', 'summarize.standards.faithCheck.ai', false]])
            assert.deepEqual(off.map((g) => g.members.map((m) => [m.label.split('（')[0], m.required])), [[['預篩席', true], ['first', true], ['third', false]], [['first', true], ['second', true], ['third', false]]])
            assert.deepEqual(off.map((g) => g.ballots), [[[0, 1, 2]], [[0, 1, 2]]])
            assert.deepEqual([off[0].members[0].seat.use, off[0].members[1].seat, off[1].members[0].seat], [RS({}).summarize.ai.use, null, null], '預篩席未設即摘要席;未設之席為 null')
            const on = summarizePanelsOf(RS({ summarize: { triage: { ai: seat('t') }, standards: { triageConfirm: { enabled: true, ai: { first: seat('c1'), third: seat('c3') } }, faithCheck: { enabled: true, ai: { first: seat('f1'), second: seat('f2') } } } } }))
            assert.deepEqual(on.map((g) => [g.on, g.members.map((m) => m.seat?.use ?? null)]), [[true, ['x:t', 'x:c1', 'x:c3']], [true, ['x:f1', 'x:f2', null]]])
            assert.deepEqual(summarizePanelsOf({}), [], '無 summarize 段 → 空')
        })

        it('SUMMARIZE_FEATURES:功能表(修補、忠實性覆核、預篩確認;凍結);summarizeFeatureProblems 為其單一判定(席位在前、成員在後;未開之功能不檢;o.enabled 覆寫設定之開關;o.domainLabel 為訊息中 domain 之稱呼)', () => {
            assert.deepEqual(SUMMARIZE_FEATURES.map((f) => [f.key, f.panel?.path || '', f.panel?.seats || [], f.members || []]), [
                ['repair', '', [], ['buildRepairPrompt']],
                ['faithCheck', 'summarize.standards.faithCheck.ai', ['first', 'second'], ['buildFaithCheckPrompt']],
                ['triageConfirm', 'summarize.standards.triageConfirm.ai', ['first'], []],
            ])
            assert.ok(Object.isFrozen(SUMMARIZE_FEATURES) && SUMMARIZE_FEATURES.every((f) => Object.isFrozen(f)))
            assert.deepEqual(summarizeFeatureProblems(RS({}), {}), [], '皆未開 → 無問題(缺成員亦不檢)')
            const on = RS({ summarize: { standards: { repair: { enabled: true }, faithCheck: { enabled: true, ai: { first: { use: 'x:a' } } }, triageConfirm: { enabled: true } } } })
            assert.deepEqual(summarizeFeatureProblems(on, {}), [
                '筆記忠實性覆核(summarize.standards.faithCheck.enabled)已啟用,但缺席位 settings.summarize.standards.faithCheck.ai.second',
                '預篩攔下之第二席確認(summarize.standards.triageConfirm.enabled)已啟用,但缺席位 settings.summarize.standards.triageConfirm.ai.first',
                '摘要欄位定向修補呼叫(summarize.standards.repair.enabled)已啟用,但 domain 缺 buildRepairPrompt',
                '筆記忠實性覆核(summarize.standards.faithCheck.enabled)已啟用,但 domain 缺 buildFaithCheckPrompt',
            ])
            assert.deepEqual(summarizeFeatureProblems(on, createSummarizeDomain({}), { enabled: ['repair'] }), [], '子階段之選項覆寫:只檢所給之功能')
            assert.deepEqual(summarizeFeatureProblems(RS({}), {}, { enabled: ['repair'], domainLabel: 'cfg.domains.summarize' }), ['摘要欄位定向修補呼叫(summarize.standards.repair.enabled)已啟用,但 cfg.domains.summarize 缺 buildRepairPrompt'])
            // 判定小組之必填由功能表推導:各小組具 key 之成員之必填＝其功能所需之席
            assert.deepEqual(summarizePanelsOf(RS({})).map((g) => g.members.filter((m) => m.required).map((m) => m.label.split('（')[0])), [['預篩席', 'first'], ['first', 'second']])
        })
    })

    describe('⑦ 實例互不汙染', function() {

        it('就地修改某次解析之設定,不影響下次解析與預設常數', () => {
            const a = RS({})
            a.summarize.ai.fallback.push('claude:sonnet')
            a.summarize.refetch.patterns.push({ p: 'x' })
            a.ai.providerTimeouts['x:y'] = 1
            a.summarize.standards.faithCheck.ai.first = { use: 'x:y' }
            const b = RS({})
            assert.deepEqual(b.summarize.ai.fallback, ['oc:opencode/big-pickle'])
            assert.deepEqual(b.summarize.refetch.patterns, [])
            assert.deepEqual(b.ai.providerTimeouts, {})
            assert.equal(b.summarize.standards.faithCheck.ai.first, null)
            assert.deepEqual(SUMMARIZE_DEFAULT.ai.fallback, ['oc:opencode/big-pickle'])
        })
    })

    describe('⑧ 預設之單一來源(各退路讀 SUMMARIZE_DEFAULT;啟用判準只有 triageEnabledOf)', function() {

        it('triageEnabledOf:=== true 才啟用(未經解析之裸設定、缺段皆未啟用);容量推導與之一致', () => {
            assert.equal(triageEnabledOf(RS({}).summarize), true)
            assert.equal(triageEnabledOf(RS({ summarize: { triage: { enabled: false } } }).summarize), false)
            for (const bare of [undefined, null, {}, { triage: {} }, { triage: { enabled: 'true' } }, { triage: { enabled: 1 } }]) assert.equal(triageEnabledOf(bare), false, JSON.stringify(bare))
            const off = RS({ summarize: { triage: { enabled: false } } })
            assert.equal(summarizeCapacityOf(off).triage, 0)
            assert.ok(summarizeCapacityOf(RS({})).triage > 0)
        })

        it('domain 工廠未給字數時取 SUMMARIZE_DEFAULT(改預設常數即隨之;測後還原):摘要每篇內文上限、預篩片段字數與長文門檻', () => {
            const keep = { chars: SUMMARIZE_DEFAULT.charsPerDoc, tri: SUMMARIZE_DEFAULT.triage.charsPerDoc }
            const doc = { title: 'T', sourceName: 'S', url: 'https://example.com/a', text: '甲'.repeat(900) }
            const countIn = (p) => (p.match(/甲/g) || []).length
            try {
                SUMMARIZE_DEFAULT.charsPerDoc = 123
                SUMMARIZE_DEFAULT.triage.charsPerDoc = 45
                assert.equal(countIn(createSummarizeDomain({}).buildPrompt([doc], [])), 123, '摘要:未給 summarizeCharsPerDoc → SUMMARIZE_DEFAULT.charsPerDoc')
                // 預篩:長文門檻(123)以上另附中段 → 開頭＋中段各 45 字
                assert.equal(countIn(createTriageDomain({}).buildPrompt([doc])), 90, '預篩:片段字數＝triage.charsPerDoc、長文門檻＝charsPerDoc')
            }
            finally {
                SUMMARIZE_DEFAULT.charsPerDoc = keep.chars
                SUMMARIZE_DEFAULT.triage.charsPerDoc = keep.tri
            }
            assert.equal(countIn(createSummarizeDomain({}).buildPrompt([doc], [])), 900, '還原後:900 字 ≤ 6000 全文進提示詞')
        })
    })
})
