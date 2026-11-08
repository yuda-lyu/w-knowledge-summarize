// unit-summarize-provenance.test.mjs — 筆記之產出鏈(produced)之單元:組出(stores/noteProduced)、記錄寫入之深合併(stores/notePatch)、
//   摘要新建之落點(stages/noteStage)、人工匯入(ops/ingestNotes)、md front matter 之相容、依產出鏈選件(ops/notesByProvenance)、預篩確認小組之票(stages/triageStage)
// 規格:跨套件之產出鏈規格(結構 §2、位置 §3、stage 列舉 §4、共用件 §5、選件 §6、相容與驗收 §7);使用端需求見 Gitea #107
// 規則(出自 stores/noteProduced、stores/notePatch、ops/notesByProvenance 之檔頭):
//   G1 組出:produced 由抓取套件之 makeProduced 組(不自行拼物件)、歷史由 appendProduced 追加;AI 呼叫之產出帶席位與實際成交條目,不呼叫 AI 者 seat／provider 皆 null;
//      成交條目未知者不寫產出鏈;每次寫入歷史 +1,produced 為末筆,上限 50(捨最舊、累計 producedHistoryDropped);輸入不被改
//   G2 md front matter 只加純量鍵 produced_stamp／produced_stage／produced_provider(null 者省略);既有鍵之序與值不動;含此類鍵之 md 讀取 → 展開 → 重寫不丟鍵、不變形
//   G3 集合之 patch 為深合併:舊 produced 有 promptFp 而新者無、歷史超限捨去後,不得殘留舊鍵(只在深合併結果不等於新值時先清後寫;平常之追加為單一寫入)
//   G4 摘要新建:記錄與 md 同時帶產出鏈(stamp 取 ctx.stamp,輪次外 null);成交條目未知(覆寫之 callAI 未回 providerId)不寫,輸出與無此機制時除新增鍵外逐位元組相同;
//      既有筆記不覆寫;宿主落地(sink)亦收到;單獨使用 mwPersistNote(無階段給之來源)不寫
//   G5 人工匯入:不呼叫 AI → seat／provider 皆 null,stamp 取 deps.stamp(輪次外 null)
//   G6 選件:條件皆「且」、null 條件、since／until 以時刻比、history 比對任一筆、舊記錄不出現、依 slug 排序、回傳為複本、條件不合即拋(不靜默忽略)
//   G7 預篩確認小組做成決定者,文件記錄寫 triageVotes:[{ seat, provider, verdict }];未做成決定者(留待下輪)不寫
// 執行:自套件根 node <mocha> test/unit-summarize-provenance.test.mjs(暫存 test/_tmp/summarize-provenance-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import { memStore, nullLogger, planBench, DEFAULT_DEDUP } from './tools/captureForTest.mjs'
import { recLog } from './tools/stageKit.mjs'
import { itemOf, rawDoc } from './tools/summarizeTestKit.mjs'
import { makeMsg, runChainOverMsgs, captureIdentityOf } from '../src/core/capturePackage.mjs'
import { readMd, writeMd, parseFrontmatter, mdText } from '../src/core/md/md.mjs'
import { resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'
import { resolveSummarizeVocab } from '../src/core/vocab/summarizeVocab.mjs'
import { rewriteFieldOf, RENAME_FIELDS } from '../src/stores/taxonomy.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { summarizeBenchRole } from '../src/bench/summarizeBench.mjs'
import { NOTE_WRITE_STAGE, PRODUCED_FRONT_KEYS, PRODUCED_RECORD_FIELDS, producedFrontOf, withProducedFront, noteProducedOf } from '../src/stores/noteProduced.mjs'
import { mergeExactOf, patchNoteRecord } from '../src/stores/notePatch.mjs'
import { stageSummarize, mwPersistNote } from '../src/stages/noteStage.mjs'
import { stageTriage } from '../src/stages/triageStage.mjs'
import { ingestNotes } from '../src/ops/ingestNotes.mjs'
import { notesByProvenance } from '../src/ops/notesByProvenance.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TMP = path.resolve(HERE, `_tmp/summarize-provenance-${process.pid}`).replace(/\\/g, '/')
const PKG = JSON.parse(fs.readFileSync(path.resolve(HERE, '../package.json'), 'utf8'))
const PKG_ID = `${PKG.name}@${PKG.version}`
const AT = '2026-11-08T20:12:31+08:00'
const NOW = '2026-10-04T10:00:00+08:00'
const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/
const log = nullLogger()
let seq = 0

/** 第 i 次寫入之 stamp(14 碼) */
const stampOf = (i) => `2026110800${String(i).padStart(4, '0')}`

describe('unit-summarize-provenance', function() {

    this.timeout(120_000)

    before(() => {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })
    after(() => {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ══════════════════════════ G1 組出 ══════════════════════════
    describe('G1 組出(noteProducedOf、producedFrontOf、withProducedFront)', function() {

        it('AI 呼叫之產出:produced 欄位與鍵序同 makeProduced(v、stamp、stage、seat、provider、promptFp、pkg、at);patch 三欄(歷史 1 筆、與 produced 同值而非同一物件、捨去數 0);front 三純量鍵', () => {
            const r = noteProducedOf({}, { stage: NOTE_WRITE_STAGE.summarize, stamp: '20261108200009', ai: { seat: 'summarize.ai', provider: 'codex:gpt-6.1-terra', promptFp: '5118f8f40bf0dc40' }, nowIso: AT })
            const want = { v: 1, stamp: '20261108200009', stage: 'summarize', seat: 'summarize.ai', provider: 'codex:gpt-6.1-terra', promptFp: '5118f8f40bf0dc40', pkg: PKG_ID, at: AT }
            assert.deepEqual(r.produced, want)
            assert.deepEqual(Object.keys(r.produced), ['v', 'stamp', 'stage', 'seat', 'provider', 'promptFp', 'pkg', 'at'])
            assert.deepEqual(r.patch, { produced: want, producedHistory: [want], producedHistoryDropped: 0 })
            assert.deepEqual(Object.keys(r.patch), [...PRODUCED_RECORD_FIELDS])
            assert.notEqual(r.patch.produced, r.patch.producedHistory[0])
            assert.deepEqual(r.front, { produced_stamp: '20261108200009', produced_stage: 'summarize', produced_provider: 'codex:gpt-6.1-terra' })
            assert.deepEqual(Object.keys(r.front), [...PRODUCED_FRONT_KEYS])
        })

        it('不呼叫 AI 之寫入(ai 未給或 null):seat 與 provider 同時 null、無 promptFp;stamp 為 null 時 front 省略 produced_stamp、provider 為 null 省略 produced_provider', () => {
            for (const o of [{ stage: 'standards-fix', stamp: null, nowIso: AT }, { stage: 'standards-fix', stamp: null, ai: null, nowIso: AT }]) {
                const r = noteProducedOf({}, o)
                assert.deepEqual([r.produced.seat, r.produced.provider, r.produced.stamp, 'promptFp' in r.produced], [null, null, null, false])
                assert.deepEqual(r.front, { produced_stage: 'standards-fix' })
            }
            assert.deepEqual(noteProducedOf({}, { stage: 'standards-fix', stamp: '20261108200009', nowIso: AT }).front, { produced_stamp: '20261108200009', produced_stage: 'standards-fix' })
            assert.equal(noteProducedOf({}, { stage: 'standards-fix', nowIso: AT }).produced.stamp, null, 'stamp 未給＝輪次外 null')
        })

        it('promptFp 為 null／未給(無題組或算不出)→ 省略該鍵;給了不合格式者拋(不寫壞值)', () => {
            for (const promptFp of [null, undefined, '']) assert.equal('promptFp' in noteProducedOf({}, { stage: 'summarize', ai: { seat: 's', provider: 'p:q', promptFp }, nowIso: AT }).produced, false, String(promptFp))
            assert.throws(() => noteProducedOf({}, { stage: 'summarize', ai: { seat: 's', provider: 'p:q', promptFp: 'XYZ' }, nowIso: AT }), /invalid o\.promptFp/)
        })

        it('追加:歷史長度 +1、produced 為最新(＝歷史末筆)、舊筆在前;輸入記錄不被改(含其歷史陣列)', () => {
            const r1 = noteProducedOf({}, { stage: 'summarize', stamp: stampOf(1), ai: { seat: 'summarize.ai', provider: 'a:b' }, nowIso: AT })
            const cur = { id: 'n', ...r1.patch }
            const snap = structuredClone(cur)
            const r2 = noteProducedOf(cur, { stage: 'standards-fix', stamp: stampOf(2), nowIso: '2026-11-08T21:00:00+08:00' })
            assert.deepEqual(cur, snap, '輸入不被改')
            assert.deepEqual(r2.patch.producedHistory.map((x) => [x.stage, x.stamp]), [['summarize', stampOf(1)], ['standards-fix', stampOf(2)]])
            assert.deepEqual(r2.patch.produced, r2.patch.producedHistory.at(-1))
            assert.equal(r2.patch.producedHistoryDropped, 0)
            // 歷史被清為 null(深合併前置之先清)時視同無歷史:從頭起算
            assert.equal(noteProducedOf({ producedHistory: null, producedHistoryDropped: null }, { stage: 'summarize', nowIso: AT }).patch.producedHistory.length, 1)
        })

        it('上限 50:第 51 筆起捨最舊並累計 producedHistoryDropped(55 次寫入 → 保留 6～55、捨去 5);捨去數在既有基礎上累計', () => {
            let cur = {}
            for (let i = 1; i <= 49; i++) cur = { ...cur, ...noteProducedOf(cur, { stage: 'summarize', stamp: stampOf(i), nowIso: AT }).patch }
            assert.deepEqual([cur.producedHistory.length, cur.producedHistoryDropped], [49, 0])
            cur = { ...cur, ...noteProducedOf(cur, { stage: 'summarize', stamp: stampOf(50), nowIso: AT }).patch }
            assert.deepEqual([cur.producedHistory.length, cur.producedHistoryDropped], [50, 0], '第 50 筆仍不捨去')
            for (let i = 51; i <= 55; i++) cur = { ...cur, ...noteProducedOf(cur, { stage: 'summarize', stamp: stampOf(i), nowIso: AT }).patch }
            assert.deepEqual([cur.producedHistory.length, cur.producedHistoryDropped], [50, 5])
            assert.deepEqual([cur.producedHistory[0].stamp, cur.producedHistory.at(-1).stamp, cur.produced.stamp], [stampOf(6), stampOf(55), stampOf(55)])
        })

        it('at:clock.iso8() 形狀合者原樣收;形狀不合(測試之固定字串 T0)或形狀合而日期不真(2026-02-30、25 時)者不拖垮寫入,改取機器本地現在(合格形狀)', () => {
            assert.equal(noteProducedOf({}, { stage: 'summarize', nowIso: AT }).produced.at, AT)
            for (const nowIso of ['T0', undefined, 5, '2026-02-30T00:00:00+08:00', '2026-11-08T25:00:00+08:00']) {
                const at = noteProducedOf({}, { stage: 'summarize', nowIso }).produced.at
                assert.ok(LOCAL_ISO.test(at) && at !== nowIso, String(nowIso))
            }
        })

        it('成交條目未知(provider 為空字串、空白、非字串、null)→ 回 null(該筆不寫產出鏈,呼叫端照舊寫筆記);o 非物件、stage 或 stamp 不合規格 → 拋', () => {
            for (const provider of ['', '   ', undefined, null, 5, {}]) assert.equal(noteProducedOf({}, { stage: 'summarize', ai: { seat: 'summarize.ai', provider }, nowIso: AT }), null, String(provider))
            for (const o of [undefined, null, 'x', 5]) assert.throws(() => noteProducedOf({}, o), /noteProducedOf 需要設定物件/)
            assert.throws(() => noteProducedOf({}, { stage: 'Summarize', nowIso: AT }), /invalid o\.stage/)
            assert.throws(() => noteProducedOf({}, { stage: 'summarize', stamp: '2026', nowIso: AT }), /invalid o\.stamp/)
            assert.throws(() => noteProducedOf({}, { stage: 'summarize', ai: { seat: '', provider: 'a:b' }, nowIso: AT }), /invalid o\.seat/)
        })

        it('cur 非物件視為 {};cur.producedHistory 形狀不合(非陣列、含非物件)→ 拋(不靜默改寫壞歷史)', () => {
            for (const cur of [undefined, null, 'x']) assert.equal(noteProducedOf(cur, { stage: 'summarize', nowIso: AT }).patch.producedHistory.length, 1)
            assert.throws(() => noteProducedOf({ producedHistory: 'x' }, { stage: 'summarize', nowIso: AT }), /rec\.producedHistory/)
            assert.throws(() => noteProducedOf({ producedHistory: [1] }, { stage: 'summarize', nowIso: AT }), /rec\.producedHistory\[0\]/)
        })

        it('stage 對照表 NOTE_WRITE_STAGE:匯入為 ingest、AI 重標為 retag、機械改名／同步修正／存量處置為 standards-fix、摘要新建為 summarize;只用規格 §4 之列舉值(summarize、ingest、retag、standards-fix)', () => {
            assert.deepEqual(NOTE_WRITE_STAGE, { summarize: 'summarize', ingest: 'ingest', retag: 'retag', retagMech: 'standards-fix', syncFix: 'standards-fix', stockFix: 'standards-fix' })
            assert.ok(Object.isFrozen(NOTE_WRITE_STAGE))
            assert.ok(Object.values(NOTE_WRITE_STAGE).every((s) => ['summarize', 'ingest', 'retag', 'standards-fix'].includes(s)), '只用規格 §4 之列舉值')
        })

        it('producedFrontOf:非物件回 {};null／undefined 之鍵省略', () => {
            for (const v of [undefined, null, 'x', 5]) assert.deepEqual(producedFrontOf(v), {})
            assert.deepEqual(producedFrontOf({ stamp: null, stage: 'summarize', provider: 'a:b' }), { produced_stage: 'summarize', produced_provider: 'a:b' })
        })

        it('withProducedFront:既有 produced_* 鍵原位更新、新值為 null 者刪除、尚無者附於最後;其餘鍵之序與值不動;不改輸入;front 非物件視為 {}', () => {
            const front = { title: 'T', produced_stamp: '20261108100000', produced_provider: 'a:b', created: 'c' }
            const snap = structuredClone(front)
            const p = { stamp: '20261108110000', stage: 'standards-fix', provider: null }
            const out = withProducedFront(front, p)
            assert.deepEqual(front, snap, '輸入不被改')
            assert.deepEqual(Object.entries(out), [['title', 'T'], ['produced_stamp', '20261108110000'], ['created', 'c'], ['produced_stage', 'standards-fix']])
            assert.deepEqual(withProducedFront(undefined, p), { produced_stamp: '20261108110000', produced_stage: 'standards-fix' })
            assert.deepEqual(withProducedFront({ a: 1 }, { stamp: null, stage: 's', provider: null }), { a: 1, produced_stage: 's' })
        })
    })

    // ══════════════════════════ G3 集合之深合併 ══════════════════════════
    describe('G3 記錄寫入之深合併(stores/notePatch;真 LMDB)', function() {

        it('mergeExactOf:物件逐鍵、陣列依索引深合併之結果恰等於新值才為真;舊鍵或舊索引不在新值者會殘留 → 假', () => {
            assert.equal(mergeExactOf({ a: 1, b: { c: 2 } }, { a: 9, b: { c: 3, d: 4 } }), true, '新值之鍵為舊值之超集')
            assert.equal(mergeExactOf({ a: 1, b: 2 }, { a: 1 }), false, '舊鍵 b 會殘留')
            assert.equal(mergeExactOf({ a: { x: 1 } }, { a: {} }), false, '巢狀舊鍵會殘留')
            assert.equal(mergeExactOf([{ x: 1 }], [{ x: 1 }, { x: 2 }]), true, '陣列追加')
            assert.equal(mergeExactOf([{ x: 1 }, { x: 2 }], [{ x: 2 }]), false, '舊索引會殘留')
            assert.equal(mergeExactOf([{ x: 1, y: 2 }], [{ x: 1 }]), false, '索引內之舊鍵會殘留')
            assert.equal(mergeExactOf({ a: { x: 1 } }, { a: null }), true, '以 null 取代物件(lodash merge:來源為 null 即覆寫)')
            assert.equal(mergeExactOf({ a: 1 }, { a: { x: 1 } }), true, '純量被物件取代')
        })

        it('舊 produced 有 promptFp、新 produced(不呼叫 AI)無 → 不殘留舊 promptFp(先清後寫);歷史各筆亦不殘留;平常之追加為單一 patch(不開先清之空窗)', async () => {
            const col = W.openCollection({ WOrm, path: `${TMP}/lmdb${++seq}/db`, db: 'knowledge', cl: 'notes' })
            try {
                await col.insertNew([{ id: 'n1', title: 't' }])
                const writes = []
                const spy = {
                    get: (id) => col.get(id),
                    patch: async (id, f) => {
                        writes.push(Object.keys(f))
                        return col.patch(id, f)
                    },
                }
                const write = async (o) => {
                    const cur = await col.get('n1')
                    await patchNoteRecord(spy, cur, noteProducedOf(cur, { nowIso: AT, ...o }).patch, { label: '測試' })
                    return col.get('n1')
                }
                const FP = '5118f8f40bf0dc40'
                await write({ stage: 'summarize', stamp: stampOf(1), ai: { seat: 'summarize.ai', provider: 'a:b', promptFp: FP } })
                assert.deepEqual(writes, [['produced', 'producedHistory', 'producedHistoryDropped']], '新建後首次寫入:單一 patch')
                writes.length = 0
                // 同形(皆有 promptFp)之追加:深合併之結果恰為新值 → 單一 patch、無先清
                const n2 = await write({ stage: 'summarize', stamp: stampOf(2), ai: { seat: 'summarize.ai', provider: 'a:c', promptFp: FP } })
                assert.deepEqual(writes, [['produced', 'producedHistory', 'producedHistoryDropped']])
                assert.deepEqual([n2.produced.provider, n2.producedHistory.length], ['a:c', 2])
                writes.length = 0
                // 新者無 promptFp:舊 produced 之 promptFp 若不清會殘留
                const n3 = await write({ stage: 'standards-fix', stamp: stampOf(3) })
                assert.deepEqual(writes, [['produced'], ['produced', 'producedHistory', 'producedHistoryDropped']], '先清 produced 再寫(歷史為追加,不須清)')
                assert.equal('promptFp' in n3.produced, false, '不殘留舊 promptFp')
                assert.deepEqual([n3.produced.seat, n3.produced.provider, n3.producedHistory.length], [null, null, 3])
                assert.deepEqual(n3.producedHistory.map((x) => 'promptFp' in x), [true, true, false], '歷史各筆各依其形')
            }
            finally {
                await col.close()
            }
        })

        it('回驗不受物件鍵序影響:舊 produced 無 promptFp、新 produced 有(深合併把新鍵附於既有鍵之後,存入之鍵序與寫入時不同)仍通過寫後回驗,內容等於新值', async () => {
            const col = W.openCollection({ WOrm, path: `${TMP}/lmdb${++seq}/db`, db: 'knowledge', cl: 'notes' })
            try {
                await col.insertNew([{ id: 'n1', title: 't' }])
                const c0 = await col.get('n1')
                await patchNoteRecord(col, c0, noteProducedOf(c0, { stage: 'standards-fix', stamp: stampOf(1), nowIso: AT }).patch, { label: '測試' })
                const c1 = await col.get('n1')
                const next = noteProducedOf(c1, { stage: 'summarize', stamp: stampOf(2), ai: { seat: 'summarize.ai', provider: 'a:b', promptFp: '5118f8f40bf0dc40' }, nowIso: AT })
                const back = await patchNoteRecord(col, c1, next.patch, { label: '測試' }) // 回驗不符即拋
                assert.deepEqual(back.produced, next.produced)
                assert.deepEqual(back.producedHistory.map((x) => x.stage), ['standards-fix', 'summarize'])
            }
            finally {
                await col.close()
            }
        })

        it('52 次寫入(前 30 次帶 promptFp、其後不帶)之終態等於以記憶體逐次追加之預期:歷史 50 筆、捨去 2、各筆不殘留他筆之鍵;與寫入之順序無關之回驗(鍵序不同亦通過)', async () => {
            const col = W.openCollection({ WOrm, path: `${TMP}/lmdb${++seq}/db`, db: 'knowledge', cl: 'notes' })
            try {
                await col.insertNew([{ id: 'n1', title: 't' }])
                let want = {}
                for (let i = 1; i <= 52; i++) {
                    const o = i <= 30
                        ? { stage: 'summarize', stamp: stampOf(i), ai: { seat: 'summarize.ai', provider: `p:${i}`, promptFp: '5118f8f40bf0dc40' }, nowIso: AT }
                        : { stage: 'standards-fix', stamp: stampOf(i), nowIso: AT }
                    want = { ...want, ...noteProducedOf(want, o).patch }
                    const cur = await col.get('n1')
                    await patchNoteRecord(col, cur, noteProducedOf(cur, o).patch, { label: '測試' })
                }
                const got = await col.get('n1')
                assert.deepEqual({ produced: got.produced, producedHistory: got.producedHistory, producedHistoryDropped: got.producedHistoryDropped }, { produced: want.produced, producedHistory: want.producedHistory, producedHistoryDropped: want.producedHistoryDropped })
                assert.deepEqual([got.producedHistory.length, got.producedHistoryDropped, got.producedHistory[0].stamp], [50, 2, stampOf(3)])
                assert.deepEqual(got.producedHistory.map((x) => 'promptFp' in x).filter(Boolean).length, 28, '第 3～30 次帶指紋(28 筆),其後 22 筆不帶')
            }
            finally {
                await col.close()
            }
        })
    })

    // ══════════════════════════ G4 摘要新建 ══════════════════════════
    describe('G4 摘要新建之落點(stages/noteStage)', function() {

        const RV = resolveSummarizeVocab({ domain: '天文學' })
        const SETTINGS = resolveSummarizeSettings({ summarize: { triage: { enabled: false } }, capture: { browser: { perRun: 0 } } })

        /** 以覆寫之 callAI 跑一輪摘要(一篇);providerId 未給 → 回覆不帶 providerId;logger 給了取代靜音日誌;settings 給了取代預設設定 */
        async function runStage({ providerId, stamp, sink, rows = [], title = '標題一', logger = log, settings = SETTINGS, domain = createSummarizeDomain({ vocab: RV }) }) {
            const dir = `${TMP}/s${++seq}`
            const doc = rawDoc('a', { title })
            const notes = memStore(rows)
            const callAI = async () => ({ ok: true, ...(providerId === undefined ? {} : { providerId }), data: [itemOf(1, title)] })
            const stage = stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, callAI, ...(sink ? { sink } : {}) })
            const ctx = { deps: { stores: { docs: memStore([doc]), notes, frontier: memStore() }, settings, clock: { iso8: () => NOW }, dirs: { notes: dir }, domains: { summarize: domain } }, log: logger, ...(stamp !== undefined ? { stamp } : {}) }
            const rep = await stage.run(ctx)
            return { rep, notes, dir }
        }
        const frontOf = (n) => readMd(n.file).front
        const wantFp = planBench(summarizeBenchRole, { vocab: RV, roleOpt: { docsPerCall: 1, charsPerDoc: SETTINGS.summarize.charsPerDoc } }).promptFp

        it('成交條目已知:記錄帶 produced(stamp＝ctx.stamp、stage summarize、seat summarize.ai、provider＝回覆之 providerId、promptFp＝摘要角色之指紋、pkg、at＝clock.iso8())、歷史 1 筆、捨去 0;md front matter 帶三純量鍵且與記錄同值', async () => {
            const { rep, notes } = await runStage({ providerId: 'x:one', stamp: '20261108200009' })
            assert.equal(rep.detail.notes, 1)
            const [n] = await notes.select()
            assert.deepEqual(n.produced, { v: 1, stamp: '20261108200009', stage: 'summarize', seat: 'summarize.ai', provider: 'x:one', promptFp: wantFp, pkg: PKG_ID, at: NOW })
            assert.match(wantFp, /^[0-9a-f]{16}$/)
            assert.deepEqual([n.producedHistory, n.producedHistoryDropped], [[n.produced], 0])
            const fm = frontOf(n)
            assert.deepEqual([fm.produced_stamp, fm.produced_stage, fm.produced_provider], ['20261108200009', 'summarize', 'x:one'])
            assert.deepEqual(Object.keys(fm).slice(-3), [...PRODUCED_FRONT_KEYS], '產出鏈之鍵附於既有鍵之後')
        })

        it('輪次外(ctx 無 stamp):produced.stamp 為 null,md 省略 produced_stamp 而保留 produced_stage／produced_provider', async () => {
            const { notes } = await runStage({ providerId: 'x:one' })
            const [n] = await notes.select()
            assert.equal(n.produced.stamp, null)
            const fm = frontOf(n)
            assert.deepEqual([Object.keys(fm).filter((k) => k.startsWith('produced')), fm.produced_provider], [['produced_stage', 'produced_provider'], 'x:one'])
        })

        it('成交條目未知(覆寫之 callAI 回 providerId 為空字串或未回):不寫產出鏈(寧缺勿假),筆記照寫;md 與有產出鏈者除三純量鍵之行外逐位元組相同', async () => {
            const withP = await runStage({ providerId: 'x:one', stamp: '20261108200009' })
            const textWith = fs.readFileSync((await withP.notes.select())[0].file, 'utf8')
            for (const providerId of ['', undefined]) {
                const r = await runStage({ providerId, stamp: '20261108200009' })
                assert.equal(r.rep.detail.notes, 1, String(providerId))
                const [n] = await r.notes.select()
                assert.deepEqual(PRODUCED_RECORD_FIELDS.filter((k) => k in n), [], '記錄無產出鏈三欄')
                const text = fs.readFileSync(n.file, 'utf8')
                assert.equal(text, textWith.split('\n').filter((l) => !/^produced_(stamp|stage|provider): /.test(l)).join('\n'), 'md 除新增純量鍵外逐位元組相同')
            }
        })

        it('提示詞指紋算不出(領域物件之詞彙無分類清單:評比核心拒收,而納入閘不依賴清單):省略 promptFp、其餘產出鏈照寫、筆記照寫,並記一行 INFO(指紋是附記,不拖垮寫入;每段每輪至多一行)', async () => {
            const logger = recLog()
            const base = createSummarizeDomain({ vocab: RV })
            const domain = { ...base, vocab: { ...base.vocab, categories: [] } }
            const { rep, notes } = await runStage({ providerId: 'x:one', stamp: '20261108200009', logger, domain })
            assert.equal(rep.detail.notes, 1, JSON.stringify(rep.detail))
            const [n] = await notes.select()
            assert.deepEqual([n.produced.provider, n.produced.stamp, 'promptFp' in n.produced], ['x:one', '20261108200009', false])
            assert.equal(logger.lines.filter((l) => /^INFO 摘要：提示詞指紋算不出（summarize：/.test(l)).length, 1, logger.lines.join('\n'))
        })

        it('既有筆記不覆寫(同文件已有筆記):不寫 md、不入庫、既有記錄不被加產出鏈', async () => {
            const old = { id: 'old-note', docId: 'a', title: '舊' }
            const { rep, notes, dir } = await runStage({ providerId: 'x:one', stamp: '20261108200009', rows: [old] })
            assert.equal(rep.detail.notesExisting, 1)
            assert.deepEqual(await notes.select(), [old])
            assert.equal(fs.existsSync(dir), false, '未寫 md')
        })

        it('宿主落地(opt.sink):收到之 record 與 md 皆帶產出鏈(md.front 有純量鍵);不寫檔、不入庫', async () => {
            const got = []
            const sink = async ({ record, md }) => {
                got.push({ record, md })
                return { ok: true, id: 'host-1' }
            }
            const { notes, dir } = await runStage({ providerId: 'x:two', stamp: '20261108200009', sink })
            assert.equal(got.length, 1)
            assert.deepEqual([got[0].record.produced.provider, got[0].record.producedHistory.length, got[0].md.front.produced_provider, got[0].md.front.produced_stage], ['x:two', 1, 'x:two', 'summarize'])
            assert.deepEqual([await notes.select(), fs.existsSync(dir)], [[], false])
        })

        it('單獨使用 mwPersistNote(無階段給之 _provenance):不寫產出鏈,落地之記錄與 md 同無此機制時', async () => {
            const sinkOf = (rows) => async (xs) => {
                rows.push(...xs)
                return { addCount: xs.length }
            }
            const rows = []
            const notes = { get: async () => null, select: async () => [], insertNew: sinkOf(rows) }
            const msg = makeMsg('doc', { doc: { id: 'd1' }, _note: { record: { id: 'n1', docId: 'd1' }, md: null } })
            await runChainOverMsgs({ chain: [mwPersistNote()], ctx: { deps: { stores: { notes } }, log }, msgs: [msg] })
            assert.deepEqual(rows, [{ id: 'n1', docId: 'd1' }])
            // 有 _provenance 而 provider 空 → 同樣不寫
            const rows2 = []
            const notes2 = { ...notes, insertNew: sinkOf(rows2) }
            const msg2 = makeMsg('doc', { doc: { id: 'd1' }, _note: { record: { id: 'n1', docId: 'd1' }, md: null }, _provenance: { stamp: null, seat: 'summarize.ai', provider: '' } })
            await runChainOverMsgs({ chain: [mwPersistNote()], ctx: { deps: { stores: { notes: notes2 } }, log }, msgs: [msg2] })
            assert.deepEqual(rows2, [{ id: 'n1', docId: 'd1' }])
        })
    })

    // ══════════════════════════ G5 人工匯入 ══════════════════════════
    describe('G5 人工匯入(ops/ingestNotes)', function() {

        const RV = resolveSummarizeVocab({ domain: '天文學' })
        const domain = createSummarizeDomain({ vocab: RV })
        const identity = captureIdentityOf(DEFAULT_DEDUP)

        it('不呼叫 AI:記錄 produced 之 seat／provider 皆 null、stage ingest、stamp＝deps.stamp、無 promptFp、歷史 1 筆;md 之 front 帶 produced_stamp／produced_stage 而無 produced_provider', async () => {
            const notes = memStore()
            const dir = `${TMP}/i${++seq}`
            const r = await ingestNotes({ stores: { docs: memStore(), notes }, dirs: { notes: dir }, clock: { iso8: () => NOW }, domain, identity, stamp: '20261108210000' }, [{ url: 'https://example.com/a', title: '原文標題', note: itemOf(1, '原文標題') }])
            assert.equal(r.added, 1, JSON.stringify(r))
            const [n] = await notes.select()
            assert.deepEqual(n.produced, { v: 1, stamp: '20261108210000', stage: 'ingest', seat: null, provider: null, pkg: PKG_ID, at: NOW })
            assert.deepEqual([n.producedHistory.length, n.producedHistoryDropped], [1, 0])
            const fm = readMd(n.file).front
            assert.deepEqual([fm.produced_stamp, fm.produced_stage, 'produced_provider' in fm], ['20261108210000', 'ingest', false])
        })

        it('輪次外(deps.stamp 未給):stamp 為 null、md 省略 produced_stamp;略過者(欄位不全、已在庫)不寫任何東西', async () => {
            const notes = memStore()
            const dir = `${TMP}/i${++seq}`
            const deps = { stores: { docs: memStore(), notes }, dirs: { notes: dir }, clock: { iso8: () => NOW }, domain, identity }
            const r = await ingestNotes(deps, [
                { url: 'https://example.com/b', title: '原文標題', note: itemOf(1, '原文標題') },
                { url: 'https://example.com/c', note: { title: '缺欄位' } },
            ])
            assert.deepEqual([r.added, r.bad], [1, 1])
            const rows = await notes.select()
            assert.equal(rows.length, 1)
            assert.equal(rows[0].produced.stamp, null)
            assert.deepEqual(Object.keys(readMd(rows[0].file).front).filter((k) => k.startsWith('produced')), ['produced_stage'])
            assert.equal(rows[0].produced.stage, 'ingest')
        })
    })

    // ══════════════════════════ G2 md 相容 ══════════════════════════
    describe('G2 md front matter 之相容(含新純量鍵之 md 讀取 → 展開 → 重寫不丟鍵、不變形)', function() {

        const FRONT = { title: 'T', slug: 's', concepts: ['甲', '乙'], created: 'c', produced_stamp: '20261108200009', produced_stage: 'summarize', produced_provider: 'codex:gpt-6.1-terra' }

        it('解析回原值(stamp 為 14 位數字之字串而非數字);展開重寫之全文逐位元組不變(經檔案往返)', () => {
            const text = mdText(FRONT, '# 內容\n\n## 一句話重點\n\n正文')
            const md = parseFrontmatter(text)
            assert.deepEqual(md.front, FRONT)
            assert.equal(typeof md.front.produced_stamp, 'string')
            const file = `${TMP}/rt${++seq}/n.md`
            writeMd(file, md.front, md.body)
            const back = readMd(file)
            writeMd(file, { ...back.front }, back.body)
            assert.equal(fs.readFileSync(file, 'utf8'), text)
        })

        it('他人手寫為未加引號之數字(produced_stamp: 20261108200009)者亦原樣往返、不丟鍵;冒號之值(codex:gpt…)加引號仍解回', () => {
            const raw = '---\ntitle: "T"\nproduced_stamp: 20261108200009\nproduced_provider: "codex:gpt-6.1-terra"\n---\n\n正文\n'
            const md = parseFrontmatter(raw)
            assert.deepEqual(md.front, { title: 'T', produced_stamp: 20261108200009, produced_provider: 'codex:gpt-6.1-terra' })
            assert.equal(mdText({ ...md.front }, md.body), raw)
        })

        it('分類法改寫(rewriteFieldOf;重標與存量處置共用)保留 produced_* 鍵與序;withProducedFront 後再寫仍可解回', () => {
            const md = { front: { ...FRONT, category: '舊類' }, body: '# T\n\n## 品質與證據標注\n\n- 內容類型：實證研究\n' }
            const { front } = rewriteFieldOf(md, RENAME_FIELDS.category, '新類')
            assert.deepEqual(Object.keys(front), Object.keys(md.front))
            assert.deepEqual([front.category, front.produced_stamp, front.produced_stage, front.produced_provider], ['新類', '20261108200009', 'summarize', 'codex:gpt-6.1-terra'])
            const out = withProducedFront(front, { stamp: '20261108210000', stage: 'standards-fix', provider: null })
            const want = { ...front, produced_stamp: '20261108210000', produced_stage: 'standards-fix' }
            delete want.produced_provider // 新值為 null:該鍵移除(不留舊條目)
            assert.deepEqual(parseFrontmatter(mdText(out, 'x')).front, want)
        })
    })

    // ══════════════════════════ G6 選件 ══════════════════════════
    describe('G6 依產出鏈選件(ops/notesByProvenance;純讀)', function() {

        const P = (o) => ({ v: 1, stamp: '20261108100000', stage: 'summarize', seat: 'summarize.ai', provider: 'x:one', pkg: PKG_ID, at: '2026-11-08T10:00:00+08:00', ...o })
        const rows = [
            { id: 'c', produced: P({ stamp: '20261108120000', provider: 'x:two', at: '2026-11-08T12:00:00+08:00' }), producedHistory: [P({ stamp: '20261108100000', provider: 'x:one' }), P({ stamp: '20261108120000', provider: 'x:two', at: '2026-11-08T12:00:00+08:00' })], producedHistoryDropped: 0 },
            { id: 'a', produced: P(), producedHistory: [P()], producedHistoryDropped: 0 },
            { id: 'b', produced: P({ stamp: null, stage: 'standards-fix', seat: null, provider: null, at: '2026-11-08T11:00:00+08:00' }), producedHistory: [P(), P({ stamp: null, stage: 'standards-fix', seat: null, provider: null, at: '2026-11-08T11:00:00+08:00' })], producedHistoryDropped: 0 },
            { id: 'legacy', title: '舊筆記' },
            { id: 'nohist', produced: P({ provider: 'x:three' }) },
            { id: 'noat', produced: P({ at: undefined }), producedHistory: [P({ at: undefined })] },
        ]
        const deps = { stores: { notes: memStore(rows) } }
        const q = async (cond) => (await notesByProvenance(deps, cond)).map((x) => x.slug)

        it('無條件:有 produced 者全數(舊記錄不出現),依 slug 升冪(與集合之讀序無關);回傳為 { slug, produced } 之複本(改它不動集合)', async () => {
            assert.deepEqual(await q(), ['a', 'b', 'c', 'noat', 'nohist'])
            assert.deepEqual(await q({}), ['a', 'b', 'c', 'noat', 'nohist'])
            const r = await notesByProvenance(deps)
            assert.deepEqual(Object.keys(r[0]), ['slug', 'produced'])
            r[0].produced.provider = '被改'
            assert.equal((await notesByProvenance(deps))[0].produced.provider, 'x:one')
            assert.equal((await deps.stores.notes.get('a')).produced.provider, 'x:one')
        })

        it('stamp／stage／provider／seat 單一條件(預設只比對最後一筆 produced)', async () => {
            assert.deepEqual(await q({ stamp: '20261108100000' }), ['a', 'noat', 'nohist'])
            assert.deepEqual(await q({ stamp: '20261108120000' }), ['c'])
            assert.deepEqual(await q({ stage: 'standards-fix' }), ['b'])
            assert.deepEqual(await q({ provider: 'x:one' }), ['a', 'noat'])
            assert.deepEqual(await q({ provider: 'x:two' }), ['c'], 'c 之歷史有 x:one、最後一筆為 x:two')
            assert.deepEqual(await q({ seat: 'summarize.ai' }), ['a', 'c', 'noat', 'nohist'])
        })

        it('null 條件(stamp／seat／provider):選該欄為 null 之寫入(輪次外、不呼叫 AI);與非 null 條件互斥', async () => {
            assert.deepEqual(await q({ stamp: null }), ['b'])
            assert.deepEqual(await q({ provider: null }), ['b'])
            assert.deepEqual(await q({ seat: null }), ['b'])
            assert.deepEqual(await q({ provider: null, seat: null, stamp: null, stage: 'standards-fix' }), ['b'])
            assert.deepEqual(await q({ provider: null, seat: 'summarize.ai' }), [])
        })

        it('條件為「且」:同一筆須同時滿足全部條件', async () => {
            assert.deepEqual(await q({ stamp: '20261108100000', provider: 'x:one' }), ['a', 'noat'])
            assert.deepEqual(await q({ stamp: '20261108100000', provider: 'x:two' }), [])
            assert.deepEqual(await q({ stage: 'summarize', provider: 'x:one', seat: 'summarize.ai', stamp: '20261108100000' }), ['a', 'noat'])
        })

        it('history:true 比對 producedHistory 任一筆(同一筆須滿足全部條件);回傳之 produced 為最近一筆符合者;無 producedHistory 者以 produced 計;history:false 同預設', async () => {
            assert.deepEqual(await q({ provider: 'x:one', history: true }), ['a', 'b', 'c', 'noat'])
            assert.deepEqual(await q({ provider: 'x:one', history: false }), ['a', 'noat'])
            assert.deepEqual(await q({ provider: 'x:three', history: true }), ['nohist'])
            assert.deepEqual(await q({ provider: 'x:one', stage: 'standards-fix', history: true }), [], '歷史中無「同一筆既是 x:one 又是 standards-fix」者')
            const r = await notesByProvenance(deps, { stage: 'summarize', history: true })
            assert.deepEqual(r.find((x) => x.slug === 'b').produced.stage, 'summarize', 'b 之歷史第一筆符合(最後一筆不符)')
            assert.deepEqual(r.find((x) => x.slug === 'c').produced.provider, 'x:two', 'c 有兩筆符合 → 取最近一筆')
        })

        it('since／until 比對 produced.at(以時刻比較、含邊界、時區表示不同亦可;無 at 者不符):單用、合用、history', async () => {
            assert.deepEqual(await q({ since: '2026-11-08T11:00:00+08:00' }), ['b', 'c'], 'since 含邊界(b 恰 11:00;a、nohist 為 10:00)')
            assert.deepEqual(await q({ until: '2026-11-08T11:00:00+08:00' }), ['a', 'b', 'nohist'], 'until 含邊界(noat 無 at 不符)')
            assert.deepEqual(await q({ since: '2026-11-08T10:30:00+08:00', until: '2026-11-08T11:30:00+08:00' }), ['b'])
            assert.deepEqual(await q({ until: '2026-11-08T03:00:00Z' }), ['a', 'b', 'nohist'], '03:00Z ＝ 11:00+08:00')
            assert.deepEqual(await q({ since: '2026-11-08T11:30:00+08:00', history: true }), ['c'], 'history 時 c 之第二筆 12:00 符合')
            assert.deepEqual(await q({ since: '2999-01-01T00:00:00Z' }), [])
            assert.deepEqual(await q({ provider: 'x:one', until: '2026-11-08T09:59:59+08:00', history: true }), [])
        })

        it('純讀:只呼叫 select(集合之寫入皆拋仍成功)、不讀 md(記錄之 file 不存在無妨)', async () => {
            const calls = []
            const refuse = (what) => async () => {
                throw new Error(`不得 ${what}`)
            }
            const notes = {
                select: async () => {
                    calls.push('select')
                    return [{ id: 'a', file: '/不存在/a.md', produced: P() }]
                },
                get: refuse('get'),
                patch: refuse('patch'),
            }
            assert.deepEqual((await notesByProvenance({ stores: { notes } }, { stamp: '20261108100000' })).map((x) => x.slug), ['a'])
            assert.deepEqual(calls, ['select'])
        })

        it('條件不合即拋(不靜默忽略——條件被丟掉會選出整庫):不認得之鍵、非物件、文字條件非非空字串／null、時刻不可解析、history 非布林;deps 缺 notes.select', async () => {
            await assert.rejects(() => notesByProvenance(deps, { stampp: 'x' }), /cond 含不認得之鍵：stampp/)
            for (const bad of [null, 'x', 5, []]) await assert.rejects(() => notesByProvenance(deps, bad), /cond 須為物件/, String(bad))
            for (const k of ['stamp', 'stage', 'provider', 'seat']) {
                for (const v of ['', '  ', 5, {}, true]) await assert.rejects(() => notesByProvenance(deps, { [k]: v }), new RegExp(`cond\\.${k} 須為非空字串或 null`), `${k}=${JSON.stringify(v)}`)
            }
            for (const k of ['since', 'until']) {
                for (const v of ['', 'not-a-time', 5, null, {}]) await assert.rejects(() => notesByProvenance(deps, { [k]: v }), new RegExp(`cond\\.${k} 須為可解析之時刻字串`), `${k}=${JSON.stringify(v)}`)
            }
            for (const v of [1, 'true', null, {}]) await assert.rejects(() => notesByProvenance(deps, { history: v }), /cond\.history 須為布林/, String(v))
            for (const bad of [undefined, {}, { stores: {} }, { stores: { notes: {} } }]) await assert.rejects(() => notesByProvenance(bad), /需要 deps\.stores\.notes（具 select 方法）/)
        })
    })

    // ══════════════════════════ G7 預篩確認小組之票 ══════════════════════════
    describe('G7 預篩確認小組之票(stages/triageStage:triageVotes)', function() {

        const domain = {
            buildPrompt: async (batch) => batch.map((d) => d.title).join('\n'),
            isValidItem: (it, n) => !!it && Number.isInteger(it.index) && it.index >= 1 && it.index <= n && typeof it.relevant === 'boolean',
            reasonOf: (it) => it.reason || '無關',
        }
        const titles = (p) => p.split('\n').filter(Boolean)
        const clock = { iso8: () => NOW }

        it('做成決定者(兩席攔下、被第三席推翻放行、預篩席＋第三席攔下、兩席不一致放行)寫 triageVotes:[{ seat, provider, verdict }](provider 為各席實際成交之條目);未做成決定者(同一供應者留待下輪)不寫', async () => {
            const docs = memStore([
                { id: 'a', status: 'raw', title: 'A 體育新聞', text: 'x', collectedAt: '2026-06-01' },
                { id: 'b', status: 'raw', title: 'B 動量研究', text: 'y', collectedAt: '2026-06-02' },
                { id: 'c', status: 'raw', title: 'C 模糊', text: 'z', collectedAt: '2026-06-03' },
            ])
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: true }, standards: { triageConfirm: { enabled: true, ai: { first: { use: 'cf' }, third: { use: 'cf3' } } } } } })
            const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings }
            const answer = { triage: { A: false, B: false, C: false }, cf: { A: false, B: true, C: true }, cf3: { B: true, C: false } }
            const callAI = async (prompt, check, co) => {
                const seat = co?.segment === 'triageConfirm' ? co.spec.use : 'triage'
                const ts = titles(typeof prompt === 'string' ? prompt : await prompt)
                return { ok: true, providerId: `p-${seat}`, data: ts.map((t, i) => ({ index: i + 1, relevant: answer[seat][t[0]], reason: '與知識庫無關之內容' })) }
            }
            await stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, callAI: async (p, c, o) => callAI(await p, c, o) }).run({ deps, log })
            const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((id) => docs.get(id)))
            const T = { seat: 'triage', provider: 'p-triage', verdict: 'irrelevant' }
            assert.deepEqual(a.triageVotes, [T, { seat: 'confirm', provider: 'p-cf', verdict: 'irrelevant' }], '兩席攔下')
            assert.deepEqual(b.triageVotes, [T, { seat: 'confirm', provider: 'p-cf', verdict: 'relevant' }, { seat: 'third', provider: 'p-cf3', verdict: 'relevant' }], '第三席推翻 → 放行')
            assert.deepEqual(c.triageVotes, [T, { seat: 'confirm', provider: 'p-cf', verdict: 'relevant' }, { seat: 'third', provider: 'p-cf3', verdict: 'irrelevant' }], '預篩席＋第三席成立攔下')
            assert.deepEqual([a.status, b.status, c.status], ['skip', 'raw', 'skip'])
            for (const d of [a, b, c]) for (const v of d.triageVotes) assert.deepEqual(Object.keys(v), ['seat', 'provider', 'verdict'])
        })

        it('同一文件再度做成決定(文件被外部重置 triage 後):舊票不殘留(集合 patch 為深合併、陣列依索引——舊 3 票、新 2 票須先清後寫;真 LMDB)', async () => {
            const col = W.openCollection({ WOrm, path: `${TMP}/lmdb${++seq}/db`, db: 'knowledge', cl: 'docs' })
            try {
                const old = ['old-1', 'old-2', 'old-3'].map((provider, i) => ({ seat: ['triage', 'confirm', 'third'][i], provider, verdict: i === 0 ? 'irrelevant' : 'relevant' }))
                await col.insertNew([{ id: 'x', status: 'raw', title: 'X', text: 'x', collectedAt: '2026-06-01', triageVotes: old }])
                const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: true }, standards: { triageConfirm: { enabled: true, ai: { first: { use: 'cf' } } } } } })
                const callAI = async (p, c, o) => ({ ok: true, providerId: o?.segment === 'triageConfirm' ? 'p-cf' : 'p-triage', data: [{ index: 1, relevant: false, reason: '與知識庫無關之內容' }] })
                await stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, callAI }).run({ deps: { stores: { docs: col, notes: memStore(), frontier: memStore() }, clock, settings }, log })
                const x = await col.get('x')
                assert.equal(x.status, 'skip', '兩席攔下')
                assert.deepEqual(x.triageVotes, [{ seat: 'triage', provider: 'p-triage', verdict: 'irrelevant' }, { seat: 'confirm', provider: 'p-cf', verdict: 'irrelevant' }], '新票 2 筆,不殘留舊第 3 票')
            }
            finally {
                await col.close()
            }
        })

        it('不一致放行(確認席判相關、無第三席)寫票;同一供應者(確認席遞補收斂到預篩席同家)→ 留待下輪,不寫 triageVotes', async () => {
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: true }, standards: { triageConfirm: { enabled: true, ai: { first: { use: 'cf' } } } } } })
            const docs = memStore([{ id: 'x', status: 'raw', title: 'X', text: 'x', collectedAt: '2026-06-01' }])
            const ans = async (p, c, o) => ({ ok: true, providerId: o?.segment === 'triageConfirm' ? 'p-cf' : 'p-triage', data: [{ index: 1, relevant: o?.segment === 'triageConfirm', reason: '與知識庫無關之內容' }] })
            await stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, callAI: ans }).run({ deps: { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings }, log })
            assert.deepEqual((await docs.get('x')).triageVotes, [{ seat: 'triage', provider: 'p-triage', verdict: 'irrelevant' }, { seat: 'confirm', provider: 'p-cf', verdict: 'relevant' }])
            const docs3 = memStore([{ id: 'y', status: 'raw', title: 'Y', text: 'y', collectedAt: '2026-06-01' }])
            const same = async () => ({ ok: true, providerId: 'p-same', data: [{ index: 1, relevant: false, reason: '與知識庫無關之內容' }] })
            await stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, maxTries: 3, callAI: same }).run({ deps: { stores: { docs: docs3, notes: memStore(), frontier: memStore() }, clock, settings }, log })
            const y = await docs3.get('y')
            assert.deepEqual([y.triage, y.triageConfirmTries, Object.hasOwn(y, 'triageVotes')], ['reject-pending', 1, false])
        })
    })
})
