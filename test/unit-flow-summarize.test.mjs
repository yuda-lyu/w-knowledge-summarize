// unit-flow-summarize.test.mjs — 摘要之整合流程:總組裝於真 LMDB 上以替身 AI 跑兩輪(預篩、摘要、重標、同步)
// 規則(出自 createKnowledgeSummarize、summarizeObject 與各子階段之檔頭):
//   F1 第一輪:抓取交出之 raw 文件 → 預篩放行／攔下(skip「預篩：」)→ 摘要成筆記(md 落 <workDir>/knowledge/notes、記錄入 notes、文件 noted)、
//      判非知識者轉 skip 而仍收線索(skip:<id>)、未達標準者不納入(tries＋1、回饋、待判 pipeline);重標首輪只記錄分類法;同步回填雜湊
//   F2 固定格式摘要(對外契約)逐字;run.start.json 先宣告本輪上限、run.json 結構化落地;日誌檔之字樣
//   F3 第二輪(分類法新增類別、使用者改了筆記之一句話重點):未達標準者附回饋重摘而納入(其待判結案);落點類別之筆記經 AI 重標
//      (記錄 tagChangedAt、md 改寫);內容變更同步回記錄(knowledgeChangedAt);同一管線之 ctx 旗標 notesTagChanged／notesChanged
//      為本輪之篇數(跨套件之讀者以記錄欄為準)
//   F4 待探索線索寫入 frontier(知識文件 doc:<id>、略過文件 skip:<id>);分類法狀態檔與同步水位檔落 <workDir>/state
// 執行:自套件根 node <mocha> test/unit-flow-summarize.test.mjs(暫存 test/_tmp/flow-summarize-<pid>,測完即刪;不連網、不呼叫真 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { readMd, writeMd, summaryTextOf } from '../src/core/md/md.mjs'
import { stdReport } from '../src/core/capturePackage.mjs'
import { stageTriage } from '../src/stages/triageStage.mjs'
import { stageSummarize } from '../src/stages/noteStage.mjs'
import { stageRetag } from '../src/stages/retagStage.mjs'
import { stageSync } from '../src/stages/syncStage.mjs'
import { TAXONOMY_STATE_FILE } from '../src/stores/taxonomy.mjs'
import { NOTE_SYNC_STATE } from '../src/ops/syncNotes.mjs'
import { DOC_HOLD_NEXT } from '../src/stores/noteHolds.mjs'
import { SUMMARIZE_LOG_PARSE, SUMMARIZE_CTX_FLAGS } from '../src/logContract.mjs'
import {
    tmpRoot, removeRoots, resetConceptFold, rawDoc, itemOf, scriptedAi, buildTestSummarize, withStores, seedDocs, subReport, findFiles, readJsonFile, fileLogFactory,
} from './tools/summarizeTestKit.mjs'
import { sleep } from './tools/captureForTest.mjs'

const MIN = 60_000

