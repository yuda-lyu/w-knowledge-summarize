// unit-summarize-contract.test.mjs — 摘要之跨入口一致與對外契約:SS11 五入口一致(檢定標準驗收 5)、還原閘之對外契約(假還原流程)
// 規則(出自 core/standards/evidenceRules、standards/noteStandards、ops/noteRestoreGate 檔頭與 README §1、§12):
//   ①SS11 之判定、降級與訊息為單一實作(詞彙表之 evidenceRule)。同一組筆記在五個入口——新進(摘要子階段:納入閘之正規化降級＋落地前
//     checkNote)、同步(syncNotes)、還原(還原閘之 check)、存量(planNoteStockFix → applyNoteStockFix;修法 noteFixOf)、掃描
//     (auditSummarizeStandards)——之處置一致:
//     最高級＋嚴式命中(不合格)→ 可修之入口皆降一級,說明出自同一規則(新進記修正說明;同步、還原、存量記同一句變更說明),掃描記不合格;
//     只命中寬式(未能判定)→ 皆不降級:新進不納入並附更正方向、同步與還原列為未能判定(登錄／列出待判)、掃描記未能判定;
//       存量處置之對象為不合格者,未能判定者不動(其清單見掃描之 undetermineds);
//     無涉(合格)與非最高級(不適用)→ 皆不動
//   ②未給 evidenceRule 之詞彙 → 五入口皆不適用、皆不降級;規則由詞彙決定:換另一領域之規則,同一組筆記之判定隨之改變
//   ③還原閘之對外契約(README §1;還原閘檔頭【處置】):check 只判定不寫;呼叫端依 violations／undetermined 處置——仍不合格 → 不還原並列出;
//     使用者明示接受 → 照還原並登錄待判(使用者);未能判定 → 照還原並登錄待判;還原寫入確定性修正後之 md 與記錄(同步欄位、syncHash 原有
//     才寫、不寫 knowledgeChangedAt)——還原後之下一輪同步不報內容變更、掃描之判定同 check;擠標籤之拆分條件同同步(各段皆為既有概念)
//   ④其餘寫入入口同受筆記標準(所有寫入入口同受標準):修補後重閘——修補回覆之內容再經同一閘(轉正體、SS11 降級、清單外類別落後備類別、
//     擠標籤不拆即落地前判 SS6 不合格);人工匯入——轉正體、擠標籤依既有概念拆分或不入庫;掃描——SS6／SS3 之判定與落地前同一說明
// 規則一律以任意領域之規則給(醫學:臨床試驗;天文:獨立觀測),證明判定由詞彙決定,不是內建之領域用詞。
// 執行:自套件根 node <mocha> test/unit-summarize-contract.test.mjs(暫存 test/_tmp/summarize-contract-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memStore, genClockTZ, DEFAULT_DEDUP } from './tools/captureForTest.mjs'
import { recLog } from './tools/stageKit.mjs'
import { rawDoc, itemOf } from './tools/summarizeTestKit.mjs'
import { captureIdentityOf } from '../src/core/capturePackage.mjs'
import { readMd, writeMd } from '../src/core/md/md.mjs'
import { evidenceRuleOf } from '../src/core/standards/evidenceRules.mjs'
import { resolveSummarizeVocab } from '../src/core/vocab/summarizeVocab.mjs'
import { resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { checkNote } from '../src/standards/noteStandards.mjs'
import { auditSummarizeStandards } from '../src/standards/audit.mjs'
import { planNoteStockFix, applyNoteStockFix } from '../src/standards/stockFix.mjs'
import { buildNote } from '../src/stores/noteBuild.mjs'
import { syncFieldsOf, syncHashOf } from '../src/stores/noteSync.mjs'
import { NOTE_HOLD_NEXT, DOC_HOLD_NEXT } from '../src/stores/noteHolds.mjs'
import { stageSummarize } from '../src/stages/noteStage.mjs'
import { syncNotes } from '../src/ops/syncNotes.mjs'
import { createNoteRestoreGate } from '../src/ops/noteRestoreGate.mjs'
import { ingestNotes } from '../src/ops/ingestNotes.mjs'

const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/summarize-contract-${process.pid}`).replace(/\\/g, '/')
const clock = genClockTZ('Asia/Taipei')
const SETTINGS = resolveSummarizeSettings({ summarize: { triage: { enabled: false } } })
let seq = 0
const dirOf = (tag) => `${TMP}/${tag}-${++seq}`

// ── 任意領域之規則(醫學:最高級須經臨床試驗;天文:最高級須經獨立觀測證實)──
const MED_RULE = Object.freeze({ subject: '臨床試驗', check: '臨床試驗', strict: [{ p: '(?:未經|沒有|無)臨床試驗' }], loose: [{ p: '(?:未|無)[^；;。]{0,10}臨床試驗' }] })
const ASTRO_RULE = Object.freeze({ subject: '獨立觀測', check: '獨立觀測證實', strict: [{ p: '(?:未經|沒有|無)獨立觀測' }], loose: [{ p: '(?:未|無)[^；;。]{0,10}獨立觀測' }] })
const V_MED = resolveSummarizeVocab({ evidenceRule: MED_RULE })
const V_ASTRO = resolveSummarizeVocab({ evidenceRule: ASTRO_RULE })
const V_NONE = resolveSummarizeVocab({}) // 本套件預設:未給 evidenceRule

// 醫學規則之訊息(evidenceRules 之訊息模板代入規則之用詞與 caveat 原文)
const STRICT_CAVEAT = '未經臨床試驗'
const LOOSE_CAVEAT = '未說明是否進行過臨床試驗'
const VIOLATION = `證據等級「高」卻自承：${STRICT_CAVEAT}`
const UNDETERMINED = `caveat 涉及臨床試驗而未明確自承(須判讀)：${LOOSE_CAVEAT}`
const HINT = '請明確寫出是否做過臨床試驗，或降低證據等級'
const FIX = '證據等級「高」與 caveat 自承無臨床試驗矛盾 → 降為「中」'
const CHANGE = `證據等級「高」→「中」（自承：${STRICT_CAVEAT}）`

// ── 同一組筆記(四種):最高級＋嚴式命中、最高級＋只命中寬式、最高級＋皆無、非最高級(嚴式之 caveat)──
const IDS = ['strict', 'loose', 'none', 'nontop']
// note:證據說明(只有給 alt 之規則才讀;嚴式者肯定陳述另一種合格證據、寬式者為否定句)
const VARIANTS = {
    strict: { title: '動物模式之藥效評估', level: '高', caveats: ['僅有動物模式之結果', STRICT_CAVEAT], note: '已有大型真實世界數據佐證' },
    loose: { title: '藥物交互作用之文獻回顧', level: '高', caveats: [LOOSE_CAVEAT], note: '未見真實世界數據' },
    none: { title: '問卷信度之重測分析', level: '高', caveats: ['樣本數少'] },
    nontop: { title: '單一病例之觀察報告', level: '中', caveats: [STRICT_CAVEAT] },
}
const itemOfVariant = (v) => itemOf(1, VARIANTS[v].title, { evidence_level: VARIANTS[v].level, caveats: VARIANTS[v].caveats, ...(VARIANTS[v].note ? { evidence_note: VARIANTS[v].note } : {}) })
// 最高級＝經臨床試驗或有真實世界數據(另一種合格證據 alt)
const ALT_RULE = Object.freeze({ ...MED_RULE, alt: [{ p: '^(?!.*(?:未|無|沒有|缺乏)).*(?<!非)真實世界數據' }] })
const V_ALT = resolveSummarizeVocab({ evidenceRule: ALT_RULE })

/**
 * 證據等級(記錄、frontmatter、品質章之行三處須一致;不一致時回傳三值以利定位)
 *
 * @param {Object} rec 輸入筆記記錄(或記錄＋patch)
 * @param {Object} md 輸入 md { front, body }
 * @returns {String} 回傳證據等級或「不一致：…」
 */
function levelOf(rec, md) {
    const line = ((/^- 證據等級：([^（\n]+)/m.exec(md?.body || '') || [])[1] || '').trim()
    const vals = [rec?.evidenceLevel, md?.front?.evidence_level, line]
    return new Set(vals).size === 1 ? vals[0] : `不一致：${vals.join('／')}`
}

/**
 * 落地形態之筆記(以正式之組裝 buildNote 組、寫 md;證據等級與 caveats 原樣——即入口處理前之狀態)
 *
 * @param {String} dir 輸入暫存目錄
 * @param {String} v 輸入變體
 * @param {Object} domain 輸入摘要 domain
 * @returns {Object} 回傳筆記記錄
 */
function landed(dir, v, domain) {
    const b = buildNote({ k: itemOfVariant(v), doc: rawDoc(v, { title: VARIANTS[v].title }), domain, notesDir: `${dir}/notes`, nowIso: clock.iso8() })
    writeMd(b.file, b.front, b.body)
    return b.record
}
const strip = (prefix) => (x) => x.slice(prefix.length)

// ════════════════ 五入口(各自之暫存與集合;回傳每變體之 { level, explain, pending, … })════════════════

/** 新進:摘要子階段(納入閘之正規化降級 → 組版 → 落地前 checkNote);AI 為替身,依提示詞中之網址回該文件之項目 */
async function viaNew(vocab) {
    const dir = dirOf('new')
    const docs = memStore(IDS.map((v) => rawDoc(v, { title: VARIANTS[v].title })))
    const notes = memStore()
    const holds = memStore()
    const callAI = async (prompt) => ({ ok: true, data: [itemOfVariant(/example\.com\/(\w+)/.exec(prompt)[1])], providerId: 'p1' })
    const deps = { stores: { docs, notes, frontier: memStore(), holds }, settings: SETTINGS, clock, dirs: { notes: `${dir}/notes` }, domains: { summarize: createSummarizeDomain({ vocab }) } }
    await stageSummarize({ docsPerBatch: 1, parallel: IDS.length, rounds: 1, callAI }).run({ deps, log: recLog() })
    const out = {}
    for (const v of IDS) {
        const [note] = await notes.select({ docId: v })
        const h = await holds.get(`doc:${v}:SS11`)
        out[v] = {
            level: note ? levelOf(note, readMd(note.file)) : null,
            explain: (note?.stdFixes || []).filter((x) => /^證據等級「/.test(x)),
            pending: h?.status === 'open' ? h : null,
            doc: await docs.get(v),
        }
    }
    return out
}

/** 同步:首見回填後,使用者修訂標題(雜湊改變)→ syncNotes 之同步入口 */
async function viaSync(vocab) {
    const dir = dirOf('sync')
    const domain = createSummarizeDomain({ vocab })
    const recs = Object.fromEntries(IDS.map((v) => [v, landed(dir, v, domain)]))
    const notes = memStore(Object.values(recs))
    const holds = memStore()
    const deps = { stores: { notes, holds }, dirs: { state: `${dir}/state` }, clock, log: recLog(), vocab }
    await syncNotes(deps)
    for (const r of Object.values(recs)) {
        const md = readMd(r.file)
        writeMd(r.file, { ...md.front, title: `${md.front.title}（修訂）` }, md.body)
    }
    const det = await syncNotes(deps, { all: true })
    assert.equal(det.changed, IDS.length, '前提:四篇皆經同步入口')
    const out = {}
    for (const v of IDS) {
        const rec = await notes.get(recs[v].id)
        const h = await holds.get(`note:${rec.id}:SS11`)
        out[v] = { level: levelOf(rec, readMd(rec.file)), explain: (rec.stdFixes || []).filter((x) => x.startsWith('同步 SS11：')).map(strip('同步 SS11：')), pending: h?.status === 'open' ? h : null }
    }
    return out
}

/** 還原:還原閘之 check(判定與確定性修正,不寫) */
async function viaRestore(vocab) {
    const dir = dirOf('restore')
    const domain = createSummarizeDomain({ vocab })
    const gate = createNoteRestoreGate({ stores: { notes: memStore(), holds: memStore() }, vocab, clock })
    const out = {}
    for (const v of IDS) {
        const rec = landed(dir, v, domain)
        const r = await gate.check({ record: rec, md: readMd(rec.file) })
        out[v] = {
            level: levelOf({ ...rec, ...r.recordPatch }, r.md),
            explain: (r.recordPatch.stdFixes || []).filter((x) => x.startsWith('還原 SS11：')).map(strip('還原 SS11：')),
            pending: r.undetermined.find((x) => x.std === 'SS11') || null,
            status: r.results.find((x) => x.std === 'SS11')?.status,
        }
    }
    return out
}

/** 存量:預演(目標取自掃描)→ 套用(修法 noteFixOf;處置帳落 dirs.state) */
async function viaStock(vocab) {
    const dir = dirOf('stock')
    const domain = createSummarizeDomain({ vocab })
    const recs = Object.fromEntries(IDS.map((v) => [v, landed(dir, v, domain)]))
    const notes = memStore(Object.values(recs))
    const deps = { stores: { notes, holds: memStore() }, vocab, clock, dirs: { state: `${dir}/state` } }
    const plan = await planNoteStockFix(deps, { stds: ['SS11'] })
    const applied = await applyNoteStockFix(deps, plan)
    assert.deepEqual(applied.errors, [], '前提:套用無錯')
    const out = {}
    for (const v of IDS) {
        const rec = await notes.get(recs[v].id)
        const item = plan.items.find((x) => x.id === rec.id)
        out[v] = {
            level: levelOf(rec, readMd(rec.file)),
            explain: (rec.stdFixes || []).filter((x) => x.startsWith('存量 SS11：')).map(strip('存量 SS11：')),
            planned: (item?.changes || []).filter((c) => c.std === 'SS11').map((c) => c.what),
            pending: plan.unfixable.find((u) => u.id === rec.id) || null,
        }
    }
    return out
}

/** 掃描:逐篇唯讀掃描(每篇一個集合,判定可逐篇對應) */
async function viaAudit(vocab) {
    const dir = dirOf('audit')
    const domain = createSummarizeDomain({ vocab })
    const out = {}
    for (const v of IDS) {
        const rec = landed(dir, v, domain)
        const st = (await auditSummarizeStandards({ stores: { notes: memStore([rec]) }, vocab }, { only: ['SS11'] })).standards.SS11
        const status = ['violation', 'undetermined', 'pass', 'na', 'waived'].filter((k) => st[k] > 0)
        out[v] = { status: status.length === 1 ? status[0] : `計數異常：${JSON.stringify(st)}`, detail: st.violations[0]?.detail || st.undetermineds[0]?.detail || '', fp: st.fp, level: levelOf(rec, readMd(rec.file)) }
    }
    return out
}

/** 五入口之結果 */
async function outcomesOf(vocab) {
    return { 新進: await viaNew(vocab), 同步: await viaSync(vocab), 還原: await viaRestore(vocab), 存量: await viaStock(vocab), 掃描: await viaAudit(vocab) }
}

/** 可修之入口之處置:降級／未能判定(不降級而列為待判)／不動;新進未落地者為不納入 */
function verdictOf(o, v) {
    if (o.level === null) return o.pending ? '不納入(未能判定)' : '不納入'
    if (o.level !== VARIANTS[v].level) return '降級'
    return o.pending ? '未能判定' : '不動'
}
/** 五入口之處置表(變體 → 入口 → 處置;掃描取其判定) */
const tableOf = (O) => Object.fromEntries(IDS.map((v) => [v, { 新進: verdictOf(O.新進[v], v), 同步: verdictOf(O.同步[v], v), 還原: verdictOf(O.還原[v], v), 存量: verdictOf(O.存量[v], v), 掃描: O.掃描[v].status }]))
const FIXABLE = ['新進', '同步', '還原', '存量']

describe('unit-summarize-contract', function() {

    const O = {}
    before(async function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
        O.MED = await outcomesOf(V_MED)
        O.NONE = await outcomesOf(V_NONE)
        O.ASTRO = await outcomesOf(V_ASTRO)
        O.ALT = await outcomesOf(V_ALT)
    })
    after(() => {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ══════════════════════════ SS11 五入口一致(檢定標準驗收 5)══════════════════════════
    describe('SS11 五入口一致:新進、同步、還原、存量、掃描', function() {

        it('處置一致(醫學規則「臨床試驗」):嚴式 → 可修之入口皆降一級、掃描判不合格;只命中寬式 → 皆不降級(新進不納入、同步與還原列為未能判定、存量不處置)、掃描判未能判定;無涉 → 皆不動、掃描判合格;非最高級 → 皆不動、掃描判不適用', () => {
            assert.deepEqual(tableOf(O.MED), {
                strict: { 新進: '降級', 同步: '降級', 還原: '降級', 存量: '降級', 掃描: 'violation' },
                loose: { 新進: '不納入(未能判定)', 同步: '未能判定', 還原: '未能判定', 存量: '不動', 掃描: 'undetermined' },
                none: { 新進: '不動', 同步: '不動', 還原: '不動', 存量: '不動', 掃描: 'pass' },
                nontop: { 新進: '不動', 同步: '不動', 還原: '不動', 存量: '不動', 掃描: 'na' },
            })
        })

        it('不合格之降級說明出自同一規則:同步、還原、存量記同一句變更說明(引自承之 caveat 原文),新進記修正說明,掃描記不合格說明;皆降至次高級且 md 與記錄一致', () => {
            const d = evidenceRuleOf(MED_RULE).downgrade({ level: '高', levels: V_MED.evidenceLevels, caveats: VARIANTS.strict.caveats })
            assert.deepEqual([d.fix, d.change, d.caveat], [FIX, CHANGE, STRICT_CAVEAT], '規則之兩種說明(單一實作)')
            for (const e of ['同步', '還原', '存量']) assert.deepEqual(O.MED[e].strict.explain, [CHANGE], `${e} 記同一句變更說明`)
            assert.deepEqual(O.MED.存量.strict.planned, [CHANGE], '存量之預演即列同一句')
            assert.deepEqual(O.MED.新進.strict.explain, [FIX], '新進記修正說明')
            assert.equal(O.MED.掃描.strict.detail, VIOLATION, '掃描記不合格說明')
            for (const e of FIXABLE) assert.equal(O.MED[e].strict.level, '中', `${e} 降至次高級(記錄、frontmatter、品質章之行一致)`)
        })

        it('未能判定 → 皆不降級,說明同一句:新進不納入、回饋附更正方向、待判由管線下輪附回饋重摘;同步登錄待判(使用者);還原列出未能判定;掃描記未能判定;存量處置之對象為不合格者而不動', () => {
            const n = O.MED.新進.loose
            assert.deepEqual([n.level, n.doc.status, n.doc.summarizeTries], [null, 'raw', 1], '新進不納入、記 tries')
            assert.equal(n.doc.stdFeedback, `SS11 ${UNDETERMINED}——${HINT}`, '回饋附更正方向(措辭出自規則)')
            assert.deepEqual([n.pending.owner, n.pending.next, n.pending.reason.includes(`SS11 ${UNDETERMINED}`)], ['pipeline', DOC_HOLD_NEXT.retry, true])
            const s = O.MED.同步.loose
            assert.deepEqual([s.level, s.pending.owner, s.pending.next], ['高', 'user', NOTE_HOLD_NEXT])
            assert.ok(s.pending.reason.startsWith('筆記同步後未能判定（SS11）：〈') && s.pending.reason.endsWith(UNDETERMINED), s.pending.reason)
            const r = O.MED.還原.loose
            assert.deepEqual([r.level, r.status, r.pending.detail], ['高', 'undetermined', UNDETERMINED])
            const k = O.MED.存量.loose
            assert.deepEqual([k.level, k.explain, k.planned, k.pending], ['高', [], [], null], '存量不處置未能判定者')
            assert.deepEqual([O.MED.掃描.loose.status, O.MED.掃描.loose.detail], ['undetermined', UNDETERMINED])
        })

        it('合格／不適用 → 皆不動:證據等級不變、無 SS11 修正紀錄、無 SS11 待判;掃描分判合格與不適用', () => {
            for (const v of ['none', 'nontop']) {
                for (const e of FIXABLE) {
                    const o = O.MED[e][v]
                    assert.deepEqual([o.level, o.explain, o.pending], [VARIANTS[v].level, [], null], `${e}:${v}`)
                }
                assert.equal(O.MED.還原[v].status, v === 'none' ? 'pass' : 'na')
            }
            assert.deepEqual([O.MED.掃描.none.status, O.MED.掃描.nontop.status], ['pass', 'na'])
        })

        it('未給 evidenceRule 之詞彙(本套件預設)→ 五入口皆不適用、皆不降級:原嚴式與寬式之筆記新進即納入(最高級不變),同步、還原、存量不動,掃描全數不適用且規則指紋為空', () => {
            const all = (verdict, scan) => ({ 新進: verdict, 同步: verdict, 還原: verdict, 存量: verdict, 掃描: scan })
            assert.deepEqual(tableOf(O.NONE), { strict: all('不動', 'na'), loose: all('不動', 'na'), none: all('不動', 'na'), nontop: all('不動', 'na') })
            for (const v of IDS) {
                assert.equal(O.NONE.還原[v].status, 'na', v)
                assert.equal(O.NONE.掃描[v].fp, '', `${v}:規則停用之指紋為空字串`)
                for (const e of FIXABLE) assert.deepEqual(O.NONE[e][v].explain, [], `${e}:${v} 無 SS11 修正`)
            }
            assert.deepEqual([O.NONE.新進.strict.level, O.NONE.新進.loose.level], ['高', '高'], '新進即納入、最高級不變')
        })

        it('規則由詞彙決定:同一組筆記換以天文規則「獨立觀測」→ 原嚴式、寬式、無涉者皆判合格(不降級、不登錄),非最高級仍不適用;同一篇筆記之 caveat 換成該規則之用詞即不合格;兩規則之指紋不同', () => {
            const all = (scan) => ({ 新進: '不動', 同步: '不動', 還原: '不動', 存量: '不動', 掃描: scan })
            assert.deepEqual(tableOf(O.ASTRO), { strict: all('pass'), loose: all('pass'), none: all('pass'), nontop: all('na') })
            const [fpMed, fpAstro] = [O.MED.掃描.strict.fp, O.ASTRO.掃描.strict.fp]
            assert.ok(/^[0-9a-f]{16}$/.test(fpMed) && /^[0-9a-f]{16}$/.test(fpAstro) && fpMed !== fpAstro, `${fpMed}／${fpAstro}`)
            // 判定之單一實作(checkNote):同一篇筆記,caveat 為「未經獨立觀測」→ 天文規則不合格、醫學規則合格
            const md = { front: { title: '星系巡天之紅移分析', concepts: ['紅移', '巡天'], claim_type: '實證研究', evidence_level: '高', caveats: ['未經獨立觀測'] }, body: '# 星系巡天之紅移分析\n\n## 一句話重點\n\n重點\n\n## 核心知識\n\n- 要點' }
            const ss11 = (vocab) => checkNote(md, { vocab }).find((r) => r.std === 'SS11')
            assert.deepEqual([ss11(V_ASTRO).status, ss11(V_ASTRO).detail, ss11(V_MED).status], ['violation', '證據等級「高」卻自承：未經獨立觀測', 'pass'])
        })

        it('另一種合格證據(alt):最高級之定義為「臨床試驗或真實世界數據」→ 嚴式命中而證據說明肯定陳述真實世界數據者五入口皆不動、掃描判合格;證據說明為否定句者不算(寬式仍未能判定);其餘變體同無 alt;指紋與無 alt 者不同', () => {
            const MED = tableOf(O.MED)
            assert.deepEqual(tableOf(O.ALT), {
                strict: { 新進: '不動', 同步: '不動', 還原: '不動', 存量: '不動', 掃描: 'pass' },
                loose: MED.loose,
                none: MED.none,
                nontop: MED.nontop,
            })
            for (const e of FIXABLE) assert.deepEqual([O.ALT[e].strict.level, O.ALT[e].strict.explain, O.ALT[e].strict.pending], ['高', [], null], `${e}:strict 不降級、無 SS11 修正、無待判`)
            assert.equal(O.ALT.還原.strict.status, 'pass')
            assert.deepEqual([O.ALT.掃描.loose.status, O.ALT.掃描.loose.detail], ['undetermined', UNDETERMINED], '寬式之說明不因 alt 改變')
            const [fpMed, fpAlt] = [O.MED.掃描.strict.fp, O.ALT.掃描.strict.fp]
            assert.ok(/^[0-9a-f]{16}$/.test(fpAlt) && fpAlt !== fpMed, `${fpMed}／${fpAlt}`)
        })
    })

    // ══════════════════════════ 修補後重閘(寫入入口之一)同受筆記標準 ══════════════════════════
    describe('修補後重閘同受筆記標準:修補回覆之內容再經同一閘', function() {
        const DOC_TEXT = '本研究說明受試者之分組方法、追蹤方式與評估指標，並討論研究之限制。'
        // 被指出之處(依受檢欄位之序):1＝核心知識第 2 行(「12 人」原文沒有)、2＝限制第 1 行(「6 個月」原文沒有);類別在清單外
        const ITEM = itemOf(1, '分組方法之研究', { evidence_level: '高', key_points: ['分組之方法', '受試者 12 人'], caveats: ['追蹤 6 個月'], category: '新興主題' })
        const REPLY = { repairs: [{ no: 1, value: '受试者分组之方法' }, { no: 2, value: STRICT_CAVEAT }] }
        // 被指出之處:1＝概念第 2 個(「12 人」原文沒有);修補回覆擠一標籤之多概念(各段非既有概念)
        const ITEM6 = itemOf(1, '分組方法之研究', { concepts: ['研究方法', '樣本 12 人'] })
        const REPLY6 = { repairs: [{ no: 1, value: '樣本數、追蹤期' }] }

        /** 修補開啟之摘要段(替身:摘要回 item、修補回 reply) */
        async function viaRepair(vocab, item = ITEM, reply = REPLY) {
            const dir = dirOf('repair')
            const docs = memStore([rawDoc('rp', { title: '分組方法之研究', text: DOC_TEXT })])
            const notes = memStore()
            const holds = memStore()
            const segs = []
            const callAI = async (prompt, check, o = {}) => {
                segs.push(o.segment || 'summarize')
                if (o.segment === 'summarizeRepair') return check(reply) ? { ok: true, data: reply, providerId: 'p1' } : { ok: false, error: '形狀不合', skipped: false }
                return { ok: true, data: [item], providerId: 'p1' }
            }
            const settings = resolveSummarizeSettings({ summarize: { triage: { enabled: false }, standards: { repair: { enabled: true } } } })
            await stageSummarize({ docsPerBatch: 1, parallel: 1, rounds: 1, callAI }).run({ deps: { stores: { docs, notes, frontier: memStore(), holds }, settings, clock, dirs: { notes: `${dir}/notes` }, domains: { summarize: createSummarizeDomain({ vocab }) } }, log: recLog() })
            const [n] = await notes.select()
            return { segs, n, md: n ? readMd(n.file) : null, doc: await docs.get('rp'), holds }
        }

        it('修補回覆之內容再經同一閘:以簡體回覆被指出之行 → 轉正體;被指出之 caveat 改寫為嚴式自承 → 最高級降一級(說明同新進之修正說明);未給 evidenceRule 之詞彙 → 不降級;清單外之類別仍落後備類別', async () => {
            const med = await viaRepair(V_MED)
            assert.deepEqual(med.segs, ['summarize', 'summarizeRepair'], '前提:發生一次修補呼叫')
            assert.equal(levelOf(med.n, med.md), '中', '降一級')
            assert.ok(med.n.stdFixes.includes(FIX), JSON.stringify(med.n.stdFixes))
            assert.ok(med.md.body.includes('- 受試者分組之方法') && !med.md.body.includes('受试者'), '轉正體')
            assert.deepEqual([med.n.category, med.n.categoryRaw, med.md.front.category], ['其他', '新興主題', '其他'], '清單外之類別落後備類別、原值存 categoryRaw(SS9)')
            const none = await viaRepair(V_NONE)
            assert.equal(levelOf(none.n, none.md), '高', '未給規則 → 不降級')
            assert.equal(none.n.stdFixes.includes(FIX), false)
            assert.ok(none.md.body.includes('- 受試者分組之方法'), '轉正體與規則無關')
        })

        it('修補回覆之內容同受概念標籤之形式:以擠一標籤之多概念回覆被指出之概念(各段非既有概念)→ 不拆,落地前判 SS6 不合格 → 不納入、記 tries、回饋與待判 SS6', async () => {
            const r = await viaRepair(V_MED, ITEM6, REPLY6)
            assert.deepEqual(r.segs, ['summarize', 'summarizeRepair'], '前提:發生一次修補呼叫')
            assert.equal(r.n, undefined, '不納入')
            assert.deepEqual([r.doc.status, r.doc.summarizeTries], ['raw', 1])
            assert.match(r.doc.stdFeedback, /SS6 多概念擠一標籤「樣本數、追蹤期」/)
            assert.equal((await r.holds.get('doc:rp:SS6'))?.owner, 'pipeline')
        })
    })

    // ══════════════════════════ 人工匯入與掃描同受筆記標準(SS3／SS6)══════════════════════════
    describe('人工匯入與掃描同受筆記標準:正體與概念標籤之形式', function() {
        /** 既有筆記(其概念為既有概念:擠標籤之拆分條件) */
        const OLD = () => ({ id: 'old', title: '舊筆記', concepts: ['光譜分析', '紅移'], file: `${TMP}/none.md` })

        it('人工匯入:簡體標題轉正體;擠一標籤之多概念各段皆為既有概念 → 拆開;有段非既有概念 → 落地前判 SS6 不合格而不入庫,訊息附 SS6 之說明', async () => {
            const dir = dirOf('ingest')
            const notes = memStore([OLD()])
            const r = await ingestNotes({ stores: { docs: memStore(), notes }, dirs: { notes: `${dir}/notes` }, clock, domain: createSummarizeDomain({ vocab: V_MED }), identity: captureIdentityOf(DEFAULT_DEDUP) }, [
                { url: 'https://example.com/i1', note: itemOf(1, '星系红移之测量', { concepts: ['光譜分析、紅移', '觀測方法'] }) },
                { url: 'https://example.com/i2', note: itemOf(1, '星系巡天之資料', { concepts: ['新奇概念、紅移', '觀測方法'] }) },
            ])
            assert.deepEqual([r.added, r.bad], [1, 1], r.messages.join('\n'))
            const n = (await notes.select()).find((x) => x.id !== 'old')
            assert.deepEqual([n.title, n.concepts], ['星系紅移之測量之重點', ['光譜分析', '紅移', '觀測方法']])
            assert.ok(r.messages.some((m) => m.startsWith('✗ 未達檢定標準（SS6 多概念擠一標籤「新奇概念、紅移」）')), r.messages.join('\n'))
        })

        it('掃描:擠一標籤之多概念 → SS6 不合格(說明同落地前之判定);簡體 → SS3 不合格;皆無 → 合格', async () => {
            const dir = dirOf('audit-ss6')
            const domain = createSummarizeDomain({ vocab: V_MED })
            const land = (id, title, concepts) => {
                const b = buildNote({ k: itemOf(1, title, { concepts }), doc: rawDoc(id, { title }), domain, notesDir: `${dir}/notes`, nowIso: clock.iso8() })
                writeMd(b.file, b.front, b.body)
                return b.record
            }
            const recs = [land('q1', '星系巡天之資料', ['新奇概念、紅移', '觀測方法']), land('q2', '星系红移之测量', ['紅移', '觀測方法']), land('q3', '恆星光譜之分類', ['光譜分析', '恆星'])]
            const rep = await auditSummarizeStandards({ stores: { notes: memStore(recs) }, vocab: V_MED }, { only: ['SS3', 'SS6'] })
            assert.deepEqual([rep.standards.SS6.violation, rep.standards.SS6.pass, rep.standards.SS6.violations], [1, 2, [{ id: recs[0].id, detail: '多概念擠一標籤「新奇概念、紅移」' }]])
            assert.deepEqual([rep.standards.SS3.violation, rep.standards.SS3.violations.map((x) => x.id)], [1, [recs[1].id]])
            const ss6 = checkNote({ front: buildNote({ k: itemOf(1, '星系巡天之資料', { concepts: ['新奇概念、紅移', '觀測方法'] }), doc: rawDoc('q1', { title: '星系巡天之資料' }), domain, notesDir: `${dir}/x`, nowIso: clock.iso8() }).front, body: '' }, { vocab: V_MED }).find((x) => x.std === 'SS6')
            assert.equal(ss6.detail, rep.standards.SS6.violations[0].detail, '與落地前之判定同一說明')
        })
    })

    // ══════════════════════════ 還原閘之對外契約(假還原流程)══════════════════════════
    describe('還原閘之對外契約(呼叫端注入之假還原流程;README §1)', function() {

        /**
         * 封存之筆記(記錄＋md 全文;md 檔不在磁碟——還原時才寫回)
         *
         * @param {String} dir 輸入暫存目錄
         * @param {String} id 輸入來源文件 id
         * @param {String} title 輸入原文標題
         * @param {Object} [o={}] 輸入 { item:摘要項目之覆寫, syncHash:Boolean(封存之記錄原有同步雜湊), vocab:封存當時之詞彙表(預設 V_MED) }
         * @returns {Object} 回傳 { record, md }
         */
        function archived(dir, id, title, o = {}) {
            const b = buildNote({ k: itemOf(1, title, o.item || {}), doc: rawDoc(id, { title }), domain: createSummarizeDomain({ vocab: o.vocab || V_MED }), notesDir: `${dir}/notes`, nowIso: clock.iso8() })
            const record = { ...b.record, ...(o.syncHash ? { syncHash: syncHashOf(syncFieldsOf({ front: b.front, body: b.body })) } : {}) }
            return { record, md: { front: b.front, body: b.body } }
        }

        /**
         * 假還原流程(呼叫端依 README §1 與還原閘檔頭【處置】注入還原閘):check 判定(不寫)→ 仍不合格而未明示接受 → 不還原並列出;
         *   否則寫回確定性修正後之 md 與記錄(套 recordPatch),仍不合格或未能判定者以 hold 登錄待判
         *
         * @param {Object} env 輸入 { gate, notes }
         * @param {Object} item 輸入封存之筆記 { record, md }
         * @param {Object} [opt={}] 輸入 { accept:Boolean(使用者明示接受不合格者) }
         * @returns {Promise} 回傳 Promise,resolve 回傳 { restored, listed, held, noHolds, check }
         */
        async function restoreNote({ gate, notes }, item, { accept = false } = {}) {
            const r = await gate.check({ record: item.record, md: item.md })
            const listed = r.violations.map((x) => `${x.std} ${x.detail}`)
            if (listed.length && !accept) return { restored: false, listed, held: [], noHolds: false, check: r }
            writeMd(item.record.file, r.md.front, r.md.body)
            const rec = { ...item.record, ...r.recordPatch }
            await notes.insertNew([rec])
            const h = listed.length || r.undetermined.length ? await gate.hold(rec, r.results) : { held: [], noHolds: false }
            return { restored: true, listed, held: h.held, noHolds: h.noHolds, check: r }
        }

        it('可修者:確定性修正後還原——md 與記錄為修正後之值(正體標題、最高級降一級)、記錄同步標題／概念／一句話重點、syncHash 依修正後之 md(原有才寫)、stdFixes 留「還原 SSx」、不寫 knowledgeChangedAt;還原後之下一輪同步不報內容變更;掃描之判定同 check', async () => {
            const dir = dirOf('restore-ok')
            const notes = memStore()
            const holds = memStore()
            const gate = createNoteRestoreGate({ stores: { notes, holds }, vocab: V_MED, clock })
            const a = archived(dir, 'ra', '临床指引之更新', { syncHash: true, item: { evidence_level: '高', caveats: [STRICT_CAVEAT] } })
            const b = archived(dir, 'rb', '临床路径之比较', { item: { evidence_level: '高', caveats: [STRICT_CAVEAT] } })
            const ra = await restoreNote({ gate, notes }, a)
            const rb = await restoreNote({ gate, notes }, b)
            assert.deepEqual([ra.restored, ra.listed, ra.held, rb.restored, rb.held], [true, [], [], true, []], '修正後合格 → 還原、不登錄')
            const mdA = readMd(a.record.file)
            const recA = await notes.get(a.record.id)
            const f = syncFieldsOf(mdA)
            assert.deepEqual([mdA.front.title, levelOf(recA, mdA)], ['臨床指引之更新之重點', '中'], '寫回修正後之 md 與記錄')
            assert.deepEqual([recA.title, recA.concepts, recA.summary], [f.title, f.concepts, f.summary], '記錄同步標題／概念／一句話重點')
            assert.equal(recA.syncHash, syncHashOf(f), 'syncHash 依修正後之 md')
            assert.ok(recA.stdFixes.includes('還原 SS3：標題「临床指引之更新之重點」→「臨床指引之更新之重點」') && recA.stdFixes.includes(`還原 SS11：${CHANGE}`), JSON.stringify(recA.stdFixes))
            assert.equal('knowledgeChangedAt' in recA, false, '不寫 knowledgeChangedAt')
            assert.equal('syncHash' in (await notes.get(b.record.id)), false, '封存之記錄原無 syncHash → 不寫')
            // 還原後之下一輪同步:A 雜湊與 md 相同 → 不報內容變更;B 首見回填;皆不寫 knowledgeChangedAt
            const det = await syncNotes({ stores: { notes, holds }, dirs: { state: `${dir}/state` }, clock, log: recLog(), vocab: V_MED }, { all: true })
            assert.deepEqual([det.changed, det.backfilled], [0, 1])
            for (const id of [a.record.id, b.record.id]) assert.equal((await notes.get(id)).knowledgeChangedAt, undefined, id)
            // 還原後之掃描:逐標準之判定同 check
            const rep = await auditSummarizeStandards({ stores: { notes: memStore([await notes.get(a.record.id)]) }, vocab: V_MED }, { only: ['SS2', 'SS3', 'SS6', 'SS11'] })
            const got = Object.fromEntries(Object.entries(rep.standards).map(([std, st]) => [std, ['violation', 'undetermined', 'pass', 'na'].find((k) => st[k] === 1)]))
            assert.deepEqual(got, Object.fromEntries(ra.check.results.map((x) => [x.std, x.status])))
            assert.deepEqual(got, { SS2: 'pass', SS3: 'pass', SS6: 'pass', SS11: 'na' })
        })

        it('仍不合格而未明示接受 → 不還原並列出不合格之標準與說明;md、記錄、待判皆不寫(check 本身不寫)', async () => {
            const dir = dirOf('restore-bad')
            const notes = memStore()
            const holds = memStore()
            const gate = createNoteRestoreGate({ stores: { notes, holds }, vocab: V_MED, clock })
            const c = archived(dir, 'rc', '單一概念之筆記', { item: { concepts: ['唯一概念'] } })
            const r = await restoreNote({ gate, notes }, c)
            assert.deepEqual([r.restored, r.listed], [false, ['SS2 概念 1 個（須 2～6）']])
            assert.deepEqual([fs.existsSync(c.record.file), await notes.select(), await holds.select()], [false, [], []])
        })

        it('使用者明示接受 → 照還原並登錄待判:負責者使用者、原因「還原筆記後未達檢定標準」、下一步為修正後由筆記同步重驗或豁免', async () => {
            const dir = dirOf('restore-accept')
            const notes = memStore()
            const holds = memStore()
            const gate = createNoteRestoreGate({ stores: { notes, holds }, vocab: V_MED, clock })
            const c = archived(dir, 'rc', '單一概念之筆記', { item: { concepts: ['唯一概念'] } })
            const r = await restoreNote({ gate, notes }, c, { accept: true })
            assert.deepEqual([r.restored, r.held], [true, ['SS2']])
            assert.ok(fs.existsSync(c.record.file) && await notes.get(c.record.id), '照還原')
            const h = await holds.get(`note:${c.record.id}:SS2`)
            assert.deepEqual([h.status, h.owner, h.next], ['open', 'user', NOTE_HOLD_NEXT])
            assert.match(h.reason, /^還原筆記後未達檢定標準（SS2）：〈單一概念之筆記之重點〉概念 1 個（須 2～6）$/)
        })

        it('未能判定 → 照還原(不須明示接受)並登錄待判:負責者使用者、原因「還原筆記後未能判定」;最高級不降級', async () => {
            const dir = dirOf('restore-undet')
            const notes = memStore()
            const holds = memStore()
            const gate = createNoteRestoreGate({ stores: { notes, holds }, vocab: V_MED, clock })
            const d = archived(dir, 'rd', '藥物交互作用之回顧', { item: { evidence_level: '高', caveats: [LOOSE_CAVEAT] } })
            const r = await restoreNote({ gate, notes }, d)
            assert.deepEqual([r.restored, r.listed, r.held], [true, [], ['SS11']])
            assert.equal(levelOf(await notes.get(d.record.id), readMd(d.record.file)), '高')
            const h = await holds.get(`note:${d.record.id}:SS11`)
            assert.deepEqual([h.status, h.owner], ['open', 'user'])
            assert.equal(h.reason, `還原筆記後未能判定（SS11）：〈藥物交互作用之回顧之重點〉${UNDETERMINED}`)
        })

        it('擠一標籤之多概念(SS6):各段皆為既有概念 → 拆開後還原(stdFixes 留「還原 SS6」);有段非既有概念 → 仍不合格,未明示接受即不還原並列出', async () => {
            const dir = dirOf('restore-ss6')
            const notes = memStore([{ id: 'old', title: '舊筆記', concepts: ['光譜分析', '紅移'], file: `${dir}/none.md` }])
            const gate = createNoteRestoreGate({ stores: { notes, holds: memStore() }, vocab: V_MED, clock })
            const ok = archived(dir, 'rs1', '星系紅移之測量', { item: { concepts: ['光譜分析、紅移', '觀測方法'] } })
            const r1 = await restoreNote({ gate, notes }, ok)
            assert.deepEqual([r1.restored, (await notes.get(ok.record.id)).concepts, readMd(ok.record.file).front.concepts], [true, ['光譜分析', '紅移', '觀測方法'], ['光譜分析', '紅移', '觀測方法']])
            assert.ok((await notes.get(ok.record.id)).stdFixes.includes('還原 SS6：概念拆開「光譜分析、紅移」'))
            const bad = archived(dir, 'rs2', '星系巡天之資料', { item: { concepts: ['新奇概念、紅移', '觀測方法'] } })
            const r2 = await restoreNote({ gate, notes }, bad)
            assert.deepEqual([r2.restored, r2.listed, fs.existsSync(bad.record.file)], [false, ['SS6 多概念擠一標籤「新奇概念、紅移」'], false])
        })

        it('分類欄位(SS9):封存期間改名／退役而錯過重標者,還原時依現行分類法確定性對應——改名 → 新名(內容類型之改名同,不被清單檢查判不合格)、退役或清單外 → 後備類別並留原值於 categoryRaw;md 與記錄一致、寫 tagChangedAt、stdFixes 留「還原 SS9」;在清單內者不動', async () => {
            const dir = dirOf('restore-ss9')
            const notes = memStore()
            const V_OLD = resolveSummarizeVocab({ evidenceRule: MED_RULE, categories: ['方法與技術', '舊方法', '退役類', '其他'] })
            const claimNew = V_OLD.claimTypes.map((c) => (c === '實務經驗' ? '個案觀察' : c))
            const V_NEW = resolveSummarizeVocab({ evidenceRule: MED_RULE, categories: ['方法與技術', '新方法', '其他'], categoryRenames: { 舊方法: '新方法' }, categoryRetire: ['退役類'], claimTypes: claimNew, claimTypeRenames: { 實務經驗: '個案觀察' } })
            const gate = createNoteRestoreGate({ stores: { notes, holds: memStore() }, vocab: V_NEW, clock })
            const ren = archived(dir, 'rt1', '舊方法之筆記', { vocab: V_OLD, item: { category: '舊方法', claim_type: '實務經驗' } })
            assert.deepEqual([ren.record.category, ren.record.claimType], ['舊方法', '實務經驗'], '封存時之舊分類')
            const r1 = await restoreNote({ gate, notes }, ren)
            const rec1 = await notes.get(ren.record.id)
            const md1 = readMd(ren.record.file)
            assert.deepEqual([r1.restored, r1.listed], [true, []], '內容類型改名後不被清單檢查(SS2)判不合格')
            assert.deepEqual([rec1.category, rec1.claimType, md1.front.category, md1.front.claim_type], ['新方法', '個案觀察', '新方法', '個案觀察'])
            assert.match(md1.body, /- 內容類型：個案觀察/)
            assert.match(String(rec1.tagChangedAt), /^\d{4}-\d{2}-\d{2}T/, '分類有變更 → 寫 tagChangedAt(同重標)')
            assert.ok(rec1.stdFixes.includes('還原 SS9：類別「舊方法」依改名對照 →「新方法」') && rec1.stdFixes.includes('還原 SS9：內容類型「實務經驗」依改名對照 →「個案觀察」'), JSON.stringify(rec1.stdFixes))
            const ret = archived(dir, 'rt2', '退役類之筆記', { vocab: V_OLD, item: { category: '退役類' } })
            const r2 = await restoreNote({ gate, notes }, ret)
            const rec2 = await notes.get(ret.record.id)
            assert.deepEqual([r2.restored, rec2.category, rec2.categoryRaw, readMd(ret.record.file).front.category], [true, '其他', '退役類', '其他'], '退役 → 後備類別、原值存 categoryRaw')
            const keep = archived(dir, 'rt3', '方法與技術之筆記', { vocab: V_OLD, item: { category: '方法與技術' } })
            const r3 = await restoreNote({ gate, notes }, keep)
            const rec3 = await notes.get(keep.record.id)
            assert.deepEqual([r3.restored, rec3.category, 'tagChangedAt' in rec3, r3.check.changes.filter((c) => c.std === 'SS9')], [true, '方法與技術', false, []], '在清單內者不動')
        })

        it('未開待判集合 → hold 回 noHolds(呼叫端據以告警,不得視為已登錄);還原本身照做', async () => {
            const dir = dirOf('restore-noholds')
            const notes = memStore()
            const gate = createNoteRestoreGate({ stores: { notes }, vocab: V_MED, clock })
            const d = archived(dir, 're', '藥物交互作用之回顧', { item: { evidence_level: '高', caveats: [LOOSE_CAVEAT] } })
            const r = await restoreNote({ gate, notes }, d)
            assert.deepEqual([r.restored, r.held, r.noHolds], [true, [], true])
            assert.ok(await notes.get(d.record.id))
        })
    })
})
