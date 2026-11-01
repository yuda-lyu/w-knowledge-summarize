// unit-summarize-ops.test.mjs — 摘要之維運層(ops/):存量確定性修正(noteStockFix)、人工匯入(ingestNotes)、還原筆記之標準閘(noteRestoreGate);
//   以及 ops／stages 兩層共用之常數
// 規則(出自各檔檔頭與 JSDoc):
//   ①noteFixOf:只動內容章(來源與下游投影之章原樣、連結與網址不轉);SS3 轉正體(概念之分群鍵須不變,變者不改並記 skipped);SS6 去尾碼／
//     拆擠標籤(各段皆既有概念)／去跨文字括號、SS2 截至上限與刪壞行;SS11 之降級取詞彙表之證據規則(未給詞彙或規則未啟用 → 不修;
//     詞彙給了而未經本套件解析 → 拋);SS4 須材料,與新進閘同一處置、修後複驗
//   ②ingestNotes:deps／items 型別;入庫(md 落地、notes 索引、doc 登記 noted);重複網址、筆記檔已存在皆略過並留訊息;文件 id 與管線同一去重身分
//   ③noteRestoreGate:對外介面 { check, hold };deps.vocab 缺席 → 依賴詞彙之判定略過、給了而未經本套件解析 → 建立即拋;修正後之記錄同步欄位與
//     stdFixes「還原 SSx」、syncHash 原有才寫、不寫 knowledgeChangedAt;待判(使用者、經「還原筆記」)
//   ④常數單一來源:本套件讀寫之文件狀態皆在抓取套件之 DOC_STATUSES 內;skipKind 之素材類取抓取套件之 SKIP_KIND_MATERIAL;ops／stages 不另寫狀態字面
//   (面向使用者之字樣與沿革指標之掃描在 unit-summarize-package ④——全套件一處,判準取抓取套件之 test/tools/historyMarks;領域詞彙在其 ③)
// 移植原實作之 unit-standards-stock(112、121、138、159;noteFixOf 純函數)、unit-check-ops(45、52)、unit-maint(78、97)各案(斷言不變;詞彙改
//   本套件之 resolveSummarizeVocab 並給回中立題材之證據規則〔原詞彙表之 relationTypes 非本套件所讀之鍵,不給〕;去重身分取抓取套件之
//   captureIdentityOf);③④為新增。
// 執行:自套件根 node <mocha> test/unit-summarize-ops.test.mjs(暫存 test/_tmp/summarize-ops-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import { memStore, scanSource, genClockTZ, DEFAULT_DEDUP, DOC_STATUSES, archiveDocText, setConceptFold, toTwKeepLinks } from './tools/captureForTest.mjs'
import { NEUTRAL_RULE } from './tools/stageKit.mjs'
import { normalizeConcept, captureIdentityOf, SKIP_KIND_MATERIAL } from '../src/core/capturePackage.mjs'
import { readMd, writeMd } from '../src/core/md/md.mjs'
import { resolveSummarizeVocab } from '../src/core/vocab/summarizeVocab.mjs'
import { checkNote } from '../src/standards/noteStandards.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { syncFieldsOf, syncHashOf } from '../src/stores/noteSync.mjs'
import { SUMMARIZE_DOC_STATUS, SUMMARIZE_SKIP_KIND, TRIAGE_STATE, TRIAGE_SKIP_PREFIX, triageReadyOf, triagePendingOf, rawPoolSplitOf } from '../src/stores/docStatus.mjs'
import { NOTE_FIX_STDS, noteFixOf, mapContentSections } from '../src/ops/noteStockFix.mjs'
import { ingestNotes } from '../src/ops/ingestNotes.mjs'
import { createNoteRestoreGate } from '../src/ops/noteRestoreGate.mjs'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/summarize-ops-${process.pid}`).replace(/\\/g, '/')
const clock = genClockTZ('Asia/Taipei')
/** 移植案之詞彙(原為含他段鍵之 plain 物件＋原實作內建之 SS11;此處為本套件解析後之詞彙並給回該規則) */
const VOCAB = resolveSummarizeVocab({ evidenceLevels: ['高', '中', '低'], claimTypes: ['實證研究', '觀點評論'], guide: {}, evidenceRule: NEUTRAL_RULE })
// 分群折疊(以兩字示意):風／风、險／险 同鍵
const FOLD = (s) => s.replace(/風/g, '风').replace(/險/g, '险')

const bodyOf = (o = {}) => [
    `# ${o.title || '標題'}`, '',
    '## 一句話重點', '', o.summary || '重點一句', '',
    '## 品質與證據標注', '', `- 內容類型：實證研究`, `- 證據等級：${o.level || '中'}（獨立觀測檢驗）`, '- 數據樣本期間：2000-2020', ...(o.caveats || ['⚠ 無']).map((c) => `- ${c}`), '',
    '## 核心知識', '', ...(o.points || ['- 要點甲']), '',
    ...(o.params ? ['## 關鍵參數', '', '| 參數 | 值／區間 | 說明 |', '| --- | --- | --- |', ...o.params, ''] : []),
    '## 來源', '', `- 原文标题：${o.srcTitle || '原文标题保持简体'}`, '- 網址：https://example.com/数据', '',
    ...(o.rel ? ['## 關聯', '', o.rel, ''] : []),
].join('\n')

