// unit-summarize-locale.test.mjs — 語言設定(cfg.lang;抓取套件之 core/locale)於摘要套件之落點:三個內建 domain 與速報 domain 之輸出語言句、
//   筆記標準 SS3 之適用、正規化／納入閘／存量處置之字形修正、概念標籤跨文字系統註記之保留方向、筆記 slug 之字元政策、執行期件與總組裝之接線
// 規則(出自 summarizeRuntime、noteDomain、noteNormalize、noteStandards 之檔頭與 JSDoc):
//   ①預設逐字不變:未給 lang 時四支提示詞與語言設定出現前相同(golden 另有 unit-summarize-domain 守);lang 給了只換輸出語言句、字形句
//   ②SS3 只適用於臺灣正體:語言設定非繁體中文 → checkNote 列不適用(共同字樣)、掃描逐篇列不適用;正規化、納入閘、存量修正不轉字形
//   ③跨文字系統之括號註記:中文保留漢字半、其他語言保留非漢字半
//   ④slug:摘要 domain 帶 locale,buildNote 依其 slug 政策(非中文收任何文字之字母與數字)
//   ⑤執行期件:cfg.lang 解析一次,domain 工廠與每輪依賴同讀;注入之摘要 domain 帶 locale 者須與 cfg.lang 同一語言
// 執行:自套件根 node <mocha> test/unit-summarize-locale.test.mjs(暫存 test/_tmp/summarize-locale-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memStore, msgOf, setConceptFold, SCRIPT_NONE } from './tools/captureForTest.mjs'
import { resolveLocale, SCRIPT_NA_DETAIL } from '../src/core/capturePackage.mjs'
import { writeMd } from '../src/core/md/md.mjs'
import { resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'
import { resolveSummarizeVocab } from '../src/core/vocab/summarizeVocab.mjs'
import { createSummarizeRuntime } from '../src/summarizeRuntime.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { createTriageDomain } from '../src/domain/triageDomain.mjs'
import { createDigestDomain } from '../src/domain/digestDomain.mjs'
import { checkNote } from '../src/standards/noteStandards.mjs'
import { normalizeNoteItem, normConcepts } from '../src/standards/noteNormalize.mjs'
import { gateNoteItem } from '../src/standards/noteGate.mjs'
import { noteFixOf } from '../src/ops/noteStockFix.mjs'
import { buildNote } from '../src/stores/noteBuild.mjs'
import { auditSummarizeStandards } from '../src/standards/audit.mjs'
import { createKnowledgeSummarize, CFG_KEYS } from '../src/createKnowledgeSummarize.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/')
const TMP = `${ROOT}/test/_tmp/summarize-locale-${process.pid}`
const SETTINGS = resolveSummarizeSettings({})
const VOCAB = resolveSummarizeVocab({ claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] })
const ITEM = (o = {}) => ({ index: 1, relevant: true, title: '动量因子之实证', summary: '台股动量年化超额 8.2%', key_points: ['年化超额 8.2%'], concepts: ['动量因子', '回测'], claim_type: '实证研究', evidence_level: '中', ...o })
const DOC = { title: 'T', sourceName: 'S', url: 'https://e.com/a', text: '內文' }
const by = (rs, std) => rs.find((r) => r.std === std)
/** 落地形態之簡體筆記(SS3 之違反) */
const MD = () => ({
    front: { title: '动量因子之实证', concepts: ['动量因子', '回測'], claim_type: '實證研究', evidence_level: '中', caveats: [] },
    body: '# 动量因子之实证\n\n## 一句話重點\n\n台股动量年化超额 8.2%。\n\n## 核心知識\n\n- 动量之后仍有效\n\n## 來源\n\n- 原文標題：x\n',
})

