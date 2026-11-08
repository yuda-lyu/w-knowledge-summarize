// unit-summarize-stages.test.mjs — 摘要物件之子階段:預篩(stages/triageStage)與摘要(stages/noteStage)之接線;各 AI 呼叫點之逐次截斷放行
// 規則(出自兩檔檔頭與 JSDoc):
//   ①預篩:放行標 relevant、攔下轉 skip(skipReason「預篩：」)、未涵蓋記 tries、失敗達上限放行(fail-open);第二席確認(SS5)之兩席確認／推翻／
//     不一致／同一供應者;確認席關閉之終止路徑;素材問題退回抓取(不計 irrelevant);停用即整段不跑;opt 非物件視為{}
//   ②摘要:選池順序(tries→tier→FIFO)、只取已放行者、批次失敗與未涵蓋計 fail、逾時間預算不開工;納入閘(修得好照收並記 stdFixes、修不好者
//     不納入、tries＋1、回饋、末次換家、重試耗盡轉 summarize-failed);SS11(詞彙表之證據規則)與 SS6(既有概念)之接線;既有筆記不覆寫;
//     逐項鏈異常不標終態;依字數打包與截斷明示;素材問題退回抓取;清單外類別;與人工匯入同一組裝;無預篩結果之 WARN
//   ③陣列輸出之呼叫(摘要、預篩、預篩確認、重標)每次給 acceptTruncated:true;物件輸出之修補與忠實性覆核不給;avoid 只在摘要
// 移植原實作之 unit-stages(130、161、180、223、254、461、480、500)、unit-check-stages(47、56、70、87、105)、unit-summarize-material
//   (152、167)、unit-summarize-long(106、141 之子階段部分)、unit-summarize-notes(52、81、96)、unit-standards-gate(193、208、249、269、286)各案
//   (斷言不變;設定改本套件之 resolveSummarizeSettings,詞彙改本套件之解析;SS11 相關之案給回中立題材之規則 NEUTRAL_RULE;composeChain 改以
//   抓取套件之 runChainOverMsgs 執行同一鏈,「未短路」以 halts 為空斷言);③為新增。
// 執行:自套件根 node <mocha> test/unit-summarize-stages.test.mjs(暫存 test/_tmp/summarize-stages-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memStore, nullLogger, genClockTZ, DEFAULT_DEDUP } from './tools/captureForTest.mjs'
import { recLog, bagCtx, NEUTRAL_RULE } from './tools/stageKit.mjs'
import { defineMw, makeMsg, runChainOverMsgs, sha1, captureIdentityOf } from '../src/core/capturePackage.mjs'
import { readMd, writeMd } from '../src/core/md/md.mjs'
import { resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { createRetagDomain } from '../src/domain/retagDomain.mjs'
import { checkNote } from '../src/standards/noteStandards.mjs'
import { buildNote } from '../src/stores/noteBuild.mjs'
import { mwSettleTriage, stageTriage } from '../src/stages/triageStage.mjs'
import { mwSaveClues, mwRenderNote, stageSummarize } from '../src/stages/noteStage.mjs'
import { stageRetag } from '../src/stages/retagStage.mjs'
import { ingestNotes } from '../src/ops/ingestNotes.mjs'
import { resolveSummarizeVocab } from '../src/core/vocab/summarizeVocab.mjs'

const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/summarize-stages-${process.pid}`).replace(/\\/g, '/')
const log = nullLogger()
const clock = genClockTZ('Asia/Taipei')

describe('unit-summarize-stages', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ══════════════════════════ 預篩(stages/triageStage)══════════════════════════
    describe('預篩子階段(triageStage)', function() {

        it('stageTriage:opt 非物件視為{},不拋錯;有效輸入(停用預篩)行為不變', async () => {
            const bad = stageTriage('not-object')
            assert.equal(typeof bad.run, 'function')

            const stage = stageTriage({ enabled: false })
            const r = await stage.run({ deps: { settings: resolveSummarizeSettings({}) }, log })
            assert.equal(r.detail.disabled, true)
        })

        it('mwSettleTriage:讀 doc/_aiItem/_domain,落帳 stores.docs,恆呼叫 next(JSDoc 所述行為之最小驗證)', async () => {
            const docs = memStore([{ id: 'd1', title: 'A' }])
            const mw = mwSettleTriage()
            const msg = makeMsg('doc', { doc: { id: 'd1', title: 'A' }, _aiItem: { relevant: true }, _domain: { reasonOf: () => '' } })
            const ctx = { deps: { stores: { docs }, clock }, log }
            const rr = await runChainOverMsgs({ chain: [mw], ctx, msgs: [msg] })
            assert.deepEqual([rr.halts, rr.fails], [{}, 0], '未短路(halted 為空)')
            assert.equal((await docs.get('d1')).triage, 'relevant')
        })

        it('退路之 domain:未給 opt.domain 與 deps.domains.triage → 以已解析之 deps.vocab 現建(優先);無則取 deps.data.vocab 中本套件所讀之鍵(他段之鍵不入工廠)', async () => {
            // 共用一份詞彙表之安裝方:原給之詞彙含他段之鍵(如關聯型別、他段之 guide)
            const shared = { domain: '天文學', relationTypes: ['相關'], guide: { relate: { vagueReason: 'x' } } }
            const prompts = []
            const callAI = async (p) => {
                prompts.push(p)
                return { ok: true, data: [{ index: 1, relevant: true }] }
            }
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: true } } })
            const docsOf = () => memStore([{ id: 'a', status: 'raw', title: 'A', text: 'x', collectedAt: '2026-06-01' }])
            const r = await stageTriage({ docsPerBatch: 1, parallel: 1, rounds: 1, callAI }).run({ deps: { stores: { docs: docsOf() }, clock, settings, data: { vocab: shared } }, log })
            assert.equal(r.detail.relevant, 1)
            assert.match(prompts[0], /^你是「天文學」知識庫的預篩器/)
            await stageTriage({ docsPerBatch: 1, parallel: 1, rounds: 1, callAI }).run({ deps: { stores: { docs: docsOf() }, clock, settings, vocab: resolveSummarizeVocab({ domain: '地質學' }), data: { vocab: shared } }, log })
            assert.match(prompts[1], /^你是「地質學」知識庫的預篩器/, 'deps.vocab 優先於 data.vocab')
        })

        it('預篩攔下之第二席確認(檢定標準 SS5):預篩席判無關 → 待確認(記供應者);確認席同判 → 攔下(兩席確認);推翻 → 第三席裁定相關 → 放行;不一致 → 放行交摘要;同一供應者 → 留待下輪', async () => {
            const docs = memStore([
                { id: 'a', status: 'raw', title: 'A 體育新聞', text: 'x', collectedAt: '2026-06-01' },
                { id: 'b', status: 'raw', title: 'B 動量研究', text: 'y', collectedAt: '2026-06-02' },
                { id: 'c', status: 'raw', title: 'C 模糊', text: 'z', collectedAt: '2026-06-03' },
            ])
            const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: true }, standards: { triageConfirm: { enabled: true, ai: { first: { use: 'cf' }, third: { use: 'cf3' } } } } } }) }
            const titles = (p) => p.split('\n').filter(Boolean)
            const domain = {
                buildPrompt: async (batch) => batch.map((d) => d.title).join('\n'),
                isValidItem: (it, n) => !!it && Number.isInteger(it.index) && it.index >= 1 && it.index <= n && typeof it.relevant === 'boolean',
                reasonOf: (it) => it.reason || '無關',
            }
            // 預篩席:三篇皆判無關;確認席:A 無關、B 相關、C 相關;第三席:B 相關、C 無關(與預篩席同 → 成立無關?預篩席判無關＋第三席無關 → 成立)
            const answer = { triage: { A: false, B: false, C: false }, cf: { A: false, B: true, C: true }, cf3: { B: true, C: false } }
            const calls = []
            const callAI = async (prompt, check, co) => {
                const seat = co?.segment === 'triageConfirm' ? co.spec.use : 'triage'
                calls.push(seat)
                const ts = typeof prompt === 'string' ? titles(prompt) : titles(await prompt)
                return { ok: true, providerId: seat === 'triage' ? 'p-triage' : `p-${seat}`, data: ts.map((t, i) => ({ index: i + 1, relevant: answer[seat][t[0]], reason: '與知識庫無關之內容' })) }
            }
            const r = await stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, callAI: async (p, c, o) => callAI(await p, c, o) }).run({ deps, log })
            assert.deepEqual(calls, ['triage', 'cf', 'cf3'])
            const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((id) => docs.get(id)))
            assert.deepEqual([a.status, a.triage, /（兩席確認）$/.test(a.skipReason)], ['skip', 'irrelevant', true], '兩家皆判無關 → 攔下')
            assert.deepEqual([b.status, b.triage], ['raw', 'relevant'], '確認席與第三席皆判相關(不同家)→ 推翻、放行')
            assert.deepEqual([c.status, c.triage], ['skip', 'irrelevant'], '預篩席＋第三席皆判無關 → 成立攔下')
            assert.deepEqual([r.detail.rejectPending, r.detail.confirmed, r.detail.overturned, r.detail.confirmUndetermined], [3, 2, 1, 0])
            // 不一致(第三席不確定 → 缺 → 本案以無第三席之設定驗):確認席判相關、無第三席 → 不一致 → 放行交摘要
            const docs2 = memStore([{ id: 'x', status: 'raw', title: 'X', text: 'x', collectedAt: '2026-06-01' }])
            const deps2 = { ...deps, stores: { ...deps.stores, docs: docs2 }, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: true }, standards: { triageConfirm: { enabled: true, ai: { first: { use: 'cf' } } } } } }) }
            const ans2 = async (p, c2, o) => ({ ok: true, providerId: o?.segment === 'triageConfirm' ? 'p-cf' : 'p-triage', data: [{ index: 1, relevant: o?.segment === 'triageConfirm', reason: '與知識庫無關之內容' }] })
            const log2 = recLog()
            const r2 = await stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, callAI: ans2 }).run({ deps: deps2, log: log2 })
            assert.deepEqual([(await docs2.get('x')).triage, r2.detail.confirmUndetermined], ['relevant', 1])
            // 未成立原因之字樣取判定小組之字樣表(PANEL_WHY_LABELS):不一致 → 「各席裁決不一致」
            assert.equal((await docs2.get('x')).lastError, '預篩攔下之第二席確認判不了（各席裁決不一致），放行交摘要（與知識庫無關之內容）')
            assert.ok(log2.lines.includes('INFO 預篩：放行[X]（預篩席判無關而判定小組判不了（各席裁決不一致），交摘要再判）'), log2.lines.join('\n'))
            // 同一供應者(確認席遞補收斂到預篩席同家)→ 留待下輪(仍 reject-pending、記 tries)
            const docs3 = memStore([{ id: 'y', status: 'raw', title: 'Y', text: 'y', collectedAt: '2026-06-01' }])
            const ans3 = async () => ({ ok: true, providerId: 'p-same', data: [{ index: 1, relevant: false, reason: '與知識庫無關之內容' }] })
            const r3 = await stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, maxTries: 3, callAI: ans3 }).run({ deps: { ...deps2, stores: { ...deps.stores, docs: docs3 } }, log })
            const y = await docs3.get('y')
            assert.deepEqual([y.status, y.triage, y.triageConfirmTries, r3.detail.confirmRetry], ['raw', 'reject-pending', 1, 1])
        })

        it('預篩 SS5 之確認席被略過(額度、時間預算、本機網路不通 → skipped)即中止、不記次:第一席略過 → 本批不判;第三席略過 → 須第三席之篇留待下輪(tries 不變),兩席已定者照常落帳,其後之批次不再呼叫(同忠實性覆核)', async () => {
            const domain = {
                buildPrompt: async (batch) => batch.map((d) => d.title).join('\n'),
                isValidItem: (it, n) => !!it && Number.isInteger(it.index) && it.index >= 1 && it.index <= n && typeof it.relevant === 'boolean',
                reasonOf: (it) => it.reason || '無關',
            }
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: true }, standards: { triageConfirm: { enabled: true, ai: { first: { use: 'cf' }, third: { use: 'cf3' } } } } } })
            const titles = (p) => p.split('\n').filter(Boolean)
            const SKIPPED = { ok: false, error: '額度用盡（替身）', skipped: true, attempts: 0 }
            // 預篩席:皆判無關;確認席:A 無關(兩席定)、B 相關(須第三席);第三席被略過
            const run = async (docs, seatOf, batch = 3, rounds = 1) => {
                const calls = []
                const callAI = async (prompt, check, co) => {
                    const seat = co?.segment === 'triageConfirm' ? co.spec.use : 'triage'
                    const ts = titles(await prompt)
                    calls.push(`${seat}:${ts.map((t) => t[0]).join('')}`)
                    return seatOf(seat, ts)
                }
                const r = await stageTriage({ domain, docsPerBatch: batch, parallel: 1, rounds, maxTries: 1, callAI }).run({ deps: { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings }, log })
                return { r, calls }
            }
            const ok = (provider, map) => (ts) => ({ ok: true, providerId: provider, data: ts.map((t, i) => ({ index: i + 1, relevant: map[t[0]], reason: '與知識庫無關之內容' })) })
            const triageAll = ok('p-triage', { A: false, B: false, C: false })
            // ① 第三席略過:A(兩席定)攔下;B(須第三席)不判、不記次;C 在下一批 → 不再呼叫確認席
            const docs = memStore([
                { id: 'a', status: 'raw', title: 'A 甲', text: 'x', collectedAt: '2026-06-01' },
                { id: 'b', status: 'raw', title: 'B 乙', text: 'y', collectedAt: '2026-06-02' },
                { id: 'c', status: 'raw', title: 'C 丙', text: 'z', collectedAt: '2026-06-03' },
            ])
            const r1 = await run(docs, (seat, ts) => (seat === 'triage' ? triageAll(ts) : seat === 'cf' ? ok('p-cf', { A: false, B: true, C: true })(ts) : SKIPPED), 2, 2)
            assert.deepEqual(r1.calls, ['triage:AB', 'triage:C', 'cf:AB', 'cf3:B'], '第三席略過後不再呼叫下一批(C)之確認席')
            const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((id) => docs.get(id)))
            assert.deepEqual([a.status, a.triage], ['skip', 'irrelevant'], '兩席已定者照常落帳')
            assert.deepEqual([b.status, b.triage, b.triageConfirmTries ?? 0], ['raw', 'reject-pending', 0], '須第三席而第三席略過 → 留待下輪、不記次(maxTries 1 亦不放行)')
            assert.deepEqual([c.triage, c.triageConfirmTries ?? 0], ['reject-pending', 0])
            assert.deepEqual([r1.r.detail.confirmed, r1.r.detail.confirmRetry], [1, 0])
            // ② 第一席略過:本批不判、不記次、不再呼叫
            const docs2 = memStore([{ id: 'x', status: 'raw', title: 'X 戊', text: 'x', collectedAt: '2026-06-01' }])
            const r2 = await run(docs2, (seat, ts) => (seat === 'triage' ? ok('p-triage', { X: false })(ts) : SKIPPED))
            const x = await docs2.get('x')
            assert.deepEqual([r2.calls, x.triage, x.triageConfirmTries ?? 0, r2.r.detail.confirmRetry], [['triage:X', 'cf:X'], 'reject-pending', 0, 0])
        })

        it('預篩 SS5 確認席關閉之終止路徑:開過再關 → 既有待確認者依預篩席之判定攔下(skipReason 註明、計 confirmClosed、日誌);池空亦處置;確認席開啟時不動;預篩停用時不動(摘要不看 triage);開啟而缺確認席 → 拋錯、待確認者不動', async () => {
            const mk = () => memStore([
                { id: 'rp', status: 'raw', title: 'RP 體育新聞', text: 'x', triage: 'reject-pending', triagedAt: '2026-10-01', triageRejectBy: 'p-triage', triageRejectReason: '與知識庫無關之體育新聞', collectedAt: '2026-06-01' },
                { id: 'ok', status: 'raw', title: 'OK', text: 'y', triage: 'relevant', collectedAt: '2026-06-02' },
            ])
            const domain = { buildPrompt: async () => 'p', isValidItem: () => true, reasonOf: () => '無關' }
            const never = async () => assert.fail('池空且無待確認者不應呼叫 AI')
            // 確認席關閉(triageConfirm false;池空):待確認者 → 攔下
            const docs = mk()
            const log1 = recLog()
            const r = await stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, callAI: never }).run({ deps: { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: true }, standards: { triageConfirm: { enabled: false } } } }) }, log: log1 })
            const rp = await docs.get('rp')
            assert.deepEqual([rp.status, rp.triage, rp.skipReason, !!rp.notedAt], ['skip', 'irrelevant', '預篩：與知識庫無關之體育新聞（確認席已關閉，以預篩席之判定攔下）', true])
            assert.deepEqual([r.detail.confirmClosed, r.stats.skip, (await docs.get('ok')).triage], [1, 1, 'relevant'])
            assert.ok(log1.lines.some((l) => /^INFO 預篩：確認席已關閉，待確認 1 篇依預篩席之判定攔下$/.test(l)), log1.lines.join('\n'))
            // 確認席開啟:不動(交確認流程;此處確認席回相關 → 放行)
            const docs2 = mk()
            await stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, callAI: async (p, c, o) => (o?.segment === 'triageConfirm' ? { ok: true, providerId: 'p-cf', data: [{ index: 1, relevant: true }] } : never()) })
                .run({ deps: { stores: { docs: docs2, notes: memStore(), frontier: memStore() }, clock, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: true }, standards: { triageConfirm: { enabled: true, ai: { first: { use: 'cf' } } } } } }) }, log })
            assert.equal((await docs2.get('rp')).skipReason ?? '', '', '開啟時不以關閉語意處置')
            // 預篩停用:整段不跑(待確認者由摘要照常取用——摘要不看 triage 欄)
            const docs3 = mk()
            const r3 = await stageTriage({ domain, callAI: never }).run({ deps: { stores: { docs: docs3, notes: memStore(), frontier: memStore() }, clock, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: false } } }) }, log })
            assert.deepEqual([r3.detail.disabled, (await docs3.get('rp')).status], [true, 'raw'])
            // 開啟而缺確認席(設定或子階段之選項 confirm:true)→ 拋錯(功能表之訊息),不當成關閉——待確認者不動、不呼叫 AI
            const msg = '預篩攔下之第二席確認(summarize.standards.triageConfirm.enabled)已啟用,但缺席位 settings.summarize.standards.triageConfirm.ai.first'
            for (const [settings, o] of [[resolveSummarizeSettings({ summarize: { triage: { enabled: true }, standards: { triageConfirm: { enabled: true } } } }), {}], [resolveSummarizeSettings({ summarize: { triage: { enabled: true } } }), { confirm: true }]]) {
                const docs4 = mk()
                await assert.rejects(() => stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, callAI: never, ...o }).run({ deps: { stores: { docs: docs4, notes: memStore(), frontier: memStore() }, clock, settings }, log }), (e) => e.message === msg)
                assert.deepEqual([(await docs4.get('rp')).status, (await docs4.get('rp')).triage], ['raw', 'reject-pending'])
            }
        })

        it('預篩：放行標 relevant、攔下轉 skip（skipReason 預篩：）、未涵蓋記 tries、失敗達上限放行（fail-open）；摘要只取放行者；停用即整段不跑', async () => {
            const docs = memStore([
                { id: 'a', status: 'raw', title: 'A 批次正規化實驗', text: 'x', collectedAt: '2026-06-01' },
                { id: 'b', status: 'raw', title: 'B 體育新聞', text: 'y', collectedAt: '2026-06-02' },
                { id: 'c', status: 'raw', title: 'C', text: 'z', collectedAt: '2026-06-03' },
            ])
            const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: true } } }) }
            const domain = {
                buildPrompt: async () => 'p',
                isValidItem: (it, n) => !!it && Number.isInteger(it.index) && it.index >= 1 && it.index <= n && typeof it.relevant === 'boolean',
                reasonOf: (it) => it.reason || '',
            }
            const r = await stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, maxTries: 2, callAI: async () => ({ ok: true, data: [{ index: 1, relevant: true }, { index: 2, relevant: false, reason: '體育' }] }) })
                .run({ deps, log })
            assert.deepEqual([r.detail.processed, r.detail.relevant, r.detail.irrelevant, r.detail.missed], [2, 1, 1, 1])
            assert.equal((await docs.get('a')).triage, 'relevant')
            const b = await docs.get('b')
            assert.equal(b.status, 'skip', '攔下者轉 skip(終態,記錄保留)')
            assert.match(b.skipReason, /^預篩：體育/)
            assert.equal((await docs.get('c')).triageTries, 1, '未涵蓋者記 tries,仍待預篩(status 仍 raw)')
            // 摘要只取放行者:c 未預篩不取、b 已 skip
            const picked = []
            await stageSummarize({
                domain: {
                    buildPrompt: async (batch) => {
                        picked.push(...batch.map((d) => d.id)); return 'p'
                    },
                    isValidItem: () => true,
                },
                docsPerBatch: 3,
                parallel: 1,
                rounds: 1,
                callAI: async () => ({ ok: true, data: [{ index: 1, relevant: false, reason: 'x' }] }),
            }).run({ deps, log })
            assert.deepEqual(picked, ['a'], '摘要 pickPool 只取 triage=relevant 者')
            // 預篩失敗達上限 → 放行(fail-open):預篩壞了不得擋住整條摘要線
            const r2 = await stageTriage({ domain, docsPerBatch: 3, parallel: 1, rounds: 1, maxTries: 2, callAI: async () => ({ ok: false, error: 'boom', skipped: false }) })
                .run({ deps, log })
            assert.equal(r2.detail.failedBatches, 1)
            const c = await docs.get('c')
            assert.deepEqual([c.triage, c.triageTries], ['relevant', 2])
            assert.match(c.lastError, /放行交摘要/)
            // 停用:整段不跑;摘要不看 triage 欄
            const r3 = await stageTriage({
                domain,
                callAI: async () => {
                    throw new Error('停用時不應呼叫 AI')
                },
            })
                .run({ deps: { ...deps, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: false } } }) }, log })
            assert.equal(r3.detail.disabled, true)
            const docs2 = memStore([{ id: 'u', status: 'raw', title: 'U', collectedAt: '2026-06-01' }])
            const picked2 = []
            await stageSummarize({
                domain: {
                    buildPrompt: async (batch) => {
                        picked2.push(...batch.map((d) => d.id)); return 'p'
                    },
                    isValidItem: () => true,
                },
                docsPerBatch: 1,
                parallel: 1,
                rounds: 1,
                callAI: async () => ({ ok: true, data: [{ index: 1, relevant: false, reason: 'x' }] }),
            }).run({ deps: { ...deps, stores: { ...deps.stores, docs: docs2 }, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: false } } }) }, log })
            assert.deepEqual(picked2, ['u'], '預篩停用時未預篩之 raw 亦可摘要')
        })
    })

    // ══════════════════════════ 素材問題之退回(預篩落帳、摘要 skipGate)══════════════════════════
    describe('素材問題之退回(兩條判非知識之路皆回報;不適用者照常轉 skip)', function() {
        // 理由樣本(取自實際運行之 skip 理由)
        const MATERIAL_1 = '策略展望評論亂碼'
        const MATERIAL_14 = '內文只抓到鉅亨網的導覽列、人氣排行與欄目連結，沒有正文。從標題看是介紹單一幣圈項目（Fair3 基金會）機制的新聞，沒有量化交易的方法論、參數或策略。'
        const TOPIC_4 = '均線主觀解讀'
        const triageDomain = {
            buildPrompt: async () => 'p',
            isValidItem: (it, n) => !!it && Number.isInteger(it.index) && it.index >= 1 && it.index <= n && typeof it.relevant === 'boolean',
            reasonOf: (it) => it.reason || '',
        }
        const raw = (id, extra = {}) => ({ id, status: 'raw', title: `文件 ${id}`, url: `https://site.example/${id}`, text: 'x', textFrom: 'article', fetchTries: 1, collectedAt: `2026-09-0${id.length}`, ...extra })
        // summarize／capture 為本案對設定之覆寫(預篩開啟、瀏覽器分流每輪 3 篇為預設)
        const depsOf = (docs, summarize = {}, capture = { browser: { perRun: 3 } }) => ({ stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: true }, ...summarize }, capture }) })

        it('預篩:素材問題 → 退回瀏覽器佇列(INFO、計 materialRefetch,不計 irrelevant);grid 摘要／題材判斷 → 照常 skip', async () => {
            const docs = memStore([raw('a'), raw('bb', { textFrom: 'abstract' }), raw('ccc')])
            const logger = recLog()
            const data = [{ index: 1, relevant: false, reason: MATERIAL_1 }, { index: 2, relevant: false, reason: MATERIAL_1 }, { index: 3, relevant: false, reason: TOPIC_4 }]
            const r = await stageTriage({ domain: triageDomain, docsPerBatch: 3, parallel: 1, rounds: 1, callAI: async () => ({ ok: true, data }) }).run({ deps: depsOf(docs), log: logger })
            assert.deepEqual([r.detail.processed, r.detail.materialRefetch, r.detail.irrelevant, r.stats.skip], [3, 1, 2, 2], JSON.stringify(r.detail))
            const a = await docs.get('a')
            assert.deepEqual([a.status, a.fetcher, a.refetchSkip, a.fetchTries, a.formatRefetches, a.triage, a.lastReason], ['new', 'browser', ['curl'], 1, 1, null, 'material'])
            assert.ok(!a.skipReason)
            assert.ok(logger.lines.some((l) => /^INFO 預篩：素材問題退回抓取\[文件 a\]（策略展望評論亂碼；排除 curl 重抓）/.test(l)), logger.lines.join('\n'))
            const bb = await docs.get('bb')
            assert.deepEqual([bb.status, bb.skipReason], ['skip', `預篩：${MATERIAL_1}`], 'grid 摘要不退回')
            assert.equal((await docs.get('ccc')).status, 'skip')
        })

        it('摘要 skipGate:素材問題 → 退回(計 materialRefetch 不計 skipped);已退回達上限 → 照常 skip;瀏覽器分流停用 → 照常 skip', async () => {
            const docs = memStore([raw('a', { triage: 'relevant' }), raw('bb', { triage: 'relevant', formatRefetches: 1 })])
            const domain = { buildPrompt: async () => 'p', isValidItem: () => true }
            const data = [{ index: 1, relevant: false, reason: MATERIAL_14 }, { index: 2, relevant: false, reason: MATERIAL_14 }]
            const logger = recLog()
            const r = await stageSummarize({ domain, docsPerBatch: 2, parallel: 1, rounds: 1, callAI: async () => ({ ok: true, data }) }).run({ deps: depsOf(docs), log: logger })
            assert.deepEqual([r.detail.processed, r.detail.materialRefetch, r.detail.skipped, r.stats.skip], [2, 1, 1, 1], JSON.stringify(r.detail))
            const a = await docs.get('a')
            assert.deepEqual([a.status, a.fetcher, a.refetchSkip, a.triage, a.summarizeTries], ['new', 'browser', ['curl'], null, 0])
            assert.match(a.lastError, /^摘要回報素材問題（只抓到鉅亨網的導覽）/)
            assert.ok(logger.lines.some((l) => /^INFO 摘要：素材問題退回抓取\[文件 a\]/.test(l)), logger.lines.join('\n'))
            const bb = await docs.get('bb')
            assert.deepEqual([bb.status, bb.skipReason], ['skip', MATERIAL_14.slice(0, 150)], '同一篇至多退回 summarize.refetch.max 次')
            // 瀏覽器分流停用:退回無處可去(瀏覽器佇列不被消化)→ 照常 skip
            const docs2 = memStore([raw('c', { triage: 'relevant' })])
            const r2 = await stageSummarize({ domain, docsPerBatch: 1, parallel: 1, rounds: 1, callAI: async () => ({ ok: true, data: [data[0]] }) }).run({ deps: depsOf(docs2, {}, { browser: { perRun: 0 } }), log: recLog() })
            assert.deepEqual([r2.detail.materialRefetch, (await docs2.get('c')).status], [0, 'skip'])
            // summarize.refetch.max 0:停用回報
            const docs3 = memStore([raw('d', { triage: 'relevant' })])
            await stageSummarize({ domain, docsPerBatch: 1, parallel: 1, rounds: 1, callAI: async () => ({ ok: true, data: [data[0]] }) }).run({ deps: depsOf(docs3, { refetch: { max: 0 } }), log: recLog() })
            assert.equal((await docs3.get('d')).status, 'skip')
        })
    })

    // ══════════════════════════ 摘要(stages/noteStage)══════════════════════════
    describe('摘要子階段(noteStage)', function() {

        it('stageSummarize:opt 非物件視為{},不拋錯;有效輸入(空 raw 池)行為不變', async () => {
            const bad = stageSummarize('not-object')
            assert.equal(typeof bad.run, 'function')

            const docs = memStore([])
            const stage = stageSummarize({ domain: { buildPrompt: async () => 'p', isValidItem: () => true }, docsPerBatch: 2, parallel: 1, rounds: 1 })
            const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: false } } }) }
            const r = await stage.run({ deps, log })
            assert.equal(r.detail.processed, 0)
            assert.equal(r.stats.aiCalls, 0)
        })

        it('mwSaveClues:opt 非物件視為{},不拋錯;有效輸入回收線索(白名單套用)行為不變', async () => {
            const bad = mwSaveClues('not-object')
            assert.equal(bad.name, 'saveClues')

            const frontier = memStore([])
            const mw = mwSaveClues({})
            const msg = makeMsg('doc', {
                doc: { id: 'd1' },
                _aiItem: { relevant: true, explore: [{ type: 'keyword', value: 'k1', why: 'w' }] },
                _domain: {},
            })
            const ctx = { deps: { stores: { frontier }, clock }, log }
            await runChainOverMsgs({ chain: [mw], ctx, msgs: [msg] })
            assert.equal(msg.stats.explore, 1)
            assert.equal((await frontier.select()).length, 1)
        })

        it('mwRenderNote:可疑標籤(括號說明／一標籤多概念)只計數 tagSuspect 並記 INFO,標籤原樣入筆記(不改資料);無可疑者不計', async () => {
            const infos = []
            const rec = { ...log, info: (m) => infos.push(m) }
            const domain = { normalizeQuality: () => ({}), vocab: { categories: ['其他'] }, renderNoteBody: () => 'b' }
            const run = async (concepts) => {
                const msg = makeMsg('doc', { doc: { id: 'd1' }, _aiItem: { title: '標題', concepts }, _domain: domain })
                await runChainOverMsgs({ chain: [mwRenderNote()], ctx: { deps: { dirs: { notes: TMP }, clock }, log: rec }, msgs: [msg] })
                return msg
            }
            const m1 = await run(['價格發現(未在清單中)', '訂單流、流動性', 'AR(1)', '均值回歸'])
            assert.equal(m1.stats.tagSuspect, 2)
            assert.deepEqual(m1.data._note.record.concepts, ['價格發現(未在清單中)', '訂單流、流動性', 'AR(1)', '均值回歸'], '只計數,不改寫標籤')
            assert.match(infos[0], /^摘要標籤可疑\[.+\]：「價格發現\(未在清單中\)」、「訂單流、流動性」（括號說明或多概念；只計數，清理見 suggestConceptRenames）$/)
            const m2 = await run(['AR(1)', 'GARCH(1,1)'])
            assert.equal(m2.stats.tagSuspect, undefined)
            assert.equal(infos.length, 1)
        })

        it('摘要選取：tries 升冪→tier 升冪→同層級 FIFO（先收先萃）；raw 進料大於容量時最舊者不得被擠掉', async () => {
            const docs = memStore([
                { id: 't1-tried', status: 'raw', sourceTier: 1, summarizeTries: 1, collectedAt: '2026-06-01T00:00:00+08:00' }, // 失敗過：排隊尾
                { id: 't3-newest', status: 'raw', sourceTier: 3, collectedAt: '2026-09-01T00:00:00+08:00' },
                { id: 't3-oldest', status: 'raw', sourceTier: 3, collectedAt: '2026-07-01T00:00:00+08:00' },
                { id: 't1-new', status: 'raw', sourceTier: 1, collectedAt: '2026-09-01T00:00:00+08:00' },
                { id: 't3-mid', status: 'raw', sourceTier: 3, collectedAt: '2026-08-15T00:00:00+08:00' },
            ])
            const batches = []
            const domain = {
                buildPrompt: async (batch) => {
                    batches.push(batch.map((d) => d.id)); return 'p'
                },
                isValidItem: () => true,
            }
            const stage = stageSummarize({
                domain,
                docsPerBatch: 3,
                parallel: 1,
                rounds: 1,
                callAI: async () => ({ ok: true, data: [1, 2, 3].map((index) => ({ index, relevant: false, reason: '測試：判非知識' })) }),
            })
            const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, clock: genClockTZ('Asia/Taipei'), settings: resolveSummarizeSettings({ summarize: { triage: { enabled: false } } }) }
            await stage.run({ deps, log })
            assert.deepEqual(batches[0], ['t1-new', 't3-oldest', 't3-mid'],
                'tier 先；同層級最舊先。曾為最新優先：raw 進料（補全文＋feed 直入）大於容量時最舊者永遠輪不到')
            assert.equal((await docs.get('t3-oldest')).status, 'skip', '最舊者本輪已被判定')
            assert.equal((await docs.get('t3-newest')).status, 'raw', '名額只有 3，最新者排隊，不插隊')
            assert.equal((await docs.get('t1-tried')).status, 'raw', '失敗過者排隊尾（隊頭防阻塞），不因 tier 高插隊')
        })

        it('摘要 report：批次失敗與未涵蓋須進 stats.fail（此前手組 report 恆 fail:0）；逾時間預算即 stopped 且不記 tries', async () => {
            const docs = memStore([{ id: 'a', status: 'raw', title: 'A', collectedAt: '2026-06-01' }, { id: 'b', status: 'raw', title: 'B', collectedAt: '2026-06-02' }])
            const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: false } } }) }
            const domain = { buildPrompt: async () => 'p', isValidItem: () => true }
            const r1 = await stageSummarize({ domain, docsPerBatch: 2, parallel: 1, rounds: 1, callAI: async () => ({ ok: false, error: 'truncated', skipped: false }) })
                .run({ deps, log })
            assert.equal(r1.ok, true, '批次失敗不是子階段失敗(有隔離),但須計入 fail')
            assert.equal(r1.stats.fail, 1, '1 個失敗批次')
            assert.equal(r1.detail.failedBatches, 1)
            assert.equal((await docs.get('a')).summarizeTries, 1, '整批失敗記 tries(換批次組合後再試)')

            const docs2 = memStore([{ id: 'a', status: 'raw', title: 'A', collectedAt: '2026-06-01' }])
            const r2 = await stageSummarize({ domain, docsPerBatch: 1, parallel: 1, rounds: 3, callAI: async () => ({ ok: true, data: [{ index: 1, relevant: false, reason: 'x' }] }) })
                .run({ deps: { ...deps, stores: { ...deps.stores, docs: docs2 } }, log, expired: () => true })
            assert.equal(r2.detail.stopped, true, '整輪已逾時間預算:一輪都不開工')
            assert.equal(r2.stats.aiCalls, 0)
            assert.equal((await docs2.get('a')).status, 'raw', '未取件者原樣留佇列,不記 tries')
        })

        it('摘要 S5：同文件已有筆記(同 docId)→ 不覆寫 md、不入庫、不計新知識;文件改以既有 slug 回鏈', async () => {
            const dir = `${TMP}/s5`
            const existingFile = `${dir}/old-slug.md`
            writeMd(existingFile, { title: '舊標題', slug: 'old-slug', related: ['x'] }, '# 舊\n\n## 關聯\n\n- [互補搭配] [[x]] X：r')
            const docs = memStore([{ id: 'd1', status: 'raw', title: 'doc', text: 'x'.repeat(50), url: 'https://e.com/a', sourceName: 's', sourceTier: 1, collectedAt: '2026-01-01' }])
            const notes = memStore([{ id: 'old-slug', title: '舊標題', docId: 'd1', concepts: ['c'], file: existingFile }])
            const deps = { stores: { docs, notes, frontier: memStore() }, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: false } } }), clock, dirs: { notes: dir }, domains: { summarize: createSummarizeDomain({}) } }
            const item = { index: 1, relevant: true, title: '新標題', key_points: ['k'], concepts: ['c', 'c2'], summary: 's', category: '其他', claim_type: '實證研究', evidence_level: '中' }
            const logger = recLog()
            const r = await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, callAI: async () => ({ ok: true, data: [item], error: '', skipped: false, attempts: 1, preview: '' }) }).run({ deps, log: logger })
            assert.deepEqual([r.detail.notes, r.detail.notesExisting, r.detail.processed], [0, 1, 1], JSON.stringify(r.detail))
            assert.equal((await notes.select()).length, 1)
            assert.deepEqual(readMd(existingFile).front.related, ['x'], '既有 md 之關聯不被覆寫')
            const d = await docs.get('d1')
            assert.deepEqual([d.status, d.noteSlug], ['noted', 'old-slug'])
            assert.ok(logger.lines.some((l) => /^INFO 摘要：文件已有筆記 old-slug，保留既有/.test(l)), logger.lines.join('\n'))
            assert.ok(!fs.readdirSync(dir).some((f) => /新標題/.test(f)), '不另寫新 md')
        })

        it('摘要 S2／D3：逐項鏈異常每次 tries+1 並 WARN、永不標終態(summarize-failed)——修好即可重做;report 之 fail 含之、不算進度', async () => {
            const docs = memStore([{ id: 'a', status: 'raw', title: 'A', collectedAt: '2026-06-01' }])
            const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: false } } }) }
            const domain = { buildPrompt: async () => 'p', isValidItem: () => true }
            const boomMw = defineMw({ name: 'boom', handle: async () => {
                throw new Error('ENOSPC')
            } })
            for (let i = 1; i <= 4; i++) {
                const logger = recLog()
                // 項目須過納入閘(欄位完整)才進逐項鏈——本案測的是鏈異常之落帳
                const r = await stageSummarize({ domain, chain: [boomMw], docsPerBatch: 1, parallel: 1, rounds: 2, maxTries: 3, callAI: async () => ({ ok: true, data: [{ index: 1, relevant: true, title: 'A', summary: 's', key_points: ['k'], concepts: ['c', 'd'] }] }) }).run({ deps, log: logger })
                assert.deepEqual([r.stats.fail, r.detail.chainFailed, r.detail.processed], [1, 1, 0], `第 ${i} 次:${JSON.stringify(r.detail)}`)
                const d = await docs.get('a')
                assert.deepEqual([d.status, d.summarizeTries], ['raw', i], `第 ${i} 次仍為 raw(maxTries 3 不適用於鏈異常)`)
                assert.match(d.lastError, /^逐項鏈異常：.*ENOSPC/)
                assert.ok(logger.lines.some((l) => /^WARN 摘要：\[A\] 逐項鏈異常：.*ENOSPC（第 \d+ 次；程式或寫入問題，不標終態，修復後重做）/.test(l)), logger.lines.join('\n'))
                assert.equal(r.stats.aiCalls, 1, '零進度守門:第 2 輪不開工')
            }
        })

        it('摘要：只取已預篩者而 raw 池無任何預篩結果 → WARN 指出預篩段停用或未執行(此前無聲、巡檢歸因容量不足)', async () => {
            const docs = memStore([{ id: 'u', status: 'raw', title: 'U', collectedAt: '2026-06-01' }])
            const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, clock, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: true } } }) }
            const logger = recLog()
            await stageSummarize({ domain: { buildPrompt: async () => 'p', isValidItem: () => true }, docsPerBatch: 1, parallel: 1, rounds: 1, callAI: async () => ({ ok: true, data: [] }) }).run({ deps, log: logger })
            assert.ok(logger.lines.some((l) => /^WARN 摘要：raw 池 1 篇皆無預篩結果而本段只取已放行者/.test(l)), logger.lines.join('\n'))
        })
    })

    // ══════════════════════════ 長文:依字數打包 ══════════════════════════
    describe('摘要:依字數打包(長文)', function() {
        const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: false }, docsPerCall: 3, charsPerDoc: 6000 }, capture: { browser: { perRun: 0 } } })
        /** 長度恰為 n 之正文,頭尾各帶標記(驗 AI 是否讀到尾段) */
        const body = (tag, n) => {
            const head = `【${tag}頭】`
            const tail = `【${tag}尾】`
            return head + '量'.repeat(n - head.length - tail.length) + tail
        }
        const doc = (id, text, extra = {}) => ({ id, status: 'raw', title: `文件${id}`, url: `https://example.com/${id}`, sourceName: '來源', sourceTier: 1, text, textFrom: 'article', collectedAt: `2026-09-01T00:00:0${id.length}`, ...extra })
        /** 依 prompt 之篇數回傳全數 relevant 之項目;記下每次 prompt */
        const aiFor = (prompts) => async (p) => {
            prompts.push(p)
            const n = (p.match(/^--- 第\d+篇 ---$/gm) || []).length
            // 欄位完整(檢定標準 SS2);標題不含數字(序號以中文表示,免受數字紮根之檢)
            return { ok: true, data: Array.from({ length: n }, (_, i) => ({ index: i + 1, relevant: true, title: `筆記${'甲乙丙丁戊己庚辛壬癸'[prompts.length % 10]}${'甲乙丙丁戊己庚辛壬癸'[i % 10]}`, key_points: ['k'], concepts: ['概念', '概念二'], summary: 's', category: '其他', claim_type: '實證研究', evidence_level: '中' })) }
        }

        it('長文獨佔一批、全文進 AI;逾上限(18,000)者截至上限並明示(record、md 來源章、truncated);未取之批原樣留佇列', async () => {
            const dir = `${TMP}/pack`
            // 排序鍵 collectedAt:a → bb → ccc → dddd → eeeee
            const docs = memStore([
                doc('a', body('甲', 15000)), // 15,000:與乙同批(17,000 ≤ 18,000)
                doc('bb', body('乙', 2000), { fullLength: 25000 }), // 抓取時已截(原長 25,000)→ 截斷明示
                doc('ccc', body('丙', 2000), { fullLength: 2600, dedupedChars: 600 }), // 去重 600 不算截斷
                doc('dddd', body('丁', 30000)), // 逾上限:獨佔一批、截至 18,000
                doc('eeeee', body('戊', 1000)), // 第 4 批:本輪 parallel 3 不取
            ])
            const prompts = []
            const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, settings, clock, dirs: { notes: dir }, domains: { summarize: createSummarizeDomain({ summarizeCharsPerDoc: 6000 }) } }
            const r = await stageSummarize({ parallel: 3, rounds: 1, callAI: aiFor(prompts) }).run({ deps, log })
            assert.equal(prompts.length, 3)
            const pAB = prompts.find((p) => p.includes('【甲頭】'))
            assert.ok(pAB.includes('【甲尾】') && pAB.includes('【乙尾】'), '甲(15,000)全文進 AI(此前截 6,000)')
            const pD = prompts.find((p) => p.includes('【丁頭】'))
            assert.ok(!pD.includes('【丁尾】') && !pD.includes('【甲頭】'), '丁獨佔一批且截至上限')
            assert.ok(pD.includes(`${'量'.repeat(100)}...`))
            assert.deepEqual([r.detail.processed, r.detail.notes, r.detail.truncated], [4, 4, 2], JSON.stringify(r.detail))
            const e = await docs.get('eeeee')
            assert.deepEqual([e.status, e.summarizeTries], ['raw', undefined], '未取之批原樣留佇列、不記 tries')
            const noteOf = async (id) => (await deps.stores.notes.select({ docId: id }))[0]
            const nA = await noteOf('a')
            assert.deepEqual([nA.sourceChars, nA.processedChars], [15000, 15000])
            assert.ok(!readMd(nA.file).body.includes('內文處理範圍'), '未截斷者版型不變')
            const nB = await noteOf('bb')
            assert.deepEqual([nB.sourceChars, nB.processedChars], [25000, 2000])
            const nC = await noteOf('ccc')
            assert.deepEqual([nC.sourceChars, nC.processedChars], [2000, 2000], '原長扣除無損去重')
            const nD = await noteOf('dddd')
            assert.deepEqual([nD.sourceChars, nD.processedChars], [30000, 18000])
            assert.match(readMd(nD.file).body, /內文取得方式：原網頁全文\n- 內文處理範圍：原文 30000 字，摘要只讀前 18000 字/)
        })

        it('packByChars:false 回到每批固定篇數、每篇截 6,000(子階段部分;字數 ≤ summarizeCharsPerDoc 之提示詞逐字不變另見 domain 之測試)', async () => {
            const d = createSummarizeDomain({ summarizeCharsPerDoc: 6000 })
            const docs = memStore([doc('a', body('甲', 15000)), doc('bb', body('乙', 15000)), doc('ccc', body('丙', 15000))])
            const prompts = []
            const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, settings, clock, dirs: { notes: `${TMP}/nopack` }, domains: { summarize: d } }
            const r = await stageSummarize({ parallel: 3, rounds: 1, packByChars: false, callAI: aiFor(prompts) }).run({ deps, log })
            assert.equal(prompts.length, 1, '固定 3 篇一批')
            assert.ok(!prompts[0].includes('【甲尾】'))
            assert.equal(r.detail.truncated, 3)
            assert.deepEqual([(await deps.stores.notes.select({ docId: 'a' }))[0].processedChars], [6000])
        })
    })

    // ══════════════════════════ 兩條寫入路徑同一組裝(摘要子階段 vs 人工匯入)══════════════════════════
    describe('分類標注:兩條寫入路徑同一組裝;清單外類別落 fallbackCategory', function() {
        const NOW = '2026-10-04T10:00:00+08:00'
        const fixed = { iso8: () => NOW }
        const VOCAB = { categories: ['方法', '風險', '雜項'], fallbackCategory: '雜項' }
        /** 設定:預篩關閉(直接摘要)、瀏覽器分流關閉 */
        const SETTINGS = resolveSummarizeSettings({ summarize: { triage: { enabled: false } }, capture: { browser: { perRun: 0 } } })
        const NOTE = { title: '筆記甲', key_points: ['k1'], concepts: [' 概念甲 ', 2, {}, ''], summary: '一句話', category: ' 方法 ', claim_type: '實證研究', evidence_level: '中' }
        /** 去重身分(抓取套件之預設;人工匯入之文件 id 與管線同一身分——預設下即 sha1(正準網址)) */
        const identity = captureIdentityOf(DEFAULT_DEDUP)

        it('摘要子階段與人工匯入產出同一份筆記(frontmatter、record、md 本文逐欄相同;概念清洗同一規則)', async () => {
            const domain = createSummarizeDomain({ vocab: VOCAB })
            const url = 'https://example.com/a'
            const docId = sha1(url)
            // 路徑一:摘要子階段
            const docs = memStore([{ id: docId, status: 'raw', title: '原文標題', url, sourceName: '手動抓取', sourceTier: 1, textFrom: 'abstract', publishedAt: '', text: 'x', collectedAt: NOW }])
            const notes1 = memStore()
            const dir1 = `${TMP}/p1`
            await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, callAI: async () => ({ ok: true, data: [{ index: 1, relevant: true, ...NOTE }] }) })
                .run({ deps: { stores: { docs, notes: notes1, frontier: memStore() }, settings: SETTINGS, clock: fixed, dirs: { notes: dir1 }, domains: { summarize: domain } }, log })
            // 路徑二:人工匯入(同一 url、同一 note)
            const notes2 = memStore()
            const dir2 = `${TMP}/p2`
            const r = await ingestNotes({ stores: { docs: memStore(), notes: notes2 }, dirs: { notes: dir2 }, clock: fixed, domain, identity }, [{ url, title: '原文標題', note: NOTE }])
            assert.equal(r.added, 1, JSON.stringify(r))
            const [a] = await notes1.select()
            const [b] = await notes2.select()
            // 唯一差異:摘要路徑記 AI 讀取之處理範圍(sourceChars／processedChars),人工匯入無此資訊而標 sourceKind:'manual'(不檢數字紮根,檢定標準 SS4)
            //   產出鏈(stores/noteProduced;跨套件規格之 produced):人工匯入寫 produced(不呼叫 AI:seat／provider 皆 null;stage 為 ingest),
            //   而本案之摘要路徑以覆寫之 callAI 作答、未回 providerId(成交條目未知)→ 不寫產出鏈(寧缺勿假)。兩者除產出鏈之欄外仍同一份
            const strip = ({ sourceChars, processedChars, sourceKind, produced, producedHistory, producedHistoryDropped, ...x }) => ({ ...x, file: path.basename(x.file) })
            assert.deepEqual([a.sourceChars, a.processedChars, 'sourceChars' in b, b.sourceKind, 'sourceKind' in a], [1, 1, false, 'manual', false])
            assert.deepEqual([a.produced, a.producedHistory], [undefined, undefined], '成交條目未知之摘要路徑不寫產出鏈')
            assert.deepEqual([b.produced.stage, b.produced.seat, b.produced.provider, b.produced.stamp, b.producedHistory.length, b.producedHistoryDropped], ['ingest', null, null, null, 1, 0], '人工匯入:不呼叫 AI → seat／provider 皆 null,輪次外 stamp 為 null')
            assert.deepEqual(strip(b), strip(a))
            assert.deepEqual(a.concepts, ['概念甲', '2'], '只收字串／數字、trim、濾空(物件不成 [object Object])')
            assert.equal(a.category, '方法', '類別去頭尾空白')
            const ma = readMd(a.file)
            const mb = readMd(b.file)
            // md front matter 只多產出鏈之純量鍵(值為 null 者省略):人工匯入之 stamp、provider 皆 null → 只有 produced_stage
            const { produced_stage: ps, ...frontB } = mb.front
            assert.equal(ps, 'ingest')
            assert.deepEqual(frontB, ma.front)
            assert.equal(mb.body, ma.body)
        })

        it('清單外類別:落 fallbackCategory、record 存 categoryRaw、計 categoryOffList 並記 INFO;匯入回報同一訊息', async () => {
            const domain = createSummarizeDomain({ vocab: VOCAB })
            const docs = memStore([{ id: 'd1', status: 'raw', title: 't', url: 'https://example.com/b', sourceName: 's', sourceTier: 1, text: 'x', collectedAt: NOW }])
            const notes = memStore()
            const logger = recLog()
            const rep = await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, callAI: async () => ({ ok: true, data: [{ index: 1, relevant: true, ...NOTE, category: '新興主題' }] }) })
                .run({ deps: { stores: { docs, notes, frontier: memStore() }, settings: SETTINGS, clock: fixed, dirs: { notes: `${TMP}/off` }, domains: { summarize: domain } }, log: logger })
            const [n] = await notes.select()
            assert.deepEqual([n.category, n.categoryRaw, rep.detail.categoryOffList], ['雜項', '新興主題', 1])
            assert.equal(readMd(n.file).front.category, '雜項')
            assert.ok(logger.lines.some((l) => /^INFO 摘要分類\[.+\]：「新興主題」不在分類清單，落「雜項」（原值存 categoryRaw）/.test(l)), logger.lines.join('\n'))
            const r = await ingestNotes({ stores: { docs: memStore(), notes: memStore() }, dirs: { notes: `${TMP}/off2` }, clock: fixed, domain, identity }, [{ url: 'https://example.com/c', note: { ...NOTE, category: '新興主題' } }])
            assert.ok(r.messages.some((m) => /^! 類別「新興主題」不在分類清單，落「雜項」/.test(m)), r.messages.join('\n'))
        })

        it('人工匯入:驗證與摘要同一清洗規則(概念全為物件／空白 → 欄位不全);md 寫入失敗不先登記文件(重跑仍可匯入)', async () => {
            const domain = createSummarizeDomain({ vocab: VOCAB })
            const docs = memStore()
            const r1 = await ingestNotes({ stores: { docs, notes: memStore() }, dirs: { notes: `${TMP}/v` }, clock: fixed, domain, identity }, [{ url: 'https://example.com/d', note: { ...NOTE, concepts: [{}, ' '] } }])
            assert.deepEqual([r1.added, r1.bad], [0, 1])
            // md 寫入失敗:筆記目錄落在一個檔案之下(ENOTDIR)
            fs.writeFileSync(`${TMP}/afile`, 'x')
            const notes = memStore()
            await assert.rejects(ingestNotes({ stores: { docs, notes }, dirs: { notes: `${TMP}/afile/sub` }, clock: fixed, domain, identity }, [{ url: 'https://example.com/e', note: NOTE }]))
            assert.equal(await docs.get(sha1('https://example.com/e')), null, '寫入順序:筆記先、文件後——md 失敗即未登記文件')
            const r2 = await ingestNotes({ stores: { docs, notes }, dirs: { notes: `${TMP}/ok` }, clock: fixed, domain, identity }, [{ url: 'https://example.com/e', note: NOTE }])
            assert.equal(r2.added, 1, '重跑可匯入(不被「已在庫」擋下)')
            assert.equal((await docs.get(sha1('https://example.com/e'))).status, 'noted')
        })
    })

    // ══════════════════════════ 納入閘之接線 ══════════════════════════
    describe('摘要子階段之納入閘接線(standards/noteGate、noteStandards)', function() {
        const VOCAB = { claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] }
        const SRC = '動量研究\nTaiwan momentum 12-1 earns 8.2% annual excess return over 2010-2024; costs 0.15%.'
        const ITEM = (o = {}) => ({ index: 1, relevant: true, title: '動量因子之台股實證', summary: '台股動量年化超額 8.2%', key_points: ['年化超額 8.2%'], concepts: ['動量因子', '回測'], claim_type: '實證研究', evidence_level: '中', ...o })
        // 詞彙給回中立題材之證據規則(SS11 之案據此;其餘案之證據等級非最高級,規則不影響)
        const domain = createSummarizeDomain({ vocab: { ...VOCAB, evidenceRule: NEUTRAL_RULE } })
        const doc = (id, o = {}) => ({ id, status: 'raw', title: '動量研究', text: SRC, url: `https://e.com/${id}`, sourceName: 's', sourceTier: 1, collectedAt: '2026-09-01', ...o })
        const deps = (docs, notes, dir, holds) => ({ stores: { docs, notes, frontier: memStore(), ...(holds ? { holds } : {}) }, settings: resolveSummarizeSettings({ summarize: { triage: { enabled: false } } }), clock, dirs: { notes: dir }, domains: { summarize: domain } })
        const silent = { info() {}, warn() {}, error() {} }

        it('修得好者照收:簡體、物件、含原文沒有之數字之清單行 → 落地之 md 合於 checkNote,記錄帶 stdFixes', async () => {
            const docs = memStore([doc('a')])
            const notes = memStore()
            const dir = `${TMP}/ok-gate`
            const item = ITEM({ title: '动量因子之实证', key_points: ['年化超额 8.2%', '夏普 1.9'], methods: [{ step: '排序' }], claim_type: '实证研究' })
            const r = await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, callAI: async () => ({ ok: true, data: [item], providerId: 'p1' }) }).run({ deps: deps(docs, notes, dir), log: silent })
            assert.deepEqual([r.detail.notes, r.detail.stdFixed, r.detail.stdRejected], [1, 1, 0], JSON.stringify(r.detail))
            const [n] = await notes.select()
            assert.ok(n.stdFixes.some((x) => /夏普 1\.9/.test(x)) && n.stdFixes.some((x) => /內容類型/.test(x)), JSON.stringify(n.stdFixes))
            const md = readMd(n.file)
            const bad = checkNote({ front: md.front, body: md.body, record: n }, { vocab: domain.vocab, material: SRC }).filter((x) => x.status !== 'pass' && x.status !== 'na')
            assert.deepEqual(bad, [])
            assert.ok(!md.body.includes('夏普 1.9') && md.body.includes('排序'))
        })

        it('修不好者不納入:tries＋1、lastError 未達檢定標準、stdFeedback;下次提示詞附回饋;末次避開曾產出之供應者;納入後清回饋', async () => {
            const docs = memStore([doc('b')])
            const notes = memStore()
            const dir = `${TMP}/bad-gate`
            const seen = []
            let good = false
            const callAI = async (prompt, check, o) => {
                seen.push({ prompt, avoid: o?.avoid || [] })
                const item = good ? ITEM() : ITEM({ title: '動量年化 9.9%' })
                return check([item]) ? { ok: true, data: [item], providerId: good ? 'p2' : 'p1' } : { ok: true, data: [item], providerId: 'p1' }
            }
            const st = () => stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, maxTries: 3, callAI })
            await st().run({ deps: deps(docs, notes, dir), log: silent })
            let d = await docs.get('b')
            assert.deepEqual([d.status, d.summarizeTries, d.summarizeProviders], ['raw', 1, 'p1'])
            assert.match(d.lastError || d.stdFeedback, /9\.9%/)
            assert.match(d.stdFeedback, /標題含原文沒有之數字/)
            await st().run({ deps: deps(docs, notes, dir), log: silent })
            assert.match(seen.at(-1).prompt, /上次之輸出未達標準：標題含原文沒有之數字/, '回饋附於提示詞')
            d = await docs.get('b')
            assert.equal(d.summarizeTries, 2)
            good = true
            await st().run({ deps: deps(docs, notes, dir), log: silent })
            assert.deepEqual(seen.at(-1).avoid, ['p1'], '末次重試避開 p1')
            d = await docs.get('b')
            assert.deepEqual([d.status, d.stdFeedback], ['noted', ''], '納入後清回饋')
        })

        it('S5 摘要段:最高證據等級而 caveat 只涉及獨立觀測(寬式)→ 不降級、gateNote 判 SS11 未能判定 → 不落地、tries＋1、回饋含「請明確寫出是否做過獨立觀測證實，或降低證據等級」、待判 SS11(pipeline);嚴式 → 降級後納入', async () => {
            const docs = memStore([doc('l1'), doc('s1')])
            const notes = memStore()
            const holds = memStore()
            const items = { l1: ITEM({ evidence_level: '高', caveats: ['摘要未揭露獨立觀測證實之資料範圍與細節'] }), s1: ITEM({ evidence_level: '高', caveats: ['無獨立觀測證實'] }) }
            const callAI = async (p) => {
                const id = /e\.com\/(\w+)/.exec(p)[1]
                return { ok: true, data: [{ ...items[id], index: 1 }], providerId: 'p1' }
            }
            const r = await stageSummarize({ docsPerBatch: 1, parallel: 2, rounds: 1, callAI }).run({ deps: deps(docs, notes, `${TMP}/s5stage`, holds), log: silent })
            const l1 = await docs.get('l1')
            assert.deepEqual([l1.status, l1.summarizeTries], ['raw', 1])
            assert.match(l1.stdFeedback, /SS11 caveat 涉及獨立觀測而未明確自承.*——請明確寫出是否做過獨立觀測證實，或降低證據等級/)
            const h = await holds.get('doc:l1:SS11')
            assert.deepEqual([h?.status, h?.owner, h?.next], ['open', 'pipeline', '下輪附回饋重摘'])
            const [n] = await notes.select()
            assert.deepEqual([n.docId, n.evidenceLevel, (await docs.get('s1')).status], ['s1', '中', 'noted'], '嚴式命中者降一級後納入')
            assert.equal(r.detail.stdRejected, 1)
        })

        it('S6 摘要段:擠標籤各段皆為既有概念(全庫筆記)→ 拆開納入;有段非既有 → 不拆、gateNote 判 SS6 不合格 → 不落地、回饋與待判 SS6', async () => {
            const notes = memStore([{ id: 'old', title: '舊', concepts: ['市場微結構', '流動性'], file: `${TMP}/none.md` }])
            const docs = memStore([doc('k1'), doc('u1')])
            const holds = memStore()
            const items = { k1: ITEM({ concepts: ['市場微結構、流動性', '動量因子'] }), u1: ITEM({ concepts: ['新奇概念、流動性', '動量因子'] }) }
            const callAI = async (p) => {
                const id = /e\.com\/(\w+)/.exec(p)[1]
                return { ok: true, data: [{ ...items[id], index: 1 }], providerId: 'p1' }
            }
            await stageSummarize({ docsPerBatch: 1, parallel: 2, rounds: 1, callAI }).run({ deps: deps(docs, notes, `${TMP}/s6stage`, holds), log: silent })
            const k1 = (await notes.select()).find((x) => x.docId === 'k1')
            assert.deepEqual(k1?.concepts, ['市場微結構', '流動性', '動量因子'], '各段皆既有 → 拆開')
            const u1 = await docs.get('u1')
            assert.deepEqual([u1.status, u1.summarizeTries, /SS6 多概念擠一標籤「新奇概念、流動性」/.test(u1.stdFeedback)], ['raw', 1, true])
            assert.equal((await holds.get('doc:u1:SS6'))?.owner, 'pipeline')
        })

        it('重試耗盡仍不合格 → summarize-failed,lastError 為未達檢定標準(原文由終態瘦身另存,可重開)', async () => {
            const docs = memStore([doc('c', { summarizeTries: 2 })])
            const r = await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, maxTries: 3, callAI: async () => ({ ok: true, data: [ITEM({ concepts: ['甲'] })], providerId: 'p1' }) }).run({ deps: deps(docs, memStore(), `${TMP}/fail`), log: silent })
            const d = await docs.get('c')
            assert.deepEqual([d.status, d.summarizeTries], ['summarize-failed', 3])
            assert.match(d.lastError, /^未達檢定標準：概念 1 個/)
            assert.equal(r.detail.stdRejected, 1)
        })
    })

    // ══════════════════════════ 逐次截斷放行(陣列輸出之呼叫點)══════════════════════════
    describe('逐次截斷放行:陣列輸出(摘要、預篩、預篩確認、重標)每次給 acceptTruncated:true;物件輸出(修補、覆核)不給;avoid 只在摘要', function() {
        const NOW = '2026-10-05T10:00:00+08:00'
        const fixed = { iso8: () => NOW }
        const SRC = 'Taiwan momentum 12-1 earns 8.2% annual excess return over 2010-2024; Sharpe 0.71; costs 0.15%.'
        const ITEM = (o = {}) => ({ index: 1, relevant: true, title: '動量因子之台股實證', summary: '台股動量年化超額 8.2%', key_points: ['年化超額 8.2%', '夏普 1.9'], concepts: ['動量因子', '回測'], claim_type: '實證研究', evidence_level: '中', ...o })
        const domain = createSummarizeDomain({ vocab: { claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] } })
        const SUM_SEAT = { use: 'sum' }
        /** 摘要之設定:修補與忠實性覆核開啟(六個呼叫點中之摘要、修補、覆核皆會發生) */
        const sumSettings = resolveSummarizeSettings({ summarize: { triage: { enabled: false }, ai: SUM_SEAT, standards: { repair: { enabled: true }, faithCheck: { enabled: true, ai: { first: { use: 'f1' }, second: { use: 'f2' } } } } }, capture: { browser: { perRun: 0 } } })
        const sumDocs = () => memStore([{ id: 'd1', status: 'raw', title: '動量研究', text: SRC, url: 'https://e.com/d1', sourceName: 's', sourceTier: 1, collectedAt: NOW, summarizeTries: 2, summarizeProviders: 'p-old' }])
        /** 摘要段之回覆:依提示詞之種類 */
        const reply = (prompt, o) => {
            if (prompt.includes('【需更正之處】')) return { ok: true, data: { repairs: [{ no: 1, value: '夏普值 0.71' }] }, providerId: 'p-sum' }
            if (prompt.includes('忠實性核對員')) {
                const idx = [...prompt.matchAll(/^--- 第(\d+)項 ---$/gm)].map((m) => Number(m[1]))
                return { ok: true, providerId: `p-${o.spec.use}`, data: { checks: idx.map((index) => ({ index, verdict: 'faithful', reason: '' })) } }
            }
            return { ok: true, data: [ITEM()], providerId: 'p-sum' }
        }
        const kindOf = (prompt) => (prompt.includes('【需更正之處】') ? 'repair' : (prompt.includes('忠實性核對員') ? 'faith' : 'summarize'))

        it('摘要段(正式呼叫 ai.callJson):摘要之 callOpt 帶 spec(摘要席)、acceptTruncated:true 與末次重試之 avoid;修補與覆核之 callOpt 不帶 acceptTruncated、不帶 avoid', async () => {
            const calls = []
            const ai = { callJson: async (prompt, check, o) => {
                calls.push({ kind: kindOf(prompt), o })
                return reply(prompt, o)
            } }
            const notes = memStore()
            const r = await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, maxTries: 3 }).run({ deps: { stores: { docs: sumDocs(), notes, frontier: memStore(), holds: memStore() }, settings: sumSettings, ai, clock: fixed, dirs: { notes: `${TMP}/at-real` }, domains: { summarize: domain } }, log })
            assert.deepEqual(calls.map((c) => c.kind), ['summarize', 'repair', 'faith', 'faith'])
            const [s, rp, f1, f2] = calls.map((c) => c.o)
            assert.deepEqual([s.spec, s.acceptTruncated, s.avoid, typeof s.shouldStop, s.budgetMs], [SUM_SEAT, true, ['p-old'], 'function', Infinity])
            for (const [k, o] of [['repair', rp], ['faith-1', f1], ['faith-2', f2]]) {
                assert.deepEqual(['acceptTruncated' in o, 'avoid' in o, typeof o.shouldStop, o.budgetMs], [false, false, 'function', Infinity], k)
            }
            assert.deepEqual([rp.spec, f1.spec, f2.spec], [SUM_SEAT, { use: 'f1' }, { use: 'f2' }])
            assert.equal(r.detail.notes, 1, '流程照常完成')
        })

        it('摘要段(覆寫 opt.callAI):第三參數與正式呼叫同一組鍵(摘要 acceptTruncated:true;修補 segment summarizeRepair、覆核 segment summarizeFaith 皆不帶)', async () => {
            const calls = []
            const callAI = async (prompt, check, o) => {
                calls.push({ kind: kindOf(prompt), o })
                return reply(prompt, o)
            }
            await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, maxTries: 3, callAI }).run({ deps: { stores: { docs: sumDocs(), notes: memStore(), frontier: memStore(), holds: memStore() }, settings: sumSettings, clock: fixed, dirs: { notes: `${TMP}/at-opt` }, domains: { summarize: domain } }, log })
            const by = Object.fromEntries(calls.map((c) => [c.o.segment || c.kind, c.o]))
            assert.deepEqual(Object.keys(by).sort(), ['summarize', 'summarizeFaith', 'summarizeRepair'])
            assert.deepEqual([by.summarize.acceptTruncated, by.summarize.avoid, 'spec' in by.summarize], [true, ['p-old'], false], '摘要:席位由正式呼叫補')
            assert.deepEqual(['acceptTruncated' in by.summarizeRepair, 'acceptTruncated' in by.summarizeFaith, 'avoid' in by.summarizeRepair, 'avoid' in by.summarizeFaith], [false, false, false, false])
        })

        it('預篩與預篩確認(正式呼叫與覆寫 opt.callAI):皆帶 acceptTruncated:true;席位依序為 summarize.triage.ai(未給沿用 summarize.ai)與確認席', async () => {
            const settings = resolveSummarizeSettings({ summarize: { ai: SUM_SEAT, triage: { enabled: true, ai: { use: 'tri' } }, standards: { triageConfirm: { enabled: true, ai: { first: { use: 'cf' } } } } }, capture: { browser: { perRun: 0 } } })
            const docsOf = () => memStore([{ id: 'a', status: 'raw', title: 'A', text: 'x', collectedAt: '2026-06-01' }])
            const triDomain = { buildPrompt: (b) => b.map((d) => d.id).join(','), isValidItem: (it, n) => !!it && Number.isInteger(it.index) && it.index >= 1 && it.index <= n && typeof it.relevant === 'boolean', reasonOf: () => '無關' }
            const calls = []
            const ai = { callJson: async (p, c, o) => {
                calls.push(o)
                return { ok: true, providerId: `p-${o.spec.use}`, data: [{ index: 1, relevant: false, reason: '無關' }] }
            } }
            const r = await stageTriage({ domain: triDomain, docsPerBatch: 1, parallel: 1, rounds: 1 }).run({ deps: { stores: { docs: docsOf() }, settings, ai, clock }, log })
            assert.deepEqual(calls.map((o) => [o.spec.use, o.acceptTruncated, typeof o.shouldStop, o.budgetMs]), [['tri', true, 'function', Infinity], ['cf', true, 'function', Infinity]])
            assert.equal(r.detail.confirmed, 1)
            const viaOpt = []
            await stageTriage({ domain: triDomain, docsPerBatch: 1, parallel: 1, rounds: 1, callAI: async (p, c, o) => {
                viaOpt.push(o)
                return { ok: true, providerId: o.segment ? 'p-cf' : 'p-tri', data: [{ index: 1, relevant: false, reason: '無關' }] }
            } }).run({ deps: { stores: { docs: docsOf() }, settings, clock }, log })
            assert.deepEqual(viaOpt.map((o) => [o.segment || '', o.acceptTruncated, o.spec?.use || '']), [['', true, ''], ['triageConfirm', true, 'cf']])
            // 未給 summarize.triage.ai → 沿用摘要席
            const calls2 = []
            await stageTriage({ domain: triDomain, docsPerBatch: 1, parallel: 1, rounds: 1 }).run({ deps: { stores: { docs: docsOf() }, settings: resolveSummarizeSettings({ summarize: { ai: SUM_SEAT, triage: { enabled: true } } }), ai: { callJson: async (p, c, o) => {
                calls2.push(o)
                return { ok: true, data: [{ index: 1, relevant: true }] }
            } }, clock }, log })
            assert.deepEqual([calls2[0].spec, calls2[0].acceptTruncated], [SUM_SEAT, true])
        })

        it('重標(正式呼叫與覆寫 opt.callAI):帶 acceptTruncated:true、席位 summarize.retag.ai(未給沿用 summarize.ai)、budgetMs＝剩餘−保留', async () => {
            const BASE = { categories: ['方法', '其他'], claimTypes: ['實證研究'], evidenceLevels: ['高', '中', '低'] }
            const dir = `${TMP}/at-retag`
            const ndomain = createSummarizeDomain({ vocab: BASE })
            const recs = ['落點甲', '落點乙'].map((title, i) => {
                const n = buildNote({ k: { title, key_points: ['k'], concepts: ['概念', '概念二'], summary: 's', category: '其他', claim_type: '實證研究', evidence_level: '中' }, doc: { id: `d${i}`, url: `https://example.com/${i}`, sourceName: 's' }, domain: ndomain, notesDir: `${dir}/notes`, nowIso: NOW })
                writeMd(n.file, n.front, n.body)
                return n.record
            })
            const notes = memStore(recs)
            const ctxOf = (vocab, extra) => bagCtx({ stores: { notes }, settings: resolveSummarizeSettings({ ai: { parallel: 1 }, summarize: { ai: SUM_SEAT, retag: { ai: { use: 'rt' } } } }), dirs: { state: `${dir}/state` }, clock: fixed, domains: { retag: createRetagDomain({ vocab }) }, vocab: resolveSummarizeVocab(vocab), ...extra }, log, { remainingMs: () => 10_000_000, expired: () => false })
            /** 依提示詞之標題回類別(甲 → to;其餘維持落點) */
            const answer = (p, to) => ({ ok: true, data: [...p.matchAll(/^\d+\. 【(.+?)】/gm)].map((m, i) => ({ index: i + 1, category: m[1] === '落點甲' ? to : '其他' })) })
            await stageRetag().run(ctxOf(BASE, { ai: {} })) // 首次只記錄
            const v2 = { ...BASE, categories: ['方法', '風控', '其他'] }
            const calls = []
            const ai = { callJson: async (p, c, o) => {
                calls.push(o)
                return answer(p, '風控')
            } }
            const r = await stageRetag({ reserveMs: 1_000_000 }).run(ctxOf(v2, { ai }))
            assert.equal(calls.length, 1)
            assert.deepEqual([calls[0].spec, calls[0].acceptTruncated, calls[0].budgetMs, typeof calls[0].shouldStop], [{ use: 'rt' }, true, 9_000_000, 'function'])
            assert.deepEqual([r.detail.aiChanged, r.detail.aiKept], [1, 1])
            // 覆寫 opt.callAI 亦收同一組鍵(席位由正式呼叫補);保留未給 → budgetMs 為整輪剩餘
            const v3 = { ...BASE, categories: ['方法', '風控', '新類', '其他'] }
            const viaOpt = []
            await stageRetag({ callAI: async (p, c, o) => {
                viaOpt.push(o)
                return { ok: true, data: [{ index: 1, category: '新類' }] }
            } }).run(ctxOf(v3, { ai: {} }))
            assert.deepEqual(viaOpt.map((o) => [o.acceptTruncated, 'spec' in o, o.budgetMs]), [[true, false, 10_000_000]])
        })
    })
})
