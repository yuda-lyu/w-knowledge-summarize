// unit-summarize-retag.test.mjs — 分類得要能擴充;分類器之調整與擴充要觸發既有知識之調整:重標子階段(stages/retagStage)與分類法之維運
//   (ops/taxonomyOps);分類法之純函數(版本、差異、連續改版、可採類別、狀態檔)另見 unit-summarize-stores
// 規則(出自兩檔檔頭與 JSDoc):
//   ①首次只記錄;改名 → 機械改 record(tagChangedAt)與 md;新增類別之 categoryRaw 恰為該類別者機械改(零 AI)、落點與關鍵詞相符者 AI 重判
//     (可維持原類別;非落點者之平移不採);退役類別 → AI 只能改選清單內者(2 次未成即略過並 WARN;有 holds 集合者登錄待判 SS9,使用者要求
//     重試 → 重排、類別回清單或筆記不在 → 結案);未宣告之移除 → 守門 WARN、資料不動;md 改寫失敗 → 記 mdStale、下輪修補
//   ②ctx 旗標 notesTagChanged＝本輪重標篇數之累計(同一管線之下游據以知本輪有重標);無重標之輪不設
//   ③時間:扣掉保留(opt.reserveMs:非負毫秒數或 (ctx) => 毫秒數;預設 0)後剩不到 5 分即延後(同步與守門照做、資料不動);每次 AI 呼叫以
//     「剩餘−保留」封頂;保留不合法即拋;停用即整段不跑
//   ④維運:狀態預覽唯讀(不寫狀態檔)、排入重判(類別不在清單即拋、不重複排入)、類別提案依篇數彙整
// 移植原實作之 unit-summarize-retag(145、164、201、219、251、267、280)各案(斷言不變;設定改本套件之 resolveSummarizeSettings、詞彙改
//   resolveSummarizeVocab;原 145 以關聯段之總覽子階段斷言旗標,改為斷言 ctx 上之旗標值〔不 import 他工作〕;原 267 之保留時間取自他工作之
//   設定,改由 opt.reserveMs 注入同一值〔900,000〕,斷言不變);③之保留時間各案為新增。
// 執行:自套件根 node <mocha> test/unit-summarize-retag.test.mjs(暫存 test/_tmp/summarize-retag-<pid>,測完即刪;AI 以替身)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memStore, requestRetry } from './tools/captureForTest.mjs'
import { recLog } from './tools/stageKit.mjs'
import { readMd, writeMd } from '../src/core/md/md.mjs'
import { holdKey } from '../src/core/capturePackage.mjs'
import { resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'
import { resolveSummarizeVocab } from '../src/core/vocab/summarizeVocab.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { createRetagDomain } from '../src/domain/retagDomain.mjs'
import { buildNote } from '../src/stores/noteBuild.mjs'
import { TAXONOMY_STATE_FILE, taxonomyOf, jobScope } from '../src/stores/taxonomy.mjs'
import { RETAG_HOLD_NEXT, putRetagHold, settleRetagHolds } from '../src/stores/noteHolds.mjs'
import { stageRetag } from '../src/stages/retagStage.mjs'
import { taxonomyStatus, requeueCategory, categoryProposals, proposalsOf } from '../src/ops/taxonomyOps.mjs'

const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/summarize-retag-${process.pid}`).replace(/\\/g, '/')
const NOW = '2026-10-04T10:00:00+08:00'
const clock = { iso8: () => NOW }
const BASE = { categories: ['方法', '風險', '其他'], claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] }
// 設定:併發 1(ai.parallel);重標各鍵(summarize.retag)沿用預設
const SETTINGS = resolveSummarizeSettings({ ai: { parallel: 1 } })

/** 以正式組裝(buildNote)寫出筆記 md 並入庫 */
function seedRetagNotes(dir, vocab, specs) {
    const domain = createSummarizeDomain({ vocab })
    const rows = specs.map((s, i) => {
        const k = { title: s.title, key_points: s.points || [`知識${i}`], concepts: s.concepts || ['概念'], summary: s.summary || `重點${i}`, category: s.category, claim_type: s.claimType || '實證研究', evidence_level: s.evidenceLevel || '中' }
        const n = buildNote({ k, doc: { id: `d${i}`, url: `https://example.com/${i}`, sourceName: 's' }, domain, notesDir: dir, nowIso: NOW })
        writeMd(n.file, n.front, n.body)
        return n.record
    })
    return memStore(rows)
}
/** 執行一輪重標(ctx 帶 bag;holds 給了才開待判集合,now 為本輪時刻;deps 為另加之每輪依賴) */
async function runRetag({ notes, vocab, dir, callAI, remainingMs = () => Infinity, opt = {}, holds = null, now = NOW, deps = {}, stamp }) {
    const bag = new Map()
    const logger = recLog()
    const ctx = {
        ...(stamp !== undefined ? { stamp } : {}), // 輪次 stamp(段內之 ctx.stamp;未給＝輪次外)
        deps: { stores: { notes, ...(holds ? { holds } : {}) }, settings: SETTINGS, dirs: { state: `${dir}/state` }, clock: now === NOW ? clock : { iso8: () => now }, ai: {}, domains: { retag: createRetagDomain({ vocab }) }, vocab: resolveSummarizeVocab(vocab), ...deps },
        log: logger,
        get: (k, f) => (bag.has(k) ? bag.get(k) : f),
        set: (k, v) => bag.set(k, v),
        remainingMs,
        expired: () => false,
    }
    const r = await stageRetag({ callAI, ...opt }).run(ctx)
    return { r, logger, bag, ctx }
}

