// unit-summarize-digest.test.mjs — 產物契約(domain.contract)與速報 domain(零件庫用法):契約之形狀、內建 note 契約等價於現行、欄位上限之通用判定、
//   自訂契約走同一條子階段(不落 md、記錄入庫、未達標準不納入附回饋、宿主落地 sink)、預篩之宿主排序 rank、版型章名之單一來源
// 規則(出自 stores/noteBuild 檔頭【產物契約】、domain/digestDomain 檔頭、stages/noteStage 與 triageStage 之 JSDoc、core/md/noteContent):
//   ①contract＝{ kind, fields, buildNote → { record, md|null, text? }, standards };內建 note 契約之 buildNote 即現行 buildNote(記錄、frontmatter、本文逐位元組同),
//     standards 為全部筆記標準;無 contract 之自組 domain 退為 note 契約
//   ②fields 之通用判定(contractFieldProblems):required／type／maxChars／maxItems;字樣「缺 X」「X 須為 …」「欄位 X 超過 N 字」「X 超過 N 項」;內建 note 預設不設上限,
//     createSummarizeDomain({ limits }) 併入;逾者於納入閘以 SS2 不納入、附回饋
//   ③非 note 契約:不做 note 之正規化,只驗 fields;落地前 checkNote 只跑 contract.standards(無 md 者以 text 判 SS3／SS4);md 為 null 即不寫檔;sink 給了即由宿主落地
//   ④stageOpts.triage.rank(docs, { ctx }) 回要留者,未入選者攔下(skipReason「預篩：未入選」)
//   ⑤版型章名、來源章與標注行首只定義於 core/md/noteContent(NOTE_SECTION_TITLES 等);套件非測試檔以章名為 section 參數或標題者皆取常數,不另寫字面
// 執行:自套件根 node <mocha> test/unit-summarize-digest.test.mjs(暫存 test/_tmp/summarize-digest-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memStore, nullLogger, genClockTZ, msgOf } from './tools/captureForTest.mjs'
import { recLog, bagCtx } from './tools/stageKit.mjs'
import { rawDoc, itemOf } from './tools/summarizeTestKit.mjs'
import { resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'
import { createSummarizeRuntime } from '../src/summarizeRuntime.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { createDigestDomain, DIGEST_DEFAULT, DIGEST_PROMPT_SIGS } from '../src/domain/digestDomain.mjs'
import { buildNote, noteContractOf, contractOf, contractProblem, mergeContractLimits, NOTE_CONTRACT_FIELDS, NOTE_CONTRACT_STANDARDS } from '../src/stores/noteBuild.mjs'
import { contractFieldProblems, CONTRACT_FIELD_TYPES, cleanStrList } from '../src/standards/noteNormalize.mjs'
import { gateNoteItem } from '../src/standards/noteGate.mjs'
import { checkNote, NOTE_STANDARDS } from '../src/standards/noteStandards.mjs'
import { NOTE_SECTION_TITLES, NOTE_SECTION_ORDER, NOTE_SOURCE_LABELS, NOTE_QUALITY_LABELS, NON_CONTENT_SECTIONS } from '../src/core/md/noteContent.mjs'
import { SUMMARY_SECTION } from '../src/core/md/md.mjs'
import { stageSummarize } from '../src/stages/noteStage.mjs'
import { stageTriage } from '../src/stages/triageStage.mjs'
import { domainTermsIn } from './tools/captureForTest.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/')
const TMP = `${ROOT}/test/_tmp/summarize-digest-${process.pid}`
const log = nullLogger()
const clock = genClockTZ('Asia/Taipei')
const NOW = '2026-10-28T12:00:00+08:00'
const SETTINGS = resolveSummarizeSettings({ summarize: { triage: { enabled: false } } })

/**
 * 速報子階段之執行環境
 *
 * @param {Array} docs 輸入文件記錄
 * @param {Function} itemsOf 輸入 (本批文件) => AI 項目陣列
 * @param {Object} [stageOpt={}] 輸入追加之子階段 opt
 * @param {Object} [domainOpt={}] 輸入 createDigestDomain 之 opt
 * @returns {Object} 回傳 { stores, run, calls, log }
 */
