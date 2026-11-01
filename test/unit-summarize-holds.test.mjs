// unit-summarize-holds.test.mjs — 摘要之不納入:待判、終態與重開(摘要子階段之待判接線 stages/noteStage、重開 ops/reviveFailed)
// 規則(出自 stages/noteStage【待判】與 ops/reviveFailed 檔頭;不納入、待條件成立後重送者一律登錄,不得靜默遺失):
//   R3-1 閘判不納入(驗證不合格、gateNote 不合格)→ 待判 doc／主要標準／pipeline／「下輪附回饋重摘」／期限(stores/noteHolds 之單一常數)
//   R3-2 改判他標準 → 舊標準之待判結案、新標準登錄(同一文件只留一筆未結之閘門待判)
//   R3-3 逾 maxTries 轉 summarize-failed → 該待判改 user(重開或豁免);AI 失敗之終態亦把未結待判轉 user;SS14 不忠實之終態另登錄(每次不登錄)
//   R3-4 納入(或文件轉離 raw)→ 未結之閘門待判結案
//   R3-5 各家輸出皆未過閘而整批失敗 → 以閘之原因落帳(回饋、待判),截斷等其他整批失敗照舊「摘要批次失敗」
//   R3-6 本批驗證之原因每批清空(同一輪後續 round 不沿用前批之判定)
//   R3-7 未開 holds 集合 → WARN 一次、不拋、tries 照記
//   R3b 重開:預設預演;apply → raw、tries 0、原文自另存回填、revivedFrom、待判結案(結案方式指本套件之 reviveFailedDocs);無原文者不重開;只動 summarize-failed
// 移植原實作之 unit-summarize-holds 各案(65、86、99、113、126、147、168、175;斷言不變——唯 R3b 之結案方式字樣隨面向使用者之字樣通用化改指
//   本套件之 API〔原「使用者重開（revive-failed）…」→「使用者重開（reviveFailedDocs）…」〕,比對之嚴格度不變;設定改本套件之
//   resolveSummarizeSettings)。
// 執行:自套件根 node <mocha> test/unit-summarize-holds.test.mjs(暫存 test/_tmp/summarize-holds-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memStore, archiveDocText } from './tools/captureForTest.mjs'
import { recLog } from './tools/stageKit.mjs'
import { putHold } from '../src/core/capturePackage.mjs'
import { resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { DOC_HOLD_NEXT } from '../src/stores/noteHolds.mjs'
import { stageSummarize } from '../src/stages/noteStage.mjs'
import { reviveFailedDocs } from '../src/ops/reviveFailed.mjs'

const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/summarize-holds-${process.pid}`).replace(/\\/g, '/')
const NOW = '2026-10-05T10:00:00+08:00'
const clock = { iso8: () => NOW }
const VOCAB = { claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] }
const domain = createSummarizeDomain({ vocab: VOCAB })
const SRC = 'Taiwan momentum 12-1 earns 8.2% annual excess return over 2010-2024; costs 0.15%.'
const ITEM = (o = {}) => ({ index: 1, relevant: true, title: '動量因子之台股實證', summary: '台股動量年化超額 8.2%', key_points: ['年化超額 8.2%'], concepts: ['動量因子', '回測'], claim_type: '實證研究', evidence_level: '中', ...o })
/** 設定:預篩關閉(直接摘要)、瀏覽器分流關閉;summarize 為本案對設定 summarize 段之覆寫 */
const settingsOf = (summarize = {}) => resolveSummarizeSettings({ summarize: { triage: { enabled: false }, ...summarize }, capture: { browser: { perRun: 0 } } })
const doc = (id, o = {}) => ({ id, status: 'raw', title: '動量研究', text: SRC, url: `https://e.com/${id}`, sourceName: 's', sourceTier: 1, collectedAt: `2026-09-01T00:00:0${id.length}+08:00`, ...o })
let seq = 0
/** 執行一次摘要段(替身 AI:依網址取該篇之回覆;'fail' → 呼叫失敗) */
const runOnce = async (env, byId, o = {}) => {
    const log = recLog()
    const callAI = async (p, check) => {
        const ids = [...p.matchAll(/^網址：https:\/\/e\.com\/(\S+)$/gm)].map((m) => m[1])
        const data = ids.map((id, i) => (byId[id] === 'skip' ? { index: i + 1, relevant: false, reason: '非知識' } : (byId[id] ? { ...byId[id], index: i + 1 } : null))).filter(Boolean)
        if (ids.some((id) => byId[id] === 'fail')) return { ok: false, error: '替身失敗', skipped: false }
        // honorCheck:比照正式之調度層——回覆不過 check 即該家失敗(遞補用盡 → 整批失敗)
        if (o.honorCheck && !check(data)) return { ok: false, error: 'OUTPUT_VALIDATION_FAILED', skipped: false }
        return { ok: true, data, providerId: 'p1' }
    }
    const stores = { docs: env.docs, notes: env.notes, frontier: memStore(), ...(env.holds ? { holds: env.holds } : {}) }
    const rep = await stageSummarize({ docsPerBatch: 1, parallel: o.parallel || 1, rounds: o.rounds || 1, maxTries: 3, callAI })
        .run({ deps: { stores, settings: settingsOf(), clock, dirs: { notes: `${TMP}/n${++seq}` }, domains: { summarize: domain } }, log })
    return { rep, log }
}
const envOf = (docs, o = {}) => ({ docs: memStore(docs), notes: memStore(), holds: o.noHolds ? null : memStore() })

describe('unit-summarize-holds', function() {

    before(() => fs.mkdirSync(TMP, { recursive: true }))
    after(() => fs.rmSync(TMP, { recursive: true, force: true }))

    it('R3-1 驗證不合格(SS2)→ 待判 doc／SS2／pipeline／下輪附回饋重摘／期限 30 天;R3-2 改判 SS4(gate 致命)→ 舊者結案、新者登錄;R3-3 逾限 → user(重開或豁免)', async () => {
        const e = envOf([doc('a')])
        await runOnce(e, { a: ITEM({ concepts: ['甲'] }) })
        let h = await e.holds.get('doc:a:SS2')
        assert.deepEqual([h.status, h.owner, h.next, h.deadline], ['open', 'pipeline', DOC_HOLD_NEXT.retry, new Date(Date.parse(NOW) + 30 * 86400_000).toISOString()])
        assert.match(h.reason, /^摘要未達檢定標準（SS2）：〈動量研究〉未達檢定標準：概念 1 個/)
        // 第二次:改為標題含原文沒有之數字(SS4)→ SS2 結案、SS4 登錄
        await runOnce(e, { a: ITEM({ title: '動量年化 9.9%' }) })
        h = await e.holds.get('doc:a:SS2')
        assert.deepEqual([h.status, h.how], ['resolved', '重摘後改判 SS4'])
        assert.equal((await e.holds.get('doc:a:SS4'))?.owner, 'pipeline')
        // 第三次仍不合格 → summarize-failed;SS4 待判改 user,下一步「重開或豁免」
        const r3 = await runOnce(e, { a: ITEM({ title: '動量年化 9.9%' }) })
        const d = await e.docs.get('a')
        assert.deepEqual([d.status, d.summarizeTries], ['summarize-failed', 3])
        const h4 = await e.holds.get('doc:a:SS4')
        assert.deepEqual([h4.status, h4.owner, h4.next, h4.tries], ['open', 'user', DOC_HOLD_NEXT.user, 1])
        assert.match(h4.reason, /已試 3 次，轉 summarize-failed$/)
        assert.ok(r3.rep.detail.stdHeld >= 1)
    })

    it('R3-1(gateNote)落地前不合格(SS6 擠標籤未拆)→ 待判 SS6;R3-4 之後納入 → 結案(how 記已納入);判非知識 → 結案', async () => {
        const e = envOf([doc('b'), doc('cc')])
        await runOnce(e, { b: ITEM({ concepts: ['新奇甲、新奇乙', '動量'] }), cc: ITEM({ concepts: ['新奇丙、新奇丁', '動量'] }) }, { parallel: 2 })
        assert.equal((await e.holds.get('doc:b:SS6'))?.status, 'open')
        assert.equal((await e.holds.get('doc:cc:SS6'))?.status, 'open')
        const r = await runOnce(e, { b: ITEM(), cc: 'skip' }, { parallel: 2 })
        const hb = await e.holds.get('doc:b:SS6')
        assert.deepEqual([hb.status, hb.how, (await e.docs.get('b')).status], ['resolved', '重摘後文件轉 noted（已納入）', 'noted'])
        const hc = await e.holds.get('doc:cc:SS6')
        assert.deepEqual([hc.status, hc.how], ['resolved', '重摘後文件轉 skip'])
        assert.equal(r.rep.detail.stdHoldsResolved, 2)
    })

    it('R3-3 AI 失敗之終態:未結之閘門待判轉 user(記其後轉 summarize-failed);無待判者不登錄', async () => {
        const e = envOf([doc('f', { summarizeTries: 1 }), doc('g', { summarizeTries: 2 })])
        await putHold(e.holds, { object: 'doc', oid: 'f', std: 'SS4', reason: '摘要未達檢定標準（SS4）：〈動量研究〉…', next: DOC_HOLD_NEXT.retry, owner: 'pipeline', deadline: '2026-11-04T00:00:00.000Z' }, NOW)
        await runOnce(e, { f: 'fail' })
        assert.equal((await e.docs.get('f')).summarizeTries, 2, '非終態不轉')
        assert.equal((await e.holds.get('doc:f:SS4')).owner, 'pipeline')
        await runOnce(e, { f: 'fail' })
        const h = await e.holds.get('doc:f:SS4')
        assert.deepEqual([(await e.docs.get('f')).status, h.owner, h.next], ['summarize-failed', 'user', DOC_HOLD_NEXT.user])
        assert.match(h.reason, /｜其後轉 summarize-failed（摘要批次失敗/)
        await runOnce(e, { g: 'fail' })
        assert.deepEqual([(await e.docs.get('g')).status, (await e.holds.select()).filter((x) => x.oid === 'g').length], ['summarize-failed', 0], 'AI 失敗而無待判者不登錄')
    })

    it('R3-5 各家輸出皆未過納入閘而整批失敗 → 以閘之原因落帳(lastError／回饋／待判);截斷等整批失敗照舊「摘要批次失敗」', async () => {
        const e = envOf([doc('h', { summarizeTries: 2 })])
        const r = await runOnce(e, { h: ITEM({ concepts: ['甲'] }) }, { honorCheck: true })
        const d = await e.docs.get('h')
        assert.deepEqual([d.status, /^未達檢定標準：概念 1 個（須 2～6）（各家輸出皆未過納入閘）$/.test(d.lastError), /概念 1 個/.test(d.stdFeedback)], ['summarize-failed', true, true], d.lastError)
        assert.equal((await e.holds.get('doc:h:SS2'))?.owner, 'user')
        assert.deepEqual([r.rep.detail.stdRejected, r.rep.detail.failedBatches], [1, 1])
        const e2 = envOf([doc('i')])
        await runOnce(e2, { i: 'fail' })
        const i = await e2.docs.get('i')
        assert.deepEqual([i.summarizeTries, i.stdFeedback ?? '', (await e2.holds.select()).length], [1, '', 0], '非閘門之整批失敗不附回饋、不登錄')
    })

    it('R3-6 本批驗證原因每批清空:前一 round 未過閘之篇,下一 round 未被涵蓋 → 記「未被模型完整涵蓋」(不沿用前批之閘門原因)', async () => {
        const e = envOf([doc('j'), doc('kk')])
        let call = 0
        const byRound = async () => {
            call++
            return call <= 2 ? { j: ITEM({ concepts: ['甲'] }), kk: ITEM() } : {}
        }
        // 第一 round:j 未過閘(待判 SS2)、kk 納入(有進度);第二 round:j 之回覆缺席
        const log = recLog()
        const callAI = async (p) => {
            const m = await byRound()
            const ids = [...p.matchAll(/^網址：https:\/\/e\.com\/(\S+)$/gm)].map((x) => x[1])
            return { ok: true, data: ids.map((id, i) => (m[id] ? { ...m[id], index: i + 1 } : null)).filter(Boolean), providerId: 'p1' }
        }
        await stageSummarize({ docsPerBatch: 1, parallel: 2, rounds: 2, maxTries: 3, callAI })
            .run({ deps: { stores: { docs: e.docs, notes: e.notes, frontier: memStore(), holds: e.holds }, settings: settingsOf(), clock, dirs: { notes: `${TMP}/r36` }, domains: { summarize: domain } }, log })
        const j = await e.docs.get('j')
        assert.deepEqual([j.summarizeTries, call], [2, 3], '兩個 round 各記一次(第二 round 只 j 一批)')
        assert.equal((await e.holds.get('doc:j:SS2')).tries, 0, '第二次為未涵蓋(AI 失敗),不以前批之閘門原因再登錄(否則 tries 為 1)')
    })

    it('R3-3 SS14 不忠實:非終態不登錄(保留 SS14 判不了之兩段式流程);終態 → 待判 doc／SS14／user(重開或豁免)', async () => {
        const e = envOf([doc('p', { summarizeTries: 2 }), doc('q')])
        const UNF = { verdict: 'unfaithful', reason: '一句話重點寫成普遍成立，原文只限台股' }
        const callAI = async (p, check, o = {}) => {
            if (o.segment === 'summarizeFaith') {
                const idx = [...p.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => Number(m[1]))
                return { ok: true, providerId: `p-${o.spec.use}`, data: { checks: idx.map((index) => ({ index, ...UNF })) } }
            }
            return { ok: true, providerId: 'p-sum', data: [ITEM()] }
        }
        const run = () => stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, maxTries: 3, callAI })
            .run({ deps: { stores: { docs: e.docs, notes: e.notes, frontier: memStore(), holds: e.holds }, settings: settingsOf({ standards: { faithCheck: { enabled: true, ai: { first: { use: 'f1' }, second: { use: 'f2' } } } } }), clock, dirs: { notes: `${TMP}/f${++seq}` }, domains: { summarize: domain } }, log: recLog() })
        await run() // q(tries 0)先入選:不忠實 → tries 1、無 SS14 待判
        assert.deepEqual([(await e.docs.get('q')).summarizeTries, await e.holds.get('doc:q:SS14')], [1, null])
        await e.docs.patch('q', { status: 'skip' }) // 讓 p 入選
        await run()
        const h = await e.holds.get('doc:p:SS14')
        assert.deepEqual([(await e.docs.get('p')).status, h?.owner, h?.next], ['summarize-failed', 'user', DOC_HOLD_NEXT.user])
        assert.match(h.reason, /^摘要未達檢定標準（SS14）：〈動量研究〉未達檢定標準：SS14 筆記不忠實於原文/)
    })

    it('R3-7 未開 holds 集合 → WARN 一次、不拋;tries 與回饋照記', async () => {
        const e = envOf([doc('m'), doc('nn')], { noHolds: true })
        const { log } = await runOnce(e, { m: ITEM({ concepts: ['甲'] }), nn: ITEM({ concepts: ['乙'] }) }, { parallel: 2 })
        assert.equal(log.lines.filter((l) => /^WARN 摘要：未開 holds 集合/.test(l)).length, 1)
        assert.deepEqual([(await e.docs.get('m')).summarizeTries, /概念 1 個/.test((await e.docs.get('m')).stdFeedback)], [1, true])
    })

    it('R3b 重開(reviveFailedDocs):預設預演不寫;apply → raw、tries 歸零、原文自 docTexts 回填、revivedFrom、待判(閘門與 SS14)結案;無原文者不重開;非 summarize-failed 不動', async () => {
        const docs = memStore([
            { id: 'x', status: 'summarize-failed', url: 'https://e.com/x', title: '甲', text: '', feedText: '', summarizeTries: 3, faithTries: 2, lastError: '未達檢定標準：標題含原文沒有之數字（9.9%）', stdFeedback: '標題含原文沒有之數字（9.9%）', summarizeProviders: 'p1' },
            { id: 'y', status: 'summarize-failed', url: 'https://e.com/y', title: '乙', text: '尚未瘦身之原文', summarizeTries: 3, lastError: '摘要批次失敗（輸出截斷／驗證不過）' },
            { id: 'z', status: 'summarize-failed', url: 'https://e.com/z', title: '丙', text: '', summarizeTries: 3, lastError: '摘要批次失敗' },
            { id: 'w', status: 'raw', url: 'https://e.com/w', title: '丁', text: 't', summarizeTries: 1 },
        ])
        const docTexts = memStore()
        assert.equal((await archiveDocText(docTexts, { id: 'x', text: '另存之原文', feedText: 'feed', status: 'summarize-failed', title: '甲', url: 'https://e.com/x' }, NOW)).ok, true)
        const holds = memStore()
        await putHold(holds, { object: 'doc', oid: 'x', std: 'SS4', reason: 'r', next: DOC_HOLD_NEXT.user, owner: 'user' }, NOW)
        await putHold(holds, { object: 'doc', oid: 'x', std: 'SS14', reason: 'r', next: DOC_HOLD_NEXT.user, owner: 'user' }, NOW)
        const stores = { docs, docTexts, holds }
        const dry = await reviveFailedDocs(stores, { match: () => true, nowIso: NOW })
        assert.deepEqual([dry.apply, dry.failed, dry.matched, dry.revived, dry.noText.map((x) => x.id)], [false, 3, 3, 0, ['z']])
        assert.equal((await docs.get('x')).status, 'summarize-failed', '預演不寫')
        const r = await reviveFailedDocs(stores, { match: (d) => d.id !== 'y', nowIso: NOW, apply: true })
        assert.deepEqual([r.matched, r.revived, r.holdsResolved, r.noText.map((x) => x.id)], [2, 1, 2, ['z']])
        const x = await docs.get('x')
        assert.deepEqual([x.status, x.summarizeTries, x.faithTries, x.text, x.feedText, x.lastError, x.revivedAt, x.revivedFrom, x.stdFeedback, x.summarizeProviders],
            ['raw', 0, 0, '另存之原文', 'feed', '', NOW, '未達檢定標準：標題含原文沒有之數字（9.9%）', '標題含原文沒有之數字（9.9%）', 'p1'])
        assert.deepEqual([(await holds.get('doc:x:SS4')).status, (await holds.get('doc:x:SS14')).status], ['resolved', 'resolved'])
        assert.match((await holds.get('doc:x:SS4')).how, /^使用者重開（reviveFailedDocs）：狀態回 raw、tries 歸零、原文自 docTexts 回填$/)
        assert.equal((await docs.get('z')).status, 'summarize-failed', '無原文者不重開')
        const r2 = await reviveFailedDocs(stores, { match: (d) => d.id === 'y', nowIso: NOW, apply: true })
        assert.deepEqual([r2.revived, (await docs.get('y')).status, (await docs.get('y')).text], [1, 'raw', '尚未瘦身之原文'], 'docs 未瘦身者不覆寫原文')
        assert.deepEqual([(await docs.get('w')).status, (await docs.get('w')).summarizeTries], ['raw', 1], '非 summarize-failed 不動')
        await assert.rejects(() => reviveFailedDocs(stores, {}), /reviveFailedDocs 需要 match/)
        await assert.rejects(() => reviveFailedDocs({}, { match: () => true }), /reviveFailedDocs 需要 stores\.docs/)
    })
})
