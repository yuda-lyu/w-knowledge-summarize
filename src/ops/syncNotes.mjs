// syncNotes.mjs — 筆記內容變更之掃描(同步子階段 stages/syncStage 與維運共用)
//
// 【做什麼】逐篇筆記:無同步雜湊(syncHash)者以 md 現況回填(不視為變更——首見無基準);有者只讀 mtime 晚於上次掃描水位之 md,
//   雜湊不同即把標題、概念、一句話重點同步回記錄並寫 knowledgeChangedAt(＝偵測時刻)。下游(讀筆記記錄之 title／concepts／summary 者)
//   可依 knowledgeChangedAt 重判該篇。
// 【同步入口同受筆記標準】(檢定標準 SS2／SS3／SS4／SS6／SS11;所有寫入入口同受標準)雜湊不同時,同步回記錄之前:
//   ①確定性修正——與存量處置同一函數 ops/noteStockFix.noteFixOf(SS2 無內容之壞行、SS3 正體、SS6 概念標籤〔擠標籤須各段皆為既有概念,
//     stores/knownConcepts〕、SS11 明確自承無最高證據等級之要件者降級〔詞彙表之證據規則〕);只動內容章、`[[連結]]` 與網址不轉;
//     有改則寫回 md,記錄之 stdFixes 追加「同步 SSx：…」並 INFO;
//   ②以 checkNote 判定修正後之筆記(有原文〔抓取套件之原文另存〕時含 SS4;無原文者不檢 SS4——同人工匯入,數字之出處由編修者負責);
//   ③仍不合格或未能判定之標準 → 登錄待判(物件 note、該標準、負責者 user、期限見 stores/noteHolds),經判定合格者結案;
//   ④不擋同步本身:使用者之編修為真理,記錄照寫,只修確定性之形式並把剩餘問題交使用者。
//   已有未結之筆記待判者,md 再被讀到(使用者改了任一章)而雜湊不變 → 只重驗(不修、不改記錄),合格即結案;筆記已不在 → 結案。
//   未開 holds 集合 → 每次掃描 WARN 一次、略過登錄。
// 【詞彙】deps.vocab(或 deps.domains.summarize.vocab)給了須為本套件解析後之詞彙表(未經解析即拋——證據規則不得在本入口無聲失效);
//   未給 → 掃描照做,首次判定時 WARN 一次,依賴詞彙之判定略過(內容類型／證據等級之清單檢查與 SS11)。
// 【水位】＝本次掃描開始時刻(減 2 秒容差;mtime 解析度):掃描途中被改之檔下次必再讀。stat 失敗或 md 讀不到者計 mdMissing
//   (記錄在而 md 不在:不自動視為刪除——刪除只走明示之刪除)。本掃描寫回之 md 下次會被讀到,其雜湊與記錄相同即略過。
// 【寫入順序】md(有修正時,寫後回讀)→ 待判 → 記錄 patch 後回讀驗證,不符拋錯(該篇下輪重試;水位只在整次掃描完成後前進)。

import fs from 'fs'
import path from 'path'
import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import { readMd, writeMd } from '../core/md/md.mjs'
import { writeFileAtomic, docTextOf, listHolds, noteConsumedOf } from '../core/capturePackage.mjs'
import { syncFieldsOf, syncHashOf, recordPatchOf, diffLabelOf } from '../stores/noteSync.mjs'
import { knownConceptOf } from '../stores/knownConcepts.mjs'
import { syncNoteHolds, resolveNoteHolds } from '../stores/noteHolds.mjs'
import { patchNoteRecord } from '../stores/notePatch.mjs'
import { NOTE_WRITE_STAGE, noteProducedOf, withProducedFront } from '../stores/noteProduced.mjs'
import { noteFixOf, NOTE_FIX_STDS } from './noteStockFix.mjs'
import { checkNote, noteMaterialOf, standardsVocabOf, NOTE_STANDARDS } from '../standards/noteStandards.mjs'

