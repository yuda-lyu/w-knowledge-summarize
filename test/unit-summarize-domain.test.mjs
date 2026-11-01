// unit-summarize-domain.test.mjs — 摘要之 domain 層(domain/):預設(triageDomain)、摘要(noteDomain:摘要／忠實性／修補提示詞、項目驗證、品質標注、
//   md 版型)、重標(retagDomain)
// 規則(出自各檔頭):
//   ①預設提示詞逐字等於標準檔(test/golden/prompts-default.json;兩組詞彙 × 13 類固定輸入;產生與比對:test/tools/genPromptGolden.mjs)。
//     與原實作之差異只在刻意之中立化(預設 caveatExamples、忠實性 ③④);給回領域專案之詞彙即逐字相同
//   ②提示詞之領域句:guide 各欄位各有唯一落點、kbLabel 為各類提示詞首句之稱呼;guide 不影響輸出格式說明與驗證;逐欄回退、空字串照填
//   ③例句不綁領域:JSON 範例之內容類型／證據等級取詞彙表;忠實性 ③④ 取 guide.faith(給回領域專案之值即逐字等於其原句)
//   ④提示詞覆寫(opt.prompts):覆寫函數收原參數＋末參數 ctx { kbLabel, domain, vocab, defaultPrompt };defaultPrompt 包裝後逐字等於內建;
//     建構期驗形狀(非函數、opt.prompts 非物件、不認得之鍵);呼叫期回傳非空字串以外即拋;輸出驗證不隨覆寫改變
//   ⑤長文:預篩逾門檻另附中段;摘要之 budgets 等於字數時逐字不變、非正整數回退
//   ⑥項目驗證與落地同一規則;md 版型(參數表轉義、內文取得方式之顯示名取抓取套件、截斷明示)
//   ⑦領域中立:預設提示詞(無詞彙與 { domain:'天文學' })與本三層原始碼(含註解)不含特定產業領域之詞彙
// 移植原實作之領域中立、領域句欄位化、長文、修補提示詞各案(斷言不變;以 plain 詞彙之案改為先 resolveSummarizeVocab);提示詞覆寫、
//   標準檔、例句與中立掃描之案為新增。
// 執行:自套件根 node <mocha> test/unit-summarize-domain.test.mjs(純函數與唯讀之原始碼掃描;不連網、不呼叫 AI、不寫檔)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderSummarizePrompts, renderPromptGolden, PROMPT_VARIANTS } from './tools/promptFixtures.mjs'
import { domainTermsIn, msgOf, goldenDiffOf } from './tools/captureForTest.mjs'
import { SUMMARIZE_GUIDE_FIELDS, resolveSummarizeVocab, kbLabelOf } from '../src/core/vocab/summarizeVocab.mjs'
import { createTriageDomain, TRIAGE_PROMPT_SIGS } from '../src/domain/triageDomain.mjs'
import { createSummarizeDomain, NOTE_PROMPT_SIGS } from '../src/domain/noteDomain.mjs'
import { cleanStrList } from '../src/standards/noteNormalize.mjs'
import { SUMMARIZE_PROMPT_SIGS } from '../src/summarizeRuntime.mjs'
import { createRetagDomain, RETAG_PROMPT_SIGS } from '../src/domain/retagDomain.mjs'
import { normalizeNoteItem } from '../src/standards/noteNormalize.mjs'
import { repairProblemsOf } from '../src/standards/noteRepair.mjs'

// 套件根(以本檔位置定,不依 cwd)
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const GOLDEN = JSON.parse(fs.readFileSync(path.join(PKG, 'test/golden/prompts-default.json'), 'utf8'))
const SUMMARIZE_KEYS = ['summarize', 'summarizeNoVocab', 'summarizeBudgets', 'summarizeFeedback']
const count = (s, m) => s.split(m).length - 1

/** 各段欄位之標記值(字串／陣列／證據等級物件依型別給) */
function markerGuide() {
    const g = {}
    for (const [sec, fields] of Object.entries(SUMMARIZE_GUIDE_FIELDS)) {
        g[sec] = {}
        for (const [k, type] of Object.entries(fields)) {
            const m = `⟦${sec}.${k}⟧`
            g[sec][k] = type === 'array' ? [m] : type === 'levelMap' ? { '高': m } : m
        }
    }
    return g
}

/** 欄位 → 應出現之提示詞鍵(證據等級之定義另見於修補提示詞之擇一清單) */
function targetsOf(sec, k) {
    if (sec === 'triage') return k === 'fallbackReason' ? ['triageReason'] : ['triage', 'triageLong']
    if (sec === 'summarize') return k === 'evidenceLevelDefs' ? [...SUMMARIZE_KEYS, 'repair'] : SUMMARIZE_KEYS
    return ['faith']
}