function digestEnv(docs, itemsOf, stageOpt = {}, domainOpt = {}) {
    const stores = { docs: memStore(docs), notes: memStore(), frontier: memStore(), holds: memStore() }
    const domain = createDigestDomain(domainOpt)
    const calls = []
    const callAI = async (p, check, o) => {
        const prompt = await p
        calls.push(prompt)
        const titles = [...prompt.matchAll(/^標題：(.*)$/gm)].map((m) => m[1])
        const data = itemsOf(titles)
        return { ok: true, data, providerId: 'stub' }
    }
    const deps = { stores, settings: SETTINGS, clock, dirs: { notes: `${TMP}/notes` }, domains: { summarize: domain }, ai: null }
    const lg = recLog()
    return { stores, calls, log: lg, run: () => stageSummarize({ docsPerBatch: 3, parallel: 1, rounds: 1, callAI, ...stageOpt }).run(bagCtx(deps, lg)) }
}

describe('unit-summarize-digest', function() {

    before(() => fs.mkdirSync(`${TMP}/notes`, { recursive: true }))
    after(() => fs.rmSync(TMP, { recursive: true, force: true }))

    // ══════════════════════════ ① 契約之形狀與內建 note 契約 ══════════════════════════
    describe('產物契約:形狀、內建 note 契約等價於現行、退路', function() {

        it('createSummarizeDomain 回傳 contract:kind note、fields 為 NOTE_CONTRACT_FIELDS(必填 title／summary／key_points／concepts,其餘選填、無上限)、standards 為全部筆記標準;buildNote 之記錄、frontmatter、本文與 stores/noteBuild.buildNote 逐位元組同', () => {
            const d = createSummarizeDomain({})
            const c = d.contract
            assert.equal(contractProblem(c), '')
            assert.deepEqual([c.kind, c.standards], ['note', NOTE_STANDARDS.map((s) => s.id)])
            assert.equal(c.fields, NOTE_CONTRACT_FIELDS)
            assert.deepEqual(Object.entries(NOTE_CONTRACT_FIELDS).filter(([, f]) => f.required).map(([k]) => k).sort(), ['concepts', 'key_points', 'summary', 'title'])
            assert.ok(Object.values(NOTE_CONTRACT_FIELDS).every((f) => f.maxChars === undefined && f.maxItems === undefined), '內建 note 預設不設上限')
            assert.deepEqual([...NOTE_CONTRACT_STANDARDS], NOTE_STANDARDS.map((s) => s.id))
            const k = itemOf(1, '甲')
            const doc = { ...rawDoc('d1'), publishedAt: '2026-01-01' }
            const a = c.buildNote(k, doc, { notesDir: `${TMP}/n`, nowIso: NOW, chars: { sourceChars: 100, processedChars: 50 } })
            const b = buildNote({ k, doc, domain: d, notesDir: `${TMP}/n`, nowIso: NOW, chars: { sourceChars: 100, processedChars: 50 } })
            assert.deepEqual(a.record, b.record)
            assert.deepEqual([a.md.file, a.md.front, a.md.body, a.slug, a.nowIso], [b.file, b.front, b.body, b.slug, b.nowIso])
            assert.equal(a.text, undefined, '有 md 者不另給 text')
        })

        it('contractProblem：缺 kind／fields／buildNote／standards、standards 含不認得之標準皆指名;contractOf:無 contract 之自組 domain 退為 note 契約、有而不合即拋', () => {
            assert.match(contractProblem(null), /contract 須為物件/)
            assert.match(contractProblem({ kind: '', fields: {}, buildNote: () => ({}), standards: [] }), /contract\.kind 須為非空字串/)
            assert.match(contractProblem({ kind: 'x', fields: null, buildNote: () => ({}), standards: [] }), /contract\.fields 須為物件/)
            assert.match(contractProblem({ kind: 'x', fields: {}, buildNote: 'f', standards: [] }), /contract\.buildNote 須為函數/)
            assert.match(contractProblem({ kind: 'x', fields: {}, buildNote: () => ({}), standards: 'SS3' }), /contract\.standards 須為標準 id 之字串陣列/)
            assert.match(contractProblem({ kind: 'x', fields: {}, buildNote: () => ({}), standards: ['SS3', 'ZZ9'] }), /含不認得之標準：ZZ9（可用：SS2、SS3、SS4、SS6、SS11）/)
            const bare = { vocab: createSummarizeDomain({}).vocab, normalizeQuality: () => ({ claimType: 'x', evidenceLevel: 'x', evidenceNote: '', caveats: [], samplePeriod: 'x', pros: [], cons: [], regime: [], counterViews: [] }), renderNoteBody: () => 'b' }
            assert.equal(contractOf(bare).kind, 'note')
            assert.equal(contractOf(bare).standards, NOTE_CONTRACT_STANDARDS)
            assert.match(msgOf(() => contractOf({ ...bare, contract: { kind: 'x' } })), /domain\.contract 不合：contract\.fields 須為物件/)
            assert.throws(() => noteContractOf(null), /noteContractOf 需要 domain 物件/)
        })

        it('mergeContractLimits／createSummarizeDomain({ limits })：併入欄位上限;不認得之欄位、非物件、非正整數皆拋;納入閘以 SS2 不納入並附「欄位 X 超過 N 字」;預設(無上限)照收', () => {
            const d = createSummarizeDomain({ limits: { summary: { maxChars: 5 }, key_points: { maxItems: 1 } } })
            assert.deepEqual([d.contract.fields.summary, d.contract.fields.key_points], [{ type: 'string', required: true, maxChars: 5 }, { type: 'string[]', required: true, maxItems: 1 }])
            assert.equal(d.contract.fields.title, NOTE_CONTRACT_FIELDS.title, '未覆寫之欄位原樣')
            assert.match(msgOf(() => mergeContractLimits(NOTE_CONTRACT_FIELDS, { zzz: { maxChars: 1 } })), /contract\.limits 含不認得之鍵：zzz/)
            assert.match(msgOf(() => mergeContractLimits(NOTE_CONTRACT_FIELDS, { summary: 5 })), /contract\.limits\.summary 須為物件/)
            assert.match(msgOf(() => mergeContractLimits(NOTE_CONTRACT_FIELDS, { summary: { maxChars: 0 } })), /contract\.limits\.summary\.maxChars 須為正整數/)
            assert.match(msgOf(() => mergeContractLimits(NOTE_CONTRACT_FIELDS, { summary: { max: 1 } })), /contract\.limits\.summary 含不認得之鍵：max/)
            assert.match(msgOf(() => createSummarizeDomain({ limits: 'x' })), /contract\.limits 須為物件/)
            const item = itemOf(1, '甲') // summary 10 字、key_points 2 項
            const g = gateNoteItem(item, { vocab: d.vocab, contract: d.contract })
            assert.deepEqual([g.ok, g.std, g.reasons], [false, 'SS2', ['欄位 summary 超過 5 字', 'key_points 超過 1 項']])
            const g0 = gateNoteItem(item, { vocab: d.vocab, contract: createSummarizeDomain({}).contract })
            assert.equal(g0.ok, true, '預設無上限')
            assert.equal(gateNoteItem(item, { vocab: d.vocab }).ok, true, '未給契約同預設')
        })

        it('contractFieldProblems：required／type／maxChars／maxItems 之判定與字樣;未給之選填欄不檢;型別名不在 CONTRACT_FIELD_TYPES 即拋;fields 非物件回 []', () => {
            const F = { s: { required: true, type: 'string', maxChars: 3 }, l: { type: 'string[]', maxItems: 2 }, o: { type: 'object[]' }, n: { type: 'integer' }, b: { type: 'boolean' } }
            assert.deepEqual(contractFieldProblems({ s: '一二三', l: ['a', 'b'], o: [{}], n: 1, b: false }, F), [])
            assert.deepEqual(contractFieldProblems({ s: '   ' }, F).map((p) => p.detail), ['缺 s'])
            assert.deepEqual(contractFieldProblems({ s: '一二三四' }, F).map((p) => p.detail), ['欄位 s 超過 3 字'])
            assert.deepEqual(contractFieldProblems({ s: 'x', l: ['a', 'b', 'c'] }, F).map((p) => p.detail), ['l 超過 2 項'])
            assert.deepEqual(contractFieldProblems({ s: 5, l: 'x', o: [1], n: 1.5, b: 'no' }, F).map((p) => p.detail), ['s 須為 string', 'l 須為 string[]', 'o 須為 object[]', 'n 須為 integer', 'b 須為 boolean'])
            assert.deepEqual(contractFieldProblems({ s: 'x', l: [] }, F), [], '選填之空陣列不算缺')
            assert.deepEqual(contractFieldProblems({ s: 'x' }, null), [])
            assert.throws(() => contractFieldProblems({}, { s: { type: 'number' } }), /contract\.fields\.s\.type「number」不在可用型別/)
            assert.deepEqual([...CONTRACT_FIELD_TYPES], ['string', 'string[]', 'object[]', 'integer', 'boolean'])
            assert.deepEqual(cleanStrList([{}, ' a ', 1, '', null, 'b']), ['a', '1', 'b'], 'cleanStrList 移至 noteNormalize(組裝與驗證同一份)')
        })

        it('checkNote 之 only 與 text：only 只回所列之標準;無 md 之產物以 text 判 SS3／SS4(標題取 record.title);未給 only 即全部', () => {
            const rs = checkNote({ record: { title: '甲' }, text: '数据之说明' }, { only: ['SS3'] })
            assert.deepEqual(rs.map((r) => [r.std, r.status]), [['SS3', 'violation']])
            const r4 = checkNote({ record: { title: '甲' }, text: '成長 37%' }, { only: ['SS4'], material: '原文沒有數字' })
            assert.deepEqual(r4.map((r) => [r.std, r.status]), [['SS4', 'violation']])
            assert.match(r4[0].detail, /原文沒有之數字：37%/)
            assert.deepEqual(checkNote({ record: { title: '甲' }, text: '成長 37%' }, { only: ['SS4'], material: '去年成長 37%' }).map((r) => r.status), ['pass'])
            assert.deepEqual(checkNote({ front: {}, body: '' }).map((r) => r.std), ['SS2', 'SS3', 'SS6', 'SS11'], '未給 only 即全部(SS4 未給材料不產)')
        })
    })

    // ══════════════════════════ ② 速報 domain ══════════════════════════
    describe('createDigestDomain(產物契約之第二實例)', function() {

        it('預設:contract kind digest、fields short／long 必填且上限＝提示詞上限×容差(60×1.5＝90、200×1.5＝300)、standards SS3／SS4、不落 md;isValidItem 驗 index／relevant／short／long;提示詞中立且載上限;opt 之錯值皆拋', () => {
            const d = createDigestDomain({})
            assert.deepEqual([d.contract.kind, d.contract.fields.short.maxChars, d.contract.fields.long.maxChars, [...d.contract.standards]], ['digest', 90, 300, ['SS3', 'SS4']])
            assert.equal(contractProblem(d.contract), '')
            assert.deepEqual([DIGEST_DEFAULT.shortMax, DIGEST_DEFAULT.longMax, DIGEST_DEFAULT.tolerance], [60, 200, 1.5])
            assert.deepEqual(Object.keys(DIGEST_PROMPT_SIGS), ['digest'])
            assert.deepEqual(['normalizeQuality', 'renderNoteBody'].map((k) => k in d), [false, false], '不具 note 版型之內部件')
            const ok = { index: 1, relevant: true, short: '一句', long: '一段' }
            assert.deepEqual([d.isValidItem(ok, 1), d.isValidItem({ ...ok, index: 2 }, 1), d.isValidItem({ ...ok, relevant: 'yes' }, 1), d.isValidItem({ ...ok, short: ' ' }, 1), d.isValidItem({ index: 1, relevant: false, reason: '亂碼' }, 1)], [true, false, false, false, true])
            const n = d.contract.buildNote(ok, { id: 'd1', title: 'T', url: 'https://e.com/a', sourceName: 'S', publishedAt: '2026-01-01' }, { nowIso: NOW })
            assert.deepEqual(n, { record: { id: 'digest-d1', docId: 'd1', title: 'T', short: '一句', long: '一段', sourceUrl: 'https://e.com/a', sourceName: 'S', publishedAt: '2026-01-01', createdAt: NOW }, md: null, text: '一句\n一段' })
            const p = d.buildPrompt([{ title: 'T', sourceName: 'S', url: 'https://e.com/a', text: '內文' }], [])
            assert.ok(p.startsWith('你是知識庫的速報撰寫員') && p.includes('至多 60 字') && p.includes('至多 200 字') && p.includes('"short":"一句話摘要","long":"段落摘要"'), p)
            assert.deepEqual(domainTermsIn(p), [], '提示詞不含特定產業領域之詞')
            assert.ok(createDigestDomain({ vocab: { domain: '天文學', kbLabel: '星空庫' } }).buildPrompt([], []).includes('本知識庫之主題範圍為「天文學」'))
            assert.equal(createDigestDomain({ shortMax: 40, longMax: 100, tolerance: 2 }).contract.fields.long.maxChars, 200)
            assert.match(msgOf(() => createDigestDomain({ zzz: 1 })), /createDigestDomain 之 opt 含不認得之鍵：zzz/)
            assert.match(msgOf(() => createDigestDomain({ shortMax: 0 })), /shortMax／longMax 須為正整數/)
            assert.match(msgOf(() => createDigestDomain({ tolerance: 0.5 })), /tolerance 須為 ≥1 之數/)
            assert.match(msgOf(() => createDigestDomain({ standards: ['SS2', 'ZZ'] })), /standards 須為標準 id 之陣列/)
            assert.ok(createDigestDomain({ prompts: { digest: (docs, o, ctx) => `${ctx.defaultPrompt(docs, o)}\n（附註）` } }).buildPrompt([], []).endsWith('（附註）'), '提示詞覆寫')
        })

        it('注入總組裝(createSummarizeRuntime 之 opt.domains):具 contract 而無 normalizeQuality／renderNoteBody 者通過;contract 不合即於建構期拋', () => {
            const d = createDigestDomain({})
            const rt = createSummarizeRuntime({}, SETTINGS, { domains: { summarize: d } })
            assert.equal(rt.domains.summarize.contract.kind, 'digest')
            assert.match(msgOf(() => createSummarizeRuntime({}, SETTINGS, { domains: { summarize: { ...d, contract: { kind: '' } } } })), /cfg\.domains\.summarize 不合：contract\.kind 須為非空字串/)
        })
    })

    // ══════════════════════════ ③ 自訂契約走同一條子階段 ══════════════════════════
    describe('速報之一輪(摘要子階段;替身 AI)', function() {

        it('記錄落 notes(id digest-<docId>、無 md 檔)、文件 noted 並回鏈 noteSlug;非 note 契約不做 note 之正規化(無 stdFixes)', async () => {
            const e = digestEnv([rawDoc('d1'), rawDoc('d2')], (titles) => titles.map((t, i) => ({ index: i + 1, relevant: true, reason: '', short: `${t}之一句話`, long: `${t}說明方法之步驟與限制。` })))
            const r = await e.run()
            assert.deepEqual([r.detail.processed, r.detail.notes, r.detail.stdRejected], [2, 2, 0], JSON.stringify(r.detail))
            const n1 = await e.stores.notes.get('digest-d1')
            assert.deepEqual([n1.docId, n1.short, n1.long, n1.title, 'stdFixes' in n1, 'file' in n1], ['d1', '測試文件d1之一句話', '測試文件d1說明方法之步驟與限制。', '測試文件d1', false, false])
            assert.deepEqual(fs.readdirSync(`${TMP}/notes`), [], '不落 md')
            const d1 = await e.stores.docs.get('d1')
            assert.deepEqual([d1.status, d1.noteSlug], ['noted', 'digest-d1'])
            assert.ok(e.log.lines.some((l) => l === 'INFO 摘要：新增知識筆記 digest-d1'), e.log.lines.join('\n'))
            // 同文件再來一輪:既有產物不覆寫,只回鏈
            await e.stores.docs.patch('d1', { status: 'raw' })
            const r2 = await e.run()
            assert.deepEqual([r2.detail.notes, r2.detail.notesExisting], [0, 1])
        })

        it('未達契約(long 逾上限×容差)→ 不納入:文件留 raw、tries＋1、回饋「欄位 long 超過 300 字」、登錄待判 SS2;SS3(簡體)與 SS4(原文沒有之數字)於落地前以 text 判、同樣不納入', async () => {
            const long = '長'.repeat(301)
            const e = digestEnv([rawDoc('d1'), rawDoc('d2'), rawDoc('d3')], (titles) => titles.map((t, i) => ({ index: i + 1, relevant: true, reason: '', short: t.includes('d2') ? '数据之说明' : '一句', long: t.includes('d1') ? long : (t.includes('d3') ? '成長 37% 之說明。' : '一段說明。') })))
            const r = await e.run()
            assert.deepEqual([r.detail.notes, r.detail.stdRejected], [0, 3], JSON.stringify(r.detail))
            const d1 = await e.stores.docs.get('d1')
            assert.deepEqual([d1.status, d1.summarizeTries, d1.stdFeedback], ['raw', 1, '欄位 long 超過 300 字'], '未達契約者於驗證即不收(lastError 只在終態才記)')
            const d2 = await e.stores.docs.get('d2')
            assert.deepEqual([d2.status, d2.summarizeTries], ['raw', 1], JSON.stringify(d2))
            assert.match(String(d2.stdFeedback), /^SS3 內容 \d+ 處/, `${JSON.stringify(d2)}\n${e.log.lines.join('\n')}`)
            const d3 = await e.stores.docs.get('d3')
            assert.match(String(d3.stdFeedback), /^SS4 原文沒有之數字：37%/, JSON.stringify(d3))
            assert.equal((await e.stores.holds.select()).filter((h) => h.std === 'SS2' || h.std === 'SS3' || h.std === 'SS4').length, 3, '三篇皆登錄待判')
            assert.equal((await e.stores.notes.select()).length, 0)
        })

        it('stageOpts.summarize.sink：宿主落地取代寫檔與入庫(收 { record, md:null, doc, ctx });回 id 者作回鏈之 slug;既有產物判定仍以 stores.notes', async () => {
            const seen = []
            const e = digestEnv([rawDoc('d1')], (titles) => titles.map((t, i) => ({ index: i + 1, relevant: true, reason: '', short: '一句', long: '一段說明。' })), { sink: async ({ record, md, doc, ctx }) => {
                seen.push([record.id, md, doc.id, typeof ctx.deps])
                return { ok: true, id: 'host-1' }
            } })
            const r = await e.run()
            assert.deepEqual([r.detail.notes, seen], [1, [['digest-d1', null, 'd1', 'object']]])
            assert.deepEqual([(await e.stores.notes.select()).length, fs.readdirSync(`${TMP}/notes`)], [0, []], '不入庫、不寫檔')
            assert.deepEqual([(await e.stores.docs.get('d1')).status, (await e.stores.docs.get('d1')).noteSlug], ['noted', 'host-1'])
        })
    })

    // ══════════════════════════ ④ 預篩之宿主排序 ══════════════════════════
    describe('stageOpts.triage.rank(宿主排序取前 N)', function() {

        it('已放行者交 rank,回要留者;未入選者攔下(skip、「預篩：未入選」)、report 計 ranked／rankSkipped、stats 之 out／skip 隨之;回非陣列即拋;未給 rank 之 report 無此二鍵', async () => {
            const mk = () => memStore([
                { id: 'a', status: 'raw', title: 'A', text: 'x', collectedAt: '2026-06-01' },
                { id: 'b', status: 'raw', title: 'B', text: 'y', collectedAt: '2026-06-02' },
                { id: 'c', status: 'raw', title: 'C', text: 'z', collectedAt: '2026-06-03' },
            ])
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: true } } })
            const domain = { buildPrompt: async (batch) => batch.map((d) => d.title).join('\n'), isValidItem: (it, n) => !!it && Number.isInteger(it.index) && it.index >= 1 && it.index <= n && typeof it.relevant === 'boolean', reasonOf: (it) => it.reason || '無關' }
            const callAI = async (p) => ({ ok: true, data: (await p).split('\n').map((t, i) => ({ index: i + 1, relevant: true })) })
            const seen = []
            const docs = mk()
            const r = await stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, callAI, rank: async (ready, x) => {
                seen.push([ready.map((d) => d.id), typeof x.ctx])
                return [ready.find((d) => d.id === 'b')]
            } }).run({ deps: { stores: { docs }, clock, settings }, log })
            assert.deepEqual(seen, [[['a', 'b', 'c'], 'object']])
            assert.deepEqual([r.detail.ranked, r.detail.rankSkipped, r.stats.out, r.stats.skip], [1, 2, 1, 2])
            const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((id) => docs.get(id)))
            assert.deepEqual([b.status, b.triage], ['raw', 'relevant'])
            assert.deepEqual([a.status, a.triage, a.skipKind, a.skipReason, c.status], ['skip', 'irrelevant', 'triage', '預篩：未入選', 'skip'])
            await assert.rejects(() => stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, callAI, rank: () => 'x' }).run({ deps: { stores: { docs: mk() }, clock, settings }, log }), /triage 之 opt\.rank 須回傳文件陣列/)
            const r0 = await stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, callAI }).run({ deps: { stores: { docs: mk() }, clock, settings }, log })
            assert.deepEqual(['ranked' in r0.detail, r0.stats.out], [false, 3])
        })
    })

    // ══════════════════════════ ⑤ 版型章名之單一來源 ══════════════════════════
    describe('版型章名之單一來源(core/md/noteContent)', function() {

        const TITLES = { summary: '一句話重點', quality: '品質與證據標注', keyPoints: '核心知識', parameters: '關鍵參數', methods: '方法與步驟', conditions: '適用條件與限制', prosCons: '利弊與取捨', regime: '時效與機制相依', counterViews: '爭議與反方觀點', verifiable: '可驗證要點', source: '來源' }

        it('NOTE_SECTION_TITLES 之值即既有筆記之章名(不可改);NOTE_SECTION_ORDER 為版型之章序;summary 即 md.mjs 之 SUMMARY_SECTION;NON_CONTENT_SECTIONS 之來源章取之;來源章與標注章之行首', () => {
            assert.deepEqual({ ...NOTE_SECTION_TITLES }, TITLES)
            assert.deepEqual([...NOTE_SECTION_ORDER], Object.keys(TITLES))
            assert.equal(NOTE_SECTION_TITLES.summary, SUMMARY_SECTION)
            assert.deepEqual(NON_CONTENT_SECTIONS, ['來源', '關聯', '⚠ 衝突與反例'])
            assert.deepEqual({ ...NOTE_SOURCE_LABELS }, { originalTitle: '原文標題', sourceName: '來源', url: '網址', published: '發布時間', textFrom: '內文取得方式', processed: '內文處理範圍' })
            assert.deepEqual({ ...NOTE_QUALITY_LABELS }, { claimType: '內容類型', evidenceLevel: '證據等級', samplePeriod: '數據樣本期間' })
            assert.ok([NOTE_SECTION_TITLES, NOTE_SECTION_ORDER, NOTE_SOURCE_LABELS, NOTE_QUALITY_LABELS].every(Object.isFrozen))
        })

        it('套件非測試檔以章名為章之參數或標題者(section／sectionOf／sectionBodyOf 之第二參數、「## 章名」)皆取常數,不另寫字面(只許 core/md/noteContent 與 md.mjs 之 SUMMARY_SECTION)', () => {
            const files = []
            const walk = (rel) => {
                for (const d of fs.readdirSync(path.join(ROOT, 'src', rel), { withFileTypes: true })) {
                    const r = rel ? `${rel}/${d.name}` : d.name
                    if (d.isDirectory()) {
                        if (d.name === 'node_modules' || r === 'test') continue
                        walk(r)
                    }
                    else if (d.name.endsWith('.mjs') && !['core/md/noteContent.mjs', 'core/md/md.mjs'].includes(r)) files.push(r)
                }
            }
            walk('')
            assert.ok(files.length >= 30)
            const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            const hits = []
            for (const f of files) {
                const code = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
                for (const t of Object.values(TITLES)) {
                    const re = new RegExp(`(?:section|sectionOf|sectionBodyOf|dropSection)\\([^)\\n]*['"\`]${esc(t)}['"\`]|['"\`]## ${esc(t)}`)
                    if (re.test(code)) hits.push(`${f}:${t}`)
                }
            }
            assert.deepEqual(hits, [])
        })
    })
})