// ops 與 stages 兩層之原始碼(本工作包;含常數模組)
const SOURCES = [
    'ops/noteStockFix.mjs', 'ops/syncNotes.mjs', 'ops/noteRestoreGate.mjs', 'ops/ingestNotes.mjs', 'ops/reviveFailed.mjs', 'ops/taxonomyOps.mjs',
    'stages/triageStage.mjs', 'stages/noteStage.mjs', 'stages/retagStage.mjs', 'stages/syncStage.mjs', 'stores/docStatus.mjs',
]
const read = (f) => fs.readFileSync(path.join(PKG, 'src', f), 'utf8')

describe('unit-summarize-ops', function() {

    before(() => {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
        setConceptFold(FOLD)
    })
    after(() => {
        setConceptFold(null) // 模組級單例,不留給同一行程之他檔
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ══════════════════════════ 存量確定性修正(ops/noteStockFix)══════════════════════════
    describe('存量確定性修正(noteFixOf)', function() {

        it('toTwKeepLinks／mapContentSections:連結與網址不轉;來源、關聯章原樣;SS3 之檢查同一定義(連結與網址不計——修正後即合格,不再「修不了」)', () => {
            assert.equal(toTwKeepLinks('见 [[简体-slug]] 与 https://x.com/数据 之后'), '見 [[简体-slug]] 與 https://x.com/数据 之後')
            assert.equal(toTwKeepLinks('見 [[简体-slug]] 之後'), '見 [[简体-slug]] 之後', '連結外已合格 → 原樣')
            const fixed = { front: { title: '標題', concepts: ['動量', '回測'] }, body: '# 標題\n\n## 一句話重點\n\n見 [[简体-slug]] 與 https://x.com/数据\n\n## 核心知識\n\n- 要點' }
            assert.equal(checkNote(fixed).find((r) => r.std === 'SS3').status, 'pass', '連結與網址內之簡體字不計')
            const b = mapContentSections('# 标题\n\n## 核心知识\n\n- 数据\n\n## 來源\n\n- 原文标题：数据\n\n## 關聯\n\n- 数据', toTwKeepLinks)
            assert.equal(b, '# 標題\n\n## 核心知識\n\n- 數據\n\n## 來源\n\n- 原文标题：数据\n\n## 關聯\n\n- 数据')
        })

        it('noteFixOf SS3:標題(front＋H1)、內容章、樣本期間、限制、概念(分群鍵不變者)轉正體;改分群鍵之概念不改並記 skipped;三欄之修正同為 fixKeepLinks(連結與網址不轉)', () => {
            const md = { front: { title: '动量因子之风险', concepts: ['风险', '動量'], sample_period: '2000年后', caveats: ['样本有限'] }, body: bodyOf({ title: '动量因子之风险', points: ['- 风险随市况变化'] }) }
            const f = noteFixOf(md, {}, { stds: ['SS3'], vocab: VOCAB })
            assert.deepEqual([f.front.title, f.front.concepts, f.front.sample_period, f.front.caveats], ['動量因子之風險', ['風險', '動量'], '2000年後', ['樣本有限']])
            assert.ok(f.body.startsWith('# 動量因子之風險\n') && f.body.includes('- 風險隨市況變化') && f.body.includes('原文标题保持简体'), f.body)
            assert.deepEqual([f.titleChanged, f.contentChanged, f.conceptsChanged, f.recordPatch.samplePeriod, f.recordPatch.caveats], [true, true, true, '2000年後', ['樣本有限']])
            // 規則:修正一律 fixKeepLinks——樣本期間、限制、概念內之 [[連結]] 與網址指稱他物,不轉(與標題、內容章同一轉法)
            const linked = { front: { title: '標題', concepts: ['動量', '[[简体-slug]]'], sample_period: '2000年后（见 https://x.com/数据）', caveats: ['样本有限，见 [[简体-slug]] 之后'] }, body: bodyOf({ title: '標題' }) }
            const l = noteFixOf(linked, {}, { stds: ['SS3'], vocab: VOCAB })
            assert.deepEqual([l.front.sample_period, l.front.caveats, l.front.concepts], ['2000年後（見 https://x.com/数据）', ['樣本有限，見 [[简体-slug]] 之後'], ['動量', '[[简体-slug]]']])
            setConceptFold(null)
            try {
                const g = noteFixOf(md, {}, { stds: ['SS3'], vocab: VOCAB })
                assert.deepEqual(g.front.concepts, ['风险', '動量'], '無折疊時轉正體會改分群鍵 → 不改')
                assert.match(g.skipped[0].what, /概念「风险」轉正體會改分群鍵/)
            }
            finally {
                setConceptFold(FOLD)
            }
        })

        it('noteFixOf SS6／SS2／SS11:去計數尾碼與括號註記、截 6、刪 [object Object] 行與參數空白列;最高證據等級＋明確自承 → 次高(品質章行同改);涉及而未明確者不改', () => {
            const md = { front: { title: '乙', concepts: ['波動率(730)', '主動推論(Active Inference)', 'a', 'b', 'c', 'd', 'e'] }, body: bodyOf({ title: '乙', points: ['- 要點', '- [object Object]'], params: ['| 窗口 | 20 | 日 |', '| | | |'] }) }
            const f = noteFixOf(md, {}, { stds: ['SS2', 'SS6'], vocab: VOCAB })
            assert.deepEqual(f.front.concepts, ['波動率', '主動推論', 'a', 'b', 'c', 'd'])
            assert.ok(!f.body.includes('[object Object]') && !/^\|\s*\|\s*\|\s*\|\s*$/m.test(f.body) && f.body.includes('| 窗口 | 20 | 日 |'), f.body)
            assert.deepEqual([...new Set(f.changes.map((c) => c.std))].sort(), ['SS2', 'SS6'])
            // SS6 本就改分群(「波動率(730)」之鍵含尾碼,修正後歸入「波動率」);截掉之概念亦失其鍵——皆列出供呼叫端列出受影響之下游產物
            assert.deepEqual([f.conceptKeys.removed, f.conceptKeys.added], [[normalizeConcept('波動率(730)'), normalizeConcept('主動推論(Active Inference)'), 'e'], ['波動率', '主動推論']])
            // 擠標籤:各段(去尾碼後)皆為既有概念才拆;有段非既有 → 原樣(仍不合格,由呼叫端列為修不了)
            const multi = { front: { title: '丙', concepts: ['系統性風險(246), 市場機制偵測(445)', '甲'] }, body: bodyOf({ title: '丙' }) }
            assert.deepEqual(noteFixOf(multi, {}, { stds: ['SS6'], vocab: VOCAB, knownConcept: () => true }).front.concepts, ['系統性風險', '市場機制偵測', '甲'])
            const no = noteFixOf(multi, {}, { stds: ['SS6'], vocab: VOCAB, knownConcept: (c) => c !== '市場機制偵測' })
            assert.deepEqual([no.front.concepts, no.changes.length], [['系統性風險(246), 市場機制偵測(445)', '甲'], 0])
            const hi = { front: { title: '甲', evidence_level: '高', caveats: ['未經獨立觀測證實'] }, body: bodyOf({ title: '甲', level: '高' }) }
            const h = noteFixOf(hi, {}, { stds: ['SS11'], vocab: VOCAB })
            assert.deepEqual([h.front.evidence_level, h.recordPatch.evidenceLevel, h.evidenceChanged], ['中', '中', true])
            assert.match(h.body, /^- 證據等級：中（獨立觀測檢驗）$/m)
            const loose = noteFixOf({ front: { ...hi.front, caveats: ['獨立觀測表現有待觀察'] }, body: hi.body }, {}, { stds: ['SS11'], vocab: VOCAB })
            assert.deepEqual([loose.changes.length, loose.front.evidence_level], [0, '高'], '涉及獨立觀測而未明確自承 → 不自動降(未能判定)')
        })

        it('noteFixOf SS4(須材料;與新進閘同一處置):清單行與參數列含原文沒有之數字者逐條移除、樣本期間改未載明、概念與限制同;標題／一句話重點／核心知識皆被移除 → 修不了(不改);未給材料不修;修後以同一判定複驗', () => {
            const MAT = '原文標題\n台股動量策略年化超額 8.2%,回看期 12 個月,樣本 2000-2020。'
            const md = {
                front: { title: '動量之實證', concepts: ['動量因子', '交易成本', '回看 37 月'], sample_period: '1990-2020', caveats: ['⚠ 無交易成本', '⚠ 樣本 99 檔'] },
                body: bodyOf({ title: '動量之實證', summary: '台股動量策略有超額報酬', points: ['- 年化超額 8.2%', '- 夏普比率 1.9', '- 回看 12 個月'], params: ['| 回看 | 12 | 月 |', '| 停損 | 7% | 單筆 |'], caveats: ['⚠ 無交易成本', '⚠ 樣本 99 檔'] }).replace('數據樣本期間：2000-2020', '數據樣本期間：1990-2020'),
            }
            const f = noteFixOf(md, {}, { stds: ['SS4'], vocab: VOCAB, material: MAT })
            assert.deepEqual(f.changes.map((c) => c.std), ['SS4'], JSON.stringify(f.skipped))
            assert.ok(f.body.includes('- 年化超額 8.2%') && f.body.includes('- 回看 12 個月') && !f.body.includes('夏普比率 1.9'), f.body)
            assert.ok(f.body.includes('| 回看 | 12 | 月 |') && !f.body.includes('| 停損 | 7% |'), '參數列逐列')
            assert.ok(f.body.includes('數據樣本期間：未載明') && !f.body.includes('樣本 99 檔'), f.body)
            assert.deepEqual([f.front.concepts, f.front.sample_period, f.recordPatch.samplePeriod, f.front.caveats], [['動量因子', '交易成本'], '未載明', '未載明', ['⚠ 無交易成本']])
            assert.deepEqual(checkNote({ front: f.front, body: f.body, record: {} }, { vocab: VOCAB, material: MAT }).find((r) => r.std === 'SS4').status, 'pass', '修後複驗合格')
            // 修不了:一句話重點含原文沒有之數字 → SS4 全數不改、記 skipped
            const bad = noteFixOf({ front: md.front, body: md.body.replace('台股動量策略有超額報酬', '台股動量策略年化 15% 超額') }, {}, { stds: ['SS4'], vocab: VOCAB, material: MAT })
            assert.deepEqual([bad.changes.length, /修不了：一句話重點/.test(bad.skipped.map((s) => s.what).join()), bad.body.includes('夏普比率 1.9')], [0, true, true])
            // 修不了:核心知識皆含原文沒有之數字
            const allKp = noteFixOf({ front: { title: '甲', concepts: ['動量因子', '交易成本'] }, body: bodyOf({ title: '甲', summary: '摘要', points: ['- 夏普比率 1.9', '- 勝率 61%'] }) }, {}, { stds: ['SS4'], vocab: VOCAB, material: MAT })
            assert.match(allKp.skipped.map((s) => s.what).join(), /核心知識/)
            // 未給材料 → 不修 SS4
            assert.deepEqual(noteFixOf(md, {}, { stds: ['SS4'], vocab: VOCAB }).changes, [])
        })

        it('noteFixOf 之詞彙:未給 → SS11 不修(其餘照修);詞彙未給證據規則(本套件預設)→ SS11 不修;給了而未經本套件解析 → 拋;可修之標準以凍結常數列出', () => {
            const hi = { front: { title: '甲', evidence_level: '高', caveats: ['未經獨立觀測證實'] }, body: bodyOf({ title: '甲', level: '高' }) }
            assert.deepEqual(noteFixOf(hi, {}, {}).changes, [], '未給詞彙')
            assert.deepEqual(noteFixOf(hi, {}, { vocab: resolveSummarizeVocab({ evidenceLevels: ['高', '中', '低'] }) }).changes, [], '規則未啟用')
            assert.equal(noteFixOf(hi, {}, { vocab: VOCAB }).front.evidence_level, '中', '預設修全部可修之標準(含 SS11)')
            for (const bad of [{ evidenceLevels: ['高', '中', '低'] }, {}, JSON.parse(JSON.stringify(VOCAB))]) {
                assert.throws(() => noteFixOf(hi, {}, { vocab: bad }), /noteFixOf 之 ctx\.vocab 須為 resolveSummarizeVocab 之產物/)
            }
            assert.deepEqual([NOTE_FIX_STDS, Object.isFrozen(NOTE_FIX_STDS)], [['SS2', 'SS3', 'SS4', 'SS6', 'SS11'], true])
        })
    })

    // ══════════════════════════ 人工匯入(ops/ingestNotes)══════════════════════════
    describe('人工匯入(ingestNotes)', function() {
        /** 去重身分(抓取套件之預設;人工匯入之文件 id 與管線同一身分) */
        const IDENTITY = captureIdentityOf(DEFAULT_DEDUP)

        it('deps 非物件或缺 stores/dirs/clock/domain/identity 拋錯；items 非陣列拋錯', async () => {
            await assert.rejects(() => ingestNotes(undefined, []), /ingestNotes 需要 \{ stores, dirs, clock, domain, identity \}/)
            await assert.rejects(() => ingestNotes({}, []), /ingestNotes 需要 \{ stores, dirs, clock, domain, identity \}/)
            await assert.rejects(() => ingestNotes({ stores: {}, dirs: {}, clock: {}, domain: {} }, []), /ingestNotes 需要 \{ stores, dirs, clock, domain, identity \}/, '缺去重身分')
            await assert.rejects(() => ingestNotes({ stores: {}, dirs: {}, clock: {}, domain: {}, identity: IDENTITY }, 'not-array'), /ingestNotes 需要 items 陣列/)
        })

        it('有效輸入行為不變：合法 deps／items 正常入庫(md 檔落地、notes 索引寫入)', async () => {
            const stores = { docs: memStore(), notes: memStore() }
            const fakeClock = { iso8: () => '2026-09-23T12:00:00+08:00' }
            // 入庫須過納入閘(檢定標準):以內建 domain 組版,筆記欄位完整(一句話重點、概念 ≥2、清單內之標注)
            const domain = createSummarizeDomain({})
            const notesDir = `${TMP}/ingest-notes`
            const r = await ingestNotes({ stores, dirs: { notes: notesDir }, clock: fakeClock, domain, identity: IDENTITY }, [
                { url: 'https://example.com/a', note: { title: 'T1', summary: '一句話', key_points: ['a'], concepts: ['c1', 'c2'], claim_type: '實證研究', evidence_level: '中' } },
            ])
            assert.deepEqual(r, { added: 1, dup: 0, bad: 0, messages: [] })
            const notes = await stores.notes.select()
            assert.equal(notes.length, 1)
            assert.ok(fs.existsSync(notes[0].file), 'md 檔須落地')
        })

        it('ingestNotes:筆記＋doc(noted)入庫;重複 URL 略過;筆記檔已存在略過且留訊息;欄位不全略過', async () => {
            const deps = { stores: { docs: memStore(), notes: memStore() }, dirs: { notes: `${TMP}/notes` }, clock, domain: createSummarizeDomain({}), identity: IDENTITY }
            const item = { url: 'https://e.com/a?utm_source=x', sourceName: 'S', note: { title: '人工筆記', key_points: ['k'], concepts: ['c', 'c2'], summary: 's', category: '方法與技術', claim_type: '實證研究', evidence_level: '中' } }
            const r1 = await ingestNotes(deps, [item, { url: 'https://e.com/b', note: { title: '缺概念', key_points: ['k'] } }])
            assert.deepEqual([r1.added, r1.dup, r1.bad], [1, 0, 1])
            const note = (await deps.stores.notes.select())[0]
            assert.equal(note.category, '方法與技術')
            assert.equal(readMd(note.file).front.title, '人工筆記')
            const doc = (await deps.stores.docs.select())[0]
            assert.deepEqual([doc.status, doc.url], ['noted', 'https://e.com/a'], 'doc 主鍵與管線同一算法(解轉址＋正規化)')
            const r2 = await ingestNotes(deps, [item])
            assert.deepEqual([r2.added, r2.dup], [0, 1])
            assert.match(r2.messages[0], /已在庫（noted）/)
            // docs 集合換新(如去重庫重建)但筆記檔仍在:不覆寫既有筆記,且須留訊息
            const r3 = await ingestNotes({ ...deps, stores: { docs: memStore(), notes: memStore() } }, [item])
            assert.deepEqual([r3.added, r3.dup], [0, 1])
            assert.match(r3.messages[0], /筆記檔已存在（.+\.md），略過：人工筆記/)
        })

        it('ingestNotes:文件 id 與管線同一去重身分(安裝方自訂去重身分亦然);缺 identity 拋錯', async () => {
            const identity = captureIdentityOf({ keyOf: (k) => `kb:${k}` })
            const seen = W.createSeenStore({ collection: memStore(), identity, log: { info() {}, warn() {}, error() {} } })
            const deps = { stores: { docs: memStore(), notes: memStore() }, dirs: { notes: `${TMP}/notes-dedup` }, clock, domain: createSummarizeDomain({}), identity }
            const url = 'https://e.com/z?utm_source=x'
            const r = await ingestNotes(deps, [{ url, note: { title: '自訂身分', key_points: ['k'], concepts: ['c', 'c2'], summary: 's', category: '方法與技術', claim_type: '實證研究', evidence_level: '中' } }])
            assert.equal(r.added, 1, JSON.stringify(r))
            const doc = (await deps.stores.docs.select())[0]
            assert.deepEqual([doc.id, doc.url], [seen.idOf(url), 'https://e.com/z'], '管線之 seen.idOf 算得同一 id——日後抓到同一網址即判已收')
            assert.equal((await deps.stores.notes.select())[0].docId, doc.id)
            await assert.rejects(() => ingestNotes({ ...deps, identity: undefined }, []), /ingestNotes 需要 \{ stores, dirs, clock, domain, identity \}/)
        })

        it('ingestNotes:未達檢定標準者之訊息附回饋(證據等級之未能判定附更正方向——方向出自詞彙表之證據規則)', async () => {
            const domain = createSummarizeDomain({ vocab: { evidenceLevels: ['高', '中', '低'], claimTypes: ['實證研究'], evidenceRule: NEUTRAL_RULE } })
            const r = await ingestNotes({ stores: { docs: memStore(), notes: memStore() }, dirs: { notes: `${TMP}/notes-fb` }, clock, domain, identity: IDENTITY }, [
                { url: 'https://e.com/fb', note: { title: '高等級筆記', key_points: ['k'], concepts: ['c', 'c2'], summary: 's', claim_type: '實證研究', evidence_level: '高', caveats: ['摘要未揭露獨立觀測證實之資料範圍與細節'] } },
            ])
            assert.deepEqual([r.added, r.bad], [0, 1])
            assert.match(r.messages[0], /^✗ 未達檢定標準（SS11 caveat 涉及獨立觀測而未明確自承.+——請明確寫出是否做過獨立觀測證實，或降低證據等級），略過：高等級筆記$/)
        })
    })

    // ══════════════════════════ 還原筆記之標準閘(ops/noteRestoreGate)══════════════════════════
    describe('還原筆記之標準閘(createNoteRestoreGate)', function() {
        const NOW = '2026-10-05T10:00:00+08:00'
        const fixed = { iso8: () => NOW }
        const BODY = '# 动量\n\n## 一句話重點\n\n重點\n\n## 品質與證據標注\n\n- 內容類型：實證研究\n- 證據等級：高\n- 數據樣本期間：未載明\n- ⚠ 無獨立觀測證實\n\n## 核心知識\n\n- k'
        const MD = { front: { title: '动量', concepts: ['動量', '回測'], claim_type: '實證研究', evidence_level: '高', caveats: ['無獨立觀測證實'] }, body: BODY }

        it('對外介面 { check, hold };詞彙給了而未經本套件解析(plain、空物件、JSON 往返之複本、非物件)→ 建立即拋', () => {
            const g = createNoteRestoreGate({ stores: { notes: memStore() }, clock: fixed })
            assert.deepEqual([typeof g.check, typeof g.hold], ['function', 'function'])
            for (const bad of [{ evidenceLevels: ['高', '中'] }, {}, JSON.parse(JSON.stringify(VOCAB)), 'v']) {
                assert.throws(() => createNoteRestoreGate({ stores: { notes: memStore() }, vocab: bad, clock: fixed }), /createNoteRestoreGate 之 deps\.vocab 須為 resolveSummarizeVocab 之產物/, JSON.stringify(bad))
            }
        })

        it('check:給了詞彙 → 確定性修正(SS3 標題、SS11 依詞彙表之證據規則降級)、記錄同步欄位與 stdFixes「還原 SSx」、syncHash 原有才寫、不寫 knowledgeChangedAt;不寫任何東西', async () => {
            const notes = memStore([])
            const g = createNoteRestoreGate({ stores: { notes }, vocab: VOCAB, clock: fixed })
            const r = await g.check({ record: { id: 'n1', title: '动量', syncHash: 'old', stdFixes: ['舊紀錄'] }, md: MD })
            assert.equal(r.mdChanged, true)
            assert.deepEqual([r.md.front.title, r.md.front.evidence_level, /^- 證據等級：中$/m.test(r.md.body)], ['動量', '中', true])
            assert.deepEqual([r.recordPatch.title, r.recordPatch.evidenceLevel, r.recordPatch.syncHash, 'knowledgeChangedAt' in r.recordPatch], ['動量', '中', syncHashOf(syncFieldsOf(r.md)), false])
            assert.deepEqual(r.recordPatch.stdFixes.slice(0, 1), ['舊紀錄'])
            assert.ok(r.recordPatch.stdFixes.some((x) => /^還原 SS3：標題「动量」→「動量」/.test(x)) && r.recordPatch.stdFixes.some((x) => /^還原 SS11：證據等級「高」→「中」/.test(x)), JSON.stringify(r.recordPatch.stdFixes))
            assert.deepEqual([r.violations, r.undetermined, r.contentChanged, r.titleChanged], [[], [], true, true])
            assert.deepEqual(await notes.select(), [], 'check 不寫')
            const r2 = await g.check({ record: { id: 'n2', title: '动量' }, md: MD })
            assert.equal('syncHash' in r2.recordPatch, false, '記錄原無 syncHash 者不寫')
        })

        it('check:缺席(未給詞彙)→ 依賴詞彙之判定略過(SS11 不適用、不降級;清單不驗),其餘照修照判', async () => {
            const g = createNoteRestoreGate({ stores: { notes: memStore() }, clock: fixed })
            const r = await g.check({ record: { id: 'n1', title: '动量' }, md: MD })
            assert.deepEqual([r.md.front.title, r.md.front.evidence_level], ['動量', '高'])
            assert.deepEqual([r.results.find((x) => x.std === 'SS11').status, [...new Set(r.changes.map((c) => c.std))]], ['na', ['SS3']])
            // 兩旗標分列(與 noteFixOf、存量處置之帳列同義):只改標題者 contentChanged 為 false
            const r3 = await g.check({ record: { id: 'n3', title: '动量' }, md: { front: MD.front, body: MD.body.replace('# 动量', '# 動量') } })
            assert.deepEqual([r3.mdChanged, r3.titleChanged, r3.contentChanged], [true, true, false])
            // 本套件預設詞彙(證據規則未啟用)亦不降級
            const r2 = await createNoteRestoreGate({ stores: { notes: memStore() }, vocab: resolveSummarizeVocab({}), clock: fixed }).check({ record: { id: 'n1', title: '动量' }, md: MD })
            assert.equal(r2.md.front.evidence_level, '高')
        })

        it('check:有原文(另存)→ 含 SS4(含原文沒有之數字之清單行逐條移除);hold:未開 holds → noHolds;有 → 不合格／未能判定者登錄待判(使用者、經「還原筆記」)', async () => {
            const docs = memStore([{ id: 'd1', status: 'noted', text: '' }])
            const docTexts = memStore()
            await archiveDocText(docTexts, { id: 'd1', text: '原文 8.2% 之結果', status: 'noted', title: '原文' }, NOW)
            const md = { front: { title: '甲', concepts: ['動量', '回測'], claim_type: '實證研究', evidence_level: '中' }, body: '# 甲\n\n## 一句話重點\n\n重點\n\n## 核心知識\n\n- 8.2% 之結果\n- 夏普 1.9' }
            const g0 = createNoteRestoreGate({ stores: { notes: memStore(), docs, docTexts }, vocab: VOCAB, clock: fixed })
            const r = await g0.check({ record: { id: 'n1', title: '甲', docId: 'd1' }, md })
            assert.ok(!r.md.body.includes('夏普 1.9') && r.md.body.includes('- 8.2% 之結果'), r.md.body)
            assert.equal(r.results.find((x) => x.std === 'SS4').status, 'pass')
            assert.deepEqual(await g0.hold({ id: 'n1', title: '甲' }, r.results), { held: [], noHolds: true })
            const holds = memStore()
            const g = createNoteRestoreGate({ stores: { notes: memStore(), holds }, vocab: VOCAB, clock: fixed })
            const bad = await g.check({ record: { id: 'n3', title: '乙' }, md: { front: { title: '乙', concepts: ['唯一'] }, body: '# 乙\n\n## 一句話重點\n\n重點\n\n## 核心知識\n\n- k' } })
            assert.deepEqual(bad.violations.map((x) => x.std), ['SS2'])
            const h = await g.hold({ id: 'n3', title: '乙', file: 'n3.md' }, bad.results)
            assert.deepEqual(h, { held: ['SS2'], noHolds: false })
            const rec = await holds.get('note:n3:SS2')
            assert.deepEqual([rec.owner, /^還原筆記後未達檢定標準（SS2）：〈乙〉/.test(rec.reason)], ['user', true])
        })
    })

    // ══════════════════════════ 常數單一來源 ══════════════════════════
    describe('常數單一來源(stores/docStatus)', function() {

        it('本套件讀寫之文件狀態皆在抓取套件之 DOC_STATUSES 內;skipKind 之素材類取抓取套件之常數;三組常數凍結、值不重複', () => {
            assert.deepEqual(SUMMARIZE_DOC_STATUS, { pending: 'raw', failed: 'summarize-failed', noted: 'noted', skip: 'skip' })
            for (const v of Object.values(SUMMARIZE_DOC_STATUS)) assert.ok(DOC_STATUSES.includes(v), `${v} 不在 DOC_STATUSES（${DOC_STATUSES.join('、')}）`)
            assert.deepEqual(SUMMARIZE_SKIP_KIND, { triage: 'triage', notKnowledge: 'not-knowledge', material: SKIP_KIND_MATERIAL })
            assert.deepEqual(TRIAGE_STATE, { relevant: 'relevant', irrelevant: 'irrelevant', rejectPending: 'reject-pending' })
            for (const o of [SUMMARIZE_DOC_STATUS, SUMMARIZE_SKIP_KIND, TRIAGE_STATE]) {
                assert.ok(Object.isFrozen(o))
                assert.equal(new Set(Object.values(o)).size, Object.values(o).length)
            }
        })

        it('ops／stages 不另寫狀態與略過類別之字面(一律取 stores/docStatus 之常數)', () => {
            const LITERALS = ['raw', 'summarize-failed', 'noted', 'not-knowledge', 'reject-pending']
            const bad = []
            for (const f of SOURCES.filter((x) => x !== 'stores/docStatus.mjs')) {
                for (const s of scanSource(read(f)).strings) if (LITERALS.includes(s)) bad.push(`${f}：'${s}'`)
            }
            assert.deepEqual(bad, [])
        })

        it('預篩之分法(單一判準;摘要選池與巡檢之 raw 池分法同讀):放行＝relevant;待預篩＝未設或 reject-pending;攔下(irrelevant)兩者皆非;攔下理由之字首為常數', () => {
            const docs = [{ triage: 'relevant' }, {}, { triage: '' }, { triage: 'reject-pending' }, { triage: 'irrelevant' }]
            assert.deepEqual(docs.map((d) => [triageReadyOf(d), triagePendingOf(d)]), [[true, false], [false, true], [false, true], [false, true], [false, false]])
            assert.deepEqual(rawPoolSplitOf(docs), { ready: 1, untriaged: 3 })
            assert.deepEqual([rawPoolSplitOf(null), triageReadyOf(null), triagePendingOf(undefined)], [{ ready: 0, untriaged: 0 }, false, true])
            assert.equal(TRIAGE_SKIP_PREFIX, '預篩：')
            // 子階段寫攔下理由一律以常數為字首(不另寫字面)
            assert.deepEqual(read('stages/triageStage.mjs').match(/skipReason: `預篩：/g), null)
        })
    })

})
