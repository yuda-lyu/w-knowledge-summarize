// unit-summarize-stores.test.mjs — 摘要之 stores 層(stores/):筆記組裝(noteBuild)、內容同步雜湊(noteSync)、既有概念(knownConcepts)、
//   依字數打包(packByChars)、待判(noteHolds)、分類法(taxonomy)、素材問題(materialPolicy)
// 規則(出自各檔頭):
//   ①組裝:slug、md 路徑、frontmatter 與記錄之欄位與順序固定;清單外類別落 fallbackCategory 並存原值;概念清洗同驗證、至多 6 個
//   ②同步雜湊只由 md 讀回值計(標題、概念保序、一句話重點);概念換位即不同;記錄之 summary 300 字上限
//   ③既有概念:全庫合格標籤＋核心概念,以分群鍵比對
//   ④打包:篇數與字數皆不逾上限者同批;單篇逾上限獨佔一批並截至上限;設定不合即拋
//   ⑤待判:文件待判(閘門每次、SS14 只在終態;改判他標準舊者結案;終態轉使用者)、筆記待判(同步入口)、重標待判(SS9;重試與自動結案);
//     期限單一常數;下一步之字樣指本套件之處置 API,不指執行端之指令、他工作或帳本代號
//   ⑥分類法:版本(只換順序不變、guide 措辭不計)、差異 → 工作、連續改版重新定界、可採類別、狀態檔(單一檔名、真理檔)
//   ⑦素材問題:理由樣式(素材命中、題材不命中、存取限制排除)、退回欄位(抓取套件之欄位＋摘要自身之欄位)、追加樣式
// 移植原實作之組裝、同步雜湊、既有概念、打包、分類法與素材問題各案(斷言不變;詞彙改為 resolveSummarizeVocab,版本案之 guide 措辭
//   改用本套件所認之段);待判之純函數案、組裝之欄位順序、狀態檔與改寫之案為新增(原只經子階段間接驗證)。
// 執行:自套件根 node <mocha> test/unit-summarize-stores.test.mjs(暫存 test/_tmp/summarize-stores-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memStore, setConceptFold, requestRetry, waiveHold } from './tools/captureForTest.mjs'
import { slugify } from '../src/core/capturePackage.mjs'
import { resolveSummarizeVocab } from '../src/core/vocab/summarizeVocab.mjs'
import { holdKey, putHold } from '../src/core/capturePackage.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { categoryOf, buildNote } from '../src/stores/noteBuild.mjs'
import { syncFieldsOf, syncHashOf, recordPatchOf, diffLabelOf } from '../src/stores/noteSync.mjs'
import { knownConceptOf } from '../src/stores/knownConcepts.mjs'
import { packDocsByChars } from '../src/stores/packByChars.mjs'
import { NOTE_ARRAY_FIELDS, patchNoteRecord } from '../src/stores/notePatch.mjs'
import {
    NOTE_HOLD_DEADLINE_DAYS, noteHoldDeadlineOf, DOC_HOLD_NEXT, NOTE_HOLD_NEXT, RETAG_HOLD_STD, RETAG_HOLD_NEXT,
    putDocHold, escalateDocHolds, resolveDocHolds, syncNoteHolds, resolveNoteHolds, putRetagHold, settleRetagHolds,
} from '../src/stores/noteHolds.mjs'
import {
    TAXONOMY_STATE_VERSION, TAXONOMY_STATE_FILE, RENAME_FIELDS, taxonomyOf, taxonomyVersion, syncTaxonomy, createTaxonomyStore, queueRejudge, jobScope,
    rewriteFieldOf, retagTargetOf, taxonomyFixOf, retagJobLabelOf, REJUDGE_REASON_LABELS, taxonomySnapshotOf,
} from '../src/stores/taxonomy.mjs'
import { MATERIAL_PROBLEM_PATTERNS_DEFAULT, createMaterialPolicy } from '../src/stores/materialPolicy.mjs'