describe('unit-summarize-locale', function() {

    before(() => fs.mkdirSync(`${TMP}/notes`, { recursive: true }))
    after(() => {
        setConceptFold(null)
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    describe('domain 之輸出語言句', function() {

        it('①摘要 domain:預設逐字含「須以繁體中文萃取」「原文為英文時翻譯成繁體中文」「必須使用繁體字形」;lang en 換為英文句、不含「繁體」;domain.locale 為解析後之語言設定;錯值拋錯並點名', () => {
            const d0 = createSummarizeDomain({})
            const d1 = createSummarizeDomain({ locale: 'en' })
            const p0 = d0.buildPrompt([DOC], [])
            const p1 = d1.buildPrompt([DOC], [])
            assert.ok(p0.includes('須以繁體中文萃取下列欄位；原文為英文時翻譯成繁體中文，') && p0.includes('**必須使用繁體字形（不可寫'), p0)
            assert.ok(p1.includes('須以英文萃取下列欄位；原文為其他語言時翻譯成英文，') && p1.includes('**以英文書寫**') && !p1.includes('繁體'), p1)
            assert.deepEqual([d0.locale.code, d1.locale.code, d1.locale.script.id], ['zh-TW', 'en', 'none'])
            const f0 = d0.buildFaithCheckPrompt({ items: [] })
            const f1 = d1.buildFaithCheckPrompt({ items: [] })
            assert.ok(f0.includes('翻譯成繁體中文不算不忠實') && f0.includes('reason 用繁體中文一句話'), f0)
            assert.ok(f1.includes('翻譯成英文不算不忠實') && f1.includes('reason 用英文一句話') && !f1.includes('繁體'), f1)
            const r0 = d0.buildRepairPrompt({ material: 'm', item: ITEM(), problems: [] })
            const r1 = d1.buildRepairPrompt({ material: 'm', item: ITEM(), problems: [] })
            assert.ok(r0.includes('**必須使用繁體字形**') && r0.includes('6. 以繁體中文書寫。'), r0)
            assert.ok(r1.includes('**以英文書寫**') && r1.includes('6. 以英文書寫。') && !r1.includes('繁體'), r1)
            // 繁體中文而非臺灣正體之字形政策(zh-HK):稱呼仍為繁體中文,字形句不要求繁體字形
            const hk = createSummarizeDomain({ locale: 'zh-HK' }).buildPrompt([DOC], [])
            assert.ok(hk.includes('須以繁體中文萃取下列欄位；原文為其他語言時翻譯成繁體中文，') && hk.includes('**以繁體中文書寫**') && !hk.includes('繁體字形'), hk)
            assert.match(msgOf(() => createSummarizeDomain({ locale: '!!' })), /^createSummarizeDomain 之 opt\.locale 不是合法之語言代碼/)
        })

        it('①預篩與速報 domain:理由／書寫之語言句依 locale;預設逐字不變', () => {
            const t0 = createTriageDomain({}).buildPrompt([DOC])
            const t1 = createTriageDomain({ locale: 'ja' }).buildPrompt([DOC])
            assert.ok(t0.includes('5. reason 用繁體中文十字以內。'), t0)
            assert.ok(t1.includes('5. reason 用日文十字以內。') && !t1.includes('繁體中文'), t1)
            assert.equal(t0.replace('繁體中文', '日文'), t1)
            const g0 = createDigestDomain({}).buildPrompt([DOC], [])
            const g1 = createDigestDomain({ locale: 'en' })
            assert.ok(g0.includes('4. 以繁體中文書寫；原文為其他語言時翻譯成繁體中文，'), g0)
            assert.ok(g1.buildPrompt([DOC], []).includes('4. 以英文書寫；原文為其他語言時翻譯成英文，'), g1.buildPrompt([DOC], []))
            assert.equal(g1.locale.code, 'en')
            assert.match(msgOf(() => createTriageDomain({ locale: 5 })), /^createTriageDomain 之 opt\.locale 須為語言代碼字串/)
        })
    })

    describe('標準、正規化、納入閘、存量處置之字形政策', function() {

        it('②checkNote:預設 SS3 判違反;ctx.locale en 列不適用(共同字樣);字形政策物件亦可;錯值拋錯', () => {
            assert.equal(by(checkNote(MD(), { vocab: VOCAB }), 'SS3').status, 'violation')
            const na = by(checkNote(MD(), { vocab: VOCAB, locale: 'en' }), 'SS3')
            assert.deepEqual([na.status, na.detail], ['na', SCRIPT_NA_DETAIL])
            assert.equal(by(checkNote(MD(), { vocab: VOCAB, locale: SCRIPT_NONE }), 'SS3').status, 'na')
            assert.equal(by(checkNote(MD(), { vocab: VOCAB, locale: resolveLocale('zh-Hant') }), 'SS3').status, 'violation')
            assert.deepEqual(checkNote(MD(), { vocab: VOCAB, locale: 'en', only: ['SS3'] }).map((r) => [r.std, r.status]), [['SS3', 'na']], 'only 仍回該標準之不適用')
            assert.match(msgOf(() => checkNote(MD(), { locale: 'zh_TW' })), /^checkNote 之 ctx\.locale 不是合法之語言代碼/)
        })

        it('②③normalizeNoteItem／normConcepts:預設轉正體;locale en 不轉字形;跨文字系統註記依語言保留一半(中文留漢字、英文留拉丁)', () => {
            const k0 = normalizeNoteItem(ITEM(), { vocab: VOCAB }).item
            const k1 = normalizeNoteItem(ITEM(), { vocab: VOCAB, locale: 'en' }).item
            assert.deepEqual([k0.title, k0.concepts, k0.claim_type], ['動量因子之實證', ['動量因子', '回測'], '實證研究'])
            assert.deepEqual([k1.title, k1.concepts, k1.claim_type], ['动量因子之实证', ['动量因子', '回测'], '实证研究'])
            const f0 = []
            const f1 = []
            assert.deepEqual(normConcepts(['動量 (Momentum)', 'Momentum (動量)'], f0), ['動量'])
            assert.deepEqual(normConcepts(['動量 (Momentum)', 'Momentum (動量)'], f1, { locale: 'en' }), ['Momentum'])
            assert.deepEqual(normConcepts(['Beta(1,1)', 'GARCH(1,1)'], [], { locale: 'en' }), ['Beta(1,1)', 'GARCH(1,1)'], '同文字系統之參數註記不動')
            assert.match(msgOf(() => normalizeNoteItem(ITEM(), { locale: '!!' })), /^normalizeNoteItem 之 opt\.locale/)
        })

        it('②gateNoteItem 與 noteFixOf:locale en 時納入閘不轉字形、存量修正無 SS3 之改動;預設照修', () => {
            assert.equal(gateNoteItem(ITEM(), { vocab: VOCAB, locale: 'en' }).item.title, '动量因子之实证')
            assert.equal(gateNoteItem(ITEM(), { vocab: VOCAB }).item.title, '動量因子之實證')
            const f0 = noteFixOf(MD(), {}, { stds: ['SS3'], vocab: VOCAB })
            const f1 = noteFixOf(MD(), {}, { stds: ['SS3'], vocab: VOCAB, locale: 'en' })
            assert.ok(f0.changes.some((c) => c.std === 'SS3'), JSON.stringify(f0.changes))
            assert.deepEqual([f1.changes, f1.front.title, f1.front.concepts], [[], '动量因子之实证', ['动量因子', '回測']])
        })

        it('④buildNote 之 slug 依 domain.locale:中文只收漢字與拉丁;英文收任何文字之字母與數字;注入 o.locale 優先', () => {
            const k = { ...ITEM(), title: 'Café résumé', concepts: ['甲', '乙'] }
            const doc = { id: 'd1', url: 'https://e.com/a', sourceName: 's', title: 'Café résumé' }
            const n0 = buildNote({ k, doc, domain: createSummarizeDomain({ vocab: VOCAB }), notesDir: `${TMP}/notes`, nowIso: '2026-10-28T00:00:00+08:00' })
            const n1 = buildNote({ k, doc, domain: createSummarizeDomain({ vocab: VOCAB, locale: 'en' }), notesDir: `${TMP}/notes`, nowIso: '2026-10-28T00:00:00+08:00' })
            const n2 = buildNote({ k, doc, domain: createSummarizeDomain({ vocab: VOCAB }), notesDir: `${TMP}/notes`, nowIso: '2026-10-28T00:00:00+08:00', locale: resolveLocale('fr') })
            assert.ok(n0.slug.startsWith('caf-rsum-') && n1.slug.startsWith('café-résumé-') && n2.slug.startsWith('café-résumé-'), [n0.slug, n1.slug, n2.slug].join(' '))
            assert.equal(n0.slug.slice(-8), n1.slug.slice(-8), '尾碼(雜湊)不隨政策變')
        })

        it('②符合度掃描:deps.locale en 時 SS3 逐篇列不適用', async () => {
            const file = `${TMP}/notes/x.md`
            const md = MD()
            writeMd(file, md.front, md.body)
            const notes = memStore([{ id: 'x', title: md.front.title, file, concepts: md.front.concepts, docId: 'd' }])
            const s0 = (await auditSummarizeStandards({ stores: { notes, docs: memStore([]), docTexts: memStore([]) }, vocab: VOCAB }, { only: ['SS3'] })).standards.SS3
            const s1 = (await auditSummarizeStandards({ stores: { notes, docs: memStore([]), docTexts: memStore([]) }, vocab: VOCAB, locale: 'en' }, { only: ['SS3'] })).standards.SS3
            assert.deepEqual([[s0.total, s0.violation, s0.na], [s1.total, s1.violation, s1.na]], [[1, 1, 0], [1, 0, 1]])
        })
    })

    describe('執行期件與總組裝', function() {

        it('⑤createSummarizeRuntime 讀 cfg.lang:locale、三 domain 之語言句、折疊依之;注入之摘要 domain 帶不同語言之 locale 即拋,未帶者可;預設 zh-TW', () => {
            const rt = createSummarizeRuntime({ lang: 'en' }, SETTINGS)
            assert.deepEqual([rt.locale.code, rt.domains.summarize.locale.code, rt.folds], ['en', 'en', { fold: null, clueFold: null }])
            assert.ok(rt.domains.triage.buildPrompt([DOC]).includes('reason 用英文十字以內') && rt.domains.summarize.buildPrompt([DOC], []).includes('須以英文萃取'))
            assert.equal(createSummarizeRuntime({}, SETTINGS).locale.code, 'zh-TW')
            assert.match(msgOf(() => createSummarizeRuntime({ lang: 'en' }, SETTINGS, { domains: { summarize: createSummarizeDomain({}) } })), /cfg\.domains\.summarize 不合：locale 須與 cfg\.lang 同一語言（domain 為 zh-TW，cfg\.lang 為 en）/)
            const { locale: _l, ...noLocale } = createSummarizeDomain({})
            assert.doesNotThrow(() => createSummarizeRuntime({ lang: 'en' }, SETTINGS, { domains: { summarize: noLocale } }), '未帶 locale 之注入 domain 可(slug 政策退為預設)')
            assert.doesNotThrow(() => createSummarizeRuntime({ lang: 'en' }, SETTINGS, { domains: { summarize: createSummarizeDomain({ locale: 'en' }) } }))
            assert.match(msgOf(() => createSummarizeRuntime({ lang: 'zh_TW' }, SETTINGS)), /^cfg\.lang 不是合法之語言代碼/)
            setConceptFold(null)
        })

        it('⑤createKnowledgeSummarize:lang 在 CFG_KEYS;info().locale 為解析後之語言設定', () => {
            assert.ok(CFG_KEYS.includes('lang'))
            const stubAi = { callJson: async () => ({ ok: false, error: 'x' }) }
            const build = (extra) => createKnowledgeSummarize({ workDir: `${TMP}/kb-${Math.random().toString(16).slice(2, 8)}`, aiAdapter: stubAi, netGuard: null, lock: false, logFactory: () => ({ info: () => {}, warn: () => {}, error: () => {} }), ...extra })
            assert.deepEqual([build({ lang: 'en' }).info().locale.code, build({}).info().locale.code], ['en', 'zh-TW'])
            setConceptFold(null)
        })
    })
})