describe('unit-summarize-domain', function() {

    // ══════════════════════════ ①預設提示詞 ══════════════════════════
    describe('① 預設提示詞與標準檔', function() {

        it('兩組詞彙(無、domain)× 13 類固定輸入之提示詞與標準檔逐字相同', () => {
            const now = renderPromptGolden()
            assert.deepEqual(Object.keys(now), Object.keys(PROMPT_VARIANTS))
            // 逐鍵差異取標準檔共用件(goldenDiffOf;產生器 test/tools/genPromptGolden.mjs 同一份判準):不同者與標準檔多出者皆列
            assert.deepEqual(goldenDiffOf(now, GOLDEN), [], '須與標準檔逐字相同(重產見 test/tools/genPromptGolden.mjs)')
            assert.equal(Object.keys(now.noDomain).length, 13)
        })

        it('預設提示詞稱呼為「知識庫」、無主題範圍句;regime_dependency 之稱呼與 md 章節名一致', () => {
            const ps = renderSummarizePrompts(null)
            for (const [name, p] of Object.entries(ps)) if (name !== 'triageReason') assert.match(p, /^你是知識庫的/, `${name} 稱呼`)
            assert.doesNotMatch(ps.triage, /主題範圍為/, '未給 domain 即不限主題')
            assert.ok(ps.summarize.includes('regime_dependency：時效與機制相依（0-3 條）'))
            assert.ok(!Object.values(ps).some((s) => s.includes('時效與條件相依')))
        })

        it('vocab.domain 注入主題範圍:各類提示詞之稱呼帶主題;預篩與摘要另加主題限定', () => {
            const ps = renderSummarizePrompts({ domain: '機器學習' })
            for (const [name, p] of Object.entries(ps)) if (name !== 'triageReason') assert.match(p, /^你是「機器學習」知識庫的/, name)
            assert.match(ps.triage, /本知識庫之主題範圍為「機器學習」：與此主題無關者判 false/)
            assert.match(ps.summarize, /是否含有與「機器學習」相關、可長期複用之知識/)
            assert.match(ps.summarize, /、與「機器學習」無關之內容，/)
        })

        it('提示詞帶詞彙表(類別)與 JSON 欄位——版型與 schema 之契約', () => {
            const s = createSummarizeDomain({ vocab: { categories: ['甲類', '其他'] } }).buildPrompt([{ title: '標題', sourceName: '來源', url: 'https://e.com/a', text: '內文片段' }], ['概念(2)'])
            assert.match(s, /category 從此清單擇一：甲類、其他/)
            assert.match(s, /"category":"甲類"/, 'JSON 範例之 category 取詞彙表第一項,不寫死')
            for (const f of ['key_points', 'concepts', 'claim_type', 'evidence_level', 'regime_dependency', 'counter_views', 'explore']) assert.ok(s.includes(`"${f}"`), f)
        })

        it('預篩 reasonOf:模型漏給理由時之預設不綁領域(有 domain 則帶主題)', () => {
            assert.equal(createTriageDomain({}).reasonOf({}), '無可複用知識')
            assert.equal(createTriageDomain({ vocab: { domain: '機器學習' } }).reasonOf({}), '與「機器學習」無關或無可複用知識')
            assert.equal(createTriageDomain({}).reasonOf({ reason: ' 純 新聞 ' }), '純 新聞')
        })
    })

    // ══════════════════════════ ②領域句 ══════════════════════════
    describe('② 提示詞之領域句(vocab.guide／kbLabel)', function() {

        it('每個欄位各有唯一落點:標記只出現在對應提示詞一次、不出現在其他提示詞;kbLabel 出現在各類提示詞首句各一次', () => {
            const now = renderSummarizePrompts({ kbLabel: '⟦kbLabel⟧', guide: markerGuide() })
            let n = 0
            for (const [sec, fields] of Object.entries(SUMMARIZE_GUIDE_FIELDS)) {
                for (const k of Object.keys(fields)) {
                    const m = `⟦${sec}.${k}⟧`
                    const tg = targetsOf(sec, k)
                    for (const [key, s] of Object.entries(now)) assert.equal(count(s, m), tg.includes(key) ? 1 : 0, `${m} 於 ${key}`)
                    n++
                }
            }
            assert.equal(n, 18, '欄位共 18 個(預篩 8、摘要 8、忠實性 2;＋kbLabel＝19)')
            for (const [key, s] of Object.entries(now)) {
                if (key === 'triageReason') {
                    assert.equal(count(s, '⟦kbLabel⟧'), 0)
                    continue
                }
                assert.equal(count(s, '⟦kbLabel⟧'), 1, `kbLabel 於 ${key}`)
                assert.ok(s.startsWith('你是⟦kbLabel⟧的'), `${key} 首句用 kbLabel`)
            }
        })

        it('輸出格式說明與驗證函數不受欄位影響(全部欄位換成標記,「只回覆 JSON…」起之段落與預設逐字相同)', () => {
            const base = renderSummarizePrompts(null)
            const now = renderSummarizePrompts({ guide: markerGuide() })
            const tail = (s, mark) => s.slice(s.indexOf(mark))
            const pairs = [...Object.keys(base).filter((k) => k !== 'triageReason').map((k) => [k, ['faith', 'repair'].includes(k) ? '只回覆一個 JSON 物件' : '只回覆 JSON 陣列'])]
            for (const [key, mark] of pairs) {
                assert.ok(base[key].includes(mark), `${key} 含 ${mark}`)
                assert.equal(tail(now[key], mark), tail(base[key], mark), `${key} 之輸出格式段不變`)
            }
            const t = createTriageDomain({ vocab: { guide: markerGuide() } })
            assert.equal(t.isValidItem({ index: 1, relevant: true }, 1), true)
            assert.equal(t.isValidItem({ index: 2, relevant: true }, 1), false)
            const e = createSummarizeDomain({ vocab: { guide: markerGuide() } })
            assert.equal(e.isValidItem({ index: 1, relevant: true, title: 'T', key_points: ['k'], concepts: ['c'] }, 1), true)
            assert.equal(e.normalizeQuality({ evidence_level: '高' }).evidenceLevel, '高')
        })

        it('逐欄回退預設:只給一欄,提示詞只在該處不同(他段、他類提示詞逐字同標準檔)', () => {
            const now = renderSummarizePrompts({ guide: { faith: { scope: '特定族群或條件' } } })
            for (const [k, s] of Object.entries(now)) {
                const exp = k === 'faith' ? GOLDEN.noDomain.faith.replace('③原文只在特定對象、期間或條件下成立', '③原文只在特定族群或條件下成立') : GOLDEN.noDomain[k]
                assert.equal(s, exp, k)
            }
            assert.notEqual(now.faith, GOLDEN.noDomain.faith)
        })

        it('空字串照填(scopeLine:"" 關閉主題範圍句);null 視為未給(沿用預設);預設句依 domain 產生', () => {
            const withScope = renderSummarizePrompts({ domain: '機器學習' }).triage
            const noScope = renderSummarizePrompts({ domain: '機器學習', guide: { triage: { scopeLine: '' } } }).triage
            assert.ok(withScope.includes('\n本知識庫之主題範圍為「機器學習」：與此主題無關者判 false。'))
            assert.equal(noScope, withScope.replace('\n本知識庫之主題範圍為「機器學習」：與此主題無關者判 false。', ''))
            const nulls = renderSummarizePrompts({ domain: '機器學習', guide: { triage: { scopeLine: null, question: null }, summarize: null, faith: null } })
            assert.equal(nulls.triage, withScope)
            assert.deepEqual(nulls, renderSummarizePrompts({ domain: '機器學習' }))
        })

        it('證據等級擇一清單依 vocab.evidenceLevels 產生:改了等級名稱,提示詞與產出驗證同步(修補提示詞同一清單)', () => {
            const d1 = createSummarizeDomain({ vocab: { evidenceLevels: ['強', '弱'], guide: { summarize: { evidenceLevelDefs: { '強': '有重複驗證', '弱': '未驗證' } } } } })
            const p1 = d1.buildPrompt([{ title: 'T', sourceName: 'S', url: 'https://example.com/a', text: 't' }], [])
            assert.ok(p1.includes('evidence_level 擇一：強（有重複驗證）／弱（未驗證）；'))
            assert.ok(!p1.includes('高（'))
            assert.equal(d1.normalizeQuality({ evidence_level: '強' }).evidenceLevel, '強', '提示詞要求之等級即驗證所認之等級')
            assert.ok(d1.buildRepairPrompt({ material: 'm', item: {}, problems: [] }).includes('證據等級擇一：強（有重複驗證）／弱（未驗證）。'))
            const d2 = createSummarizeDomain({ vocab: { evidenceLevels: ['A', 'B'] } })
            assert.ok(d2.buildPrompt([], []).includes('evidence_level 擇一：A／B；'), '無定義之等級只列名稱')
        })

        it('kbLabel 明給者優先,空字串與未給由 domain 推導;各類提示詞首句皆用之', () => {
            assert.equal(kbLabelOf({ domain: '機器學習', kbLabel: 'ML知識庫' }), 'ML知識庫')
            assert.equal(kbLabelOf({ domain: '機器學習', kbLabel: '' }), '「機器學習」知識庫')
            assert.equal(kbLabelOf({ domain: '', kbLabel: '  ' }), '知識庫')
            const now = renderSummarizePrompts({ kbLabel: 'ML知識庫' })
            for (const k of Object.keys(now).filter((x) => x !== 'triageReason')) assert.ok(now[k].startsWith('你是ML知識庫的'), k)
        })
    })

    // ══════════════════════════ ③例句不綁領域 ══════════════════════════
    describe('③ 例句不綁領域', function() {

        it('JSON 範例之內容類型取 claimTypes 第一項、證據等級取 evidenceLevels 第二項(只有一級取第一項)', () => {
            const ex = (vocab) => createSummarizeDomain({ vocab }).buildPrompt([], []).match(/"claim_type":"([^"]*)","evidence_level":"([^"]*)"/).slice(1)
            assert.deepEqual(ex(null), ['實證研究', '中'], '預設詞彙下與既有提示詞逐字相同')
            assert.deepEqual(ex({ claimTypes: ['甲型', '乙型'], evidenceLevels: ['強', '弱'] }), ['甲型', '弱'])
            assert.deepEqual(ex({ claimTypes: ['甲型'], evidenceLevels: ['唯一'] }), ['甲型', '唯一'], '只有一級時取第一項')
            assert.deepEqual(ex({ evidenceLevels: ['A', 'B', 'C', 'D'] }), ['實證研究', 'B'])
        })

        it('忠實性判準 ③④ 取 guide.faith:預設為中立句;給回領域專案之值即逐字等於其原句', () => {
            const line = (p) => p.split('\n').find((l) => l.startsWith('- unfaithful：'))
            assert.equal(line(createSummarizeDomain({}).buildFaithCheckPrompt({ items: [] })),
                '- unfaithful：有下列任一者——①筆記有原文沒有之結論或主張；②否定、方向或比較翻錯（如原文「不顯著」寫成「顯著」、「低於」寫成「高於」）；③原文只在特定對象、期間或條件下成立之結論，筆記寫成普遍成立；④證據等級或其說明誇大原文（如原文只有初步或單一來源之結果，筆記寫有獨立驗證或實際應用）。數字是否見於原文另有程式核對，不必逐一比對數字。')
            // 領域專案之原句(該專案原實作之忠實性提示詞判準行,逐字)
            const quant = createSummarizeDomain({ vocab: { guide: { faith: { scope: '特定市場、期間或條件', overclaim: '原文只有回測，筆記寫有樣本外驗證或實盤' } } } })
            assert.equal(line(quant.buildFaithCheckPrompt({ items: [] })),
                '- unfaithful：有下列任一者——①筆記有原文沒有之結論或主張；②否定、方向或比較翻錯（如原文「不顯著」寫成「顯著」、「低於」寫成「高於」）；③原文只在特定市場、期間或條件下成立之結論，筆記寫成普遍成立；④證據等級或其說明誇大原文（如原文只有回測，筆記寫有樣本外驗證或實盤）。數字是否見於原文另有程式核對，不必逐一比對數字。')
        })
    })

    // ══════════════════════════ ④提示詞覆寫 ══════════════════════════
    describe('④ 提示詞覆寫(opt.prompts)', function() {
        const V = { domain: '天文學', categories: ['觀測', '理論', '其他'] }
        const DOCS = [{ title: '標題甲', sourceName: '來源甲', url: 'https://example.com/a', text: '內文甲' }]
        const FAITH_IN = { items: [{ index: 1, title: '甲', material: '原文甲', noteText: '標題：甲' }] }
        const REPAIR_IN = { material: '原文', item: { title: '甲', summary: '乙' }, problems: [{ field: 'title', kind: 'text', index: -1, line: '甲', detail: '缺' }] }
        const RETAG_ITEMS = [{ title: '筆記甲', category: '其他', summary: '重點', points: ['知識'] }]
        const FOCUS = { focus: { reason: 'add', category: '觀測' } }
        // 鍵 → 工廠、工廠名、覆寫函數之參數說明、呼叫方式與其原參數
        const SPECS = {
            summarize: { owner: 'createSummarizeDomain', sig: '(docs, conceptVocab, o, ctx)', make: (opt) => createSummarizeDomain({ vocab: V, ...opt }), call: (d) => d.buildPrompt(DOCS, ['概念甲'], { budgets: [2] }), args: [DOCS, ['概念甲'], { budgets: [2] }] },
            faith: { owner: 'createSummarizeDomain', sig: '(input, ctx)', make: (opt) => createSummarizeDomain({ vocab: V, ...opt }), call: (d) => d.buildFaithCheckPrompt(FAITH_IN), args: [FAITH_IN] },
            repair: { owner: 'createSummarizeDomain', sig: '(input, ctx)', make: (opt) => createSummarizeDomain({ vocab: V, ...opt }), call: (d) => d.buildRepairPrompt(REPAIR_IN), args: [REPAIR_IN] },
            triage: { owner: 'createTriageDomain', sig: '(docs, ctx)', make: (opt) => createTriageDomain({ vocab: V, ...opt }), call: (d) => d.buildPrompt(DOCS), args: [DOCS] },
            retag: { owner: 'createRetagDomain', sig: '(items, o, ctx)', make: (opt) => createRetagDomain({ vocab: V, ...opt }), call: (d) => d.buildPrompt(RETAG_ITEMS, FOCUS), args: [RETAG_ITEMS, FOCUS] },
        }

        it('覆寫函數收原參數＋末參數 ctx { kbLabel, domain, vocab, defaultPrompt };回傳值即提示詞;未覆寫之他項仍為內建', () => {
            for (const [key, s] of Object.entries(SPECS)) {
                const seen = []
                const d = s.make({ prompts: { [key]: (...a) => {
                    seen.push(a)
                    return `自訂-${key}`
                } } })
                assert.equal(s.call(d), `自訂-${key}`, key)
                const a = seen[0]
                const ctx = a.at(-1)
                assert.deepEqual(a.slice(0, -1), s.args, `${key}:原參數`)
                assert.deepEqual(Object.keys(ctx), ['kbLabel', 'domain', 'vocab', 'defaultPrompt'], key)
                assert.deepEqual([ctx.kbLabel, ctx.domain, ctx.vocab === d.vocab, typeof ctx.defaultPrompt], ['「天文學」知識庫', '天文學', true, 'function'], key)
            }
            const d = createSummarizeDomain({ vocab: V, prompts: { faith: () => '自訂' } })
            assert.equal(d.buildPrompt(DOCS, []), createSummarizeDomain({ vocab: V }).buildPrompt(DOCS, []), '只覆寫忠實性 → 摘要提示詞仍為內建')
            assert.equal(d.buildRepairPrompt(REPAIR_IN), createSummarizeDomain({ vocab: V }).buildRepairPrompt(REPAIR_IN))
        })

        it('原參數之正規化:少給或型別不符之參數補成內建之預設形狀(ctx 恆為末參數)', () => {
            const got = {}
            const rec = (key) => (...a) => {
                got[key] = a
                return 'x'
            }
            createSummarizeDomain({ prompts: { summarize: rec('summarize') } }).buildPrompt(DOCS)
            createTriageDomain({ prompts: { triage: rec('triage') } }).buildPrompt(null)
            createRetagDomain({ prompts: { retag: rec('retag') } }).buildPrompt('x', 'y')
            assert.deepEqual([got.summarize.length, got.summarize[0], got.summarize[1], got.summarize[2], typeof got.summarize[3].defaultPrompt], [4, DOCS, [], {}, 'function'])
            assert.deepEqual([got.triage.length, got.triage[0], typeof got.triage[1].defaultPrompt], [2, [], 'function'])
            assert.deepEqual([got.retag.length, got.retag[0], got.retag[1], typeof got.retag[2].defaultPrompt], [3, [], {}, 'function'])
        })

        it('defaultPrompt 包裝:以原參數呼叫 → 逐字等於內建;前後加註者只差加註處', () => {
            for (const [key, s] of Object.entries(SPECS)) {
                const builtin = s.call(s.make({}))
                const wrap = s.make({ prompts: { [key]: (...a) => a.at(-1).defaultPrompt(...a.slice(0, -1)) } })
                assert.equal(s.call(wrap), builtin, key)
                const deco = s.make({ prompts: { [key]: (...a) => `前言\n${a.at(-1).defaultPrompt(...a.slice(0, -1))}\n附註` } })
                assert.equal(s.call(deco), `前言\n${builtin}\n附註`, key)
            }
        })

        it('呼叫期:覆寫函數回傳非空字串以外(空字串、空白、非字串)→ 拋', () => {
            for (const [key, s] of Object.entries(SPECS)) {
                for (const bad of ['', '   ', 123, undefined, null, {}]) {
                    assert.equal(msgOf(() => s.call(s.make({ prompts: { [key]: () => bad } }))), `opt.prompts.${key} 須回傳非空字串`, `${key}=${JSON.stringify(bad)}`)
                }
            }
        })

        it('建構期:值非函數 → 拋(附函數形式「(參數) => 回傳」,與 cfg 層同形);opt.prompts 非物件 → 拋;不認得之鍵(含他工廠之鍵)→ 拋並列可用鍵;undefined／null 值 → 用內建', () => {
            for (const [key, s] of Object.entries(SPECS)) {
                for (const bad of ['x', 1, {}, [], true]) assert.equal(msgOf(() => s.make({ prompts: { [key]: bad } })), `${s.owner} 之 opt.prompts.${key} 須為函數 ${s.sig} => 提示詞字串`, `${key}=${JSON.stringify(bad)}`)
                for (const v of [undefined, null]) assert.equal(s.call(s.make({ prompts: { [key]: v } })), s.call(s.make({})), `${key}=${v}`)
            }
            assert.equal(msgOf(() => createSummarizeDomain({ prompts: 'x' })), 'createSummarizeDomain 之 opt.prompts 須為物件 { summarize, faith, repair }（各為覆寫提示詞之函數）')
            assert.equal(msgOf(() => createTriageDomain({ prompts: [() => 'x'] })), 'createTriageDomain 之 opt.prompts 須為物件 { triage }（各為覆寫提示詞之函數）')
            assert.equal(msgOf(() => createRetagDomain({ prompts: () => 'x' })), 'createRetagDomain 之 opt.prompts 須為物件 { retag }（各為覆寫提示詞之函數）')
            assert.equal(msgOf(() => createSummarizeDomain({ prompts: { triage: () => 'x' } })), 'createSummarizeDomain 之 opt.prompts 含不認得之鍵：triage（可用：summarize、faith、repair）')
            assert.equal(msgOf(() => createTriageDomain({ prompts: { summarize: () => 'x', retag: () => 'y' } })), 'createTriageDomain 之 opt.prompts 含不認得之鍵：summarize、retag（可用：triage）')
            assert.equal(msgOf(() => createRetagDomain({ prompts: { retags: () => 'x' } })), 'createRetagDomain 之 opt.prompts 含不認得之鍵：retags（可用：retag）')
            assert.doesNotThrow(() => createSummarizeDomain({ prompts: null }))
        })

        it('各 domain 檔之 SIGS 為覆寫形式之唯一來源({ params };凍結):鍵即該工廠可覆寫之提示詞、參數說明即上列之 sig;摘要執行期件之 SUMMARIZE_PROMPT_SIGS 由三者組成', () => {
            const all = { ...NOTE_PROMPT_SIGS, ...TRIAGE_PROMPT_SIGS, ...RETAG_PROMPT_SIGS }
            assert.deepEqual(Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.params])), Object.fromEntries(Object.entries(SPECS).map(([k, s]) => [k, s.sig])))
            for (const sigs of [NOTE_PROMPT_SIGS, TRIAGE_PROMPT_SIGS, RETAG_PROMPT_SIGS]) assert.ok(Object.isFrozen(sigs) && Object.values(sigs).every((v) => Object.isFrozen(v)))
            assert.deepEqual(SUMMARIZE_PROMPT_SIGS, { ...TRIAGE_PROMPT_SIGS, ...NOTE_PROMPT_SIGS, ...RETAG_PROMPT_SIGS })
        })

        it('輸出驗證不隨覆寫改變:項目驗證、品質標注、md 版型、預篩理由與重標驗證同內建;domain 物件之成員不變', () => {
            const over = { prompts: { summarize: () => 'p', faith: () => 'f', repair: () => 'r' } }
            const plain = createSummarizeDomain({ vocab: V })
            const custom = createSummarizeDomain({ vocab: V, ...over })
            assert.deepEqual(Object.keys(custom), Object.keys(plain))
            assert.deepEqual(Object.keys(plain), ['vocab', 'locale', 'buildPrompt', 'isValidItem', 'normalizeQuality', 'renderNoteBody', 'buildFaithCheckPrompt', 'buildRepairPrompt', 'contract'])
            const items = [{ index: 1, relevant: true, title: 't', key_points: ['k'], concepts: ['c'] }, { index: 2, relevant: true, title: 't', key_points: [' '], concepts: ['c'] }, { index: 1.5, relevant: false }, { index: 1, relevant: 'x' }, { index: 4, relevant: false }]
            for (const it of items) assert.equal(custom.isValidItem(it, 3), plain.isValidItem(it, 3), JSON.stringify(it))
            const k = { title: 'T', summary: 's', key_points: ['k'], claim_type: '實證研究', evidence_level: '極高' }
            assert.deepEqual(custom.normalizeQuality(k), plain.normalizeQuality(k))
            assert.equal(custom.renderNoteBody(k, { title: 't', sourceName: 's', url: 'u' }, custom.normalizeQuality(k)), plain.renderNoteBody(k, { title: 't', sourceName: 's', url: 'u' }, plain.normalizeQuality(k)))
            const t0 = createTriageDomain({ vocab: V })
            const t1 = createTriageDomain({ vocab: V, prompts: { triage: () => 'p' } })
            assert.deepEqual(Object.keys(t1), ['vocab', 'buildPrompt', 'isValidItem', 'reasonOf'])
            for (const it of [{ index: 1, relevant: true }, { index: 2, relevant: true }, { index: 1, relevant: 'x' }]) assert.equal(t1.isValidItem(it, 1), t0.isValidItem(it, 1))
            assert.deepEqual([t1.reasonOf({}), t1.reasonOf({ reason: ' 甲 ' })], [t0.reasonOf({}), t0.reasonOf({ reason: ' 甲 ' })])
            const r0 = createRetagDomain({ vocab: V })
            const r1 = createRetagDomain({ vocab: V, prompts: { retag: () => 'p' } })
            assert.deepEqual(Object.keys(r1), ['vocab', 'buildPrompt', 'isValidItem'])
            for (const it of [{ index: 1, category: '觀測' }, { index: 1, category: '不在清單' }, { index: 2, category: '其他' }]) assert.equal(r1.isValidItem(it, 1), r0.isValidItem(it, 1))
        })
    })

    // ══════════════════════════ ⑤長文 ══════════════════════════
    describe('⑤ 長文', function() {
        /** 長度恰為 n 之正文,頭尾各帶標記 */
        const body = (tag, n) => {
            const head = `【${tag}頭】`
            const tail = `【${tag}尾】`
            return head + '量'.repeat(n - head.length - tail.length) + tail
        }
        const doc = (id, text, extra = {}) => ({ id, status: 'raw', title: `文件${id}`, url: `https://example.com/${id}`, sourceName: '來源', sourceTier: 1, text, textFrom: 'article', collectedAt: `2026-09-01T00:00:0${id.length}`, ...extra })

        it('字數 ≤ summarizeCharsPerDoc 之批:提示詞與未給 budgets 者逐字相同(評分題目識別不變);非正整數之預算回退 summarizeCharsPerDoc', () => {
            const d = createSummarizeDomain({ summarizeCharsPerDoc: 6000 })
            const short = [doc('a', body('甲', 5000)), doc('bb', body('乙', 6000)), doc('ccc', body('丙', 10))]
            assert.equal(d.buildPrompt(short, ['概念'], { budgets: short.map((x) => x.text.length) }), d.buildPrompt(short, ['概念']))
            assert.equal(d.buildPrompt(short, [], { budgets: [0, 'x', null] }), d.buildPrompt(short, []), '非正整數之預算回退 summarizeCharsPerDoc')
            const long = d.buildPrompt([doc('d', body('丁', 9000))], [], { budgets: [9000] })
            assert.ok(long.includes('【丁尾】'), '預算大於 summarizeCharsPerDoc 者全文進提示詞')
            assert.ok(!d.buildPrompt([doc('d', body('丁', 9000))], []).includes('【丁尾】'), '未給預算者截至 summarizeCharsPerDoc')
        })

        it('預篩:逾 longDocChars 者片段＝開頭＋（中段）各 triageCharsPerDoc 字;短文提示詞不變', () => {
            const t = createTriageDomain({ triageCharsPerDoc: 400, longDocChars: 6000 })
            const longText = `【開頭】${'甲'.repeat(4990)}【中段標記】${'乙'.repeat(5000)}`
            const p = t.buildPrompt([{ title: '長', sourceName: 's', text: longText }])
            assert.ok(p.includes('【開頭】') && p.includes('（中段）') && p.includes('【中段標記】'), p.slice(-1200))
            const block = p.split('\n').find((l) => l.startsWith('1. '))
            assert.ok(block.length < 2 * 400 + 60, `片段總長約 2×400:${block.length}`)
            const shortDocs = [{ title: '短', sourceName: 's', text: '甲'.repeat(6000) }]
            assert.equal(t.buildPrompt(shortDocs), createTriageDomain({ triageCharsPerDoc: 400 }).buildPrompt(shortDocs))
            assert.ok(!t.buildPrompt(shortDocs).includes('（中段）'), '等於門檻者不附中段')
        })
    })

    // ══════════════════════════ ⑥驗證與版型 ══════════════════════════
    describe('⑥ 項目驗證、md 版型、修補與重標之提示詞', function() {

        it('摘要項目驗證與落地同一規則:index 須為整數;key_points／concepts 以清洗後長度判非空(字串／數字元素、trim、濾空;物件元素丟棄)', () => {
            const d = createSummarizeDomain({})
            const base = { index: 1, relevant: true, title: 't', key_points: ['k'], concepts: ['c'] }
            assert.equal(d.isValidItem(base, 3), true)
            assert.equal(d.isValidItem({ ...base, index: 1.5 }, 3), false, '1.5 之項目對不到目標(batch[0.5])')
            assert.equal(d.isValidItem({ ...base, key_points: [' '] }, 3), false)
            assert.equal(d.isValidItem({ ...base, concepts: [{ name: 'c' }] }, 3), false, '物件元素落地會成 "[object Object]"')
            assert.equal(d.isValidItem({ ...base, concepts: [' c ', {}] }, 3), true, '有一個合法元素即可(物件元素落地時丟棄)')
            assert.deepEqual(cleanStrList([{}, ' a ', 1, '', null, 'b']), ['a', '1', 'b'])
            assert.doesNotMatch(d.renderNoteBody({ ...base, key_points: ['k1', { x: 1 }, ' k2 '] }, { title: 'T', sourceName: 's', url: 'u' }, d.normalizeQuality({})), /object Object/)
        })

        it('筆記版型之參數表:各欄一律轉義 |', () => {
            const note = createSummarizeDomain({}).renderNoteBody({ title: 'T', key_points: ['k'], parameters: [{ name: 'a|b', value: '1|2', note: 'c|d' }] }, { title: 't', sourceName: 's', url: 'u' }, createSummarizeDomain({}).normalizeQuality({}))
            assert.match(note, /\| a／b \| 1／2 \| c／d \|/)
        })

        it('來源章:內文取得方式之顯示名取抓取套件(feed／abstract／其餘為原網頁全文);處理範圍小於原文者另加截斷明示一行,未截斷者版型不變', () => {
            const d = createSummarizeDomain({})
            const q = d.normalizeQuality({})
            const k = { title: 'T', key_points: ['k'] }
            const src = (doc, meta) => d.renderNoteBody(k, { title: 't', sourceName: 's', url: 'u', ...doc }, q, meta).split('## 來源\n\n')[1]
            assert.equal(src({ textFrom: 'feed' }), '- 原文標題：t\n- 來源：s\n- 網址：u\n- 發布時間：（未提供）\n- 內文取得方式：feed 內嵌內文')
            assert.match(src({ textFrom: 'abstract', publishedAt: '2026-01-01' }), /- 發布時間：2026-01-01\n- 內文取得方式：論文摘要（abstract）$/)
            for (const tf of ['article', 'adapter:x', undefined, 'toString']) assert.match(src({ textFrom: tf }), /- 內文取得方式：原網頁全文$/, String(tf))
            assert.match(src({}, { sourceChars: 30000, processedChars: 18000 }), /- 內文取得方式：原網頁全文\n- 內文處理範圍：原文 30000 字，摘要只讀前 18000 字$/)
            assert.match(src({}, { sourceChars: 2000, processedChars: 2000 }), /- 內文取得方式：原網頁全文$/)
        })

        it('buildRepairPrompt:指出處逐條編號(含第 N 行)、規則(依原文、不得加入原文沒有之內容、改不成可刪該行、只更正被指出之處)、筆記與原文、回覆格式', () => {
            const VOCAB = resolveSummarizeVocab({ claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] })
            const domain = createSummarizeDomain({ vocab: VOCAB })
            const MATERIAL = '動量研究\nTaiwan momentum 12-1 earns 8.2% annual excess return over 2010-2024; Sharpe 0.71; costs 0.15%.'
            const ITEM = (o = {}) => ({ index: 1, relevant: true, title: '動量因子之台股實證', summary: '台股動量年化超額 8.2%', key_points: ['年化超額 8.2%', '夏普 1.9'], concepts: ['動量因子', '回測'], claim_type: '實證研究', evidence_level: '中', ...o })
            const k = normalizeNoteItem(ITEM({ title: '動量年化 9.9%' }), { vocab: VOCAB }).item
            const ps = repairProblemsOf(k, { vocab: VOCAB, material: MATERIAL })
            const p = domain.buildRepairPrompt({ material: MATERIAL, item: k, problems: ps })
            for (const s of ['請只更正這些地方', '一律依原文', '不可加入原文沒有之數字、參數或結論', '可刪除（value 給 null）', '標題與一句話重點不可刪除', '內容類型擇一：實證研究／觀點評論',
                '【需更正之處】\n1. 標題：「動量年化 9.9%」——含原文沒有之數字（9.9%）\n2. 核心知識（第 2 行）：「夏普 1.9」——含原文沒有之數字（1.9）',
                '【筆記】\n標題：動量年化 9.9%', '核心知識：\n1. 年化超額 8.2%\n2. 夏普 1.9', `【原文】\n${MATERIAL}`, '{"repairs":[{"no":1,"value":"更正後之文字"},{"no":2,"value":null}]}']) assert.ok(p.includes(s), s)
            assert.ok(p.includes('5. 概念為 2 到 6 個標籤'), '概念個數取單一常數(字樣不變)')
        })

        it('重標提示詞:分類清單、焦點(新增類別附關鍵詞與落點規則;退役類別;requeue 無焦點句)、核心知識前三條;驗證只收清單內之類別', () => {
            const d = createRetagDomain({ vocab: { categories: ['方法', '風險', '風控', '其他'], categoryHints: { 風控: ['回撤'] } } })
            const items = [{ title: '甲', category: '其他', summary: '重點', points: ['一', '二', '三', '四'] }]
            const add = d.buildPrompt(items, { focus: { reason: 'add', category: '風控' } })
            assert.match(add, /^你是知識庫的分類器。以下 1 篇知識筆記/)
            assert.match(add, /分類清單：方法、風險、風控、其他\n本次分類清單新增了「風控」（相關關鍵詞：回撤）：請判斷各篇是否更適合歸入「風控」。/)
            assert.match(add, /原類別為「其他」者，依分類清單擇一最合適之類別；原類別為清單中其他類別者，只在「風控」與原類別之間擇一/)
            assert.ok(add.includes('   核心知識：一；二；三\n') || add.endsWith('   核心知識：一；二；三'), '只帶前三條')
            assert.match(d.buildPrompt(items, { focus: { reason: 'retire', category: '舊類' } }), /\n「舊類」已自分類清單移除：各篇須改選分類清單中之類別。/)
            assert.equal(d.buildPrompt(items, { focus: { reason: 'requeue', category: '方法' } }), d.buildPrompt(items), 'requeue 無焦點句')
            assert.deepEqual([d.isValidItem({ index: 1, category: '風控' }, 1), d.isValidItem({ index: 1, category: '不在清單' }, 1), d.isValidItem({ index: 2, category: '方法' }, 1)], [true, false, false])
        })
    })

    // ══════════════════════════ ⑦領域中立 ══════════════════════════
    describe('⑦ 領域中立', function() {
        // 特定產業領域之詞彙(中英;預設提示詞與本三層原始碼不得含):詞表與命中函數取抓取套件之 test/tools/domainTerms(經 test/tools/captureForTest;四套件同一份)
        const hits = domainTermsIn
        // 本三層之原始碼(15 檔)
        const SOURCES = [
            'standards/noteStandards.mjs', 'standards/noteNormalize.mjs', 'standards/noteGate.mjs', 'standards/noteRepair.mjs', 'standards/faithCheck.mjs',
            'domain/noteDomain.mjs', 'domain/triageDomain.mjs', 'domain/retagDomain.mjs',
            'stores/noteBuild.mjs', 'stores/noteSync.mjs', 'stores/knownConcepts.mjs', 'stores/packByChars.mjs', 'stores/noteHolds.mjs', 'stores/taxonomy.mjs', 'stores/materialPolicy.mjs',
        ]

        it('詞表自檢:領域詞被抓到;中立詞、識別字與模型條目 id 之片段不誤判', () => {
            assert.deepEqual(hits('量化交易之股票回測與樣本外'), ['量化', '交易', '股票', '回測', '樣本外'])
            assert.deepEqual(hits('Quant trading stock backtests sharpe alpha'), ['quant', 'trading', 'stock', 'backtest', 'sharpe', 'alpha'])
            assert.deepEqual(hits('天文學知識庫：quantum tunneling、docStockFix、oc:opencode/fledge-alpha-free、future work'), [])
        })

        it('預設提示詞(無詞彙與 { domain:"天文學" } 兩組;預篩、摘要、忠實性、修補、重標之全部固定輸入)不含領域詞彙', () => {
            for (const vocab of [null, { domain: '天文學' }]) {
                for (const [name, p] of Object.entries(renderSummarizePrompts(vocab))) assert.deepEqual(hits(p), [], `${JSON.stringify(vocab)}:${name}`)
            }
        })

        it('本三層之原始碼(15 檔;含註解與日誌、訊息、待判字樣)不含領域詞彙', () => {
            const bad = []
            for (const f of SOURCES) {
                const h = hits(fs.readFileSync(path.join(PKG, 'src', f), 'utf8'))
                if (h.length) bad.push(`${f}：${h.join('、')}`)
            }
            assert.deepEqual(bad, [])
        })
    })
})
