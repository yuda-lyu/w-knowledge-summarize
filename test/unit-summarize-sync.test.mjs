// unit-summarize-sync.test.mjs — 筆記內容變更之偵測與同步(ops/syncNotes、stages/syncStage):同步雜湊、水位、同步入口同受筆記標準、詞彙之送達
// 規則(出自兩檔檔頭與 JSDoc;所有寫入入口同受標準):
//   Y1 雜湊不同 → 以 noteFixOf(SS2／SS3／SS6／SS11,與存量處置同一函數)修內容章(連結與網址不轉)、有改則寫回 md、記錄 stdFixes「同步 SSx」、INFO
//   Y2 仍不合格／未能判定 → 待判(note、該標準、user、期限);不擋同步(記錄照寫、knowledgeChangedAt 照寫)
//   Y3 SS11 嚴式 → 降級寫回 md 與記錄;Y4 寬式 → 待判 SS11(未能判定)——規則取詞彙表之 evidenceRule
//   Y5 有原文(原文另存)→ 含 SS4;Y6 無原文 → 不檢 SS4;Y7 擠標籤各段皆既有概念 → 拆開寫回
//   Y8 已登錄者:使用者改他章(雜湊不變)→ 重驗(不修、不改記錄),合格即結案;Y9 筆記已不在 → 結案
//   Y10 未開 holds → WARN 一次、同步照做;Y11 未給詞彙表 → WARN 一次;子階段把詞彙交給同步並記計數
//   C 偵測端:首見回填不觸發;雜湊往返穩定;陣列欄寫回不殘留(真 LMDB);CRLF、只改他章、分類欄、詞彙別名皆不觸發;改標題／概念換位／
//     改重點即同步並寫 knowledgeChangedAt;水位與全量讀;md 讀不到計數(不視為刪除)
//   V 詞彙之送達:deps.vocab(或 deps.domains.summarize.vocab)缺席 → 原行為(WARN 一次、依賴詞彙之判定略過);給了而未經本套件解析 → 拋錯
//     (證據規則不得在本入口無聲失效);子階段先取生效之摘要 domain 之詞彙表、再取 deps.vocab
//   L 語言設定之送達:子階段把每輪依賴之 deps.locale 交給同步(與納入閘同一來源);非繁體中文時 SS3 不判、不轉字形;未給＝臺灣正體
// 移植原實作之 unit-summarize-sync(72、92、104、118、130、141、165、175)與 unit-relate-change(72、87、110、131、147;只取摘要側:同步雜湊、
//   同步、同步子階段;87 為真 LMDB 案)各案(斷言不變;SS11 相關之案之詞彙給回中立題材之規則 NEUTRAL_RULE;日誌之結尾字樣隨面向使用者之字樣
//   通用化而改,所比對之前段不變);V 為新增。
// 執行:自套件根 node <mocha> test/unit-summarize-sync.test.mjs(暫存 test/_tmp/summarize-sync-<pid>,測完即刪;不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WOrm from 'w-orm-lmdb/src/WOrmLmdb.mjs'
import W from 'w-data-pipeline/src/WDataPipeline.mjs'
import { memStore, setConceptFold, archiveDocText } from './tools/captureForTest.mjs'
import { recLog, NEUTRAL_RULE } from './tools/stageKit.mjs'
import { readMd, writeMd, mdText } from '../src/core/md/md.mjs'
import { resolveSummarizeVocab } from '../src/core/vocab/summarizeVocab.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { buildNote } from '../src/stores/noteBuild.mjs'
import { syncNotes, NOTE_SYNC_STATE } from '../src/ops/syncNotes.mjs'
import { stageSync } from '../src/stages/syncStage.mjs'

