// ingestNotes.mjs — 人工／代理撰寫之知識筆記批次入庫(維運能力)
//
// 與摘要子階段共用同一份組裝(stores/noteBuild:清洗、類別落點、frontmatter、索引記錄)與 domain(normalizeQuality／renderNoteBody),
// 確保 md 結構、frontmatter、notes 索引欄位與管線產出完全一致;docs 集合同步登記(狀態 noted)以維持網址去重。重複網址／slug 一律跳過並回報。
// 【文件之登記交抓取套件】文件記錄之形狀與 id 由抓取套件之 externalDocOf 產生(以總組裝之去重身分 deps.identity 算 id——與管線同一身分,
//   安裝方自訂去重身分時,同一網址日後被抓取即判已收);本檔只寫摘要之終態(noted、noteSlug、notedAt)。
// 【寫入順序:筆記先、文件後】md → 筆記索引 → doc;doc 登記失敗時筆記已在,重跑判「筆記檔已存在」,文件日後被抓到時摘要段以 docId
//   找到既有筆記回鏈(stages/noteStage【既有筆記不覆寫】),可自癒。若先登記 doc 再寫 md,md 寫入失敗即留下「已在庫」卻無筆記之文件,
//   重跑一律判重複略過,該篇永遠進不來。
// 【驗證與摘要同一規則】納入閘與摘要子階段共用(standards/noteGate:正規化 → 硬性欄位;落地前 checkNote 再驗):
//   不合格者計入 bad 並列原因(證據等級之未能判定附更正方向,standards/noteStandards.noteFeedbackOf)。擠一標籤之多概念同摘要段:各段皆為
//   既有概念才拆(stores/knownConcepts,匯入前讀一次)。人工匯入無機器可讀之原文 → 不檢數字紮根(SS4;出處由匯入者負責),記錄標
//   sourceKind:'manual'。
//
// 輸入項目格式:{ url, sourceName?, publishedAt?, textFrom?, note: {同摘要輸出欄位} }

import fs from 'fs'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import { externalDocOf, oneline } from '../core/capturePackage.mjs'
import { writeMd } from '../core/md/md.mjs'
import { buildNote } from '../stores/noteBuild.mjs'
import { NOTE_WRITE_STAGE, noteProducedOf, withProducedFront } from '../stores/noteProduced.mjs'
import { knownConceptOf } from '../stores/knownConcepts.mjs'
import { SUMMARIZE_DOC_STATUS } from '../stores/docStatus.mjs'
import { gateNoteItem } from '../standards/noteGate.mjs'
import { checkNote, noteFeedbackOf } from '../standards/noteStandards.mjs'

/**
 * 批次將人工／代理撰寫之知識筆記寫入庫(md 檔＋notes 索引＋docs 同步登記為 noted),
 * 與摘要管線共用同一份 domain 正規化(normalizeQuality／renderNoteBody),確保筆記結構與管線產出完全一致
 *
 * 逐項處理、互不中斷:欄位不全(URL、title、key_points、concepts 缺一)者計入 bad 並略過；
 * URL 已在庫(docs 狀態為 noted／skip)或 slug 檔案已存在者計入 dup 並略過、不覆寫既有筆記
 *
 * @param {Object} deps 輸入依賴物件
 * @param {Object} deps.stores 輸入集合物件，需含 docs、notes(w-data-pipeline openCollection 介面)
 * @param {Object} deps.dirs 輸入目錄物件，需含 notes(筆記 md 存放目錄字串)
 * @param {Object} deps.clock 輸入時鐘物件(wsemi 之 genClockTZ 產物)
 * @param {Object} deps.domain 輸入領域物件(createSummarizeDomain 產物)，取 normalizeQuality／renderNoteBody／vocab
 * @param {Object} deps.identity 輸入去重身分(總組裝之 info().identity;文件 id 與管線同一身分,檔頭)
 * @param {String} [deps.stamp] 輸入產出鏈所記之輪次 stamp(14 碼;匯入屬輪次外之維運,未給＝null)
 * @param {Array} items 輸入入庫項目陣列，各項形狀為 { url, sourceId?, sourceName?, publishedAt?, textFrom?, note:{ title, key_points, concepts, ...同摘要輸出欄位 } }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { added:Integer, dup:Integer, bad:Integer, messages:Array }
 * @throws {Error} deps 非物件或缺 stores／dirs／clock／domain／identity 任一者時拋出；items 非陣列時拋出
 * @example
 * need test in nodejs.
 *
 * let r = await ingestNotes({ stores, dirs: { notes: './kb/notes' }, clock, domain, identity: flow.info().identity }, [
 *     { url: 'https://e.com/a', note: { title: 'T', key_points: ['a'], concepts: ['c'] } },
 * ])
 * console.log(r.added)
 * // => 1
 */
