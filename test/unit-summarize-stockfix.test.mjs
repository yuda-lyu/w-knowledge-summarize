// unit-summarize-stockfix.test.mjs — 筆記之檢定標準存量處置(standards/stockFix):預演 → 套用 → 連鎖斷言 → 回退
// 規則(出自 standards/stockFix 檔頭與 JSDoc):
//   ①目標取自符合度掃描(同一判定);修法為 noteFixOf;預演不寫任何東西
//   ②套用:逐篇以現值重算;md 原子寫、即記帳、回讀驗、記錄 patch(陣列欄先清後寫、逐欄回驗);syncHash 依新 md 重算(原有才寫)、stdFixes 留痕
//     「存量 SSx」、不寫 knowledgeChangedAt;回傳 applied(titleChanged、contentChanged、consumed、conceptKeys)供呼叫端連鎖下游;renameKeysObsolete
//   ③修不了者登錄待判(物件 note、該標準、負責者 user、期限 noteHoldDeadlineOf、下一步同筆記同步入口之筆記待判);已有未結或已豁免者不重登;
//     未開 holds 集合列入 errors
//   ④處置帳(抓取套件之帳協定):筆記列 { at, object:'note', id, stds, changes, titleChanged, contentChanged, body, before:{ kca, consumed, units, record },
//     after:{ units, record }, file }——只記實際修改之單位(md 之 front 各鍵與本文之段、記錄之非同步欄位;處置前不存在者不列於 before);待判列
//     (before:{ hold });回退列;opt.ledgerFile 或 dirs.state 下之 stock-fix.jsonl;皆未給即拋
//   ⑤連鎖斷言只驗本套件可驗者(syncHash 與 md 一致、knowledgeChangedAt 未被寫、待判已登錄)
//   ⑥回退＝撤銷該次處置之效果:依帳逆序逐單位還原(＝after 者寫回 before、處置前不存在之鍵刪除;其後被改動之單位不動並報衝突、未修改之單位〔下游投影章、
//     使用者新章〕不動;同步欄位以組回之 md 重算)、待判列只動同一登錄(titleChanged 取帳列所記);無衝突者附寫回退列;記錄不在者為衝突;讀帳排除
//     已回退者與他模組之列,遇無法解析之列即拋(allowBad 才略過)
// 移植原實作之 unit-standards-stock(232、247;只取筆記部分:預演之逐篇處置與不寫、套用之 md 與記錄同步、不寫 knowledgeChangedAt、stdFixes、
//   修不了者之待判、帳列數、重掃 0、回退)各案(斷言不變;詞彙改本套件之解析並給回中立題材之證據規則 NEUTRAL_RULE;受影響之核心、鄰居重投、
//   重設基準名單屬下游——改斷言套用之回傳 conceptKeys／titleChanged／consumed);其餘為新增。
// 執行:自套件根 node <mocha> test/unit-summarize-stockfix.test.mjs(暫存 test/_tmp/summarize-stockfix-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import { memStore, setConceptFold, genClockTZ, archiveDocText, STOCK_LEDGER_FILE } from './tools/captureForTest.mjs'
import { NEUTRAL_RULE } from './tools/stageKit.mjs'
import { normalizeConcept, holdKey } from '../src/core/capturePackage.mjs'
import { readMd, writeMd } from '../src/core/md/md.mjs'
import { noteContentText } from '../src/core/md/noteContent.mjs'
import { resolveSummarizeVocab } from '../src/core/vocab/summarizeVocab.mjs'
import { syncFieldsOf, syncHashOf } from '../src/stores/noteSync.mjs'
import { noteHoldDeadlineOf, NOTE_HOLD_NEXT } from '../src/stores/noteHolds.mjs'
import { auditSummarizeStandards } from '../src/standards/audit.mjs'
import {
    renameKeysObsoleteOf, planNoteStockFix, applyNoteStockFix, verifyNoteStockChain, readNoteStockLedger, rollbackNoteStockFix,
} from '../src/standards/stockFix.mjs'

const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/summarize-stockfix-${process.pid}`).replace(/\\/g, '/')
const clock = genClockTZ('Asia/Taipei')
/** 移植案之詞彙(原為含他段鍵之 plain 物件＋原實作內建之 SS11;此處為本套件解析後之詞彙並給回該規則) */
const VOCAB = resolveSummarizeVocab({ evidenceLevels: ['高', '中', '低'], claimTypes: ['實證研究', '觀點評論'], guide: {}, evidenceRule: NEUTRAL_RULE })
// 分群折疊(以兩字示意):風／风、險／险 同鍵
const FOLD = (s) => s.replace(/風/g, '风').replace(/險/g, '险')
const AT = '2026-10-05T04:00:00+08:00'
let seq = 0

const bodyOf = (o = {}) => [
    `# ${o.title || '標題'}`, '',
    '## 一句話重點', '', o.summary ?? '重點一句', '',
    '## 品質與證據標注', '', `- 內容類型：實證研究`, `- 證據等級：${o.level || '中'}（獨立觀測檢驗）`, '- 數據樣本期間：2000-2020', ...(o.caveats || ['⚠ 無']).map((c) => `- ${c}`), '',
    '## 核心知識', '', ...(o.points || ['- 要點甲']), '',
    ...(o.params ? ['## 關鍵參數', '', '| 參數 | 值／區間 | 說明 |', '| --- | --- | --- |', ...o.params, ''] : []),
    '## 來源', '', `- 原文标题：${o.srcTitle || '原文标题保持简体'}`, '- 網址：https://example.com/数据', '',
    ...(o.rel ? ['## 關聯', '', o.rel, ''] : []),
].join('\n')

/**
 * 存量環境(移植案之筆記部分):n1 SS3(標題、內容章、概念、樣本期間、限制皆有簡體;記錄已有下游處理時刻)、n2 SS11、n3 SS6＋SS2、n4 合格之鄰篇;
 *   各篇 frontmatter 皆無內容類型(SS2 不合格且非確定性可修 → 修不了)。o.more:另加之筆記 [id, front, body, extra]
 * @param {Object} [o={}] 輸入 { more:Array, noHolds:Boolean, notes:集合工廠(rows) => 集合, holds:集合 }
 * @returns {Object} 回傳 { deps, dir, notes, holds, file:(id)=>md 路徑, ledger:處置帳預設路徑 }
 */
