// unit-vocab.test.mjs — 摘要之詞彙表(core/vocab/summarizeVocab):預設、只認本套件之鍵、抓取共用之鍵交抓取套件驗、摘要鍵之逐條驗證、
//   guide 三段之逐欄回退與型別、證據規則之送達(缺即拋)、子集擷取、可重複套用、預設領域中立
// 規則(出自 summarizeVocab 之設計):
//   ①只認 SUMMARIZE_VOCAB_KEYS(抓取共用之 domain／kbLabel／conceptRenames／conceptAliases＋摘要自有之鍵);不認得之鍵拋錯並列可用鍵
//   ②抓取共用之鍵之驗證取抓取套件(同一份規則);摘要自有之鍵逐條驗證(清單、落點、改名表與對照鏈、退役、重判提示),錯誤訊息列出路徑
//   ③guide 只認 triage、summarize、faith 三段;逐欄回退預設;欄位型別 string／estr／array／levelMap;evidenceLevelDefs 之鍵須為 evidenceLevels 之成員
//   ④evidenceRule 預設不啟用(null);給了即須完整;產物之 evidenceRule 為已編譯之規則物件——assertSummarizeVocab 以之辨認已解析之詞彙表,
//     未經本套件解析者(含 {}、他段之詞彙表、JSON 往返之複本)即拋錯,不靜默退回不啟用
//   ⑤可重複套用(含 JSON 往返後再解析);各次解析之產物互不共用預設常數之參照
//   ⑥預設值與定義預設之原始碼(含註解)不含特定產業領域之詞彙
// 執行:自套件根 node <mocha> test/unit-vocab.test.mjs(純函數與唯讀原始碼掃描,不連網、不寫檔)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    SUMMARIZE_GUIDE_FIELDS, SUMMARIZE_VOCAB_DEFAULT, SUMMARIZE_VOCAB_KEYS,
    guideDefaultOf, resolveSummarizeVocab, assertSummarizeVocab, pickSummarizeVocab, kbLabelOf,
} from '../src/core/vocab/summarizeVocab.mjs'
import { EVIDENCE_RULE_DEFAULT, evidenceRuleOf, isEvidenceRule } from '../src/core/standards/evidenceRules.mjs'
import { SUMMARIZE_DEFAULT, SUMMARIZE_AI_DEFAULT, resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'
import { resolveCaptureVocab } from '../src/core/capturePackage.mjs'
import { DOMAIN_TERMS, domainTermsIn, msgOf } from './tools/captureForTest.mjs'

// 套件根(以本檔位置定,不依 cwd)
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 可比對之序列化(已編譯之證據規則 JSON 化為其正規形) */
const snap = (v) => JSON.stringify(v)

const R = (o) => resolveSummarizeVocab(o)
const CATS = SUMMARIZE_VOCAB_DEFAULT.categories
const PEER = { subject: '同儕審查', check: '同儕審查', strict: [{ p: '(?:未經|沒有|無)同儕審查' }], loose: [{ p: '(?:未|無)[^；;。]{0,10}同儕審查' }] }

// 特定產業領域之詞彙(中英)與命中函數取抓取套件之 test/tools/domainTerms(經 test/tools/captureForTest;四套件同一份;本檔自身不含該等詞彙之字面)
const TERMS = DOMAIN_TERMS
const termsIn = domainTermsIn

describe('unit-vocab', function() {

    describe('① 預設與鍵集', function() {

        it('可用鍵:抓取共用之鍵(鍵集取自抓取套件)＋摘要自有之鍵', () => {
            const shared = Object.keys(resolveCaptureVocab({}))
            assert.deepEqual(shared, ['domain', 'kbLabel', 'conceptRenames', 'conceptAliases'])
            assert.deepEqual([...SUMMARIZE_VOCAB_KEYS], [...shared, 'categories', 'fallbackCategory', 'categoryRenames', 'categoryRetire', 'categoryHints',
                'claimTypeRenames', 'evidenceLevelRenames', 'claimTypes', 'evidenceLevels', 'guide', 'evidenceRule'])
            assert.ok(Object.isFrozen(SUMMARIZE_VOCAB_KEYS))
        })

        it('預設值通用:主題與稱呼空、分類與內容類型為通用清單、證據等級高／中／低、宣告類為空、證據規則不啟用', () => {
            const d = SUMMARIZE_VOCAB_DEFAULT
            assert.deepEqual([d.domain, d.kbLabel, d.conceptRenames, d.conceptAliases], ['', '', {}, {}])
            assert.deepEqual(d.categories, ['原理與概念', '方法與技術', '模型與演算法', '流程與實務', '工具與實作', '資料與指標', '評估與驗證', '風險與限制', '其他'])
            assert.equal(d.fallbackCategory, '其他')
            assert.deepEqual(d.claimTypes, ['實證研究', '理論模型', '實務經驗', '教學示範', '觀點評論', '廠商內容'])
            assert.deepEqual(d.evidenceLevels, ['高', '中', '低'])
            assert.deepEqual([d.categoryRenames, d.categoryRetire, d.categoryHints, d.claimTypeRenames, d.evidenceLevelRenames], [{}, [], {}, {}, {}])
            assert.equal(d.evidenceRule, null)
            assert.equal(EVIDENCE_RULE_DEFAULT, null)
            assert.deepEqual(d.guide, guideDefaultOf(''))
        })

        it('零設定之解析:全部可用鍵皆有值、稱呼為「知識庫」、證據規則為停用之已編譯物件(JSON 為 null)', () => {
            for (const v of [R(), R({}), R(null), R('x')]) {
                assert.deepEqual(Object.keys(v), [...SUMMARIZE_VOCAB_KEYS])
                assert.equal(kbLabelOf(v), '知識庫')
                assert.ok(isEvidenceRule(v.evidenceRule))
                assert.equal(v.evidenceRule.enabled, false)
                assert.equal(v.evidenceRule.judge({ level: '高', levels: v.evidenceLevels, caveats: ['未經同儕審查'] }).status, 'na')
            }
            assert.equal(snap(R({})), snap({ ...SUMMARIZE_VOCAB_DEFAULT, evidenceRule: null }))
        })

        it('不認得之鍵 → 拋並列全部可用鍵(他段之鍵亦拒收,以 pickSummarizeVocab 取子集)', () => {
            const m = (k) => `vocab 含不認得之鍵：${k}（可用：${SUMMARIZE_VOCAB_KEYS.join('、')}）`
            assert.equal(msgOf(() => R({ relationTypes: ['x'] })), m('relationTypes'))
            assert.equal(msgOf(() => R({ kbLable: 'x', selfLimitPhrases: [] })), m('kbLable、selfLimitPhrases'))
            assert.equal(msgOf(() => R({ categorys: undefined })), m('categorys'), '值為 undefined 之鍵亦檢')
        })

        it('認得之鍵之值為 undefined 者視為未給(與關聯、提煉同一頭之政策——抓取套件之 vocabHeadOf;原:清單鍵給 undefined 即拋)', () => {
            assert.equal(snap(R({ categories: undefined, fallbackCategory: undefined, claimTypes: undefined, domain: undefined, guide: undefined })), snap(R({})))
        })
    })

    describe('② 抓取共用之鍵(交抓取套件驗)', function() {

        it('合法值原樣帶入;kbLabelOf 由稱呼或主題推導', () => {
            const v = R({ domain: '天文學', conceptRenames: { 黑洞吸積: '吸積盤' }, conceptAliases: { 吸积盘: '吸積盤' } })
            assert.deepEqual([v.domain, v.conceptRenames, v.conceptAliases], ['天文學', { 黑洞吸積: '吸積盤' }, { 吸积盘: '吸積盤' }])
            assert.equal(kbLabelOf(v), '「天文學」知識庫')
            assert.equal(kbLabelOf(R({ domain: '天文學', kbLabel: '星空知識庫' })), '星空知識庫')
            assert.deepEqual([R({ conceptRenames: null }).conceptRenames, R({ kbLabel: null }).kbLabel], [{}, ''], 'null 之處置同抓取套件(概念對照為空對照、稱呼視為未給)')
        })

        it('不合規則 → 拋抓取套件之訊息(kbLabel 非字串、概念對照形狀錯或值空)', () => {
            assert.equal(msgOf(() => R({ kbLabel: 1 })), 'vocab.kbLabel 須為字串')
            assert.equal(msgOf(() => R({ conceptRenames: [] })), 'vocab.conceptRenames 須為物件 { 原寫法: 新寫法 }')
            assert.equal(msgOf(() => R({ conceptAliases: { a: '' } })), 'vocab.conceptAliases 之「a」須對應非空字串')
        })
    })

    describe('② 摘要自有之鍵:逐條驗證', function() {

        it('categories／claimTypes／evidenceLevels 須為非空字串陣列', () => {
            for (const k of ['categories', 'claimTypes', 'evidenceLevels']) {
                for (const bad of ['x', [], ['a', ''], ['a', 1], null, {}]) assert.equal(msgOf(() => R({ [k]: bad })), `vocab.${k} 須為非空字串陣列`, `${k}=${JSON.stringify(bad)}`)
            }
        })

        it('fallbackCategory 須為非空字串且在 categories;自訂 categories 未給落點時附提示', () => {
            for (const bad of [1, '', null]) assert.equal(msgOf(() => R({ fallbackCategory: bad })), 'vocab.fallbackCategory 須為非空字串（categories 之一）')
            assert.equal(msgOf(() => R({ categories: ['a', 'b'] })), 'vocab.fallbackCategory「其他」不在 categories（a、b）；自訂 categories 不含「其他」者請給 vocab.fallbackCategory 指定清單外分類之落點')
            assert.equal(msgOf(() => R({ categories: ['a', 'b'], fallbackCategory: 'c' })), 'vocab.fallbackCategory「c」不在 categories（a、b）')
            assert.equal(R({ categories: ['a', 'b'], fallbackCategory: 'b' }).fallbackCategory, 'b')
        })

        it('改名表(categoryRenames／claimTypeRenames／evidenceLevelRenames):物件、鍵值非空、舊名不在清單、新名循對照可達清單且不成環;null 視為空', () => {
            const lists = { categoryRenames: CATS, claimTypeRenames: SUMMARIZE_VOCAB_DEFAULT.claimTypes, evidenceLevelRenames: SUMMARIZE_VOCAB_DEFAULT.evidenceLevels }
            for (const [k, list] of Object.entries(lists)) {
                assert.equal(msgOf(() => R({ [k]: [] })), `vocab.${k} 須為物件 { 舊名: 新名 }`)
                assert.equal(msgOf(() => R({ [k]: 'x' })), `vocab.${k} 須為物件 { 舊名: 新名 }`)
                assert.equal(msgOf(() => R({ [k]: { 舊: '' } })), `vocab.${k} 之鍵與值須為非空字串`)
                assert.equal(msgOf(() => R({ [k]: { '': list[0] } })), `vocab.${k} 之鍵與值須為非空字串`)
                assert.equal(msgOf(() => R({ [k]: { [list[0]]: list[1] } })), `vocab.${k} 之「${list[0]}」仍在現行清單（改名之舊名須已自清單移除）`)
                assert.equal(msgOf(() => R({ [k]: { 舊: '新' } })), `vocab.${k}.舊 之新名「新」不在現行清單（${list.join('、')}）`)
                assert.equal(msgOf(() => R({ [k]: { A: 'B', B: 'A' } })), ['A', 'B'].map((x, i) => `vocab.${k}.${x} 之新名「${'BA'[i]}」不在現行清單（${list.join('、')}），且對照成環`).join('；'), '問題一次列全(抓取套件之 renameChainProblems)')
                assert.deepEqual(R({ [k]: { 甲: '乙', 乙: list[0] } })[k], { 甲: '乙', 乙: list[0] }, '連續改名以對照鏈宣告')
                assert.deepEqual(R({ [k]: null })[k], {})
            }
        })

        it('categoryRetire:字串陣列、不在清單、不與改名重複;null 視為空', () => {
            assert.equal(msgOf(() => R({ categoryRetire: 'x' })), 'vocab.categoryRetire 須為字串陣列（退役之舊類別）')
            assert.equal(msgOf(() => R({ categoryRetire: [1] })), 'vocab.categoryRetire 須為字串陣列（退役之舊類別）')
            assert.equal(msgOf(() => R({ categoryRetire: ['其他'] })), 'vocab.categoryRetire 之「其他」仍在 categories（退役之類別須已自清單移除）')
            assert.equal(msgOf(() => R({ categoryRenames: { 舊: '其他' }, categoryRetire: ['舊'] })), 'vocab.categoryRetire 之「舊」同時出現在 categoryRenames（改名與退役擇一）')
            assert.deepEqual(R({ categoryRetire: ['已退'] }).categoryRetire, ['已退'])
            assert.deepEqual(R({ categoryRetire: null }).categoryRetire, [])
        })

        it('categoryHints:物件、類別在清單、關鍵詞為非空字串陣列;null 視為空', () => {
            assert.equal(msgOf(() => R({ categoryHints: [] })), 'vocab.categoryHints 須為物件 { 類別: [關鍵詞] }')
            assert.equal(msgOf(() => R({ categoryHints: { 不存在: ['x'] } })), 'vocab.categoryHints 之「不存在」不在 categories')
            for (const bad of [[], 'x', [''], [1]]) assert.equal(msgOf(() => R({ categoryHints: { 其他: bad } })), 'vocab.categoryHints.其他 須為非空字串陣列')
            assert.deepEqual(R({ categoryHints: { 其他: ['雜項'] } }).categoryHints, { 其他: ['雜項'] })
            assert.deepEqual(R({ categoryHints: null }).categoryHints, {})
        })
    })

    describe('③ guide:三段、逐欄回退、型別', function() {

        it('欄位表:triage 8 欄、summarize 8 欄、faith 2 欄(scope、overclaim 為非空字串)', () => {
            assert.deepEqual(Object.keys(SUMMARIZE_GUIDE_FIELDS), ['triage', 'summarize', 'faith'])
            assert.deepEqual(SUMMARIZE_GUIDE_FIELDS.triage, { question: 'string', scopeLine: 'string', criterionNote: 'string', elements: 'string', rejectIntro: 'string', rejects: 'array', accepts: 'string', fallbackReason: 'string' })
            assert.deepEqual(SUMMARIZE_GUIDE_FIELDS.summarize, { target: 'string', relevance: 'string', rejects: 'string', simplifiedExamples: 'array', conceptExamples: 'string', evidenceLevelDefs: 'levelMap', caveatExamples: 'array', regime: 'string' })
            assert.deepEqual(SUMMARIZE_GUIDE_FIELDS.faith, { scope: 'estr', overclaim: 'estr' })
            for (const [sec, fields] of Object.entries(SUMMARIZE_GUIDE_FIELDS)) assert.deepEqual(Object.keys(guideDefaultOf('')[sec]), Object.keys(fields), `${sec}:預設之欄位同欄位表`)
        })

        it('預設:faith 段為中立之條件詞與誇大例;caveatExamples 為中立例;有主題時預篩與摘要之數句帶入主題', () => {
            const g = guideDefaultOf('')
            assert.deepEqual(g.faith, { scope: '特定對象、期間或條件', overclaim: '原文只有初步或單一來源之結果，筆記寫有獨立驗證或實際應用' })
            assert.deepEqual(g.summarize.caveatExamples, ['無獨立驗證', '樣本小或期間短', '選樣偏差風險', '相關不等於因果', '適用範圍狹窄', '推廣性質', '結論與所附數據不符'])
            assert.equal(g.triage.scopeLine, '')
            assert.equal(g.triage.fallbackReason, '無可複用知識')
            const d = guideDefaultOf('  天文學 ')
            assert.equal(d.triage.scopeLine, '本知識庫之主題範圍為「天文學」：與此主題無關者判 false。')
            assert.equal(d.triage.fallbackReason, '與「天文學」無關或無可複用知識')
            assert.equal(d.summarize.relevance, '與「天文學」相關、可長期複用之知識、方法、技術、參數或原理')
            assert.ok(d.summarize.rejects.endsWith('、與「天文學」無關之內容'))
            assert.deepEqual(d.faith, g.faith, 'faith 段不隨主題')
            assert.deepEqual(R({ domain: '天文學' }).guide.triage, d.triage, '解析時之預設 guide 依 domain 產生')
        })

        it('逐欄回退:只給部分欄位,其餘沿用預設;空字串照填(string 欄);陣列為複本', () => {
            const rejects = ['甲類', '乙類']
            const v = R({ guide: { triage: { scopeLine: '', rejects }, faith: { scope: '特定族群或條件' } } })
            assert.equal(v.guide.triage.scopeLine, '')
            assert.deepEqual(v.guide.triage.rejects, rejects)
            assert.notEqual(v.guide.triage.rejects, rejects)
            assert.equal(v.guide.triage.question, guideDefaultOf('').triage.question)
            assert.deepEqual(v.guide.faith, { scope: '特定族群或條件', overclaim: guideDefaultOf('').faith.overclaim })
            assert.deepEqual(v.guide.summarize, guideDefaultOf('').summarize)
            assert.deepEqual(R({ guide: null }).guide, guideDefaultOf(''))
            assert.deepEqual(R({ guide: { triage: null, faith: undefined } }).guide, guideDefaultOf(''))
        })

        it('evidenceLevelDefs:逐級回退、鍵須為 evidenceLevels 之成員、值須為字串;結果只留現行等級(含未給時)', () => {
            const def = guideDefaultOf('').summarize.evidenceLevelDefs
            assert.deepEqual(R({ guide: { summarize: { evidenceLevelDefs: { 高: '最強' } } } }).guide.summarize.evidenceLevelDefs, { 高: '最強', 中: def.中, 低: def.低 })
            assert.deepEqual(R({ evidenceLevels: ['A', 'B'], guide: { summarize: { evidenceLevelDefs: { A: '一' } } } }).guide.summarize.evidenceLevelDefs, { A: '一' })
            assert.deepEqual(R({ evidenceLevels: ['高', '低'] }).guide.summarize.evidenceLevelDefs, { 高: def.高, 低: def.低 })
            assert.equal(msgOf(() => R({ guide: { summarize: { evidenceLevelDefs: 'x' } } })), 'vocab.guide.summarize.evidenceLevelDefs 須為物件 { <證據等級>: 定義字串 }')
            assert.equal(msgOf(() => R({ guide: { summarize: { evidenceLevelDefs: { 極高: 'x' } } } })), 'vocab.guide.summarize.evidenceLevelDefs 之「極高」不在 evidenceLevels（高、中、低）')
            assert.equal(msgOf(() => R({ guide: { summarize: { evidenceLevelDefs: { 高: 1 } } } })), 'vocab.guide.summarize.evidenceLevelDefs.高 須為字串')
        })

        it('形狀與型別錯 → 拋:guide 非物件、不認得之段(含他段 relate／extract)、段非物件、不認得之欄位、string／array／estr 欄型別不符', () => {
            assert.equal(msgOf(() => R({ guide: 'x' })), 'vocab.guide 須為物件 { triage, summarize, faith }')
            assert.equal(msgOf(() => R({ guide: [] })), 'vocab.guide 須為物件 { triage, summarize, faith }')
            for (const sec of ['relate', 'extract', 'faithCheck']) assert.equal(msgOf(() => R({ guide: { [sec]: {} } })), `vocab.guide 含不認得之鍵：${sec}（可用：triage、summarize、faith）`)
            assert.equal(msgOf(() => R({ guide: { relate: undefined } })), 'vocab.guide 含不認得之鍵：relate（可用：triage、summarize、faith）', '值為 undefined 之段亦檢')
            assert.equal(msgOf(() => R({ guide: { triage: 'x' } })), 'vocab.guide.triage 須為物件')
            assert.equal(msgOf(() => R({ guide: { faith: { foo: 'x' } } })), 'vocab.guide.faith 含不認得之鍵：foo（可用：scope、overclaim）')
            assert.equal(msgOf(() => R({ guide: { triage: { question: 1 } } })), 'vocab.guide.triage.question 須為字串')
            for (const bad of [[], [''], [1], 'x']) assert.equal(msgOf(() => R({ guide: { summarize: { caveatExamples: bad } } })), 'vocab.guide.summarize.caveatExamples 須為字串陣列(至少一項、每項非空字串)')
            for (const k of ['scope', 'overclaim']) {
                for (const bad of ['', '  ', 1, ['x']]) assert.equal(msgOf(() => R({ guide: { faith: { [k]: bad } } })), `vocab.guide.faith.${k} 須為非空字串`, `${k}=${JSON.stringify(bad)}`)
            }
        })
    })

    describe('④ 證據規則之送達(缺即拋)', function() {

        it('未給或 null → 停用;給了完整規則 → 啟用之已編譯物件(與 evidenceRuleOf 同一物件、JSON 為其正規形)', () => {
            assert.equal(R({ evidenceRule: null }).evidenceRule.enabled, false)
            const v = R({ evidenceRule: PEER })
            assert.equal(v.evidenceRule.enabled, true)
            assert.equal(v.evidenceRule, evidenceRuleOf(v.evidenceRule.config))
            assert.equal(JSON.parse(JSON.stringify(v)).evidenceRule.subject, '同儕審查')
            assert.equal(v.evidenceRule.judge({ level: '高', levels: v.evidenceLevels, caveats: ['未經同儕審查'] }).status, 'violation')
            const compiled = evidenceRuleOf(PEER)
            assert.equal(R({ evidenceRule: compiled }).evidenceRule, compiled, '已編譯者原樣收下')
        })

        it('規則不完整或不合規格 → 拋(不逐欄回退預設:預設為不啟用)', () => {
            assert.equal(msgOf(() => R({ evidenceRule: { subject: '同儕審查' } })), 'vocab.evidenceRule.check 須為非空字串')
            assert.equal(msgOf(() => R({ evidenceRule: { ...PEER, loose: undefined } })), 'vocab.evidenceRule.loose 須為樣式陣列（RegExp 或 { p: 樣式字串, f?: 旗標 }）')
            assert.equal(msgOf(() => R({ evidenceRule: 'x' })), 'vocab.evidenceRule 須為物件 { subject, check, strict, loose, alt? } 或 null（不啟用）')
        })

        it('assertSummarizeVocab:解析之產物(及其展開複本)通過並回傳同一物件;{}、他套件之詞彙表、JSON 往返之複本、非物件 → 拋', () => {
            const v = R({ evidenceRule: PEER })
            assert.equal(assertSummarizeVocab(v), v)
            assert.equal(assertSummarizeVocab(v).evidenceRule.fp, evidenceRuleOf(PEER).fp)
            const copy = { ...v, categories: ['甲', '其他'] }
            assert.equal(assertSummarizeVocab(copy), copy, '展開複本保有已編譯之規則')
            const m = (where) => `${where} 須為 resolveSummarizeVocab 之產物（evidenceRule 須為已編譯之規則物件；未經本套件解析之詞彙表、他段之詞彙表或 JSON 往返之複本請先以 resolveSummarizeVocab 解析——證據規則不得靜默退回不啟用）`
            for (const bad of [{}, resolveCaptureVocab({}), JSON.parse(JSON.stringify(v)), { evidenceRule: PEER }, { evidenceRule: null }, null, undefined, 'x', []]) {
                assert.equal(msgOf(() => assertSummarizeVocab(bad)), m('vocab'), JSON.stringify(bad))
            }
            assert.equal(msgOf(() => assertSummarizeVocab({}, 'checkNote 之 ctx.vocab')), m('checkNote 之 ctx.vocab'))
            assert.equal(assertSummarizeVocab(R(JSON.parse(JSON.stringify(v)))).evidenceRule.fp, v.evidenceRule.fp, 'JSON 往返之複本重新解析後可用')
        })
    })

    describe('⑤ 子集擷取、可重複套用、互不汙染', function() {

        it('pickSummarizeVocab:只取本套件之鍵(未給者不列)、guide 只取三段中已給者、不改輸入;非物件 → {}', () => {
            const src = {
                domain: '天文學', kbLabel: undefined, categories: ['甲', '其他'], relationTypes: ['相關'], conflictType: '衝突', selfLimitPhrases: [],
                guide: { triage: { scopeLine: '' }, faith: { scope: '特定族群' }, relate: { vagueReason: 'x' }, extract: {} },
                evidenceRule: PEER,
            }
            const before = JSON.stringify(src)
            const p = pickSummarizeVocab(src)
            assert.deepEqual(p, { domain: '天文學', categories: ['甲', '其他'], guide: { triage: { scopeLine: '' }, faith: { scope: '特定族群' } }, evidenceRule: PEER })
            assert.equal(JSON.stringify(src), before)
            assert.doesNotThrow(() => R(p))
            assert.deepEqual([pickSummarizeVocab(null), pickSummarizeVocab('x')], [{}, {}])
            assert.equal(pickSummarizeVocab({ guide: 'x' }).guide, 'x', 'guide 非物件原樣交解析(由解析拋錯)')
        })

        it('可重複套用:resolve(resolve(x)) 與 resolve(x) 相同(證據規則為同一物件);JSON 往返後再解析亦相同', () => {
            const cases = [
                {}, { domain: '天文學', kbLabel: '星空知識庫' },
                { categories: ['甲', '乙', '其他'], categoryRenames: { 舊甲: '中甲', 中甲: '甲' }, categoryRetire: ['退'], categoryHints: { 乙: ['關鍵'] } },
                { evidenceLevels: ['A', 'B'], guide: { summarize: { evidenceLevelDefs: { A: '最強' } }, faith: { overclaim: '原文只有個案，筆記寫成通則' } } },
                { evidenceRule: PEER, conceptRenames: { 甲: '乙' } },
            ]
            for (const x of cases) {
                const a = R(x)
                const b = R(a)
                assert.equal(snap(b), snap(a), JSON.stringify(x))
                assert.equal(b.evidenceRule, a.evidenceRule)
                assert.equal(snap(R(JSON.parse(JSON.stringify(a)))), snap(a), `JSON 往返:${JSON.stringify(x)}`)
                assert.equal(R(pickSummarizeVocab(a)).evidenceRule, a.evidenceRule)
            }
        })

        it('各次解析之產物互不共用預設常數之參照:就地修改不影響下次解析與預設', () => {
            const a = R({})
            a.categories.push('雜')
            a.guide.triage.rejects.push('雜')
            a.categoryHints.x = ['y']
            const b = R({})
            assert.deepEqual(b.categories, SUMMARIZE_VOCAB_DEFAULT.categories)
            assert.deepEqual(b.guide.triage.rejects, guideDefaultOf('').triage.rejects)
            assert.deepEqual(b.categoryHints, {})
            assert.ok(!SUMMARIZE_VOCAB_DEFAULT.categories.includes('雜'))
        })
    })

    describe('⑥ 預設領域中立', function() {

        it('詞表自檢:領域詞被抓到;中立詞、識別字與模型條目 id 之片段不誤判', () => {
            assert.deepEqual(termsIn(`前 ${TERMS[0]} 後`), [TERMS[0]])
            assert.deepEqual(termsIn(`a ${TERMS[TERMS.length - 1]} b`), [TERMS[TERMS.length - 1]])
            assert.deepEqual(termsIn('quantum tunneling、docStockFix、oc:opencode/fledge-alpha-free、future work'), [])
        })

        it('預設詞彙、預設 guide(含帶主題者)、解析後之詞彙與預設設定皆不含特定產業領域之詞彙', () => {
            const targets = {
                vocabDefault: snap(SUMMARIZE_VOCAB_DEFAULT),
                vocabResolved: snap(R({})),
                guideNeutral: snap(guideDefaultOf('')),
                guideWithDomain: snap(guideDefaultOf('天文學')),
                evidenceRuleDefault: snap(EVIDENCE_RULE_DEFAULT),
                settingsDefault: snap([SUMMARIZE_DEFAULT, SUMMARIZE_AI_DEFAULT]),
                settingsResolved: snap(resolveSummarizeSettings({})),
            }
            for (const [name, text] of Object.entries(targets)) assert.deepEqual(termsIn(text), [], `${name} 含領域詞彙`)
        })

        it('定義預設之原始碼(含註解)不含特定產業領域之詞彙:詞彙表、證據規則、設定', () => {
            for (const f of ['core/vocab/summarizeVocab.mjs', 'core/standards/evidenceRules.mjs', 'core/summarizeSettings.mjs']) {
                assert.deepEqual(termsIn(fs.readFileSync(path.join(PKG, 'src', f), 'utf8')), [], `${f} 含領域詞彙(註解範例亦須中立)`)
            }
        })
    })
})