export async function ingestNotes(deps, items) {

    //check
    if (!isobj(deps) || !isobj(deps.stores) || !isobj(deps.dirs) || !isobj(deps.clock) || !isobj(deps.domain) || typeof deps.identity?.of !== 'function') {
        throw new Error('ingestNotes 需要 { stores, dirs, clock, domain, identity }(identity＝總組裝之 info().identity)')
    }
    if (!isarr(items)) {
        throw new Error('ingestNotes 需要 items 陣列')
    }

    const { stores, dirs, clock, domain } = deps
    const messages = []
    let added = 0
    let dup = 0
    let bad = 0
    // 擠標籤之拆分條件(SS6;檔頭):有項目才讀既有概念
    const knownConcept = items.length ? await knownConceptOf(stores) : () => false

    for (const it of items) {
        const k0 = isobj(it?.note) ? it.note : {}
        const nowIso = clock.iso8()
        // 文件記錄之形狀、正準網址與 id 交抓取套件(與管線同一去重身分;檔頭);網址不合 → null
        const rec = externalDocOf(deps.identity, { url: it?.url, title: it?.title || k0.title, publishedAt: it?.publishedAt }, { id: it?.sourceId || '', name: it?.sourceName || '手動抓取', tier: 1 }, { nowIso })
        if (!rec) {
            messages.push(`✗ 網址不合，略過：${oneline(k0.title || it?.url, 50)}`)
            bad++
            continue
        }
        // 納入閘(與摘要子階段同一實作;不檢 SS4;語言設定取 domain.locale)
        const g = gateNoteItem({ ...k0, relevant: true }, { vocab: domain.vocab, knownConcept, locale: domain.locale })
        if (!g.ok) {
            messages.push(`✗ 未達檢定標準（${oneline(g.reasons.join('；'), 80)}），略過：${oneline(k0.title || it?.url, 50)}`)
            bad++
            continue
        }
        const k = g.item
        const docId = rec.id
        const exists = await stores.docs.get(docId)
        if (exists && [SUMMARIZE_DOC_STATUS.noted, SUMMARIZE_DOC_STATUS.skip].includes(exists.status)) {
            messages.push(`= 已在庫（${exists.status}），略過：${oneline(k.title, 50)}`)
            dup++
            continue
        }

        // 人工匯入只覆寫差異欄位(標題取正規化後之筆記標題、素材之取得方式;直接以 noted 終態入庫)
        const base = { ...rec, title: it.title || k.title || '', textFrom: it.textFrom || 'abstract' }
        const n = buildNote({ k, doc: base, domain, notesDir: dirs.notes, nowIso })
        n.record = { ...n.record, sourceKind: 'manual', ...(g.fixes.length ? { stdFixes: g.fixes.slice(0, 20).map((x) => oneline(x, 120)) } : {}) }
        // 落地前以同一組標準驗落地形態(不檢 SS4)
        const bad2 = checkNote({ front: n.front, body: n.body, record: n.record }, { vocab: domain.vocab, locale: domain.locale }).filter((r) => r.status === 'violation' || r.status === 'undetermined')
        if (bad2.length) {
            messages.push(`✗ 未達檢定標準（${oneline(bad2.map((r) => noteFeedbackOf(r, { vocab: domain.vocab })).join('；'), 120)}），略過：${oneline(k.title, 50)}`)
            bad++
            continue
        }
        if (fs.existsSync(n.file)) {
            // 與其他略過路徑一致須留訊息(呼叫端只看 dup 計數無從對應是哪一筆)
            messages.push(`= 筆記檔已存在（${n.slug}.md），略過：${oneline(k.title, 50)}`)
            dup++
            continue
        }
        if (n.categoryRaw) messages.push(`! 類別「${oneline(n.categoryRaw, 20)}」不在分類清單，落「${n.category}」（原值存 categoryRaw）：${oneline(k.title, 50)}`)

        // 產出鏈(stores/noteProduced):人工／代理匯入不呼叫 AI → seat／provider 皆 null;輪次外 stamp 為 null(deps.stamp 給了者記之);stage 為 ingest
        const prod = noteProducedOf({}, { stage: NOTE_WRITE_STAGE.ingest, stamp: deps.stamp ?? null, nowIso })
        if (prod) n.record = { ...n.record, ...prod.patch }

        // 寫入順序:筆記先、文件後(檔頭)
        writeMd(n.file, prod ? withProducedFront(n.front, prod.produced) : n.front, n.body)
        await stores.notes.insertNew([n.record])
        if (exists) await stores.docs.patch(docId, { status: SUMMARIZE_DOC_STATUS.noted, noteSlug: n.slug, notedAt: nowIso })
        else await stores.docs.insertNew([{ ...base, status: SUMMARIZE_DOC_STATUS.noted, noteSlug: n.slug, notedAt: nowIso }])
        added++
    }
    return { added, dup, bad, messages }
}

export default ingestNotes