const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/summarize-stores-${process.pid}`).replace(/\\/g, '/')
const NOW = '2026-10-04T10:00:00+08:00'

describe('unit-summarize-stores', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
        setConceptFold(null) // 概念折疊為模組級單例:本檔之既有概念案不依賴他檔是否清乾淨
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        setConceptFold(null)
    })

    // ══════════════════════════ noteBuild ══════════════════════════
    describe('筆記組裝(stores/noteBuild)', function() {
        const VOCAB = { categories: ['方法', '風險', '雜項'], fallbackCategory: '雜項' }

        it('categoryOf:去頭尾空白後在清單內即採用;清單外落 fallbackCategory 並回傳原值;空值落 fallbackCategory、無原值', () => {
            assert.deepEqual(categoryOf(' 方法 ', VOCAB), { category: '方法', categoryRaw: '' })
            assert.deepEqual(categoryOf('新興主題', VOCAB), { category: '雜項', categoryRaw: '新興主題' })
            assert.deepEqual(categoryOf('', VOCAB), { category: '雜項', categoryRaw: '' })
            assert.deepEqual(categoryOf(undefined, { categories: ['其他'] }), { category: '其他', categoryRaw: '' }, '未給 fallbackCategory 用預設詞彙表之值')
        })

        it('buildNote:參數不全即拋錯', () => {
            assert.throws(() => buildNote({}), /buildNote 需要 \{ k, doc, domain, notesDir \}/)
        })

        it('buildNote:slug 與路徑;frontmatter 與記錄之欄位與順序;清單外類別存原值;概念清洗且至多 6 個;一句話重點 300 字;處理範圍與內文取得方式', () => {
            const domain = createSummarizeDomain({ vocab: VOCAB })
            const k = { title: '筆記甲', key_points: ['k1'], concepts: [' 概念甲 ', 2, {}, '', '乙', '丙', '丁', '戊', '己', '庚'], summary: '重'.repeat(400), category: '新興主題', claim_type: '實證研究', evidence_level: '中' }
            const doc = { id: 'd1', url: 'https://example.com/a', sourceName: '來源甲', publishedAt: '2026-01-01', textFrom: 'feed', title: '原文標題' }
            const n = buildNote({ k, doc, domain, notesDir: `${TMP}/nb`, nowIso: NOW, chars: { sourceChars: 100, processedChars: 50 } })
            assert.equal(n.slug, slugify('筆記甲', 'd1'))
            assert.equal(n.file, path.join(`${TMP}/nb`, `${n.slug}.md`))
            assert.deepEqual(Object.keys(n.front), ['title', 'slug', 'category', 'concepts', 'claim_type', 'evidence_level', 'sample_period', 'caveats', 'source_name', 'source_url', 'published', 'created', 'doc_id', 'type'])
            assert.deepEqual(Object.keys(n.record), ['id', 'title', 'category', 'categoryRaw', 'concepts', 'summary', 'claimType', 'evidenceLevel', 'caveats', 'samplePeriod', 'sourceUrl', 'sourceName', 'docId', 'sourceChars', 'processedChars', 'file', 'createdAt', 'relatedAt', 'extractedAt'])
            assert.deepEqual([n.category, n.categoryRaw, n.front.category, n.record.categoryRaw], ['雜項', '新興主題', '雜項', '新興主題'])
            assert.deepEqual(n.concepts, ['概念甲', '2', '乙', '丙', '丁', '戊'])
            assert.deepEqual([n.record.summary.length, n.record.file.includes('\\'), n.front.sample_period, n.front.type, n.front.created], [300, false, '未載明', 'note', NOW])
            assert.ok(n.body.includes('- 內文取得方式：feed 內嵌內文\n- 內文處理範圍：原文 100 字，摘要只讀前 50 字'), n.body)
            const plain = buildNote({ k: { ...k, category: '方法' }, doc, domain, notesDir: `${TMP}/nb`, nowIso: NOW })
            assert.deepEqual(['categoryRaw' in plain.record, 'sourceChars' in plain.record, plain.category], [false, false, '方法'], '清單內類別不存原值;未給處理範圍不記')
        })
    })

    // ══════════════════════════ noteSync ══════════════════════════
    describe('內容同步(stores/noteSync)', function() {

        it('syncFieldsOf／syncHashOf:由 md 讀回標題(frontmatter)、概念(保序、去空白去重)、一句話重點(壓空白);概念換位即不同雜湊', () => {
            const md = { front: { title: ' 標 題 ', concepts: [' 甲 ', '乙', '甲'] }, body: '# 標題\n\n## 一句話重點\n\n第一行\n第二行\n\n## 核心知識\n\n- k' }
            const f = syncFieldsOf(md)
            assert.deepEqual(f, { title: '標 題', concepts: ['甲', '乙'], summary: '第一行 第二行' })
            assert.notEqual(syncHashOf(f), syncHashOf({ ...f, concepts: ['乙', '甲'] }), '概念換位會改變下游所取之主標籤,須偵測')
            assert.deepEqual(recordPatchOf({ title: 'T', concepts: ['a'], summary: 'x'.repeat(400) }).summary.length, 300)
        })

        it('diffLabelOf:列出變更之欄(標題、概念、一句話重點);皆同 → 「內容」;md 無「一句話重點」章 → 空字串', () => {
            const rec = { title: 'A', concepts: ['甲'], summary: '舊重點' }
            assert.equal(diffLabelOf(rec, { title: 'B', concepts: ['甲'], summary: '舊重點' }), '標題')
            assert.equal(diffLabelOf(rec, { title: 'A', concepts: ['甲', '乙'], summary: '舊重點' }), '概念')
            assert.equal(diffLabelOf(rec, { title: 'A', concepts: ['甲'], summary: '新重點' }), '一句話重點')
            assert.equal(diffLabelOf(rec, { title: 'B', concepts: [], summary: '新' }), '標題、概念、一句話重點')
            assert.equal(diffLabelOf(rec, { title: 'A', concepts: ['甲'], summary: '舊重點（續）' }), '內容')
            assert.equal(syncFieldsOf({ front: {}, body: '# 無章' }).summary, '')
        })
    })

    // ══════════════════════════ notePatch ══════════════════════════
    describe('筆記記錄之寫入(stores/notePatch;同步與存量處置共用)', function() {

        /** 模擬深合併之集合:陣列依索引合併、null 清除(與真集合之 patch 語意同),供驗「先清後寫」 */
        const deepStore = (rows) => {
            const m = new Map(rows.map((r) => [r.id, structuredClone(r)]))
            const merge = (a, b) => {
                if (b === null) return null
                if (Array.isArray(a) && Array.isArray(b)) return a.map((x, i) => (i < b.length ? merge(x, b[i]) : x)).concat(b.slice(a.length))
                if (a && typeof a === 'object' && b && typeof b === 'object' && !Array.isArray(b)) return { ...a, ...Object.fromEntries(Object.entries(b).map(([k, v]) => [k, merge(a[k], v)])) }
                return b
            }
            const writes = []
            return {
                writes,
                get: async (id) => (m.has(id) ? structuredClone(m.get(id)) : null),
                patch: async (id, p) => {
                    writes.push(structuredClone(p))
                    m.set(id, merge(m.get(id), p))
                },
            }
        }

        it('陣列欄有變先清為 null 再寫(深合併下不殘留舊尾項);未變之陣列不清;回驗預設比 patch 全部欄', async () => {
            const st = deepStore([{ id: 'n1', concepts: ['甲', '乙'], caveats: ['c'], title: 'T' }])
            const back = await patchNoteRecord(st, { id: 'n1', concepts: ['甲', '乙'], caveats: ['c'] }, { concepts: ['丙'], caveats: ['c'], title: 'T2' })
            assert.deepEqual(back.concepts, ['丙'], '不殘留「乙」')
            assert.deepEqual(st.writes, [{ concepts: null }, { concepts: ['丙'], caveats: ['c'], title: 'T2' }], '只清有變之陣列欄,再寫一次')
            assert.deepEqual(NOTE_ARRAY_FIELDS, ['concepts', 'caveats', 'stdFixes'])
        })

        it('回驗不符即拋(訊息含筆記 id、用途字樣與欄名);verify 可限定回驗之欄;現值無 id 即拋', async () => {
            const bad = { get: async () => ({ id: 'n1', title: '舊' }), patch: async () => {} }
            await assert.rejects(patchNoteRecord(bad, { id: 'n1' }, { title: '新' }, { label: '同步' }), /筆記 n1 之同步寫入後回驗不符（title）/)
            const ok = await patchNoteRecord(bad, { id: 'n1' }, { title: '新', other: 1 }, { verify: [] })
            assert.equal(ok.title, '舊', '限定為不回驗者不拋(呼叫端自負)')
            await assert.rejects(patchNoteRecord(bad, {}, { title: 'x' }), /需要現值記錄/)
        })
    })

    // ══════════════════════════ knownConcepts ══════════════════════════
    describe('既有概念(stores/knownConcepts)', function() {

        it('S6 knownConceptOf:全庫合格概念標籤＋核心概念(分群鍵比對);不合格之標籤不算既有;無 cores 集合亦可', async () => {
            const notes = memStore([{ id: 'n1', concepts: ['太陽黑子', '日冕(193)', '甲、乙'] }, { id: 'n2', concepts: ['彗星'] }])
            const known = await knownConceptOf({ notes, cores: memStore([{ id: 'c1', concept: '行星環' }]) })
            assert.deepEqual(['太陽黑子', '彗星', '行星環', '日冕', '甲', ' 太陽黑子 '].map(known), [true, true, true, false, false, true])
            assert.equal((await knownConceptOf({ notes }))('行星環'), false, '無 cores → 只取筆記')
            await assert.rejects(() => knownConceptOf({}), /knownConceptOf 需要 stores\.notes/)
        })
    })

    // ══════════════════════════ packByChars ══════════════════════════
    describe('依字數打包(stores/packByChars;摘要段與題組測試共用)', function() {
        const D = (id, n) => ({ id, text: 'x'.repeat(n) })

        it('篇數與字數皆不逾上限者同批;逾上限者另起一批;單篇逾每批上限者獨佔一批且預算截至上限;空輸入回空', () => {
            const r = packDocsByChars([D('a', 2000), D('b', 20000), D('c', 13531), D('d', 1000), D('e', 1000), D('f', 1000), D('g', 1000)], { batchSize: 3, charsPerDoc: 6000 })
            assert.deepEqual(r.batches.map((b) => b.map((d) => d.id)), [['a'], ['b'], ['c', 'd', 'e'], ['f', 'g']])
            assert.deepEqual([...r.budgets], [['a', 2000], ['b', 18000], ['c', 13531], ['d', 1000], ['e', 1000], ['f', 1000], ['g', 1000]])
            assert.deepEqual(packDocsByChars([], { batchSize: 3, charsPerDoc: 6000 }), { batches: [], budgets: new Map() })
        })

        it('設定須為正整數(不合法即拋錯,不靜默改用預設)', () => {
            assert.throws(() => packDocsByChars([], { batchSize: 0, charsPerDoc: 6000 }), /batchSize 須為正整數/)
            assert.throws(() => packDocsByChars([], { batchSize: 3, charsPerDoc: 1.5 }), /charsPerDoc 須為正整數/)
        })
    })

    // ══════════════════════════ noteHolds ══════════════════════════
    describe('待判(stores/noteHolds)', function() {
        const doc = { id: 'a', title: '動量研究' }
        const DEADLINE = new Date(Date.parse(NOW) + 30 * 86400_000).toISOString()

        it('期限:單一常數 30 天;noteHoldDeadlineOf＝登錄時刻＋期限(ISO UTC;機制為抓取套件之 holdDeadlineOf);不可解析之時刻即拋 RangeError', () => {
            assert.equal(NOTE_HOLD_DEADLINE_DAYS, 30)
            assert.equal(noteHoldDeadlineOf(NOW), DEADLINE)
            assert.equal(noteHoldDeadlineOf('2026-10-05T10:00:00+08:00'), '2026-11-04T02:00:00.000Z')
            assert.throws(() => noteHoldDeadlineOf('不是時刻'), RangeError)
        })

        it('putDocHold 閘門標準:每次登錄(pipeline／下輪附回饋重摘／期限);改判他標準 → 舊者結案、新者登錄;終態 → 改由使用者(重開或豁免)、原因附已試次數', async () => {
            const holds = memStore()
            const r1 = await putDocHold(holds, doc, { std: 'SS2', why: '未達檢定標準：概念 1 個（須 2～6）', tries: 1, nowIso: NOW })
            assert.deepEqual(r1, { held: 1, resolved: 0, escalated: 0 })
            const h = await holds.get(holdKey('doc', 'a', 'SS2'))
            assert.deepEqual([h.status, h.owner, h.next, h.deadline, h.ctx], ['open', 'pipeline', DOC_HOLD_NEXT.retry, DEADLINE, { title: '動量研究', tries: '1' }])
            assert.equal(h.reason, '摘要未達檢定標準（SS2）：〈動量研究〉未達檢定標準：概念 1 個（須 2～6）')
            const r2 = await putDocHold(holds, doc, { std: 'SS4', why: '標題含原文沒有之數字（9.9%）', tries: 2, nowIso: NOW })
            assert.deepEqual(r2, { held: 1, resolved: 1, escalated: 0 })
            assert.deepEqual([(await holds.get('doc:a:SS2')).status, (await holds.get('doc:a:SS2')).how], ['resolved', '重摘後改判 SS4'])
            const r3 = await putDocHold(holds, doc, { std: 'SS4', why: '標題含原文沒有之數字（9.9%）', terminal: true, tries: 3, nowIso: NOW })
            const h4 = await holds.get('doc:a:SS4')
            assert.deepEqual([r3.held, h4.status, h4.owner, h4.next, h4.tries], [1, 'open', 'user', DOC_HOLD_NEXT.user, 1])
            assert.match(h4.reason, /^摘要未達檢定標準（SS4）：〈動量研究〉標題含原文沒有之數字（9\.9%）——已試 3 次，轉 summarize-failed$/)
        })

        it('putDocHold 之 SS14:非終態不登錄(兩段式流程由摘要段處理);終態才登錄(使用者)', async () => {
            const holds = memStore()
            assert.deepEqual(await putDocHold(holds, doc, { std: 'SS14', why: 'SS14 筆記不忠實於原文', tries: 1, nowIso: NOW }), { held: 0, resolved: 0, escalated: 0 })
            assert.equal(await holds.get('doc:a:SS14'), null)
            await putDocHold(holds, doc, { std: 'SS14', why: 'SS14 筆記不忠實於原文', terminal: true, tries: 3, nowIso: NOW })
            assert.deepEqual([(await holds.get('doc:a:SS14')).owner, (await holds.get('doc:a:SS14')).next], ['user', DOC_HOLD_NEXT.user])
        })

        it('escalateDocHolds:終態時其餘未結待判改由使用者(原因附「其後轉 summarize-failed」);已轉使用者者不重複', async () => {
            const holds = memStore()
            await putHold(holds, { object: 'doc', oid: 'a', std: 'SS14', reason: '筆記忠實性覆核判不了（SS14；有一席不確定）', next: '下輪自動重摘並重判', owner: 'pipeline', deadline: DEADLINE }, NOW)
            const r = await putDocHold(holds, doc, { std: 'SS2', why: '概念 1 個', terminal: true, tries: 3, nowIso: NOW })
            assert.deepEqual(r, { held: 1, resolved: 0, escalated: 1 })
            const h = await holds.get('doc:a:SS14')
            assert.deepEqual([h.owner, h.next], ['user', DOC_HOLD_NEXT.user])
            assert.equal(h.reason, '筆記忠實性覆核判不了（SS14；有一席不確定）｜其後轉 summarize-failed（概念 1 個）')
            assert.equal(await escalateDocHolds(holds, doc, { why: '再次', nowIso: NOW }), 0, '已轉使用者者不重複轉')
            // 已轉使用者而 next 為他版字樣(既有登錄)→ 以 owner 判,不重轉、不重複附加原因
            const old = memStore()
            await putHold(old, { object: 'doc', oid: 'a', std: 'SS3', reason: '舊原因', next: '使用者處置：舊版之指令字樣', owner: 'user', deadline: DEADLINE }, NOW)
            assert.equal(await escalateDocHolds(old, doc, { why: '再次', nowIso: NOW }), 0)
            assert.deepEqual([(await old.get('doc:a:SS3')).reason, (await old.get('doc:a:SS3')).next], ['舊原因', '使用者處置：舊版之指令字樣'])
        })

        it('resolveDocHolds:文件轉離 raw → 閘門待判結案(預設不含 SS14);使用者重開 → 連同 SS14', async () => {
            const holds = memStore()
            await putDocHold(holds, doc, { std: 'SS6', why: '多概念擠一標籤', nowIso: NOW })
            await putDocHold(holds, doc, { std: 'SS14', why: '不忠實', terminal: true, nowIso: NOW })
            assert.equal(await resolveDocHolds(holds, 'a', { how: '重摘後文件轉 noted（已納入）', nowIso: NOW }), 1)
            assert.deepEqual([(await holds.get('doc:a:SS6')).how, (await holds.get('doc:a:SS14')).status], ['重摘後文件轉 noted（已納入）', 'open'])
            assert.equal(await resolveDocHolds(holds, 'a', { how: '使用者重開', nowIso: NOW, withFaith: true }), 1)
            assert.equal((await holds.get('doc:a:SS14')).status, 'resolved')
        })

        it('syncNoteHolds:不合格／未能判定 → 登錄(使用者;原因帶來源與說明);經判定合格且有未結者 → 結案;非筆記標準不處理;resolveNoteHolds 結案筆記已不存在者', async () => {
            const holds = memStore()
            const note = { id: 'n1', title: '筆記甲', file: 'k/n1.md' }
            const rs = [{ std: 'SS2', status: 'violation', detail: '缺一句話重點' }, { std: 'SS11', status: 'undetermined', detail: 'caveat 涉及要件而未明確自承' }, { std: 'SS3', status: 'pass' }, { std: 'RS1', status: 'violation', detail: 'x' }]
            assert.deepEqual(await syncNoteHolds(holds, note, rs, { nowIso: NOW }), { held: ['SS2', 'SS11'], resolved: [] })
            const h2 = await holds.get('note:n1:SS2')
            assert.deepEqual([h2.owner, h2.next, h2.deadline, h2.ctx], ['user', NOTE_HOLD_NEXT, DEADLINE, { title: '筆記甲', file: 'k/n1.md' }])
            assert.equal(h2.reason, '筆記同步後未達檢定標準（SS2）：〈筆記甲〉缺一句話重點')
            assert.equal((await holds.get('note:n1:SS11')).reason, '筆記同步後未能判定（SS11）：〈筆記甲〉caveat 涉及要件而未明確自承')
            assert.equal(await holds.get('note:n1:RS1'), null)
            assert.deepEqual(await syncNoteHolds(holds, note, [{ std: 'SS2', status: 'pass' }], { nowIso: NOW, via: '還原' }), { held: [], resolved: ['SS2'] })
            assert.equal((await holds.get('note:n1:SS2')).how, '還原重驗合格')
            assert.equal(await resolveNoteHolds(holds, 'n1', { nowIso: NOW }), 1)
            assert.deepEqual([(await holds.get('note:n1:SS11')).status, (await holds.get('note:n1:SS11')).how], ['resolved', '筆記已不存在'])
        })

        it('重標待判 SS9:登錄(使用者);筆記不在／類別回清單 → 自動結案;使用者要求重試(晚於登錄)→ 回傳該退役類別;未要求者不重排', async () => {
            const holds = memStore([])
            await putRetagHold(holds, { id: 'n9', title: '乙' }, { category: '風險', why: '模型未涵蓋或回覆不在清單', fails: 2, nowIso: NOW })
            const key = holdKey('note', 'n9', RETAG_HOLD_STD)
            const h = await holds.get(key)
            assert.deepEqual([RETAG_HOLD_STD, h.status, h.owner, h.next, h.ctx], ['SS9', 'open', 'user', RETAG_HOLD_NEXT, { title: '乙', category: '風險' }])
            assert.equal(h.reason, '退役類別「風險」之重判 2 次未成（模型未涵蓋或回覆不在清單）：〈乙〉仍在已退役之類別')
            const byId = new Map([['n9', { id: 'n9', category: '風險' }]])
            assert.deepEqual(await settleRetagHolds(holds, byId, ['方法', '其他'], { nowIso: NOW }), { resolved: 0, open: 1, retry: [] }, '未要求重試')
            await requestRetry(holds, key, { at: '2026-10-04T11:30:00+08:00' })
            assert.deepEqual(await settleRetagHolds(holds, byId, ['方法', '其他'], { nowIso: NOW }), { resolved: 0, open: 1, retry: ['風險'] })
            assert.deepEqual(await settleRetagHolds(holds, new Map([['n9', { id: 'n9', category: '其他' }]]), ['方法', '其他'], { nowIso: NOW }), { resolved: 1, open: 0, retry: [] })
            assert.equal((await holds.get(key)).how, '類別已在清單內（其他）')
            // 筆記已不在 → 結案
            const h2 = memStore([])
            await putRetagHold(h2, { id: 'gone', title: '丙' }, { category: '風險', why: 'x', fails: 2, nowIso: NOW })
            assert.deepEqual(await settleRetagHolds(h2, new Map(), ['方法'], { nowIso: NOW }), { resolved: 1, open: 0, retry: [] })
            assert.equal((await h2.get(holdKey('note', 'gone', 'SS9'))).how, '筆記已不存在')
        })

        it('下一步之字樣:指本套件之處置 API(重開 reviveFailedDocs、要求重試 requestRetry、豁免 waiveHold),不含執行端之指令、他工作或帳本代號;豁免後之記錄可追溯', async () => {
            const texts = { docRetry: DOC_HOLD_NEXT.retry, docUser: DOC_HOLD_NEXT.user, note: NOTE_HOLD_NEXT, retag: RETAG_HOLD_NEXT }
            for (const [k, t] of Object.entries(texts)) {
                assert.doesNotMatch(t, /revive-failed|standards\s+(waive|retry|holds)|CLI|指令|關聯|提煉|規則帳本|[A-Z]{2,5}-\d{2}/, `${k}:${t}`)
            }
            assert.equal(DOC_HOLD_NEXT.retry, '下輪附回饋重摘')
            assert.ok(DOC_HOLD_NEXT.user.includes('reviveFailedDocs') && DOC_HOLD_NEXT.user.includes('waiveHold'), DOC_HOLD_NEXT.user)
            assert.ok(NOTE_HOLD_NEXT.includes('waiveHold'), NOTE_HOLD_NEXT)
            assert.ok(RETAG_HOLD_NEXT.includes('requestRetry') && RETAG_HOLD_NEXT.includes('waiveHold'), RETAG_HOLD_NEXT)
            assert.ok(Object.isFrozen(DOC_HOLD_NEXT))
            // 所指之 API 即本套件之待判處置:豁免後記錄裁示
            const holds = memStore()
            await putDocHold(holds, doc, { std: 'SS2', why: 'x', terminal: true, tries: 3, nowIso: NOW })
            const w = await waiveHold(holds, 'doc:a:SS2', { by: '使用者', ruling: '確認不納入', at: NOW })
            assert.deepEqual([w.status, w.waivedBy, w.ruling], ['waived', '使用者', '確認不納入'])
        })
    })

    // ══════════════════════════ taxonomy ══════════════════════════
    describe('分類法(stores/taxonomy)', function() {
        const BASE = { categories: ['方法', '風險', '其他'], claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] }
        const R = (o) => resolveSummarizeVocab(o)

        it('版本:清單只換順序不變、guide 措辭不計;宣告變動即變', () => {
            const v1 = taxonomyVersion(taxonomyOf(R(BASE)))
            assert.equal(taxonomyVersion(taxonomyOf(R({ ...BASE, categories: ['其他', '風險', '方法'] }))), v1)
            assert.equal(taxonomyVersion(taxonomyOf(R({ ...BASE, guide: { summarize: { regime: '換句話' }, faith: { scope: '換句話' } } }))), v1)
            assert.notEqual(taxonomyVersion(taxonomyOf(R({ ...BASE, categoryHints: { 風險: ['回撤'] } }))), v1)
        })

        it('首次只記錄(不排工作);新增 → AI 重判、改名 → 機械、退役 → AI 重判、未宣告之移除 → 守門(宣告或恢復後撤銷)', () => {
            const s0 = syncTaxonomy(null, R(BASE), NOW)
            assert.deepEqual([s0.initialized, s0.state.jobs.length], [true, 0])
            const v2 = R({ categories: ['方法論', '其他', '新類'], claimTypes: ['實證研究'], evidenceLevels: ['高', '中', '低'], categoryRenames: { 方法: '方法論' } })
            const s1 = syncTaxonomy(s0.state, v2, NOW)
            assert.deepEqual(s1.added.map((j) => j.id).sort(), ['rejudge:add:新類', 'rename:category:方法'], '改名之目標「方法論」不算新增(不觸發落點類別之全量重判)')
            assert.deepEqual(s1.pending, [{ field: 'category', name: '風險' }, { field: 'claimType', name: '觀點評論' }])
            const v3 = R({ ...v2, categoryRetire: ['風險'], claimTypes: ['實證研究', '觀點評論'] })
            const s2 = syncTaxonomy(s1.state, v3, NOW)
            assert.deepEqual(s2.added.map((j) => j.id), ['rejudge:retire:風險'])
            assert.deepEqual(s2.pending, [], '退役已宣告 → 轉工作;內容類型恢復 → 撤銷守門')
        })

        it('連續改版:改名目標再改名 → 循對照前進;目標退役 → 轉為舊類別之退役重判;新增又移除 → 作廢;舊名放回清單 → 作廢', () => {
            const s0 = syncTaxonomy(null, R(BASE), NOW).state
            const s1 = syncTaxonomy(s0, R({ ...BASE, categories: ['方法二', '風險', '其他'], categoryRenames: { 方法: '方法二' } }), NOW).state
            const chain = syncTaxonomy(s1, R({ ...BASE, categories: ['方法三', '風險', '其他'], categoryRenames: { 方法: '方法二', 方法二: '方法三' } }), NOW).state
            assert.equal(chain.jobs.find((j) => j.kind === 'rename').to, '方法三')
            const retired = syncTaxonomy(s1, R({ ...BASE, categories: ['風險', '其他'], categoryRetire: ['方法', '方法二'] }), NOW).state
            assert.ok(retired.jobs.some((j) => j.id === 'rejudge:retire:方法'), JSON.stringify(retired.jobs.map((j) => j.id)))
            const sAdd = syncTaxonomy(s0, R({ ...BASE, categories: [...BASE.categories, '新類'] }), NOW).state
            const sGone = syncTaxonomy(sAdd, R(BASE), NOW)
            assert.deepEqual(sGone.voided.map((j) => j.id), ['rejudge:add:新類'])
            const back = syncTaxonomy(s1, R(BASE), NOW)
            assert.ok(back.voided.some((j) => j.id === 'rename:category:方法'), '舊名放回清單:不再搬離')
        })

        it('retagTargetOf:新增類別之工作,非落點筆記只在原類別／新類別間判(平移回原類別);落點類別、原類別不在清單、退役與 requeue 為清單內任一', () => {
            const cur = taxonomyOf(R({ ...BASE, categories: [...BASE.categories, '新類'] }))
            const add = { reason: 'add', category: '新類' }
            assert.equal(retagTargetOf(add, { category: '方法' }, '新類', cur), '新類')
            assert.equal(retagTargetOf(add, { category: '方法' }, '方法', cur), '方法')
            assert.equal(retagTargetOf(add, { category: '方法' }, '風險', cur), '方法', '兩既有類別間之平移不是新增類別所觸發')
            assert.equal(retagTargetOf(add, { category: '其他' }, '風險', cur), '風險', '落點類別依清單擇一')
            assert.equal(retagTargetOf(add, { category: '舊' }, '風險', cur), '風險', '原類別不在清單者須改選')
            assert.equal(retagTargetOf({ reason: 'retire', category: '舊' }, { category: '舊' }, '風險', cur), '風險')
            assert.equal(retagTargetOf({ reason: 'requeue', category: '方法' }, { category: '方法' }, '風險', cur), '風險', '維運排入之重判為全面重判')
        })

        it('狀態檔:不存在 → null(首次);存在而無法解析 → 拋錯(不當首次重建)', () => {
            const f = `${TMP}/state-x/taxonomy.json`
            const st = createTaxonomyStore(f)
            assert.equal(st.load(), null)
            fs.mkdirSync(path.dirname(f), { recursive: true })
            fs.writeFileSync(f, '{ broken')
            assert.throws(() => st.load(), /分類法狀態檔無法解析或格式版本不符/)
        })

        it('狀態檔之檔名為單一常數;save 原子寫入並帶格式版本、load 補齊缺欄;格式版本不符即拋;路徑非字串即拋', () => {
            assert.deepEqual([TAXONOMY_STATE_FILE, TAXONOMY_STATE_VERSION], ['taxonomy.json', 1])
            const f = path.join(TMP, 'state-y', TAXONOMY_STATE_FILE)
            fs.mkdirSync(path.dirname(f), { recursive: true })
            const st = createTaxonomyStore(f)
            const s0 = syncTaxonomy(null, R(BASE), NOW).state
            st.save(s0)
            assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).stateVersion, TAXONOMY_STATE_VERSION)
            assert.deepEqual(st.load(), { ...s0, stateVersion: 1 })
            fs.writeFileSync(f, JSON.stringify({ version: 'x', applied: {}, stateVersion: 1 }))
            assert.deepEqual(st.load(), { jobs: [], pending: [], mdStale: [], history: [], version: 'x', applied: {}, stateVersion: 1 })
            fs.writeFileSync(f, JSON.stringify({ version: 'x', stateVersion: 2 }))
            assert.throws(() => st.load(), /格式版本不符/)
            assert.throws(() => createTaxonomyStore(''), /createTaxonomyStore 需要狀態檔路徑/)
        })

        it('jobScope:新增類別之 categoryRaw 恰為該類別者機械改(零 AI)、落點類別者 AI 重判、已判過者排除;改名 → 舊值之筆記機械改', () => {
            const vocab = R(BASE)
            const notes = [{ id: 'n1', title: '甲', category: '其他', categoryRaw: '風控' }, { id: 'n2', title: '乙', category: '其他', categoryRaw: '另案' }, { id: 'n3', title: '丙', category: '方法', categoryRaw: '風控' }]
            const cur = taxonomyOf({ ...vocab, categories: [...vocab.categories, '風控'] })
            const sc = jobScope({ kind: 'rejudge', reason: 'add', category: '風控', judged: [] }, notes, cur)
            assert.deepEqual([sc.mechanical.length, sc.mechanical.map((n) => n.id), sc.ai.map((n) => n.id)], [2, ['n1', 'n3'], ['n2']])
            assert.deepEqual(jobScope({ kind: 'rejudge', reason: 'add', category: '風控', judged: ['n2'] }, notes, cur).ai, [], '已判過者排除')
            assert.deepEqual(jobScope({ kind: 'rename', field: 'category', from: '其他', to: '雜項' }, notes, cur).mechanical.map((n) => n.id), ['n1', 'n2'])
            assert.deepEqual(jobScope({ kind: 'rejudge', reason: 'retire', category: '方法', judged: [] }, notes, cur).ai.map((n) => n.id), ['n3'])
        })

        it('queueRejudge:排入工作並記沿革;同一 id 不重複', () => {
            const s = syncTaxonomy(null, R(BASE), NOW).state
            assert.deepEqual(queueRejudge(s, 'requeue', '其他', NOW), { added: true, id: 'rejudge:requeue:其他' })
            assert.deepEqual(queueRejudge(s, 'requeue', '其他', NOW), { added: false, id: 'rejudge:requeue:其他' })
            assert.deepEqual([s.jobs.length, s.history.at(-1).event, s.history.at(-1).job], [1, 'requeue', 'rejudge:requeue:其他'])
        })

        it('rewriteFieldOf:frontmatter 該鍵;品質章行之值改寫至「（」或行尾(類別無行、只改 frontmatter);不修改輸入', () => {
            const md = { front: { category: '方法', claim_type: '實證研究', evidence_level: '高' }, body: '## 品質與證據標注\n\n- 內容類型：實證研究\n- 證據等級：高（有獨立驗證）\n- 數據樣本期間：未載明' }
            const ev = rewriteFieldOf(md, RENAME_FIELDS.evidenceLevel, '中')
            assert.deepEqual([ev.front.evidence_level, ev.body.includes('- 證據等級：中（有獨立驗證）')], ['中', true])
            const ct = rewriteFieldOf(md, RENAME_FIELDS.claimType, '理論模型')
            assert.ok(ct.body.includes('- 內容類型：理論模型\n'))
            const cat = rewriteFieldOf(md, RENAME_FIELDS.category, '風險')
            assert.deepEqual([cat.front.category, cat.body], ['風險', md.body])
            assert.equal(md.front.evidence_level, '高', '不修改輸入')
        })

        it('taxonomyFixOf(管線外入口之分類欄位確定性對應):在清單內不動;改名對照(可連續)→ 新名;類別仍在清單外 → 後備類別、原值存 categoryRaw(同 categoryOf);內容類型／證據等級無對照者不動;改名對照成環不無窮迴圈', () => {
            const cur = taxonomyOf({ categories: ['乙', '丙', '其他'], fallbackCategory: '其他', categoryRenames: { 甲: '乙', 舊: '甲' }, claimTypes: ['實證研究', '個案觀察'], claimTypeRenames: { 實務經驗: '個案觀察' }, evidenceLevels: ['高', '中', '低'] })
            assert.deepEqual(taxonomyFixOf({ category: '乙', claimType: '實證研究', evidenceLevel: '中' }, cur), { patch: {}, fields: [] })
            assert.deepEqual(taxonomyFixOf({ category: '舊' }, cur), { patch: { category: '乙' }, fields: [{ field: 'category', from: '舊', to: '乙', how: 'rename' }] }, '連續改名 舊→甲→乙')
            assert.deepEqual(taxonomyFixOf({ category: '甲', categoryRaw: '乙' }, cur).patch, { category: '乙', categoryRaw: null }, '提案已被採納 → categoryRaw 清空(同重標)')
            assert.deepEqual(taxonomyFixOf({ category: '丁' }, cur), { patch: { category: '其他', categoryRaw: '丁' }, fields: [{ field: 'category', from: '丁', to: '其他', how: 'fallback' }] })
            assert.deepEqual(taxonomyFixOf({ claimType: '實務經驗' }, cur).patch, { claimType: '個案觀察' })
            assert.deepEqual(taxonomyFixOf({ claimType: '清單外之型', evidenceLevel: '極高' }, cur), { patch: {}, fields: [] }, '內容類型／證據等級無對照 → 不動(交 SS2 之清單檢查)')
            const loop = taxonomyOf({ categories: ['其他'], fallbackCategory: '其他', categoryRenames: { A: 'B', B: 'A' } })
            assert.deepEqual(taxonomyFixOf({ category: 'A' }, loop).patch, { category: '其他', categoryRaw: 'A' }, '對照成環 → 視同清單外')
            assert.deepEqual([taxonomyFixOf(null, cur), taxonomyFixOf({ category: '' }, cur)], [{ patch: {}, fields: [] }, { patch: {}, fields: [] }])
        })

        it('retagJobLabelOf(工作名稱之單一來源;重標日誌與維運之狀態預覽同用):改名以欄位之顯示名、重判以原因之顯示名;欄位之顯示名與去向宣告處取 RENAME_FIELDS', () => {
            assert.deepEqual(['category', 'claimType', 'evidenceLevel'].map((f) => [RENAME_FIELDS[f].label, RENAME_FIELDS[f].decl]), [
                ['類別', 'vocab.categoryRenames 或 categoryRetire'], ['內容類型', 'vocab.claimTypeRenames'], ['證據等級', 'vocab.evidenceLevelRenames'],
            ])
            assert.equal(retagJobLabelOf({ kind: 'rename', field: 'evidenceLevel', from: '極高', to: '高' }), '證據等級改名「極高」→「高」')
            assert.deepEqual(['add', 'retire', 'requeue'].map((reason) => retagJobLabelOf({ kind: 'rejudge', reason, category: '乙' })), ['新增類別「乙」', '退役類別「乙」', '重判類別「乙」'])
            assert.deepEqual(REJUDGE_REASON_LABELS, { add: '新增類別', retire: '退役類別', requeue: '重判類別' })
        })

        it('taxonomySnapshotOf(唯讀快照;巡檢用):版本、待處理工作數、守門數、md 待修補數;狀態檔不存在、無法解析或格式版本不符 → null(不拋)', () => {
            const dir = path.join(TMP, 'tax-snap')
            fs.mkdirSync(dir, { recursive: true })
            assert.equal(taxonomySnapshotOf(dir), null, '不存在')
            const store = createTaxonomyStore(path.join(dir, TAXONOMY_STATE_FILE))
            store.save({ version: 'v1', applied: {}, jobs: [{ id: 'j1' }, { id: 'j2' }], pending: [{ field: 'category', name: '甲' }], mdStale: ['n1'], history: [] })
            assert.deepEqual(taxonomySnapshotOf(dir), { version: 'v1', jobs: 2, guards: 1, mdStale: 1 })
            fs.writeFileSync(path.join(dir, TAXONOMY_STATE_FILE), '{壞', 'utf8')
            assert.equal(taxonomySnapshotOf(dir), null, '無法解析')
            fs.writeFileSync(path.join(dir, TAXONOMY_STATE_FILE), JSON.stringify({ stateVersion: 999, version: 'x' }), 'utf8')
            assert.equal(taxonomySnapshotOf(dir), null, '格式版本不符')
            assert.equal(taxonomySnapshotOf(undefined), null)
        })
    })

    // ══════════════════════════ materialPolicy ══════════════════════════
    describe('素材問題(stores/materialPolicy)', function() {
        // ── 理由樣本(皆為合成之中立樣本;各樣式至少一例,與各樣式之正反例對應)──
        // 直指素材壞了(各樣式至少一例)
        const MATERIAL = [
            '內文為亂碼無法辨識，無可萃取的方法論、技術、參數或做法。',
            '展覽導覽評論亂碼', // 預篩短理由
            '原文為某公司產品型錄頁面，內容大量encoding錯誤無法辨識；核心為產品簡介，屬廠商內容類別，不符合收錄條件。',
            '內文實質內容未成功載入（僅包含網頁動態載入佔位文字 Loading paragraph 與作者簡介），且主題定位為園藝入門之科普比較，無具體方法、模型或參數。',
            '網頁內容載入失敗（僅包含「Loading paragraph...」等動態前端佔位符與作者簡介），缺乏實質正文與具體做法。',
            '頁面內容為入口網站之選單、熱門排行與不相關標題列表（天氣預報、交通快訊、球賽賽程等），標題雖提及「某研究所季度報告」，但內文完全未載入該報告之實質內容，無法萃取任何方法。',
            '為單一產品的個人評等與觀點文章，內文被截斷且夾帶免責聲明，僅提及該產品用 14 個項目評分，未給出可複用的方法或參數',
            '內文只有作者回憶某次旅程的開頭，以及「沒有永遠有效的路線」這個觀點。原文被截斷，沒有方法、數據或可驗證的參數，屬於沒有方法的評論',
            '內文僅為兩句且語句中斷（截斷於 nests the work of）的論文摘要片段，未包含具體方法、技術、參數、做法或實證結論，缺乏可長期複用的知識。',
            '純網站導覽無內文',
            '合作公告內容空白',
            '僅擷取到某論文頁面之書目工具、程式碼／資料連結、Demo 區塊等導覽元件，未取得摘要正文內容，無法萃取任何方法、參數或結論',
            '抓取結果僅為裝置驗證頁（Verification failed），無實質內容；且主題為家用電器之保養與費用指南，屬一般消費產品介紹，非本庫收錄之知識、技術、參數或做法。',
            '內文僅為網頁載入失敗的錯誤提示,沒有任何實質內容可萃取;僅標題顯示主題為城市交通壅塞,但無方法可記錄。',
            '內文只抓到某入口網站的導覽列、人氣排行與欄目連結，沒有正文。從標題看是介紹單一項目機制的新聞，沒有可複用的方法、參數或做法。',
            'The article body is garbled (mojibake) beyond recognition.', // 合成:英文保險樣式
            'Page failed to load; only a cookie banner remains.', // 合成
        ]
        // 題材判斷(非素材問題;含「編碼／付費／截斷／載入」等易混字者優先)
        const TOPIC = [
            '為某公司單季營運公告新聞，屬企業快訊，無任何可收錄的方法、參數或做法內容。',
            '本文為某最佳化演算法之整數-二進位編碼機制研究，僅以數學基準函數測試，未包含任何實際應用場景之方法論。',
            '本文為付費商業新聞稿（Paid Press Release）與新平台上線之產品發布公告，缺乏具體的操作方法、演算法數學模型或實證數據。',
            '本文為視頻編碼（H.264/AVC）之無參考品質評估研究，探討DCT係數模型化與感知加權方法，全無可收錄之知識、做法、參數或方法論。',
            '圖表主觀解讀',
            '試算未載入折舊成本，結論不可靠', // 合成:裸「未載入」不得收
            '此文方法內容缺失，屬一般評論', // 合成:「內容缺失」是題材判斷
            '採截斷常態分配推導期望值，屬純數學推導', // 合成:統計術語之截斷
            'There is no body of evidence supporting this claim.', // 合成
            '模型未載入預訓練權重，屬實驗設定之描述', // 合成:中立之題材判斷(裸「未載入」)
        ]
        // 存取限制(換抓法也取不到 → 不退回)
        const ACCESS = [
            '付費牆阻擋之新聞頁面，無實質內文，未包含可收錄之知識、技術或方法。',
            '僅為某社群網站登入頁面與免責聲明，無可收錄之知識、方法、參數或做法內容。',
        ]

        it('problemOf:素材問題之理由皆命中(回傳命中片段);題材判斷不命中;付費牆／登入(存取限制)排除', () => {
            const p = createMaterialPolicy()
            for (const r of MATERIAL) assert.ok(p.problemOf(r), `應命中:${r}`)
            for (const r of TOPIC) assert.equal(p.problemOf(r), '', `不應命中:${r}`)
            for (const r of ACCESS) assert.equal(p.problemOf(r), '', `存取限制應排除:${r}`)
            assert.equal(p.problemOf(MATERIAL[0]), '亂碼')
            assert.equal(p.problemOf(''), '')
            assert.equal(p.problemOf(undefined), '')
        })

        // 依取得方式排除之方法與抓取端之退回欄位(refetchRequestOf)屬抓取套件,其逐案測試在抓取套件
        it('refetchPatchOf:抓取端欄位(抓取套件 refetchRequestOf:瀏覽器佇列、排除方法)＋摘要自身欄位(清預篩與摘要舊判定、formatRefetches);fetchTries 不動;不適用者回 null', () => {
            const p = createMaterialPolicy()
            const o = { nowIso: '2026-10-04T10:00:00+08:00', capture: { browser: { perRun: 3 } } }
            const rp = p.refetchPatchOf({ id: 'd', textFrom: 'article', fetchTries: 2 }, MATERIAL[0], o)
            assert.deepEqual(rp, {
                status: 'new', fetcher: 'browser', lastClass: 'render', refetchSkip: ['curl'], deferredAt: o.nowIso,
                formatRefetches: 1, lastReason: 'material', lastError: `摘要回報素材問題（亂碼）：${MATERIAL[0]}`,
                triage: null, triagedAt: null, triageTries: 0, summarizeTries: 0, skipReason: '',
            })
            assert.equal(p.refetchPatchOf({ textFrom: 'article' }, TOPIC[0], o), null, '題材判斷')
            assert.equal(p.refetchPatchOf({ textFrom: 'article' }, ACCESS[0], o), null, '存取限制')
            assert.equal(p.refetchPatchOf({ textFrom: 'abstract' }, MATERIAL[0], o), null, 'grid 摘要:素材即 API 摘要')
            assert.equal(p.refetchPatchOf({ textFrom: 'feed' }, MATERIAL[0], o), null, 'feed 退路')
            assert.equal(p.refetchPatchOf({ textFrom: 'article' }, MATERIAL[0], { ...o, capture: { browser: { perRun: 0 } } }), null, '瀏覽器分流停用(抓取套件判)')
            assert.equal(p.refetchPatchOf({ textFrom: 'article' }, MATERIAL[0], { nowIso: o.nowIso }), null, '未給抓取設定 → 視同停用')
            assert.equal(p.refetchPatchOf({ textFrom: 'article', formatRefetches: 1 }, MATERIAL[0], o), null, '已退回達上限(預設 1)')
            assert.equal(createMaterialPolicy({ max: 2 }).refetchPatchOf({ textFrom: 'article', formatRefetches: 1 }, MATERIAL[0], o).formatRefetches, 2)
            assert.equal(createMaterialPolicy({ max: 0 }).refetchPatchOf({ textFrom: 'article' }, MATERIAL[0], o), null, '0＝停用回報')
        })

        it('安裝方追加樣式接在內建之後;樣式形狀或語法不合法即拋錯(含設定名)', () => {
            const p = createMaterialPolicy({ patterns: [{ p: '只剩表格骨架', f: '' }] })
            assert.equal(p.problemOf('內文只剩表格骨架'), '只剩表格骨架')
            assert.ok(p.problemOf(MATERIAL[0]), '內建樣式仍在')
            assert.throws(() => createMaterialPolicy({ patterns: [{ p: '(' }] }), /summarize\.refetch\.patterns\[0\] 樣式不合法/)
            assert.throws(() => createMaterialPolicy({ patterns: ['abc'] }), /summarize\.refetch\.patterns\[0\] 須為 RegExp/)
            assert.ok(MATERIAL_PROBLEM_PATTERNS_DEFAULT.length > 0)
        })
    })
})
