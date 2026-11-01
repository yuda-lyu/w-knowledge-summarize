// unit-summarize-assembly.test.mjs — 總組裝 createKnowledgeSummarize 與執行期件 createSummarizeRuntime 之嚴格性與接線
// 規則(出自 createKnowledgeSummarize 與 summarizeRuntime 檔頭):
//   ①設定錯誤一律啟動期拋錯,不靜默沿用預設:cfg 之未知鍵、各鍵之形狀、設定三段(ai／summarize／capture)、資料、提示詞、domain、子階段、
//     啟用之功能所需之 domain 成員與判定小組席位、AI 席位皆於建構期驗;訊息點名錯誤之鍵並列可用鍵;CFG_KEYS 與實際讀取者一致
//   ②形狀錯誤之訊息不被席位檢核搶先;給了卻無效之執行期數值鍵(排程上限、時間預算、鎖陳舊期限)視同未給並以啟動期警告指名
//   ③生效之 domain 只有一份:cfg.prompts 覆寫內建者之提示詞、cfg.domains 整組置換(兩者給在同一 domain 即拋);每輪 deps.domains 即 info().domains
//   ④核心集合為選用(cfg.cores);去重身分與人工匯入同一身分(cfg.dedup);本機網路判斷(cfg.netGuard:null／注入／依設定建)交 AI 調度層,
//     斷網時整鏈皆敗記 skipped、不記 tries
//   ⑤零設定(僅 workDir＋AI 替身)即可跑一輪並寫出筆記至 <workDir>/knowledge/notes
//   ⑥AI 調度層:建構選項開失敗預覽與條目固有之 prompt 長度預篩、不開截斷放行(陣列輸出之呼叫點逐次給);席位檢核取 summarizeSeatsOf;
//     判定小組同家警告;調度層事件(健康／額度／能力)寫入當輪日誌(注入調度層者不接)
//   ⑦重標之保留時間經 cfg.stageOpts.retag.reserveMs 生效;每輪依賴只放可列舉之普通屬性;info() 之共同欄＋identity
// 執行:自套件根 node <mocha> test/unit-summarize-assembly.test.mjs(暫存 test/_tmp/summarize-assembly-<pid>,測完即刪;真 LMDB、AI 為替身、
//   本機假 REST(固定埠 8842)或指向無人監聽之埠 8841,不連外網)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import WOrmLmdb from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import {
    createKnowledgeSummarize, CFG_KEYS, DATA_KEYS, PROMPT_KEYS, COLLECTION_KEYS,
} from '../src/createKnowledgeSummarize.mjs'
import { createSummarizeRuntime, SUMMARIZE_STORE_KEYS, SUMMARIZE_DATA_KEYS, SUMMARIZE_DIRS, SUMMARIZE_DOMAIN_KEYS, SUMMARIZE_PROMPT_SIGS, resolveSummarizeData } from '../src/summarizeRuntime.mjs'
import { SUMMARIZE_STAGE_KEYS } from '../src/summarizeObject.mjs'
import { resolveSummarizeSettings, summarizeSeatsOf } from '../src/core/summarizeSettings.mjs'
import { resolveSummarizeVocab, pickSummarizeVocab } from '../src/core/vocab/summarizeVocab.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { createTriageDomain } from '../src/domain/triageDomain.mjs'
import { createRetagDomain } from '../src/domain/retagDomain.mjs'
import { ingestNotes } from '../src/ops/ingestNotes.mjs'
import { auditSummarizeStandards, SUMMARIZE_AUDITED_STANDARD_IDS } from '../src/standards/audit.mjs'
import { readMd } from '../src/core/md/md.mjs'
import { stdReport, normalizeConcept } from '../src/core/capturePackage.mjs'
import { setConceptFold, expandDirs, RUNTIME_CFG_KEYS, msgOf, startServer } from './tools/captureForTest.mjs'
import {
    PKG_ROOT, DEAD_PORT, FIXED_CLOCK, silentLog, recLog, logsOf, tmpRoot, removeRoots, rawDoc, itemOf, scriptedAi, buildTestSummarize, withStores, seedDocs,
    subReport, findFiles, readJsonFile, titlesOf,
} from './tools/summarizeTestKit.mjs'

const MIN = 60_000
const DEAD_BASE = `http://127.0.0.1:${DEAD_PORT}/v1` // 無人監聽:連線即被拒
const REST_PORT = 8842 // 本機假 REST(固定埠;本檔專屬)
const REST_BASE = `http://127.0.0.1:${REST_PORT}/v1`
const stubAi = scriptedAi(() => {
    throw new Error('本案不應呼叫 AI')
})

/**
 * 從錯誤訊息「（可用：a、b、c）」取出系統自己列出之可用鍵(鍵集由系統推導,不手列)
 *
 * @param {Function} fn 輸入會拋含「可用：」訊息之函數
 * @returns {Array} 回傳可用鍵陣列
 */
const availableKeysOf = (fn) => {
    let m = ''
    try {
        fn()
    }
    catch (e) {
        m = String(e.message)
    }
    const hit = /（可用：([^）]+)）/.exec(m)
    assert.ok(hit, `訊息須列出可用鍵:${m}`)
    return hit[1].split('、')
}

/** 去掉整行註解(`//`、`*`、`/*` 起頭者)後之原始碼(靜態掃描讀取點用) */
const codeOnly = (text) => text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

// ── cfg 逐鍵之錯值(皆須拋錯並點名該鍵)、寬容鍵(無效值僅警告)、有效值(須被接受) ──
const MORE_WRONG = (extra) => ['x', 5, [], ...extra]
const STRICT = {
    workDir: { wrong: [5, '', {}, [], null], name: /需要 workDir/, valid: ['C:/x/y'] },
    name: { wrong: [5, '', {}, [], true, false], name: /cfg\.name 須為非空字串/, valid: ['自訂管線名'] },
    dirs: { wrong: MORE_WRONG([{ zzz: 'a' }, { db: 5 }, { notes: '' }]), name: /cfg\.dirs/, valid: [{}, { notes: 'D:/vault/notes' }] },
    timeZone: { wrong: [5, '', {}, 'Nowhere/City'], name: /cfg\.timeZone/, valid: ['UTC', 'Asia/Taipei'] },
    clock: { wrong: [{}, 'x', 5], name: /cfg\.clock/, valid: [FIXED_CLOCK] },
    lang: { wrong: [5, '', {}, [], true, '!!', 'zh_TW'], name: /cfg\.lang/, valid: ['zh-TW', 'en', 'ja'] },
    data: { wrong: MORE_WRONG([{ zzz: 1 }, { vocab: 5 }, { vocab: 'x' }, { seedSources: [] }]), name: /cfg\.data/, valid: [{}, { vocab: { domain: '天文學' } }] },
    prompts: { wrong: MORE_WRONG([{ zzz: 1 }, { summarize: 'x' }, { area: () => 'p' }]), name: /cfg\.prompts/, valid: [{}, { triage: () => 'p' }] },
    domains: { wrong: MORE_WRONG([{ zzz: {} }, { summarize: 5 }, { summarize: {} }, { relate: {} }]), name: /cfg\.domains/, valid: [{}, { summarize: createSummarizeDomain({}) }] },
    conceptFold: { wrong: ['x', 5, {}], name: /cfg\.conceptFold/, valid: [true, false, (t) => t] },
    ai: { wrong: MORE_WRONG([{ zzz: 1 }, { providerPick: [] }, { parallel: 0 }, { timeoutMs: 0 }]), name: /settings\.ai/, valid: [{}, { parallel: 2 }] },
    summarize: { wrong: MORE_WRONG([{ zzz: 1 }, { rounds: 'x' }, { triage: { passRate: 2 } }, { standards: { triageConfirm: { ai: { second: null } } } }]), name: /settings\.summarize/, valid: [{}, { rounds: 8 }] },
    capture: { wrong: MORE_WRONG([{ zzz: 1 }, { articles: { perRun: 'x' } }]), name: /settings\.capture/, valid: [{}, { articles: { perRun: 3 } }] },
    scheduleLimitMin: { warn: ['abc', -1, 0, {}, [], true], valid: [55, '65'] },
    deadlineMs: { warn: ['abc', -1, 0, {}, [], true], valid: [600_000] },
    lockStaleMs: { warn: ['abc', -1, 0, {}, [], true], valid: [3_600_000] },
    lock: { wrong: [5, {}, []], name: /cfg\.lock/, valid: [false, true, 'x/run.lock'] },
    envFile: { wrong: [5, {}, [], true], name: /cfg\.envFile/, valid: ['sec/.env'] },
    aiWorkspace: { wrong: [5, {}, [], true], name: /cfg\.aiWorkspace/, valid: ['x/ws'] },
    aiAdapter: { wrong: [{}, 5, 'x', [], false, 0], name: /cfg\.aiAdapter/, valid: [stubAi] },
    // 內建調度層之建構選項(抓取套件 buildAiAdapter 驗鍵集;注入 aiAdapter 時亦驗)
    aiOptions: { wrong: ['x', 5, [], true, { zzz: 1 }], name: /cfg\.aiOptions/, valid: [{}, { exes: {} }] },
    stages: { wrong: [[], 'x', 5, {}, [{ name: 'a' }]], name: /cfg\.stages/, valid: [[{ name: 'a', run: async () => ({}) }]] },
    stageOpts: { wrong: MORE_WRONG([{ zzz: {} }, { triage: 5 }, { retag: { reserveMs: -1 } }]), name: /cfg\.stageOpts|reserveMs/, valid: [{}, { retag: {} }] },
    dedup: { wrong: ['x', 5, [], { keyOf: 'nope' }, true], name: /主鍵策略/, valid: [{ keyOf: 'raw' }] },
    lmdb: { wrong: MORE_WRONG([{ zzz: 1 }, { WOrm: {} }, { path: '' }, { db: 5 }, { cls: 'x' }]), name: /cfg\.lmdb/, valid: [{}, { db: 'other' }] },
    cores: { wrong: [5, {}, [], 0], name: /cfg\.cores/, valid: [true, false, 'myCores'] },
    logFactory: { wrong: [5, 'x', {}, [], 0, false], name: /cfg\.logFactory/, valid: [() => recLog()] },
    afterRun: { wrong: [5, true, 'x', {}, [], 0], name: /cfg\.afterRun/, valid: [false, () => ({})] },
    netGuard: { wrong: ['x', 5, [], false, 0, true], name: /cfg\.netGuard/, valid: [null, { check: async () => ({ up: true }) }] },
}

