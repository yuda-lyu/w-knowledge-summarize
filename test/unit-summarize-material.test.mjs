// unit-summarize-material.test.mjs — 素材往返:摘要判素材壞了而退回抓取 → 抓取之補全文子階段以排除之方法重抓 → 下一輪摘要再取到同一文件
// 規則(出自 stores/materialPolicy 檔頭、抓取套件之 refetchRequestOf〔stores/fetchPolicy〕與補全文子階段【兩個佇列】〔stages/detailFetchStage〕):
//   ①退回之欄位(文件 patch):抓取端之欄位由抓取套件決定——status new、瀏覽器佇列之路由(fetcher browser、lastClass render、deferredAt)、
//     排除產生該素材之方法(refetchSkip)、lastReason material、lastError(摘要回報之說明);摘要自身之欄位——formatRefetches＋1、清預篩與摘要
//     之舊判定(triage／triagedAt／triageTries／summarizeTries／skipReason);fetchTries 與正文不動
//   ②抓取側讀得到:佇列之分法(抓取套件 docQueuesOf)將之歸瀏覽器佇列(不在補全文佇列);補全文子階段以瀏覽器重抓且不用被排除之方法(不前置 curl)
//   ③摘要側讀得到:重抓成功 → raw(textFrom browser:<方法>、rawAt、refetchSkip 清除、fetcher 清空;formatRefetches 留存、預篩判定仍空)→
//     下一輪預篩再取到;放行者摘要成筆記(來源章之內文取得方式為抓取套件之顯示名);仍判素材壞了者已達上限(summarize.refetch.max 預設 1)
//     → 照常 skip(skipKind 取抓取套件之 SKIP_KIND_MATERIAL)
//   ④總組裝＋真 LMDB(集合之 patch 為深合併、陣列依索引合併):兩輪 flow.run 與其間之抓取子階段走同一庫,往返後之欄位與記憶體集合之結果相同
// 抓取之件(補全文子階段、瀏覽器抓取器、佇列之分法)經測試專用之橋接 test/tools/captureForTest.mjs(套件程式碼不 import);瀏覽器以注入之
//   runCli 替身(不開瀏覽器、不連網);抓取設定交抓取套件驗(本套件之 resolveSummarizeSettings 之 capture 段)。
// 對照原實作之 unit-summarize-material(190:往返)——所斷言之欄位不變;摘要成筆記之下游段與總組裝之真 LMDB 案為新增。
// 執行:自套件根 node <mocha> test/unit-summarize-material.test.mjs(暫存 test/_tmp/summarize-material-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { memStore, stageDetailFetch, createBrowserFetcher, docQueuesOf } from './tools/captureForTest.mjs'
import { recLog } from './tools/stageKit.mjs'
import {
    FIXED_CLOCK, tmpRoot, removeRoots, resetConceptFold, rawDoc, itemOf, titlesOf, scriptedAi, buildTestSummarize, withStores, seedDocs,
} from './tools/summarizeTestKit.mjs'
import { SKIP_KIND_MATERIAL, textFromLabelOf } from '../src/core/capturePackage.mjs'
import { readMd } from '../src/core/md/md.mjs'
import { resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'
import { resolveSummarizeVocab } from '../src/core/vocab/summarizeVocab.mjs'
import { createTriageDomain } from '../src/domain/triageDomain.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { createMaterialPolicy } from '../src/stores/materialPolicy.mjs'
import { stageTriage } from '../src/stages/triageStage.mjs'
import { stageSummarize } from '../src/stages/noteStage.mjs'

const NOW = FIXED_CLOCK.iso8()
// 預篩開啟(預設);瀏覽器分流每輪 3 篇(抓取套件之其餘設定為其預設)
const CAPTURE = { browser: { perRun: 3 } }
const SETTINGS = resolveSummarizeSettings({ capture: CAPTURE })
const VOCAB = resolveSummarizeVocab({})

// 素材壞了之理由(直指亂碼)與兩篇文件:a 重抓後放行而成筆記、b 重抓後仍判素材壞了
const REASON = '內文為亂碼無法辨識，看不出主題與內容'
const TITLE = { a: '晶體結構之繞射分析', b: '濕地鳥類之族群調查' }
const GARBLED = `${'�'.repeat(40)}${'錕斤拷'.repeat(20)}`
const LONG = (title) => `${title}。本段說明觀測方法、資料來源、誤差估計與結果之限制，並比較不同條件下之差異。`.repeat(10)
const docOf = (id) => rawDoc(id, { title: TITLE[id], text: GARBLED, textFrom: 'article', fetchTries: 1, url: `https://example.com/${id}` })

// 退回時摘要所寫之欄位(抓取端＋摘要自身);逐欄比對之鍵
const PATCH_KEYS = ['status', 'fetcher', 'lastClass', 'refetchSkip', 'deferredAt', 'lastReason', 'lastError', 'formatRefetches', 'triage', 'triagedAt', 'triageTries', 'summarizeTries', 'skipReason']
// 往返後兩側讀寫之欄位(記憶體集合與真 LMDB 之結果須相同)
const ROUND_KEYS = ['status', 'fetcher', 'refetchSkip', 'formatRefetches', 'textFrom', 'rawAt', 'triage', 'skipKind', 'skipReason', 'summarizeTries', 'noteSlug']
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]))

