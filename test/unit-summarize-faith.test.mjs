// unit-summarize-faith.test.mjs — 檢定標準 SS14(筆記忠實於原文)之摘要段接線(stages/noteStage 之 reviewItems;純函數與判定小組另見
//   unit-summarize-standards)
// 規則(出自 stages/noteStage【忠實性覆核】):
//   ①兩席判忠實 → 照常寫;兩席判不忠實 → 不寫、summarizeTries＋1、回饋附「筆記不忠實於原文」、記產出者之供應者
//   ②判不了 → 不寫、待判 pipeline(文件留 raw);再判不了 → 負責者 user、文件 faithHold、選池排除;使用者豁免 → 下輪不經覆核照常寫;
//     要求重試 → 解除排除;待判之下一步指本套件之處置 API(FAITH_HOLD_NEXT)
//   ③缺票 → 不寫、faithTries＋1(不動 summarizeTries);逾 summarize.standards.faithCheck.maxTries → 同判不了登錄待判;判定成立後既有待判結案
//   ④停用(預設)＝舊行為;開啟而缺第二席或 domain 缺提示詞 → 拋錯
// 移植原實作之 unit-summarize-faith(101、113、138、151)各案(斷言不變;設定改本套件之 resolveSummarizeSettings);②之下一步字樣為新增斷言。
// 執行:自套件根 node <mocha> test/unit-summarize-faith.test.mjs(暫存 test/_tmp/summarize-faith-<pid>,測完即刪;不連網)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memStore, waiveHold, requestRetry } from './tools/captureForTest.mjs'
import { recLog } from './tools/stageKit.mjs'
import { resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'
import { PANEL_UNSURE } from '../src/core/standards/panel.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { noteHoldDeadlineOf } from '../src/stores/noteHolds.mjs'
import { stageSummarize, FAITH_HOLD_NEXT } from '../src/stages/noteStage.mjs'

const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/summarize-faith-${process.pid}`).replace(/\\/g, '/')
const NOW = '2026-10-05T10:00:00+08:00'
const clock = { iso8: () => NOW }
const VOCAB = { categories: ['方法', '風險', '雜項'], fallbackCategory: '雜項' }
const domain = createSummarizeDomain({ vocab: VOCAB })
const NOTE = { title: '筆記甲', key_points: ['動量於美股有效'], concepts: ['動量', '因子'], summary: '動量於美股有效', category: '方法', claim_type: '實證研究', evidence_level: '中' }
const SEATS = { first: { use: 'f1' }, second: { use: 'f2' }, third: { use: 'f3' } }
const FAITH = { verdict: 'faithful', reason: '與原文相符' }
const UNF = { verdict: 'unfaithful', reason: '一句話重點寫成普遍成立，原文只限美股' }

/** 摘要段之替身:摘要呼叫回 NOTE;覆核呼叫(segment summarizeFaith)依席位回 by[seat](物件、'unsure'、'fail') */
const callAIOf = (by, calls = []) => async (prompt, check, o = {}) => {
    if (o.segment === 'summarizeFaith') {
        const seat = o.spec?.use
        calls.push(seat)
        const v = by[seat]
        if (v === 'fail' || v === undefined) return { ok: false, error: 'fail' }
        const idx = [...prompt.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => Number(m[1]))
        return { ok: true, providerId: `p-${seat}`, data: { checks: idx.map((index) => (v === PANEL_UNSURE ? { index, verdict: 'unsure' } : { index, ...v })) } }
    }
    calls.push('summarize')
    return { ok: true, providerId: 'p-sum', data: [{ index: 1, relevant: true, ...NOTE }] }
}
const envOf = (o = {}) => ({
    docs: memStore([{ id: 'd1', status: 'raw', title: '動量研究', url: 'https://example.com/m', sourceName: 's', sourceTier: 1, text: '以美股檢驗，動量於美股有效。', collectedAt: NOW }]),
    notes: memStore(),
    holds: memStore([]),
    // 本案之設定 summarize 段之覆寫:預篩關閉(直接摘要)、忠實性覆核開啟(o.faith 覆寫 enabled／maxTries)、判定小組席位(o.seats)
    summarize: { triage: { enabled: false }, standards: { faithCheck: { enabled: true, ...(o.faith || {}), ai: o.seats || SEATS } } },
})
const runOnce = async (env, by, calls = [], dir = 'n', so = {}) => {
    const log = recLog()
    const rep = await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, callAI: callAIOf(by, calls), ...so })
        .run({ deps: { stores: { docs: env.docs, notes: env.notes, frontier: memStore(), holds: env.holds }, settings: resolveSummarizeSettings({ summarize: env.summarize, capture: { browser: { perRun: 0 } } }), clock, dirs: { notes: `${TMP}/${dir}` }, domains: { summarize: domain } }, log })
    return { rep, log, calls }
}

describe('unit-summarize-faith', function() {

    before(() => fs.mkdirSync(TMP, { recursive: true }))
    after(() => fs.rmSync(TMP, { recursive: true, force: true }))

    it('摘要段:兩席判忠實 → 照常寫筆記;兩席判不忠實 → 不寫、summarizeTries＋1、回饋附「筆記不忠實於原文」、記產出者供應者', async () => {
        const e1 = envOf()
        const r1 = await runOnce(e1, { f1: FAITH, f2: FAITH }, [], 'ok')
        assert.equal((await e1.notes.select()).length, 1)
        assert.deepEqual([r1.rep.detail.faithChecked, r1.rep.detail.faithRejected, r1.calls], [1, 0, ['summarize', 'f1', 'f2']])
        const e2 = envOf()
        const r2 = await runOnce(e2, { f1: UNF, f2: UNF }, [], 'unf')
        const d = await e2.docs.get('d1')
        assert.deepEqual([(await e2.notes.select()).length, d.status, d.summarizeTries, /筆記不忠實於原文：一句話重點寫成普遍成立/.test(d.stdFeedback), d.summarizeProviders, r2.rep.detail.faithRejected], [0, 'raw', 1, true, 'p-sum', 1])
        assert.ok(r2.log.lines.some((l) => /^INFO 摘要忠實性覆核：〈動量研究〉兩席判不忠實於原文——不寫筆記/.test(l)), r2.log.lines.join('\n'))
    })

    it('摘要段:判不了 → 不寫、待判 pipeline(文件留 raw);再判不了 → 負責者 user、文件 faithHold、選池排除;使用者 waive → 下輪不經覆核照常寫;要求重試 → 解除排除', async () => {
        const e = envOf()
        const dis = { f1: FAITH, f2: PANEL_UNSURE, f3: PANEL_UNSURE }
        const r1 = await runOnce(e, dis, [], 'u1')
        const h1 = await e.holds.get('doc:d1:SS14')
        assert.deepEqual([(await e.notes.select()).length, h1?.owner, (await e.docs.get('d1')).faithHold || '', (await e.docs.get('d1')).summarizeTries || 0, r1.rep.detail.faithHeld], [0, 'pipeline', '', 0, 1])
        // 未成立原因之字樣取判定小組之字樣表(PANEL_WHY_LABELS;摘要、關聯、提煉同用)
        assert.match(h1.reason, /筆記忠實性覆核判不了（SS14；有席位不確定）：〈動量研究〉——/)
        // 下一步之字樣:首次為管線之下輪重判;期限與其餘待判同一常數
        assert.deepEqual([h1.next, h1.deadline], [FAITH_HOLD_NEXT.retry, noteHoldDeadlineOf(NOW)])
        await runOnce(e, dis, [], 'u2')
        const h2 = await e.holds.get('doc:d1:SS14')
        assert.deepEqual([h2.owner, h2.tries, (await e.docs.get('d1')).faithHold], ['user', 1, 'user'])
        // 再判不了:交使用者,下一步指本套件之處置 API(要求重試／豁免)
        assert.equal(h2.next, FAITH_HOLD_NEXT.user)
        const calls3 = []
        await runOnce(e, dis, calls3, 'u3')
        assert.deepEqual(calls3, [], '待使用者判讀者不入選')
        // 要求重試 → 解除排除(再判);仍判不了 → 又排除
        await requestRetry(e.holds, h2.id, { at: '2026-10-05T11:00:00+08:00' })
        const calls4 = []
        await runOnce(e, dis, calls4, 'u4')
        assert.deepEqual([calls4[0], (await e.docs.get('d1')).faithHold], ['summarize', 'user'])
        // 豁免 → 下輪不經覆核照常寫
        await waiveHold(e.holds, h2.id, { by: '使用者', ruling: '原文過短無從核對，照收', at: NOW })
        const calls5 = []
        const r5 = await runOnce(e, dis, calls5, 'u5')
        assert.deepEqual([calls5, (await e.notes.select()).length, r5.rep.detail.faithWaived, (await e.docs.get('d1')).faithWaived], [['summarize'], 1, 1, true])
    })

    it('摘要段:缺票(第二席失敗)→ 不寫、faithTries＋1(不動 summarizeTries);逾 summarize.standards.faithCheck.maxTries → 同判不了登錄待判;判定成立後既有待判結案', async () => {
        const e = envOf({ faith: { maxTries: 2 } })
        const miss = { f1: FAITH, f2: 'fail', f3: 'fail' }
        const r1 = await runOnce(e, miss, [], 'm1')
        assert.deepEqual([(await e.docs.get('d1')).faithTries, (await e.docs.get('d1')).summarizeTries || 0, r1.rep.detail.faithRetry, await e.holds.get('doc:d1:SS14')], [1, 0, 1, null])
        await runOnce(e, miss, [], 'm2')
        const h = await e.holds.get('doc:d1:SS14')
        assert.deepEqual([h?.owner, (await e.docs.get('d1')).faithTries], ['pipeline', 0])
        assert.match(h.reason, /覆核 2 次皆缺票或同一供應者/)
        const r3 = await runOnce(e, { f1: FAITH, f2: FAITH }, [], 'm3')
        assert.deepEqual([(await e.holds.get('doc:d1:SS14')).status, r3.rep.detail.faithResolved, (await e.notes.select()).length], ['resolved', 1, 1])
    })

    it('停用(預設)＝舊行為(不呼叫覆核席、detail 無覆核計數);開啟而缺第二席或 domain 缺提示詞 → 拋錯', async () => {
        const e = envOf({ faith: { enabled: false } })
        const r = await runOnce(e, {}, [], 'off')
        assert.deepEqual([r.calls, (await e.notes.select()).length, 'faithChecked' in r.rep.detail], [['summarize'], 1, false])
        // 訊息為功能表之格式(抓取套件之 featureProblemsOf;與執行期件之啟動期檢核同一字樣)
        await assert.rejects(() => runOnce(envOf({ seats: { first: SEATS.first } }), {}, [], 'x'), (e) => e.message === '筆記忠實性覆核(summarize.standards.faithCheck.enabled)已啟用,但缺席位 settings.summarize.standards.faithCheck.ai.second')
        const { buildFaithCheckPrompt: _drop, ...noFaith } = domain
        const calls = []
        await assert.rejects(() => runOnce(envOf(), {}, calls, 'y', { domain: noFaith }), (e) => e.message === '筆記忠實性覆核(summarize.standards.faithCheck.enabled)已啟用,但 domain 缺 buildFaithCheckPrompt')
        assert.deepEqual(calls, [], '拋錯在任何呼叫之前')
    })

    it('FAITH_HOLD_NEXT:凍結;使用者之下一步指本套件之待判處置 API(requestRetry、waiveHold),不指執行端之指令', () => {
        assert.ok(Object.isFrozen(FAITH_HOLD_NEXT))
        assert.equal(FAITH_HOLD_NEXT.retry, '下輪自動重摘並重判')
        assert.ok(FAITH_HOLD_NEXT.user.includes('requestRetry') && FAITH_HOLD_NEXT.user.includes('waiveHold'), FAITH_HOLD_NEXT.user)
        assert.doesNotMatch(FAITH_HOLD_NEXT.user, /standards\s+(holds|retry|waive)|CLI|指令/)
    })
})
