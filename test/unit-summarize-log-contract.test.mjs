// unit-summarize-log-contract.test.mjs — 摘要之日誌與報告契約(logContract):外部巡檢判讀摘要段之字樣、正則與 run.json 之 report 鍵,
//   須對得上本套件實際產出之日誌與 report
// 規則(出自 logContract 檔頭):
//   ①SUMMARIZE_LOG_KNOWN／SUMMARIZE_LOG_MUST_SEE 之每一條皆須在本套件之實際日誌(WARN 行)出現;已知字樣命中之行除非另含必看字樣,否則不列;
//     必看字樣為純文字、行內含已知字樣亦須見;兩者為摘要專屬者、批次機制之 AI_BATCH_*(含套用前覆核)與抓取套件核心件之 CORE_LOG_* 之聯集
//   ②不收過寬之字樣(只寫「預篩」者會吞掉摘要段「…皆無預篩結果…」之設定錯誤警告)、不收已無發出者之字樣
//   ③SUMMARIZE_LOG_PARSE 之正則解析實際日誌檔之段落完成行與積壓行,所得數字＝該輪 report 之 detail／stats
//   ④SUMMARIZE_REPORT_KEYS:階段名、子階段鍵、統計鍵與實際 report 一致;各子階段 detail 之鍵集＝實際 report(含各條件路徑)之聯集——
//     實際 report 不得有未列之鍵,列了之鍵亦須在某一實際 report 出現
// 執行:自套件根 node <mocha> test/unit-summarize-log-contract.test.mjs(暫存 test/_tmp/summarize-log-contract-<pid>,測完即刪;真 LMDB、
//   AI 為替身或指向無人監聽之埠 8841,不連外網)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { memStore, scanSource, acquireLock, genClockTZ } from './tools/captureForTest.mjs'
import {
    PKG_ROOT, DEAD_PORT, logsOf, tmpRoot, removeRoots, resetConceptFold, rawDoc, itemOf, scriptedAi, buildTestSummarize, withStores, seedDocs, subReport, fileLogFactory,
} from './tools/summarizeTestKit.mjs'
import { defineMw } from '../src/core/capturePackage.mjs'
import { resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { stageSummarize } from '../src/stages/noteStage.mjs'
import { SUMMARIZE_DOC_STATUS } from '../src/stores/docStatus.mjs'
import { TAXONOMY_STATE_FILE } from '../src/stores/taxonomy.mjs'
import { createSummarizeObject, SUMMARIZE_STAGE_KEYS } from '../src/summarizeObject.mjs'
import { SUMMARIZE_LOG_KNOWN, SUMMARIZE_LOG_MUST_SEE, SUMMARIZE_LOG_PARSE, SUMMARIZE_REPORT_KEYS } from '../src/logContract.mjs'
import { AI_BATCH_LOG_KNOWN, AI_BATCH_REVIEW_LOG_KNOWN, AI_BATCH_LOG_MUST_SEE } from '../src/core/stages/aiBatchStage.mjs'
import { CORE_LOG_KNOWN, CORE_LOG_MUST_SEE } from '../src/core/capturePackage.mjs'

const KNOWN = new RegExp(SUMMARIZE_LOG_KNOWN.join('|'))
const MUST_SEE = new RegExp(SUMMARIZE_LOG_MUST_SEE.join('|'))
const DEAD_BASE = `http://127.0.0.1:${DEAD_PORT}/v1`
/** 已無發出者之字樣(不得列入已知字樣) */
const RETIRED = ['略過非.{0,6}知識', '本批 \\d+ 篇採用', '未涵蓋者留待下輪']

describe('unit-summarize-log-contract', function() {

    this.timeout(120_000)

    let root = ''
    let seq = 0
    const dirOf = (name) => `${root}/${name}-${++seq}`
    /** 各情境之實際產出:{ 名: { lines:Array(全部輪之日誌行), reps:Array(run 之 report) } } */
    const runs = {}

    /**
     * 跑一個情境(總組裝;每輪一個記錄型日誌):寫入文件 → 可選之前置 → run
     *
     * @param {String} name 輸入情境名
     * @param {Object} o 輸入 { cfg:cfg 覆寫, docs:Array, prepare:async (flow, dir) => 任意值, times:執行輪數(預設 1) }
     * @returns {Promise} 回傳 Promise
     */
    const scenario = async (name, o = {}) => {
        const dir = dirOf(name)
        const lg = logsOf()
        const { flow } = buildTestSummarize(dir, { logFactory: lg.factory, ...(o.cfg || {}) })
        if (o.docs?.length) await seedDocs(flow, o.docs)
        if (o.prepare) await o.prepare(flow, dir)
        const reps = []
        for (let i = 0; i < (o.times || 1); i++) reps.push(await flow.run())
        runs[name] = { lines: lg.lines(), reps, flow }
    }
    const NO_TRIAGE = { triage: { enabled: false } }

    before(async () => {
        root = tmpRoot('summarize-log-contract')
        // ── 已知字樣 ──
        // 未涵蓋之終態(已試 2 次者本次未被涵蓋 → 第 3 次標 summarize-failed)
        await scenario('missed', {
            cfg: { summarize: { ...NO_TRIAGE, rounds: 1 }, aiAdapter: scriptedAi((role, p, o, ts) => (role === 'summarize' ? ts.map((t, i) => itemOf(i + 1, t)).filter((x) => x.title !== '甲文件之重點') : undefined)) },
            docs: [rawDoc('a', { title: '甲文件', summarizeTries: 2 }), rawDoc('b', { title: '乙文件' })],
        })
        // 整批失敗之終態(調度層失敗)
        await scenario('batchFail', { cfg: { summarize: NO_TRIAGE, aiAdapter: scriptedAi(() => 'fail') }, docs: [rawDoc('c', { title: '丙文件', summarizeTries: 2 })] })
        // 批次例外(覆寫之提示詞不合契約:組提示詞即拋)
        await scenario('batchThrow', { cfg: { summarize: NO_TRIAGE, prompts: { summarize: () => '' } }, docs: [rawDoc('d')] })
        // 預篩失敗達上限放行交摘要
        await scenario('triageFailOpen', { cfg: { aiAdapter: scriptedAi((role) => (role === 'triage' ? 'fail' : undefined)) }, docs: [rawDoc('e', { triageTries: 1 })] })
        // 套用前覆核中止(忠實性覆核之額度用盡)
        await scenario('reviewStop', {
            cfg: { summarize: { ...NO_TRIAGE, standards: { faithCheck: { enabled: true, ai: { first: { use: 'stub:f1' }, second: { use: 'stub:f2' } } } } }, aiAdapter: scriptedAi((role) => (role === 'faith' ? 'skip' : undefined)) },
            docs: [rawDoc('f')],
        })
        // 時間預算守門(第一批耗盡整輪預算 → 第二批輪起不再開工)
        await scenario('budget', {
            cfg: { deadlineMs: 600, ai: { parallel: 1 }, summarize: { ...NO_TRIAGE, rounds: 2, docsPerCall: 1 }, aiAdapter: scriptedAi(undefined, { delayMs: 800 }) },
            docs: [rawDoc('g1'), rawDoc('g2', { collectedAt: '2026-09-02T00:00:00+08:00' })],
        })
        // 執行鎖持有中略過本輪
        let held = null
        await scenario('locked', {
            cfg: { lock: undefined },
            prepare: async (flow) => {
                held = acquireLock(flow.info().lockFile, { staleMs: 3_600_000 })
                assert.equal(held.ok, true, '前提:測試先取得執行鎖')
            },
        })
        held.release()
        assert.equal(runs.locked.reps[0].lockSkipped, true)
        // 調度層事件:健康降序、免費池額度(內建調度層;條目指向無人監聽之埠)
        const dead = { id: 't:dead', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm' }
        await scenario('health', { cfg: { aiAdapter: undefined, ai: { extraProviders: [dead], healthStreak: 1 }, summarize: { ...NO_TRIAGE, ai: { use: 't:dead' } } }, docs: [rawDoc('h')] })
        const ocLog = `${root}/opencode.log`
        fs.writeFileSync(ocLog, `timestamp=${new Date().toISOString()} level=ERROR providerID=opencode modelID=mimo-v2.6-flash-free error.error="AI_APICallError: Rate limit exceeded. Please try again later."\n`, 'utf8')
        await scenario('pool', { cfg: { aiAdapter: undefined, ai: { extraProviders: [dead], pools: { oc: { log: ocLog, resetUtcHour: 0 } } }, summarize: { ...NO_TRIAGE, ai: { use: 't:dead' } } }, docs: [rawDoc('i')] })
        // ── 必看字樣 ──
        // 逐項鏈異常(動作鏈之環拋錯)
        const boom = defineMw({ name: 'boom', handle: async () => {
            throw new Error('寫入層壞了')
        } })
        await scenario('chainFail', { cfg: { summarize: NO_TRIAGE, stageOpts: { summarize: { tap: { persistNote: { before: [boom] } } } } }, docs: [rawDoc('j')] })
        // 分類法守門(狀態檔無法解析)
        await scenario('taxonomyGuard', {
            prepare: async (flow) => {
                const st = flow.info().dirs.state
                fs.mkdirSync(st, { recursive: true })
                fs.writeFileSync(path.join(st, TAXONOMY_STATE_FILE), '{ 壞掉之檔', 'utf8')
            },
        })
        // 本機網路不通(注入之網路判斷器確認不通;內建調度層)
        await scenario('netDown', {
            cfg: { aiAdapter: undefined, netGuard: { check: async () => ({ up: false }), confirmDown: async () => true, isDown: () => true, describe: () => '' }, ai: { extraProviders: [dead] }, summarize: { ...NO_TRIAGE, ai: { use: 't:dead' } } },
            docs: [rawDoc('k')],
        })
        // 筆記之 md 讀不到
        await scenario('mdMissing', {
            prepare: async (flow, dir) => withStores(flow, async (s) => {
                await s.notes.insertNew([{ id: 'gone', title: '已刪除之筆記', concepts: ['甲概念', '乙概念'], file: `${dir}/knowledge/notes/gone.md`, syncHash: 'x' }])
            }),
        })
        // 設定矛盾:預篩停用而摘要明給只取已放行者
        await scenario('noTriageResult', { cfg: { stageOpts: { triage: { enabled: false }, summarize: { requireTriage: true } } }, docs: [rawDoc('l')] })
        // ── report 之條件路徑 ──
        // 預篩第二席確認、欄位定向修補、閘門待判;重標與同步停用
        await scenario('confirmRepair', {
            cfg: {
                summarize: { standards: { triageConfirm: { enabled: true, ai: { first: { use: 'stub:confirm' } } }, repair: { enabled: true } } },
                stageOpts: { retag: { enabled: false }, sync: { enabled: false } },
                aiAdapter: scriptedAi((role, p, o, ts) => {
                    if (role === 'triage') return ts.map((t, i) => ({ index: i + 1, relevant: t !== '無關文件', reason: '與知識庫無關之例行公告' }))
                    if (role === 'summarize') return ts.map((t, i) => itemOf(i + 1, t, t === '殘缺文件' ? { concepts: ['孤立概念'] } : {}))
                    return undefined
                }),
            },
            docs: [rawDoc('m1', { title: '知識文件' }), rawDoc('m2', { title: '無關文件' }), rawDoc('m3', { title: '殘缺文件' })],
        })
        // 預篩與摘要扣保留給後段之時間而延後(整輪預算 10 分、各段保留近全部 → 扣保留後剩餘 < 一次呼叫:不開工,文件留池;detail.deferred)
        await scenario('reserveDefer', {
            cfg: { deadlineMs: 600_000, stageOpts: { triage: { reserveMs: 599_990 }, summarize: { reserveMs: 599_990 } } },
            docs: [rawDoc('q1'), rawDoc('q2', { triage: 'relevant' })],
        })
        // 確認席關閉而依預篩攔下之待確認件(池中無待預篩者)
        await scenario('confirmClosed', { docs: [rawDoc('n', { triage: 'reject-pending', triagedAt: '2026-10-01T00:00:00+08:00', triageRejectBy: 'stub', triageRejectReason: '與知識庫無關之例行公告' })] })
        // 批次例外之落帳失敗(寫入層故障;子階段直接執行:組提示詞拋錯、其落帳又因寫入失敗而拋)
        const docs = memStore([rawDoc('w1')])
        docs.patch = async () => {
            throw new Error('寫入層壞了')
        }
        const wlog = logsOf().factory()
        const domain = { ...createSummarizeDomain({}), buildPrompt: () => {
            throw new Error('提示詞壞了')
        } }
        const deps = { stores: { docs, notes: memStore(), frontier: memStore() }, settings: resolveSummarizeSettings({ summarize: NO_TRIAGE }), clock: genClockTZ('Asia/Taipei'), dirs: { notes: `${root}/w/notes`, state: `${root}/w/state` }, domains: { summarize: domain } }
        await stageSummarize({ rounds: 1 }).run({ deps, log: wlog })
        runs.writeFail = { lines: wlog.lines, reps: [] }
    })

    after(() => {
        resetConceptFold()
        removeRoots([root])
    })

    /** 全部情境之 WARN 行 */
    const warnLines = () => Object.values(runs).flatMap((r) => r.lines || []).filter((l) => l.startsWith('WARN '))

    // ══════════════════════════ 字樣 ══════════════════════════
    describe('已知與必看字樣', function() {

        it('三類皆為可編譯之正則;必看字樣為純文字(不含正則語法,併入總表不改他人之語意);皆凍結', () => {
            assert.ok(SUMMARIZE_LOG_KNOWN.length > 0 && SUMMARIZE_LOG_MUST_SEE.length > 0)
            for (const p of [...SUMMARIZE_LOG_KNOWN, ...SUMMARIZE_LOG_MUST_SEE]) assert.doesNotThrow(() => new RegExp(p), p)
            for (const p of SUMMARIZE_LOG_MUST_SEE) assert.ok(!/[\\^$.*+?()[\]{}|]/.test(p), `必看字樣不含正則語法:${p}`)
            for (const re of Object.values(SUMMARIZE_LOG_PARSE)) assert.ok(re instanceof RegExp)
            assert.ok(Object.isFrozen(SUMMARIZE_LOG_KNOWN) && Object.isFrozen(SUMMARIZE_LOG_MUST_SEE) && Object.isFrozen(SUMMARIZE_LOG_PARSE) && Object.isFrozen(SUMMARIZE_REPORT_KEYS))
            assert.ok(SUMMARIZE_LOG_KNOWN.includes(`標為 ${SUMMARIZE_DOC_STATUS.failed}`), '終態之字樣取自文件狀態之值')
        })

        it('字樣由發出者宣告、以聯集組成:摘要專屬者＋批次機制(本段給套用前覆核)之 AI_BATCH_*＋抓取套件核心件之 CORE_LOG_*;批次機制之宣告逐字;皆凍結', () => {
            assert.deepEqual([...AI_BATCH_LOG_KNOWN], ['批次 AI 失敗', '批次異常', '批次：逾時間預算'])
            assert.deepEqual([...AI_BATCH_REVIEW_LOG_KNOWN], ['套用前覆核中止'])
            assert.deepEqual([...AI_BATCH_LOG_MUST_SEE], ['批次異常之落帳失敗'])
            assert.ok([AI_BATCH_LOG_KNOWN, AI_BATCH_REVIEW_LOG_KNOWN, AI_BATCH_LOG_MUST_SEE].every(Object.isFrozen))
            assert.deepEqual([...SUMMARIZE_LOG_KNOWN], ['未被模型完整涵蓋', '摘要批次失敗', '標為 summarize-failed', '放行交摘要', ...AI_BATCH_LOG_KNOWN, ...AI_BATCH_REVIEW_LOG_KNOWN, ...CORE_LOG_KNOWN])
            assert.deepEqual([...SUMMARIZE_LOG_MUST_SEE], ['逐項鏈異常', '分類法守門', '篇筆記之 md 讀不到', '皆無預篩結果', ...AI_BATCH_LOG_MUST_SEE, ...CORE_LOG_MUST_SEE])
            assert.equal(new Set(SUMMARIZE_LOG_KNOWN).size, SUMMARIZE_LOG_KNOWN.length, '已知字樣不重複')
            assert.equal(new Set(SUMMARIZE_LOG_MUST_SEE).size, SUMMARIZE_LOG_MUST_SEE.length, '須見字樣不重複')
        })

        it('①已知字樣:每一條皆命中實際日誌之 WARN 行(由情境之真實執行產出)', () => {
            const lines = warnLines()
            const miss = SUMMARIZE_LOG_KNOWN.filter((p) => !lines.some((l) => new RegExp(p).test(l)))
            assert.deepEqual(miss, [], `未在實際日誌出現之已知字樣(情境未涵蓋或字樣已改):\n${lines.join('\n')}`)
        })

        it('①必看字樣:每一條皆命中實際日誌之 WARN 行;行首為已知字樣者(批次 AI 失敗＋本機網路不通)仍須見', () => {
            const lines = warnLines()
            const miss = SUMMARIZE_LOG_MUST_SEE.filter((p) => !lines.some((l) => l.includes(p)))
            assert.deepEqual(miss, [], `未在實際日誌出現之必看字樣:\n${lines.join('\n')}`)
            const net = lines.find((l) => l.includes('本機網路不通'))
            assert.ok(KNOWN.test(net) && MUST_SEE.test(net), `斷網之行之行首為已知之「批次 AI 失敗」,仍須見:${net}`)
            assert.match(net, /^WARN 批次 AI 失敗（本機網路不通（不計此次之失敗）：/)
        })

        it('實際日誌之代表行逐字:未涵蓋與整批失敗之終態、預篩放行、逐項鏈異常、分類法守門、md 讀不到、時間預算守門、覆核中止、略過本輪、調度層事件', () => {
            const has = (name, re) => assert.ok(runs[name].lines.some((l) => re.test(l)), `${name}:\n${runs[name].lines.join('\n')}`)
            has('missed', /^WARN 摘要：\[甲文件\] 未被模型完整涵蓋（缺席或項目不合格式）（第 3 次），標為 summarize-failed$/)
            has('batchFail', /^WARN 批次 AI 失敗（stub 失敗，試 1 次）→ $/)
            has('batchFail', /^WARN 摘要：\[丙文件\] 摘要批次失敗（輸出截斷／驗證不過）（第 3 次），標為 summarize-failed$/)
            has('batchThrow', /^WARN 批次異常：opt\.prompts\.summarize 須回傳非空字串$/)
            has('triageFailOpen', /^WARN 預篩：\[測試文件e\] 預篩批次失敗（輸出截斷／驗證不過）（第 2 次），放行交摘要$/)
            has('reviewStop', /^WARN 批次：套用前覆核中止（時間預算／額度），本批 1 項不套用、不記 tries（留佇列）$/)
            has('budget', /^WARN 批次：逾時間預算，第 2\/2 輪起不再開工（未取件者留佇列）$/)
            has('locked', /^WARN 管道\[知識摘要\] 略過本輪：/)
            has('health', /^WARN 供應商健康：t:dead 連續 1 次 \S+ 失敗（.*），降序冷卻$/)
            has('pool', /^WARN 供應商額度：oc:opencode\/mimo-v2\.6-flash-free 自 /)
            has('chainFail', /^WARN 摘要：\[測試文件j\] 逐項鏈異常：.*寫入層壞了.*（第 1 次；程式或寫入問題，不標終態，修復後重做）$/)
            has('taxonomyGuard', /^WARN 分類法守門：分類法狀態檔無法解析或格式版本不符（.*）.*；本輪不重標$/)
            has('mdMissing', /^WARN 筆記同步：1 篇筆記之 md 讀不到（記錄仍在；例 gone）——不自動視為刪除/)
            has('noTriageResult', /^WARN 摘要：raw 池 1 篇皆無預篩結果而本段只取已放行者——預篩段停用或未執行？/)
            has('missed', /^WARN 啟動期檢核：未給 scheduleLimitMin 亦未給 deadlineMs/)
            has('writeFail', /^WARN 批次異常：提示詞壞了$/)
            has('writeFail', /^WARN 批次異常之落帳失敗：寫入層壞了$/)
        })

        it('②不收過寬之字樣:「預篩」單獨不列(否則吞掉「…皆無預篩結果…」之設定錯誤警告);該警告不命中已知字樣、命中必看字樣', () => {
            assert.ok(!SUMMARIZE_LOG_KNOWN.includes('預篩'))
            const line = runs.noTriageResult.lines.find((l) => l.includes('皆無預篩結果'))
            assert.ok(new RegExp('預篩').test(line), '前提:過寬之「預篩」會命中此行')
            assert.equal(KNOWN.test(line), false, '已知字樣不得吞掉設定錯誤之警告')
            assert.equal(MUST_SEE.test(line), true)
        })

        it('②不收已無發出者之字樣:已知字樣表不列;原始碼(非測試)之日誌呼叫(log.warn／info／error 之行;樣板之插值以數字代入)與實際日誌皆不含之', () => {
            for (const p of RETIRED) assert.ok(!SUMMARIZE_LOG_KNOWN.includes(p), p)
            const walk = (rel) => fs.readdirSync(path.join(PKG_ROOT, 'src', rel), { withFileTypes: true }).flatMap((d) => {
                const r = rel ? `${rel}/${d.name}` : d.name
                if (d.isDirectory()) return /^(test|node_modules|_tmp)$/.test(d.name) ? [] : walk(r)
                return r.endsWith('.mjs') ? [r] : []
            })
            const files = walk('')
            assert.ok(files.length >= 40, `掃描量過少:${files.length}`)
            const hits = []
            let logCalls = 0
            for (const f of files) {
                const lines = scanSource(fs.readFileSync(path.join(PKG_ROOT, 'src', f), 'utf8')).code.split('\n').filter((l) => /\blog\??\.(warn|info|error)\??\.?\(/.test(l))
                logCalls += lines.length
                for (const l of lines) for (const p of RETIRED) if (new RegExp(p).test(l.replace(/\$\{[^}]*\}/g, '0'))) hits.push(`${f}：${p}`)
            }
            assert.ok(logCalls >= 40, `日誌呼叫之行過少(掃描空洞):${logCalls}`)
            assert.deepEqual(hits, [])
            assert.deepEqual(warnLines().filter((l) => RETIRED.some((p) => new RegExp(p).test(l))), [])
        })
    })

    // ══════════════════════════ 正則 ══════════════════════════
    describe('逐輪數字之正則(SUMMARIZE_LOG_PARSE)', function() {

        it('③真實日誌檔(套件之日誌器)之段落完成行與積壓行解析所得＝report 之 detail／stats;aiCalls 取第一個「（AI N 次）」＝摘要子階段之呼叫數(預篩之次數另附其後)', async () => {
            const dir = dirOf('parse')
            let flow = null
            const ai = scriptedAi((role, p, o, ts) => (role === 'summarize' ? ts.map((t, i) => itemOf(i + 1, t, t === '無知識文件' ? { relevant: false, reason: '純新聞快訊' } : {})) : undefined))
            ;({ flow } = buildTestSummarize(dir, { aiAdapter: ai, logFactory: fileLogFactory(() => flow), summarize: { triage: { docsPerCall: 1 } } }))
            await seedDocs(flow, [rawDoc('p1', { title: '知識文件' }), rawDoc('p2', { title: '無知識文件', rawAt: '2026-08-01T00:00:00+08:00' })])
            const rep = await flow.run()
            const text = fs.readFileSync(rep.summaryFile.replace(/-run\.json$/, '-run.log'), 'utf8')
            const num = (re) => {
                const m = text.match(re)
                return m ? Number(m[1]) : null
            }
            const tri = subReport(rep, '摘要', 'triage')
            const sm = subReport(rep, '摘要', 'summarize')
            assert.deepEqual([tri.stats.aiCalls, sm.stats.aiCalls], [2, 1], '前提:預篩與摘要之呼叫數不同(正則須取摘要者)')
            const parsed = Object.fromEntries(Object.entries(SUMMARIZE_LOG_PARSE).map(([k, re]) => [k, num(re)]))
            assert.deepEqual(parsed, {
                processed: sm.detail.processed, notes: sm.detail.notes, skipped: sm.detail.skipped, aiCalls: sm.stats.aiCalls,
                rawPool: sm.detail.pool, rawDays: sm.detail.poolOldestDays,
            }, text.split('\n').filter((l) => /摘要 完成|raw 池/.test(l)).join('\n'))
            assert.deepEqual([parsed.processed, parsed.notes, parsed.skipped, parsed.rawPool], [2, 1, 1, 2])
            assert.ok(parsed.rawDays >= 60, `最舊者之天數:${parsed.rawDays}`)
            // 預篩停用時之積壓行(無「，已預篩放行 K」)亦可解析;最舊天數未知(「-」)者不給數字
            assert.deepEqual(['raw 池 3 篇（最舊 4 天），本輪容量 54', 'raw 池 3 篇（最舊 - 天），本輪容量 54'].map((l) => [Number(l.match(SUMMARIZE_LOG_PARSE.rawPool)[1]), l.match(SUMMARIZE_LOG_PARSE.rawDays)?.[1] ?? null]), [[3, '4'], [3, null]])
        })
    })

    // ══════════════════════════ report 鍵 ══════════════════════════
    describe('report 之鍵(SUMMARIZE_REPORT_KEYS)', function() {

        /** 全部情境之摘要段 report(未取得鎖者無) */
        const stageReports = () => Object.values(runs).flatMap((r) => r.reps || []).map((rep) => (rep.stages || []).find((s) => s.name === SUMMARIZE_REPORT_KEYS.stage)).filter(Boolean)

        it('④階段名與子階段鍵:實際 report 之段名即 stage、子階段依序即 subStages(＝摘要物件之預設名與子階段——物件取本契約之同一實體,只定義一次);統計鍵即 stats', () => {
            assert.equal(SUMMARIZE_REPORT_KEYS.stage, createSummarizeObject().name)
            assert.equal(SUMMARIZE_STAGE_KEYS, SUMMARIZE_REPORT_KEYS.subStages, '物件之子階段鍵即本契約之 subStages(同一實體)')
            const reps = stageReports()
            assert.ok(reps.length >= 10, `情境之 report 過少:${reps.length}`)
            for (const st of reps) {
                assert.deepEqual(Object.keys(st.result.detail), [...SUMMARIZE_REPORT_KEYS.subStages])
                assert.deepEqual(Object.keys(st.result.stats).sort(), [...SUMMARIZE_REPORT_KEYS.stats].sort())
                for (const sub of SUMMARIZE_REPORT_KEYS.subStages) assert.deepEqual(Object.keys(st.result.detail[sub].stats).sort(), [...SUMMARIZE_REPORT_KEYS.stats].sort(), sub)
            }
        })

        it('④各子階段 detail 之鍵集＝實際 report(各條件路徑:停用、池空、第二席確認、確認席關閉、忠實性覆核、修補、待判、狀態檔無法解析、跑完)之聯集:無未列之鍵、無未出現之鍵', () => {
            const seen = Object.fromEntries(SUMMARIZE_REPORT_KEYS.subStages.map((k) => [k, new Set()]))
            for (const st of stageReports()) {
                for (const sub of SUMMARIZE_REPORT_KEYS.subStages) for (const k of Object.keys(st.result.detail[sub].detail || {})) seen[sub].add(k)
            }
            for (const sub of SUMMARIZE_REPORT_KEYS.subStages) {
                const declared = [...SUMMARIZE_REPORT_KEYS.detail[sub]].sort()
                assert.deepEqual([...seen[sub]].filter((k) => !declared.includes(k)).sort(), [], `${sub} 之實際 report 有未列之鍵`)
                assert.deepEqual(declared.filter((k) => !seen[sub].has(k)), [], `${sub} 列了而未在實際 report 出現之鍵(情境未涵蓋或鍵已改)`)
            }
        })

        it('④deferred:預篩與摘要因扣保留時間後不足一次呼叫而延後時附 deferred:true(AI 0 次、文件留池);未保留之情境(含一般逾時截止 budget)不附——巡檢據以分辨時間不足與容量不足', () => {
            const d = runs.reserveDefer.reps[0].stages[0].result.detail
            assert.deepEqual([d.triage.detail.deferred, d.triage.detail.stopped, d.triage.stats.aiCalls], [true, true, 0])
            assert.deepEqual([d.summarize.detail.deferred, d.summarize.detail.stopped, d.summarize.stats.aiCalls], [true, true, 0])
            for (const [name, run] of Object.entries(runs)) {
                if (name === 'reserveDefer') continue
                for (const rep of run.reps) for (const st of rep.stages || []) for (const sub of ['triage', 'summarize']) assert.ok(!('deferred' in (st.result?.detail?.[sub]?.detail || {})), `${name}.${sub} 不應附 deferred`)
            }
            assert.ok(runs.reserveDefer.lines.some((l) => /預篩：扣保留時間後剩餘.*不足一次呼叫/.test(l)) && runs.reserveDefer.lines.some((l) => /摘要：扣保留時間後剩餘.*不足一次呼叫/.test(l)), '日誌寫明')
            assert.ok(!runs.reserveDefer.lines.some((l) => l.startsWith('WARN ')), '延後為常態訊息(INFO),不洗版 WARN')
        })

        it('④巡檢所讀之鍵於子階段實際執行時皆在:摘要之 processed／notes／skipped／pool／poolOldestDays／stopped、預篩之 processed／irrelevant、重標之 changed／jobsPending／deferred／guards／version、同步之 changed／mdMissing', () => {
            const st = runs.missed.reps[0].stages[0].result.detail
            for (const k of ['processed', 'notes', 'skipped', 'pool', 'poolOldestDays', 'stopped', 'materialRefetch', 'truncated', 'categoryOffList']) assert.ok(k in st.summarize.detail, `summarize.${k}`)
            const tri = runs.confirmRepair.reps[0].stages[0].result.detail.triage.detail
            for (const k of ['processed', 'irrelevant', 'relevant', 'materialRefetch']) assert.ok(k in tri, `triage.${k}`)
            for (const k of ['changed', 'jobsPending', 'deferred', 'guards', 'version']) assert.ok(k in st.retag.detail, `retag.${k}`)
            for (const k of ['changed', 'mdMissing']) assert.ok(k in st.sync.detail, `sync.${k}`)
        })
    })

    // ══════════════════════════ 已知與必看之交疊 ══════════════════════════
    describe('已知與必看之交疊', function() {

        it('巡檢之判準(列出＝非已知或為必看):常態之失敗與守門不列;行首為已知字樣而含必看字樣者(批次例外之落帳失敗、斷網之批次失敗)仍列', () => {
            const visible = (l) => !KNOWN.test(l) || MUST_SEE.test(l)
            const pick = (name, re) => runs[name].lines.find((l) => re.test(l))
            for (const [name, re] of [['batchFail', /^WARN 批次 AI 失敗（stub/], ['missed', /^WARN 摘要：\[甲文件\]/], ['triageFailOpen', /放行交摘要$/], ['budget', /逾時間預算/], ['reviewStop', /套用前覆核中止/], ['health', /供應商健康/]]) {
                const l = pick(name, re)
                assert.ok(l, `${name}:${runs[name].lines.join('\n')}`)
                assert.equal(visible(l), false, `常態不列:${l}`)
            }
            for (const [name, re] of [['writeFail', /^WARN 批次異常之落帳失敗/], ['netDown', /本機網路不通/], ['chainFail', /逐項鏈異常/], ['taxonomyGuard', /分類法守門/], ['noTriageResult', /皆無預篩結果/]]) {
                const l = pick(name, re)
                assert.ok(l, name)
                assert.equal(visible(l), true, `須見:${l}`)
            }
            assert.ok(KNOWN.test(pick('writeFail', /^WARN 批次異常之落帳失敗/)), '前提:落帳失敗之行首為已知之「批次異常」')
        })
    })
})
