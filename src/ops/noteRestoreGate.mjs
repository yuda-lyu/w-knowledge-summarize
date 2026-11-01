// noteRestoreGate.mjs — 還原筆記之筆記標準閘(檢定標準 SS2／SS3／SS4／SS6／SS11;所有寫入入口同受標準)
//
// 【為何以注入提供】還原筆記(把已封存之筆記放回庫)之流程屬下游之維運;本套件只提供判定與待判之閘,由呼叫端注入其還原流程。
//   對外契約:createNoteRestoreGate(deps) 回 { check, hold }(形狀見下方 JSDoc)。
// 【判定與同步入口同一組】(ops/syncNotes)①確定性修正——noteFixOf(SS2 無內容之壞行、SS3 正體、SS6 概念標籤〔擠標籤須各段皆為
//   既有概念〕、SS11 明確自承無最高證據等級之要件者降級〔詞彙表之證據規則〕;有原文者另 SS4——含原文沒有之數字之清單行逐條移除,同新進閘;
//   只動內容章、[[連結]] 與網址不轉;同步入口不做 SS4 之移除——使用者之編修為真理,交待判);②checkNote 判定修正後之筆記(有原文
//   〔抓取套件之原文另存〕時含 SS4;無原文者不檢 SS4)。
// 【分類欄位(SS9)】先依現行分類法做確定性對應(stores/taxonomy 之 taxonomyFixOf):類別、內容類型、證據等級之改名對照 → 新名;類別仍在
//   清單外(封存期間已退役或錯過重標)→ 後備類別、原值存 categoryRaw(同摘要新進之 categoryOf)。有變更者寫 tagChangedAt(同重標)。
//   重標只處理分類法變更當下之存量,封存之筆記會錯過——還原時不做此對應,即留在清單外而無任何處置。
// 【處置(呼叫端依之)】仍不合格 → 預設不還原並列出(不合格者不還原);使用者明示接受者照還原並登錄待判(使用者);未能判定者照還原並登錄待判。
//   修正後之記錄同步 title／concepts／summary 與 syncHash(原有才寫)——不寫 knowledgeChangedAt(形式修正不是內容變更,同存量處置)。
// 【詞彙】deps.vocab 給了須為本套件解析後之詞彙表(建立時即驗,未經解析即拋);未給 → 依賴詞彙之判定略過(清單檢查、SS11)。

import isarr from 'wsemi/src/isarr.mjs'
import { docTextOf } from '../core/capturePackage.mjs'
import { syncFieldsOf, syncHashOf, recordPatchOf } from '../stores/noteSync.mjs'
import { knownConceptOf } from '../stores/knownConcepts.mjs'
import { syncNoteHolds } from '../stores/noteHolds.mjs'
import { RENAME_FIELDS, taxonomyOf, taxonomyFixOf, rewriteFieldOf } from '../stores/taxonomy.mjs'
import { noteFixOf, NOTE_FIX_STDS } from './noteStockFix.mjs'
import { checkNote, noteMaterialOf, standardsVocabOf } from '../standards/noteStandards.mjs'

/**
 * 建立還原筆記之標準閘
 *
 * @param {Object} deps 輸入 { stores:{ notes, docs?, docTexts?, cores?, holds? }, vocab(resolveSummarizeVocab 之產物;未給＝清單檢查與 SS11 不判), clock,
 *   locale?(語言設定;SS3 之判定與修正依之,未給＝臺灣正體) }
 * @returns {Object} 回傳 { check({ record, md }) → Promise<{ md, mdChanged, recordPatch, changes, results, violations, undetermined, contentChanged, titleChanged }>,
 *   hold(record, results) → Promise<{ held:Array(標準), noHolds:Boolean }> }——contentChanged(內容章有變)、titleChanged(標題有變)與 noteFixOf、
 *   存量處置之帳列同義(已被下游消化者兩者任一為真即須重設基準;判定屬下游)
 * @throws {Error} deps.vocab 給了而非本套件解析後之詞彙表時拋出
 * @example
 * let gate = createNoteRestoreGate({ stores: { notes: { select: async () => [] } } })
 * let md = { front: { title: '星系的数据', concepts: ['星系', '黑洞'] }, body: '# 星系的数据\n\n## 一句話重點\n\n星系有数据\n\n## 核心知識\n\n- 要点' }
 * let r = await gate.check({ record: { id: 'n1', title: '星系的数据' }, md })
 * console.log(r.md.front.title, r.mdChanged, r.changes.map((c) => c.std))
 * // => 星系的數據 true [ 'SS3', 'SS3' ]
 *
 * console.log(await gate.hold({ id: 'n1' }, r.results))
 * // => { held: [], noHolds: true }
 */
