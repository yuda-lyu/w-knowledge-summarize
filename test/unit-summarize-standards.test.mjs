// unit-summarize-standards.test.mjs — 摘要之檢定標準層(standards/):筆記標準(noteStandards)、確定性正規化(noteNormalize)、納入閘(noteGate)、
//   欄位定向修補之純函數(noteRepair)、忠實性覆核之純函數與判定小組(faithCheck)
// 規則(出自各檔頭):
//   ①落地形態之檢定:SS2／SS3／SS4／SS6 合格、不合格、未能判定(與不適用)各至少一案;SS4 之材料取抓取套件之原文取得結果
//   ②SS11 之規則取自詞彙表(evidenceRule):預設不啟用 → 不適用、不降級、回饋不附方向;給了規則 → 判定(checkNote)、新進降級
//     (normalizeNoteItem)與回饋(noteFeedbackOf)同一規則、同一組訊息
//   ③詞彙之送達:本層各函數之詞彙給了須為本套件解析後之詞彙表(未經解析即拋,不靜默退回);未給 → 依賴詞彙之判定略過(清單、降級、SS11)
//   ④正規化修得好者照收並記修正;擠標籤須各段皆為既有概念才拆;欄位上限不靜默截斷
//   ⑤數字紮根之處置:清單行、參數列、概念逐條移除;標題／一句話重點致命;受檢欄位與順序單一實作
//   ⑥修補呼叫之純函數:只指出、只改被指出之處;指出處之稱呼單一實作(fieldPlaceOf)
//   ⑦忠實性:受檢文字、單票驗證、判定小組(兩席、第三席、同一供應者、中止)
//   ⑧共用常數與字樣單一來源:概念個數、缺值字樣、訊息用短文字
// 移植原實作之筆記標準、納入閘、修補、忠實性與 SS4 材料各案(斷言不變;以 plain 詞彙之案改為先 resolveSummarizeVocab,SS11 相關之案之
//   詞彙另給中立題材之規則 NEUTRAL_RULE);SS11 之規則送達、詞彙之送達與共用常數之案為新增。
// 執行:自套件根 node <mocha> test/unit-summarize-standards.test.mjs(暫存 test/_tmp/summarize-standards-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memStore, msgOf, archiveDocText } from './tools/captureForTest.mjs'
import { NEUTRAL_RULE } from './tools/neutralRule.mjs'
import { resolveSummarizeVocab } from '../src/core/vocab/summarizeVocab.mjs'
import { noteContentText, originalTitleOf } from '../src/core/md/noteContent.mjs'
import { PANEL_UNSURE } from '../src/core/standards/panel.mjs'
import { docTextOf, sha1 } from '../src/core/capturePackage.mjs'
import { NOTE_STANDARDS, CONCEPT_COUNT, conceptCountDetail, standardsVocabOf, checkNote, conceptLabelProblem, noteFeedbackOf, noteMaterialOf } from '../src/standards/noteStandards.mjs'
import { NOTE_FIELD_LIMITS, NOTE_PLACEHOLDERS, shortText, normalizeNoteItem, noteItemProblems, noteItemFieldProblems, flattenEl, normConcepts } from '../src/standards/noteNormalize.mjs'
import { dropUngrounded, gateNoteItem, ungroundedLinesOf } from '../src/standards/noteGate.mjs'
import { NOTE_FIELD_LABELS, fieldPlaceOf, repairProblemsOf, applyRepairs, checkRepairReply } from '../src/standards/noteRepair.mjs'
import { SS14, FAITH_VERDICTS, SS14_OBJECT, faithNoteText, checkFaithVerdictOf, seatFaithVotesOf, checkFaithChecks, runFaithCheck } from '../src/standards/faithCheck.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { buildNote } from '../src/stores/noteBuild.mjs'

const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/summarize-standards-${process.pid}`).replace(/\\/g, '/')

// 中立之自訂規則(展示任意領域:最高級須經同儕審查)
const PEER_RULE = { subject: '同儕審查', check: '同儕審查', strict: [{ p: '(?:未經|沒有|無)同儕審查' }], loose: [{ p: '(?:未|無)[^；;。]{0,10}同儕審查' }] }

const BASE = { claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] }
/** 移植案之詞彙(原為 plain 物件 + 原實作內建之 SS11;此處為解析後之詞彙並給回該規則——NEUTRAL_RULE:中立題材之 SS11 規則,取 test/tools/neutralRule;本套件預設不啟用) */
const VOCAB = resolveSummarizeVocab({ ...BASE, evidenceRule: NEUTRAL_RULE })
/** 同清單、未給證據規則(本套件預設:SS11 不啟用) */
const NEUTRAL = resolveSummarizeVocab(BASE)
const SRC = '動量研究\nTaiwan momentum 12-1 earns 8.2% annual excess return over 2010-2024; costs 0.15%.'
const ITEM = (o = {}) => ({ index: 1, relevant: true, title: '動量因子之台股實證', summary: '台股動量年化超額 8.2%', key_points: ['年化超額 8.2%'], concepts: ['動量因子', '回測'], claim_type: '實證研究', evidence_level: '中', ...o })
const by = (rs, std) => rs.find((r) => r.std === std)

// ── 落地形態之筆記(本文與 frontmatter)──
const BODY = (o = {}) => [
    `# ${o.title || '動量因子之台股實證'}`, '',
    '## 一句話重點', '', o.summary ?? '台股十二減一月動量年化超額 8.2%。', '',
    '## 品質與證據標注', '', '- 內容類型：實證研究', `- 證據等級：${o.level || '中'}`, '- 數據樣本期間：2010-2020', ...(o.caveats || ['⚠ 無交易成本']).map((c) => `- ${c}`), '',
    '## 核心知識', '', ...(o.kps ?? ['- 動量年化超額 8.2%']), '',
    ...(o.params ? ['## 關鍵參數', '', '| 參數 | 值／區間 | 說明 |', '| --- | --- | --- |', ...o.params, ''] : []),
    ...(o.extra ? [o.extra, ''] : []),
    '## 來源', '', `- 原文標題：${o.origTitle || '動量研究'}`, '- 來源：測試', '- 網址：https://x.test/a', `- 發布時間：${o.published || '2026-09-01 08:00:00'}`, '- 內文取得方式：原網頁全文', '',
    ...(o.tail ? [o.tail] : []),
].join('\n')
const FRONT = (o = {}) => ({ title: o.title || '動量因子之台股實證', concepts: o.concepts || ['動量因子', '回測'], claim_type: o.claim_type || '實證研究', evidence_level: o.level || '中', caveats: o.caveatsFront || ['無交易成本'] })