// ── 本機假 REST(OpenAI 相容;共用之 startServer,命中紀錄為 srv.hits〔{ model, prompt, … }〕):依 model(情境)選回應 ──
/**
 * 假 REST 之回應(startServer 之 opt.sceneOf):plain＝純文字(非 JSON)、trunc＝陣列截斷(finish_reason=length);summ＝依提示詞中本批之標題作答合格項目,
 *   最後一項截在半途(finish_reason=length)——REST 截斷之部分接受;其餘情境一律回純文字(故共用之情境表不被取用)
 *
 * @param {String} scene 輸入情境(model 名「情境~延遲毫秒」之情境部分;本檔之 model 皆無延遲尾碼)
 * @param {String} prompt 輸入提示詞(最後一則訊息)
 * @returns {Object} 回傳 { content, fr }
 */
function sceneOf(scene, prompt) {
    if (scene === 'trunc') return { fr: 'length', content: '[{"index":1,"v":"a"},{"index":2,"v":"b' }
    if (scene === 'summ') {
        const ts = titlesOf(prompt)
        const full = ts.map((t, i) => JSON.stringify(itemOf(i + 1, t)))
        const last = full.pop() || ''
        return { fr: 'length', content: `[${[...full, last.slice(0, Math.floor(last.length / 2))].join(',')}` }
    }
    return { fr: 'stop', content: '好的，這是純文字回覆，不是 JSON。' }
}

