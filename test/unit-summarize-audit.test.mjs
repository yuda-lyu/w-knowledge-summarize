// unit-summarize-audit.test.mjs — 摘要檢定標準之符合度掃描(standards/audit):四態計數與完整 id、豁免、SS4 之材料、SS11 之規則與指紋、
//   AI 標準只計待判、範圍與上限、唯讀、與新進閘同一判定、真 LMDB
// 規則(出自 standards/audit 檔頭與 JSDoc):
//   ①逐標準:總量、四態、版本、完整 id;md 讀不到 → 該篇各標準未能判定(不報為零;讀不到不是內容之裁示,不受豁免)
//   ②不合格／未能判定而有使用者豁免(holds waived;鍵 note:<筆記 id>:<標準> 或 doc:<文件 id>:<標準>)→ 已豁免(逐一列出,不算合格);
//     未結(open)之登錄不是豁免;合格者不因有豁免而改記
//   ③SS4 之材料取抓取套件之原文取得(文件或另存;今日之頁面視同不可得)→ 不可得記未能判定;material:false 不讀原文 → 未能判定並註明;
//     範圍不含 SS4 時不讀原文
//   ④SS11 依詞彙表之 evidenceRule:未給詞彙或未給規則 → 不適用、fp 為 '';給規則 → 判定並附 fp(規則之指紋);詞彙未經本套件解析 → 拋
//   ⑤AI 標準(SS5、SS9、SS14)只計待判:SS14／SS9 取 holds 之 open／waived,SS5 取 reject-pending 之 raw 文件(waived 為 null);不計檢核紀錄;
//     來源集合未給 → null(不報為零);範圍不含 AI 標準者不出 ai
//   ⑥唯讀:不寫任何檔案與集合;判定與新進閘同一函數(checkNote＋noteMaterialOf)
// 移植原實作之 unit-standards-modules(283、348;只取摘要部分:四態與 id、md 讀不到、原文另存之 SS4、豁免映射)各案(斷言不變;詞彙改本套件之
//   解析並給回中立題材之證據規則 NEUTRAL_RULE;原文另存以抓取套件之 archiveDocText 造);308、329 屬邊與抓取之標準,不在本套件。
//   其餘為新增(含 AI 標準之待判——原實作之 AI 標準以檢核紀錄計「已檢」,本套件不寫檢核紀錄,改只計待判)。
// 執行:自套件根 node <mocha> test/unit-summarize-audit.test.mjs(暫存 test/_tmp/summarize-audit-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import { memStore, archiveDocText } from './tools/captureForTest.mjs'
import { NEUTRAL_RULE } from './tools/stageKit.mjs'
import { docTextOf, standardsCountsOf } from '../src/core/capturePackage.mjs'
import { readMd, writeMd } from '../src/core/md/md.mjs'
import { resolveSummarizeVocab } from '../src/core/vocab/summarizeVocab.mjs'
import { checkNote, noteMaterialOf } from '../src/standards/noteStandards.mjs'
import { SUMMARIZE_STANDARDS } from '../src/standards/registry.mjs'
import { SUMMARIZE_AUDITED_STANDARD_IDS, SUMMARIZE_AI_PENDING_STANDARD_IDS, SUMMARIZE_SCAN_OBJECT, auditSummarizeStandards, summarizeScanOf } from '../src/standards/audit.mjs'