/**
 * 抓取之補全文子階段之依賴(抓取器替身:瀏覽器以注入之 runCli;正文抓取器只記錄被呼叫——往返中不應走 curl)
 *
 * @param {Object} stores 輸入集合(docs、docTexts)
 * @param {String} tmp 輸入暫存目錄(瀏覽器階梯之選項檔)
 * @returns {Object} 回傳 { deps, cliCalls, articleCalls, runCli }
 */
function captureEnv(stores, tmp) {
    fs.mkdirSync(tmp, { recursive: true })
    const cliCalls = []
    const articleCalls = []
    const runCli = async (o) => {
        const opts = JSON.parse(fs.readFileSync(o.args[1], 'utf8'))
        const id = /example\.com\/(\w+)/.exec(o.args[0])[1]
        cliCalls.push({ id, steps: opts.steps })
        return { status: 'success', content: LONG(TITLE[id]), title: TITLE[id], method: 'playwright-headless', envBroken: [], steps: [{ step: opts.steps[0], ok: true }] }
    }
    const article = { id: 'article', retries: 0, retryDelayMs: 0, timeoutMs: 1000, fetch: async (d) => {
        articleCalls.push(d.id)
        return { ok: false, reason: 'http-error', message: '不應走正文抓取器', extra: { httpCode: 500 } }
    } }
    const browser = createBrowserFetcher({ runCli })
    const registry = { resolve: (role, d) => (d.fetcher === 'browser' ? browser : article), label: () => 'x' }
    const deps = { stores, registry, seen: { idOf: () => 'zz-unknown' }, settings: SETTINGS, clock: FIXED_CLOCK, dirs: { tmp } }
    return { deps, cliCalls, articleCalls, runCli }
}

