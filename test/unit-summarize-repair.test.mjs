// unit-summarize-repair.test.mjs — 欄位定向修補呼叫(檢定標準 SS2／SS4;summarize.standards.repair.enabled)之摘要段接線(stages/noteStage;
//   純函數另見 unit-summarize-standards)
// 規則(出自 stages/noteStage【欄位定向修補呼叫】):
//   P1 開啟時,過確定性閘後有 SS4 未紮根之行或 SS2 欄位問題 → 以同一摘要席(summarize.ai)發一次修補呼叫(domain.buildRepairPrompt)
//   P3 回覆只取被指出之欄位套回 → 再過同一閘;仍不合格照既有規則逐條移除／不納入;一輪為限
//   P4 統計 stdRepaired(修補後全數合格)／stdRepairFailed(呼叫失敗或仍有問題)
//   P5 關閉時行為與未開逐字相同(含提示詞;不呼叫修補)
//   P6 額度／時間用盡 → 本批不套用、不記 tries;開啟而 domain 缺 buildRepairPrompt → 拋錯;修補在忠實性覆核之前
//   P7 提示詞所寫之 value 形狀與套用端(standards/noteRepair 之 applyRepairs)逐類一致(10-07 評分題組 rp10 抓出:原寫「概念給字串陣列」,
//     單一概念之更正因形狀不合全數不採)
// 移植原實作之 unit-summarize-repair(119、132、143、151、161、170、177、183、190、198)各案(斷言不變;設定改本套件之 resolveSummarizeSettings)。
// 執行:自套件根 node <mocha> test/unit-summarize-repair.test.mjs(暫存 test/_tmp/summarize-repair-<pid>,測完即刪;替身 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memStore } from './tools/captureForTest.mjs'
import { recLog } from './tools/stageKit.mjs'
import { readMd } from '../src/core/md/md.mjs'
import { resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { stageSummarize } from '../src/stages/noteStage.mjs'
import { normalizeNoteItem } from '../src/standards/noteNormalize.mjs'
import { repairProblemsOf, applyRepairs } from '../src/standards/noteRepair.mjs'
import { resolveSummarizeVocab } from '../src/core/vocab/summarizeVocab.mjs'

const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/summarize-repair-${process.pid}`).replace(/\\/g, '/')
const NOW = '2026-10-05T10:00:00+08:00'
const clock = { iso8: () => NOW }
const VOCAB = { claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] }
const domain = createSummarizeDomain({ vocab: VOCAB })
const SRC = 'Taiwan momentum 12-1 earns 8.2% annual excess return over 2010-2024; Sharpe 0.71; costs 0.15%.'
const ITEM = (o = {}) => ({ index: 1, relevant: true, title: '動量因子之台股實證', summary: '台股動量年化超額 8.2%', key_points: ['年化超額 8.2%', '夏普 1.9'], concepts: ['動量因子', '回測'], claim_type: '實證研究', evidence_level: '中', ...o })
const SEAT = { use: 'claude:sonnet', fallback: ['muse'] }
/** 設定 summarize 段之覆寫:修補呼叫開啟(其餘沿用預設) */
const REPAIR_ON = { standards: { repair: { enabled: true } } }
let seq = 0

/**
 * 跑一次摘要段;替身 AI:摘要呼叫回 item,修補呼叫(segment summarizeRepair)回 repair(物件、函數或 'fail'／'skip'),覆核呼叫回忠實
 * @returns {Object} { rep, calls, docs, notes, holds, log }
 */
async function runOnce({ item, repair, summarize = {}, docs: docs0, domain: dom = domain } = {}) {
    const docs = docs0 || memStore([{ id: 'd1', status: 'raw', title: '動量研究', text: SRC, url: 'https://e.com/d1', sourceName: 's', sourceTier: 1, collectedAt: NOW }])
    const notes = memStore()
    const holds = memStore()
    const calls = []
    const callAI = async (prompt, check, o = {}) => {
        calls.push({ segment: o.segment || 'summarize', prompt, spec: o.spec })
        if (o.segment === 'summarizeRepair') {
            const r = typeof repair === 'function' ? repair(prompt) : repair
            if (r === 'fail') return { ok: false, error: '替身修補失敗', skipped: false }
            if (r === 'skip') return { ok: false, error: '額度用盡', skipped: true }
            return check(r) ? { ok: true, data: r, providerId: 'p-sum' } : { ok: false, error: '形狀不合', skipped: false }
        }
        if (o.segment === 'summarizeFaith') {
            const idx = [...prompt.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => Number(m[1]))
            return { ok: true, providerId: `p-${o.spec.use}`, data: { checks: idx.map((index) => ({ index, verdict: 'faithful', reason: '與原文相符' })) } }
        }
        return { ok: true, data: [item], providerId: 'p-sum' }
    }
    const log = recLog()
    const rep = await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, maxTries: 3, callAI })
        .run({ deps: { stores: { docs, notes, frontier: memStore(), holds }, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: false }, ai: SEAT, ...summarize }, capture: { browser: { perRun: 0 } } }), clock, dirs: { notes: `${TMP}/n${++seq}` }, domains: { summarize: dom } }, log })
    return { rep, calls, docs, notes, holds, log }
}
const noteBody = async (notes) => {
    const [n] = await notes.select()
    return n ? { n, md: readMd(n.file) } : null
}

describe('unit-summarize-repair', function() {

    before(() => fs.mkdirSync(TMP, { recursive: true }))
    after(() => fs.rmSync(TMP, { recursive: true, force: true }))

    it('P5 關閉(預設):不呼叫修補;未紮根之行照既有規則移除;摘要提示詞與明示 false 時逐字相同、detail 無修補計數', async () => {
        const a = await runOnce({ item: ITEM(), repair: () => assert.fail('關閉時不得呼叫修補') })
        const b = await runOnce({ item: ITEM(), repair: () => assert.fail('關閉時不得呼叫修補'), summarize: { standards: { repair: { enabled: false } } } })
        assert.deepEqual(a.calls.map((c) => c.segment), ['summarize'])
        assert.equal(a.calls[0].prompt, b.calls[0].prompt, '提示詞逐字相同')
        const { n, md } = await noteBody(a.notes)
        assert.ok(!md.body.includes('夏普 1.9') && n.stdFixes.some((x) => /移除含原文沒有之數字：key_points「夏普 1\.9」/.test(x)))
        assert.equal('stdRepaired' in a.rep.detail, false)
        // 關閉時未過閘者不收為項目(交遞補／未涵蓋落帳)——標題含原文沒有之數字 → 未涵蓋、tries＋1
        const c = await runOnce({ item: ITEM({ title: '動量年化 9.9%' }) })
        assert.deepEqual([c.rep.detail.missed, (await c.docs.get('d1')).summarizeTries], [1, 1])
    })

    it('P1／P3／P4 開啟:未紮根之行 → 同一摘要席之一次修補呼叫 → 只取被指出之處 → 同一閘合格 → 納入修補後之內容(stdRepaired、stdFixes 記修補)', async () => {
        const r = await runOnce({ item: ITEM(), repair: { repairs: [{ no: 1, value: '夏普值 0.71' }] }, summarize: REPAIR_ON })
        assert.deepEqual(r.calls.map((c) => c.segment), ['summarize', 'summarizeRepair'], '一輪為限:一次修補呼叫')
        assert.deepEqual(r.calls[1].spec, SEAT, '修補席＝摘要席(同一供應者鏈)')
        const { n, md } = await noteBody(r.notes)
        assert.ok(md.body.includes('- 夏普值 0.71') && !md.body.includes('夏普 1.9'))
        assert.ok(n.stdFixes.includes('修補呼叫：核心知識（第 2 行）「夏普 1.9」→「夏普值 0.71」'), JSON.stringify(n.stdFixes))
        assert.ok(!n.stdFixes.some((x) => /移除含原文沒有之數字/.test(x)), '修好者不再逐條移除')
        assert.deepEqual([r.rep.detail.stdRepaired, r.rep.detail.stdRepairFailed, r.rep.detail.notes], [1, 0, 1])
    })

    it('P3 修補後仍有未紮根者 → 照既有規則逐條移除(stdRepairFailed);修補回覆多給之欄位不採', async () => {
        const r = await runOnce({ item: ITEM(), repair: { repairs: [{ no: 1, value: '夏普 2.5' }], title: '模型多給之標題' }, summarize: REPAIR_ON })
        const { n, md } = await noteBody(r.notes)
        assert.ok(!md.body.includes('夏普 2.5') && n.stdFixes.some((x) => /移除含原文沒有之數字：key_points「夏普 2\.5」/.test(x)), JSON.stringify(n.stdFixes))
        assert.equal(n.title, ITEM().title)
        assert.deepEqual([r.rep.detail.stdRepaired, r.rep.detail.stdRepairFailed], [0, 1])
    })

    it('P1 標題含原文沒有之數字(未過閘)→ 開啟時仍收為項目並修補 → 合格納入;修補後仍不合格 → 不納入、tries＋1、回饋、待判(stdRepairFailed)', async () => {
        const ok = await runOnce({ item: ITEM({ title: '動量年化 9.9%', key_points: ['年化超額 8.2%'] }), repair: { repairs: [{ no: 1, value: '動量因子於台股之年化超額報酬' }] }, summarize: REPAIR_ON })
        const { n } = await noteBody(ok.notes)
        assert.deepEqual([n.title, ok.rep.detail.stdRepaired, (await ok.docs.get('d1')).status], ['動量因子於台股之年化超額報酬', 1, 'noted'])
        const bad = await runOnce({ item: ITEM({ title: '動量年化 9.9%', key_points: ['年化超額 8.2%'] }), repair: { repairs: [{ no: 1, value: '年化 9.9% 之動量' }] }, summarize: REPAIR_ON })
        const d = await bad.docs.get('d1')
        assert.deepEqual([(await bad.notes.select()).length, d.status, d.summarizeTries, /標題含原文沒有之數字/.test(d.stdFeedback), d.summarizeProviders], [0, 'raw', 1, true, 'p-sum'])
        assert.deepEqual([(await bad.holds.get('doc:d1:SS4'))?.owner, bad.rep.detail.stdRepairFailed, bad.rep.detail.stdRejected], ['pipeline', 1, 1])
    })

    it('P1 SS2 欄位(內容類型不在清單)→ 修補 → 合格納入', async () => {
        const r = await runOnce({ item: ITEM({ claim_type: '理論推導', key_points: ['年化超額 8.2%'] }), repair: (p) => {
            assert.match(p, /1\. 內容類型：「理論推導」——內容類型「理論推導」不在清單/)
            return { repairs: [{ no: 1, value: '實證研究' }] }
        }, summarize: REPAIR_ON })
        const { n } = await noteBody(r.notes)
        assert.deepEqual([n.claimType, r.rep.detail.stdRepaired], ['實證研究', 1])
    })

    it('P3 修補呼叫失敗 → 照既有規則(未紮根之行移除後納入;stdRepairFailed)', async () => {
        const r = await runOnce({ item: ITEM(), repair: 'fail', summarize: REPAIR_ON })
        const { n } = await noteBody(r.notes)
        assert.ok(n.stdFixes.some((x) => /移除含原文沒有之數字：key_points「夏普 1\.9」/.test(x)))
        assert.deepEqual([r.rep.detail.stdRepaired, r.rep.detail.stdRepairFailed], [0, 1])
    })

    it('P6 修補呼叫遇額度／時間用盡 → 本批不套用、不記 tries(留佇列)、報告 aborted', async () => {
        const r = await runOnce({ item: ITEM(), repair: 'skip', summarize: REPAIR_ON })
        const d = await r.docs.get('d1')
        assert.deepEqual([(await r.notes.select()).length, d.status, d.summarizeTries ?? 0, r.rep.detail.aborted], [0, 'raw', 0, true])
    })

    it('P1 無須修補者不呼叫;非知識項不呼叫', async () => {
        const r = await runOnce({ item: ITEM({ key_points: ['年化超額 8.2%'] }), repair: () => assert.fail('無問題不得呼叫'), summarize: REPAIR_ON })
        assert.deepEqual([r.calls.map((c) => c.segment), r.rep.detail.notes, r.rep.detail.stdRepaired], [['summarize'], 1, 0])
        const s = await runOnce({ item: { index: 1, relevant: false, reason: '非知識' }, repair: () => assert.fail('非知識不得呼叫'), summarize: REPAIR_ON })
        assert.equal((await s.docs.get('d1')).status, 'skip')
    })

    it('P6 修補在忠實性覆核之前:覆核所見為修補後之內容', async () => {
        const r = await runOnce({ item: ITEM(), repair: { repairs: [{ no: 1, value: '夏普值 0.71' }] }, summarize: { standards: { repair: { enabled: true }, faithCheck: { enabled: true, ai: { first: { use: 'f1' }, second: { use: 'f2' } } } } } })
        const faith = r.calls.filter((c) => c.segment === 'summarizeFaith')
        assert.equal(faith.length, 2)
        assert.ok(faith.every((c) => c.prompt.includes('- 夏普值 0.71') && !c.prompt.includes('夏普 1.9')))
        assert.equal((await r.notes.select()).length, 1)
    })

    it('P6 開啟而 domain 缺 buildRepairPrompt → 拋錯', async () => {
        const { buildRepairPrompt: _drop, ...noRepair } = domain
        await assert.rejects(() => runOnce({ item: ITEM(), domain: noRepair, summarize: REPAIR_ON }), /欄位定向修補呼叫\(summarize\.standards\.repair\.enabled\)已啟用,但 domain 缺 buildRepairPrompt/)
    })

    it('P7 提示詞所寫之 value 形狀與套用端逐類一致:概念之一個(標第 N 個)給字串或 null、概念整欄給字串陣列、清單之一行給字串 → 皆採用;概念之一個給陣列 → 不採(該處維持原值)', () => {
        const prompt = (k, problems) => domain.buildRepairPrompt({ material: SRC, item: k, problems })
        const RV = resolveSummarizeVocab(VOCAB)
        // ① 單一概念與清單之一行:概念「720p」、核心知識「夏普 1.9」之數字不見於原文
        const k1 = normalizeNoteItem(ITEM({ concepts: ['動量因子', '回測', '720p'] }), { vocab: RV }).item
        const ps1 = repairProblemsOf(k1, { vocab: RV, material: SRC })
        assert.deepEqual(ps1.map((p) => [p.kind, p.field]).sort(), [['concept', 'concepts'], ['line', 'key_points']])
        const p1 = prompt(k1, ps1)
        assert.match(p1, /概念（第 3 個）：「720p」/, '需更正之處標出第幾個概念')
        assert.match(p1, /清單之一行與概念之一個（標「第 N 個」者）給字串；概念整欄（只寫「概念」而未標第幾個者）給字串陣列；/)
        assert.match(p1, /清單之一行、參數表之一列或概念之一個無法依原文更正者，可刪除（value 給 null）/)
        const no = (kind) => ps1.findIndex((p) => p.kind === kind) + 1
        const byString = applyRepairs(k1, ps1, { repairs: [{ no: no('concept'), value: '動量策略' }, { no: no('line'), value: '夏普 0.71' }] })
        assert.deepEqual([byString.applied, byString.item.concepts, byString.item.key_points[1]], [2, ['動量因子', '回測', '動量策略'], '夏普 0.71'])
        const byNull = applyRepairs(k1, ps1, { repairs: [{ no: no('concept'), value: null }] })
        assert.deepEqual([byNull.applied, byNull.item.concepts], [1, ['動量因子', '回測']], '概念之一個給 null → 刪除')
        const byArray = applyRepairs(k1, ps1, { repairs: [{ no: no('concept'), value: ['動量因子', '回測'] }] })
        assert.deepEqual([byArray.applied, byArray.item.concepts], [0, ['動量因子', '回測', '720p']], '概念之一個給陣列 → 不採(形狀不合;提示詞因此須寫明給字串)')
        // ② 概念整欄(個數不足):給字串陣列 → 採用
        const k2 = normalizeNoteItem(ITEM({ concepts: ['動量因子'] }), { vocab: RV }).item
        const ps2 = repairProblemsOf(k2, { vocab: RV, material: SRC }).filter((p) => p.kind === 'concepts')
        assert.equal(ps2.length, 1)
        assert.match(prompt(k2, ps2), /\n1\. 概念：/, '整欄之稱呼不標第幾個')
        const whole = applyRepairs(k2, ps2, { repairs: [{ no: 1, value: ['動量因子', '截面報酬'] }] })
        assert.deepEqual([whole.applied, whole.item.concepts], [1, ['動量因子', '截面報酬']])
    })
})