/** 水位檔名(dirs.state 下) */
export const NOTE_SYNC_STATE = 'note-sync.json'
const SLACK_MS = 2000
const NOTE_STD_IDS = NOTE_STANDARDS.map((s) => s.id)

/**
 * 讀水位(缺檔或壞檔回 0＝全量讀;壞檔經 onCorrupt 告警)
 *
 * @param {String} file 輸入水位檔路徑
 * @param {Function} [onCorrupt] 輸入壞檔告警
 * @returns {Number} 回傳上次掃描開始之毫秒時刻
 */
function readWatermark(file, onCorrupt) {
    let text
    try {
        text = fs.readFileSync(file, 'utf8')
    }
    catch {
        return 0
    }
    try {
        const v = Number(JSON.parse(text)?.scannedAtMs)
        return Number.isFinite(v) && v > 0 ? v : 0
    }
    catch (e) {
        if (typeof onCorrupt === 'function') onCorrupt(e.message)
        return 0
    }
}

/**
 * 同步所用之詞彙表(檔頭【詞彙】):deps.vocab 優先,其次 deps.domains.summarize.vocab;皆未給回 null
 *
 * @param {Object} deps 輸入依賴物件
 * @returns {Object|null} 回傳本套件解析後之詞彙表或 null
 * @throws {Error} 給了而非本套件解析後之詞彙表時拋出
 */
function syncVocabOf(deps) {
    if (deps.vocab !== undefined && deps.vocab !== null) return standardsVocabOf(deps.vocab, 'syncNotes 之 deps.vocab')
    const dv = deps.domains?.summarize?.vocab
    if (dv !== undefined && dv !== null) return standardsVocabOf(dv, 'syncNotes 之 deps.domains.summarize.vocab')
    return null
}

/**
 * 掃描筆記內容變更並同步回記錄(雜湊不同者先過筆記標準;檔頭)
 *
 * @param {Object} deps 輸入 { stores:{ notes, docs?, docTexts?, cores?, holds? }, dirs:{state}, clock, log, vocab?(或 domains.summarize.vocab;
 *   給了須為 resolveSummarizeVocab 之產物), locale?(語言設定;每輪依賴之 deps.locale——SS3 之判定與修正依之,未給＝臺灣正體) }
 * @param {Object} [opt={}] 輸入 { all:Boolean(忽略水位全量讀), nowMs:Number(測試注入), ids:Array(只掃這些筆記),
 *   stamp:String(確定性修正寫入之產出鏈所記輪次 stamp——stageSync 給 ctx.stamp;輪次外之維運呼叫不給＝null) }
 * @returns {Promise} 回傳 Promise，resolve 回傳 { scanned, read, backfilled, changed, mdMissing, touchExtracted, stdFixed, stdHeld, stdResolved,
 *   changedIds, missingSample }(touchExtracted＝變更之筆記中已有下游處理時刻 extractedAt 者)
 * @throws {Error} 詞彙表給了而非本套件解析後之詞彙表、或寫入後回驗不符時拋出
 * @example
 * import fs from 'fs'
 * import os from 'os'
 * import path from 'path'
 *
 * let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'))
 * let file = path.join(dir, 'n1.md')
 * let bodyOf = (t) => `# ${t}\n\n## 一句話重點\n\n星系是恆星的集合\n\n## 核心知識\n\n- 要點`
 * writeMd(file, { title: '星系', concepts: ['星系', '黑洞'] }, bodyOf('星系'))
 * let rows = new Map([['n1', { id: 'n1', file, title: '星系', concepts: ['星系', '黑洞'], summary: '星系是恆星的集合' }]])
 * let notes = {
 *     select: async () => [...rows.values()],
 *     get: async (id) => rows.get(id),
 *     patch: async (id, o) => Object.assign(rows.get(id), o),
 * }
 * let deps = { stores: { notes }, dirs: { state: dir }, clock: { iso8: () => 'T0' } }
 * let r1 = await syncNotes(deps)
 * console.log(r1.backfilled, r1.changed)
 * // => 1 0
 *
 * writeMd(file, { title: '星系與黑洞', concepts: ['星系', '黑洞'] }, bodyOf('星系與黑洞'))
 * let r2 = await syncNotes(deps, { all: true })
 * console.log(r2.changed, rows.get('n1').title, rows.get('n1').knowledgeChangedAt)
 * // => 1 星系與黑洞 T0
 * fs.rmSync(dir, { recursive: true, force: true })
 */
