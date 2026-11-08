// unit-flow-summarize-provenance.test.mjs — 筆記之產出鏈(produced)之整合流程:總組裝於真 LMDB 上以替身 AI 跑三輪
// 規格:跨套件之產出鏈規格(結構 §2、位置 §3、stage 列舉 §4、選件 §6、驗收 §7);使用端需求見 Gitea #107
// 規則(出自 stores/noteProduced、ops/notesByProvenance 之檔頭):
//   P1 一輪摘要後,新筆記之記錄有 produced／producedHistory／producedHistoryDropped,md front matter 有純量鍵 produced_stamp／produced_stage／produced_provider;
//      stamp 等於該輪 run.json 之 stamp,provider 等於該次摘要呼叫之 providerId(遞補時為遞補者,而非席位之主席),seat 為設定路徑 summarize.ai,
//      promptFp 為摘要角色之提示詞指紋(評比機制之同一算法),pkg 為本套件之套件版,at 為記錄之建立時刻;md 不含 [object Object]
//   P2 同一篇改寫:分類法新增類別之 AI 重標 → producedHistory 長度 +1、produced 為最新(stage retag、provider 為重標呼叫之成交條目、
//      stamp 為該輪)、md 之純量鍵同步更新;機械改名(不呼叫 AI)→ seat／provider 皆 null、md 之 produced_provider 鍵移除
//   P3 同步入口:確定性修正有寫回者記產出鏈(standards-fix、seat／provider null、stamp 取 opt.stamp);使用者之編修照實同步而本套件未改寫者不記
//   P5 人工匯入(ops/ingestNotes)記 stage ingest(seat／provider 皆 null、stamp 取 deps.stamp);選件 { stage: 'ingest' }、{ stage: 'retag' } 取回正確集合
//   P4 依產出鏈選件(ops/notesByProvenance):依 stamp／stage／provider／seat／null／since／until／history 取回正確集合;舊記錄(無 produced)不出現;純讀
// 執行:自套件根 node <mocha> test/unit-flow-summarize-provenance.test.mjs(暫存 test/_tmp/flow-summarize-prov-<pid>,測完即刪;不連網、不呼叫真 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readMd, writeMd } from '../src/core/md/md.mjs'
import { summarizeBenchRole, retagBenchRole } from '../src/bench/summarizeBench.mjs'
import { syncNotes } from '../src/ops/syncNotes.mjs'
import { ingestNotes } from '../src/ops/ingestNotes.mjs'
import { notesByProvenance } from '../src/ops/notesByProvenance.mjs'
import { tmpRoot, removeRoots, resetConceptFold, rawDoc, itemOf, scriptedAi, buildTestSummarize, withStores, seedDocs, findFiles, readJsonFile, silentLog } from './tools/summarizeTestKit.mjs'
import { planBench, sleep } from './tools/captureForTest.mjs'

const PKG = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8'))
const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/

/**
 * 依角色改寫成交條目之 AI 替身(模擬調度層遞補:providerId 為實際回覆之條目,非席位之主席)
 *
 * @param {Object} base 輸入 scriptedAi 之替身
 * @param {Function} pick 輸入 (role, titles) => 成交條目 id｜null(沿用替身之預設)
 * @returns {Object} 回傳替身
 */
function withProviders(base, pick) {
    return {
        ...base,
        callJson: async (prompt, check, o) => {
            const r = await base.callJson(prompt, check, o)
            const role = base.calls.at(-1)?.role
            const id = r?.ok ? pick(role, [...String(prompt).matchAll(/標題：(.*)$/gm)].map((m) => m[1])) : null
            return id ? { ...r, providerId: id } : r
        },
    }
}