describe('unit-summarize-retag', function() {

    before(() => fs.mkdirSync(TMP, { recursive: true }))
    after(() => fs.rmSync(TMP, { recursive: true, force: true }))

    describe('重標子階段(stageRetag)', () => {
        it('首輪只記錄;類別改名 → 機械改 record(tagChangedAt)與 md、ctx 旗標;內容類型改名 → md 品質章同步;旗標＝本輪重標篇數(無重標之輪不設)', async () => {
            const dir = `${TMP}/rename`
            const notes = seedRetagNotes(dir, BASE, [{ title: '甲', category: '方法' }, { title: '乙', category: '風險', claimType: '觀點評論' }])
            const r0 = await runRetag({ notes, vocab: BASE, dir })
            assert.deepEqual([r0.r.detail.initialized, r0.r.detail.changed, fs.existsSync(`${dir}/state/taxonomy.json`)], [true, 0, true])
            const v2 = { categories: ['方法論', '風險', '其他'], claimTypes: ['實證研究', '評論'], evidenceLevels: BASE.evidenceLevels, categoryRenames: { 方法: '方法論' }, claimTypeRenames: { 觀點評論: '評論' } }
            const r1 = await runRetag({ notes, vocab: v2, dir, callAI: async () => assert.fail('改名不呼叫 AI') })
            assert.deepEqual([r1.r.detail.mechChanged, r1.r.detail.jobsDone, r1.r.detail.jobsPending, r1.bag.get('notesTagChanged')], [2, 2, 0, 2], JSON.stringify(r1.r.detail))
            const by = Object.fromEntries((await notes.select()).map((n) => [n.title, n]))
            const [a, b] = [by['甲'], by['乙']]
            assert.deepEqual([a.category, a.tagChangedAt, b.claimType, b.category], ['方法論', NOW, '評論', '風險'])
            assert.equal(readMd(a.file).front.category, '方法論')
            const mb = readMd(b.file)
            assert.deepEqual([mb.front.claim_type, /- 內容類型：評論\n/.test(mb.body)], ['評論', true])
            // ctx 旗標(同一管線之下游據以知本輪有重標):本輪有重標 → 累計篇數;首輪(只記錄)→ 不設
            assert.deepEqual([r1.ctx.get('notesTagChanged', 0), r0.ctx.get('notesTagChanged', 0)], [2, 0])
        })

        it('新增類別:categoryRaw 恰為該類別者機械改(不進 AI);落點類別與關鍵詞相符者 AI 重判(可維持原類別);非落點者之平移不採;判過不重判', async () => {
            const dir = `${TMP}/add`
            const notes = seedRetagNotes(dir, BASE, [
                { title: '落點甲', category: '其他' },
                { title: '回撤控制乙', category: '方法' },
                { title: '無關丙', category: '方法' },
                { title: '提案丁', category: '其他' },
                { title: '回撤平移戊', category: '方法' },
                { title: '落點己', category: '其他' },
            ])
            await notes.patch((await notes.select({ title: '提案丁' }))[0].id, { categoryRaw: '風控' })
            await runRetag({ notes, vocab: BASE, dir })
            const v2 = { ...BASE, categories: [...BASE.categories, '風控'], categoryHints: { 風控: ['回撤'] } }
            const prompts = []
            // 乙 → 新類別;甲 → 維持落點;戊(非落點)→ 另一既有類別「風險」(平移,不採);己(落點)→ 既有類別「方法」(可)
            const answer = { 回撤控制乙: '風控', 落點甲: '其他', 回撤平移戊: '風險', 落點己: '方法' }
            const callAI = async (p) => {
                prompts.push(p)
                const titles = [...p.matchAll(/^\d+\. 【(.+?)】/gm)].map((m) => m[1])
                return { ok: true, data: titles.map((t, i) => ({ index: i + 1, category: answer[t] || '方法' })) }
            }
            const r1 = await runRetag({ notes, vocab: v2, dir, callAI })
            assert.equal(prompts.length, 1)
            assert.match(prompts[0], /本次分類清單新增了「風控」（相關關鍵詞：回撤）/)
            assert.match(prompts[0], /原類別為「其他」者，依分類清單擇一最合適之類別；原類別為清單中其他類別者，只在「風控」與原類別之間擇一/)
            assert.ok(['落點甲', '回撤控制乙', '回撤平移戊', '落點己'].every((t) => prompts[0].includes(t)) && !prompts[0].includes('提案丁') && !prompts[0].includes('無關丙'), prompts[0])
            assert.ok(prompts[0].includes('核心知識：'), 'prompt 帶核心知識前三條(讀 md)')
            const by = Object.fromEntries((await notes.select()).map((n) => [n.title, n]))
            assert.deepEqual([by['提案丁'].category, by['提案丁'].categoryRaw, by['回撤控制乙'].category, by['落點甲'].category, by['落點甲'].tagChangedAt], ['風控', null, '風控', '其他', undefined])
            assert.deepEqual([by['回撤平移戊'].category, by['回撤平移戊'].tagChangedAt, readMd(by['回撤平移戊'].file).front.category], ['方法', undefined, '方法'], '非落點者之平移不採')
            assert.equal(by['落點己'].category, '方法', '落點者可改歸既有類別')
            assert.deepEqual([r1.r.detail.mechChanged, r1.r.detail.aiJudged, r1.r.detail.aiChanged, r1.r.detail.aiKept, r1.r.detail.aiLateral, r1.r.detail.jobsDone], [1, 4, 2, 2, 1, 1], JSON.stringify(r1.r.detail))
            assert.ok(r1.logger.lines.some((l) => /本輪重標 3 篇（機械 1、AI 改 2／判 4；平移不採 1）/.test(l)), r1.logger.lines.join('\n'))
            const r2 = await runRetag({ notes, vocab: v2, dir, callAI: async () => assert.fail('已完成之工作不再呼叫 AI') })
            assert.equal(r2.r.detail.jobsPending, 0)
        })

        it('退役類別:AI 只能改選清單內者(清單外之回覆不採用、2 次未成即略過並 WARN);未宣告之移除 → 守門 WARN(含篇數)、資料不動', async () => {
            const dir = `${TMP}/retire`
            const notes = seedRetagNotes(dir, BASE, [{ title: '甲', category: '風險' }, { title: '乙', category: '風險' }])
            await runRetag({ notes, vocab: BASE, dir })
            const guard = await runRetag({ notes, vocab: { ...BASE, categories: ['方法', '其他'] }, dir })
            assert.ok(guard.logger.lines.some((l) => /^WARN 分類法守門：類別「風險」已自清單移除而未宣告去向（請於 vocab\.categoryRenames 或 categoryRetire 宣告），2 篇筆記維持原值不動/.test(l)), guard.logger.lines.join('\n'))
            assert.equal((await notes.select({ category: '風險' })).length, 2)
            const v3 = { ...BASE, categories: ['方法', '其他'], categoryRetire: ['風險'] }
            // 甲 → 清單內「方法」;乙 → 一律回清單外之「風險」(不採用):同輪下一輪次重試,失敗 2 次即略過
            const callAI = async (p) => ({ ok: true, data: [...p.matchAll(/^\d+\. 【(.+?)】/gm)].map((m, i) => ({ index: i + 1, category: m[1] === '甲' ? '方法' : '風險' })) })
            const r1 = await runRetag({ notes, vocab: v3, dir, callAI })
            assert.deepEqual([r1.r.detail.aiChanged, r1.r.detail.missed, r1.r.detail.jobsPending], [1, 2, 0], JSON.stringify(r1.r.detail))
            // 退役類別之略過＝留在清單外(無 holds 集合時只 WARN;有者登錄待判,見下一案)
            assert.ok(r1.logger.lines.some((l) => /^WARN 分類法：筆記 .+ 重判 2 次未成（模型未涵蓋或回覆不在清單），本工作略過之（仍在已退役之類別「風險」）/.test(l)), r1.logger.lines.join('\n'))
            const by = Object.fromEntries((await notes.select()).map((n) => [n.title, n.category]))
            assert.deepEqual(by, { 甲: '方法', 乙: '風險' }, '清單外之回覆不採用')
        })

        it('退役類別逾次未成 → 登錄待判 SS9(使用者;只 WARN 會使之無處可追);使用者 retry → 重排該類別之重判;類別回清單或筆記不在 → 自動結案', async () => {
            const dir = `${TMP}/retire-hold`
            const notes = seedRetagNotes(dir, BASE, [{ title: '甲', category: '風險' }, { title: '乙', category: '風險' }])
            const holds = memStore([])
            await runRetag({ notes, vocab: BASE, dir, holds })
            const v3 = { ...BASE, categories: ['方法', '其他'], categoryRetire: ['風險'] }
            const answer = (catOf) => async (p) => ({ ok: true, data: [...p.matchAll(/^\d+\. 【(.+?)】/gm)].map((m, i) => ({ index: i + 1, category: catOf(m[1]) })) })
            const r1 = await runRetag({ notes, vocab: v3, dir, holds, callAI: answer((t) => (t === '甲' ? '方法' : '風險')) })
            const yi = (await notes.select()).find((n) => n.title === '乙')
            const key = holdKey('note', yi.id, 'SS9')
            const h = await holds.get(key)
            assert.deepEqual([h.status, h.owner, h.std, h.ctx.category, h.next, r1.r.detail.holdsAdded], ['open', 'user', 'SS9', '風險', RETAG_HOLD_NEXT, 1])
            assert.match(h.reason, /^退役類別「風險」之重判 2 次未成（模型未涵蓋或回覆不在清單）：〈乙〉仍在已退役之類別$/)
            assert.ok(r1.logger.lines.some((l) => /^WARN 分類法：筆記 .+ 重判 2 次未成（模型未涵蓋或回覆不在清單），本工作略過之（仍在已退役之類別「風險」，已登錄待判 SS9）/.test(l)), r1.logger.lines.join('\n'))
            // 未要求重試:不重判、待判仍在
            const r2 = await runRetag({ notes, vocab: v3, dir, holds, now: '2026-10-04T11:00:00+08:00', callAI: async () => assert.fail('未要求重試不呼叫 AI') })
            assert.deepEqual([r2.r.detail.jobsRetried, (await holds.get(key)).status], [0, 'open'])
            // 使用者 retry → 本輪重排退役類別之重判(範圍只剩乙)而改到清單內;下一輪自動結案
            await requestRetry(holds, key, { at: '2026-10-04T11:30:00+08:00' })
            const r3 = await runRetag({ notes, vocab: v3, dir, holds, now: '2026-10-04T12:00:00+08:00', callAI: answer(() => '其他') })
            assert.deepEqual([r3.r.detail.jobsRetried, r3.r.detail.aiChanged, (await notes.get(yi.id)).category], [1, 1, '其他'], JSON.stringify(r3.r.detail))
            assert.ok(r3.logger.lines.some((l) => /^INFO 分類法：使用者要求重試，重排退役類別「風險」之重判（工作 rejudge:retire:風險）/.test(l)), r3.logger.lines.join('\n'))
            const r4 = await runRetag({ notes, vocab: v3, dir, holds, now: '2026-10-04T13:00:00+08:00' })
            const done = await holds.get(key)
            assert.deepEqual([r4.r.detail.holdsResolved, done.status, done.how], [1, 'resolved', '類別已在清單內（其他）'])
            // 筆記已不在 → 結案(純函數)
            const h2 = memStore([])
            await putRetagHold(h2, { id: 'gone', title: '丙' }, { category: '風險', why: 'x', fails: 2, nowIso: NOW })
            assert.deepEqual(await settleRetagHolds(h2, new Map(), ['方法'], { nowIso: NOW }), { resolved: 1, open: 0, retry: [] })
            assert.equal((await h2.get(holdKey('note', 'gone', 'SS9'))).how, '筆記已不存在')
        })

        it('md 改寫失敗:record 已改、記 mdStale、WARN;下輪依 record 現值修補', async () => {
            const dir = `${TMP}/stale`
            const notes = seedRetagNotes(dir, BASE, [{ title: '甲', category: '方法' }])
            await runRetag({ notes, vocab: BASE, dir })
            const [n] = await notes.select()
            fs.renameSync(n.file, `${n.file}.bak`) // md 暫時不在
            const v2 = { ...BASE, categories: ['方法論', '風險', '其他'], categoryRenames: { 方法: '方法論' } }
            const r1 = await runRetag({ notes, vocab: v2, dir })
            assert.deepEqual([(await notes.get(n.id)).category, r1.r.detail.mdFailed], ['方法論', 1])
            assert.ok(r1.logger.lines.some((l) => /^WARN 分類法：筆記 .+ 之 md 改寫失敗/.test(l)))
            fs.renameSync(`${n.file}.bak`, n.file)
            const r2 = await runRetag({ notes, vocab: v2, dir })
            assert.equal(r2.r.detail.mdRepaired, 1)
            assert.equal(readMd(n.file).front.category, '方法論')
        })

        it('退路之 domain:未給 deps.domains.retag → 以已解析之 deps.vocab 現建(優先);無則取 deps.data.vocab 中本套件所讀之鍵(他段之鍵不入工廠)', async () => {
            const dir = `${TMP}/fallback`
            const notes = seedRetagNotes(dir, BASE, [{ title: '落點甲', category: '其他' }])
            const v2 = { ...BASE, categories: ['方法', '風險', '風控', '其他'] }
            // 共用一份詞彙表之安裝方:原給之詞彙含他段之鍵(如關聯型別、他段之 guide)
            const shared = (v) => ({ ...v, relationTypes: ['相關'], guide: { relate: { vagueReason: 'x' } } })
            const ctxOf = (deps) => ({ deps: { stores: { notes }, settings: SETTINGS, dirs: { state: `${dir}/state` }, clock, ai: {}, ...deps }, log: recLog(), get: (k, f) => f, set: () => {} })
            await stageRetag().run(ctxOf({ data: { vocab: shared(BASE) } })) // 首次只記錄(取 data.vocab 之本套件之鍵)
            const prompts = []
            const callAI = async (p) => {
                prompts.push(p)
                return { ok: true, data: [{ index: 1, category: '風控' }] }
            }
            const r = await stageRetag({ callAI }).run(ctxOf({ data: { vocab: shared(v2) } }))
            assert.deepEqual([r.detail.jobsAdded, r.detail.aiChanged], [1, 1])
            assert.match(prompts[0], /^你是知識庫的分類器。[\s\S]*分類清單：方法、風險、風控、其他\n本次分類清單新增了「風控」/)
            // deps.vocab(已解析)優先於 data.vocab
            const r2 = await stageRetag().run(ctxOf({ vocab: resolveSummarizeVocab({ ...v2, categories: ['方法', '風險', '風控', '新類', '其他'] }), data: { vocab: shared(v2) } }))
            assert.equal(r2.detail.jobsAdded, 1, '以 deps.vocab 之分類法同步(新類)')
        })

        it('時間守門:剩餘 < 保留＋5 分 → 延後(同步與守門照做、資料不動);停用即整段不跑', async () => {
            const dir = `${TMP}/time`
            const notes = seedRetagNotes(dir, BASE, [{ title: '甲', category: '方法' }])
            await runRetag({ notes, vocab: BASE, dir })
            const v2 = { ...BASE, categories: ['方法論', '風險', '其他'], categoryRenames: { 方法: '方法論' } }
            const r = await runRetag({ notes, vocab: v2, dir, remainingMs: () => 900_000 + 299_000, opt: { reserveMs: 900_000 } })
            assert.deepEqual([r.r.detail.deferred, r.r.detail.jobsPending, (await notes.select())[0].category], [true, 1, '方法'])
            const off = await stageRetag({ enabled: false }).run({ deps: {}, log: recLog() })
            assert.equal(off.detail.disabled, true)
        })
    })

    describe('保留時間(opt.reserveMs):非負毫秒數或 (ctx) => 毫秒數;預設 0;開工門檻 5 分不變', () => {
        const v2 = { ...BASE, categories: ['方法論', '風險', '其他'], categoryRenames: { 方法: '方法論' } }
        /** 一篇待機械改名之環境(首輪只記錄) */
        const envOf = async (name) => {
            const dir = `${TMP}/reserve-${name}`
            const notes = seedRetagNotes(dir, BASE, [{ title: '甲', category: '方法' }])
            await runRetag({ notes, vocab: BASE, dir })
            return { dir, notes }
        }

        it('數字:剩餘 < 保留＋5 分 → 延後(日誌指保留時間,不指他工作);剩餘恰為保留＋5 分 → 開工', async () => {
            const a = await envOf('num-a')
            const r = await runRetag({ notes: a.notes, vocab: v2, dir: a.dir, remainingMs: () => 600_000 + 299_999, opt: { reserveMs: 600_000 } })
            assert.deepEqual([r.r.detail.deferred, r.r.detail.jobsPending, (await a.notes.select())[0].category], [true, 1, '方法'])
            assert.ok(r.logger.lines.includes('INFO 分類法：本輪剩餘時間不足（< 保留時間＋5 分），重標延後（待處理工作 1）'), r.logger.lines.join('\n'))
            const b = await envOf('num-b')
            const r2 = await runRetag({ notes: b.notes, vocab: v2, dir: b.dir, remainingMs: () => 600_000 + 300_000, opt: { reserveMs: 600_000 } })
            assert.deepEqual([r2.r.detail.deferred, r2.r.detail.mechChanged, (await b.notes.select())[0].category], [false, 1, '方法論'])
        })

        it('未給(或 null)＝0:只以 5 分為門檻;剩餘 4 分 59 秒 → 延後、5 分 → 開工', async () => {
            for (const [name, opt] of [['undef', {}], ['null', { reserveMs: null }]]) {
                const a = await envOf(`d-${name}-a`)
                const r = await runRetag({ notes: a.notes, vocab: v2, dir: a.dir, remainingMs: () => 299_000, opt })
                assert.equal(r.r.detail.deferred, true, name)
                const b = await envOf(`d-${name}-b`)
                const r2 = await runRetag({ notes: b.notes, vocab: v2, dir: b.dir, remainingMs: () => 300_000, opt })
                assert.deepEqual([r2.r.detail.deferred, r2.r.detail.mechChanged], [false, 1], name)
            }
        })

        it('函數:每輪以本輪之 ctx 求值;AI 呼叫之 budgetMs＝剩餘−保留', async () => {
            const dir = `${TMP}/reserve-fn`
            const notes = seedRetagNotes(dir, BASE, [{ title: '落點甲', category: '其他' }])
            await runRetag({ notes, vocab: BASE, dir })
            const seen = []
            const reserveMs = (ctx) => {
                seen.push(ctx)
                return 2_000_000
            }
            const budgets = []
            const callAI = async (p, c, o) => {
                budgets.push(o.budgetMs)
                return { ok: true, data: [{ index: 1, category: '風控' }] }
            }
            const r = await runRetag({ notes, vocab: { ...BASE, categories: ['方法', '風險', '風控', '其他'] }, dir, remainingMs: () => 5_000_000, callAI, opt: { reserveMs } })
            assert.equal(seen.length, 1)
            assert.equal(seen[0], r.ctx, '以本輪之 ctx 求值')
            assert.deepEqual([budgets, r.r.detail.aiChanged], [[3_000_000], 1])
            // 函數之值使剩餘不足 → 延後
            const b = await envOf('fn-defer')
            const r2 = await runRetag({ notes: b.notes, vocab: v2, dir: b.dir, remainingMs: () => 1_000_000, opt: { reserveMs: () => 800_000 } })
            assert.equal(r2.r.detail.deferred, true)
        })

        it('不合法:非非負有限數亦非函數 → 建構即拋;函數回傳不合法 → 該輪拋出', async () => {
            for (const bad of [-1, Number.NaN, Infinity, '900000', true, {}]) {
                assert.throws(() => stageRetag({ reserveMs: bad }), /stageRetag 之 opt\.reserveMs 須為非負毫秒數或 \(ctx\) => 毫秒數/, String(bad))
            }
            assert.doesNotThrow(() => stageRetag({ reserveMs: 0 }))
            const a = await envOf('bad-fn')
            await assert.rejects(() => runRetag({ notes: a.notes, vocab: v2, dir: a.dir, opt: { reserveMs: () => -5 } }), /stageRetag 之 opt\.reserveMs 函數須回傳非負毫秒數，收到 -5/)
        })

        it('每輪依賴之保留(ctx.deps.reserveMs;組裝者給一次,自組之管線亦適用):opt 未給(或 null)時取之(數字或函數);opt 明給者優先(含 0);不合法 → 該輪拋出', async () => {
            const a = await envOf('deps-a')
            const r = await runRetag({ notes: a.notes, vocab: v2, dir: a.dir, remainingMs: () => 600_000 + 299_999, deps: { reserveMs: 600_000 } })
            assert.deepEqual([r.r.detail.deferred, (await a.notes.select())[0].category], [true, '方法'])
            const b = await envOf('deps-b')
            const r2 = await runRetag({ notes: b.notes, vocab: v2, dir: b.dir, remainingMs: () => 600_000 + 300_000, opt: { reserveMs: null }, deps: { reserveMs: (ctx) => (ctx.deps ? 600_000 : -1) } })
            assert.deepEqual([r2.r.detail.deferred, r2.r.detail.mechChanged], [false, 1])
            const c = await envOf('deps-c')
            const r3 = await runRetag({ notes: c.notes, vocab: v2, dir: c.dir, remainingMs: () => 300_000, opt: { reserveMs: 0 }, deps: { reserveMs: 36_000_000 } })
            assert.deepEqual([r3.r.detail.deferred, r3.r.detail.mechChanged], [false, 1], 'opt 之 0 優先於依賴')
            const d = await envOf('deps-bad')
            await assert.rejects(() => runRetag({ notes: d.notes, vocab: v2, dir: d.dir, deps: { reserveMs: -1 } }), /stageRetag 之 deps\.reserveMs 須為非負毫秒數或 \(ctx\) => 毫秒數，收到 -1/)
        })
    })

    describe('維運(ops/taxonomyOps)', () => {
        it('status 唯讀預覽(不寫狀態檔);requeue 排入現行類別之重判(類別不在清單即拋);proposals 依篇數彙整 categoryRaw', async () => {
            const dir = `${TMP}/ops`
            const notes = seedRetagNotes(dir, BASE, [{ title: '甲', category: '其他' }, { title: '乙', category: '其他' }, { title: '丙', category: '方法' }])
            for (const n of await notes.select({ category: '其他' })) await notes.patch(n.id, { categoryRaw: n.title === '甲' ? '風控' : '另案' })
            await notes.patch((await notes.select({ title: '丙' }))[0].id, { categoryRaw: '風控' })
            const dirs = { state: `${dir}/state` }
            const vocab = resolveSummarizeVocab(BASE)
            const s = await taxonomyStatus({ stores: { notes }, dirs, vocab }, { nowIso: NOW })
            assert.deepEqual([s.initialized, s.jobs.length, fs.existsSync(`${dirs.state}/taxonomy.json`)], [true, 0, false])
            assert.throws(() => requeueCategory({ dirs, vocab }, '不存在'), /不在現行分類清單/)
            assert.deepEqual(requeueCategory({ dirs, vocab }, '其他', { nowIso: NOW }), { added: true, id: 'rejudge:requeue:其他' })
            assert.equal(requeueCategory({ dirs, vocab }, '其他', { nowIso: NOW }).added, false, '不重複排入')
            const s2 = await taxonomyStatus({ stores: { notes }, dirs, vocab }, { nowIso: NOW })
            assert.deepEqual(s2.jobs.map((j) => [j.id, j.ai]), [['rejudge:requeue:其他', 2]])
            const p = await categoryProposals({ notes })
            assert.deepEqual(p.map((x) => [x.raw, x.count]), [['風控', 2], ['另案', 1]])
            assert.deepEqual(jobScope({ kind: 'rejudge', reason: 'add', category: '風控', judged: [] }, await notes.select(), taxonomyOf({ ...vocab, categories: [...vocab.categories, '風控'] })).mechanical.length, 2)
        })

        it('狀態檔與重標子階段同一份(<state>/TAXONOMY_STATE_FILE);deps 不全即拋;proposalsOf 之 top／samples', async () => {
            const dir = `${TMP}/ops2`
            const notes = seedRetagNotes(dir, BASE, [{ title: '甲', category: '方法' }])
            const dirs = { state: `${dir}/state` }
            const vocab = resolveSummarizeVocab(BASE)
            requeueCategory({ dirs, vocab }, '方法', { nowIso: NOW })
            assert.ok(fs.existsSync(path.join(dirs.state, TAXONOMY_STATE_FILE)))
            // 子階段讀同一份狀態檔:維運排入之工作即本輪之待處理工作
            const r = await runRetag({ notes, vocab: BASE, dir, callAI: async (p) => ({ ok: true, data: [...p.matchAll(/^\d+\. 【(.+?)】/gm)].map((m, i) => ({ index: i + 1, category: '方法' })) }) })
            assert.deepEqual([r.r.detail.initialized, r.r.detail.aiJudged, r.r.detail.jobsDone], [false, 1, 1])
            await assert.rejects(() => taxonomyStatus({ stores: { notes } }), /taxonomyStatus 需要 \{ stores, dirs, vocab \}/)
            assert.throws(() => requeueCategory({ dirs }, '方法'), /requeueCategory 需要 \{ dirs, vocab \}/)
            const rows = [{ categoryRaw: '乙', title: '1' }, { categoryRaw: '甲', title: '2' }, { categoryRaw: '甲', title: '3' }, { categoryRaw: ' ', title: '4' }]
            assert.deepEqual(proposalsOf(rows, { top: 1, samples: 1 }), [{ raw: '甲', count: 2, samples: ['2'] }])
            assert.deepEqual(proposalsOf('x'), [])
        })
    })

    // ══════════════════════════ 產出鏈(stores/noteProduced;跨套件之產出鏈規格 §3、§4;使用端需求見 Gitea #107)══════════════════════════
    // 重標之 stage 依有無呼叫 AI 分兩值:機械改名與 categoryRaw 採納(不呼叫 AI)為 standards-fix、seat／provider 皆 null;AI 重判為 retag,帶席位(未設重標席即沿用摘要席 summarize.ai)、實際成交條目與 promptFp;
    //   成交條目未知(覆寫之 callAI 未回 providerId)不寫產出鏈;記錄與 md front matter 之純量鍵同時更新;md 修補(依記錄現值)亦同步純量鍵
    describe('產出鏈', () => {
        const STAMP = '20261108200009'
        const V2 = { categories: ['方法論', '風險', '其他'], claimTypes: ['實證研究', '觀點評論'], evidenceLevels: BASE.evidenceLevels, categoryRenames: { 方法: '方法論' } }
        const ADD = { ...BASE, categories: [...BASE.categories, '風控'], categoryHints: { 風控: ['回撤'] } }
        const frontProduced = (file) => Object.fromEntries(Object.entries(readMd(file).front).filter(([k]) => k.startsWith('produced')))

        it('機械改名:produced 之 seat／provider 為 null、stage standards-fix、stamp＝ctx.stamp、無 promptFp、歷史 +1(舊 produced 在前);md 之 produced_provider 移除', async () => {
            const dir = `${TMP}/prov-mech`
            const notes = seedRetagNotes(dir, BASE, [{ title: '甲', category: '方法' }])
            const old = { v: 1, stamp: '20261107100000', stage: 'summarize', seat: 'summarize.ai', provider: 'x:one', promptFp: '5118f8f40bf0dc40', pkg: 'w-knowledge-summarize@1.0.0', at: '2026-11-07T10:00:00+08:00' }
            const [n0] = await notes.select()
            await notes.patch(n0.id, { produced: old, producedHistory: [old], producedHistoryDropped: 0 })
            writeMd(n0.file, { ...readMd(n0.file).front, produced_stamp: old.stamp, produced_stage: 'summarize', produced_provider: 'x:one' }, readMd(n0.file).body)
            await runRetag({ notes, vocab: BASE, dir })
            const r = await runRetag({ notes, vocab: V2, dir, stamp: STAMP, callAI: async () => assert.fail('改名不呼叫 AI') })
            assert.equal(r.r.detail.mechChanged, 1)
            const [n] = await notes.select()
            assert.deepEqual(n.produced, { v: 1, stamp: STAMP, stage: 'standards-fix', seat: null, provider: null, pkg: n.produced.pkg, at: NOW })
            assert.match(n.produced.pkg, /^w-knowledge-summarize@\d+\.\d+\.\d+/)
            assert.deepEqual(n.producedHistory, [old, n.produced])
            assert.deepEqual(frontProduced(n.file), { produced_stamp: STAMP, produced_stage: 'standards-fix' }, '同輪 md 更新、舊 produced_provider 移除')
            assert.equal(readMd(n.file).front.category, '方法論')
        })

        it('輪次外(ctx 無 stamp):stamp 為 null、md 省略 produced_stamp;無產出鏈之舊筆記亦從頭起算(歷史 1 筆、不回填前史)', async () => {
            const dir = `${TMP}/prov-nostamp`
            const notes = seedRetagNotes(dir, BASE, [{ title: '甲', category: '方法' }])
            await runRetag({ notes, vocab: BASE, dir })
            await runRetag({ notes, vocab: V2, dir })
            const [n] = await notes.select()
            assert.deepEqual([n.produced.stamp, n.producedHistory.length, n.producedHistoryDropped], [null, 1, 0])
            assert.deepEqual(frontProduced(n.file), { produced_stage: 'standards-fix' })
        })

        it('AI 重判:seat 為 summarize.ai(重標席未設即沿用摘要席)、provider＝該批呼叫之成交條目(遞補時為遞補者)、promptFp 為 16 碼、stamp＝ctx.stamp;維持原類別者不寫(無改寫即無產出)', async () => {
            const dir = `${TMP}/prov-ai`
            const notes = seedRetagNotes(dir, BASE, [{ title: '回撤控制乙', category: '方法' }, { title: '落點甲', category: '其他' }])
            await runRetag({ notes, vocab: BASE, dir })
            const calls = []
            const callAI = async (p) => {
                calls.push(p)
                return { ok: true, providerId: 'fb:fallback-one', data: [...p.matchAll(/^\d+\. 【(.+?)】/gm)].map((m, i) => ({ index: i + 1, category: m[1] === '回撤控制乙' ? '風控' : '其他' })) }
            }
            const r = await runRetag({ notes, vocab: ADD, dir, stamp: STAMP, callAI })
            assert.deepEqual([r.r.detail.aiChanged, r.r.detail.aiKept, calls.length], [1, 1, 1], JSON.stringify(r.r.detail))
            const by = Object.fromEntries((await notes.select()).map((n) => [n.title, n]))
            const yi = by['回撤控制乙']
            assert.deepEqual([yi.category, yi.produced.stage, yi.produced.seat, yi.produced.provider, yi.produced.stamp], ['風控', 'retag', 'summarize.ai', 'fb:fallback-one', STAMP])
            // 本案之詞彙為未經解析之 plain 物件 → 重標角色之提示詞指紋算不出:省略 promptFp 並記一行 INFO(指紋是附記,不拖垮寫入);指紋有值之案見 unit-flow-summarize-provenance
            assert.equal('promptFp' in yi.produced, false)
            assert.equal(r.logger.lines.filter((l) => /^INFO 分類法：提示詞指紋算不出（retag：/.test(l)).length, 1, r.logger.lines.join('\n'))
            assert.deepEqual(frontProduced(yi.file), { produced_stamp: STAMP, produced_stage: 'retag', produced_provider: 'fb:fallback-one' }, 'md 之 produced_stage 同記錄')
            const jia = by['落點甲']
            assert.deepEqual([jia.produced, jia.producedHistory, Object.keys(frontProduced(jia.file))], [undefined, undefined, []], '維持原類別者不改寫、不寫產出鏈')
        })

        it('AI 重判之成交條目未知(覆寫之 callAI 未回 providerId):類別照改、tagChangedAt 照寫,但不寫產出鏈(寧缺勿假);md 之 front 不動產出鏈鍵', async () => {
            const dir = `${TMP}/prov-ai-unknown`
            const notes = seedRetagNotes(dir, BASE, [{ title: '回撤控制乙', category: '方法' }])
            await runRetag({ notes, vocab: BASE, dir })
            const callAI = async (p) => ({ ok: true, data: [...p.matchAll(/^\d+\. 【(.+?)】/gm)].map((m, i) => ({ index: i + 1, category: '風控' })) })
            await runRetag({ notes, vocab: ADD, dir, stamp: STAMP, callAI })
            const [n] = await notes.select()
            assert.deepEqual([n.category, n.tagChangedAt, 'produced' in n, 'producedHistory' in n], ['風控', NOW, false, false])
            assert.deepEqual(frontProduced(n.file), {})
            assert.equal(readMd(n.file).front.category, '風控')
        })

        it('md 改寫失敗(記錄已改)→ 下輪依記錄現值修補時,front 之 produced_* 純量鍵一併同步(md 為記錄之投影)', async () => {
            const dir = `${TMP}/prov-repair`
            const notes = seedRetagNotes(dir, BASE, [{ title: '甲', category: '方法' }])
            const [n0] = await notes.select()
            await runRetag({ notes, vocab: BASE, dir })
            fs.renameSync(n0.file, `${n0.file}.bak`) // md 暫時不在 → 改寫失敗
            const r1 = await runRetag({ notes, vocab: V2, dir, stamp: STAMP })
            assert.equal(r1.r.detail.mdFailed, 1)
            assert.equal((await notes.get(n0.id)).produced.stage, 'standards-fix', '記錄已寫產出鏈')
            fs.renameSync(`${n0.file}.bak`, n0.file)
            const r2 = await runRetag({ notes, vocab: V2, dir, stamp: '20261108210000' })
            assert.equal(r2.r.detail.mdRepaired, 1)
            const n = await notes.get(n0.id)
            assert.equal(n.producedHistory.length, 1, '修補 md 不追加歷史(只依記錄現值投影)')
            assert.deepEqual(frontProduced(n.file), { produced_stamp: STAMP, produced_stage: 'standards-fix' }, '同步為記錄現值(第一輪之 stamp,非修補輪之 stamp)')
            assert.equal(readMd(n.file).front.category, '方法論')
        })
    })
})