function env(o = {}) {
    const dir = `${TMP}/e${++seq}`
    const at = '2026-10-01T00:00:00+08:00'
    const mk = (id, front, body, extra = {}) => {
        const file = `${dir}/notes/${id}.md`
        writeMd(file, { slug: id, ...front }, body)
        const md = readMd(file)
        return { id, title: front.title, concepts: front.concepts, summary: '重點一句', category: '其他', claimType: '實證研究', evidenceLevel: front.evidence_level || '中', caveats: front.caveats || [], docId: `d-${id}`, file, createdAt: at, relatedAt: at, extractedAt: '', syncHash: syncHashOf(syncFieldsOf(md)), ...extra }
    }
    const rows = [
        mk('n1', { title: '动量因子之风险', concepts: ['风险', '動量'], evidence_level: '中', sample_period: '2000年后', caveats: ['样本有限'] },
            bodyOf({ title: '动量因子之风险', summary: '动量策略之风险来源', points: ['- 參見 [[简体-slug-1]] 與 https://example.com/风险', '- 风险随市况变化'] }), { extractedAt: at }),
        mk('n2', { title: '甲', concepts: ['甲概念', '乙概念'], evidence_level: '高', caveats: ['未經獨立觀測證實'] }, bodyOf({ title: '甲', level: '高', caveats: ['⚠ 未經獨立觀測證實'] })),
        mk('n3', { title: '乙', concepts: ['波動率(730)', '主動推論(Active Inference)', 'a', 'b', 'c', 'd', 'e'], evidence_level: '中' },
            bodyOf({ title: '乙', points: ['- 要點', '- [object Object]'], params: ['| 窗口 | 20 | 日 |', '| | | |'] })),
        mk('n4', { title: '丁', concepts: ['丁概念', '戊概念'], evidence_level: '中' }, bodyOf({ title: '丁', rel: '- → [[n1]] 动量因子之风险（互補搭配）' })),
        ...(o.more || []).map((x) => mk(...x)),
    ]
    const notes = o.notes ? o.notes(rows) : memStore(rows)
    const holds = o.noHolds ? null : (o.holds || memStore([]))
    const cores = memStore([{ id: 'k1', concept: '波動率', scope: 'concept', status: 'active', noteIds: ['n3'] }])
    const deps = { stores: { notes, cores, ...(holds ? { holds } : {}) }, dirs: { state: `${dir}/state` }, clock, vocab: VOCAB }
    return { deps, dir, notes, holds, file: (id) => `${dir}/notes/${id}.md`, ledger: `${dir}/state/${STOCK_LEDGER_FILE}` }
}