const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/summarize-audit-${process.pid}`).replace(/\\/g, '/')
const NOW = '2026-10-07T10:00:00+08:00'
const BASE = { claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] }
/** 移植案之詞彙(原為 plain 物件＋原實作內建之 SS11;此處為本套件解析後之詞彙並給回該規則) */
const VOCAB = resolveSummarizeVocab({ ...BASE, evidenceRule: NEUTRAL_RULE })
/** 同清單、未給證據規則(本套件預設:SS11 不啟用) */
const NEUTRAL = resolveSummarizeVocab(BASE)
/** 中立之自訂規則(最高級須經同儕審查) */
const PEER = resolveSummarizeVocab({ ...BASE, evidenceRule: { subject: '同儕審查', check: '同儕審查', strict: [{ p: '(?:未經|沒有|無)同儕審查' }], loose: [{ p: '(?:未|無)[^；;。]{0,10}同儕審查' }] } })
let seq = 0

const BODY = (o = {}) => [
    `# ${o.title || '動量因子之台股實證'}`, '',
    '## 一句話重點', '', o.summary ?? '台股十二減一月動量年化超額 8.2%。', '',
    '## 品質與證據標注', '', '- 內容類型：實證研究', `- 證據等級：${o.level || '中'}`, '- 數據樣本期間：2010-2020', ...(o.caveats || ['⚠ 無交易成本']).map((c) => `- ${c}`), '',
    '## 核心知識', '', ...(o.kps ?? ['- 動量年化超額 8.2%']), '',
    '## 來源', '', `- 原文標題：${o.origTitle || '動量研究'}`, '- 來源：測試', '- 網址：https://x.test/a', '- 發布時間：2026-09-01 08:00:00', '- 內文取得方式：原網頁全文', '',
].join('\n')
const FRONT = (o = {}) => ({ title: o.title || '動量因子之台股實證', concepts: o.concepts || ['動量因子', '回測'], claim_type: o.claim_type || '實證研究', evidence_level: o.level || '中', caveats: o.caveatsFront || ['無交易成本'] })

/**
 * 暫存目錄(每案一個)
 * @returns {String} 回傳目錄路徑
 */
const dirOf = () => {
    const d = `${TMP}/e${++seq}`
    fs.mkdirSync(d, { recursive: true })
    return d
}

/**
 * 寫一篇筆記之 md 並回傳其記錄(o.missing 為真者不寫 md:md 讀不到)
 * @param {String} dir 輸入目錄
 * @param {String} id 輸入筆記 id
 * @param {Object} [o={}] 輸入 FRONT／BODY 之覆寫＋{ docId, missing, rec(記錄之其他欄位) }
 * @returns {Object} 回傳筆記記錄
 */
const mkNote = (dir, id, o = {}) => {
    const file = `${dir}/${o.missing ? `missing-${id}` : id}.md`
    if (!o.missing) writeMd(file, FRONT(o), BODY(o))
    return { id, file, docId: o.docId === undefined ? `d-${id}` : o.docId, title: o.title || '動量因子之台股實證', ...(o.rec || {}) }
}

/**
 * 每筆判定恰歸一態、列表與計數一致(未給 maxIds 時)
 * @param {Object} b 輸入一條標準之掃描結果
 */
const wellFormed = (b) => {
    assert.equal(b.total, b.pass + b.violation + b.undetermined + b.na + b.waived, `${b.id}:total＝四態＋豁免`)
    assert.deepEqual([b.violations.length, b.undetermineds.length, b.waiveds.length], [b.violation, b.undetermined, b.waived], `${b.id}:列表與計數`)
}
const ids = (list) => list.map((x) => x.id)

/**
 * 移植案 283 之夾具:n1 合格(原文另存可得 → 檢 SS4)、n2 簡體(SS3)＋概念 1 個(SS2)、n3 md 讀不到
 * @param {String} dir 輸入目錄
 * @returns {Promise} 回傳 Promise,resolve 回傳 { notes:Array, docs:Array, docTexts:memStore }
 */
async function fixture283(dir) {
    const notes = [
        mkNote(dir, 'n1', { docId: 'd1', title: 'x' }),
        mkNote(dir, 'n2', { docId: 'd2', title: 'y', concepts: ['动量'], kps: ['- 动量'] }),
        mkNote(dir, 'n3', { docId: 'd3', title: 'z', missing: true }),
    ]
    const docs = [{ id: 'd1', status: 'noted', url: 'https://x.test/a', text: '' }, { id: 'd2', status: 'noted', url: 'https://x.test/b', text: '' }]
    const docTexts = memStore()
    assert.equal((await archiveDocText(docTexts, { id: 'd1', title: '動量研究', text: 'Taiwan momentum 8.2% excess over 2010-2020', status: 'noted' }, NOW)).ok, true)
    return { notes, docs, docTexts }
}