describe('unit-summarize-standards', function() {

    before(() => fs.mkdirSync(TMP, { recursive: true }))
    after(() => fs.rmSync(TMP, { recursive: true, force: true }))

    // ══════════════════════════ noteStandards ══════════════════════════
    describe('筆記之檢定(standards/noteStandards)', function() {

        it('標準表:SS2、SS3、SS4、SS6、SS11(程式標準;版本不變)', () => {
            assert.deepEqual(NOTE_STANDARDS.map((s) => [s.id, s.kind, s.v]), [['SS2', 'program', 1], ['SS3', 'program', 2], ['SS4', 'program', 1], ['SS6', 'program', 1], ['SS11', 'program', 1]])
        })

        it('合格筆記:SS2／SS3／SS6 合格、SS11 不適用(非最高級)、SS4 以原文紮根合格', () => {
            const rs = checkNote({ front: FRONT(), body: BODY() }, { vocab: VOCAB, material: '動量研究\nTaiwan momentum 12-1 earns 8.2% annual excess return over 2010-2020' })
            for (const s of ['SS2', 'SS3', 'SS4', 'SS6']) assert.equal(by(rs, s).status, 'pass', `${s}：${by(rs, s).detail}`)
            assert.equal(by(rs, 'SS11').status, 'na')
        })

        it('SS2:缺一句話重點、核心知識空、概念 1 個、清單外標注、[object Object]、參數表空白列 → 不合格並逐項列出', () => {
            const rs = checkNote({ front: FRONT({ concepts: ['動量因子'], claim_type: '未標注' }), body: BODY({ summary: '', kps: [], params: ['| a | 1 | b |', '|  |  |  |'], extra: '## 方法與步驟\n\n- [object Object]' }) }, { vocab: VOCAB })
            const d = by(rs, 'SS2')
            assert.equal(d.status, 'violation')
            for (const w of ['缺一句話重點', '核心知識為空', '概念 1 個', '內容類型「未標注」', '[object Object]', '參數表有空白列']) assert.ok(d.detail.includes(w), `${w} ∈ ${d.detail}`)
        })

        it('SS3:內容章之簡體與同形字誤用 → 不合格;來源章原文標題、關聯與 ⚠ 投影章不計', () => {
            assert.equal(by(checkNote({ front: FRONT(), body: BODY({ kps: ['- 动量之后仍有效'] }) }, { vocab: VOCAB }), 'SS3').status, 'violation')
            const ok = checkNote({ front: FRONT(), body: BODY({ origTitle: '动量研究（原文為簡體）', tail: '## 關聯\n\n- → [[x-1]] 关联理由\n\n## ⚠ 衝突與反例\n\n- 與 [[y-2]]：反例之后' }) }, { vocab: VOCAB })
            assert.equal(by(ok, 'SS3').status, 'pass', by(ok, 'SS3').detail)
        })

        it('SS4:原文不可得 → 未能判定;不傳材料 → 不檢;原文沒有之數字 → 不合格', () => {
            assert.equal(by(checkNote({ front: FRONT(), body: BODY() }, { vocab: VOCAB, material: null }), 'SS4').status, 'undetermined')
            assert.equal(by(checkNote({ front: FRONT(), body: BODY() }, { vocab: VOCAB }), 'SS4'), undefined)
            const bad = by(checkNote({ front: FRONT(), body: BODY() }, { vocab: VOCAB, material: '動量研究 2010-2020' }), 'SS4')
            assert.equal(bad.status, 'violation')
            assert.ok(bad.detail.includes('8.2%'), bad.detail)
        })

        it('SS6:計數尾碼、多概念擠一標籤、跨文字系統括號註記 → 不合格;年份、階數參數不誤判', () => {
            assert.match(conceptLabelProblem('動量因子(193)'), /計數尾碼/)
            assert.match(conceptLabelProblem('市場微結構, 流動性'), /多概念/)
            assert.match(conceptLabelProblem('主動推論(Active Inference)'), /跨文字系統/)
            for (const ok of ['金融危機(2008)', 'AR(p)', 'GARCH(1,1)', 'I(0)', '動量因子', 'ARIMA(p,d,q)']) assert.equal(conceptLabelProblem(ok), '', ok)
            assert.equal(by(checkNote({ front: FRONT({ concepts: ['動量因子(193)', '回測'] }), body: BODY() }, { vocab: VOCAB }), 'SS6').status, 'violation')
        })

        it('SS11:最高級而明確自承無獨立觀測 → 不合格;只涉及獨立觀測而未明確自承 → 未能判定;無此 caveat → 合格', () => {
            const v = by(checkNote({ front: FRONT({ level: '高', caveatsFront: ['無獨立觀測證實'] }), body: BODY({ level: '高' }) }, { vocab: VOCAB }), 'SS11')
            assert.equal(v.status, 'violation')
            const u = by(checkNote({ front: FRONT({ level: '高', caveatsFront: ['摘要未揭露獨立觀測證實之資料範圍與細節'] }), body: BODY({ level: '高' }) }, { vocab: VOCAB }), 'SS11')
            assert.equal(u.status, 'undetermined')
            assert.equal(by(checkNote({ front: FRONT({ level: '高', caveatsFront: ['無交易成本'] }), body: BODY({ level: '高' }) }, { vocab: VOCAB }), 'SS11').status, 'pass')
        })

        it('內容章、原文標題、紮根材料(依 processedChars 截至送出範圍)', () => {
            const body = BODY({ tail: '## 關聯\n\n- 關聯行' })
            assert.ok(!noteContentText(body).includes('原文標題') && !noteContentText(body).includes('關聯行'))
            assert.equal(originalTitleOf(body), '動量研究')
            assert.equal(noteMaterialOf({ title: 'T', text: 'abcdefghij' }, { processedChars: 4 }), 'T\nabcd')
            assert.equal(noteMaterialOf(null, {}), null)
        })

        it('C8 網頁回溯物(抓取套件標 currentPage)不作 SS4 材料(不能證明為摘要當時之頁面);API 依編號取得者照用——經真實之另存與 docTextOf', async () => {
            const docs = memStore([{ id: 'p', status: 'noted', text: '' }, { id: 'q', status: 'noted', text: '' }])
            const docTexts = memStore()
            await archiveDocText(docTexts, { id: 'p', title: 'T', text: '今日之頁面 8.2%', textFrom: 'refetch:article', status: 'noted' }, '2026-10-06T00:00:00+08:00')
            await archiveDocText(docTexts, { id: 'q', title: 'T', text: '摘要 8.2%', textFrom: 'refetch:arxiv', status: 'noted' }, '2026-10-06T00:00:00+08:00')
            assert.equal(noteMaterialOf(await docTextOf({ docs, docTexts }, 'p'), {}), null)
            assert.equal(noteMaterialOf(await docTextOf({ docs, docTexts }, 'q'), {}), 'T\n摘要 8.2%')
            assert.equal(noteMaterialOf({ title: 'T', text: 'x', textFrom: 'refetch:article' }, {}), 'T\nx', '本套件不自解讀 textFrom(未經抓取套件標記者照用)')
        })
    })

    // ══════════════════════════ SS11 之規則送達 ══════════════════════════
    describe('SS11:規則取自詞彙表(預設不啟用;判定、降級、回饋同一規則)', function() {
        const note = (caveats, level = '高') => ({ front: FRONT({ level, caveatsFront: caveats }), body: BODY({ level }) })

        it('預設(詞彙表未給 evidenceRule):最高級＋任何 caveats 皆不適用、新進不降級、回饋不附更正方向', () => {
            for (const c of [['無獨立觀測證實'], ['摘要未揭露獨立觀測證實之資料範圍與細節'], ['未經同儕審查'], []]) {
                assert.deepEqual(by(checkNote(note(c), { vocab: NEUTRAL }), 'SS11'), { std: 'SS11', status: 'na', detail: '', field: '' }, JSON.stringify(c))
                const { item, fixes } = normalizeNoteItem(ITEM({ evidence_level: '高', caveats: c }), { vocab: NEUTRAL })
                assert.deepEqual([item.evidence_level, fixes.some((x) => /降為/.test(x))], ['高', false], JSON.stringify(c))
            }
            const undetermined = { std: 'SS11', status: 'undetermined', detail: 'caveat 涉及獨立觀測而未明確自承(須判讀)：x' }
            assert.equal(noteFeedbackOf(undetermined, { vocab: NEUTRAL }), 'SS11 caveat 涉及獨立觀測而未明確自承(須判讀)：x', '停用之規則不附方向')
        })

        it('給了規則:判定與新進降級同一判準——嚴式 → 不合格且降一級(說明逐字);寬式只命中 → 未能判定、不降;皆無 → 合格、不降;非最高級 → 不適用、不降', () => {
            const cases = [
                [['無獨立觀測證實'], 'violation', '中', '證據等級「高」與 caveat 自承無獨立觀測證實矛盾 → 降為「中」'],
                [['摘要未揭露獨立觀測證實之資料範圍與細節'], 'undetermined', '高', null],
                [['無交易成本'], 'pass', '高', null],
            ]
            for (const [caveats, status, level, fix] of cases) {
                assert.equal(by(checkNote(note(caveats), { vocab: VOCAB }), 'SS11').status, status, JSON.stringify(caveats))
                const n = normalizeNoteItem(ITEM({ evidence_level: '高', caveats }), { vocab: VOCAB })
                assert.equal(n.item.evidence_level, level, JSON.stringify(caveats))
                assert.equal(n.fixes.find((x) => /^證據等級「高」與 caveat/.test(x)) ?? null, fix)
            }
            assert.equal(by(checkNote(note(['無獨立觀測證實'], '中'), { vocab: VOCAB }), 'SS11').status, 'na')
            assert.equal(normalizeNoteItem(ITEM({ evidence_level: '中', caveats: ['無獨立觀測證實'] }), { vocab: VOCAB }).item.evidence_level, '中')
            assert.deepEqual(by(checkNote(note(['無獨立觀測證實']), { vocab: VOCAB }), 'SS11').detail, '證據等級「高」卻自承：無獨立觀測證實')
        })

        it('caveats 之來源:front 優先,其次記錄(與規則之 caveatsOf 同一取法)', () => {
            const rs = checkNote({ front: { ...FRONT({ level: '高' }), caveats: undefined }, body: BODY({ level: '高' }), record: { caveats: ['無獨立觀測證實'] } }, { vocab: VOCAB })
            assert.equal(by(rs, 'SS11').status, 'violation')
        })

        it('任意領域之規則:判定之說明、降級說明與回饋之更正方向皆出自規則之用詞', () => {
            const v = resolveSummarizeVocab({ ...BASE, evidenceRule: PEER_RULE })
            const r = by(checkNote(note(['未經同儕審查']), { vocab: v }), 'SS11')
            assert.deepEqual([r.status, r.detail], ['violation', '證據等級「高」卻自承：未經同儕審查'])
            const u = by(checkNote(note(['未說明是否經同儕審查']), { vocab: v }), 'SS11')
            assert.equal(noteFeedbackOf(u, { vocab: v }), 'SS11 caveat 涉及同儕審查而未明確自承(須判讀)：未說明是否經同儕審查——請明確寫出是否做過同儕審查，或降低證據等級')
            assert.ok(normalizeNoteItem(ITEM({ evidence_level: '高', caveats: ['未經同儕審查'] }), { vocab: v }).fixes.includes('證據等級「高」與 caveat 自承無同儕審查矛盾 → 降為「中」'))
        })
    })

    // ══════════════════════════ 詞彙之送達 ══════════════════════════
    describe('詞彙之送達(給了即須為本套件解析後之詞彙;未給 → 依賴詞彙之判定略過)', function() {
        const NOT_RESOLVED = [{ ...BASE }, {}, JSON.parse(JSON.stringify(VOCAB)), 'x', 0]
        const m = (where) => `${where} 須為 resolveSummarizeVocab 之產物（evidenceRule 須為已編譯之規則物件；未經本套件解析之詞彙表、他段之詞彙表或 JSON 往返之複本請先以 resolveSummarizeVocab 解析——證據規則不得靜默退回不啟用）`

        it('standardsVocabOf:undefined／null → null;解析後之詞彙(及其展開複本)→ 同一物件;其餘 → 拋並帶呼叫處', () => {
            assert.deepEqual([standardsVocabOf(undefined), standardsVocabOf(null)], [null, null])
            assert.equal(standardsVocabOf(VOCAB), VOCAB)
            const copy = { ...VOCAB }
            assert.equal(standardsVocabOf(copy), copy)
            for (const bad of NOT_RESOLVED) assert.equal(msgOf(() => standardsVocabOf(bad, '某處')), m('某處'), JSON.stringify(bad))
        })

        it('未經解析之詞彙(plain 物件、{}、JSON 往返之複本、非物件)→ 各入口皆拋,訊息指出入口', () => {
            const k = ITEM()
            for (const bad of NOT_RESOLVED) {
                assert.equal(msgOf(() => checkNote({ front: FRONT(), body: BODY() }, { vocab: bad })), m('checkNote 之 ctx.vocab'), JSON.stringify(bad))
                assert.equal(msgOf(() => normalizeNoteItem(k, { vocab: bad })), m('normalizeNoteItem 之 opt.vocab'))
                assert.equal(msgOf(() => noteItemFieldProblems(k, bad)), m('noteItemFieldProblems 之 vocab'))
                assert.equal(msgOf(() => noteItemProblems(k, bad)), m('noteItemFieldProblems 之 vocab'))
                assert.equal(msgOf(() => gateNoteItem(k, { vocab: bad })), m('gateNoteItem 之 opt.vocab'))
                assert.equal(msgOf(() => gateNoteItem({ relevant: false }, { vocab: bad })), m('gateNoteItem 之 opt.vocab'), '非知識項亦拋(詞彙錯誤不因項目而隱沒)')
                assert.equal(msgOf(() => repairProblemsOf(k, { vocab: bad })), m('repairProblemsOf 之 o.vocab'))
                assert.equal(msgOf(() => noteFeedbackOf({ std: 'SS6', detail: 'x' }, { vocab: bad })), m('noteFeedbackOf 之 opt.vocab'))
            }
        })

        it('未給詞彙(undefined／null):不驗清單、不降級、SS11 不適用、回饋不附方向——其餘標準照判', () => {
            const f = FRONT({ level: '高', claim_type: '清單外', caveatsFront: ['無獨立觀測證實'] })
            for (const ctx of [{}, { vocab: undefined }, { vocab: null }]) {
                const rs = checkNote({ front: f, body: BODY({ level: '高' }) }, ctx)
                assert.deepEqual([by(rs, 'SS2').status, by(rs, 'SS11').status, by(rs, 'SS6').status], ['pass', 'na', 'pass'], JSON.stringify(ctx))
            }
            assert.equal(by(checkNote({ front: FRONT({ concepts: ['甲'] }), body: BODY() }, {}), 'SS2').status, 'violation', '詞彙無關之 SS2 項目照判')
            const n = normalizeNoteItem(ITEM({ evidence_level: '高', claim_type: '清單外', caveats: ['無獨立觀測證實'] }))
            assert.deepEqual([n.item.evidence_level, n.item.claim_type], ['高', '清單外'])
            assert.deepEqual(noteItemFieldProblems(ITEM({ claim_type: '清單外', evidence_level: '極高' })), [])
            assert.deepEqual(noteItemProblems(ITEM({ claim_type: '清單外' }), null), [])
            assert.equal(gateNoteItem(ITEM({ claim_type: '清單外' })).ok, true)
            assert.deepEqual(repairProblemsOf(normalizeNoteItem(ITEM({ claim_type: '清單外' })).item, {}), [])
            assert.equal(noteFeedbackOf({ std: 'SS11', status: 'undetermined', detail: 'x' }), 'SS11 x')
        })

        it('noteFeedbackOf 之第二參數須為物件:以 .map(noteFeedbackOf) 直接傳入(陣列索引成為第二參數)→ 拋,不靜默丟掉更正方向', () => {
            const r = { std: 'SS11', status: 'undetermined', detail: 'caveat 涉及獨立觀測而未明確自承(須判讀)：x' }
            assert.match(msgOf(() => [r].map(noteFeedbackOf)), /^noteFeedbackOf 之第二參數須為 \{ vocab \}/)
            assert.match(msgOf(() => noteFeedbackOf(r, 'x')), /^noteFeedbackOf 之第二參數須為 \{ vocab \}/)
            assert.equal([r].map((x) => noteFeedbackOf(x, { vocab: VOCAB }))[0], 'SS11 caveat 涉及獨立觀測而未明確自承(須判讀)：x——請明確寫出是否做過獨立觀測證實，或降低證據等級')
        })
    })

    // ══════════════════════════ noteNormalize ══════════════════════════
    describe('正規化(standards/noteNormalize)', function() {

        it('清單之物件元素攤平(不丟內容、不成 [object Object]);字串誤給為清單外形狀亦收', () => {
            assert.equal(flattenEl({ step: '排序', detail: '依過去 12 個月報酬' }), '排序：依過去 12 個月報酬')
            const { item, fixes } = normalizeNoteItem(ITEM({ methods: [{ step: '排序', detail: '依報酬' }, '再平衡'], caveats: '單一市場' }), { vocab: VOCAB })
            assert.deepEqual(item.methods, ['排序：依報酬', '再平衡'])
            assert.deepEqual(item.caveats, ['單一市場'])
            assert.ok(fixes.some((x) => /methods 之 1 個物件元素已攤平/.test(x)))
        })

        it('簡體轉正體(標題、清單、概念);簡體之內容類型經轉換後對上清單', () => {
            const { item } = normalizeNoteItem(ITEM({ title: '动量因子之实证', key_points: ['年化超额 8.2%'], concepts: ['动量因子', '回测'], claim_type: '实证研究' }), { vocab: VOCAB })
            assert.equal(item.title, '動量因子之實證')
            assert.deepEqual(item.concepts, ['動量因子', '回測'])
            assert.equal(item.claim_type, '實證研究')
            assert.deepEqual(noteItemProblems(item, VOCAB), [])
        })

        it('概念標籤:去計數尾碼、拆多概念(各段皆為既有概念;括號內之逗號不拆)、去跨文字系統註記、去重、截 6 個', () => {
            // SS6:擠標籤之拆分以「各段皆為既有概念」為條件(此處各段皆既有)
            const known = () => true
            const { item, fixes } = normalizeNoteItem(ITEM({ concepts: ['動量因子(193)', '市場微結構, 流動性', 'GARCH(1,1)', '主動推論(Active Inference)', 'Momentum(動量)', '動量因子', '甲', '乙'] }), { vocab: VOCAB, knownConcept: known })
            assert.deepEqual(item.concepts, ['動量因子', '市場微結構', '流動性', 'GARCH(1,1)', '主動推論', '動量'])
            assert.ok(fixes.some((x) => /截為 6 個/.test(x)))
            // 擠標籤＋計數尾碼並存:先拆再逐個去尾碼(先判尾碼只去最後一個,拆不開而成亂鍵)
            const both = normalizeNoteItem(ITEM({ concepts: ['系統性風險(246), 市場機制偵測(445), 尾部風險(352), 流動性提供(345)'] }), { vocab: VOCAB, knownConcept: known })
            assert.deepEqual(both.item.concepts, ['系統性風險', '市場機制偵測', '尾部風險', '流動性提供'])
            assert.ok(both.fixes.some((x) => /^概念拆開/.test(x)) && both.fixes.filter((x) => /^概念去計數尾碼/.test(x)).length === 4, JSON.stringify(both.fixes))
        })

        it('S6 擠標籤之拆分條件與存量一致:未注入既有概念判定 → 不拆(原樣、SS6 不合格);有段非既有概念 → 不拆;各段皆既有 → 拆', () => {
            // JSDoc:normConcepts／normalizeNoteItem 未給判定＝不拆(無從判定「各段皆為既有概念」)
            const fixes = []
            assert.deepEqual(normConcepts(['市場微結構、流動性', '動量'], fixes), ['市場微結構、流動性', '動量'])
            assert.deepEqual(fixes, [], '未拆亦不記修正')
            assert.deepEqual(normConcepts(['市場微結構、流動性'], [], { canSplit: () => true }), ['市場微結構', '流動性'])
            const partial = normalizeNoteItem(ITEM({ concepts: ['市場微結構、流動性', '動量'] }), { vocab: VOCAB, knownConcept: (c) => c === '流動性' })
            assert.deepEqual(partial.item.concepts, ['市場微結構、流動性', '動量'], '一段非既有概念 → 整個標籤原樣')
            const all = normalizeNoteItem(ITEM({ concepts: ['市場微結構、流動性', '動量'] }), { vocab: VOCAB, knownConcept: (c) => ['市場微結構', '流動性'].includes(c) })
            assert.deepEqual(all.item.concepts, ['市場微結構', '流動性', '動量'])
            // 原樣保留之擠標籤由落地前之 checkNote 判 SS6 不合格(新進即不納入)
            const domain = createSummarizeDomain({ vocab: VOCAB })
            const n = buildNote({ k: partial.item, doc: { id: 'd', url: 'https://e.com/d', sourceName: 's', title: '動量研究' }, domain, notesDir: `${TMP}/s6`, nowIso: '2026-10-05T00:00:00+08:00' })
            const ss6 = checkNote({ front: n.front, body: n.body, record: n.record }, { vocab: domain.vocab }).find((r) => r.std === 'SS6')
            assert.deepEqual([ss6.status, /多概念擠一標籤/.test(ss6.detail)], ['violation', true])
        })

        it('最高證據等級而 caveat 明確自承無獨立觀測(嚴式)→ 降一級(只往保守方向)', () => {
            const { item, fixes } = normalizeNoteItem(ITEM({ evidence_level: '高', caveats: ['無獨立觀測證實'] }), { vocab: VOCAB })
            assert.equal(item.evidence_level, '中')
            assert.ok(fixes.some((x) => /降為「中」/.test(x)))
            assert.equal(normalizeNoteItem(ITEM({ evidence_level: '高', caveats: ['單一市場'] }), { vocab: VOCAB }).item.evidence_level, '高')
        })

        it('S5 只涉及獨立觀測而未明確自承(寬式只命中)→ 新進不降級(與存量同);checkNote 判 SS11 未能判定;回饋附明確之更正方向', () => {
            const loose = '摘要未揭露獨立觀測證實之資料範圍與細節'
            const { item, fixes } = normalizeNoteItem(ITEM({ evidence_level: '高', caveats: [loose] }), { vocab: VOCAB })
            assert.equal(item.evidence_level, '高', '寬式只命中不自動降級')
            assert.ok(!fixes.some((x) => /降為/.test(x)))
            const domain = createSummarizeDomain({ vocab: VOCAB })
            const n = buildNote({ k: item, doc: { id: 'd', url: 'https://e.com/d', sourceName: 's', title: '動量研究' }, domain, notesDir: `${TMP}/s5`, nowIso: '2026-10-05T00:00:00+08:00' })
            const r = checkNote({ front: n.front, body: n.body, record: n.record }, { vocab: domain.vocab }).find((x) => x.std === 'SS11')
            assert.equal(r.status, 'undetermined')
            assert.match(noteFeedbackOf(r, { vocab: domain.vocab }), /^SS11 caveat 涉及獨立觀測而未明確自承.+——請明確寫出是否做過獨立觀測證實，或降低證據等級$/)
            assert.equal(noteFeedbackOf({ std: 'SS6', status: 'violation', detail: '多概念擠一標籤「甲、乙」' }), 'SS6 多概念擠一標籤「甲、乙」', '其餘標準之回饋同原因文字')
            assert.equal(noteFeedbackOf({ std: 'SS6', status: 'violation', detail: '多概念擠一標籤「甲、乙」' }, { vocab: domain.vocab }), 'SS6 多概念擠一標籤「甲、乙」', '給了詞彙亦同')
        })

        it('欄位上限不靜默截斷:文字逾上限於句讀處截並記錄、上限內無句讀全文保留;清單取前 N 項並記錄;落地不再另截;降級判定看全部 caveats', () => {
            const NFL = NOTE_FIELD_LIMITS
            // 樣本期間若被固定字數無聲截斷,會斷在數字中(「…2026-08-」)
            const longP = `${'台股上市櫃 2010-01 至 2024-12 日資料，'.repeat(4)}樣本外 2025-01 至 2026-08-31`
            const a = normalizeNoteItem(ITEM({ sample_period: longP }), { vocab: VOCAB })
            assert.ok([...a.item.sample_period].length <= NFL.text.sample_period && /[，]$/.test(a.item.sample_period), a.item.sample_period)
            assert.ok(a.fixes.some((x) => new RegExp(`^sample_period ${[...longP].length} 字逾 ${NFL.text.sample_period}，於句讀處截為 \\d+ 字$`).test(x)), JSON.stringify(a.fixes))
            const noBreak = `2010${'0'.repeat(NFL.text.sample_period)}`
            const b = normalizeNoteItem(ITEM({ sample_period: noBreak }), { vocab: VOCAB })
            assert.deepEqual([b.item.sample_period, b.fixes.filter((x) => /^sample_period/.test(x))], [noBreak, []], '上限內無句讀 → 全文保留(不在數字中間斷開)、不記截斷')
            // 清單:caveats(提示詞未載上限,取寬鬆值)與 pros(提示詞 0-4)
            const cav = Array.from({ length: NFL.list.caveats + 2 }, (_, i) => `限制 ${i + 1}`)
            const pros = ['甲', '乙', '丙', '丁', '戊', '己']
            const c = normalizeNoteItem(ITEM({ caveats: cav, pros }), { vocab: VOCAB })
            assert.deepEqual([c.item.caveats.length, c.item.pros], [NFL.list.caveats, pros.slice(0, NFL.list.pros)])
            assert.ok(c.fixes.includes(`caveats ${cav.length} 項逾 ${NFL.list.caveats}，取前 ${NFL.list.caveats} 項`) && c.fixes.includes(`pros 6 項逾 ${NFL.list.pros}，取前 ${NFL.list.pros} 項`), JSON.stringify(c.fixes))
            assert.deepEqual(normalizeNoteItem(ITEM({ caveats: ['單一市場'], pros: ['甲'], sample_period: '2015-2025' }), { vocab: VOCAB }).fixes, [], '未逾上限 → 無修正紀錄')
            // 降級判定看模型給之全部 caveats(自承無獨立觀測之句在第 13 條)
            const d = normalizeNoteItem(ITEM({ evidence_level: '高', caveats: [...cav.slice(0, NFL.list.caveats), '無獨立觀測證實'] }), { vocab: VOCAB })
            assert.deepEqual([d.item.evidence_level, d.item.caveats.length], ['中', NFL.list.caveats])
            // 落地(domain.normalizeQuality)不另截
            const domain = createSummarizeDomain({ vocab: VOCAB })
            const p90 = `${'2015-01 至 2025-12 全市場，'.repeat(4)}`.slice(0, 90)
            const n = buildNote({ k: normalizeNoteItem(ITEM({ sample_period: p90, caveats: cav.slice(0, 10) }), { vocab: VOCAB }).item, doc: { id: 'd', url: 'https://e.com/d', sourceName: 's', title: '動量研究' }, domain, notesDir: `${TMP}/b13b`, nowIso: '2026-10-05T00:00:00+08:00' })
            assert.deepEqual([n.front.sample_period, n.front.caveats.length], [p90.trim(), 10])
        })

        it('硬性欄位:缺標題、缺一句話重點、核心知識空、概念不足、清單外標注', () => {
            const ps = noteItemProblems({ relevant: true, title: '', summary: '', key_points: [], concepts: ['甲'], claim_type: '其他', evidence_level: '極高' }, VOCAB)
            for (const w of ['缺標題', '缺一句話重點', '核心知識為空', '概念 1 個', '內容類型「其他」', '證據等級「極高」']) assert.ok(ps.some((p) => p.includes(w)), w)
            assert.deepEqual(noteItemProblems({ relevant: false }, VOCAB), [], '非知識項不檢')
        })
    })

    // ══════════════════════════ noteGate ══════════════════════════
    describe('數字紮根之處置(standards/noteGate)', function() {

        it('清單行、參數列、概念含原文沒有之數字 → 逐條移除;樣本期間改未載明、證據說明清空', () => {
            const d = dropUngrounded(ITEM({ key_points: ['年化超額 8.2%', '夏普 1.9'], parameters: [{ name: '回看', value: '12 個月' }, { name: '槓桿', value: '3 倍' }], sample_period: '1990-2000', evidence_note: '樣本 500 檔' }), SRC)
            assert.deepEqual(d.item.key_points, ['年化超額 8.2%'])
            assert.deepEqual(d.item.parameters.map((p) => p.name), ['回看'])
            assert.equal(d.item.sample_period, '未載明')
            assert.equal(d.item.evidence_note, '')
            assert.equal(d.removed.length, 4)
        })

        it('標題或一句話重點含原文沒有之數字、或核心知識全被移除 → 整項不納入', () => {
            assert.match(dropUngrounded(ITEM({ title: '動量年化 9.9%' }), SRC).fatal, /標題/)
            assert.match(dropUngrounded(ITEM({ summary: '年化 9.9%' }), SRC).fatal, /一句話重點/)
            assert.match(dropUngrounded(ITEM({ key_points: ['夏普 1.9'] }), SRC).fatal, /核心知識/)
        })

        it('gateNoteItem:正規化＋硬性欄位＋紮根;未給材料不檢紮根(人工匯入);非知識項原樣放行', () => {
            const ok = gateNoteItem(ITEM({ key_points: ['年化超額 8.2%', '夏普 1.9'] }), { vocab: VOCAB, material: SRC })
            assert.equal(ok.ok, true)
            assert.ok(ok.fixes.some((x) => /夏普 1\.9/.test(x)))
            assert.deepEqual(gateNoteItem(ITEM({ concepts: ['甲'] }), { vocab: VOCAB, material: SRC }).reasons, ['概念 1 個（須 2～6）'])
            assert.equal(gateNoteItem(ITEM({ title: '年化 9.9%' }), { vocab: VOCAB }).ok, true, '人工匯入不檢紮根')
            assert.equal(gateNoteItem({ index: 1, relevant: false }, { vocab: VOCAB }).ok, true)
        })

        it('gateNoteItem 之不納入標準與移除紀錄(待判之主要標準、修補成效之判準):SS2 硬性欄位 → std SS2;紮根致命 → SS4;納入時 removed 列移除之行', () => {
            assert.deepEqual([gateNoteItem(ITEM({ concepts: ['甲'] }), { vocab: VOCAB, material: SRC }).std, gateNoteItem(ITEM({ title: '動量年化 9.9%' }), { vocab: VOCAB, material: SRC }).std], ['SS2', 'SS4'])
            const g = gateNoteItem(ITEM({ key_points: ['年化超額 8.2%', '夏普 1.9'] }), { vocab: VOCAB, material: SRC })
            assert.deepEqual([g.std, g.removed], ['', ['key_points「夏普 1.9」（1.9）']])
        })

        it('ungroundedLinesOf:受檢欄位與順序之單一實作(標題、一句話重點、清單各行、參數列、概念、樣本期間、證據說明);dropUngrounded 由之推得', () => {
            const k = ITEM({ title: '年化 9.9%', summary: '夏普 1.9', key_points: ['年化超額 8.2%', '槓桿 3 倍'], parameters: [{ name: '回看', value: '12 個月', note: '' }, { name: '槓桿', value: '3 倍', note: '' }], concepts: ['動量', '10 年期殖利率'], sample_period: '1990-2000', evidence_note: '樣本 500 檔' })
            const us = ungroundedLinesOf(k, SRC)
            assert.deepEqual(us.map((u) => [u.field, u.kind, u.index]), [['title', 'text', -1], ['summary', 'text', -1], ['key_points', 'line', 1], ['parameters', 'param', 1], ['concepts', 'concept', 1], ['sample_period', 'text', -1], ['evidence_note', 'text', -1]])
            assert.ok(us[2].line === '槓桿 3 倍' && us[2].numbers.length === 1, JSON.stringify(us[2]))
            assert.deepEqual(noteItemFieldProblems({ relevant: true, title: 'T', summary: '', key_points: ['k'], concepts: ['甲'], claim_type: '其他', evidence_level: '中' }, VOCAB).map((p) => [p.field, p.kind]), [['summary', 'text'], ['concepts', 'concepts'], ['claim_type', 'text']])
        })

        it('移除紀錄之字樣(短文字 40／30／20 字、缺值字樣)與概念不足之致命說明', () => {
            const longLine = `夏普 1.9 ${'甲'.repeat(60)}`
            const d = dropUngrounded(ITEM({ key_points: ['年化超額 8.2%', longLine], parameters: [{ name: '乙'.repeat(25), value: '3 倍' }], sample_period: `1990-2000 ${'丙'.repeat(40)}`, evidence_note: `樣本 500 檔 ${'丁'.repeat(40)}` }), SRC)
            assert.deepEqual(d.removed, [
                `key_points「${shortText(longLine)}」（1.9）`,
                `參數「${shortText('乙'.repeat(25), 20)}」（3 倍）`,
                `樣本期間「${shortText(`1990-2000 ${'丙'.repeat(40)}`, 30)}」改為${NOTE_PLACEHOLDERS.samplePeriod}`,
                `證據說明「${shortText(`樣本 500 檔 ${'丁'.repeat(40)}`, 30)}」清空`,
            ])
            assert.ok(d.removed[0].endsWith('…」（1.9）'), d.removed[0])
            assert.equal(dropUngrounded(ITEM({ concepts: ['動量', '10 年期殖利率'] }), SRC).fatal, `移除含原文沒有之數字之概念後不足 ${CONCEPT_COUNT.min} 個`)
        })
    })

    // ══════════════════════════ noteRepair ══════════════════════════
    describe('欄位定向修補之純函數(standards/noteRepair)', function() {
        const MATERIAL = `動量研究\n${'Taiwan momentum 12-1 earns 8.2% annual excess return over 2010-2024; Sharpe 0.71; costs 0.15%.'}`
        const RITEM = (o = {}) => ITEM({ key_points: ['年化超額 8.2%', '夏普 1.9'], ...o })

        it('repairProblemsOf:SS2 硬性欄位＋SS4 含原文沒有之數字之欄位與行(與納入閘同一判定);概念整欄不足時個別概念之數字問題併入整欄;非知識項回空', () => {
            const k = normalizeNoteItem(RITEM({ claim_type: '理論', concepts: ['10 年期殖利率'], parameters: [{ name: '槓桿', value: '3 倍' }] }), { vocab: VOCAB }).item
            const ps = repairProblemsOf(k, { vocab: VOCAB, material: MATERIAL })
            assert.deepEqual(ps.map((p) => [p.std, p.field, p.kind, p.index]), [['SS2', 'concepts', 'concepts', -1], ['SS2', 'claim_type', 'text', -1], ['SS4', 'key_points', 'line', 1], ['SS4', 'parameters', 'param', 0]])
            assert.match(ps[0].detail, /^概念 1 個（須 2～6）；概念「10 年期殖利率」含原文沒有之數字（10/)
            assert.deepEqual(repairProblemsOf({ relevant: false }, { vocab: VOCAB, material: MATERIAL }), [])
            assert.deepEqual(repairProblemsOf(normalizeNoteItem(RITEM({ key_points: ['年化超額 8.2%'] }), { vocab: VOCAB }).item, { vocab: VOCAB, material: MATERIAL }), [], '全合格 → 無須修補')
            assert.deepEqual(repairProblemsOf(k, { vocab: VOCAB }).map((p) => p.std), ['SS2', 'SS2'], '未給材料不檢 SS4')
        })

        it('applyRepairs:只改被指出之處(多給之欄位不採);null／空字串刪清單行與參數列;形狀不合、編號越界、同編號而值不同者不採', () => {
            const k = normalizeNoteItem(RITEM({ key_points: ['年化超額 8.2%', '夏普 1.9', '回撤 40%'], parameters: [{ name: '槓桿', value: '3 倍' }] }), { vocab: VOCAB }).item
            const ps = repairProblemsOf(k, { vocab: VOCAB, material: MATERIAL })
            assert.deepEqual(ps.map((p) => `${p.field}#${p.index}`), ['key_points#1', 'key_points#2', 'parameters#0'])
            const r = applyRepairs(k, ps, { repairs: [{ no: 1, value: '夏普值 0.71' }, { no: 2, value: null }, { no: 3, value: { name: '成本', value: '0.15%' } }, { no: 9, value: 'x' }], summary: '不得採用', title: '亦不採' })
            assert.deepEqual(r.item.key_points, ['年化超額 8.2%', '夏普值 0.71'])
            assert.deepEqual(r.item.parameters, [{ name: '成本', value: '0.15%', note: '' }])
            assert.deepEqual([r.item.title, r.item.summary, r.applied], [k.title, k.summary, 3], '未被指出之欄位不動')
            assert.ok(r.notes.some((x) => x === '修補呼叫：核心知識（第 2 行）「夏普 1.9」→「夏普值 0.71」') && r.notes.some((x) => /核心知識（第 3 行）「回撤 40%」刪除/.test(x)), JSON.stringify(r.notes))
            const bad = applyRepairs(k, ps, { repairs: [{ no: 1, value: ['陣列'] }, { no: 3, value: 'x' }, { no: 2, value: 'a' }, { no: 2, value: 'b' }] })
            assert.deepEqual([bad.applied, bad.item.key_points], [0, k.key_points], '形狀不合與同編號矛盾皆不採')
            assert.equal(k.key_points.length, 3, '不修改輸入')
            assert.deepEqual([checkRepairReply({ repairs: [] }), checkRepairReply({}), checkRepairReply([])], [true, false, false])
        })

        it('fieldPlaceOf:指出處之稱呼(欄位中文名＋第 N 行／列／個;非清單無序號;未列之欄位用原名);修補紀錄同一寫法', () => {
            assert.deepEqual([
                fieldPlaceOf({ field: 'key_points', kind: 'line', index: 1 }), fieldPlaceOf({ field: 'parameters', kind: 'param', index: 0 }),
                fieldPlaceOf({ field: 'concepts', kind: 'concept', index: 2 }), fieldPlaceOf({ field: 'title', kind: 'text', index: -1 }),
                fieldPlaceOf({ field: 'concepts', kind: 'concepts', index: -1 }), fieldPlaceOf({ field: 'x_field', kind: 'line', index: 0 }),
            ], ['核心知識（第 2 行）', '關鍵參數（第 1 列）', '概念（第 3 個）', '標題', '概念', 'x_field（第 1 行）'])
            assert.equal(Object.keys(NOTE_FIELD_LABELS).length, 17)
            const k = { relevant: true, title: '甲', concepts: ['動量', '回測'], parameters: [{ name: '槓桿', value: '3 倍', note: '' }] }
            const r = applyRepairs(k, [{ std: 'SS4', field: 'parameters', kind: 'param', index: 0, line: 'x' }], { repairs: [{ no: 1, value: null }] })
            assert.deepEqual(r.notes, ['修補呼叫：關鍵參數（第 1 列）刪除'])
        })
    })

    // ══════════════════════════ faithCheck ══════════════════════════
    describe('忠實性覆核(standards/faithCheck)', function() {
        const NOTE = { title: '筆記甲', key_points: ['動量於美股有效'], concepts: ['動量', '因子'], summary: '動量於美股有效', category: '方法', claim_type: '實證研究', evidence_level: '中' }
        const SEATS = { first: { use: 'f1' }, second: { use: 'f2' }, third: { use: 'f3' } }
        const FAITH = { verdict: 'faithful', reason: '與原文相符' }
        const UNF = { verdict: 'unfaithful', reason: '一句話重點寫成普遍成立，原文只限美股' }
        const domain = createSummarizeDomain({ vocab: { categories: ['方法', '風險', '雜項'], fallbackCategory: '雜項' } })

        it('標準識別與常值', () => {
            assert.deepEqual([SS14, FAITH_VERDICTS, SS14_OBJECT], [{ std: 'SS14', v: 1 }, ['faithful', 'unfaithful', PANEL_UNSURE], 'doc'])
            assert.deepEqual([checkFaithChecks({ checks: [] }), checkFaithChecks({}), checkFaithChecks(null)], [true, false, false])
        })

        it('faithNoteText:內容欄逐欄(標題、一句話重點、核心知識、參數、條件、證據等級…);清單中之物件不列;概念與分類不在受檢文字', () => {
            const t = faithNoteText({ ...NOTE, key_points: ['甲', {}, '乙'], parameters: [{ name: '回看期', value: '12 個月', note: '略過最近 1 月' }, {}], conditions: ['美股'], evidence_note: '僅回測', counter_views: ['有研究認為已消失'] })
            for (const s of ['標題：筆記甲', '一句話重點：動量於美股有效', '核心知識：\n- 甲\n- 乙', '參數：\n- 回看期＝12 個月（略過最近 1 月）', '適用條件與限制：\n- 美股', '證據等級：中——僅回測', '反方觀點：\n- 有研究認為已消失']) assert.ok(t.includes(s), s)
            assert.ok(!t.includes('動量、因子') && !t.includes('方法'), '概念與分類不受檢')
        })

        it('checkFaithVerdictOf／seatFaithVotesOf:faithful(理由可空);unfaithful 理由 ≥10 字;unsure 合法;其餘＝缺票;同編號矛盾(含 unsure 對明確票)→ 缺票', () => {
            assert.deepEqual(checkFaithVerdictOf({ verdict: 'FAITHFUL' }), { verdict: 'faithful', reason: '' })
            assert.equal(checkFaithVerdictOf({ verdict: 'unfaithful', reason: '太短' }), null)
            assert.equal(checkFaithVerdictOf({ verdict: 'unsure' }), PANEL_UNSURE)
            assert.equal(checkFaithVerdictOf({ verdict: 'ok' }), null)
            const m = seatFaithVotesOf({ checks: [{ index: 1, ...FAITH }, { index: 1, ...UNF }, { index: 2, verdict: 'unsure' }, { index: 2, ...UNF }, { index: 3, ...FAITH }, { index: 3, verdict: 'faithful', reason: '另寫' }, { index: 9, ...FAITH }] }, new Set([1, 2, 3]))
            assert.deepEqual([m.get(1), m.get(2), m.get(3)?.verdict, m.has(9)], [null, null, 'faithful', false])
        })

        it('runFaithCheck:兩席一致 → 成立;不一致 → 第三席只送該些項;同一供應者 → 未成立;skipped → stopped;提示詞含原文與筆記、判準與輸出形狀', async () => {
            const items = [{ key: 'a', title: '甲', material: '原文甲', note: { ...NOTE, title: '甲' } }, { key: 'b', title: '乙', material: '原文乙', note: { ...NOTE, title: '乙' } }]
            const prompts = []
            const byFaith = { f1: { 甲: FAITH, 乙: FAITH }, f2: { 甲: FAITH, 乙: UNF }, f3: { 乙: UNF } }
            const call = async (k, seat, p) => {
                prompts.push([seat.use, p])
                const its = [...p.matchAll(/^--- 第(\d+)項 ---\n【原文】\n(.+)$/gm)].map((m) => ({ index: Number(m[1]), t: m[2].replace('原文', '') }))
                return { ok: true, providerId: `p-${seat.use}`, data: { checks: its.map((x) => ({ index: x.index, ...byFaith[seat.use][x.t] })) } }
            }
            const r = await runFaithCheck({ items, buildPrompt: domain.buildFaithCheckPrompt, call, seats: SEATS })
            assert.deepEqual([...r.decisions.entries()].map(([k, d]) => [k, d.status, d.verdict?.verdict]), [['a', 'decided', 'faithful'], ['b', 'decided', 'unfaithful']])
            assert.equal(r.calls, 3)
            assert.equal((prompts.find((x) => x[0] === 'f3')[1].match(/^--- 第\d+項 ---$/gm) || []).length, 1, '第三席只送未成立之項')
            const p1 = prompts.find((x) => x[0] === 'f1')[1]
            for (const s of ['忠實性核對員', '【原文】\n原文甲', '【筆記】\n標題：甲', 'faithful：', 'unfaithful：', '寫成普遍成立', '證據等級或其說明誇大原文', '拿不準就回 unsure，不要猜', '{"checks":[']) assert.ok(p1.includes(s), s)
            const same = await runFaithCheck({ items: items.slice(0, 1), buildPrompt: domain.buildFaithCheckPrompt, call: async (k, seat, p) => ({ ...(await call(k, seat, p)), providerId: 'p-x' }), seats: { first: SEATS.first, second: SEATS.second } })
            assert.deepEqual([same.decisions.get('a').status, same.decisions.get('a').why], ['undetermined', 'same-provider'])
            const stop = await runFaithCheck({ items, buildPrompt: domain.buildFaithCheckPrompt, call: async () => ({ ok: false, skipped: true }), seats: SEATS })
            assert.equal(stop.stopped, true)
        })

        it('runFaithCheck:無項目、缺 call 或缺 buildPrompt → 不呼叫(calls 0);只有第一席 → 一次呼叫、第二票缺(未成立 missing)', async () => {
            const items = [{ key: 'a', title: '甲', material: '原文甲', note: NOTE }]
            const none = { decisions: new Map(), calls: 0, stopped: false }
            assert.deepEqual(await runFaithCheck({ items: [], buildPrompt: domain.buildFaithCheckPrompt, call: async () => assert.fail('不應呼叫'), seats: SEATS }), none)
            assert.deepEqual(await runFaithCheck({ items, buildPrompt: domain.buildFaithCheckPrompt, seats: SEATS }), none)
            assert.deepEqual(await runFaithCheck({ items, call: async () => assert.fail('不應呼叫'), seats: SEATS }), none)
            const one = await runFaithCheck({ items, buildPrompt: domain.buildFaithCheckPrompt, call: async () => ({ ok: true, providerId: 'p1', data: { checks: [{ index: 1, ...FAITH }] } }), seats: { first: SEATS.first } })
            assert.deepEqual([one.calls, one.decisions.get('a').status, one.decisions.get('a').why], [1, 'undetermined', 'missing'])
        })

        it('runFaithCheck(骨架為 core/standards/panelRun):第二席項序依 sha1(`ss14|<key>`) 打亂、編號隨項;call 之第一參數即席位鍵(first／second／third);call 同步拋出 → 覆核拋出且第二席不被呼叫', async () => {
            const items = ['a', 'b', 'c', 'd', 'e'].map((k) => ({ key: k, title: `題${k}`, material: `原文${k}`, note: { ...NOTE, title: k } }))
            const seen = []
            const call = async (k, seat, p) => {
                seen.push([k, seat.use, [...p.matchAll(/^--- 第(\d+)項 ---\n【原文】\n原文(\w)$/gm)].map((m) => `${m[1]}${m[2]}`)])
                return { ok: true, providerId: `p-${seat.use}`, data: { checks: [] } }
            }
            await runFaithCheck({ items, buildPrompt: domain.buildFaithCheckPrompt, call, seats: SEATS })
            const order = items.map((it, j) => ({ key: it.key, index: j + 1 })).sort((x, y) => (sha1(`ss14|${x.key}`) < sha1(`ss14|${y.key}`) ? -1 : 1)).map((x) => `${x.index}${x.key}`)
            assert.deepEqual(seen.map((x) => x.slice(0, 2)), [['first', 'f1'], ['second', 'f2']], '回覆全缺票 → 不叫第三席')
            assert.deepEqual(seen[0][2], ['1a', '2b', '3c', '4d', '5e'], '第一席為原序')
            assert.deepEqual(seen[1][2], order, '第二席依前綴 ss14 之雜湊排序、編號隨項')
            assert.notDeepEqual(seen[1][2], seen[0][2], '前提:此 5 項之打亂與原序不同')
            const stages = []
            await assert.rejects(runFaithCheck({
                items, buildPrompt: domain.buildFaithCheckPrompt, seats: SEATS,
                call: (k) => {
                    stages.push(k)
                    throw new Error('同步錯')
                },
            }), /同步錯/)
            assert.deepEqual(stages, ['first'])
        })
    })

    // ══════════════════════════ 共用常數與字樣 ══════════════════════════
    describe('共用常數與字樣(單一來源)', function() {

        it('CONCEPT_COUNT:2～6(凍結);conceptCountDetail 為落地檢定與 AI 輸出端同一字樣;逾上限者落地判 SS2、正規化截至上限', () => {
            assert.deepEqual(CONCEPT_COUNT, { min: 2, max: 6 })
            assert.ok(Object.isFrozen(CONCEPT_COUNT))
            assert.equal(conceptCountDetail(1), '概念 1 個（須 2～6）')
            const seven = ['甲', '乙', '丙', '丁', '戊', '己', '庚']
            const d = by(checkNote({ front: FRONT({ concepts: seven }), body: BODY() }, { vocab: VOCAB }), 'SS2')
            assert.ok(d.status === 'violation' && d.detail.includes(conceptCountDetail(7)), d.detail)
            assert.deepEqual(noteItemFieldProblems({ relevant: true, title: 'T', summary: 's', key_points: ['k'], concepts: [] }).map((p) => p.detail), [conceptCountDetail(0)])
            const fixes = []
            assert.equal(normConcepts(seven, fixes).length, CONCEPT_COUNT.max)
            assert.deepEqual(fixes, ['概念 7 個截為 6 個'])
        })

        it('NOTE_PLACEHOLDERS:缺值字樣(凍結);納入閘之樣本期間處置與落地版型同讀', () => {
            assert.deepEqual(NOTE_PLACEHOLDERS, { claimType: '未標注', evidenceLevel: '未評估', samplePeriod: '未載明' })
            assert.ok(Object.isFrozen(NOTE_PLACEHOLDERS))
            const q = createSummarizeDomain({}).normalizeQuality({ claim_type: '清單外', evidence_level: '極高' })
            assert.deepEqual([q.claimType, q.evidenceLevel, q.samplePeriod], [NOTE_PLACEHOLDERS.claimType, NOTE_PLACEHOLDERS.evidenceLevel, NOTE_PLACEHOLDERS.samplePeriod])
        })

        it('shortText:壓空白、去頭尾;逾 n 字截斷加「…」(預設 40);null／undefined 為空字串', () => {
            assert.equal(shortText('  甲 \n 乙  '), '甲 乙')
            assert.equal(shortText('一'.repeat(40)), '一'.repeat(40))
            assert.equal(shortText('一'.repeat(41)), `${'一'.repeat(40)}…`)
            assert.equal(shortText('一二三四五', 3), '一二三…')
            assert.deepEqual([shortText(null), shortText(undefined), shortText(12345, 2)], ['', '', '12…'])
        })
    })
})