describe('unit-summarize-assembly', function() {

    this.timeout(120_000)

    let root = ''
    let srv = null
    before(async () => {
        root = tmpRoot('summarize-assembly')
        srv = await startServer({ port: REST_PORT, sceneOf })
    })
    after(async () => {
        setConceptFold(null) // 概念折疊為模組級單例,不留給同 worker 之他檔
        await srv.close()
        removeRoots([root])
    })

    let seq = 0
    const dirOf = (name = 'c') => `${root}/${name}-${++seq}`
    // 預設組裝:替身 AI、不探測網路、不上鎖、靜音日誌;extra 逐鍵覆寫
    const build = (extra = {}) => createKnowledgeSummarize({ workDir: dirOf(), aiAdapter: stubAi, netGuard: null, lock: false, logFactory: () => silentLog, ...extra })

    // ══════════════════════════ ① cfg 逐鍵嚴格性 ══════════════════════════
    describe('cfg 逐鍵嚴格性(CFG_KEYS 全部鍵 × 錯值／寬容／有效值)', function() {

        it('案例表之鍵集等於 CFG_KEYS(新增 cfg 鍵而未補嚴格性案例即失敗);每個鍵至少有錯值或寬容案例與有效值案例', () => {
            assert.deepEqual(Object.keys(STRICT).sort(), [...CFG_KEYS].sort())
            for (const [k, s] of Object.entries(STRICT)) {
                assert.ok((s.wrong?.length || 0) + (s.warn?.length || 0) > 0, `${k} 缺錯值案例`)
                assert.ok(s.valid?.length > 0, `${k} 缺有效值案例`)
            }
        })

        for (const key of CFG_KEYS) {
            it(`${key}:${STRICT[key]?.wrong ? '錯值一律拋錯並點名該鍵' : '無效值視同未給並以啟動期警告指名(不拋)'};有效值被接受`, () => {
                const s = STRICT[key]
                for (const bad of s.wrong || []) {
                    const m = msgOf(() => build({ [key]: bad }))
                    assert.notEqual(m, null, `${key}=${JSON.stringify(bad)} 應於建構期拋錯(不得靜默接受)`)
                    assert.match(m, s.name, `${key}=${JSON.stringify(bad)}:${m}`)
                }
                for (const bad of s.warn || []) {
                    const flow = build({ [key]: bad })
                    assert.ok(flow.info().startupWarnings.some((w) => w.startsWith(`cfg.${key} 無效（收到 `) && w.endsWith('視同未給')), `${key}=${JSON.stringify(bad)} 應有指名警告:${flow.info().startupWarnings.join('｜')}`)
                }
                for (const ok of s.valid) {
                    assert.doesNotThrow(() => build({ [key]: ok }), `${key}=${typeof ok} 為有效值`)
                }
            })
        }

        it('cfg 非物件視為 {} 後由 workDir 檢查拋錯;不認得之鍵拋錯並列出全部可用鍵(即 CFG_KEYS);近似拼寫亦不接受', () => {
            for (const bad of [null, undefined, 5, 'x', []]) assert.throws(() => createKnowledgeSummarize(bad), /createKnowledgeSummarize 需要 workDir/)
            assert.equal(msgOf(() => build({ aiAdapte: stubAi })), `cfg 含不認得之鍵：aiAdapte（可用：${CFG_KEYS.join('、')}）`)
            assert.deepEqual(availableKeysOf(() => build({ zzz: 1 })), [...CFG_KEYS])
        })

        it('CFG_KEYS 與實際讀取者一致:本套件之讀取者(總組裝、執行期件、設定解析)所讀之 cfg 鍵＋交抓取套件 resolveRuntime 之鍵(其 runtimeCfgOf 逐鍵讀出 RUNTIME_CFG_KEYS)恰為 CFG_KEYS', () => {
            const readers = ['createKnowledgeSummarize.mjs', 'summarizeRuntime.mjs', 'core/summarizeSettings.mjs']
            const read = new Set()
            for (const f of readers) {
                for (const m of codeOnly(fs.readFileSync(`${PKG_ROOT}/src/${f}`, 'utf8')).matchAll(/\bcfg\??\.([A-Za-z_]\w*)/g)) read.add(m[1])
            }
            // 交抓取套件之執行期解析只收逐鍵讀出之值(抓取套件之 runtimeCfgOf):未列於 RUNTIME_CFG_KEYS 之 cfg 鍵影響不到時間預算與路徑
            const src = codeOnly(fs.readFileSync(`${PKG_ROOT}/src/createKnowledgeSummarize.mjs`, 'utf8'))
            assert.match(src, /resolveRuntime\(runtimeCfgOf\(cfg\)/)
            assert.doesNotMatch(src, /resolveRuntime\(cfg\b/)
            for (const k of RUNTIME_CFG_KEYS) read.add(k)
            assert.deepEqual([...read].filter((k) => !CFG_KEYS.includes(k)).sort(), [], '程式讀取之 cfg 鍵須皆列入 CFG_KEYS')
            assert.deepEqual(CFG_KEYS.filter((k) => !read.has(k)).sort(), [], 'CFG_KEYS 內不得有無人讀取之鍵')
        })
    })

    // ══════════════════════════ cfg 子鍵 ══════════════════════════
    describe('cfg 子鍵嚴格性(鍵集取自系統自己列出之可用鍵)', function() {

        it('cfg.data:只認 vocab(DATA_KEYS＝SUMMARIZE_DATA_KEYS);詞彙之未知鍵拋錯(他段之詞彙表須以 pickSummarizeVocab 取子集);info().data.vocab 為原給、info().vocab 為已解析', () => {
            assert.equal(DATA_KEYS, SUMMARIZE_DATA_KEYS)
            assert.deepEqual(availableKeysOf(() => build({ data: { zzz: 1 } })), ['vocab'])
            for (const bad of [5, 'x', [], false, 0]) assert.throws(() => build({ data: { vocab: bad } }), /cfg\.data\.vocab 須為物件/, `vocab=${JSON.stringify(bad)}`)
            assert.throws(() => build({ data: { vocab: { kbLable: 'x' } } }), /vocab 含不認得之鍵：kbLable/)
            const shared = { domain: '天文學', relationTypes: ['相關'], guide: { relate: { x: 1 }, summarize: { target: '天文知識' } } }
            assert.throws(() => build({ data: { vocab: shared } }), /vocab 含不認得之鍵：relationTypes/)
            const info = build({ data: { vocab: pickSummarizeVocab(shared) } }).info()
            assert.deepEqual([info.vocab.domain, info.vocab.guide.summarize.target], ['天文學', '天文知識'])
            assert.deepEqual(info.data, { vocab: { domain: '天文學', guide: { summarize: { target: '天文知識' } } } }, 'data.vocab 為安裝方原給之覆寫')
            assert.deepEqual(resolveSummarizeData(undefined), { vocab: null })
            assert.throws(() => resolveSummarizeData('x'), /cfg\.data 須為物件 \{ vocab \}/)
        })

        it('cfg.prompts:PROMPT_KEYS 各鍵給非函數即拋;函數被內建 domain 採用(收原參數＋ctx { kbLabel, domain, vocab, defaultPrompt });回傳非空字串之外者於組提示詞時拋', () => {
            assert.deepEqual([...PROMPT_KEYS], ['triage', 'summarize', 'faith', 'repair', 'retag'])
            assert.deepEqual([...PROMPT_KEYS], Object.keys(SUMMARIZE_PROMPT_SIGS))
            assert.deepEqual(availableKeysOf(() => build({ prompts: { zzz: 1 } })), [...PROMPT_KEYS])
            for (const k of PROMPT_KEYS) for (const bad of [5, 'x', {}, [], false, 0]) assert.throws(() => build({ prompts: { [k]: bad } }), new RegExp(`cfg\\.prompts\\.${k} 須為函數`), `prompts.${k}=${JSON.stringify(bad)}`)
            const seen = {}
            const wrap = (k) => (...args) => {
                seen[k] = args
                const ctx = args[args.length - 1]
                return `${k}｜${ctx.kbLabel}｜${ctx.defaultPrompt(...args.slice(0, -1)).length > 0}`
            }
            const d = build({ data: { vocab: { domain: '天文學' } }, prompts: Object.fromEntries(PROMPT_KEYS.map((k) => [k, wrap(k)])) }).info().domains
            const docs = [{ title: '標題', sourceName: '來源', url: 'https://example.com/a', text: '內文' }]
            assert.equal(d.triage.buildPrompt(docs), 'triage｜「天文學」知識庫｜true')
            assert.equal(d.summarize.buildPrompt(docs, ['概念'], { budgets: [10] }), 'summarize｜「天文學」知識庫｜true')
            assert.equal(d.summarize.buildFaithCheckPrompt({ items: [{ index: 1, title: 't', material: 'm', noteText: 'n' }] }), 'faith｜「天文學」知識庫｜true')
            assert.equal(d.summarize.buildRepairPrompt({ material: 'm', item: { title: 't' }, problems: [] }), 'repair｜「天文學」知識庫｜true')
            assert.equal(d.retag.buildPrompt([{ title: 't', category: '其他' }], { focus: { reason: 'add', category: '其他' } }), 'retag｜「天文學」知識庫｜true')
            assert.deepEqual(seen.summarize.slice(0, 3), [docs, ['概念'], { budgets: [10] }], '原參數原樣交給覆寫函數')
            const { defaultPrompt, ...ctx } = seen.triage.at(-1)
            assert.deepEqual(Object.keys(ctx).sort(), ['domain', 'kbLabel', 'vocab'])
            assert.equal(typeof defaultPrompt, 'function')
            assert.equal(ctx.vocab.domain, '天文學')
            for (const bad of ['', '  ', 5, null]) assert.throws(() => build({ prompts: { triage: () => bad } }).info().domains.triage.buildPrompt(docs), /須回傳非空字串/, `回傳 ${JSON.stringify(bad)}`)
        })

        it('cfg.domains:注入者原樣生效(info().domains 即之);不認得之鍵、非物件、缺成員、詞彙表未經本套件解析皆拋;選填成員(覆核／修補之提示詞)在功能關閉時可缺', () => {
            assert.deepEqual(availableKeysOf(() => build({ domains: { zzz: {} } })), ['triage', 'summarize', 'retag'])
            assert.throws(() => build({ domains: 'x' }), /cfg\.domains 須為物件 \{ triage\?, summarize\?, retag\? \}/)
            assert.throws(() => build({ domains: { summarize: 5 } }), /cfg\.domains\.summarize 須為 domain 物件/)
            const full = createSummarizeDomain({})
            const { buildPrompt: _bp, ...noPrompt } = full
            assert.throws(() => build({ domains: { summarize: noPrompt } }), /cfg\.domains\.summarize 缺成員「buildPrompt」（須具備內建 domain 之全部成員；建議以 createSummarizeDomain\(\{ vocab \}\) 之產物展開後覆寫）/)
            const { vocab: _v, ...noVocab } = createTriageDomain({})
            assert.throws(() => build({ domains: { triage: noVocab } }), /cfg\.domains\.triage 缺成員「vocab」/)
            assert.throws(() => build({ domains: { retag: { ...createRetagDomain({}), vocab: { categories: ['甲'] } } } }), /^Error: cfg\.domains\.retag 不合：vocab 須為 resolveSummarizeVocab 之產物.*（建議以 createRetagDomain\(\{ vocab \}\) 之產物展開後覆寫）$/)
            assert.match(msgOf(() => build({ domains: { zzz: {} } })), /^cfg\.domains 含不認得之鍵：zzz（可用：triage、summarize、retag）$/, '不認得之鍵:checkKeys 之格式')
            const { buildFaithCheckPrompt: _f, buildRepairPrompt: _r, ...minimal } = full
            const flow = build({ domains: { summarize: minimal } })
            assert.equal(flow.info().domains.summarize, minimal, '注入者原樣生效')
            assert.equal(typeof flow.info().domains.triage.reasonOf, 'function', '未注入之 domain 沿用內建')
        })

        it('啟用之功能缺 domain 成員或判定小組席位 → 建構期拋錯(不等到該段第一次執行;功能表 SUMMARIZE_FEATURES 之單一判定,訊息為其格式):修補缺 buildRepairPrompt、覆核缺 buildFaithCheckPrompt 或 first／second 席、預篩確認缺 first 席;多項一次列全(席位在前、成員在後,以「；」分隔)', () => {
            const { buildFaithCheckPrompt: _f, buildRepairPrompt: _r, ...minimal } = createSummarizeDomain({})
            const seats = { first: { use: 'stub:f1' }, second: { use: 'stub:f2' } }
            assert.equal(msgOf(() => build({ domains: { summarize: minimal }, summarize: { standards: { repair: { enabled: true } } } })), '摘要欄位定向修補呼叫(summarize.standards.repair.enabled)已啟用,但 cfg.domains.summarize 缺 buildRepairPrompt')
            assert.equal(msgOf(() => build({ domains: { summarize: minimal }, summarize: { standards: { faithCheck: { enabled: true, ai: seats } } } })), '筆記忠實性覆核(summarize.standards.faithCheck.enabled)已啟用,但 cfg.domains.summarize 缺 buildFaithCheckPrompt')
            assert.equal(msgOf(() => build({ domains: { summarize: minimal }, summarize: { standards: { repair: { enabled: true }, faithCheck: { enabled: true }, triageConfirm: { enabled: true } } } })), [
                '筆記忠實性覆核(summarize.standards.faithCheck.enabled)已啟用,但缺席位 settings.summarize.standards.faithCheck.ai.first、settings.summarize.standards.faithCheck.ai.second',
                '預篩攔下之第二席確認(summarize.standards.triageConfirm.enabled)已啟用,但缺席位 settings.summarize.standards.triageConfirm.ai.first',
                '摘要欄位定向修補呼叫(summarize.standards.repair.enabled)已啟用,但 cfg.domains.summarize 缺 buildRepairPrompt',
                '筆記忠實性覆核(summarize.standards.faithCheck.enabled)已啟用,但 cfg.domains.summarize 缺 buildFaithCheckPrompt',
            ].join('；'))
            assert.equal(msgOf(() => build({ summarize: { standards: { faithCheck: { enabled: true } } } })), '筆記忠實性覆核(summarize.standards.faithCheck.enabled)已啟用,但缺席位 settings.summarize.standards.faithCheck.ai.first、settings.summarize.standards.faithCheck.ai.second')
            assert.equal(msgOf(() => build({ summarize: { standards: { faithCheck: { enabled: true, ai: { first: seats.first } } } } })), '筆記忠實性覆核(summarize.standards.faithCheck.enabled)已啟用,但缺席位 settings.summarize.standards.faithCheck.ai.second')
            assert.equal(msgOf(() => build({ summarize: { standards: { triageConfirm: { enabled: true } } } })), '預篩攔下之第二席確認(summarize.standards.triageConfirm.enabled)已啟用,但缺席位 settings.summarize.standards.triageConfirm.ai.first')
            // 功能關閉時缺之不拋;開啟且齊備亦不拋
            assert.doesNotThrow(() => build({ domains: { summarize: minimal } }))
            assert.doesNotThrow(() => build({ summarize: { standards: { faithCheck: { enabled: true, ai: seats }, repair: { enabled: true }, triageConfirm: { enabled: true, ai: { first: { use: 'stub:c' } } } } } }))
        })

        it('cfg.prompts 與 cfg.domains 給在同一 domain 即拋(注入者整組置換內建者,提示詞覆寫會靜默失效);給在不同 domain 皆生效', () => {
            const sd = createSummarizeDomain({})
            for (const k of ['summarize', 'faith', 'repair']) {
                assert.match(msgOf(() => build({ prompts: { [k]: () => 'p' }, domains: { summarize: sd } })), new RegExp(`^cfg\\.prompts\\.${k} 與 cfg\\.domains\\.summarize 擇一`), k)
            }
            assert.match(msgOf(() => build({ prompts: { triage: () => 'p' }, domains: { triage: createTriageDomain({}) } })), /^cfg\.prompts\.triage 與 cfg\.domains\.triage 擇一/)
            assert.match(msgOf(() => build({ prompts: { retag: () => 'p' }, domains: { retag: createRetagDomain({}) } })), /^cfg\.prompts\.retag 與 cfg\.domains\.retag 擇一/)
            const d = build({ prompts: { triage: () => 'TRIAGE-P' }, domains: { summarize: sd } }).info().domains
            assert.deepEqual([d.triage.buildPrompt([]), d.summarize === sd], ['TRIAGE-P', true])
        })

        it('cfg.dirs:可用鍵即抓取套件之基本目錄＋摘要之 notes;notes 預設 <workDir>/knowledge/notes 且不隨 knowledge 之覆寫移動;各鍵給非字串或空字串即拋', () => {
            const keys = Object.keys(expandDirs('c:/x', {}, SUMMARIZE_DIRS))
            assert.deepEqual(availableKeysOf(() => build({ dirs: { zzz: 'a' } })), keys)
            assert.deepEqual(keys, ['db', 'log', 'tmp', 'state', 'knowledge', 'notes'])
            for (const k of keys) for (const bad of [5, '', {}, [], false, 0]) assert.throws(() => build({ dirs: { [k]: bad } }), new RegExp(`cfg\\.dirs\\.${k} 須為非空路徑字串`), `dirs.${k}=${JSON.stringify(bad)}`)
            const wd = dirOf('dirs')
            const info = (dirs) => createKnowledgeSummarize({ workDir: wd, aiAdapter: stubAi, netGuard: null, lock: false, ...(dirs ? { dirs } : {}) }).info().dirs
            assert.equal(info().notes, `${wd}/knowledge/notes`)
            assert.deepEqual(info({ knowledge: 'D:/vault/k' }), { ...expandDirs(wd), knowledge: 'D:/vault/k', notes: `${wd}/knowledge/notes` }, 'notes 不隨 knowledge 之覆寫移動')
            assert.equal(info({ notes: 'D:/vault/notes' }).notes, 'D:/vault/notes')
        })

        it('cfg.lmdb.cls:可用鍵即 COLLECTION_KEYS(摘要之集合＋cores);預設集合名即對外名(與抓取共用一庫時不必遷移);有效值逐鍵改集合名', () => {
            assert.deepEqual([...COLLECTION_KEYS], [...SUMMARIZE_STORE_KEYS, 'cores'])
            assert.deepEqual([...SUMMARIZE_STORE_KEYS], ['docs', 'docTexts', 'frontier', 'notes', 'holds'])
            assert.deepEqual(availableKeysOf(() => build({ lmdb: { cls: { zzz: 'x' } } })), [...COLLECTION_KEYS])
            const dflt = build().info().lmdb
            assert.deepEqual(dflt.cls, Object.fromEntries(COLLECTION_KEYS.map((k) => [k, k])))
            assert.equal(dflt.db, 'knowledge')
            for (const k of COLLECTION_KEYS) assert.equal(build({ lmdb: { cls: { [k]: `my_${k}` } } }).info().lmdb.cls[k], `my_${k}`, k)
        })

        it('cfg.stageOpts:可用鍵即 SUMMARIZE_STAGE_KEYS;各鍵給非物件即拋;無動作鏈者(retag、sync)給 tap 即拋;有動作鏈者對不存在之錨點即拋;cfg.stages 與 cfg.stageOpts 擇一', () => {
            assert.deepEqual(availableKeysOf(() => build({ stageOpts: { zzz: {} } })), [...SUMMARIZE_STAGE_KEYS])
            for (const k of SUMMARIZE_STAGE_KEYS) {
                for (const bad of [5, 'x', [], false, 0]) assert.throws(() => build({ stageOpts: { [k]: bad } }), new RegExp(`cfg\\.stageOpts\\.${k} 須為物件`))
                assert.doesNotThrow(() => build({ stageOpts: { [k]: {} } }), k)
            }
            for (const k of ['retag', 'sync']) assert.throws(() => build({ stageOpts: { [k]: { tap: { x: { after: [] } } } } }), new RegExp(`子階段\\[${k}\\] 無動作鏈`))
            assert.throws(() => build({ stageOpts: { summarize: { tap: { nope: { after: [] } } } } }), /無錨點「nope」/)
            const st = [{ name: 'a', run: async () => stdReport() }]
            assert.throws(() => build({ stages: st, stageOpts: {} }), /cfg\.stages（整組自訂子階段）與 cfg\.stageOpts（內建子階段之 opt）擇一/)
            assert.throws(() => build({ stages: [{ name: 'a', run: () => {} }, { name: 'a', run: () => {} }] }), /cfg\.stages 有重複之子階段名：a/)
        })

        it('設定三段(ai／summarize／capture)之子鍵嚴格性由設定解析承擔:總組裝對各組之錯誤原樣拋出(完整路徑可辨);素材問題樣式於建構期編譯', () => {
            assert.throws(() => build({ summarize: { triage: { docsPerCal: 1 } } }), /settings\.summarize\.triage 含不認得之鍵：docsPerCal（可用：.*docsPerCall/)
            assert.throws(() => build({ summarize: { docsPerCall: '3' } }), /settings\.summarize\.docsPerCall 須為正整數/)
            assert.throws(() => build({ summarize: { ai: { use: 'x', fallbak: [] } } }), /settings\.summarize\.ai 須為席位物件.*含不認得之鍵：fallbak/)
            assert.throws(() => build({ ai: { providerPick: ['claude:sonnet'] } }), /settings\.ai 含不認得之鍵：providerPick/, '摘要恆以席位呼叫 AI,不收供應商池之設定')
            assert.throws(() => build({ summarize: { refetch: { patterns: [{ p: '(' }] } } }), /settings\.summarize\.refetch\.patterns\[0\]/, '素材問題之追加樣式於建構期編譯')
            assert.throws(() => build({ capture: { articles: { perRun: '27' } } }), /settings\.capture\.articles\.perRun/)
        })
    })

    // ══════════════════════════ ② 檢核順序 ══════════════════════════
    describe('檢核順序與跨鍵關係', function() {

        it('形狀錯誤之訊息不被席位檢核搶先:同時有 cfg 形狀錯與無法解析之席位 → 報形狀錯', () => {
            const seatBad = { summarize: { ai: { use: 'oc:opencode/no-such-model-free' } } }
            assert.throws(() => createKnowledgeSummarize({ workDir: dirOf(), netGuard: null, lock: false, ...seatBad }), /AI 席位於啟動期檢核失敗/, '前提:單獨之席位錯誤確實拋出')
            for (const [name, extra, re] of [
                ['cores 型別錯', { cores: 5 }, /cfg\.cores 須為/],
                ['stages 與 stageOpts 並給', { stages: [{ name: 'a', run: () => {} }], stageOpts: {} }, /擇一/],
                ['data 形狀錯', { data: 'x' }, /cfg\.data 須為物件/],
                ['domains 缺成員', { domains: { summarize: {} } }, /cfg\.domains\.summarize 缺成員/],
                ['logFactory 型別錯', { logFactory: 5 }, /cfg\.logFactory/],
                ['lmdb 形狀錯', { lmdb: 'x' }, /cfg\.lmdb/],
                ['lock 型別錯', { lock: 5 }, /cfg\.lock/],
            ]) {
                assert.throws(() => createKnowledgeSummarize({ workDir: dirOf(), netGuard: null, ...seatBad, ...extra }), re, name)
            }
        })

        it('設定(ai／summarize／capture)之錯誤先於其他 cfg 鍵之形狀錯(同時錯時先報 settings)', () => {
            assert.throws(() => build({ data: 'x', summarize: 'x' }), /settings\.summarize 須為物件/)
        })

        it('概念折疊接線(與抓取套件同一單例):未給用內建繁簡折疊;false 明確清除先前實例注入之折疊;函數即自訂;詞彙表之概念別名一併生效', () => {
            build()
            assert.equal(normalizeConcept('風險'), normalizeConcept('风险'))
            build({ conceptFold: false })
            assert.notEqual(normalizeConcept('風險'), normalizeConcept('风险'), 'false 須明確清除')
            build({ conceptFold: (t) => t.toUpperCase() })
            assert.equal(normalizeConcept('abc'), 'ABC')
            build({ data: { vocab: { conceptAliases: { 星系: '銀河' } } } })
            assert.equal(normalizeConcept('星系'), normalizeConcept('銀河'))
        })
    })

    // ══════════════════════════ ③ 執行期件 ══════════════════════════
    describe('createSummarizeRuntime(總組裝共用之摘要執行期件)', function() {

        const S0 = resolveSummarizeSettings({})

        it('回傳之件:資料(原給)、已解析之詞彙、折疊、去重身分、網路判斷、生效之 domain;settings 不含 summarize／capture 即拋', () => {
            const rt = createSummarizeRuntime({ netGuard: null, data: { vocab: { domain: '天文學' } } }, S0)
            assert.deepEqual(Object.keys(rt).sort(), ['data', 'domains', 'folds', 'identity', 'isNetDown', 'locale', 'netGuard', 'vocab'])
            assert.deepEqual(Object.keys(rt.domains), ['triage', 'summarize', 'retag'])
            assert.deepEqual([...SUMMARIZE_DOMAIN_KEYS], Object.keys(rt.domains), 'SUMMARIZE_DOMAIN_KEYS 即生效之 domain 鍵(他總組裝以之取 cfg.domains 之子集)')
            assert.deepEqual([rt.vocab.domain, rt.data.vocab], ['天文學', { domain: '天文學' }])
            for (const k of ['triage', 'summarize', 'retag']) assert.equal(rt.domains[k].vocab.domain, '天文學', `${k} 之詞彙`)
            assert.throws(() => createSummarizeRuntime({}, {}), /需要解析後之 settings\(含 summarize、capture\)/)
            assert.throws(() => createSummarizeRuntime({}, { summarize: S0.summarize }), /需要解析後之 settings/)
        })

        it('opt.vocab(他總組裝交之子集)優先於 cfg.data.vocab;domain 之注入只經 opt.domains(不讀 cfg.domains——他工作之 domain 不被誤認);opt.prompts 與 cfg 層同一驗證(鍵即 SUMMARIZE_PROMPT_SIGS、值須為函數)', () => {
            const rt = createSummarizeRuntime({ netGuard: null, data: { vocab: { domain: '天文學' } } }, S0, { vocab: { domain: '地質學' } })
            assert.equal(rt.domains.summarize.vocab.domain, '地質學')
            const sd = createSummarizeDomain({ vocab: { domain: '海洋學' } })
            const rt2 = createSummarizeRuntime({ netGuard: null, domains: { summarize: createSummarizeDomain({}) } }, S0, { domains: { summarize: sd } })
            assert.equal(rt2.domains.summarize, sd)
            const rt3 = createSummarizeRuntime({ netGuard: null, domains: { relate: {}, summarize: 'bad' } }, S0)
            assert.notEqual(rt3.domains.summarize, 'bad', 'cfg.domains 不讀(含他工作之鍵亦不拋)')
            assert.throws(() => createSummarizeRuntime({ netGuard: null }, S0, { prompts: { area: () => 'p' } }), /opt\.prompts 含不認得之鍵：area（可用：triage、summarize、faith、repair、retag）/)
            assert.equal(msgOf(() => createSummarizeRuntime({ netGuard: null }, S0, { prompts: { faith: 'x' } })), 'createSummarizeRuntime 之 opt.prompts.faith 須為函數 (input, ctx) => 提示詞字串')
            assert.equal(createSummarizeRuntime({ netGuard: null }, S0, { prompts: { retag: () => 'R' } }).domains.retag.buildPrompt([]), 'R')
        })

        it('本機網路判斷:null → 不判斷(isNetDown 為 null);注入者原樣採用,具 confirmDown 才交調度層(呼叫即問同一份);未給依 settings.capture.network 建立;非物件即拋', async () => {
            assert.deepEqual([createSummarizeRuntime({ netGuard: null }, S0).netGuard, createSummarizeRuntime({ netGuard: null }, S0).isNetDown], [null, null])
            assert.equal(createSummarizeRuntime({ netGuard: { check: async () => ({ up: true }) } }, S0).isNetDown, null)
            let asked = 0
            const g = { check: async () => ({}), confirmDown: async () => {
                asked++
                return true
            } }
            const rt = createSummarizeRuntime({ netGuard: g }, S0)
            assert.equal(rt.netGuard, g)
            assert.equal(await rt.isNetDown(), true)
            assert.equal(asked, 1)
            const def = createSummarizeRuntime({}, S0)
            assert.deepEqual([typeof def.netGuard?.confirmDown, typeof def.isNetDown], ['function', 'function'], '未給 netGuard 即依設定建立(不呼叫:會對外探測)')
            assert.throws(() => createSummarizeRuntime({ netGuard: 'x' }, S0), /cfg\.netGuard 須為網路判斷器物件/)
        })

        it('去重身分:未給為抓取套件之預設(網址之 SHA-1),cfg.dedup 自訂;與抓取同一判準', () => {
            assert.match(createSummarizeRuntime({ netGuard: null }, S0).identity.of('https://example.com/a'), /^[0-9a-f]{40}$/)
            assert.equal(createSummarizeRuntime({ netGuard: null, dedup: { keyOf: 'asis' } }, S0).identity.of('https://example.com/a'), 'https://example.com/a')
        })
    })

    // ══════════════════════════ info() ══════════════════════════
    describe('info():生效值單一來源', function() {

        it('預設:鍵序(共同欄＋identity)、目錄(含 notes)、集合、鎖與金鑰檔路徑皆自 workDir 展開;注入調度層時無 AI 工作區;未給排程上限即預設預算並於啟動期警告;詞彙為預設', () => {
            const wd = dirOf('info')
            const info = createKnowledgeSummarize({ workDir: wd, aiAdapter: stubAi, netGuard: null }).info()
            assert.deepEqual(Object.keys(info), ['dirs', 'settings', 'clock', 'ai', 'domains', 'identity', 'locale', 'lmdb', 'data', 'vocab', 'deadlineMs', 'lockStaleMs', 'startupWarnings', 'scheduleLimitMin', 'envFile', 'aiWorkspace', 'lockFile', 'collections'])
            assert.deepEqual(info.dirs, expandDirs(wd, {}, SUMMARIZE_DIRS))
            assert.deepEqual(info.collections, [...SUMMARIZE_STORE_KEYS])
            assert.equal(info.lockFile, path.resolve(`${wd}/tmp/run.lock`))
            assert.equal(info.envFile, path.resolve(`${wd}/.env`))
            assert.equal(info.aiWorkspace, null)
            assert.deepEqual([info.scheduleLimitMin, info.deadlineMs, info.lockStaleMs], [null, 50 * MIN, 60 * MIN])
            assert.deepEqual(info.startupWarnings.length, 1)
            assert.match(info.startupWarnings[0], /^未給 scheduleLimitMin 亦未給 deadlineMs/)
            assert.deepEqual(info.data, { vocab: null })
            assert.deepEqual([info.vocab.domain, info.vocab.categories.at(-1), info.vocab.evidenceRule.enabled], ['', '其他', false])
            assert.deepEqual(Object.keys(info.domains), ['triage', 'summarize', 'retag'])
            assert.deepEqual(Object.keys(info.settings), ['ai', 'summarize', 'capture', 'capacity', 'warnings'])
            assert.equal(info.ai, stubAi)
        })

        it('執行期:排程上限推導預算與鎖陳舊期限;明給者優先;envFile 相對者以 workDir 為基準;lock 字串即鎖檔路徑、false 即無鎖;時鐘原樣採用或依時區建立', () => {
            const a = build({ scheduleLimitMin: 55 }).info()
            assert.deepEqual([a.scheduleLimitMin, a.deadlineMs, a.lockStaleMs, a.startupWarnings], [55, 49 * MIN, 60 * MIN, []])
            assert.equal(build({ deadlineMs: 20 * MIN }).info().deadlineMs, 20 * MIN)
            const wd = dirOf('paths')
            const rel = createKnowledgeSummarize({ workDir: `${wd.replace(/\//g, '\\')}\\`, aiAdapter: stubAi, netGuard: null, envFile: 'sec/.env', lock: `${wd}/x/my.lock` }).info()
            assert.deepEqual([rel.dirs.db, rel.envFile, rel.lockFile], [`${wd}/db`, path.resolve(`${wd}/sec/.env`), path.resolve(`${wd}/x/my.lock`)])
            assert.equal(build({ lock: false }).info().lockFile, null)
            assert.equal(build({ clock: FIXED_CLOCK }).info().clock, FIXED_CLOCK)
            assert.match(build({ timeZone: 'UTC' }).info().clock.iso8(), /\+00:00$/)
        })
    })

    // ══════════════════════════ 每輪依賴與執行 ══════════════════════════
    describe('每輪依賴(deps)與一輪執行', function() {

        it('deps 契約:{ stores, clock, dirs, data, vocab, settings, ai, domains } 皆為可列舉之普通屬性;同一輪各子階段取得同一份;deps.domains／vocab／settings／data 即 info() 之同一物件;stores 為 SUMMARIZE_STORE_KEYS', async () => {
            const sink = []
            const probe = (name) => ({ name, run: async (ctx) => {
                sink.push(ctx.deps)
                return stdReport()
            } })
            let viaAfter = null
            const flow = build({ stages: [probe('p1'), probe('p2')], afterRun: ({ deps }) => {
                viaAfter = deps
            } })
            const rep = await flow.run()
            assert.equal(rep.ok, true)
            const d = sink[0]
            assert.equal(d, sink[1], '同一輪各子階段之 deps 為同一份')
            assert.deepEqual(Object.keys(d).sort(), ['ai', 'clock', 'data', 'dirs', 'domains', 'locale', 'settings', 'stores', 'vocab'])
            const desc = Object.getOwnPropertyDescriptors(viaAfter)
            for (const [k, dd] of Object.entries(desc)) assert.ok(dd.enumerable && 'value' in dd && !dd.get, `deps.${k} 須為可列舉之普通屬性`)
            assert.deepEqual(Object.keys(d.stores), [...SUMMARIZE_STORE_KEYS])
            const info = flow.info()
            assert.deepEqual([d.domains === info.domains, d.vocab === info.vocab, d.settings === info.settings, d.data === info.data, d.ai === info.ai, d.clock === info.clock], [true, true, true, true, true, true])
            assert.deepEqual(Object.keys(d.dirs), ['db', 'log', 'tmp', 'state', 'knowledge', 'notes'])
            await assert.rejects(() => d.stores.docs.get('x'), undefined, '執行結束後集合已關閉')
        })

        it('零設定(僅 workDir＋AI 替身)跑一輪:抓取交出之 raw 文件經預篩、摘要寫出一篇筆記至 <workDir>/knowledge/notes;日誌、開工標記與執行摘要落 <workDir>/log', async () => {
            const wd = dirOf('zero')
            const ai = scriptedAi()
            const flow = createKnowledgeSummarize({ workDir: wd, aiAdapter: ai })
            await seedDocs(flow, [rawDoc('z1', { title: '天體觀測之方法' })])
            const orig = console.log
            console.log = () => {} // 預設日誌同時輸出 stdout:測試中靜音
            let rep
            try {
                rep = await flow.run()
            }
            finally {
                console.log = orig
            }
            assert.equal(rep.ok, true)
            assert.deepEqual(ai.calls.map((c) => c.role), ['triage', 'summarize'])
            const notesDir = `${wd}/knowledge/notes`
            const files = fs.readdirSync(notesDir)
            assert.equal(files.length, 1)
            assert.match(files[0], /^天體觀測之方法之重點-[0-9a-f]{8}\.md$/)
            const md = readMd(`${notesDir}/${files[0]}`)
            assert.equal(md.front.title, '天體觀測之方法之重點')
            await withStores(flow, async (s) => {
                const [n] = await s.notes.select()
                assert.equal(path.resolve(n.file), path.resolve(`${notesDir}/${files[0]}`))
                assert.deepEqual([(await s.docs.get('z1')).status, (await s.docs.get('z1')).noteSlug], ['noted', n.id])
            })
            assert.equal(findFiles(`${wd}/log`, '-run.log').length, 1)
            assert.equal(findFiles(`${wd}/log`, '-run.start.json').length, 1)
            const sum = readJsonFile(rep.summaryFile)
            assert.deepEqual([sum.name, sum.stages.map((s) => s.name), Object.keys(sum.stages[0].sub)], ['知識摘要', ['摘要'], ['triage', 'summarize', 'retag', 'sync']])
            assert.ok(!fs.existsSync(`${wd}/tmp/run.lock`), '執行鎖已釋放')
        })

        it('cfg.dedup 與人工匯入同一身分:info().identity 即管線之去重身分;ingestNotes 以之登記之文件 id 依自訂之主鍵策略;下一輪不重摘(已 noted)', async () => {
            const keyOf = (k) => `kb:${k}`
            const { flow, ai } = buildTestSummarize(dirOf('dedup'), { dedup: { keyOf } })
            const info = flow.info()
            assert.equal(info.identity.of('https://example.com/m'), 'kb:https://example.com/m')
            await withStores(flow, async (stores) => {
                const r = await ingestNotes({ stores, dirs: info.dirs, clock: info.clock, domain: info.domains.summarize, identity: info.identity }, [
                    { url: 'https://example.com/m', note: itemOf(1, '人工撰寫之筆記') },
                ])
                assert.deepEqual([r.added, r.bad, r.dup], [1, 0, 0], r.messages.join('\n'))
                const docs = await stores.docs.select()
                assert.deepEqual(docs.map((d) => [d.id, d.status]), [['kb:https://example.com/m', 'noted']])
            })
            await flow.run()
            assert.equal(ai.calls.length, 0, '已登記為 noted 之文件不再摘要')
        })

        it('cfg.cores(選開之核心集合):預設不開;true 或集合名才開(唯讀);集合名與 lmdb.cls.cores 不一致即拋', async () => {
            assert.deepEqual(build().info().collections, [...SUMMARIZE_STORE_KEYS])
            assert.deepEqual(build({ cores: true }).info().collections, [...SUMMARIZE_STORE_KEYS, 'cores'])
            assert.equal(build({ cores: 'myCores' }).info().lmdb.cls.cores, 'myCores')
            assert.throws(() => build({ cores: 'a', lmdb: { cls: { cores: 'b' } } }), /cfg\.cores（a）與 cfg\.lmdb\.cls\.cores（b）不一致：核心集合名擇一給/)
            assert.equal(build({ lmdb: { cls: { cores: 'c' } } }).info().collections.includes('cores'), false, '只給集合名而未開 cores 仍不開')
            const flow = build({ cores: true })
            const st = flow.openStores()
            try {
                assert.deepEqual(Object.keys(st), [...SUMMARIZE_STORE_KEYS, 'cores'])
            }
            finally {
                await flow.closeStores(st)
            }
        })

        it('cfg.cores 之效果(SS6 擠標籤之拆分條件):開啟時核心之概念算既有概念 → 「核心概念、筆記概念」拆開納入;未開時核心概念不算既有 → 不拆、未達標準不納入', async () => {
            const wd = dirOf('cores')
            const answer = (role, prompt, o, ts) => (role === 'summarize' ? ts.map((t, i) => itemOf(i + 1, t, { concepts: ['核心概念甲、筆記概念乙', '新概念丙'] })) : undefined)
            const seed = buildTestSummarize(wd, { cores: true }).flow
            await withStores(seed, async (s) => {
                await s.cores.insertNew([{ id: 'c1', concept: '核心概念甲' }])
                await s.notes.insertNew([{ id: 'old', title: '舊筆記', concepts: ['筆記概念乙', '其他概念'], file: `${wd}/none.md` }])
                await s.docs.insertNew([rawDoc('k1', { triage: 'relevant' })])
            })
            // 一輪只跑一個批次輪(落地前之 SS6 不合格算進度,同一輪之後續批次輪會帶回饋重摘)
            const off = buildTestSummarize(wd, { aiAdapter: scriptedAi(answer), summarize: { triage: { enabled: false }, rounds: 1 } }).flow
            await off.run()
            await withStores(off, async (s) => {
                const d = await s.docs.get('k1')
                assert.deepEqual([d.status, d.summarizeTries], ['raw', 1], '未開核心集合:不拆 → SS6 不合格、不納入')
                assert.match(d.stdFeedback, /多概念擠一標籤/)
            })
            const on = buildTestSummarize(wd, { cores: true, aiAdapter: scriptedAi(answer), summarize: { triage: { enabled: false } } }).flow
            await on.run()
            await withStores(on, async (s) => {
                assert.equal((await s.docs.get('k1')).status, 'noted')
                const n = (await s.notes.select()).find((x) => x.docId === 'k1')
                assert.deepEqual(n.concepts, ['核心概念甲', '筆記概念乙', '新概念丙'], '開核心集合:各段皆既有 → 拆開')
            })
        })

        it('cfg.stageOpts.retag.reserveMs 生效(重標扣掉保留給後段之時間):保留大於剩餘 → 有工作亦延後(INFO);函數形式每輪求值(收 ctx);保留 0 → 照常處理', async () => {
            const wd = dirOf('reserve')
            const V1 = { categories: ['甲類', '乙類', '其他'] }
            const V2 = { categories: ['甲類', '乙類', '丙類', '其他'] }
            await buildTestSummarize(wd, { data: { vocab: V1 } }).flow.run() // 首輪記錄分類法
            const lg = logsOf()
            const r2 = await buildTestSummarize(wd, { data: { vocab: V2 }, stageOpts: { retag: { reserveMs: 10 * 3_600_000 } }, logFactory: lg.factory }).flow.run()
            const rt2 = subReport(r2, '摘要', 'retag').detail
            assert.deepEqual([rt2.deferred, rt2.jobsPending, rt2.jobsAdded], [true, 1, 1])
            assert.ok(lg.lines().includes('INFO 分類法：本輪剩餘時間不足（< 保留時間＋5 分），重標延後（待處理工作 1）'), lg.lines().join('\n'))
            const seen = []
            const r3 = await buildTestSummarize(wd, { data: { vocab: V2 }, stageOpts: { retag: { reserveMs: (ctx) => {
                seen.push(typeof ctx.remainingMs)
                return 0
            } } } }).flow.run()
            const rt3 = subReport(r3, '摘要', 'retag').detail
            assert.deepEqual([rt3.deferred, rt3.jobsDone, rt3.jobsPending, seen], [false, 1, 0, ['function']])
        })

        it('run.json:管線名「知識摘要」、唯一之段「摘要」、子階段 triage／summarize／retag／sync 之 report;AI 實績取自調度層之 drainStats', async () => {
            const { flow } = buildTestSummarize(dirOf('runjson'), { clock: FIXED_CLOCK })
            const rep = await flow.run()
            const sum = readJsonFile(rep.summaryFile)
            assert.equal(sum.name, '知識摘要')
            assert.deepEqual(sum.stages.map((s) => [s.name, s.ok]), [['摘要', true]])
            assert.deepEqual(Object.keys(sum.stages[0].sub), ['triage', 'summarize', 'retag', 'sync'])
            assert.equal(sum.stages[0].summary, '處理 0、新知識 0、略過 0、線索 0（AI 0 次）')
            assert.deepEqual(sum.ai, { usageToday: {}, callStats: '無呼叫' })
            assert.equal(path.basename(rep.summaryFile), '20260102030405-run.json')
        })

        it('cfg.name 取代管線名(run.json 之 name);未給用內建名「知識摘要」', async () => {
            const { flow } = buildTestSummarize(dirOf('pname'), { clock: FIXED_CLOCK, name: '自訂管線名' })
            assert.equal(readJsonFile((await flow.run()).summaryFile).name, '自訂管線名')
        })

        it('符合度掃描(summarize.standards.scanEachRun):預設關 → 不掃、run.json 無 standards;開 → 管線後掃可逐件判定之筆記標準(SS2／SS3／SS4／SS6／SS11),計數＝同庫直接掃描之值;AI 標準之待判(待判登錄來源)入 standards.ai(與關聯／提煉同形);日誌一行「符合度掃描（…）：…」', async () => {
            const wd = dirOf('scan')
            // 第一輪(預設關):寫出一篇筆記;不掃
            const lg1 = logsOf()
            const first = buildTestSummarize(wd, { logFactory: lg1.factory })
            await seedDocs(first.flow, [rawDoc('s1', { title: '觀測方法之比較' })])
            const r1 = await first.flow.run()
            assert.equal(r1.ok, true)
            assert.equal('standards' in readJsonFile(r1.summaryFile), false, '未開掃描:run.json 無 standards')
            assert.equal(lg1.lines().some((l) => l.includes('符合度掃描')), false)
            // 第二輪(開):無新文件,只掃存量;另有一筆未結之 SS14 待判(AI 標準之待判入 standards.ai)
            const lg2 = logsOf()
            const second = buildTestSummarize(wd, { logFactory: lg2.factory, summarize: { standards: { scanEachRun: true } } })
            await withStores(second.flow, async (stores) => {
                await stores.holds.replace({ id: 'doc:zz:SS14', object: 'doc', oid: 'zz', std: 'SS14', status: 'open', reason: 'r', next: 'n', owner: 'pipeline', deadline: '', since: 't', at: 't', tries: 0, ctx: {} })
            })
            const r2 = await second.flow.run()
            const st = readJsonFile(r2.summaryFile).standards
            assert.deepEqual(Object.keys(st.counts), ['SS2', 'SS3', 'SS4', 'SS6', 'SS11'], '計數之鍵＝可逐件判定之標準(AI 標準另列 ai)')
            assert.deepEqual(st.ai, { SS14: { holdsOpen: 1 } }, 'AI 標準只列有待判者(SS5 之來源為文件、SS9 無待判:不列)')
            let direct
            await withStores(second.flow, async (stores) => {
                direct = await auditSummarizeStandards({ stores, vocab: second.flow.info().vocab }, { material: true, only: [...SUMMARIZE_AUDITED_STANDARD_IDS] })
            })
            for (const id of Object.keys(st.counts)) {
                const d = direct.standards[id]
                assert.deepEqual(st.counts[id], { v: d.v, total: d.total, violation: d.violation, undetermined: d.undetermined, waived: d.waived }, `${id} 之計數＝同庫直接掃描`)
                assert.equal(st.counts[id].total, 1, `${id} 掃到第一輪寫出之筆記`)
            }
            assert.ok(Number.isInteger(st.ms) && st.ms >= 0 && typeof st.at === 'string' && st.at.length > 0)
            assert.equal(lg2.lines().filter((l) => /^INFO 符合度掃描（\d+\.\d+s）：/.test(l)).length, 1, lg2.lines().join('\n'))
        })
    })

    // ══════════════════════════ ⑥ AI 調度層 ══════════════════════════
    describe('AI 調度層(席位、建構選項、斷網、事件日誌)', function() {

        it('席位檢核:注入之調度層有 validateSeats 者以 summarizeSeatsOf 檢核(建構期一次),其警告併入啟動期警告;內建調度層對無法解析之席位建構期拋錯;預設席位可解析', () => {
            const ai = scriptedAi(undefined, { validateSeats: true })
            const seat = { use: 'stub:a', fallback: ['stub:b'] }
            const flow = build({ aiAdapter: ai, summarize: { triage: { ai: seat } } })
            assert.deepEqual(ai.seatChecks, [summarizeSeatsOf(flow.info().settings)])
            assert.deepEqual(Object.keys(ai.seatChecks[0]), ['summarize.ai', 'summarize.triage.ai'])
            assert.ok(build({ aiAdapter: { ...stubAi, validateSeats: () => ({ warnings: ['席位提示一'] }) } }).info().startupWarnings.includes('席位提示一'))
            assert.match(msgOf(() => createKnowledgeSummarize({ workDir: dirOf(), netGuard: null, lock: false, summarize: { ai: { use: 'oc:opencode/no-such-model-free' } } })), /^AI 席位於啟動期檢核失敗（1 席）：summarize\.ai → 席位引用了不可用的條目：oc:opencode\/no-such-model-free/)
            assert.doesNotThrow(() => createKnowledgeSummarize({ workDir: dirOf(), netGuard: null, lock: false }), '套件預設席位須可解析')
        })

        it('判定小組同家:已開啟之小組其兩席首選同家且無不同家之第三席 → 啟動期警告(每輪以「啟動期檢核：」記入日誌)', async () => {
            const same = { use: 'stub:x' }
            const lg = logsOf()
            const flow = build({ summarize: { standards: { faithCheck: { enabled: true, ai: { first: same, second: same } } } }, logFactory: lg.factory, stages: [{ name: 's', run: async () => stdReport() }] })
            const w = flow.info().startupWarnings.find((x) => x.startsWith('筆記忠實性覆核（summarize.standards.faithCheck.ai）'))
            assert.ok(w, flow.info().startupWarnings.join('｜'))
            await flow.run()
            assert.ok(lg.lines().includes(`WARN 啟動期檢核：${w}`))
        })

        it('建構選項:失敗預覽開(失敗形狀帶 preview＝模型回覆之前段)、截斷放行不在建構期開(直接呼叫遇 REST 截斷即失敗;逐次給 acceptTruncated 才部分接受)', async () => {
            const flow = createKnowledgeSummarize({
                workDir: dirOf('rest'), netGuard: null, lock: false,
                ai: { extraProviders: ['plain', 'trunc', 'summ'].map((m) => ({ id: `t:${m}`, kind: 'api-openai-compat', baseURL: REST_BASE, model: m })) },
                summarize: { ai: { use: 't:plain' } },
            })
            const ai = flow.info().ai
            const p = await ai.callJson('請只回 JSON', (d) => Array.isArray(d), { spec: { use: 't:plain' } })
            assert.deepEqual([p.ok, p.preview], [false, '好的，這是純文字回覆，不是 JSON。'])
            const t0 = await ai.callJson('請只回 JSON', (d) => Array.isArray(d), { spec: { use: 't:trunc' } })
            assert.equal(t0.ok, false, '建構期未開截斷放行')
            assert.match(t0.error, /finish_reason=length/)
            const t1 = await ai.callJson('請只回 JSON', (d) => Array.isArray(d), { spec: { use: 't:trunc' }, acceptTruncated: true })
            assert.deepEqual([t1.ok, t1.truncated, t1.data], [true, true, [{ index: 1, v: 'a' }]])
        })

        it('建構選項:條目固有之 prompt 長度預篩開啟(capability)——席位之全鏈條目皆有上限者於啟動期警告;放不下之條目呼叫前剔除、不送出', async () => {
            const flow = createKnowledgeSummarize({
                workDir: dirOf('cap'), netGuard: null, lock: false,
                ai: { extraProviders: [{ id: 't:cap', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm', maxPromptChars: 10 }] },
                summarize: { ai: { use: 't:cap' } },
            })
            assert.ok(flow.info().startupWarnings.some((w) => w.startsWith('summarize.ai 之全鏈條目皆有 prompt 長度上限（t:cap≤10）')), flow.info().startupWarnings.join('｜'))
            const r = await flow.info().ai.callJson('q', () => true, { spec: { use: 't:cap' } })
            assert.deepEqual([r.ok, r.attempts], [false, 0])
            assert.match(r.error, /超過本席位全部條目之上限（t:cap≤10）/)
        })

        it('陣列輸出之呼叫逐次截斷放行(經內建調度層之真實 REST 截斷):摘要批之最後一項截在半途 → 前段完整項目納入成筆記、未涵蓋者記 tries 留佇列', async () => {
            const wd = dirOf('rest-summ')
            const lg = logsOf()
            const flow = createKnowledgeSummarize({
                workDir: wd, netGuard: null, lock: false, logFactory: lg.factory,
                ai: { extraProviders: [{ id: 't:summ', kind: 'api-openai-compat', baseURL: REST_BASE, model: 'summ' }] },
                summarize: { ai: { use: 't:summ' }, triage: { enabled: false }, rounds: 1 },
            })
            await seedDocs(flow, [rawDoc('r1', { title: '第一篇文件' }), rawDoc('r2', { title: '第二篇文件', collectedAt: '2026-09-02T00:00:00+08:00' })])
            const rep = await flow.run()
            const sd = subReport(rep, '摘要', 'summarize').detail
            assert.deepEqual([sd.notes, sd.missed, sd.failedBatches], [1, 1, 0], JSON.stringify(sd))
            await withStores(flow, async (s) => {
                assert.deepEqual([(await s.docs.get('r1')).status, (await s.docs.get('r2')).status, (await s.docs.get('r2')).summarizeTries], ['noted', 'raw', 1])
            })
            assert.ok(lg.lines().includes('INFO 批次：2 項中 1 項完整、1 項未涵蓋（留佇列下輪）'), lg.lines().join('\n'))
            assert.ok(srv.hits.some((h) => h.model === 'summ' && /--- 第2篇 ---/.test(h.prompt)), '兩篇同一批送出')
        })

        it('斷網不計:注入之 netGuard 確認不通 → 整鏈皆敗之呼叫記 skipped(批次中止),文件之 tries 不變、WARN 含「本機網路不通」;netGuard 為 null → 照常記 tries', async () => {
            const wire = (netGuard, wd, lg) => createKnowledgeSummarize({
                workDir: wd, netGuard, lock: false, logFactory: lg.factory,
                ai: { extraProviders: [{ id: 't:dead', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm' }] },
                summarize: { ai: { use: 't:dead' }, triage: { enabled: false } },
            })
            let asked = 0
            const guard = { check: async () => ({ up: false, detail: [] }), confirmDown: async () => {
                asked++
                return true
            }, isDown: () => true, describe: () => '' }
            const lg = logsOf()
            const down = wire(guard, dirOf('net-down'), lg)
            await seedDocs(down, [rawDoc('n1')])
            const rep = await down.run()
            const sd = subReport(rep, '摘要', 'summarize').detail
            assert.deepEqual([sd.aborted, sd.failedBatches, asked], [true, 0, 1])
            await withStores(down, async (s) => assert.equal((await s.docs.get('n1')).summarizeTries, undefined, '斷網不記 tries'))
            assert.ok(lg.lines().some((l) => /^WARN 批次 AI 失敗（本機網路不通（不計此次之失敗）：/.test(l)), lg.lines().join('\n'))
            const lg2 = logsOf()
            const plain = wire(null, dirOf('net-null'), lg2)
            await seedDocs(plain, [rawDoc('n2')])
            await plain.run()
            await withStores(plain, async (s) => assert.equal((await s.docs.get('n2')).summarizeTries, 1, '非斷網之失敗照常記 tries'))
            assert.ok(!lg2.lines().some((l) => l.includes('本機網路不通')))
        })

        it('調度層事件寫入當輪日誌(內建調度層;條目指向無人監聽之埠):健康降序(ai.healthStreak 1)「供應商健康：」、免費池額度(ai.pools)「供應商額度：」、能力剔除(ai.providerLimits)「供應商能力：」各一行;注入之調度層不接', async () => {
            const dead = { id: 't:dead', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm' }
            const run = async (ai, summarize, extra = {}) => {
                const lg = logsOf()
                const flow = createKnowledgeSummarize({ workDir: dirOf('ev'), netGuard: null, lock: false, clock: FIXED_CLOCK, logFactory: lg.factory, ai, summarize: { triage: { enabled: false }, ...summarize }, ...extra })
                await seedDocs(flow, [rawDoc('e1')])
                await flow.run()
                return lg.lines().filter((l) => l.startsWith('WARN 供應商'))
            }
            const h = await run({ extraProviders: [dead], healthStreak: 1 }, { ai: { use: 't:dead' } })
            assert.equal(h.length, 1, h.join('\n'))
            assert.match(h[0], /^WARN 供應商健康：t:dead 連續 1 次 \S+ 失敗（.*），降序冷卻$/)
            const ocLog = `${dirOf('oclog')}/opencode.log`
            fs.mkdirSync(path.dirname(ocLog), { recursive: true })
            fs.writeFileSync(ocLog, `timestamp=${new Date().toISOString()} level=ERROR providerID=opencode modelID=mimo-v2.6-flash-free error.error="AI_APICallError: Rate limit exceeded. Please try again later."\n`, 'utf8')
            const p = await run({ extraProviders: [dead], pools: { oc: { log: ocLog, resetUtcHour: 0 } } }, { ai: { use: 't:dead' } })
            assert.equal(p.length, 1, p.join('\n'))
            assert.match(p[0], /^WARN 供應商額度：oc:opencode\/mimo-v2\.6-flash-free 自 \d{2}:\d{2} 起 opencode 日誌回報當日額度用盡（1 筆，最近 \d{2}:\d{2}），本輪呼叫前降至鏈尾、照設定遞補，至每日重置（UTC 0 時）止$/)
            const c = await run({ extraProviders: [dead, { ...dead, id: 't:dead2' }], providerLimits: { 't:dead': 5 } }, { ai: { use: 't:dead', fallback: ['t:dead2'] } })
            assert.equal(c.length, 1, c.join('\n'))
            assert.match(c[0], /^WARN 供應商能力：t:dead 之 prompt 上限 5 字元，本輪有呼叫達 \d+ 字元而改由遞補承接（未 spawn）$/)
            const off = await run({ healthStreak: 1, pools: { oc: { log: ocLog } } }, {}, { aiAdapter: scriptedAi(() => 'fail') })
            assert.deepEqual(off, [], '注入之調度層屬注入方:不接事件')
        })

        it('摘要之調度層預設開健康降序(ai.healthStreak 3):同一條目連續 3 次整鏈皆敗才降序', async () => {
            assert.equal(build().info().settings.ai.healthStreak, 3)
            const lg = logsOf()
            const flow = createKnowledgeSummarize({
                workDir: dirOf('streak'), netGuard: null, lock: false, logFactory: lg.factory,
                ai: { extraProviders: [{ id: 't:dead', kind: 'api-openai-compat', baseURL: DEAD_BASE, model: 'm' }] },
                summarize: { ai: { use: 't:dead' } },
            })
            const ai = flow.info().ai
            assert.equal(ai.health.threshold, 3)
            for (let i = 0; i < 2; i++) await ai.callJson('q', () => true, { spec: { use: 't:dead' } })
            assert.equal(ai.health.snapshot().counts['t:dead']?.cooled || 0, 0, '2 次未達門檻')
            await ai.callJson('q', () => true, { spec: { use: 't:dead' } })
            assert.equal(ai.health.snapshot().counts['t:dead'].cooled, 1, '第 3 次整鏈皆敗即降序')
        })
    })

    // ══════════════════════════ 集合落點(真 LMDB) ══════════════════════════
    describe('集合之落點(真 LMDB)', function() {

        it('lmdb.cls 改名之集合:資料寫入自訂之集合名、預設名之集合為空', async () => {
            const wd = dirOf('cls')
            const flow = createKnowledgeSummarize({ workDir: wd, aiAdapter: stubAi, netGuard: null, lock: false, lmdb: { cls: { notes: 'myNotes' } } })
            await withStores(flow, async (st) => {
                await st.notes.insertNew([{ id: 'n1', title: 't' }])
            })
            const peek = async (cl) => {
                const c = W.openCollection({ WOrm: WOrmLmdb, path: `${wd}/db`, db: 'knowledge', cl })
                try {
                    return (await c.select()).map((r) => r.id)
                }
                finally {
                    await c.close()
                }
            }
            assert.deepEqual(await peek('myNotes'), ['n1'])
            assert.deepEqual(await peek('notes'), [], '預設名之筆記集合不得有資料')
        })
    })
})