describe('unit-summarize-stockfix', function() {

    before(() => {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
        setConceptFold(FOLD)
    })
    after(() => {
        setConceptFold(null) // 模組級單例,不留給同一行程之他檔
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ══════════════════════════ 預演 → 套用 → 回退(移植 232、247 之筆記部分)══════════════════════════
    describe('預演 → 套用 → 回退', function() {

        it('planNoteStockFix:逐篇列出(n1 SS3、n2 SS11、n3 SS2＋SS6);修不了者(缺內容類型)另列;SS6 改分群列 conceptKeys;只預演不寫任何東西', async () => {
            const e = env()
            const before = fs.readFileSync(e.file('n1'), 'utf8')
            const plan = await planNoteStockFix(e.deps, {})
            assert.deepEqual(plan.items.map((x) => [x.id, [...x.stds].sort().join('+')]).sort(), [['n1', 'SS3'], ['n2', 'SS11'], ['n3', 'SS2+SS6']].sort(), JSON.stringify(plan.items.map((x) => x.changes)))
            assert.ok(plan.items.every((x) => x.object === 'note'))
            assert.deepEqual(plan.unfixable.map((u) => [u.id, u.std]), [['n1', 'SS2'], ['n2', 'SS2'], ['n4', 'SS2']], '缺內容類型須判讀,不在確定性修正之列')
            assert.match(plan.unfixable[0].detail, /內容類型「」不在清單/)
            // SS6 本就改分群:受影響之分群鍵交呼叫端(以概念分群之下游據以列出受影響之產物;此處 n3 得到「波動率」之鍵,即核心 k1 之鍵)
            const n3 = plan.items.find((x) => x.id === 'n3')
            assert.ok(n3.conceptKeys.added.includes(normalizeConcept('波動率')), JSON.stringify(n3.conceptKeys))
            assert.ok(n3.conceptKeys.removed.includes(normalizeConcept('波動率(730)')))
            assert.deepEqual([plan.items.find((x) => x.id === 'n1').consumed, n3.consumed], [true, false])
            assert.deepEqual(plan.counts, { violations: { SS2: 4, SS3: 1, SS4: 0, SS6: 1, SS11: 1 }, items: 3, unfixable: 3, fixes: { SS3: 1, SS11: 1, SS2: 1, SS6: 1 } })
            assert.equal(fs.readFileSync(e.file('n1'), 'utf8'), before, '預演不寫')
            assert.equal(fs.existsSync(e.deps.dirs.state), false)
            assert.deepEqual(await e.holds.select(), [], '預演不登錄待判')
        })

        it('SS3 之概念轉正體會改分群鍵者:預演照列可修之部分(標題),該概念列於 skipped 且該篇之 SS3 列為修不了(殘餘;詳情為不改之理由);套用後登錄待判、重掃仍不合格者＝修不了者(呼叫端之回退判準據此)', async () => {
            // 規則:有修正而仍有殘留者亦列為修不了(standards/stockFix 檔頭);「市场」轉「市場」而測試之折疊只摺風／險 → 分群鍵改變 → 不改
            const e = env({ more: [['n5', { title: '市场微结构', concepts: ['市场', '丁概念'], evidence_level: '中' }, bodyOf({ title: '市场微结构' })]] })
            // 與 CLI 同範圍(不限 ids):n1 之 SS3 全修得了(风险 → 風險 同鍵)、n5 有殘餘
            const plan = await planNoteStockFix(e.deps, { stds: ['SS3'] })
            const it5 = plan.items.find((x) => x.id === 'n5')
            assert.ok(it5 && it5.changes.some((c) => c.std === 'SS3' && /標題/.test(c.what)), JSON.stringify(plan.items))
            assert.deepEqual([it5.skipped.map((s) => s.std), plan.items.find((x) => x.id === 'n1').skipped], [['SS3'], []])
            assert.deepEqual(plan.unfixable.map((u) => [u.id, u.std]), [['n5', 'SS3']], '殘餘列為修不了(此前只看有無修正:殘餘不列,套用後重掃之不合格即多於修不了,呼叫端誤判須回退)')
            assert.match(plan.unfixable[0].detail, /概念「市场」轉正體會改分群鍵/)
            assert.deepEqual(plan.counts, { violations: { SS3: 2 }, items: 2, unfixable: 1, fixes: { SS3: 2 } })
            const r = await applyNoteStockFix(e.deps, plan, { at: AT })
            assert.deepEqual([r.errors, r.counts.held, (await e.notes.get('n5')).concepts], [[], 1, ['市场', '丁概念']], '概念不改、登錄待判')
            assert.equal(readMd(e.file('n5')).front.title, '市場微結構', '可修之部分照修')
            const S = (await auditSummarizeStandards({ stores: e.deps.stores, vocab: VOCAB }, { only: ['SS3'] })).standards
            assert.equal(S.SS3.violation, plan.unfixable.length, '套用後仍不合格者(n5)＝修不了者;呼叫端之回退判準「不合格多於修不了」不成立')
            assert.deepEqual(S.SS3.violations.map((v) => v.id), ['n5'])
        })

        it('applyNoteStockFix:md 與記錄同步(syncHash 重算、不寫 knowledgeChangedAt、stdFixes 留痕);修不了者登錄待判;處置帳;回傳連鎖資訊;重跑預演為 0;回退全數還原', async () => {
            const e = env()
            const raw0 = Object.fromEntries(['n1', 'n2', 'n3'].map((id) => [id, fs.readFileSync(e.file(id), 'utf8')]))
            const md0 = readMd(e.file('n1'))
            const plan = await planNoteStockFix(e.deps, {})
            const r = await applyNoteStockFix(e.deps, plan, { at: AT })
            assert.deepEqual([r.errors, r.stale], [[], []])
            assert.deepEqual(Object.keys(r.counts).sort(), ['SS11', 'SS2', 'SS3', 'SS6', 'held'])
            // 修不了者逐筆登錄待判(使用者):件數＝預演之 unfixable
            assert.equal(r.counts.held, plan.unfixable.length)
            const heldRows = (await e.holds.select()).filter((h) => /^存量修不了/.test(h.reason))
            assert.ok(heldRows.length === plan.unfixable.length && heldRows.every((h) => h.owner === 'user' && h.status === 'open'), JSON.stringify(heldRows.map((h) => h.id)))
            assert.deepEqual(r.held.map((h) => h.key), plan.unfixable.map((u) => holdKey('note', u.id, u.std)))
            for (const h of heldRows) assert.deepEqual([h.object, h.next, h.deadline], ['note', NOTE_HOLD_NEXT, noteHoldDeadlineOf(AT)], '下一步同筆記同步入口之待判、期限同一常數')
            // 筆記 n1:md 與記錄
            const md1 = readMd(e.file('n1'))
            const n1 = await e.notes.get('n1')
            assert.deepEqual([md1.front.title, n1.title, n1.concepts, n1.summary], ['動量因子之風險', '動量因子之風險', ['風險', '動量'], '動量策略之風險來源'])
            assert.equal(n1.syncHash, syncHashOf(syncFieldsOf(md1)), 'syncHash 依新 md 重算(下輪同步不報內容變更)')
            assert.equal(n1.knowledgeChangedAt, undefined, '不寫 knowledgeChangedAt(不觸發下游重判)')
            assert.ok(n1.stdFixes.some((x) => /^存量 SS3/.test(x)), JSON.stringify(n1.stdFixes))
            assert.ok(md1.body.includes('[[简体-slug-1]]') && md1.body.includes('https://example.com/风险') && md1.body.includes('原文标题保持简体'))
            // 連鎖資訊(原實作於此處直接重投鄰篇、列重設基準名單——屬下游,改由回傳交呼叫端)
            const ap = Object.fromEntries(r.applied.map((x) => [x.id, x]))
            assert.deepEqual(Object.keys(ap).sort(), ['n1', 'n2', 'n3'])
            assert.deepEqual([ap.n1.titleChanged, ap.n1.contentChanged, ap.n1.consumed], [true, true, true], 'n1 標題有變且已有下游處理時刻 → 呼叫端須更新顯示其標題之投影、重設基準')
            assert.deepEqual([ap.n2.titleChanged, ap.n2.consumed], [false, false])
            assert.ok(ap.n3.conceptKeys.added.includes(normalizeConcept('波動率')))
            // n2 證據等級、n3 概念
            assert.deepEqual([(await e.notes.get('n2')).evidenceLevel, readMd(e.file('n2')).front.evidence_level], ['中', '中'])
            assert.deepEqual((await e.notes.get('n3')).concepts, ['波動率', '主動推論', 'a', 'b', 'c', 'd'])
            // 處置帳:筆記 3、修不了之待判
            const rows = readNoteStockLedger(e.ledger)
            assert.equal(rows.length, 3 + plan.unfixable.length, rows.map((x) => `${x.object}:${x.id}`).join(','))
            assert.deepEqual(r.ledger, rows, '回傳之帳列＝落檔之帳列')
            // 筆記列帶連鎖旗標(同套用之回傳;他工作驗連鎖時讀之,不必解讀 changes 之字樣)
            for (const row of rows.filter((x) => x.object === 'note')) assert.deepEqual([row.titleChanged, row.contentChanged], [ap[row.id].titleChanged, ap[row.id].contentChanged], row.id)
            assert.equal(path.resolve(r.ledgerFile), path.resolve(e.ledger), '預設為 dirs.state 下之 stock-fix.jsonl')
            // 重跑預演:已修者不再列;重掃:已修之標準合格(修不了者已在待判,仍計違反)
            const again = await planNoteStockFix(e.deps, { stds: ['SS3', 'SS6', 'SS11'] })
            assert.deepEqual(again.items, [], JSON.stringify(again.items))
            const S = (await auditSummarizeStandards({ stores: e.deps.stores, vocab: VOCAB })).standards
            assert.deepEqual([S.SS3.violation, S.SS6.violation, S.SS11.violation, ids(S.SS2.violations)], [0, 0, 0, ['n1', 'n2', 'n3', 'n4']])
            // n3 之 SS2 本輪有確定性修正(刪壞行、截概念)而仍缺內容類型:同原實作,有修正之標準本輪不列修不了;下一次預演即列入(無可修 → 修不了)
            assert.deepEqual((await planNoteStockFix(e.deps, {})).unfixable.map((u) => [u.id, u.std]), [['n1', 'SS2'], ['n2', 'SS2'], ['n3', 'SS2'], ['n4', 'SS2']])
            // 連鎖斷言
            assert.deepEqual(await verifyNoteStockChain(e.deps, rows), { checked: rows.length, problems: [] })
            // 回退:md 逐字還原、記錄欄位、修不了之待判結案;已回退者不再列
            const rb = await rollbackNoteStockFix(e.deps, rows, { at: '2026-10-05T05:00:00+08:00' })
            assert.deepEqual([rb.restored, rb.errors], [rows.length, []])
            for (const id of ['n1', 'n2', 'n3']) assert.equal(fs.readFileSync(e.file(id), 'utf8'), raw0[id], `${id} md 逐字還原`)
            const mdB = readMd(e.file('n1'))
            assert.deepEqual(['title', 'concepts', 'sample_period', 'caveats'].map((k) => mdB.front[k]), ['title', 'concepts', 'sample_period', 'caveats'].map((k) => md0.front[k]))
            assert.equal(noteContentText(mdB.body), noteContentText(md0.body))
            assert.deepEqual([(await e.notes.get('n1')).title, Object.hasOwn(await e.notes.get('n1'), 'stdFixes')], ['动量因子之风险', false], '處置前不存在之 stdFixes 刪除(不留 null)')
            assert.deepEqual((await e.notes.get('n3')).concepts, ['波動率(730)', '主動推論(Active Inference)', 'a', 'b', 'c', 'd', 'e'])
            for (const h of heldRows) assert.equal((await e.holds.get(h.id)).status, 'resolved', '回退:修不了之待判結案')
            assert.deepEqual(rb.notes.map((x) => [x.id, x.titleChanged, x.consumed]).sort(), [['n1', true, true], ['n2', false, false], ['n3', false, false]])
            assert.deepEqual(readNoteStockLedger(e.ledger), [], '已回退者不再列')
        })
    })

    // ══════════════════════════ 處置帳與連鎖斷言 ══════════════════════════
    describe('處置帳與連鎖斷言', function() {

        it('帳列形狀:筆記列 { at, object, id, stds, changes, titleChanged, contentChanged, body, before:{ kca, consumed, units, record }, after:{ units, record }, file }——只記實際修改之單位(同步欄位不記);待判列 { at, object, id, stds, before:{ hold }, hold }、回退列 { at, rollbackOf, object, id }', async () => {
            const e = env()
            const r = await applyNoteStockFix(e.deps, await planNoteStockFix(e.deps, {}), { at: AT })
            const note = r.ledger.find((x) => x.object === 'note' && x.id === 'n1')
            assert.deepEqual(Object.keys(note), ['at', 'object', 'id', 'stds', 'changes', 'titleChanged', 'contentChanged', 'body', 'before', 'after', 'file'])
            assert.deepEqual([Object.keys(note.before), Object.keys(note.after)], [['kca', 'consumed', 'units', 'record'], ['units', 'record']])
            assert.deepEqual([note.at, note.stds, note.file, note.before.kca, note.before.consumed, note.body], [AT, ['SS3'], e.file('n1'), null, true, 'parts'])
            assert.ok(note.changes.every((c) => c.std === 'SS3' && typeof c.what === 'string'))
            assert.deepEqual([note.before.units['front:title'], note.after.units['front:title']], ['动量因子之风险', '動量因子之風險'])
            assert.ok(!('section:來源#0' in note.after.units), '未修改之段不記(來源章之原文標題保持簡體)')
            // 產出鏈(stores/noteProduced):處置寫 standards-fix 之 produced——記錄三欄與 md 之純量鍵(不呼叫 AI、stamp 為 null → 只有 produced_stage)為處置新增之單位,
            //   處置前不存在(不列於 before;回退時刪除)。修法本身(內容章、標題等)仍不增刪單位
            const fixUnits = Object.keys(note.after.units).filter((u) => !u.startsWith('front:produced_'))
            assert.ok(fixUnits.every((u) => u in note.before.units), '修法不增刪單位')
            assert.deepEqual(Object.keys(note.after.units).filter((u) => u.startsWith('front:produced_')), ['front:produced_stage'])
            assert.deepEqual(['produced', 'producedHistory', 'producedHistoryDropped'].filter((k) => k in note.after.record && !(k in note.before.record)), ['produced', 'producedHistory', 'producedHistoryDropped'])
            assert.deepEqual(['title', 'concepts', 'summary', 'syncHash'].filter((k) => k in note.after.record), [], '同步欄位不記(回退時以 md 重算)')
            assert.ok('stdFixes' in note.after.record && !('stdFixes' in note.before.record), '處置前不存在之 stdFixes 不列於 before(回退時刪除)')
            const hold = r.ledger.find((x) => x.object === 'hold')
            assert.deepEqual(Object.keys(hold), ['at', 'object', 'id', 'stds', 'before', 'hold'])
            assert.deepEqual([hold.id, hold.hold, hold.before], [holdKey('note', 'n1', 'SS2'), holdKey('note', 'n1', 'SS2'), { hold: null }])
            const rb = await rollbackNoteStockFix(e.deps, r.ledger, { at: '2026-10-05T06:00:00+08:00' })
            assert.equal(rb.errors.length, 0)
            const lines = fs.readFileSync(e.ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
            const back = lines.filter((x) => x.rollbackOf)
            assert.equal(back.length, r.ledger.length)
            assert.deepEqual(Object.keys(back[0]), ['at', 'rollbackOf', 'object', 'id'])
            assert.deepEqual([back[0].at, back[0].rollbackOf], ['2026-10-05T06:00:00+08:00', AT])
        })

        it('處置帳之位置:opt.ledgerFile 優先(預設位置不建);未給為 dirs.state 下之 stock-fix.jsonl;兩者皆無 → 套用與回退皆拋(預演不需帳)', async () => {
            const e = env()
            const plan = await planNoteStockFix(e.deps, {})
            const own = `${e.dir}/own/ledger.jsonl`
            const r = await applyNoteStockFix(e.deps, plan, { at: AT, ledgerFile: own })
            assert.deepEqual([r.ledgerFile, readNoteStockLedger(own).length > 0, fs.existsSync(e.ledger)], [own, true, false])
            const noDirs = { ...e.deps, dirs: {} }
            await assert.rejects(() => applyNoteStockFix(noDirs, plan), /需要處置帳之路徑/)
            await assert.rejects(() => rollbackNoteStockFix(noDirs, readNoteStockLedger(own)), /需要處置帳之路徑/)
            assert.ok((await planNoteStockFix(noDirs, {})).items.length >= 0, '預演不需帳')
        })

        it('連鎖斷言:套用後無問題;記錄之 syncHash 與 md 不符、knowledgeChangedAt 被寫、待判不在 → 逐一列出;他模組之列略過', async () => {
            const e = env()
            const r = await applyNoteStockFix(e.deps, await planNoteStockFix(e.deps, {}), { at: AT })
            const rows = [...r.ledger, { at: AT, object: 'edge', id: 'e1', stds: ['RS3'], before: {} }]
            assert.deepEqual(await verifyNoteStockChain(e.deps, rows), { checked: r.ledger.length, problems: [] })
            await e.notes.patch('n1', { syncHash: 'x' })
            await e.notes.patch('n2', { knowledgeChangedAt: '2026-10-05T07:00:00+08:00' })
            await e.holds.del(holdKey('note', 'n4', 'SS2'))
            const v = await verifyNoteStockChain(e.deps, rows)
            assert.equal(v.problems.length, 3, v.problems.join('\n'))
            assert.match(v.problems.join('\n'), /筆記 n1：syncHash 與現行 md 不符/)
            assert.match(v.problems.join('\n'), /筆記 n2：knowledgeChangedAt 被寫（無 → 2026-10-05T07:00:00\+08:00）/)
            assert.match(v.problems.join('\n'), /待判 note:n4:SS2：未登錄/)
        })

        it('讀帳:只取本模組之列(筆記列與筆記之待判列;他模組之列如邊、文件、領域、邊之待判略過)、壞行即拋(allowBad 才略過)、since／at 篩選、已回退者排除;檔案不存在回空陣列', () => {
            const dir = `${TMP}/ledger${++seq}`
            fs.mkdirSync(dir, { recursive: true })
            const f = `${dir}/stock-fix.jsonl`
            const L = [
                { at: 't1', object: 'note', id: 'n1', stds: ['SS3'], changes: [], before: { md: '', record: {}, kca: null, consumed: false }, file: 'x' },
                { at: 't1', object: 'hold', id: 'note:n2:SS2', stds: ['SS2'], before: {}, hold: 'note:n2:SS2' },
                { at: 't1', object: 'edge', id: 'e1', stds: ['RS3'], before: {} },
                { at: 't1', object: 'doc', id: 'd1', stds: ['CS10'], before: {} },
                { at: 't1', object: 'hold', id: 'edge:e2:RS2', stds: ['RS2'], before: {}, hold: 'edge:e2:RS2' },
                { at: 't1', object: 'note-deleted', id: 'n9', stds: ['CS10'], before: {} },
                { at: 't2', object: 'note', id: 'n3', stds: ['SS6'], changes: [], before: { md: '', record: {}, kca: null, consumed: false }, file: 'y' },
                { at: 't3', object: 'note', id: 'n4', stds: ['SS11'], changes: [], before: { md: '', record: {}, kca: null, consumed: false }, file: 'z' },
                { at: 't4', rollbackOf: 't3', object: 'note', id: 'n4' },
            ]
            fs.writeFileSync(f, `${L.slice(0, 3).map((x) => JSON.stringify(x)).join('\n')}\n{壞行\n${L.slice(3).map((x) => JSON.stringify(x)).join('\n')}\n`, 'utf8')
            assert.throws(() => readNoteStockLedger(f), /有 1 行無法解析（第 4 行：/)
            assert.deepEqual(readNoteStockLedger(f, { allowBad: true }).map((x) => `${x.object}:${x.id}`), ['note:n1', 'hold:note:n2:SS2', 'note:n3'])
            fs.writeFileSync(f, `${L.map((x) => JSON.stringify(x)).join('\n')}\n`, 'utf8')
            assert.deepEqual(readNoteStockLedger(f).map((x) => `${x.object}:${x.id}`), ['note:n1', 'hold:note:n2:SS2', 'note:n3'])
            assert.deepEqual(readNoteStockLedger(f, { since: 't2' }).map((x) => x.id), ['n3'])
            assert.deepEqual(readNoteStockLedger(f, { at: 't1' }).map((x) => x.id), ['n1', 'note:n2:SS2'])
            assert.deepEqual(readNoteStockLedger(`${dir}/none.jsonl`), [])
            assert.deepEqual(readNoteStockLedger(undefined), [])
        })
    })

    // ══════════════════════════ 修不了、重算、回退之邊界 ══════════════════════════
    describe('修不了、重算、回退之邊界', function() {

        it('修不了:有修正而仍有殘留之 SS6(擠標籤有段非既有概念)與全無修正之 SS2(缺一句話重點)列修不了;已有未結或已豁免之同鍵登錄者不重登(列 alreadyHeld);未開 holds 集合 → errors(不靜默)', async () => {
            const more = [
                ['n6', { title: '己', concepts: ['丁丁(730)', '甲甲, 乙乙'], evidence_level: '中', claim_type: '實證研究' }, bodyOf({ title: '己' })],
                ['n7', { title: '庚', concepts: ['庚概念', '辛概念'], evidence_level: '中', claim_type: '實證研究' }, bodyOf({ title: '庚', summary: '' })],
            ]
            const e = env({ more })
            const plan = await planNoteStockFix(e.deps, { ids: ['n6', 'n7'] })
            assert.deepEqual(plan.items.map((x) => [x.id, x.stds]), [['n6', ['SS6']]], '尾碼已去,擠標籤未拆')
            assert.deepEqual(plan.unfixable.map((u) => [u.id, u.std]), [['n7', 'SS2'], ['n6', 'SS6']])
            await e.holds.replace({ id: holdKey('note', 'n7', 'SS2'), object: 'note', oid: 'n7', std: 'SS2', status: 'waived', reason: 'r', next: 'n' })
            const r = await applyNoteStockFix(e.deps, plan, { at: AT })
            assert.deepEqual([r.held.map((h) => h.key), r.alreadyHeld, r.errors], [[holdKey('note', 'n6', 'SS6')], [holdKey('note', 'n7', 'SS2')], []])
            assert.equal((await e.holds.get(holdKey('note', 'n7', 'SS2'))).status, 'waived', '已豁免者不被改寫')
            assert.deepEqual(readMd(e.file('n6')).front.concepts, ['丁丁', '甲甲, 乙乙'])
            // 未開 holds 集合
            const e2 = env({ more, noHolds: true })
            const r2 = await applyNoteStockFix(e2.deps, await planNoteStockFix(e2.deps, { ids: ['n6', 'n7'] }), { at: AT })
            assert.deepEqual(r2.errors.map((x) => [x.id, x.object]), [['n7', 'note'], ['n6', 'note']])
            assert.ok(r2.errors.every((x) => /未開 holds 集合，修不了之存量未登錄待判/.test(x.error)))
            assert.deepEqual(r2.applied.map((x) => x.id), ['n6'], '修得了者照修')
        })

        it('逐篇以現值重算:同一計畫套用兩次 → 第二次全列 stale、不寫帳;預演後 md 已被改好者列 stale;記錄或 md 不在者列 errors', async () => {
            const e = env()
            const plan = await planNoteStockFix(e.deps, { stds: ['SS3', 'SS6', 'SS11'] })
            const first = await applyNoteStockFix(e.deps, plan, { at: AT })
            assert.deepEqual(first.applied.map((x) => x.id).sort(), ['n1', 'n2', 'n3'])
            const second = await applyNoteStockFix(e.deps, plan, { at: '2026-10-05T05:00:00+08:00' })
            assert.deepEqual([second.applied, second.stale.sort(), second.ledger], [[], ['n1', 'n2', 'n3'], []])
            const e2 = env()
            const plan2 = await planNoteStockFix(e2.deps, { stds: ['SS3', 'SS11'] })
            const md = readMd(e2.file('n2'))
            writeMd(e2.file('n2'), { ...md.front, evidence_level: '中' }, md.body) // 使用者已改
            await e2.notes.del('n1')
            const r = await applyNoteStockFix(e2.deps, plan2, { at: AT })
            assert.deepEqual([r.stale, r.errors.map((x) => [x.id, x.error])], [['n2'], [['n1', '記錄或 md 讀不到']]])
        })

        it('回退:筆記記錄已不在者為衝突(不寫回 md、不附回退列;非錯誤);使用者其後已豁免之待判不被回退改寫;回退後重讀帳只剩未回退者', async () => {
            const e = env()
            const r = await applyNoteStockFix(e.deps, await planNoteStockFix(e.deps, {}), { at: AT })
            const fixed = fs.readFileSync(e.file('n2'), 'utf8')
            await e.notes.del('n2')
            await e.holds.patch(holdKey('note', 'n4', 'SS2'), { status: 'waived', waivedBy: '使用者', ruling: '確認維持' })
            const rb = await rollbackNoteStockFix(e.deps, readNoteStockLedger(e.ledger), { at: '2026-10-05T05:00:00+08:00' })
            assert.deepEqual([rb.errors, rb.conflicts], [[], [{ id: 'n2', object: 'note', units: ['（記錄不在）'] }]])
            assert.equal(fs.readFileSync(e.file('n2'), 'utf8'), fixed, '不寫回 md')
            assert.equal((await e.holds.get(holdKey('note', 'n4', 'SS2'))).status, 'waived', '使用者之裁示不被回退改寫')
            assert.equal((await e.holds.get(holdKey('note', 'n1', 'SS2'))).status, 'resolved')
            assert.equal(rb.restored, r.ledger.length - 1)
            assert.deepEqual(readNoteStockLedger(e.ledger).map((x) => `${x.object}:${x.id}`), ['note:n2'], '只剩未回退者')
        })

        it('手寫之筆記列可讀並回退(回傳之 titleChanged 取帳列所記,不解讀 changes 之字樣;同步欄位由組回之 md 重算、處置前不存在之鍵刪除);未知形狀(缺單位)列 errors', async () => {
            const e = env()
            const raw = fs.readFileSync(e.file('n4'), 'utf8')
            writeMd(e.file('n4'), { ...readMd(e.file('n4')).front, title: '丁（他處改）' }, readMd(e.file('n4')).body)
            await e.notes.patch('n4', { title: '丁（他處改）', stdFixes: ['存量 SS3：x'] })
            fs.mkdirSync(path.dirname(e.ledger), { recursive: true })
            const row = {
                at: '2026-10-04T00:00:00+08:00', object: 'note', id: 'n4', stds: ['SS3'], changes: [{ std: 'SS3', what: '內容章轉正體' }], titleChanged: true, contentChanged: false, body: 'parts',
                before: { kca: null, consumed: false, units: { 'front:title': '丁' }, record: {} }, after: { units: { 'front:title': '丁（他處改）' }, record: { stdFixes: ['存量 SS3：x'] } }, file: e.file('n4'),
            }
            const bad = { at: '2026-10-04T00:00:00+08:00', object: 'note', id: 'n2', stds: ['SS11'], changes: [], before: { kca: null, consumed: false } }
            fs.writeFileSync(e.ledger, `${JSON.stringify(row)}\n${JSON.stringify(bad)}\n`, 'utf8')
            const rows = readNoteStockLedger(e.ledger)
            assert.equal(rows.length, 2)
            const rb = await rollbackNoteStockFix(e.deps, rows)
            assert.deepEqual([rb.restored, rb.errors.map((x) => x.id)], [1, ['n2']])
            assert.match(rb.errors[0].error, /帳列缺 before／after 之單位（units、record），無從判定其後是否被改動/)
            assert.equal(fs.readFileSync(e.file('n4'), 'utf8'), raw)
            const n4 = await e.notes.get('n4')
            assert.deepEqual([n4.title, Object.hasOwn(n4, 'stdFixes')], ['丁', false])
            assert.deepEqual(rb.notes, [{ id: 'n4', titleChanged: true, consumed: false }])
        })

        it('回退防護(摘要 D2):只還原該次處置改過之單位——下游投影章、使用者新增之章與鍵不動;其後被改動之單位不覆寫並報衝突(餘者照回、不記回退列);acceptCurrent 記取代列;冪等', async () => {
            const e = env()
            const r = await applyNoteStockFix(e.deps, await planNoteStockFix(e.deps, { ids: ['n1'] }), { at: AT })
            assert.deepEqual(r.applied.map((x) => x.id), ['n1'])
            // 其後:下游投影加「關聯」章、使用者新增一章與一鍵、使用者改一句話重點(該次處置改過之單位)
            const md = readMd(e.file('n1'))
            const body = md.body.replace('\n## 核心知識', '\n## 使用者之補充\n\n- 自己加的\n\n## 核心知識').replace(/\n*$/, '\n\n## 關聯\n\n- [互補搭配] → [[n4]] 丁：理由\n')
            const summary = md.body.match(/## 一句話重點\n\n([^\n]*)/)[1]
            writeMd(e.file('n1'), { ...md.front, user_key: '使用者之鍵' }, body.replace(`## 一句話重點\n\n${summary}`, '## 一句話重點\n\n使用者重寫之重點'))
            const rows = readNoteStockLedger(e.ledger).filter((x) => x.object === 'note')
            const rb = await rollbackNoteStockFix(e.deps, rows, { at: 'T9' })
            assert.deepEqual([rb.errors, rb.conflicts], [[], [{ id: 'n1', object: 'note', units: ['section:一句話重點#0'] }]])
            const back = readMd(e.file('n1'))
            assert.deepEqual([back.front.title, back.front.user_key], ['动量因子之风险', '使用者之鍵'], '處置改過之 front 還原、使用者之鍵不動')
            assert.ok(back.body.includes('## 使用者之補充\n\n- 自己加的') && back.body.includes('## 關聯\n\n- [互補搭配] → [[n4]]'), '使用者新章與下游投影章不動')
            assert.ok(back.body.includes('使用者重寫之重點'), '其後被改動之單位不覆寫')
            assert.ok(back.body.includes('风险随市况变化'), '未衝突之單位照回(核心知識回到處置前)')
            const n1 = await e.notes.get('n1')
            assert.deepEqual([n1.title, n1.syncHash], ['动量因子之风险', syncHashOf(syncFieldsOf(back))], '同步欄位以組回之 md 重算')
            assert.equal(readNoteStockLedger(e.ledger).filter((x) => x.object === 'note').length, 1, '有衝突之列仍列於帳')
            const again = await rollbackNoteStockFix(e.deps, rows, { at: 'T10' })
            assert.deepEqual([again.errors, again.conflicts.map((c) => c.units)], [[], [['section:一句話重點#0']]], '冪等:已回之單位為已完成,衝突照報')
            const ac = await rollbackNoteStockFix(e.deps, readNoteStockLedger(e.ledger).filter((x) => x.object === 'note'), { at: 'T11', acceptCurrent: true })
            assert.deepEqual([ac.accepted, ac.conflicts, readNoteStockLedger(e.ledger).filter((x) => x.object === 'note')], [1, [], []], '接受現值:取代列使之不再列')
            assert.ok(readMd(e.file('n1')).body.includes('使用者重寫之重點'))
        })
    })

    // ══════════════════════════ 選項:SS4 之材料、範圍、上限、改名鍵 ══════════════════════════
    describe('選項:SS4 之材料、範圍、上限、改名鍵', function() {

        it('SS4:有原文者移除含原文沒有之數字之清單行(套用後重掃合格);一句話重點有之者修不了;material:false 不處置 SS4', async () => {
            const MAT = '台股動量策略年化超額 8.2%,回看期 12 個月,樣本 2000-2020。'
            const more = [
                ['s1', { title: '動量之實證', concepts: ['動量因子', '交易成本'], evidence_level: '中', claim_type: '實證研究' }, bodyOf({ title: '動量之實證', summary: '台股動量策略有超額報酬', points: ['- 年化超額 8.2%', '- 夏普比率 1.9'] }), { docId: 'ds1' }],
                ['s2', { title: '動量二', concepts: ['動量因子', '交易成本'], evidence_level: '中', claim_type: '實證研究' }, bodyOf({ title: '動量二', summary: '台股動量年化 15% 超額', points: ['- 年化超額 8.2%'] }), { docId: 'ds2' }],
            ]
            const e = env({ more })
            const docTexts = memStore()
            for (const id of ['ds1', 'ds2']) await archiveDocText(docTexts, { id, title: '原文標題', text: MAT, status: 'noted' }, AT)
            Object.assign(e.deps.stores, { docs: memStore([]), docTexts })
            const off = await planNoteStockFix(e.deps, { stds: ['SS4'], material: false })
            assert.deepEqual([off.items, off.unfixable, off.counts.violations.SS4], [[], [], 0], 'material:false:SS4 未能判定,不處置')
            const plan = await planNoteStockFix(e.deps, { stds: ['SS4'] })
            assert.deepEqual([plan.items.map((x) => x.id), plan.unfixable.map((u) => [u.id, u.std])], [['s1'], [['s2', 'SS4']]])
            const r = await applyNoteStockFix(e.deps, plan, { at: AT })
            assert.deepEqual([r.errors, r.applied.map((x) => x.id), r.held.map((h) => h.key)], [[], ['s1'], [holdKey('note', 's2', 'SS4')]])
            const body = readMd(e.file('s1')).body
            assert.ok(body.includes('- 年化超額 8.2%') && !body.includes('夏普比率 1.9'), body)
            const S4 = (await auditSummarizeStandards({ stores: e.deps.stores, vocab: VOCAB }, { only: ['SS4'] })).standards.SS4
            assert.deepEqual([ids(S4.violations), S4.waived], [['s2'], 0], 's1 修後合格;s2 仍違反(已入待判,未豁免)')
        })

        it('範圍與上限:stds 只處置所列標準(其他 id 略過;與關聯、提煉同名);ids 只處置所列筆記;limit 為每種修正之標準組合至多幾篇(修不了者照列)', async () => {
            const more = [
                ['m1', { title: '风甲', concepts: ['甲概念', '乙概念'], evidence_level: '中', claim_type: '實證研究' }, bodyOf({ title: '风甲' })],
                ['m2', { title: '风乙', concepts: ['甲概念', '乙概念'], evidence_level: '中', claim_type: '實證研究' }, bodyOf({ title: '风乙' })],
            ]
            const e = env({ more })
            const only3 = await planNoteStockFix(e.deps, { stds: ['SS3', 'SS5', 'XX'] })
            assert.deepEqual([only3.stds, only3.items.map((x) => x.id).sort()], [['SS3'], ['m1', 'm2', 'n1']])
            assert.deepEqual((await planNoteStockFix(e.deps, { ids: ['n2'] })).items.map((x) => x.id), ['n2'])
            const lim = await planNoteStockFix(e.deps, { limit: 1 })
            assert.deepEqual(lim.items.map((x) => [x.id, [...x.stds].sort().join('+')]), [['n1', 'SS3'], ['n2', 'SS11'], ['n3', 'SS2+SS6']], '同為 SS3 之 m1、m2 不列;其他組合各一篇')
            assert.deepEqual(lim.unfixable.map((u) => u.id), (await planNoteStockFix(e.deps, {})).unfixable.map((u) => u.id), '修不了者照列')
            const none = await planNoteStockFix(e.deps, { stds: ['SS5'] })
            assert.deepEqual([none.stds, none.items, none.counts.items], [[], [], 0])
        })

        it('renameKeysObsolete:詞彙表 conceptRenames 中之多概念鍵(SS6 在範圍內才列);預演與套用皆回傳', async () => {
            const vocab = resolveSummarizeVocab({ evidenceLevels: ['高', '中', '低'], claimTypes: ['實證研究', '觀點評論'], conceptRenames: { '甲概念、乙概念': '甲概念', '舊名': '新名' } })
            assert.deepEqual(renameKeysObsoleteOf(vocab), ['甲概念、乙概念'])
            assert.deepEqual([renameKeysObsoleteOf(undefined), renameKeysObsoleteOf(null)], [[], []])
            const e = env()
            e.deps.vocab = vocab
            const plan = await planNoteStockFix(e.deps, {})
            assert.deepEqual(plan.renameKeysObsolete, ['甲概念、乙概念'])
            assert.deepEqual((await planNoteStockFix(e.deps, { stds: ['SS3'] })).renameKeysObsolete, [], 'SS6 不在範圍 → 不列')
            const r = await applyNoteStockFix(e.deps, plan, { at: AT })
            assert.deepEqual(r.renameKeysObsolete, ['甲概念、乙概念'])
        })

        it('設定之容錯與檢核:缺筆記集合(或其方法)即拋;詞彙未經本套件解析即拋;opt 非物件 → 預設;計畫非物件 → 不處置', async () => {
            const e = env()
            await assert.rejects(() => planNoteStockFix({ stores: {} }), /需要 deps\.stores\.notes/)
            await assert.rejects(() => applyNoteStockFix({ stores: { notes: { get: async () => null } } }, {}), /需要 deps\.stores\.notes/)
            await assert.rejects(() => rollbackNoteStockFix({}, []), /需要 deps\.stores\.notes/)
            await assert.rejects(() => verifyNoteStockChain(undefined, []), /需要 deps\.stores\.notes/)
            await assert.rejects(() => planNoteStockFix({ ...e.deps, vocab: { evidenceLevels: ['高'] } }), /須為 resolveSummarizeVocab 之產物/)
            await assert.rejects(() => applyNoteStockFix({ ...e.deps, vocab: JSON.parse(JSON.stringify(VOCAB)) }, {}), /須為 resolveSummarizeVocab 之產物/)
            assert.equal((await planNoteStockFix(e.deps, 'x')).items.length, 3)
            const r = await applyNoteStockFix(e.deps, null, { at: AT })
            assert.deepEqual([r.applied, r.held, r.errors, r.ledger], [[], [], [], []])
        })
    })

    // ══════════════════════════ 真 LMDB ══════════════════════════
    describe('真 LMDB', function() {

        it('筆記與待判在 LMDB 集合:陣列欄(概念、限制、stdFixes)變短須真正寫回(集合 patch 為深合併——先清後寫);回退後陣列逐項還原;連鎖斷言無問題', async () => {
            const lm = {}
            const e = env({
                notes: (rows) => {
                    lm.notes = W.openCollection({ WOrm, path: `${TMP}/lmdb${seq}/db`, db: 'knowledge', cl: 'notes' })
                    lm.rows = rows
                    return lm.notes
                },
                holds: (lm.holds = W.openCollection({ WOrm, path: `${TMP}/lmdb-h${seq}/db`, db: 'knowledge', cl: 'holds' })),
            })
            try {
                await lm.notes.insertNew(lm.rows)
                const plan = await planNoteStockFix(e.deps, {})
                const r = await applyNoteStockFix(e.deps, plan, { at: AT })
                assert.deepEqual(r.errors, [])
                assert.deepEqual((await lm.notes.get('n3')).concepts, ['波動率', '主動推論', 'a', 'b', 'c', 'd'], '7 → 6 不殘留舊尾項')
                assert.deepEqual((await lm.notes.get('n1')).caveats, ['樣本有限'])
                assert.equal((await lm.holds.get(holdKey('note', 'n4', 'SS2'))).status, 'open')
                assert.deepEqual(await verifyNoteStockChain(e.deps, r.ledger), { checked: r.ledger.length, problems: [] })
                const rb = await rollbackNoteStockFix(e.deps, readNoteStockLedger(e.ledger), { at: '2026-10-05T05:00:00+08:00' })
                assert.deepEqual(rb.errors, [])
                assert.deepEqual((await lm.notes.get('n3')).concepts, ['波動率(730)', '主動推論(Active Inference)', 'a', 'b', 'c', 'd', 'e'])
                assert.deepEqual([(await lm.notes.get('n1')).caveats, Object.hasOwn(await lm.notes.get('n1'), 'stdFixes')], [['样本有限'], false], '處置前不存在之 stdFixes 刪除(LMDB 集合以 replace 寫整筆)')
                assert.equal((await lm.holds.get(holdKey('note', 'n4', 'SS2'))).status, 'resolved')
            }
            finally {
                await lm.notes?.close()
                await lm.holds?.close()
            }
        })
    })

    // ══════════════════════════ 產出鏈(stores/noteProduced;跨套件之產出鏈規格 §3、§4;使用端需求見 Gitea #107)══════════════════════════
    // 存量處置為確定性修正(stage standards-fix、不呼叫 AI → seat／provider 皆 null;stamp＝opt.stamp,維運呼叫未給＝null):隨處置寫記錄三欄與 md 之純量鍵,
    //   兩者皆為處置所改之單位,入帳列之 before／after——回退時依帳還原(處置前不存在者刪除;處置前已有者還原為原值,含已不在新值中之 promptFp 與縮短之歷史)
    describe('產出鏈', function() {

        const STAMP = '20261108200009'
        const OLD = { v: 1, stamp: '20261107100000', stage: 'summarize', seat: 'summarize.ai', provider: 'x:one', promptFp: '5118f8f40bf0dc40', pkg: 'w-knowledge-summarize@1.0.0', at: '2026-11-07T10:00:00+08:00' }
        const frontProduced = (file) => Object.fromEntries(Object.entries(readMd(file).front).filter(([k]) => k.startsWith('produced')))
        const withOld = (file) => {
            const md = readMd(file)
            writeMd(file, { ...md.front, produced_stamp: OLD.stamp, produced_stage: OLD.stage, produced_provider: OLD.provider }, md.body)
        }
        const OLD_FRONT = { produced_stamp: OLD.stamp, produced_stage: OLD.stage, produced_provider: OLD.provider }

        it('套用:被處置之筆記記錄 produced 為 standards-fix(seat／provider null、stamp＝opt.stamp、at＝處置時刻)、歷史 1 筆;md 帶純量鍵(provider 為 null 省略);未被處置者(n4 合格)不動;回退後三欄刪除(處置前不存在)、md 之鍵移除', async () => {
            const e = env()
            const r = await applyNoteStockFix(e.deps, await planNoteStockFix(e.deps, {}), { at: AT, stamp: STAMP })
            assert.deepEqual(r.errors, [])
            for (const id of ['n1', 'n2', 'n3']) {
                const n = await e.notes.get(id)
                assert.deepEqual(n.produced, { v: 1, stamp: STAMP, stage: 'standards-fix', seat: null, provider: null, pkg: n.produced.pkg, at: AT }, id)
                assert.match(n.produced.pkg, /^w-knowledge-summarize@\d+\.\d+\.\d+/)
                assert.deepEqual([n.producedHistory, n.producedHistoryDropped], [[n.produced], 0], id)
                assert.deepEqual(frontProduced(e.file(id)), { produced_stamp: STAMP, produced_stage: 'standards-fix' }, id)
            }
            const n4 = await e.notes.get('n4')
            assert.deepEqual([Object.hasOwn(n4, 'produced'), Object.keys(frontProduced(e.file('n4')))], [false, []], '未被處置者不動')
            const row = r.ledger.find((x) => x.object === 'note' && x.id === 'n1')
            assert.deepEqual(Object.keys(row.after.units).filter((u) => u.startsWith('front:produced_')), ['front:produced_stamp', 'front:produced_stage'])
            assert.deepEqual(Object.keys(row.after.record).filter((k) => k.startsWith('produced')), ['produced', 'producedHistory', 'producedHistoryDropped'])
            const rb = await rollbackNoteStockFix(e.deps, readNoteStockLedger(e.ledger), { at: '2026-10-05T05:00:00+08:00' })
            assert.deepEqual(rb.errors, [])
            for (const id of ['n1', 'n2', 'n3']) {
                const n = await e.notes.get(id)
                assert.deepEqual(['produced', 'producedHistory', 'producedHistoryDropped'].filter((k) => k in n), [], `${id}:回退後刪除`)
                assert.deepEqual(frontProduced(e.file(id)), {}, id)
            }
        })

        it('未給 opt.stamp(維運呼叫屬輪次外):stamp 為 null、md 省略 produced_stamp', async () => {
            const e = env()
            await applyNoteStockFix(e.deps, await planNoteStockFix(e.deps, {}), { at: AT })
            assert.equal((await e.notes.get('n1')).produced.stamp, null)
            assert.deepEqual(frontProduced(e.file('n1')), { produced_stage: 'standards-fix' })
        })

        it('真 LMDB(集合 patch 為深合併):處置前已有產出鏈(帶 promptFp)者——處置後 produced 不殘留舊 promptFp、歷史 +1;回退後 produced 逐欄還原為原值(含 promptFp)、歷史縮回 1 筆(不殘留處置筆)、md 之三鍵還原;連鎖斷言無問題', async () => {
            const lm = {}
            const e = env({
                notes: (rows) => {
                    lm.notes = W.openCollection({ WOrm, path: `${TMP}/lmdb${seq}/db`, db: 'knowledge', cl: 'notes' })
                    lm.rows = rows
                    return lm.notes
                },
                holds: (lm.holds = W.openCollection({ WOrm, path: `${TMP}/lmdb-h${seq}/db`, db: 'knowledge', cl: 'holds' })),
            })
            try {
                await lm.notes.insertNew(lm.rows)
                await lm.notes.patch('n1', { produced: OLD, producedHistory: [OLD], producedHistoryDropped: 0 })
                withOld(e.file('n1'))
                const r = await applyNoteStockFix(e.deps, await planNoteStockFix(e.deps, {}), { at: AT, stamp: STAMP })
                assert.deepEqual(r.errors, [])
                const n = await lm.notes.get('n1')
                assert.deepEqual(n.produced, { v: 1, stamp: STAMP, stage: 'standards-fix', seat: null, provider: null, pkg: n.produced.pkg, at: AT })
                assert.equal('promptFp' in n.produced, false, '不殘留舊 promptFp')
                assert.deepEqual(n.producedHistory, [OLD, n.produced])
                assert.deepEqual(frontProduced(e.file('n1')), { produced_stamp: STAMP, produced_stage: 'standards-fix' }, 'md 之 produced_provider 移除')
                assert.deepEqual(await verifyNoteStockChain(e.deps, r.ledger), { checked: r.ledger.length, problems: [] })
                const rb = await rollbackNoteStockFix(e.deps, readNoteStockLedger(e.ledger), { at: '2026-10-05T05:00:00+08:00' })
                assert.deepEqual(rb.errors, [])
                const back = await lm.notes.get('n1')
                assert.deepEqual([back.produced, back.producedHistory, back.producedHistoryDropped], [OLD, [OLD], 0], '還原為處置前之值(含 promptFp、歷史 1 筆)')
                assert.deepEqual(frontProduced(e.file('n1')), OLD_FRONT)
                // 處置前即無產出鏈者(n3):回退後三欄刪除
                const n3 = await lm.notes.get('n3')
                assert.deepEqual(['produced', 'producedHistory', 'producedHistoryDropped'].filter((k) => k in n3), [])
            }
            finally {
                await lm.notes?.close()
                await lm.holds?.close()
            }
        })
    })
})

/**
 * 結果列之 id
 * @param {Array} list 輸入 [{ id }]
 * @returns {Array} 回傳 id 陣列
 */
function ids(list) {
    return list.map((x) => x.id)
}