describe('unit-flow-summarize', function() {

    this.timeout(120_000)

    let root = ''
    let round = 1
    let rep1 = null
    let rep2 = null
    let flow2 = null
    const probeSeen = []
    const V1 = { domain: '天文學' }
    const V2 = { domain: '天文學', categories: ['原理與概念', '方法與技術', '模型與演算法', '流程與實務', '工具與實作', '資料與指標', '評估與驗證', '風險與限制', '恆星物理', '其他'] }
    const SUMMARY_1 = '恆星光譜之分類依據'
    const SUMMARY_EDITED = '修訂：以吸收譜線判讀恆星類型'

    // 替身 AI:依角色與輪次作答(第一輪「殘缺之觀測紀錄」之項目只有一個概念 → 未達標準;第二輪附回饋重摘即合格)
    const ai = scriptedAi((role, prompt, o, ts) => {
        if (role === 'triage') return ts.map((t, i) => ({ index: i + 1, relevant: t !== '天文新聞快訊', reason: '例行新聞報導' }))
        if (role === 'summarize') {
            return ts.map((t, i) => {
                if (t === '星系巡天彙整') return { index: i + 1, relevant: false, reason: '連結彙整貼文', explore: [{ type: 'keyword', value: '巡天計畫', why: '彙整之題目值得追' }] }
                if (t === '殘缺之觀測紀錄' && round === 1) return itemOf(i + 1, t, { concepts: ['孤立概念'] })
                if (t === '恆星光譜分類方法') return itemOf(i + 1, t, { category: '其他', summary: SUMMARY_1, concepts: ['恆星光譜', '分類方法'], explore: [{ type: 'keyword', value: '光譜分析', why: '延伸主題' }] })
                return itemOf(i + 1, t)
            })
        }
        if (role === 'retag') return [...String(prompt).matchAll(/^(\d+)\. 【(.+?)】/gm)].map((m) => ({ index: Number(m[1]), category: m[2].startsWith('恆星光譜') ? '恆星物理' : '其他' }))
        return undefined
    })

    before(async () => {
        root = tmpRoot('flow-summarize')
        // ── 第一輪(預設子階段)──
        let flow1 = null
        ;({ flow: flow1 } = buildTestSummarize(root, { aiAdapter: ai, scheduleLimitMin: 55, data: { vocab: V1 }, summarize: { rounds: 1 }, logFactory: fileLogFactory(() => flow1) }))
        await seedDocs(flow1, [
            rawDoc('f1', { title: '恆星光譜分類方法' }),
            rawDoc('f2', { title: '天文新聞快訊', collectedAt: '2026-09-02T00:00:00+08:00' }),
            rawDoc('f3', { title: '星系巡天彙整', collectedAt: '2026-09-03T00:00:00+08:00' }),
            rawDoc('f4', { title: '殘缺之觀測紀錄', collectedAt: '2026-09-04T00:00:00+08:00' }),
        ])
        rep1 = await flow1.run()
        // ── 兩輪之間:使用者改了筆記之一句話重點;分類法新增類別 ──
        await withStores(flow1, async (s) => {
            const n = (await s.notes.select()).find((x) => x.docId === 'f1')
            const md = readMd(n.file)
            writeMd(n.file, md.front, md.body.replace(SUMMARY_1, SUMMARY_EDITED))
        })
        await sleep(1100) // 時間戳為秒級:兩輪之日誌、開工標記與執行摘要各一份
        round = 2
        // ── 第二輪(內建子階段＋觀察 ctx 旗標之自寫子階段;同一管線)──
        const probe = { name: 'probe', run: async (ctx) => {
            probeSeen.push({ tag: ctx.get('notesTagChanged', 0), changed: ctx.get('notesChanged', 0) })
            return stdReport()
        } }
        ;({ flow: flow2 } = buildTestSummarize(root, {
            aiAdapter: ai, scheduleLimitMin: 55, data: { vocab: V2 }, summarize: { rounds: 1 }, logFactory: fileLogFactory(() => flow2),
            stages: [stageTriage(), stageSummarize(), stageRetag(), stageSync(), probe],
        }))
        rep2 = await flow2.run()
    })

    after(() => {
        resetConceptFold()
        removeRoots([root])
    })

    const logText = (rep) => fs.readFileSync(rep.summaryFile.replace(/-run\.json$/, '-run.log'), 'utf8')

    it('F1 第一輪:預篩放行 3、攔下 1(轉 skip、理由「預篩：」);知識文件成筆記(md 落 knowledge/notes、記錄欄位、文件 noted 回鏈);判非知識者轉 skip(not-knowledge)', async () => {
        assert.equal(rep1.ok, true)
        const tri = subReport(rep1, '摘要', 'triage').detail
        assert.deepEqual([tri.processed, tri.relevant, tri.irrelevant], [4, 3, 1])
        await withStores(flow2, async (s) => {
            const f2 = await s.docs.get('f2')
            assert.deepEqual([f2.status, f2.triage, f2.skipKind, f2.skipReason], ['skip', 'irrelevant', 'triage', '預篩：例行新聞報導'])
            const f3 = await s.docs.get('f3')
            assert.deepEqual([f3.status, f3.skipKind, f3.skipReason], ['skip', 'not-knowledge', '連結彙整貼文'])
            const n1 = (await s.notes.select()).find((x) => x.docId === 'f1')
            assert.ok(n1, '恆星光譜分類方法之筆記')
            assert.equal(path.resolve(path.dirname(n1.file)), path.resolve(`${root}/knowledge/notes`))
            assert.equal(n1.sourceUrl, 'https://example.com/f1')
            assert.deepEqual([n1.title, n1.createdAt.length > 0, typeof n1.syncHash], ['恆星光譜分類方法之重點', true, 'string'])
            const f1 = await s.docs.get('f1')
            assert.deepEqual([f1.status, f1.noteSlug], ['noted', n1.id])
        })
    })

    it('F1 未達標準者不納入:tries＋1、回饋(stdFeedback)、待判 doc:<id>:SS2(負責者 pipeline、下輪附回饋重摘);第二輪附回饋重摘而納入,其待判結案', async () => {
        const sd1 = subReport(rep1, '摘要', 'summarize').detail
        assert.deepEqual([sd1.stdRejected, sd1.stdHeld, sd1.missed], [1, 1, 1])
        const summarizeCalls = ai.calls.filter((c) => c.role === 'summarize')
        assert.match(summarizeCalls.at(-1).prompt, /--- 第1篇 ---\n標題：殘缺之觀測紀錄\n.*\n.*\n（上次之輸出未達標準：[^）]*概念 1 個/, '第二輪之提示詞附上次之回饋')
        await withStores(flow2, async (s) => {
            const f4 = await s.docs.get('f4')
            assert.deepEqual([f4.status, f4.summarizeTries, f4.stdFeedback], ['noted', 1, ''], '納入後清回饋')
            const h = await s.holds.get('doc:f4:SS2')
            assert.equal(h.status, 'resolved')
            assert.equal(h.next, DOC_HOLD_NEXT.retry)
            assert.equal(h.owner, 'pipeline')
            assert.match(h.how, /^重摘後文件轉 noted（已納入）/)
        })
        assert.equal(subReport(rep2, '摘要', 'summarize').detail.stdHoldsResolved, 1)
    })

    it('F2 固定格式摘要(對外契約)逐字:第一輪附預篩、未達標準與入待判;部分失敗附「｜失敗 N」;第二輪附重標與內容變更', () => {
        assert.equal(rep1.stages[0].result.summary, '處理 2、新知識 1、略過 1、線索 2（AI 1 次）｜預篩 4 篇放行 3（AI 1 次）｜標準修正 0、未達標準 1｜入待判 1（轉使用者 0）｜失敗 1')
        assert.equal(rep2.stages[0].result.summary, '處理 1、新知識 1、略過 0、線索 0（AI 1 次）｜重標 1 篇（AI 1 次）｜內容變更 1 篇')
    })

    it('F2 開工標記先宣告本輪上限、執行摘要結構化落地(管線名、段、子階段、統計);兩輪各一份,時間戳與日誌檔同一個', () => {
        const starts = findFiles(`${root}/log`, '-run.start.json')
        const sums = findFiles(`${root}/log`, '-run.json')
        assert.deepEqual([starts.length, sums.length, findFiles(`${root}/log`, '-run.log').length], [2, 2, 2])
        const st = readJsonFile(starts[0])
        assert.deepEqual([st.limitMin, st.scheduleLimitMin, st.deadlineMs, st.lockStaleMs, st.pid], [55, 55, 49 * MIN, 60 * MIN, process.pid])
        assert.equal(path.basename(starts[0]).replace('-run.start.json', ''), path.basename(rep1.summaryFile).replace('-run.json', ''))
        const sum = readJsonFile(rep1.summaryFile)
        assert.deepEqual([sum.name, sum.ok, sum.lockSkipped, sum.stages.map((x) => x.name)], ['知識摘要', true, false, ['摘要']])
        assert.deepEqual(Object.keys(sum.stages[0].sub), ['triage', 'summarize', 'retag', 'sync'])
        assert.deepEqual([sum.stages[0].sub.summarize.detail.notes, sum.stages[0].sub.triage.detail.irrelevant], [1, 1])
        assert.equal(sum.stages[0].summary, rep1.stages[0].result.summary)
        assert.deepEqual(Object.keys(readJsonFile(rep2.summaryFile).stages[0].sub), ['triage', 'summarize', 'retag', 'sync', 'probe'])
    })

    it('F2 日誌檔之字樣:預篩攔下、新增筆記、略過並保留線索、分類法首次記錄、回填同步雜湊、段落完成行;第二輪之重標工作、本輪重標、筆記內容變更;積壓行可由日誌契約之正則解析', () => {
        const t1 = logText(rep1)
        for (const re of [
            /INFO\s+預篩：攔下\[天文新聞快訊\]（例行新聞報導）/,
            /INFO\s+摘要：新增知識筆記 恆星光譜分類方法之重點-[0-9a-f]{8}/,
            /INFO\s+摘要：略過\[星系巡天彙整\] → 保留線索 1 筆/,
            /INFO\s+分類法：首次記錄（版本 \w+；類別 9、內容類型 6、證據等級 3），既有筆記不重判/,
            /INFO\s+筆記同步：回填同步雜湊 1 篇（首見，不視為變更）/,
            /INFO\s+步驟1 摘要 完成：處理 2、新知識 1/,
        ]) assert.match(t1, re)
        assert.deepEqual([Number(t1.match(SUMMARIZE_LOG_PARSE.rawPool)[1]), Number(t1.match(SUMMARIZE_LOG_PARSE.processed)[1])], [subReport(rep1, '摘要', 'summarize').detail.pool, 2])
        const t2 = logText(rep2)
        for (const re of [
            /INFO\s+分類法：版本 \w+，排入重標工作——新增類別「恆星物理」（AI 重判）/,
            /INFO\s+分類法：本輪重標 1 篇（機械 0、AI 改 1／判 1），待處理工作 0/,
            /INFO\s+筆記內容變更：\[恆星光譜分類方法之重點-[0-9a-f]{8}\] 一句話重點已改，已同步回記錄（下游可依 knowledgeChangedAt 重判）/,
        ]) assert.match(t2, re)
    })

    it('F3 第二輪之重標:落點類別(其他)之筆記經 AI 改歸新增之類別——記錄之 category 與 tagChangedAt、md 之 frontmatter 同步改寫;他篇不動', async () => {
        const rt = subReport(rep2, '摘要', 'retag').detail
        assert.deepEqual([rt.jobsAdded, rt.aiJudged, rt.aiChanged, rt.jobsDone, rt.jobsPending, rt.changed], [1, 1, 1, 1, 0, 1])
        assert.deepEqual(ai.calls.filter((c) => c.role === 'retag').length, 1)
        await withStores(flow2, async (s) => {
            const notes = await s.notes.select()
            const n1 = notes.find((x) => x.docId === 'f1')
            assert.equal(n1.category, '恆星物理')
            assert.match(n1.tagChangedAt, /^\d{4}-\d{2}-\d{2}T/)
            assert.equal(readMd(n1.file).front.category, '恆星物理')
            const n4 = notes.find((x) => x.docId === 'f4')
            assert.deepEqual([n4.category, n4.tagChangedAt], ['方法與技術', undefined])
        })
    })

    it('F3 第二輪之同步:使用者改了一句話重點 → 記錄同步(summary、syncHash)並寫 knowledgeChangedAt;新筆記只回填雜湊', async () => {
        const sy = subReport(rep2, '摘要', 'sync').detail
        assert.deepEqual([sy.changed, sy.backfilled, sy.mdMissing], [1, 1, 0])
        await withStores(flow2, async (s) => {
            const n1 = (await s.notes.select()).find((x) => x.docId === 'f1')
            assert.equal(n1.summary, SUMMARY_EDITED)
            assert.equal(summaryTextOf(readMd(n1.file)), SUMMARY_EDITED)
            assert.match(n1.knowledgeChangedAt, /^\d{4}-\d{2}-\d{2}T/)
            const n4 = (await s.notes.select()).find((x) => x.docId === 'f4')
            assert.deepEqual([typeof n4.syncHash, n4.knowledgeChangedAt], ['string', undefined])
        })
    })

    it('F3 ctx 旗標限同一管線:同一輪之後段讀得到 notesTagChanged＝本輪重標篇數、notesChanged＝本輪內容變更篇數(跨套件以記錄欄 tagChangedAt／knowledgeChangedAt 為準);旗標名取 SUMMARIZE_CTX_FLAGS', () => {
        assert.deepEqual(probeSeen, [{ tag: 1, changed: 1 }])
        assert.deepEqual(SUMMARIZE_CTX_FLAGS, { tagChanged: 'notesTagChanged', contentChanged: 'notesChanged' })
    })

    it('F4 待探索線索:知識文件與略過文件之線索皆寫入 frontier(fromRef doc:<id>／skip:<id>);分類法狀態檔與同步水位檔落 <workDir>/state', async () => {
        await withStores(flow2, async (s) => {
            const clues = await s.frontier.select()
            const byValue = Object.fromEntries(clues.map((c) => [c.value, c]))
            assert.deepEqual(Object.keys(byValue).sort(), ['光譜分析', '巡天計畫'])
            assert.deepEqual([byValue['光譜分析'].type, byValue['光譜分析'].fromRef], ['keyword', 'doc:f1'])
            assert.equal(byValue['巡天計畫'].fromRef, 'skip:f3')
        })
        const tax = readJsonFile(`${root}/state/${TAXONOMY_STATE_FILE}`)
        assert.deepEqual(tax.history.map((h) => h.event), ['init', 'change', 'done'])
        assert.deepEqual([tax.jobs, tax.applied.categories.includes('恆星物理')], [[], true])
        assert.ok(Number.isFinite(readJsonFile(`${root}/state/${NOTE_SYNC_STATE}`).scannedAtMs))
    })

    it('F4 兩輪之 AI 呼叫:第一輪預篩 1 次、摘要 1 次;第二輪無待預篩者不呼叫預篩、摘要 1 次、重標 1 次;各陣列輸出之呼叫逐次給 acceptTruncated', () => {
        assert.deepEqual(ai.calls.map((c) => c.role), ['triage', 'summarize', 'summarize', 'retag'])
        for (const c of ai.calls) assert.equal(c.opt?.acceptTruncated, true, c.role)
        assert.ok(ai.calls.every((c) => c.spec && typeof c.spec.use === 'string'), '席位由子階段給(spec)')
        assert.match(ai.calls[0].prompt, /^你是「天文學」知識庫的預篩器/)
    })
})