describe('unit-summarize-audit', function() {

    before(() => {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
    })
    after(() => fs.rmSync(TMP, { recursive: true, force: true }))

    describe('四態計數與完整 id(移植 283)', function() {

        it('四態計數與完整 id;md 讀不到 → 該篇各筆記標準未能判定(不報為零);原文另存可得者檢 SS4', async () => {
            const f = await fixture283(dirOf())
            const stores = { notes: memStore(f.notes), docs: memStore(f.docs), docTexts: f.docTexts }
            const rep = await auditSummarizeStandards({ stores, vocab: VOCAB })
            const S = rep.standards
            assert.deepEqual([S.SS3.violation, S.SS3.violations.map((x) => x.id)], [1, ['n2']])
            assert.deepEqual([S.SS4.pass, S.SS4.undetermined], [1, 2], 'd1 有原文 → 檢;d2 無原文、n3 md 讀不到 → 未能判定')
            assert.ok(S.SS2.undetermineds.some((x) => x.id === 'n3' && /md 讀不到/.test(x.detail)))
            assert.equal(rep.counts.notes, 3)
            // n3 之各標準皆未能判定;n2 之 SS2(概念 1 個)不合格
            for (const id of SUMMARIZE_AUDITED_STANDARD_IDS) assert.ok(S[id].undetermineds.some((x) => x.id === 'n3' && x.detail === 'md 讀不到'), `${id} 記 n3 未能判定`)
            assert.deepEqual(ids(S.SS2.violations), ['n2'])
            assert.match(S.SS2.violations[0].detail, /概念 1 個/)
            assert.deepEqual(Object.keys(S), [...SUMMARIZE_AUDITED_STANDARD_IDS], '依全集之序')
            for (const b of Object.values(S)) wellFormed(b)
        })

        it('與新進閘同一判定:逐篇逐標準之結果＝checkNote(落地形態＋noteMaterialOf 之材料)', async () => {
            const f = await fixture283(dirOf())
            const stores = { notes: memStore(f.notes), docs: memStore(f.docs), docTexts: f.docTexts }
            const rep = await auditSummarizeStandards({ stores, vocab: VOCAB })
            for (const n of f.notes.filter((x) => x.id !== 'n3')) {
                const md = readMd(n.file)
                const material = noteMaterialOf(await docTextOf(stores, n.docId), n, md.body)
                for (const r of checkNote({ front: md.front, body: md.body, record: n }, { vocab: VOCAB, material })) {
                    const b = rep.standards[r.std]
                    const where = { violation: b.violations, undetermined: b.undetermineds }[r.status]
                    if (where) assert.deepEqual(where.find((x) => x.id === n.id), { id: n.id, detail: r.detail }, `${n.id} ${r.std}`)
                    else {
                        assert.ok(!b.violations.some((x) => x.id === n.id) && !b.undetermineds.some((x) => x.id === n.id), `${n.id} ${r.std} ${r.status} 不在不合格／未能判定之列`)
                    }
                }
            }
        })
    })

    describe('使用者豁免(移植 348 之 SS3 部分)', function() {

        it('不合格／未能判定而有豁免者記 waived(逐一列出,不算合格);鍵可為 note:<筆記> 或 doc:<文件>;未結之登錄不是豁免;合格者不因有豁免而改記;md 讀不到不受豁免', async () => {
            const dir = dirOf()
            const notes = [
                mkNote(dir, 'w1', { concepts: ['动量', '回測'], docId: 'dw1' }), // SS3 不合格 → 豁免(note 鍵)
                mkNote(dir, 'w2', { concepts: ['動量因子'], docId: 'dw2' }), // SS2 不合格(概念 1 個)→ 豁免(doc 鍵)
                mkNote(dir, 'w3', { concepts: ['动量', '回測'], docId: 'dw3' }), // SS3 不合格,登錄未結 → 仍為不合格
                mkNote(dir, 'w4', { docId: 'dw4' }), // 合格,雖有豁免仍記合格
                mkNote(dir, 'w5', { docId: 'dw5', missing: true }), // md 讀不到:豁免不適用
            ]
            const holds = memStore([
                { id: 'note:w1:SS3', object: 'note', oid: 'w1', std: 'SS3', status: 'waived', waivedBy: '使用者', ruling: '保留原寫法' },
                { id: 'doc:dw2:SS2', object: 'doc', oid: 'dw2', std: 'SS2', status: 'waived', waivedBy: '使用者', ruling: '確認維持' },
                { id: 'note:w3:SS3', object: 'note', oid: 'w3', std: 'SS3', status: 'open' },
                { id: 'note:w4:SS3', object: 'note', oid: 'w4', std: 'SS3', status: 'waived' },
                { id: 'note:w5:SS2', object: 'note', oid: 'w5', std: 'SS2', status: 'waived' },
            ])
            const S = (await auditSummarizeStandards({ stores: { notes: memStore(notes), holds }, vocab: VOCAB }, { only: ['SS2', 'SS3'] })).standards
            assert.deepEqual([S.SS3.violation, S.SS3.waived, ids(S.SS3.waiveds), ids(S.SS3.violations)], [1, 1, ['w1'], ['w3']], '豁免是裁示,另計(不算合格)')
            assert.deepEqual([S.SS2.waived, ids(S.SS2.waiveds)], [1, ['w2']], '文件鍵之豁免同樣生效')
            assert.equal(S.SS3.pass, 2, 'w2、w4 合格(w4 雖有豁免仍記合格)')
            assert.deepEqual(ids(S.SS2.undetermineds), ['w5'], 'md 讀不到不受豁免')
            for (const b of Object.values(S)) wellFormed(b)
        })
    })

    describe('SS4 之材料', function() {

        it('原文取得:文件未瘦身者取文件之正文、已瘦身者取另存;今日之頁面視同不可得(未能判定);無文件 id 者未能判定', async () => {
            const dir = dirOf()
            const notes = [
                mkNote(dir, 'a', { docId: 'da' }), // 文件之正文
                mkNote(dir, 'b', { docId: 'db' }), // 另存為今日之頁面
                mkNote(dir, 'c', { docId: 'dc', kps: ['- 動量年化超額 9.9%'] }), // 原文沒有 9.9%
                mkNote(dir, 'd', { docId: '' }), // 無文件 id
            ]
            const docTexts = memStore()
            await archiveDocText(docTexts, { id: 'db', title: '動量研究', text: '動量 8.2% 2010-2020', textFrom: 'refetch:article', status: 'noted' }, NOW)
            const docs = memStore([
                { id: 'da', status: 'noted', title: '動量研究', text: '動量 8.2% 2010-2020' },
                { id: 'db', status: 'noted', title: '動量研究', text: '' },
                { id: 'dc', status: 'noted', title: '動量研究', text: '動量 8.2% 2010-2020' },
            ])
            const S4 = (await auditSummarizeStandards({ stores: { notes: memStore(notes), docs, docTexts }, vocab: VOCAB }, { only: ['SS4'] })).standards.SS4
            assert.deepEqual([S4.pass, S4.violation, S4.undetermined], [1, 1, 2])
            assert.deepEqual(ids(S4.violations), ['c'])
            assert.match(S4.violations[0].detail, /9\.9%/)
            assert.deepEqual(S4.undetermineds, [{ id: 'b', detail: '原文不可得' }, { id: 'd', detail: '原文不可得' }])
        })

        it('material:false → SS4 每篇未能判定並註明未讀原文(不報為零)、不讀原文;範圍不含 SS4 者亦不讀原文;豁免照映射', async () => {
            const f = await fixture283(dirOf())
            let reads = 0
            const docs = memStore(f.docs)
            const get0 = docs.get
            docs.get = async (id) => {
                reads++
                return get0(id)
            }
            const holds = memStore([{ id: 'note:n1:SS4', object: 'note', oid: 'n1', std: 'SS4', status: 'waived' }])
            const stores = { notes: memStore(f.notes), docs, docTexts: f.docTexts, holds }
            const S4 = (await auditSummarizeStandards({ stores, vocab: VOCAB }, { material: false })).standards.SS4
            assert.deepEqual([S4.total, S4.pass, S4.undetermined, S4.waived], [3, 0, 2, 1], 'n1 之未能判定有豁免 → 已豁免;n2 未能判定;n3 md 讀不到')
            assert.match(S4.undetermineds.find((x) => x.id === 'n2').detail, /未讀原文（material:false）/)
            assert.equal(reads, 0, 'material:false 不讀原文')
            await auditSummarizeStandards({ stores, vocab: VOCAB }, { only: ['SS2', 'SS3', 'SS6', 'SS11'] })
            assert.equal(reads, 0, '範圍不含 SS4 不讀原文')
            await auditSummarizeStandards({ stores, vocab: VOCAB }, { only: ['SS4'] })
            assert.ok(reads > 0, '含 SS4 才讀')
        })
    })

    describe('SS11 之規則與指紋', function() {

        /**
         * SS11 之夾具:h1 最高級＋明確自承(嚴式)、h2 最高級＋只涉及(寬式)、h3 最高級＋無涉、h4 非最高級＋明確自承、h5 最高級＋未經同儕審查
         * @returns {Object} 回傳 stores
         */
        const ss11Stores = () => {
            const dir = dirOf()
            return {
                notes: memStore([
                    mkNote(dir, 'h1', { level: '高', caveatsFront: ['無獨立觀測證實'] }),
                    mkNote(dir, 'h2', { level: '高', caveatsFront: ['摘要未揭露獨立觀測證實之資料範圍與細節'] }),
                    mkNote(dir, 'h3', { level: '高', caveatsFront: ['無交易成本'] }),
                    mkNote(dir, 'h4', { level: '中', caveatsFront: ['無獨立觀測證實'] }),
                    mkNote(dir, 'h5', { level: '高', caveatsFront: ['未經同儕審查'] }),
                ]),
            }
        }

        it('給規則 → 嚴式不合格、寬式未能判定、無涉合格、非最高級不適用;附規則指紋 fp(＝規則物件之 fp);換規則 → 判定與指紋隨之', async () => {
            const S = (await auditSummarizeStandards({ stores: ss11Stores(), vocab: VOCAB }, { only: ['SS11'] })).standards.SS11
            assert.deepEqual([ids(S.violations), ids(S.undetermineds), S.pass, S.na], [['h1'], ['h2'], 2, 1])
            assert.equal(S.violations[0].detail, '證據等級「高」卻自承：無獨立觀測證實')
            assert.equal(S.fp, VOCAB.evidenceRule.fp)
            assert.match(S.fp, /^[0-9a-f]{16}$/)
            const P = (await auditSummarizeStandards({ stores: ss11Stores(), vocab: PEER }, { only: ['SS11'] })).standards.SS11
            assert.deepEqual(ids(P.violations), ['h5'])
            assert.equal(P.fp, PEER.evidenceRule.fp)
            assert.notEqual(P.fp, S.fp, '規則不同 → 指紋不同(報表據以判讀規則變更)')
            wellFormed(S)
            wellFormed(P)
        })

        it('未給規則(預設詞彙)或未給詞彙 → 全數不適用、fp 為空字串;fp 只在 SS11 之條目', async () => {
            for (const vocab of [NEUTRAL, undefined]) {
                const rep = await auditSummarizeStandards({ stores: ss11Stores(), vocab })
                const S = rep.standards.SS11
                assert.deepEqual([S.total, S.na, S.fp], [5, 5, ''], vocab ? '預設詞彙' : '未給詞彙')
                for (const id of SUMMARIZE_AUDITED_STANDARD_IDS.filter((x) => x !== 'SS11')) assert.equal('fp' in rep.standards[id], false, `${id} 無 fp`)
            }
        })

        it('詞彙未經本套件解析(plain 物件、他段之詞彙表、JSON 往返之複本)→ 拋錯(證據規則不得在掃描無聲失效)', async () => {
            for (const bad of [{ ...BASE }, JSON.parse(JSON.stringify(VOCAB)), {}]) {
                await assert.rejects(() => auditSummarizeStandards({ stores: ss11Stores(), vocab: bad }), /須為 resolveSummarizeVocab 之產物/)
            }
        })
    })

    describe('AI 標準只計待判(SS5、SS9、SS14)', function() {

        const HOLDS = [
            { id: 'doc:a:SS14', object: 'doc', oid: 'a', std: 'SS14', status: 'open' },
            { id: 'doc:b:SS14', object: 'doc', oid: 'b', std: 'SS14', status: 'open' },
            { id: 'doc:c:SS14', object: 'doc', oid: 'c', std: 'SS14', status: 'waived' },
            { id: 'doc:d:SS14', object: 'doc', oid: 'd', std: 'SS14', status: 'resolved' },
            { id: 'note:n1:SS9', object: 'note', oid: 'n1', std: 'SS9', status: 'open' },
            { id: 'note:n2:SS9', object: 'note', oid: 'n2', std: 'SS9', status: 'waived' },
            { id: 'note:n3:SS2', object: 'note', oid: 'n3', std: 'SS2', status: 'open' },
        ]
        const DOCS = [
            { id: 'r1', status: 'raw', triage: 'reject-pending' },
            { id: 'r2', status: 'raw', triage: 'reject-pending' },
            { id: 'r3', status: 'raw', triage: 'relevant' },
            { id: 'r4', status: 'skip', triage: 'reject-pending' },
            { id: 'r5', status: 'raw' },
        ]

        it('SS14／SS9 取待判登錄之 open／waived;SS5 取 reject-pending 之 raw 文件(waived 為 null);不計檢核紀錄(無「已檢」等欄)', async () => {
            const rep = await auditSummarizeStandards({ stores: { notes: memStore([]), holds: memStore(HOLDS), docs: memStore(DOCS), checks: memStore([{ id: 'x', results: { SS14: { status: 'pass', v: 1 } } }]) } })
            assert.deepEqual(Object.keys(rep.ai), [...SUMMARIZE_AI_PENDING_STANDARD_IDS])
            const pick = (a) => [a.source, a.open, a.waived]
            assert.deepEqual(pick(rep.ai.SS14), ['holds', 2, 1])
            assert.deepEqual(pick(rep.ai.SS9), ['holds', 1, 1])
            assert.deepEqual(pick(rep.ai.SS5), ['docs', 2, null])
            for (const a of Object.values(rep.ai)) {
                assert.deepEqual(Object.keys(a), ['id', 'title', 'kind', 'v', 'module', 'object', 'source', 'open', 'waived'], `${a.id} 只計待判`)
                const s = SUMMARIZE_STANDARDS.find((x) => x.id === a.id)
                assert.deepEqual([a.title, a.kind, a.v, a.object], [s.title, s.kind, s.v, s.object])
            }
        })

        it('來源集合未給 → null(無從計,不報為零);範圍:只給程式標準者不出 ai、只給 AI 標準者無程式標準之條目、混給者各取所列', async () => {
            const none = await auditSummarizeStandards({ stores: { notes: memStore([]) } })
            assert.deepEqual(Object.values(none.ai).map((a) => [a.id, a.open, a.waived]), [['SS5', null, null], ['SS9', null, null], ['SS14', null, null]])
            const stores = { notes: memStore([]), holds: memStore(HOLDS), docs: memStore(DOCS) }
            assert.equal('ai' in await auditSummarizeStandards({ stores }, { only: [...SUMMARIZE_AUDITED_STANDARD_IDS] }), false)
            const only14 = await auditSummarizeStandards({ stores }, { only: ['SS14'] })
            assert.deepEqual([Object.keys(only14.standards), Object.keys(only14.ai)], [[], ['SS14']])
            const mixed = await auditSummarizeStandards({ stores }, { only: ['SS2', 'SS9'] })
            assert.deepEqual([Object.keys(mixed.standards), Object.keys(mixed.ai)], [['SS2'], ['SS9']])
        })
    })

    describe('範圍、上限、設定之容錯', function() {

        it('only:只掃所列(不認得之 id 略過;空陣列＝全部);maxIds:列表截至上限而計數照實;opt 非物件 → 預設', async () => {
            const f = await fixture283(dirOf())
            const stores = () => ({ notes: memStore(f.notes), docs: memStore(f.docs), docTexts: f.docTexts })
            assert.deepEqual(Object.keys((await auditSummarizeStandards({ stores: stores(), vocab: VOCAB }, { only: ['SS3', 'XX'] })).standards), ['SS3'])
            assert.deepEqual(Object.keys((await auditSummarizeStandards({ stores: stores(), vocab: VOCAB }, { only: [] })).standards), [...SUMMARIZE_AUDITED_STANDARD_IDS])
            for (const bad of [null, 'x', 5, []]) assert.deepEqual(Object.keys((await auditSummarizeStandards({ stores: stores(), vocab: VOCAB }, bad)).standards), [...SUMMARIZE_AUDITED_STANDARD_IDS])
            const one = (await auditSummarizeStandards({ stores: stores(), vocab: VOCAB }, { maxIds: 1 })).standards.SS4
            assert.deepEqual([one.undetermined, one.undetermineds.length], [2, 1])
            const zero = (await auditSummarizeStandards({ stores: stores(), vocab: VOCAB }, { maxIds: 0 })).standards.SS2
            assert.deepEqual([zero.violation + zero.undetermined, zero.violations.length + zero.undetermineds.length], [2, 0])
        })

        it('onNote:每篇讀得到 md 之筆記回呼一次(記錄與已讀之 md;他工作於同一次走訪取其所需);md 讀不到者不呼叫;範圍內無逐件判定之標準(只給 AI 標準)不走訪即不呼叫', async () => {
            const f = await fixture283(dirOf())
            const stores = () => ({ notes: memStore(f.notes), docs: memStore(f.docs), docTexts: f.docTexts })
            const seen = []
            await auditSummarizeStandards({ stores: stores(), vocab: VOCAB }, { onNote: (n, md) => seen.push([n.id, typeof md.body === 'string' && typeof md.front === 'object']) })
            const readable = f.notes.filter((n) => fs.existsSync(n.file)).map((n) => [n.id, true])
            assert.ok(readable.length > 0 && readable.length < f.notes.length, '前提:題組含 md 讀不到之筆記')
            assert.deepEqual(seen, readable)
            const none = []
            await auditSummarizeStandards({ stores: stores(), vocab: VOCAB }, { only: ['SS14'], onNote: (n) => none.push(n.id) })
            assert.deepEqual(none, [])
        })

        it('缺筆記集合(或其 select)即拋;deps 非物件即拋', async () => {
            await assert.rejects(() => auditSummarizeStandards({ stores: {} }), /需要 deps\.stores\.notes/)
            await assert.rejects(() => auditSummarizeStandards({ stores: { notes: { get: async () => null } } }), /需要 deps\.stores\.notes/)
            await assert.rejects(() => auditSummarizeStandards(undefined), /需要 deps\.stores\.notes/)
        })
    })

    describe('唯讀與計數摘要', function() {

        it('唯讀:md 檔(內容與修改時刻)、各集合、目錄皆不變', async () => {
            const dir = dirOf()
            const f = await fixture283(dir)
            const holdsRows = [{ id: 'note:n2:SS3', object: 'note', oid: 'n2', std: 'SS3', status: 'waived' }, { id: 'doc:x:SS14', object: 'doc', oid: 'x', std: 'SS14', status: 'open' }]
            const stores = { notes: memStore(f.notes), docs: memStore([...f.docs, { id: 'r', status: 'raw', triage: 'reject-pending' }]), docTexts: f.docTexts, holds: memStore(holdsRows) }
            const snap = () => ({
                files: fs.readdirSync(dir).sort(),
                md: f.notes.filter((n) => fs.existsSync(n.file)).map((n) => [fs.readFileSync(n.file, 'utf8'), fs.statSync(n.file).mtimeMs]),
                stores: Object.fromEntries(Object.entries(stores).map(([k, s]) => [k, JSON.stringify(s._dump())])),
            })
            const before = snap()
            await auditSummarizeStandards({ stores, vocab: VOCAB })
            await auditSummarizeStandards({ stores, vocab: VOCAB }, { material: false })
            assert.deepEqual(snap(), before)
        })

        it('總覽之形狀(summarizeScanOf)與計數摘要(抓取套件之 standardsCountsOf):標準列之對象為 notes、計數鍵＝掃描之標準、值為 { v, total, violation, undetermined, waived };AI 列只取待判登錄來源而有待判者', async () => {
            const f = await fixture283(dirOf())
            const holdsRows = [
                { id: 'doc:x:SS14', object: 'doc', oid: 'x', std: 'SS14', status: 'open' },
                { id: 'doc:y:SS14', object: 'doc', oid: 'y', std: 'SS14', status: 'waived' },
            ]
            const rep = await auditSummarizeStandards({ stores: { notes: memStore(f.notes), docs: memStore([...f.docs, { id: 'r', status: 'raw', triage: 'reject-pending' }]), docTexts: f.docTexts, holds: memStore(holdsRows) }, vocab: VOCAB })
            const s = summarizeScanOf(rep)
            assert.deepEqual([SUMMARIZE_SCAN_OBJECT, Object.values(s.standards).every((b) => b.object === 'notes'), s.counts], ['notes', true, { notes: f.notes.length }])
            assert.deepEqual(s.ai, { SS14: { checked: 0, pass: 0, violation: 0, undetermined: 0, na: 0, stale: 0, holdsOpen: 1, holdsWaived: 1, v: rep.ai.SS14.v } }, 'SS5(來源為文件之預篩判定)與無待判之 SS9 不列')
            const c = standardsCountsOf(s, { at: NOW, ms: 12 })
            assert.deepEqual([c.at, c.ms, Object.keys(c.counts)], [NOW, 12, [...SUMMARIZE_AUDITED_STANDARD_IDS]])
            for (const id of SUMMARIZE_AUDITED_STANDARD_IDS) {
                const b = rep.standards[id]
                assert.deepEqual(c.counts[id], { v: b.v, total: b.total, violation: b.violation, undetermined: b.undetermined, waived: b.waived }, id)
            }
            assert.deepEqual(c.ai, { SS14: { holdsOpen: 1 } })
            // 待判集合未給 → open 為 null(無從計)→ 不列
            const noHolds = summarizeScanOf(await auditSummarizeStandards({ stores: { notes: memStore(f.notes), docs: memStore(f.docs), docTexts: f.docTexts }, vocab: VOCAB }))
            assert.deepEqual(noHolds.ai, {})
            for (const bad of [null, undefined, 'x']) assert.deepEqual(summarizeScanOf(bad), { counts: {}, standards: {}, ai: {} })
        })
    })

    describe('真 LMDB', function() {

        it('筆記、文件、另存、待判皆在 LMDB 集合:掃描結果與記憶體集合逐欄相同(含豁免與 AI 標準之待判)', async () => {
            const dir = dirOf()
            const f = await fixture283(dir)
            const holdsRows = [
                { id: 'note:n2:SS3', object: 'note', oid: 'n2', std: 'SS3', status: 'waived', waivedBy: '使用者', ruling: '保留' },
                { id: 'doc:d2:SS2', object: 'doc', oid: 'd2', std: 'SS2', status: 'waived', waivedBy: '使用者', ruling: '確認維持' },
                { id: 'doc:x:SS14', object: 'doc', oid: 'x', std: 'SS14', status: 'open' },
                { id: 'note:n1:SS9', object: 'note', oid: 'n1', std: 'SS9', status: 'waived' },
            ]
            const docRows = [...f.docs, { id: 'r1', status: 'raw', triage: 'reject-pending' }, { id: 'r2', status: 'skip', triage: 'reject-pending' }]
            const byIdSort = (rows) => [...rows].sort((a, b) => a.id.localeCompare(b.id)) // LMDB 依鍵序讀出,記憶體集合比照
            const mem = { notes: memStore(byIdSort(f.notes)), docs: memStore(byIdSort(docRows)), docTexts: f.docTexts, holds: memStore(byIdSort(holdsRows)) }
            const open = (cl) => W.openCollection({ WOrm, path: `${dir}/db`, db: 'knowledge', cl })
            const lm = { notes: open('notes'), docs: open('docs'), docTexts: open('docTexts'), holds: open('holds') }
            try {
                await lm.notes.insertNew(f.notes)
                await lm.docs.insertNew(docRows)
                await lm.holds.insertNew(holdsRows)
                assert.equal((await archiveDocText(lm.docTexts, { id: 'd1', title: '動量研究', text: 'Taiwan momentum 8.2% excess over 2010-2020', status: 'noted' }, NOW)).ok, true)
                const a = await auditSummarizeStandards({ stores: lm, vocab: VOCAB })
                const b = await auditSummarizeStandards({ stores: mem, vocab: VOCAB })
                assert.deepEqual(a, b)
                assert.deepEqual([a.standards.SS3.waived, a.standards.SS2.waived, a.standards.SS4.pass, a.ai.SS14.open, a.ai.SS9.waived, a.ai.SS5.open], [1, 1, 1, 1, 1, 1])
            }
            finally {
                for (const c of Object.values(lm)) await c.close()
            }
        })
    })
})