const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/summarize-sync-${process.pid}`).replace(/\\/g, '/')
const NOW = '2026-10-05T10:00:00+08:00'
const clock = { iso8: () => NOW }
const BASE = { claimTypes: ['實證研究', '觀點評論'], evidenceLevels: ['高', '中', '低'] }
/** 移植案之詞彙(原為 plain 物件＋原實作內建之 SS11;此處給回該規則) */
const DOMAIN = createSummarizeDomain({ vocab: { ...BASE, evidenceRule: NEUTRAL_RULE } })
let seq = 0
const NOTE = (o = {}) => ({ title: '動量因子', concepts: ['動量因子', '回測'], summary: '動量於台股有效', key_points: ['台股動量年化超額 8.2%'], claim_type: '實證研究', evidence_level: '中', caveats: [], ...o })

/**
 * 以正式組裝建筆記並首見回填雜湊;回傳環境
 * @param {Array} items 輸入摘要項目
 * @param {Object} [o] 輸入 { noHolds, noVocab, extraNotes:Array(其他筆記記錄,供既有概念) }
 * @returns {Object} 回傳 { notes, holds, docs, docTexts, deps, log }
 */
async function env(items, o = {}) {
    const dir = `${TMP}/e${++seq}`
    const recs = items.map((k, i) => {
        const b = buildNote({ k, doc: { id: `d${i}`, title: '原文', sourceName: '來源', url: `https://example.com/${i}`, publishedAt: '2026-01-01' }, domain: DOMAIN, notesDir: `${dir}/notes`, nowIso: '2026-10-01T00:00:00+08:00' })
        writeMd(b.file, b.front, b.body)
        return { ...b.record, relatedAt: '2026-10-02T00:00:00+08:00' }
    })
    const notes = memStore([...recs, ...(o.extraNotes || [])])
    const holds = o.noHolds ? null : memStore()
    const docs = memStore(items.map((_, i) => ({ id: `d${i}`, status: 'noted', title: '原文', url: `https://example.com/${i}` })))
    const docTexts = memStore()
    const log = recLog()
    const deps = { stores: { notes, docs, docTexts, ...(holds ? { holds } : {}) }, dirs: { state: `${dir}/state` }, clock, log, ...(o.noVocab ? {} : { vocab: DOMAIN.vocab }) }
    await syncNotes(deps) // 首見回填
    return { notes, holds, docs, docTexts, deps, log, rec: (i = 0) => notes.get(recs[i].id), file: (i = 0) => recs[i].file }
}
/** 改寫 md 並把 mtime 推後(晚於水位) */
const edit = (file, fn, sec = 5) => {
    const md = readMd(file)
    const { front, body } = fn(md)
    writeMd(file, front, body)
    const t = new Date(Date.now() + sec * 1000)
    fs.utimesSync(file, t, t)
}