export function createNoteRestoreGate(deps = {}) {
    const vocab = standardsVocabOf(deps.vocab, 'createNoteRestoreGate 之 deps.vocab')
    return {
        /**
         * 判定一篇待還原之筆記(不寫任何東西)
         * @param {Object} o 輸入 { record:封存之筆記記錄, md:{ front, body } }
         * @returns {Promise} 回傳 Promise，resolve 回傳判定與修正結果
         */
        async check({ record, md }) {
            const knownConcept = await knownConceptOf(deps.stores)
            // ①分類欄位之確定性對應(SS9;檔頭【分類欄位】)——在其餘修正與判定之前:改名之內容類型不被清單檢查(SS2)誤判
            const tf = vocab ? taxonomyFixOf(record, taxonomyOf(vocab)) : { patch: {}, fields: [] }
            let mdT = md
            for (const x of tf.fields) mdT = rewriteFieldOf(mdT, RENAME_FIELDS[x.field], x.to)
            const recT = { ...record, ...tf.patch }
            const LABEL = { category: '類別', claimType: '內容類型', evidenceLevel: '證據等級' }
            const taxChanges = tf.fields.map((x) => ({ std: 'SS9', what: x.how === 'rename' ? `${LABEL[x.field]}「${x.from}」依改名對照 →「${x.to}」` : `類別「${x.from}」不在現行清單 → 後備類別「${x.to}」（原值存 categoryRaw）` }))
            // ②原文(SS4 之材料;有者 SS4 亦依新進閘同一處置確定性修正——ops/noteStockFix)
            const src0 = recT.docId && deps.stores?.docs ? await docTextOf(deps.stores, recT.docId) : null
            const material0 = noteMaterialOf(src0, recT, mdT.body)
            const fix = noteFixOf(mdT, recT, { stds: NOTE_FIX_STDS, vocab, knownConcept, locale: deps.locale, ...(typeof material0 === 'string' ? { material: material0 } : {}) })
            const changes = [...taxChanges, ...fix.changes]
            const changed = changes.length > 0
            const md1 = fix.changes.length ? { front: fix.front, body: fix.body } : mdT
            const f = syncFieldsOf(md1)
            const recordPatch = changed
                ? {
                    ...tf.patch,
                    ...(tf.fields.length ? { tagChangedAt: deps.clock?.iso8?.() || new Date().toISOString() } : {}),
                    ...fix.recordPatch,
                    ...recordPatchOf(f),
                    ...(record.syncHash ? { syncHash: syncHashOf(f) } : {}),
                    stdFixes: [...(isarr(record.stdFixes) ? record.stdFixes : []), ...changes.map((c) => `還原 ${c.std}：${c.what}`.slice(0, 120))].slice(-20),
                }
                : {}
            const rec1 = { ...record, ...recordPatch }
            const material = noteMaterialOf(src0, rec1, md1.body)
            const results = checkNote({ front: md1.front, body: md1.body, record: rec1 }, { vocab, material: material === null ? undefined : material, locale: deps.locale })
            return {
                md: md1, mdChanged: changed, recordPatch, changes, results,
                violations: results.filter((r) => r.status === 'violation'),
                undetermined: results.filter((r) => r.status === 'undetermined'),
                contentChanged: fix.contentChanged === true,
                titleChanged: fix.titleChanged === true,
            }
        },
        /**
         * 還原後仍不合格(使用者明示接受者)或未能判定之標準登錄待判(使用者);未開 holds 集合回 noHolds
         * @param {Object} record 輸入還原後之筆記記錄
         * @param {Array} results 輸入 check 之 results
         * @returns {Promise} 回傳 Promise，resolve 回傳 { held, noHolds }
         */
        async hold(record, results) {
            if (!deps.stores?.holds) return { held: [], noHolds: true }
            const r = await syncNoteHolds(deps.stores.holds, record, results, { nowIso: deps.clock.iso8(), via: '還原筆記' })
            return { held: r.held, noHolds: false }
        },
    }
}

export default createNoteRestoreGate