describe('unit-summarize-material', function() {

    let root = ''
    before(() => {
        root = tmpRoot('summarize-material')
    })
    after(() => {
        resetConceptFold()
        removeRoots([root])
    })

    // 第一案之結果(第二案以之對照)
    const memResult = {}

    it('往返(子階段;記憶體集合):預篩判素材壞了 → 退回之 patch 即素材政策之產物(抓取端＋摘要自身之欄位;fetchTries 與正文不動)→ 抓取之佇列歸瀏覽器佇列、以排除之方法重抓(不前置 curl)→ raw(refetchSkip 清除)→ 下一輪預篩再取到:放行者成筆記、仍判素材壞了者達上限 skip(material)', async () => {
        const docs = memStore([docOf('a'), docOf('b')])
        const notes = memStore()
        const stores = { docs, docTexts: memStore(), notes, frontier: memStore() }
        let phase = 1
        // 預篩替身:依提示詞之標題作答(第一輪皆判素材壞了;第二輪 a 放行、b 仍判素材壞了)
        const triageAI = async (prompt) => ({ ok: true, data: titlesOf(prompt).map((t, i) => (phase === 2 && t === TITLE.a ? { index: i + 1, relevant: true, reason: '' } : { index: i + 1, relevant: false, reason: REASON })) })
        const summarizeAI = async (prompt) => ({ ok: true, data: titlesOf(prompt).map((t, i) => itemOf(i + 1, t)), providerId: 'p1' })
        const deps = { stores, clock: FIXED_CLOCK, settings: SETTINGS, dirs: { notes: `${root}/mem/notes` }, domains: { triage: createTriageDomain({ vocab: VOCAB }), summarize: createSummarizeDomain({ vocab: VOCAB }) } }
        const triage = () => stageTriage({ docsPerBatch: 2, parallel: 1, rounds: 1, callAI: triageAI }).run({ deps, log: recLog() })
        const before0 = { a: await docs.get('a'), b: await docs.get('b') }

        // ① 第一輪預篩:素材壞了 → 退回抓取(文件 patch ＝ 素材政策之產物)
        const r1 = await triage()
        assert.deepEqual([r1.detail.materialRefetch, r1.detail.irrelevant], [2, 0], '退回不計為攔下')
        const policy = createMaterialPolicy()
        for (const id of ['a', 'b']) {
            const want = policy.refetchPatchOf(before0[id], REASON, { nowIso: NOW, capture: SETTINGS.capture })
            assert.deepEqual(Object.keys(want).sort(), [...PATCH_KEYS].sort(), '前提:政策之產物恰為所列之欄位')
            assert.deepEqual(await docs.get(id), { ...before0[id], ...want }, `${id}:文件只改 patch 之欄位`)
            assert.deepEqual(pick(await docs.get(id), PATCH_KEYS), {
                status: 'new', fetcher: 'browser', lastClass: 'render', refetchSkip: ['curl'], deferredAt: NOW, lastReason: 'material', lastError: `摘要回報素材問題（亂碼）：${REASON}`,
                formatRefetches: 1, triage: null, triagedAt: null, triageTries: 0, summarizeTries: 0, skipReason: '',
            }, `${id}:退回之欄位`)
            assert.deepEqual([(await docs.get(id)).fetchTries, (await docs.get(id)).text], [1, GARBLED], `${id}:fetchTries 與正文不動`)
        }

        // ② 抓取側讀得到:佇列之分法歸瀏覽器佇列;補全文子階段以瀏覽器重抓、不用被排除之方法
        const q = docQueuesOf(await docs.select({ status: 'new' }), { nowMs: Date.parse(NOW), browserOn: true })
        assert.deepEqual([q.browser.map((d) => d.id).sort(), q.ready.map((d) => d.id)], [['a', 'b'], []], '瀏覽器佇列(不在補全文佇列)')
        const cap = captureEnv(stores, `${root}/mem/tmp`)
        const rc = await stageDetailFetch({ runCli: cap.runCli }).run({ deps: cap.deps, log: recLog() })
        assert.equal(rc.detail.filled, 2)
        assert.deepEqual(cap.cliCalls.map((c) => c.steps), [['playwright', 'camofox'], ['playwright', 'camofox']], '排除 curl:不前置 curl(否則原樣取回同一份素材)')
        assert.deepEqual(cap.articleCalls, [], '不走正文抓取器')

        // ③ 摘要側讀得到:raw、內文取得方式、refetchSkip 清除;摘要之欄位留存
        for (const id of ['a', 'b']) {
            const d = await docs.get(id)
            assert.deepEqual(pick(d, ['status', 'textFrom', 'refetchSkip', 'fetcher', 'rawAt', 'triage', 'formatRefetches', 'summarizeTries']), {
                status: 'raw', textFrom: 'browser:playwright-headless', refetchSkip: null, fetcher: '', rawAt: NOW, triage: null, formatRefetches: 1, summarizeTries: 0,
            }, `${id}:重抓後`)
            assert.ok(d.text.includes(TITLE[id]) && !d.text.includes('�'), `${id}:正文為重抓所得`)
        }

        // ④ 下一輪:預篩再取到兩篇;a 放行而成筆記,b 仍判素材壞了 → 已退回達上限,照常 skip(material)
        phase = 2
        const r2 = await triage()
        assert.deepEqual([r2.detail.processed, r2.detail.relevant, r2.detail.materialRefetch, r2.detail.irrelevant], [2, 1, 0, 1], JSON.stringify(r2.detail))
        const rs = await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, callAI: summarizeAI }).run({ deps, log: recLog() })
        assert.equal(rs.detail.notes, 1)
        const a = await docs.get('a')
        const b = await docs.get('b')
        const [note] = await notes.select({ docId: 'a' })
        assert.deepEqual([a.status, a.noteSlug, note?.title], ['noted', note?.id, `${TITLE.a}之重點`], '放行者成筆記')
        assert.ok(readMd(note.file).body.includes(`內文取得方式：${textFromLabelOf('browser:playwright-headless')}`), '來源章之內文取得方式為抓取套件之顯示名')
        assert.deepEqual([b.status, b.triage, b.skipKind, b.skipReason, b.formatRefetches], ['skip', 'irrelevant', SKIP_KIND_MATERIAL, `預篩：${REASON}`, 1], '達上限 → 照常 skip')
        memResult.a = pick(a, ROUND_KEYS)
        memResult.b = pick(b, ROUND_KEYS)
        memResult.note = note.title
    })

    it('往返(總組裝＋真 LMDB):兩輪 flow.run 與其間之抓取子階段走同一庫——退回時 refetchSkip 寫入、重抓後清除(深合併之集合)、第二輪成筆記與達上限 skip;往返後之欄位與記憶體集合之結果相同', async function() {
        assert.ok(memResult.a, '前提:前一案已跑')
        let phase = 1
        const ai = scriptedAi((role, prompt, callOpt, titles) => {
            if (role !== 'triage') return undefined
            return titles.map((t, i) => (phase === 2 && t === TITLE.a ? { index: i + 1, relevant: true, reason: '' } : { index: i + 1, relevant: false, reason: REASON }))
        })
        const { flow } = buildTestSummarize(`${root}/lmdb`, { aiAdapter: ai, capture: CAPTURE, clock: FIXED_CLOCK })
        await seedDocs(flow, [docOf('a'), docOf('b')])
        const rep1 = await flow.run()
        assert.equal(rep1.ok, true)
        await withStores(flow, async (s) => {
            for (const id of ['a', 'b']) assert.deepEqual(pick(await s.docs.get(id), ['status', 'fetcher', 'refetchSkip', 'formatRefetches', 'triage']), { status: 'new', fetcher: 'browser', refetchSkip: ['curl'], formatRefetches: 1, triage: null }, `${id}:退回之欄位(LMDB)`)
        })
        let cap = null
        await withStores(flow, async (s) => {
            cap = captureEnv(s, `${root}/lmdb/tmp-capture`)
            await stageDetailFetch({ runCli: cap.runCli }).run({ deps: cap.deps, log: recLog() })
        })
        assert.deepEqual([cap.cliCalls.length, cap.articleCalls], [2, []])
        phase = 2
        const rep2 = await flow.run()
        assert.equal(rep2.ok, true)
        await withStores(flow, async (s) => {
            const a = await s.docs.get('a')
            const b = await s.docs.get('b')
            const [note] = await s.notes.select({ docId: 'a' })
            assert.deepEqual({ a: pick(a, ROUND_KEYS), b: pick(b, ROUND_KEYS), note: note?.title }, memResult, '與記憶體集合之結果相同')
            assert.equal(a.refetchSkip, null, '重抓後 refetchSkip 已清除(深合併之集合以 null 清)')
        })
    })
})