describe('unit-summarize-sync', function() {

    before(() => fs.mkdirSync(TMP, { recursive: true }))
    after(() => fs.rmSync(TMP, { recursive: true, force: true }))

    // ══════════════════════════ 同步入口同受筆記標準 ══════════════════════════
    describe('同步入口同受筆記標準(ops/syncNotes)', function() {

        it('Y1 改標題與重點(含簡體)→ 確定性修正寫回 md(連結與網址不轉)、記錄同步正體值與 stdFixes「同步 SS3」、INFO;knowledgeChangedAt 照寫', async () => {
            const e = await env([NOTE()])
            // 只改違規處(抓取套件之 textForms;「于」為合法正體字,不在違規表 → 不改)
            edit(e.file(), (md) => ({ front: { ...md.front, title: '动量因子之风险' }, body: md.body.replace('動量於台股有效', '动量对美股有效，见 [[简体链接-abc12345]] 与 https://example.com/简体路径') }))
            const r = await syncNotes(e.deps)
            const md = readMd(e.file())
            assert.equal(md.front.title, '動量因子之風險')
            assert.ok(md.body.includes('動量對美股有效，見 [[简体链接-abc12345]] 與 https://example.com/简体路径'), md.body)
            const n = await e.rec()
            assert.deepEqual([n.title, n.summary, !!n.knowledgeChangedAt, r.changed, r.stdFixed], ['動量因子之風險', '動量對美股有效，見 [[简体链接-abc12345]] 與 https://example.com/简体路径', true, 1, 1])
            assert.ok(n.stdFixes.some((x) => /^同步 SS3：標題「动量因子之风险」→「動量因子之風險」/.test(x)) && n.stdFixes.some((x) => x === '同步 SS3：內容章轉正體'), JSON.stringify(n.stdFixes))
            assert.ok(e.log.lines.some((l) => /^INFO 筆記同步：\[.+\] 確定性修正 \d+ 處（SS3/.test(l)), e.log.lines.join('\n'))
            // SS3:連結與網址不計(與修正同一定義)→ 修正後即合格,不入待判
            assert.equal(await e.holds.get(`note:${n.id}:SS3`), null, '修正後合格 → 無 SS3 待判')
            // 寫回之 md 下次被讀到:雜湊與記錄相同 → 不再視為變更
            const t = new Date(Date.now() + 9000)
            fs.utimesSync(e.file(), t, t)
            assert.equal((await syncNotes(e.deps)).changed, 0)
        })

        it('Y2 改概念為 1 個(SS2 修不了)→ 待判 note／SS2／user／期限 30 天;同步照做(記錄概念已更新)', async () => {
            const e = await env([NOTE()])
            edit(e.file(), (md) => ({ front: { ...md.front, concepts: ['動量因子'] }, body: md.body }))
            const r = await syncNotes(e.deps)
            const n = await e.rec()
            assert.deepEqual([n.concepts, r.changed, r.stdHeld], [['動量因子'], 1, 1])
            const h = await e.holds.get(`note:${n.id}:SS2`)
            assert.deepEqual([h.status, h.owner, h.deadline], ['open', 'user', new Date(Date.parse(NOW) + 30 * 86400_000).toISOString()])
            assert.match(h.reason, /^筆記同步後未達檢定標準（SS2）：〈動量因子〉概念 1 個（須 2～6）/)
            assert.match(h.next, /使用者修正 md 後由筆記同步重驗/)
        })

        it('Y3 最高證據等級＋明確自承無獨立觀測(嚴式)→ 降級寫回 md 與記錄;Y4 只涉及(寬式)→ 待判 SS11(未能判定)', async () => {
            const e = await env([NOTE(), NOTE({ title: '另一篇' })])
            edit(e.file(0), (md) => ({ front: { ...md.front, title: '動量因子（修訂）', evidence_level: '高', caveats: ['無獨立觀測證實'] }, body: md.body.replace('證據等級：中', '證據等級：高') }))
            edit(e.file(1), (md) => ({ front: { ...md.front, title: '另一篇（修訂）', evidence_level: '高', caveats: ['摘要未揭露獨立觀測證實之資料範圍與細節'] }, body: md.body.replace('證據等級：中', '證據等級：高') }))
            await syncNotes(e.deps)
            const a = await e.rec(0)
            assert.deepEqual([readMd(e.file(0)).front.evidence_level, a.evidenceLevel], ['中', '中'])
            assert.ok(a.stdFixes.some((x) => /^同步 SS11：證據等級「高」→「中」/.test(x)))
            const b = await e.rec(1)
            const h = await e.holds.get(`note:${b.id}:SS11`)
            assert.deepEqual([readMd(e.file(1)).front.evidence_level, h?.owner], ['高', 'user'], '寬式不自動降級')
            assert.match(h.reason, /^筆記同步後未能判定（SS11）/)
        })

        it('Y5 有原文(docTexts)→ 檢 SS4:內容含原文沒有之數字 → 待判 SS4;Y6 無原文 → 不檢 SS4', async () => {
            const e = await env([NOTE(), NOTE({ title: '無原文者' })])
            assert.equal((await archiveDocText(e.docTexts, { id: 'd0', text: '台股動量年化超額 8.2%。', status: 'noted', title: '原文' }, NOW)).ok, true)
            for (const i of [0, 1]) edit(e.file(i), (md) => ({ front: { ...md.front, title: `${md.front.title}（修訂）` }, body: md.body.replace('- 台股動量年化超額 8.2%', '- 台股動量年化超額 8.2%\n- 夏普 1.9') }))
            await syncNotes(e.deps)
            const a = await e.rec(0)
            const h = await e.holds.get(`note:${a.id}:SS4`)
            assert.match(h?.reason || '', /^筆記同步後未達檢定標準（SS4）：〈動量因子（修訂）〉原文沒有之數字：1\.9/)
            const b = await e.rec(1)
            assert.equal(await e.holds.get(`note:${b.id}:SS4`), null, '無原文 → 不檢 SS4(同人工匯入)')
        })

        it('Y7 擠一標籤之多概念,各段皆為既有概念 → 拆開寫回;有段非既有 → 不拆、待判 SS6', async () => {
            const extraNotes = [{ id: 'x', title: 'x', concepts: ['市場微結構', '流動性'], file: `${TMP}/none.md`, syncHash: 'h' }]
            const e = await env([NOTE(), NOTE({ title: '乙篇' })], { extraNotes })
            edit(e.file(0), (md) => ({ front: { ...md.front, concepts: ['市場微結構、流動性', '動量因子'] }, body: md.body }))
            edit(e.file(1), (md) => ({ front: { ...md.front, concepts: ['新奇概念、流動性', '動量因子'] }, body: md.body }))
            await syncNotes(e.deps)
            assert.deepEqual([readMd(e.file(0)).front.concepts, (await e.rec(0)).concepts], [['市場微結構', '流動性', '動量因子'], ['市場微結構', '流動性', '動量因子']])
            const b = await e.rec(1)
            assert.deepEqual([b.concepts, (await e.holds.get(`note:${b.id}:SS6`))?.owner], [['新奇概念、流動性', '動量因子'], 'user'])
        })

        it('Y8 已登錄者:使用者只改他章(雜湊不變)→ 重驗(不修、不改記錄),合格即結案;Y9 筆記已不在 → 結案', async () => {
            const e = await env([NOTE(), NOTE({ title: '將刪者' })])
            // 改標題(雜湊變)時把證據等級改高而限制只涉及獨立觀測 → SS11 未能判定之待判;另一篇概念剩 1 個 → SS2 待判
            edit(e.file(0), (md) => ({ front: { ...md.front, title: '動量因子（修訂）', evidence_level: '高', caveats: ['摘要未揭露獨立觀測證實之資料範圍與細節'] }, body: md.body.replace('證據等級：中', '證據等級：高') }))
            edit(e.file(1), (md) => ({ front: { ...md.front, concepts: ['將刪'] }, body: md.body }))
            await syncNotes(e.deps)
            const a0 = await e.rec(0)
            const b0 = await e.rec(1)
            assert.deepEqual([(await e.holds.get(`note:${a0.id}:SS11`)).status, (await e.holds.get(`note:${b0.id}:SS2`)).status], ['open', 'open'])
            // 使用者只改限制(frontmatter caveats;不在同步雜湊內)→ 雜湊不變 → 重驗合格 → 結案;記錄不動
            edit(e.file(0), (md) => ({ front: { ...md.front, caveats: ['單一市場'] }, body: md.body }), 10)
            const before = await e.rec(0)
            const r = await syncNotes(e.deps)
            assert.deepEqual([r.changed, r.stdResolved], [0, 1], '雜湊不變:不同步,只重驗')
            const h = await e.holds.get(`note:${a0.id}:SS11`)
            assert.deepEqual([h.status, h.how], ['resolved', '筆記同步重驗合格'])
            assert.deepEqual(await e.rec(0), before, '重驗不改記錄')
            // Y9:筆記已不在 → 結案
            await e.notes.del(b0.id)
            await syncNotes(e.deps)
            const hb = await e.holds.get(`note:${b0.id}:SS2`)
            assert.deepEqual([hb.status, hb.how], ['resolved', '筆記已不存在'])
        })

        it('Y10 未開 holds → WARN 一次、同步照做;Y11 未給詞彙表 → WARN 一次(清單欄與 SS11 不判)', async () => {
            const e = await env([NOTE(), NOTE({ title: '乙' })], { noHolds: true, noVocab: true })
            for (const i of [0, 1]) edit(e.file(i), (md) => ({ front: { ...md.front, concepts: ['唯一'] }, body: md.body }))
            const r = await syncNotes(e.deps)
            assert.equal(r.changed, 2)
            assert.equal(e.log.lines.filter((l) => /^WARN 筆記同步：未開 holds 集合/.test(l)).length, 1)
            assert.equal(e.log.lines.filter((l) => /^WARN 筆記同步：未給詞彙表/.test(l)).length, 1)
            assert.deepEqual((await e.rec(0)).concepts, ['唯一'], '不擋同步')
        })

        it('子階段:把 deps.vocab 交給同步(SS11 有判)並記錄檢定標準之計數', async () => {
            const e = await env([NOTE()], { noVocab: true })
            edit(e.file(), (md) => ({ front: { ...md.front, title: '動量因子（修訂）', evidence_level: '高', caveats: ['無獨立觀測證實'] }, body: md.body.replace('證據等級：中', '證據等級：高') }))
            const bag = {}
            const ctx = { deps: { ...e.deps, vocab: DOMAIN.vocab }, log: e.log, set: (k, v) => { bag[k] = v }, get: (k, d) => bag[k] ?? d }
            const rep = await stageSync().run(ctx)
            assert.deepEqual([rep.detail.changed, rep.detail.stdFixed, (await e.rec()).evidenceLevel], [1, 1, '中'])
            assert.ok(e.log.lines.some((l) => /^INFO 筆記同步之檢定標準：確定性修正 1 篇/.test(l)), e.log.lines.join('\n'))
        })
    })

    // ══════════════════════════ 偵測端(同步雜湊、水位)══════════════════════════
    describe('內容變更之偵測(同步雜湊、水位、md 讀不到)', function() {
        const D0 = createSummarizeDomain({})
        const DOC = { id: 'd1', title: '原文', sourceName: '來源', url: 'https://example.com/a', publishedAt: '2026-01-01' }
        let tick = 0
        const tclock = { iso8: () => `2026-10-04T10:00:${String(tick++ % 60).padStart(2, '0')}+08:00`, stamp8: () => '20261004100000' }
        /**
         * 以正式組裝(buildNote → writeMd)建筆記,回傳 { notes, deps, log }
         * @param {Array} items 輸入摘要項目
         * @returns {Object} 回傳環境
         */
        const envC = (items) => {
            const dir = `${TMP}/c${++seq}`
            const recs = items.map((k, i) => {
                const b = buildNote({ k, doc: { ...DOC, id: `d${i}` }, domain: D0, notesDir: `${dir}/notes`, nowIso: '2026-10-01T00:00:00+08:00' })
                writeMd(b.file, b.front, b.body)
                return { ...b.record, relatedAt: '2026-10-02T00:00:00+08:00' }
            })
            const notes = memStore(recs)
            const log = recLog()
            return { notes, log, deps: { stores: { notes }, dirs: { state: `${dir}/state` }, clock: tclock, log }, dir }
        }
        const later = (file, sec = 5) => {
            const t = new Date(Date.now() + sec * 1000)
            fs.utimesSync(file, t, t)
        }

        it('首見回填不觸發;雜湊經正式組裝(buildNote → writeMd → readMd)往返穩定——標題含 \\r／U+2028、重點多行、概念帶空白;第二次掃描零變更', async () => {
            const LS = String.fromCharCode(0x2028)
            const e = envC([
                { title: `甲\r乙${LS}丙`, concepts: [' 動量 ', '回測'], summary: '第一行\n第二行  空白', key_points: ['k'] },
                { title: '普通', concepts: ['價值'], summary: '一句話', key_points: ['k'] },
            ])
            const r1 = await syncNotes(e.deps)
            assert.deepEqual([r1.backfilled, r1.changed], [2, 0], '首見只回填')
            const rs = await e.notes.select()
            assert.ok(rs.every((n) => n.syncHash) && rs.every((n) => !n.knowledgeChangedAt))
            for (const n of rs) later(n.file) // mtime 晚於水位:須重讀並比對
            const r2 = await syncNotes(e.deps)
            assert.deepEqual([r2.read, r2.changed], [2, 0], '往返穩定:重讀後雜湊相同')
        })

        it('真 LMDB:概念變短與清空須真正寫回(集合 patch 為深合併、陣列依索引合併——[甲,乙]→[丙] 不得殘留成 [丙,乙]);回驗實際欄位', async () => {
            const dir = `${TMP}/lmdb${++seq}`
            const b = buildNote({ k: { title: '甲', concepts: ['甲概念', '乙概念'], summary: '重點', key_points: ['k'] }, doc: DOC, domain: D0, notesDir: `${dir}/notes`, nowIso: '2026-10-01T00:00:00+08:00' })
            writeMd(b.file, b.front, b.body)
            const notes = W.openCollection({ WOrm, path: `${dir}/db`, db: 'knowledge', cl: 'notes' })
            try {
                await notes.insertNew([{ ...b.record, relatedAt: '2026-10-02T00:00:00+08:00' }])
                const deps = { stores: { notes }, dirs: { state: `${dir}/state` }, clock: tclock, log: recLog() }
                await syncNotes(deps) // 首見回填
                for (const [concepts, want] of [[['丙概念'], ['丙概念']], [[], []], [['丁', '戊', '己'], ['丁', '戊', '己']], [['戊'], ['戊']]]) {
                    const md = readMd(b.file)
                    writeMd(b.file, { ...md.front, concepts }, md.body)
                    later(b.file, 5 + concepts.length)
                    const r = await syncNotes(deps)
                    assert.equal(r.changed, 1, JSON.stringify(concepts))
                    assert.deepEqual((await notes.get(b.record.id)).concepts, want, `概念寫回 ${JSON.stringify(concepts)}`)
                }
            }
            finally {
                await notes.close()
            }
        })

        it('不誤觸發:CRLF 重存、只改正文其他章(核心知識)、只改分類欄位(重標所寫)、詞彙別名改動(不過 normalizeConcept)', async () => {
            const e = envC([{ title: '甲', concepts: ['動量'], summary: '重點', key_points: ['k'] }])
            await syncNotes(e.deps)
            const n = (await e.notes.select())[0]
            const md = readMd(n.file)
            fs.writeFileSync(n.file, mdText(md.front, md.body).replace(/\n/g, '\r\n'), 'utf8') // 編輯器／git autocrlf 重存
            later(n.file, 5)
            assert.equal((await syncNotes(e.deps)).changed, 0, 'CRLF 不觸發')
            writeMd(n.file, { ...md.front, category: '另一類', evidence_level: '高' }, md.body.replace('- k', '- k\n- 使用者補充之核心知識'))
            later(n.file, 10)
            assert.equal((await syncNotes(e.deps)).changed, 0, '分類欄位與其他章之改動不觸發(下游判定不讀)')
            setConceptFold(null, { aliases: { 動量: '動量因子' } })
            try {
                later(n.file, 15)
                assert.equal((await syncNotes(e.deps)).changed, 0, '別名改動不觸發')
            }
            finally {
                setConceptFold(null, {})
            }
        })

        it('改標題／概念換位／改一句話重點 → 同步回記錄(title／concepts／summary)、寫 knowledgeChangedAt、日誌標明哪些欄;已有下游處理時刻者計數', async () => {
            const e = envC([{ title: '甲', concepts: ['動量', '回測'], summary: '舊重點', key_points: ['k'] }])
            await syncNotes(e.deps)
            const n0 = (await e.notes.select())[0]
            await e.notes.patch(n0.id, { extractedAt: '2026-10-03' })
            const md = readMd(n0.file)
            writeMd(n0.file, { ...md.front, title: '甲（修訂）', concepts: ['回測', '動量'] }, md.body.replace('舊重點', '新重點：條件改為月頻'))
            later(n0.file)
            const r = await syncNotes(e.deps)
            assert.deepEqual([r.changed, r.touchExtracted, r.changedIds], [1, 1, [n0.id]])
            const n1 = await e.notes.get(n0.id)
            assert.deepEqual([n1.title, n1.concepts, n1.summary], ['甲（修訂）', ['回測', '動量'], '新重點：條件改為月頻'])
            assert.ok(n1.knowledgeChangedAt && n1.syncHash !== n0.syncHash)
            assert.ok(e.log.lines.some((l) => /筆記內容變更：\[.+\] 標題、概念、一句話重點已改/.test(l)), e.log.lines.join('\n'))
            // 結尾指下游可依之記錄欄(不指他工作)
            assert.ok(e.log.lines.some((l) => /^INFO 筆記內容變更：\[.+\] 標題、概念、一句話重點已改，已同步回記錄（下游可依 knowledgeChangedAt 重判）$/.test(l)), e.log.lines.join('\n'))
        })

        it('水位:mtime 早於上次掃描者不讀;--all 全量讀;md 讀不到者計數(不視為刪除);子階段報告與摘要附段', async () => {
            const e = envC([{ title: '甲', concepts: ['a'], summary: 's', key_points: ['k'] }, { title: '乙', concepts: ['b'], summary: 's', key_points: ['k'] }])
            await syncNotes(e.deps)
            const st = JSON.parse(fs.readFileSync(`${e.deps.dirs.state}/${NOTE_SYNC_STATE}`, 'utf8'))
            assert.ok(st.scannedAtMs > 0)
            const old = new Date(st.scannedAtMs - 60_000)
            for (const n of await e.notes.select()) fs.utimesSync(n.file, old, old)
            assert.equal((await syncNotes(e.deps)).read, 0, '未改動者不讀')
            assert.equal((await syncNotes(e.deps, { all: true })).read, 2, '--all 全量讀')
            fs.rmSync((await e.notes.select())[1].file)
            const bag = {}
            const ctx = { deps: e.deps, log: e.log, set: (k, v) => { bag[k] = v }, get: (k, d) => bag[k] ?? d }
            const rep = await stageSync().run(ctx)
            assert.deepEqual([rep.detail.mdMissing, rep.stats.fail], [1, 0])
            assert.ok(e.log.lines.some((l) => /^WARN 筆記同步：1 篇筆記之 md 讀不到（記錄仍在；例 .+）——不自動視為刪除/.test(l)))
            assert.deepEqual(await stageSync({ enabled: false }).run(ctx), { ok: true, stats: { in: 0, out: 0, skip: 0, fail: 0, aiCalls: 0 }, detail: { disabled: true }, summary: '' })
        })

        it('子階段之日誌:內容變更計 ctx 旗標 notesChanged(同一管線內累計);已有下游處理時刻者之附註指記錄欄(不指他工作);md 讀不到之 WARN 不指執行端之工具', async () => {
            const e = envC([{ title: '甲', concepts: ['a', 'b'], summary: 's', key_points: ['k'] }, { title: '乙', concepts: ['c', 'd'], summary: 's', key_points: ['k'] }])
            await syncNotes(e.deps)
            const [a, b] = await e.notes.select()
            await e.notes.patch(a.id, { extractedAt: 'x' })
            for (const n of [a, b]) {
                const md = readMd(n.file)
                writeMd(n.file, { ...md.front, title: `${md.front.title}（修訂）` }, md.body)
                later(n.file)
            }
            const bag = {}
            const ctx = { deps: e.deps, log: e.log, set: (k, v) => { bag[k] = v }, get: (k, d) => bag[k] ?? d }
            bag.notesChanged = 3 // 同一管線之前段已累計
            await stageSync().run(ctx)
            assert.equal(bag.notesChanged, 5)
            assert.ok(e.log.lines.includes('INFO 筆記同步：內容變更 2 篇（其中 1 篇已有下游處理時刻 extractedAt；下游可依 knowledgeChangedAt 重判）'), e.log.lines.join('\n'))
            fs.rmSync(b.file)
            await stageSync().run(ctx)
            const w = e.log.lines.find((l) => /md 讀不到/.test(l))
            assert.match(w, /——不自動視為刪除，請還原 md，或確認不要後明示刪除其記錄$/)
        })
    })

    // ══════════════════════════ 詞彙之送達 ══════════════════════════
    describe('詞彙之送達(缺席走原行為;給了須為本套件解析後之詞彙;子階段先取生效之摘要 domain 之詞彙)', function() {
        const highWith = (caveat) => (md) => ({ front: { ...md.front, title: `${md.front.title}（修訂）`, evidence_level: '高', caveats: [caveat] }, body: md.body.replace('證據等級：中', '證據等級：高') })

        // 證據等級之降級寫回 md 之 frontmatter 與品質章(記錄之分類欄位以記錄為準、本就未隨 md 改,故以 md 判是否降級)
        it('syncNotes:缺席(undefined／null)→ 同步照做、WARN 一次、SS11 不判(不降級)', async () => {
            for (const v of [undefined, null]) {
                const e = await env([NOTE()], { noVocab: true })
                edit(e.file(), highWith('無獨立觀測證實'))
                const r = await syncNotes({ ...e.deps, vocab: v })
                assert.deepEqual([r.changed, r.stdFixed, readMd(e.file()).front.evidence_level, (await e.rec()).stdFixes], [1, 0, '高', undefined], String(v))
                assert.equal(e.log.lines.filter((l) => /^WARN 筆記同步：未給詞彙表/.test(l)).length, 1)
            }
        })

        it('syncNotes:給了而未經本套件解析(plain 物件、空物件、JSON 往返之複本、非物件)→ 掃描前即拋、不寫任何東西;deps.domains.summarize.vocab 亦同', async () => {
            const resolved = resolveSummarizeVocab({ ...BASE, evidenceRule: NEUTRAL_RULE })
            for (const bad of [{ ...BASE }, {}, JSON.parse(JSON.stringify(resolved)), 'vocab', 1]) {
                const e = await env([NOTE()], { noVocab: true })
                edit(e.file(), highWith('無獨立觀測證實'))
                const before = await e.rec()
                await assert.rejects(() => syncNotes({ ...e.deps, vocab: bad }), /syncNotes 之 deps\.vocab 須為 resolveSummarizeVocab 之產物/, JSON.stringify(bad))
                await assert.rejects(() => syncNotes({ ...e.deps, domains: { summarize: { vocab: bad } } }), /syncNotes 之 deps\.domains\.summarize\.vocab 須為 resolveSummarizeVocab 之產物/, JSON.stringify(bad))
                assert.deepEqual(await e.rec(), before, '未寫記錄')
            }
        })

        it('syncNotes:給了本套件解析後之詞彙 → 依其證據規則判(嚴式降級);未給規則之詞彙 → SS11 不適用(不降級)', async () => {
            const e = await env([NOTE()], { noVocab: true })
            edit(e.file(), highWith('無獨立觀測證實'))
            const r = await syncNotes({ ...e.deps, domains: { summarize: { vocab: resolveSummarizeVocab({ ...BASE, evidenceRule: NEUTRAL_RULE }) } } })
            assert.deepEqual([r.stdFixed, readMd(e.file()).front.evidence_level, (await e.rec()).stdFixes.some((x) => /^同步 SS11：/.test(x))], [1, '中', true], '經 deps.domains.summarize.vocab 送達亦生效')
            const e2 = await env([NOTE()], { noVocab: true })
            edit(e2.file(), highWith('無獨立觀測證實'))
            const r2 = await syncNotes({ ...e2.deps, vocab: resolveSummarizeVocab(BASE) })
            assert.deepEqual([r2.stdFixed, readMd(e2.file()).front.evidence_level], [0, '高'], '本套件預設不啟用證據規則')
            assert.equal(e2.log.lines.filter((l) => /未給詞彙表/.test(l)).length, 0, '給了詞彙即不 WARN')
        })

        it('syncStage:先取生效之摘要 domain 之詞彙(deps.domains.summarize.vocab),再取 deps.vocab', async () => {
            const e = await env([NOTE()], { noVocab: true })
            edit(e.file(), highWith('無獨立觀測證實'))
            const ctx = { deps: { ...e.deps, vocab: resolveSummarizeVocab(BASE), domains: { summarize: DOMAIN } }, log: e.log, set: () => {}, get: (k, d) => d }
            const rep = await stageSync().run(ctx)
            assert.deepEqual([rep.detail.stdFixed, readMd(e.file()).front.evidence_level], [1, '中'], 'domain 之詞彙(給證據規則)優先於 deps.vocab(未給)')
            const e2 = await env([NOTE()], { noVocab: true })
            edit(e2.file(), highWith('無獨立觀測證實'))
            const ctx2 = { deps: { ...e2.deps, vocab: DOMAIN.vocab }, log: e2.log, set: () => {}, get: (k, d) => d }
            const rep2 = await stageSync().run(ctx2)
            assert.deepEqual([rep2.detail.stdFixed, readMd(e2.file()).front.evidence_level], [1, '中'], '無 domain 時取 deps.vocab')
            // 反向:domain 之詞彙未給規則、deps.vocab 給了 → 以 domain 之詞彙為準(不降級)
            const e3 = await env([NOTE()], { noVocab: true })
            edit(e3.file(), highWith('無獨立觀測證實'))
            const ctx3 = { deps: { ...e3.deps, vocab: DOMAIN.vocab, domains: { summarize: createSummarizeDomain({ vocab: BASE }) } }, log: e3.log, set: () => {}, get: (k, d) => d }
            const rep3 = await stageSync().run(ctx3)
            assert.deepEqual([rep3.detail.stdFixed, readMd(e3.file()).front.evidence_level], [0, '高'])
        })

        it('L syncStage:語言設定經 deps.locale 交給同步(與納入閘同一來源):locale en → SS3 不判、不轉字形、不登錄待判;未給 → 臺灣正體照修', async () => {
            const simp = (md) => ({ front: { ...md.front, title: '动量因子之风险' }, body: md.body })
            const e = await env([NOTE()])
            edit(e.file(), simp)
            const rep = await stageSync().run({ deps: { ...e.deps, locale: 'en' }, log: e.log, set: () => {}, get: (k, d) => d })
            const n = await e.rec()
            assert.deepEqual([rep.detail.changed, rep.detail.stdFixed, readMd(e.file()).front.title, n.title], [1, 0, '动量因子之风险', '动量因子之风险'])
            assert.equal(await e.holds.get(`note:${n.id}:SS3`), null, 'SS3 不適用 → 不登錄待判')
            const e2 = await env([NOTE()])
            edit(e2.file(), simp)
            const rep2 = await stageSync().run({ deps: e2.deps, log: e2.log, set: () => {}, get: (k, d) => d })
            assert.deepEqual([rep2.detail.stdFixed, readMd(e2.file()).front.title], [1, '動量因子之風險'])
        })
    })
})
