// unit-summarize-object.test.mjs — 摘要物件(summarizeObject):階段契約、子階段序列與隔離、平鋪 opts 之分派、tap 合併、固定格式摘要
//   應然取自 summarizeObject 檔頭與 JSDoc 之契約:
//   ①物件＝子階段序列(triage → summarize → retag → sync),工廠零參數即可用;階段契約欄位可覆寫,未給者不出現
//   ②子階段失敗預設隔離(記於 report、續跑後續子階段),宣告 onError:'abort' 才中止整個物件;物件預設 onError:'continue'
//   ③平鋪 opts 只給摘要子階段,預篩只吃 opt.triage 與 SUMMARIZE_SHARED_KEYS;平鋪 tap 與 opt.summarize.tap 合併而非覆蓋(同錨點 replace 衝突拋錯);
//     opt.triage.enabled:false 時摘要自動 requireTriage:false(明給者從其給)
//   ④有動作鏈之子階段＝SUMMARIZE_TAP_STAGE_KEYS(retag／sync 給 tap／chain 即拋,由子階段工廠負責)
//   ⑤固定格式摘要(summarizeSummaryOf)為對外契約:第一段恆在,其餘段 >0 才附、依序附於句尾;有子階段失敗時一律改走通用摘要並列出失敗者
// 移植原實作之 unit-objects(37、67、110、208、217、243、273 之摘要部分)與 unit-standards-gate(236)各案(斷言不變;設定改本套件之
//   resolveSummarizeSettings、插件之掛載改以 opt.<子階段>.tap 直給、測試夾具之題材改中立);其餘為新增。
// 執行:自套件根 node <mocha> test/unit-summarize-object.test.mjs(暫存 test/_tmp/summarize-object-<pid>,測完即刪;記憶體集合,不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memStore, nullLogger, setConceptFold, genClockTZ } from './tools/captureForTest.mjs'
import { recLog, bagCtx } from './tools/stageKit.mjs'
import { defineMw, stdReport } from '../src/core/capturePackage.mjs'
import { resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { createRetagDomain } from '../src/domain/retagDomain.mjs'
import { createTriageDomain } from '../src/domain/triageDomain.mjs'
import { stageSummarize } from '../src/stages/noteStage.mjs'
import { createKnowledgeSummarize } from '../src/createKnowledgeSummarize.mjs'
import { createSummarizeObject, summarizeSummaryOf, SUMMARIZE_STAGE_KEYS, SUMMARIZE_TAP_STAGE_KEYS, SUMMARIZE_SHARED_KEYS } from '../src/summarizeObject.mjs'

const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/summarize-object-${process.pid}`).replace(/\\/g, '/')
const TMP_O = `${TMP}/o`
const clock = genClockTZ('Asia/Taipei')

/**
 * 預設子階段所需之依賴(記憶體集合;分類法與同步雜湊之狀態落 TMP)
 *
 * @param {Object} [extra={}] 輸入覆寫
 * @returns {Object} 回傳 deps
 */
const mkDeps = (extra = {}) => ({
    stores: { docs: memStore(), notes: memStore(), frontier: memStore(), holds: memStore(), docTexts: memStore() },
    settings: resolveSummarizeSettings({}),
    ai: null,
    clock,
    dirs: { notes: `${TMP}/notes`, state: `${TMP}/state` },
    domains: { triage: createTriageDomain({}), summarize: createSummarizeDomain({}), retag: createRetagDomain({}) },
    ...extra,
})

describe('unit-summarize-object', function() {

    before(() => {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })
    after(() => {
        fs.rmSync(TMP, { recursive: true, force: true })
        setConceptFold(null) // 總組裝會注入模組級之概念折疊,不留給同 worker 之他檔
    })

    // ══════════════════════════ 工廠契約 ══════════════════════════
    describe('createSummarizeObject 工廠契約', function() {

        it('零參數即符合階段契約(name＋run),失敗預設隔離(onError:continue)——摘要失敗不阻斷同一管線之後段', () => {
            const o = createSummarizeObject()
            assert.equal(typeof o.name, 'string')
            assert.equal(typeof o.run, 'function')
            assert.equal(o.onError, 'continue', '預設不阻斷後段')
            assert.equal(o.name, '摘要')
        })

        it('opt 非物件(null/字串/數字/陣列)→ 視為{},回傳零參數之預設階段物件(不拋錯);name 覆寫生效', () => {
            for (const bogus of [null, 'bogus', 42, [1, 2]]) {
                const o = createSummarizeObject(bogus)
                assert.deepEqual([o.name, o.onError], ['摘要', 'continue'])
            }
            assert.equal(createSummarizeObject({ name: 's2' }).name, 's2')
        })

        it('階段契約欄位可覆寫(name/onError/when/timeoutMs/always),未給者不出現', () => {
            const o = createSummarizeObject({ name: 'summarize2', onError: 'abort', timeoutMs: 5000, when: () => false, always: true })
            assert.deepEqual([o.name, o.onError, o.timeoutMs, typeof o.when, o.always], ['summarize2', 'abort', 5000, 'function', true])
            const bare = createSummarizeObject()
            assert.deepEqual(['when', 'timeoutMs', 'always'].map((k) => k in bare), [false, false, false])
        })

        it('SUMMARIZE_STAGE_KEYS 依執行順序列出內建子階段;SUMMARIZE_SHARED_KEYS 為預篩與摘要共用之平鋪鍵;皆凍結', () => {
            assert.deepEqual([...SUMMARIZE_STAGE_KEYS], ['triage', 'summarize', 'retag', 'sync'])
            assert.deepEqual([...SUMMARIZE_SHARED_KEYS], ['callAI', 'parallel', 'statuses'])
            assert.ok(Object.isFrozen(SUMMARIZE_STAGE_KEYS) && Object.isFrozen(SUMMARIZE_TAP_STAGE_KEYS) && Object.isFrozen(SUMMARIZE_SHARED_KEYS))
        })

        it('SUMMARIZE_TAP_STAGE_KEYS＝實際有動作鏈之子階段(由各工廠之行為推導,不手列):有鏈者對不存在之錨點拋「無錨點」,無鏈者(retag、sync)拒收 tap／chain', () => {
            const tapped = []
            for (const k of SUMMARIZE_STAGE_KEYS) {
                let m = ''
                try {
                    createSummarizeObject({ [k]: { tap: { __noSuchAnchor: { after: [] } } } })
                }
                catch (e) {
                    m = String(e.message)
                }
                if (/無錨點「__noSuchAnchor」/.test(m)) tapped.push(k)
                else assert.match(m, new RegExp(`子階段\\[${k}\\] 無動作鏈\\(hook 錨點\\),不可給 tap`), `${k}:${m}`)
            }
            assert.deepEqual(tapped, [...SUMMARIZE_TAP_STAGE_KEYS])
            for (const k of SUMMARIZE_STAGE_KEYS.filter((x) => !SUMMARIZE_TAP_STAGE_KEYS.includes(x))) {
                assert.throws(() => createSummarizeObject({ [k]: { chain: [] } }), new RegExp(`子階段\\[${k}\\] 無動作鏈\\(hook 錨點\\),不可給 chain`))
                assert.doesNotThrow(() => createSummarizeObject({ [k]: { tap: null, chain: undefined } }), `${k}:null／undefined 視為未給`)
            }
        })

        it('預篩之錨點經 opt.triage.tap 送達預篩子階段(settleTriage 可掛);預篩鏈不存在之錨點組裝期拋錯;retag／sync 之 tap 一律組裝期拋錯——不靜默無效', () => {
            const a = defineMw({ name: 'a', handle: (m, c, n) => n(m) })
            assert.doesNotThrow(() => createSummarizeObject({ triage: { tap: { settleTriage: { after: [a] } } } }))
            assert.throws(() => createSummarizeObject({ triage: { tap: { nope: { after: [a] } } } }), /summarize\.triage.*無錨點「nope」/)
            for (const k of ['retag', 'sync']) {
                assert.throws(() => createSummarizeObject({ [k]: { tap: { x: { after: [a] } } } }), new RegExp(`子階段\\[${k}\\] 無動作鏈`), `${k}.tap`)
            }
        })
    })

    // ══════════════════════════ 子階段序列與隔離 ══════════════════════════
    describe('子階段序列與隔離', function() {

        it('自寫子階段宣告 onError:abort → 物件外拋(可被 pipeline 隔離)', async () => {
            const obj = createSummarizeObject({
                stages: [{
                    name: 'hard',
                    onError: 'abort',
                    run: async () => {
                        throw new Error('硬炸')
                    },
                }],
            })
            await assert.rejects(() => obj.run({ deps: {}, log: nullLogger() }), /硬炸/)
        })

        it('物件 stages 可整組換成自寫單元:單一子階段失敗被隔離、後續照跑、留 WARN;物件 report.ok 為 false;摘要走通用格式並列出失敗者', async () => {
            const trace = []
            const log = recLog()
            const obj = createSummarizeObject({
                stages: [
                    { name: 'o1', run: async () => {
                        trace.push('o1')
                        return stdReport({ stats: { in: 1, out: 1 } })
                    } },
                    { name: 'boom', run: async () => {
                        throw new Error('炸')
                    } },
                    { name: 'o2', run: async () => {
                        trace.push('o2')
                        return stdReport({ stats: { in: 2, out: 2 } })
                    } },
                ],
            })
            const r = await obj.run({ deps: {}, log })
            assert.deepEqual(trace, ['o1', 'o2'], 'boom 失敗後 o2 仍執行')
            assert.ok(log.lines.includes('WARN 子階段[boom] 失敗（續跑後續子階段）：炸'), log.lines.join('\n'))
            assert.deepEqual([r.ok, r.stats.in, r.stats.fail, Object.keys(r.detail)], [false, 3, 1, ['o1', 'boom', 'o2']])
            assert.equal(r.summary, '2/3 段完成（in 3、out 3、fail 1）｜失敗：boom')
        })

        it('預設子階段依序為 triage → summarize → retag → sync;無資料之空輪全數成功、用固定格式摘要(各計數為 0、無附加段)', async () => {
            const r = await createSummarizeObject().run(bagCtx(mkDeps(), nullLogger()))
            assert.deepEqual(Object.keys(r.detail), ['triage', 'summarize', 'retag', 'sync'])
            assert.equal(r.ok, true, JSON.stringify(Object.entries(r.detail).filter(([, x]) => x.ok === false)))
            assert.equal(r.summary, '處理 0、新知識 0、略過 0、線索 0（AI 0 次）')
            assert.equal(r.detail.retag.detail.initialized, true, '重標首輪記錄分類法')
        })

        it('opt.<子階段名> 透傳對應之子階段工廠:retag／sync 之 enabled:false 即停用(detail 只有 disabled)', async () => {
            const r = await createSummarizeObject({ retag: { enabled: false }, sync: { enabled: false } }).run(bagCtx(mkDeps(), nullLogger()))
            assert.deepEqual([r.detail.retag.detail, r.detail.sync.detail], [{ disabled: true }, { disabled: true }])
            assert.equal(r.ok, true)
        })

        it('每個子階段皆收 enabled:false 與 when(ctx)(工廠以抓取套件之 stageFields 組契約欄位,runSubStages 據以略過):停用者 report 為 { disabled:true }、不執行;when 不合者不入 report', async () => {
            // 規則:抓取套件 captureObject.runSubStages 與 core/kernel.stageFields——cfg.stageOpts.<子階段>.enabled:false 對四套件之子階段一體適用
            const never = async () => assert.fail('停用之子階段不得呼叫 AI')
            const r = await createSummarizeObject({ triage: { enabled: false }, summarize: { enabled: false }, retag: { enabled: false }, sync: { enabled: false }, callAI: never }).run(bagCtx(mkDeps(), nullLogger()))
            assert.deepEqual(Object.values(r.detail).map((x) => x.detail), [{ disabled: true }, { disabled: true }, { disabled: true }, { disabled: true }])
            assert.equal(r.ok, true)
            const w = await createSummarizeObject({ triage: { when: () => false }, summarize: { when: () => false }, callAI: never }).run(bagCtx(mkDeps(), nullLogger()))
            assert.deepEqual(['triage' in w.detail, 'summarize' in w.detail, 'retag' in w.detail], [false, false, true])
        })
    })

    // ══════════════════════════ 平鋪 opts 與子階段 opts ══════════════════════════
    describe('平鋪 opts 之分派與 tap 合併', function() {

        it('平鋪 callAI 與 opt.summarize.tap 同時生效;逐項鏈內 ctx.emit 可用', async () => {
            let called = 0
            let replaced = 0
            let emitType = ''
            const item = { index: 1, relevant: true, title: 'T', key_points: ['k'], concepts: ['c', 'c2'], summary: 's', category: '方法與技術', claim_type: '實證研究', evidence_level: '中' }
            const obj = createSummarizeObject({
                callAI: async () => {
                    called++
                    return { ok: true, data: [item], error: '', skipped: false, attempts: 1, preview: '' }
                }, // 平鋪
                summarize: {
                    tap: {
                        persistNote: {
                            replace: defineMw({
                                name: 'persistNote',
                                handle: async (m, c, n) => {
                                    replaced++
                                    emitType = typeof c.emit
                                    return n(m)
                                },
                            }),
                        },
                    },
                }, // 子階段之 tap
            })
            const deps = {
                stores: { docs: memStore([{ id: 'd1', status: 'raw', title: 'doc', text: 'x'.repeat(50), url: 'https://e.com/a', sourceName: 's', sourceTier: 1, collectedAt: '2026-01-01' }]), notes: memStore(), frontier: memStore() },
                settings: resolveSummarizeSettings({}),
                ai: null,
                clock,
                dirs: { notes: TMP_O, state: `${TMP}/state-110` },
                domains: { summarize: createSummarizeDomain({}) },
            }
            await obj.run({ deps, log: nullLogger(), expired: () => false, get: (k, d) => d, set: () => {} })
            assert.equal(called, 2, '平鋪的 callAI 須被使用(有 opt.summarize 時亦然):預篩 1 次(放行)＋摘要 1 次')
            assert.equal(replaced, 1, 'opt.summarize.tap 的 replace 須被使用')
            assert.equal(emitType, 'function', '逐項鏈內須提供 ctx.emit')
            assert.equal((await deps.stores.docs.get('d1')).status, 'noted')
        })

        it('平鋪之摘要專屬 opts(tap/domain/docsPerBatch)不灌進預篩;預篩只吃 opt.triage＋通用鍵(callAI/parallel/statuses)', async () => {
            const noopPersist = { persistNote: { replace: defineMw({ name: 'persistNote', handle: async (m, c, n) => n(m) }) } }
            assert.doesNotThrow(() => createSummarizeObject({ tap: noopPersist }), '平鋪 tap(摘要錨點)不得讓預篩鏈於組裝期拋「無錨點」')
            const seenPrompts = []
            const item = { index: 1, relevant: true, title: 'T', key_points: ['k'], concepts: ['c', 'c2'], summary: 's', category: '方法與技術', claim_type: '實證研究', evidence_level: '中' }
            const obj = createSummarizeObject({
                domain: { ...createSummarizeDomain({}), buildPrompt: async () => 'SUMMARIZE-PROMPT' }, // 平鋪:摘要專屬
                docsPerBatch: 1, // 平鋪:摘要專屬(預篩應沿用自身之每批篇數)
                callAI: async (p) => {
                    seenPrompts.push(p === 'SUMMARIZE-PROMPT' ? 'summarize' : (p.startsWith('你是知識庫的預篩器') ? 'triage' : 'other'))
                    const data = p === 'SUMMARIZE-PROMPT' ? [item] : [{ index: 1, relevant: true }, { index: 2, relevant: true }]
                    return { ok: true, data, error: '', skipped: false, attempts: 1, preview: '' }
                },
            })
            const mkDoc = (id, at) => ({ id, status: 'raw', title: id, text: 'x'.repeat(50), url: `https://e.com/${id}`, sourceName: 's', sourceTier: 1, collectedAt: at })
            const deps = {
                stores: { docs: memStore([mkDoc('d1', '2026-01-01'), mkDoc('d2', '2026-01-02')]), notes: memStore(), frontier: memStore() },
                settings: resolveSummarizeSettings({}),
                ai: null,
                clock,
                dirs: { notes: TMP_O, state: `${TMP}/state-243` },
                domains: { summarize: createSummarizeDomain({}) },
            }
            await obj.run({ deps, log: nullLogger(), expired: () => false, get: (k, d) => d, set: () => {} })
            assert.equal(seenPrompts.filter((x) => x === 'triage').length, 1, '預篩用自身 domain 之 prompt、且一次看完 2 篇(未被平鋪 docsPerBatch:1 改成每批 1 篇)')
            assert.ok(!seenPrompts.includes('other'), '預篩不得改用平鋪之摘要 domain')
            assert.ok(seenPrompts.includes('summarize'), '摘要仍吃平鋪之 domain')
            assert.equal((await deps.stores.docs.get('d1')).triage, 'relevant')
        })

        it('平鋪 tap 與子階段 tap 合併而非覆蓋:兩者同錨點之 before／after 皆生效;同錨點皆 replace 即衝突拋錯;opt.triage.enabled:false → 摘要自動不要求已放行', async () => {
            const seen = []
            const mw = (name) => defineMw({ name, handle: async (m, c, n) => {
                seen.push(name)
                return n(m)
            } })
            const item = { index: 1, relevant: false, reason: 'x' }
            const obj = createSummarizeObject({
                tap: { skipGate: { before: [mw('flat-before')] } }, // 平鋪(執行端直接給)
                summarize: { tap: { skipGate: { after: [mw('sub-after')] } } }, // 子階段之 tap
                triage: { enabled: false },
                callAI: async () => ({ ok: true, data: [item], error: '', skipped: false, attempts: 1, preview: '' }),
            })
            const deps = {
                stores: { docs: memStore([{ id: 'd1', status: 'raw', title: 'doc', text: 'x'.repeat(50), url: 'https://e.com/a', sourceName: 's', sourceTier: 1, collectedAt: '2026-01-01' }]), notes: memStore(), frontier: memStore() },
                settings: resolveSummarizeSettings({}), // summarize.triage.enabled 預設 true
                ai: null,
                clock,
                dirs: { notes: TMP_O, state: `${TMP}/state-273` },
                domains: { summarize: createSummarizeDomain({}) },
            }
            await obj.run({ deps, log: nullLogger(), expired: () => false, get: (k, d) => d, set: () => {} })
            assert.deepEqual(seen, ['flat-before'], '平鋪之 before 生效;skipGate 短路故 after 不執行')
            assert.equal((await deps.stores.docs.get('d1')).status, 'skip', 'opt.triage.enabled:false → 摘要自動不要求已放行(設定之預篩開關仍為開時,否則永遠取不到件)')
            assert.throws(() => createSummarizeObject({ tap: { persistNote: { replace: mw('a') } }, summarize: { tap: { persistNote: { replace: mw('b') } } } }), /summarize\.summarize 錨點\[persistNote\] 之 replace 衝突/)
            // 總組裝之未知鍵與設定段之未知鍵於組裝期拋錯
            const wd = `${TMP}/assembly-273`
            assert.throws(() => createKnowledgeSummarize({ workDir: wd, afterRun: false, aiAdapter: { callJson: async () => ({}) }, knowlege: {} }), /cfg 含不認得之鍵：knowlege（可用：/)
            assert.throws(() => createKnowledgeSummarize({ workDir: wd, afterRun: false, aiAdapter: { callJson: async () => ({}) }, ai: { workspace: 'x' } }), /settings\.ai 含不認得之鍵：workspace/)
        })

        it('opt.triage.enabled:false 而摘要明給 requireTriage:true 者從其給:池中皆無預篩結果 → 摘要不取件並 WARN(預篩段停用或未執行)', async () => {
            const log = recLog()
            const deps = mkDeps({ stores: { docs: memStore([{ id: 'd1', status: 'raw', title: 'doc', text: 'x'.repeat(50), url: 'https://e.com/a', sourceName: 's', sourceTier: 1, collectedAt: '2026-01-01' }]), notes: memStore(), frontier: memStore(), holds: memStore() } })
            const never = async () => assert.fail('不應呼叫 AI')
            const r = await createSummarizeObject({ triage: { enabled: false }, summarize: { requireTriage: true }, callAI: never }).run(bagCtx(deps, log))
            assert.equal(r.detail.summarize.detail.processed, 0)
            assert.ok(log.lines.some((l) => /^WARN 摘要：raw 池 1 篇皆無預篩結果而本段只取已放行者——預篩段停用或未執行？/.test(l)), log.lines.join('\n'))
        })
    })

    // ══════════════════════════ 固定格式摘要 ══════════════════════════
    describe('固定格式摘要(summarizeSummaryOf)與通用摘要', function() {

        const SRC = '觀測研究\nThe survey recorded 8.2% coverage over 2010-2024; error 0.15%.'
        const ITEM = (o = {}) => ({ index: 1, relevant: true, title: '觀測研究之實證', summary: '觀測覆蓋率 8.2%', key_points: ['覆蓋率 8.2%'], concepts: ['觀測方法', '覆蓋率'], claim_type: '實證研究', evidence_level: '中', ...o })
        const domain = createSummarizeDomain({ vocab: { claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] } })
        const doc = (id, o = {}) => ({ id, status: 'raw', title: '觀測研究', text: SRC, url: `https://e.com/${id}`, sourceName: 's', sourceTier: 1, collectedAt: '2026-09-01', ...o })
        const deps = (docs, notes, dir) => ({ stores: { docs, notes, frontier: memStore() }, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: false } } }), clock, dirs: { notes: dir }, domains: { summarize: domain } })

        it('摘要物件摘要:句尾附「｜標準修正 N、未達標準 N」(>0 才附;契約前段不變);未達標準之篇計未涵蓋 → 另附「｜失敗 N」', async () => {
            const docs = memStore([doc('s1'), doc('s2')])
            const items = { 1: ITEM({ key_points: ['覆蓋率 8.2%', '誤差 1.9'] }), 2: ITEM({ concepts: ['甲'] }) }
            const callAI = async (p) => {
                const n = (p.match(/^--- 第\d+篇 ---$/gm) || []).length
                return { ok: true, data: Array.from({ length: n }, (_, i) => ({ ...items[i + 1], index: i + 1 })), providerId: 'p1' }
            }
            const ctx = { deps: deps(docs, memStore(), `${TMP}/obj`), log: nullLogger(), set: () => {}, get: (k, d) => d }
            const rep = await createSummarizeObject({ stages: [stageSummarize({ docsPerBatch: 2, parallel: 1, rounds: 1, callAI })] }).run(ctx)
            assert.match(rep.summary, /^處理 1、新知識 1、略過 0、線索 0（AI 1 次）｜標準修正 1、未達標準 1｜失敗 1$/, rep.summary)
        })

        it('缺 summarize 之 detail(或 reports 非物件)→ 回空字串,由 summaryOf 退用通用摘要', () => {
            for (const bad of [undefined, null, 'x', 5, {}, { triage: { detail: { processed: 1 } } }, { summarize: { stats: {} } }]) assert.equal(summarizeSummaryOf(bad), '', JSON.stringify(bad))
        })

        it('第一段「處理 N、新知識 N、略過 N、線索 N（AI N 次）」恆在;各附加段只在其計數 >0 時附上,依序附於句尾(全開之全文逐字)', () => {
            const r = (detail, stats = {}) => ({ ok: true, stats: { in: 0, out: 0, skip: 0, fail: 0, aiCalls: 0, ...stats }, detail })
            const base = { processed: 3, notes: 1, skipped: 1, explore: 2, materialRefetch: 0, truncated: 0 }
            const zero = {
                triage: r({ processed: 0, relevant: 0, materialRefetch: 0, confirmClosed: 0 }, { aiCalls: 1 }),
                summarize: r({ ...base, stdFixed: 0, stdRejected: 0, faithChecked: 0, stdRepaired: 0, stdRepairFailed: 0, stdHeld: 0, stdHoldsEscalated: 0 }, { aiCalls: 2 }),
                retag: r({ changed: 0 }, { aiCalls: 4 }),
                sync: r({ changed: 0, stdFixed: 0, stdHeld: 0 }),
            }
            assert.equal(summarizeSummaryOf(zero), '處理 3、新知識 1、略過 1、線索 2（AI 2 次）', '各附加段之計數皆為 0 → 不附')
            const cases = [
                [['triage', { processed: 5, relevant: 3 }], '｜預篩 5 篇放行 3（AI 1 次）'],
                [['triage', { materialRefetch: 1 }], '｜素材退回 1'],
                [['summarize', { materialRefetch: 2 }], '｜素材退回 2'],
                [['summarize', { truncated: 4 }], '｜長文截斷 4'],
                [['retag', { changed: 2 }], '｜重標 2 篇（AI 4 次）'],
                [['sync', { changed: 3 }], '｜內容變更 3 篇'],
                [['summarize', { stdFixed: 1 }], '｜標準修正 1、未達標準 0'],
                [['summarize', { stdRejected: 2 }], '｜標準修正 0、未達標準 2'],
                [['summarize', { faithChecked: 3, faithRejected: 1, faithHeld: 1 }], '｜忠實性覆核 3 篇（不忠實 1、待判 1、重試 0）'],
                [['summarize', { stdRepaired: 1 }], '｜修補 1 篇合格、0 篇仍不合格'],
                [['summarize', { stdRepairFailed: 2 }], '｜修補 0 篇合格、2 篇仍不合格'],
                [['summarize', { stdHeld: 1 }], '｜入待判 1（轉使用者 0）'],
                [['summarize', { stdHoldsEscalated: 1 }], '｜入待判 0（轉使用者 1）'],
                [['sync', { stdFixed: 1 }], '｜同步標準修正 1 篇、待判 0 項'],
                [['sync', { stdHeld: 2 }], '｜同步標準修正 0 篇、待判 2 項'],
                [['triage', { confirmClosed: 4 }], '｜確認席關閉而依預篩攔下 4'],
                // SS5 開啟:經確認之篇數＝四種去處之和(任一 >0 即附;只有留待下輪者亦附——確認有在跑而未判完)
                [['triage', { confirmed: 2, overturned: 1, confirmUndetermined: 1, confirmRetry: 3 }], '｜預篩確認 7 篇（兩席攔下 2、推翻放行 1、不一致放行 1、留待下輪 3）'],
                [['triage', { confirmRetry: 2 }], '｜預篩確認 2 篇（兩席攔下 0、推翻放行 0、不一致放行 0、留待下輪 2）'],
            ]
            for (const [[sub, d], tail] of cases) {
                const reps = JSON.parse(JSON.stringify(zero))
                Object.assign(reps[sub].detail, d)
                assert.equal(summarizeSummaryOf(reps), `處理 3、新知識 1、略過 1、線索 2（AI 2 次）${tail}`, `${sub}:${JSON.stringify(d)}`)
            }
            // 素材退回為預篩＋摘要之和;全開之全文與段序
            const all = JSON.parse(JSON.stringify(zero))
            Object.assign(all.triage.detail, { processed: 5, relevant: 3, materialRefetch: 1, confirmClosed: 4, confirmed: 1, overturned: 1 })
            Object.assign(all.summarize.detail, { materialRefetch: 2, truncated: 4, stdFixed: 1, stdRejected: 2, faithChecked: 3, faithRejected: 1, faithHeld: 1, faithRetry: 1, stdRepaired: 1, stdRepairFailed: 2, stdHeld: 1, stdHoldsEscalated: 1 })
            Object.assign(all.retag.detail, { changed: 2 })
            Object.assign(all.sync.detail, { changed: 3, stdFixed: 1, stdHeld: 2 })
            assert.equal(summarizeSummaryOf(all), '處理 3、新知識 1、略過 1、線索 2（AI 2 次）｜預篩 5 篇放行 3（AI 1 次）｜素材退回 3｜長文截斷 4｜重標 2 篇（AI 4 次）｜內容變更 3 篇｜標準修正 1、未達標準 2｜忠實性覆核 3 篇（不忠實 1、待判 1、重試 1）｜修補 1 篇合格、2 篇仍不合格｜入待判 1（轉使用者 1）｜同步標準修正 1 篇、待判 2 項｜確認席關閉而依預篩攔下 4｜預篩確認 2 篇（兩席攔下 1、推翻放行 1、不一致放行 0、留待下輪 0）')
            // 缺預篩／重標／同步之子階段(自組時)不附其段;重標無 stats 者 AI 次數以 0 計
            assert.equal(summarizeSummaryOf({ summarize: zero.summarize }), '處理 3、新知識 1、略過 1、線索 2（AI 2 次）')
            assert.equal(summarizeSummaryOf({ summarize: zero.summarize, retag: { detail: { changed: 1 } } }), '處理 3、新知識 1、略過 1、線索 2（AI 2 次）｜重標 1 篇（AI 0 次）')
        })

        it('物件摘要:全數成功用固定格式,部分失敗(stats.fail>0)句尾附「｜失敗 N」;有子階段失敗者一律通用摘要並列出失敗者,不印 undefined', async () => {
            const okRep = (detail, stats = {}) => stdReport({ stats, detail })
            const run = async (stages) => (await createSummarizeObject({ stages }).run({ deps: {}, log: nullLogger() })).summary
            const sum = { name: 'summarize', run: async () => okRep({ processed: 2, notes: 1, skipped: 1, explore: 0 }, { aiCalls: 1, fail: 2 }) }
            assert.equal(await run([sum]), '處理 2、新知識 1、略過 1、線索 0（AI 1 次）｜失敗 2')
            const bad = await run([{ name: 'triage', run: async () => stdReport({ ok: false, stats: { fail: 1 }, summary: '失敗：x' }) }, sum])
            assert.equal(bad, '1/2 段完成（in 0、out 0、fail 3）｜失敗：triage')
            assert.doesNotMatch(bad, /undefined/)
            assert.equal(await run([{ name: 'other', run: async () => okRep({}) }]), '1/1 段完成（in 0、out 0、fail 0）', '無 summarize 子階段 → 通用摘要')
        })
    })
})