export async function syncNotes(deps, opt = {}) {
    if (!isobj(opt)) opt = {}
    const { stores, dirs, clock, log } = deps
    const vocab = syncVocabOf(deps)
    const file = path.join(dirs.state, NOTE_SYNC_STATE)
    const since = opt.all === true ? 0 : readWatermark(file, (m) => log?.warn?.(`筆記同步：水位檔損壞（${m}），本次全量讀`))
    const startMs = Number.isFinite(opt.nowMs) ? opt.nowMs : Date.now()
    const nowIso = clock.iso8()
    const only = Array.isArray(opt.ids) ? new Set(opt.ids) : null
    const det = { scanned: 0, read: 0, backfilled: 0, changed: 0, mdMissing: 0, touchExtracted: 0, stdFixed: 0, stdHeld: 0, stdResolved: 0, changedIds: [], missingSample: [] }
    const holds = stores.holds || null
    const warned = new Set()
    const warnOnce = (key, msg) => {
        if (warned.has(key)) return
        warned.add(key)
        log?.warn?.(msg)
    }
    let knownConcept = null // 既有概念(擠標籤之拆分條件):第一篇須修正者才讀
    const notes = await stores.notes.select()
    // 未結之筆記待判(本模組所登錄之標準):其 md 再被讀到即重驗;筆記已不在即結案
    const heldIds = new Set()
    if (holds) {
        const ids = new Set(notes.map((n) => n.id))
        for (const h of await listHolds(holds, { object: 'note', status: 'open' })) {
            if (!NOTE_STD_IDS.includes(h.std)) continue
            if (ids.has(h.oid)) heldIds.add(h.oid)
            else if (!only || only.has(h.oid)) det.stdResolved += await resolveNoteHolds(holds, h.oid, { how: '筆記已不存在', nowIso })
        }
    }

    /**
     * 判定筆記並更新其待判(不合格／未能判定 → 登錄;合格 → 結案)
     * @param {Object} n 輸入筆記記錄(判定時之記錄值)
     * @param {Object} md 輸入 md { front, body }
     * @returns {Promise} 回傳 Promise
     */
    const judge = async (n, md) => {
        if (!vocab) warnOnce('vocab', '筆記同步：未給詞彙表（deps.vocab），內容類型／證據等級之清單檢查與 SS11 不判')
        const src = n.docId && stores.docs ? await docTextOf(stores, n.docId) : null
        const material = noteMaterialOf(src, n, md.body)
        const rs = checkNote({ front: md.front, body: md.body, record: n }, { vocab, material: material === null ? undefined : material, locale: deps.locale })
        const bad = rs.filter((r) => r.status === 'violation' || r.status === 'undetermined')
        if (!holds) {
            if (bad.length) warnOnce('holds', `筆記同步：未開 holds 集合，同步後仍未達檢定標準之筆記未登錄待判（例 ${n.id}：${bad.map((r) => r.std).join('、')}）`)
            return
        }
        const h = await syncNoteHolds(holds, n, rs, { nowIso, via: '筆記同步' })
        det.stdHeld += h.held.length
        det.stdResolved += h.resolved.length
        if (h.held.length) log?.info?.(`筆記同步：[${n.id}] 仍未達檢定標準（${bad.map((r) => `${r.std} ${r.detail}`).join('；').slice(0, 160)}）——已登錄待判（使用者），同步照做`)
    }

    for (const n of notes) {
        if (only && !only.has(n.id)) continue
        det.scanned++
        const needBackfill = !n.syncHash
        let mtime = 0
        try {
            mtime = fs.statSync(n.file).mtimeMs
        }
        catch {
            det.mdMissing++
            if (det.missingSample.length < 3) det.missingSample.push(n.id)
            continue
        }
        if (!needBackfill && since > 0 && mtime < since - SLACK_MS) continue
        let md = readMd(n.file)
        if (!md) {
            det.mdMissing++
            if (det.missingSample.length < 3) det.missingSample.push(n.id)
            continue
        }
        det.read++
        const f0 = syncFieldsOf(md)
        const h0 = syncHashOf(f0)
        if (needBackfill) {
            await stores.notes.patch(n.id, { syncHash: h0 })
            det.backfilled++
            continue
        }
        if (h0 === n.syncHash) {
            // 雜湊不變而有未結之筆記待判:使用者可能改了其他章 → 只重驗(不修、不改記錄)
            if (heldIds.has(n.id)) await judge(n, md)
            continue
        }
        const what = diffLabelOf(n, f0)
        // ①確定性修正(與存量處置同一函數;只動內容章、連結網址不轉)。既有概念取本次已讀之筆記記錄＋核心(不再全表讀一次筆記)
        if (!knownConcept) knownConcept = await knownConceptOf({ notes: { select: async () => notes }, cores: stores.cores })
        const fix = noteFixOf(md, n, { stds: NOTE_FIX_STDS, vocab, knownConcept, locale: deps.locale })
        // 產出鏈(stores/noteProduced):只有確定性修正真的改寫了內容才記(stage standards-fix、不呼叫 AI);使用者之編修照實同步回記錄,不算本套件之產出
        const prod = fix.changes.length ? noteProducedOf(n, { stage: NOTE_WRITE_STAGE.syncFix, stamp: opt.stamp ?? null, nowIso }) : null
        if (fix.changes.length) {
            writeMd(n.file, prod ? withProducedFront(fix.front, prod.produced) : fix.front, fix.body)
            const back = readMd(n.file)
            if (!back || back.front?.title !== fix.front.title) throw new Error(`筆記 ${n.id} 之同步修正寫入 md 後回驗不符`)
            md = back
            det.stdFixed++
            log?.info?.(`筆記同步：[${n.id}] 確定性修正 ${fix.changes.length} 處（${fix.changes.map((c) => `${c.std} ${c.what}`).join('；').slice(0, 160)}）——已寫回 md`)
        }
        const f = syncFieldsOf(md)
        const h = syncHashOf(f)
        const patch = {
            ...fix.recordPatch,
            ...recordPatchOf(f),
            syncHash: h,
            knowledgeChangedAt: nowIso,
            ...(fix.changes.length ? { stdFixes: [...(isarr(n.stdFixes) ? n.stdFixes : []), ...fix.changes.map((c) => `同步 ${c.std}：${c.what}`.slice(0, 120))].slice(-20) } : {}),
            ...(prod ? prod.patch : {}),
        }
        // ②③判定與待判(不擋同步;判定以將寫入之記錄值為準)
        await judge({ ...n, ...patch }, md)
        // 陣列欄有變先清後寫、寫後回驗實際欄位(stores/notePatch;中途中斷時雜湊未更新,下輪同步補正)
        await patchNoteRecord(stores.notes, n, patch, { verify: ['syncHash', 'title', 'summary', 'concepts'], label: '同步' })
        det.changed++
        det.changedIds.push(n.id)
        if (noteConsumedOf(n)) det.touchExtracted++
        log?.info?.(`筆記內容變更：[${n.id}] ${what}已改，已同步回記錄（下游可依 knowledgeChangedAt 重判）`)
    }
    if (!only) writeFileAtomic(file, JSON.stringify({ scannedAtMs: startMs, scannedAt: nowIso }))
    return det
}

export default syncNotes