describe('unit-flow-summarize-provenance', function() {

    this.timeout(120_000)

    const MAIN = 'oc:opencode/mimo-v2.6-flash-free' // 預設摘要席之主席(settings.summarize.ai.use;替身未改寫者之成交條目)
    const FALLBACK = 'fb:fallback-one'
    const RETAG = 'rt:retag-one'
    const V1 = { domain: '天文學' }
    const V2 = { domain: '天文學', categories: ['原理與概念', '方法與技術', '模型與演算法', '流程與實務', '工具與實作', '資料與指標', '評估與驗證', '風險與限制', '恆星物理', '其他'] }
    const V3 = { ...V2, categories: V2.categories.map((c) => (c === '恆星物理' ? '天體物理' : c)), categoryRenames: { 恆星物理: '天體物理' } }

    let root = ''
    let flow1 = null
    let flow2 = null
    let flow3 = null
    let rep1 = null
    let rep2 = null
    let rep3 = null
    let base = null
    let ai = null
    let snap1 = null
    const slug = {}

    before(async () => {
        root = tmpRoot('flow-summarize-prov')
        base = scriptedAi((role, prompt, o, ts) => {
            if (role === 'summarize') return ts.map((t, i) => itemOf(i + 1, t, t === '另一篇' ? {} : { category: '其他' }))
            if (role === 'retag') return [...String(prompt).matchAll(/^(\d+)\. 【(.+?)】/gm)].map((m) => ({ index: Number(m[1]), category: '恆星物理' }))
            return undefined
        })
        // 備援甲之摘要由遞補者成交;重標由 RETAG 成交;其餘沿用替身之預設(席位之主席)
        ai = withProviders(base, (role, ts) => (role === 'summarize' && ts[0] === '備援甲' ? FALLBACK : (role === 'retag' ? RETAG : null)))
        const cfgOf = (vocab) => ({ aiAdapter: ai, scheduleLimitMin: 55, data: { vocab }, summarize: { rounds: 5, docsPerCall: 1 } })
        ;({ flow: flow1 } = buildTestSummarize(root, cfgOf(V1)))
        await seedDocs(flow1, [
            rawDoc('p1', { title: '主席乙' }),
            rawDoc('p2', { title: '備援甲', collectedAt: '2026-09-02T00:00:00+08:00' }),
            rawDoc('p3', { title: '另一篇', collectedAt: '2026-09-03T00:00:00+08:00' }),
        ])
        rep1 = await flow1.run()
        // 第一輪結束時之快照(記錄與 md):其後之輪次會改寫同一批筆記,P1 驗的是「新建當下」
        snap1 = await withStores(flow1, async (s) => Object.fromEntries((await s.notes.select()).map((n) => [n.docId, { rec: n, md: readMd(n.file), text: fs.readFileSync(n.file, 'utf8') }])))
        await sleep(1100) // 時間戳為秒級:各輪之日誌、開工標記與執行摘要各一份
        ;({ flow: flow2 } = buildTestSummarize(root, cfgOf(V2)))
        rep2 = await flow2.run()
        await sleep(1100)
        ;({ flow: flow3 } = buildTestSummarize(root, cfgOf(V3)))
        rep3 = await flow3.run()
        await withStores(flow3, async (s) => {
            for (const n of await s.notes.select()) slug[n.docId] = n.id
        })
    })

    after(() => {
        resetConceptFold()
        removeRoots([root])
    })

    const stampOf = (rep) => readJsonFile(rep.summaryFile).stamp
    const noteOf = async (flow, docId) => withStores(flow, async (s) => (await s.notes.select()).find((n) => n.docId === docId))

    it('前提:三輪皆成功,run.json 之 stamp 為 14 碼且各輪相異;三篇皆成筆記(第一輪)', async () => {
        for (const r of [rep1, rep2, rep3]) assert.equal(r.ok, true)
        const stamps = [rep1, rep2, rep3].map(stampOf)
        assert.ok(stamps.every((s) => /^\d{14}$/.test(s)), JSON.stringify(stamps))
        assert.equal(new Set(stamps).size, 3)
        assert.deepEqual(Object.keys(slug).sort(), ['p1', 'p2', 'p3'])
    })

    it('P1 第一輪新建:記錄有 produced／producedHistory(1 筆、與 produced 同值)／producedHistoryDropped 0;stamp＝該輪 run.json 之 stamp;seat＝summarize.ai;stage＝summarize;pkg 為本套件版;at＝建立時刻', async () => {
        const stamp1 = stampOf(rep1)
        for (const id of ['p1', 'p2', 'p3']) {
            const n = snap1[id].rec
            const p = n.produced
            assert.deepEqual([p.v, p.stamp, p.stage, p.seat, p.pkg], [1, stamp1, 'summarize', 'summarize.ai', `${PKG.name}@${PKG.version}`], id)
            assert.ok(LOCAL_ISO.test(p.at) && p.at === n.createdAt, `${id}:at＝建立時刻(${p.at})`)
            assert.equal(n.producedHistory.length, 1)
            assert.deepEqual(n.producedHistory[0], p)
            assert.equal(n.producedHistoryDropped, 0)
        }
    })

    it('P1 provider 為該次摘要呼叫之成交條目:遞補者成交之篇(備援甲)記遞補者,其餘記席位之主席;逐篇各依其所在之呼叫(每篇一次呼叫)', async () => {
        const got = {}
        for (const id of ['p1', 'p2', 'p3']) got[id] = snap1[id].rec.produced.provider
        assert.deepEqual(got, { p1: MAIN, p2: FALLBACK, p3: MAIN })
        assert.equal(base.calls.filter((c) => c.role === 'summarize').length, 3, '每篇一次摘要呼叫')
    })

    it('P1 promptFp 為摘要角色之提示詞指紋(16 碼;等於評比機制 planBench 對同一詞彙與批量之結果);同一輪各篇同值', async () => {
        const info = flow1.info()
        const want = planBench(summarizeBenchRole, { vocab: info.vocab, roleOpt: { docsPerCall: 1, charsPerDoc: info.settings.summarize.charsPerDoc } }).promptFp
        assert.match(want, /^[0-9a-f]{16}$/)
        for (const id of ['p1', 'p2', 'p3']) assert.equal(snap1[id].rec.produced.promptFp, want, id)
    })

    it('P1 md front matter 只加純量鍵 produced_stamp／produced_stage／produced_provider(與記錄同值;stamp 仍為字串);物件不入 front matter(無 [object Object])', async () => {
        const stamp1 = stampOf(rep1)
        for (const [id, provider] of [['p1', MAIN], ['p2', FALLBACK], ['p3', MAIN]]) {
            const { rec, md, text } = snap1[id]
            assert.ok(!text.includes('[object Object]'), id)
            const fm = md.front
            assert.deepEqual(Object.keys(fm).filter((k) => k.startsWith('produced')), ['produced_stamp', 'produced_stage', 'produced_provider'], id)
            assert.deepEqual([fm.produced_stamp, fm.produced_stage, fm.produced_provider], [stamp1, 'summarize', provider], id)
            assert.deepEqual([fm.produced_stamp, fm.produced_stage, fm.produced_provider], [rec.produced.stamp, rec.produced.stage, rec.produced.provider], '與記錄同值')
            for (const k of ['produced_stamp', 'produced_stage', 'produced_provider']) assert.equal(typeof fm[k], 'string')
            // 其餘 front matter 鍵(既有 14 鍵)原樣在前,產出鏈之三鍵附於其後
            assert.deepEqual(Object.keys(fm).slice(0, 14), ['title', 'slug', 'category', 'concepts', 'claim_type', 'evidence_level', 'sample_period', 'caveats', 'source_name', 'source_url', 'published', 'created', 'doc_id', 'type'])
        }
    })

    it('P2 第二輪(新增類別之 AI 重標):落點類別之筆記 producedHistory +1(舊筆於前)、produced 為最新——stage retag(AI 重判)、seat summarize.ai(重標席沿用摘要席)、provider＝重標呼叫之成交條目、stamp＝第二輪、promptFp＝重標角色之指紋;不在落點類別者(p3)不動', async () => {
        const stamp2 = stampOf(rep2)
        const info = flow2.info()
        const wantFp = planBench(retagBenchRole, { vocab: info.vocab, roleOpt: { batch: info.settings.summarize.retag.notesPerCall } }).promptFp
        for (const id of ['p1', 'p2']) {
            const n = await noteOf(flow2, id)
            const h = n.producedHistory
            assert.deepEqual(h.map((x) => [x.stage, x.stamp]), [['summarize', stampOf(rep1)], ['retag', stamp2], ['standards-fix', stampOf(rep3)]], `${id}:三輪各一筆(第二輪 AI 重標為 retag、第三輪機械改名為 standards-fix)`)
            assert.deepEqual([h[1].seat, h[1].provider, h[1].promptFp], ['summarize.ai', RETAG, wantFp], id)
            assert.equal(base.calls.filter((c) => c.role === 'retag').length, 1, '重標之 AI 只呼叫一次(兩篇同批)')
        }
        const p3 = await noteOf(flow2, 'p3')
        assert.equal(p3.producedHistory.length, 1, '未改寫者不追加')
        assert.equal(p3.produced.stage, 'summarize')
    })

    it('P2 第三輪(機械改名,不呼叫 AI):seat／provider 皆 null、無 promptFp、stamp＝第三輪;produced 與 producedHistory 末筆同值;md 之 produced_provider 鍵移除、produced_stamp／produced_stage 更新', async () => {
        const stamp3 = stampOf(rep3)
        for (const id of ['p1', 'p2']) {
            const n = await noteOf(flow3, id)
            const p = n.produced
            assert.deepEqual([p.stamp, p.stage, p.seat, p.provider, 'promptFp' in p], [stamp3, 'standards-fix', null, null, false], id)
            assert.deepEqual(n.producedHistory.at(-1), p)
            assert.equal(n.category, '天體物理')
            const fm = readMd(n.file).front
            assert.deepEqual([fm.produced_stamp, fm.produced_stage, 'produced_provider' in fm, fm.category], [stamp3, 'standards-fix', false, '天體物理'], 'md 為記錄之投影')
        }
    })

    it('P2 深合併不殘留:p1 之 produced 於第二輪有 promptFp、第三輪(機械)無——記錄之 produced 不留舊 promptFp(集合 patch 為深合併,須先清後寫)', async () => {
        const n = await noteOf(flow3, 'p1')
        assert.ok(n.producedHistory[1].promptFp, '第二輪(AI)有指紋')
        assert.equal('promptFp' in n.produced, false)
        assert.equal('promptFp' in n.producedHistory[2], false)
    })

    it('P3 同步入口:確定性修正(簡體 → 正體)有寫回者記 standards-fix(seat／provider null、stamp＝opt.stamp)並更新 md 純量鍵;使用者之編修而未被修正者不記(produced 與 md 之純量鍵不動、knowledgeChangedAt 照寫)', async () => {
        const info = flow3.info()
        const STAMP = '20261108235959'
        const edit = (n, from, to) => {
            const md = readMd(n.file)
            assert.ok(md.body.includes(from), '前提:一句話重點之原文')
            writeMd(n.file, md.front, md.body.replace(from, to))
        }
        const n3 = await noteOf(flow3, 'p3')
        const n1 = await noteOf(flow3, 'p1')
        const before1 = { produced: n1.produced, history: n1.producedHistory.length, front: Object.fromEntries(Object.entries(readMd(n1.file).front).filter(([k]) => k.startsWith('produced'))) }
        edit(n3, '說明方法之步驟與限制', '说明方法之步骤与限制') // 簡體 → SS3 確定性修正
        edit(n1, '說明方法之步驟與限制', '修訂後之重點說明') // 使用者改寫為合格之正體 → 不修
        const det = await withStores(flow3, async (s) => syncNotes({ stores: s, dirs: info.dirs, clock: info.clock, log: silentLog, vocab: info.vocab, locale: info.locale }, { all: true, stamp: STAMP }))
        assert.deepEqual([det.changed, det.stdFixed], [2, 1])
        const a3 = await noteOf(flow3, 'p3')
        assert.deepEqual([a3.produced.stage, a3.produced.stamp, a3.produced.seat, a3.produced.provider], ['standards-fix', STAMP, null, null])
        assert.deepEqual(a3.producedHistory.map((x) => x.stage), ['summarize', 'standards-fix'])
        const f3 = readMd(a3.file).front
        assert.deepEqual([f3.produced_stamp, f3.produced_stage, 'produced_provider' in f3], [STAMP, 'standards-fix', false])
        assert.ok(readMd(a3.file).body.includes('說明方法之步驟與限制'), '確定性修正已寫回 md')
        const a1 = await noteOf(flow3, 'p1')
        assert.deepEqual([a1.produced, a1.producedHistory.length], [before1.produced, before1.history], '使用者之編修不改產出鏈')
        assert.deepEqual(Object.fromEntries(Object.entries(readMd(a1.file).front).filter(([k]) => k.startsWith('produced'))), before1.front)
        assert.ok(a1.knowledgeChangedAt, '內容變更仍照寫 knowledgeChangedAt')
    })

    it('P4 notesByProvenance 於真 LMDB:依 stamp／stage／provider／seat／null／history 取回正確集合(舊記錄不出現)、純讀(集合之寫入皆拋仍成功)', async () => {
        const [s1, s2, s3] = [rep1, rep2, rep3].map(stampOf)
        const refuse = (k) => () => {
            throw new Error(`純讀不得呼叫 ${String(k)}`)
        }
        const ro = (notes) => new Proxy(notes, { get: (t, k) => (['patch', 'insertNew', 'replace', 'del'].includes(k) ? refuse(k) : t[k]) })
        await withStores(flow3, async (s) => {
            // 一筆無產出鏈之舊記錄(不回填):任何條件皆不出現
            await s.notes.insertNew([{ id: 'legacy-note', title: '舊筆記', docId: 'legacy', file: path.join(root, 'legacy.md'), category: '其他', concepts: ['甲', '乙'], summary: 'x', createdAt: '2026-01-01T00:00:00+08:00' }])
            const q = (cond) => notesByProvenance({ stores: { notes: ro(s.notes) } }, cond).then((r) => r.map((x) => x.slug))
            const sl = (...ids) => ids.map((i) => slug[i]).sort()
            // 預設只比對最後一筆
            assert.deepEqual(await q({ stamp: s3 }), sl('p1', 'p2'), '第三輪(機械改名)之最後一筆')
            assert.deepEqual(await q({ stage: 'summarize' }), sl(), '三篇之最後一筆皆已非 summarize(p3 已由同步修正改寫)')
            assert.deepEqual(await q({ provider: null }), sl('p1', 'p2', 'p3'), 'provider:null＝最後一筆為不呼叫 AI 之寫入')
            assert.deepEqual(await q({ provider: RETAG }), sl(), '重標 AI 之寫入已被其後之機械改名取代(最後一筆不是)')
            // history:true 比對任一筆
            assert.deepEqual(await q({ stamp: s1, history: true }), sl('p1', 'p2', 'p3'))
            assert.deepEqual(await q({ stamp: s2, history: true }), sl('p1', 'p2'))
            assert.deepEqual(await q({ provider: FALLBACK, history: true }), sl('p2'))
            assert.deepEqual(await q({ provider: RETAG, history: true }), sl('p1', 'p2'))
            assert.deepEqual(await q({ provider: MAIN, stage: 'summarize', history: true }), sl('p1', 'p3'))
            assert.deepEqual(await q({ seat: 'summarize.ai', stamp: s2, history: true }), sl('p1', 'p2'))
            assert.deepEqual(await q({ provider: FALLBACK, stage: 'standards-fix', history: true }), sl(), '同一筆須同時滿足全部條件(條件為「且」)')
            // stage 兩值之區分:AI 重標為 retag(其後被機械改名取代,故預設只比最後一筆時為空;history 時取回),機械改名為 standards-fix
            assert.deepEqual(await q({ stage: 'retag' }), sl(), 'AI 重標之寫入已被其後之機械改名取代(最後一筆不是 retag)')
            assert.deepEqual(await q({ stage: 'retag', history: true }), sl('p1', 'p2'))
            assert.deepEqual(await q({ stage: 'retag', provider: RETAG, seat: 'summarize.ai', history: true }), sl('p1', 'p2'))
            assert.deepEqual(await q({ stage: 'standards-fix' }), sl('p1', 'p2', 'p3'), '最後一筆：p1、p2 為機械改名、p3 為同步修正')
            assert.deepEqual(await q({ stage: 'retag', provider: null, history: true }), sl(), 'retag 恆有成交條目(不呼叫 AI 者不是 retag)')
            const r = await notesByProvenance({ stores: { notes: ro(s.notes) } }, { provider: RETAG, history: true })
            assert.ok(r.every((x) => x.produced.provider === RETAG && x.produced.stage === 'retag'), 'history 時回傳符合條件之那一筆')
            // 舊記錄從不出現
            for (const cond of [{}, { history: true }, { provider: null }, { stamp: null }, { provider: null, history: true }]) assert.ok(!(await q(cond)).includes('legacy-note'), JSON.stringify(cond))
        })
    })

    it('P4 since／until 比對 produced.at(含邊界,以時刻比較;時區表示不同亦可比):以第一輪 p1 之 at 為界取回含該筆者、排除其後之筆;區間外為空', async () => {
        const n = await noteOf(flow3, 'p1')
        const at1 = n.producedHistory[0].at // 第一輪之建立時刻
        const at2 = n.producedHistory[1].at // 第二輪重標之時刻(同輪 p2 同值)
        assert.ok(Date.parse(at2) > Date.parse(at1))
        await withStores(flow3, async (s) => {
            const deps = { stores: { notes: s.notes } }
            const ids = async (cond) => (await notesByProvenance(deps, cond)).map((x) => x.slug).sort()
            const utc = (iso) => new Date(iso).toISOString() // 同一時刻之 UTC 表示(含毫秒與 Z)
            assert.ok((await ids({ until: at1, history: true })).includes(slug.p1), 'until 含邊界(第一輪 p1 之 at 恰為上界)')
            assert.ok((await ids({ since: at1, until: utc(at1), history: true })).includes(slug.p1), 'since＝until＝某筆之 at(以 UTC 表示)→ 含該筆')
            assert.deepEqual(await ids({ since: at2, until: at2, history: true }), [slug.p1, slug.p2].sort(), '第二輪之重標兩篇同一時刻')
            assert.deepEqual(await ids({ until: utc(at1), stage: 'standards-fix', history: true }), [], '第一輪(含)以前無 standards-fix 之寫入')
            assert.deepEqual(await ids({ since: '2999-01-01T00:00:00+08:00', history: true }), [])
            assert.deepEqual(await ids({ until: '2000-01-01T00:00:00+08:00', history: true }), [])
        })
    })

    it('P5 人工匯入(總組裝之 info() 取 domain、identity、dirs、clock;真 LMDB):produced 之 stage 為 ingest、seat／provider 皆 null、stamp＝deps.stamp、歷史 1 筆;md 之 produced_stage 同值而無 produced_provider;選件 { stage: ingest } 只取回該筆,{ stage: retag } 不含之', async () => {
        const info = flow3.info()
        const STAMP = '20261109000000'
        const r = await withStores(flow3, async (s) => ingestNotes({ stores: s, dirs: info.dirs, clock: info.clock, domain: info.domains.summarize, identity: info.identity, stamp: STAMP }, [
            { url: 'https://example.com/manual-1', title: '人工匯入之原文', note: itemOf(1, '人工匯入之原文', { category: '其他' }) },
        ]))
        assert.equal(r.added, 1, JSON.stringify(r))
        const n = await withStores(flow3, async (s) => (await s.notes.select()).find((x) => x.sourceKind === 'manual'))
        assert.deepEqual(n.produced, { v: 1, stamp: STAMP, stage: 'ingest', seat: null, provider: null, pkg: `${PKG.name}@${PKG.version}`, at: n.createdAt })
        assert.deepEqual([n.producedHistory.length, n.producedHistoryDropped], [1, 0])
        const fm = readMd(n.file).front
        assert.deepEqual([fm.produced_stamp, fm.produced_stage, 'produced_provider' in fm], [STAMP, 'ingest', false])
        await withStores(flow3, async (s) => {
            const deps = { stores: { notes: s.notes } }
            const ids = async (cond) => (await notesByProvenance(deps, cond)).map((x) => x.slug).sort()
            const sl = (...docIds) => docIds.map((i) => slug[i]).sort()
            assert.deepEqual(await ids({ stage: 'ingest' }), [n.id])
            assert.deepEqual(await ids({ stage: 'ingest', history: true }), [n.id])
            assert.deepEqual(await ids({ stage: 'ingest', provider: null, seat: null, stamp: STAMP }), [n.id])
            assert.deepEqual(await ids({ stage: 'ingest', provider: 'x:one' }), [], '匯入不呼叫 AI,無成交條目')
            assert.deepEqual(await ids({ stage: 'retag', history: true }), sl('p1', 'p2'), '匯入之筆記不在 retag 之集合')
            assert.deepEqual(await ids({ stage: 'summarize', history: true }), sl('p1', 'p2', 'p3'), '匯入之筆記不在 summarize 之集合')
            assert.deepEqual(await ids({ provider: null }), [n.id, ...sl('p1', 'p2', 'p3')].sort(), 'provider:null 含匯入、機械改名、同步修正之最後一筆')
        })
    })

    it('日誌檔:重標與摘要之提示詞指紋可算,無「提示詞指紋算不出」之訊息', () => {
        const logs = findFiles(`${root}/log`, '-run.log').map((f) => fs.readFileSync(f, 'utf8')).join('\n')
        assert.ok(!logs.includes('提示詞指紋算不出'), logs.split('\n').filter((l) => l.includes('提示詞指紋')).join('\n'))
    })
})
