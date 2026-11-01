// unit-summarize-registry.test.mjs — 摘要檢定標準之全集(standards/registry)之欄位完整性與單一來源
// 規則(出自 standards/registry 檔頭):
//   ①每條標準一列定義(id、標題、對象、kind、版本、能證明／不能證明、執行處、是否掃描、掃描說明);全集為 SS1～SS9、SS11、SS14
//     (SS10、SS12、SS13 不存在);欄序固定、全集與各列凍結
//   ②執行處為「套件內檔案:函數」:檔存在、檔內宣告該名(讀檔＋正則)、且 import 後為函數;同一標準之寫入入口皆列(新進閘、修補後重閘、
//     人工匯入、筆記同步、還原筆記、存量處置、掃描;人工匯入無原文不檢 SS4)
//   ③版本單一來源:程式判定之筆記標準之標題與版本取自 NOTE_STANDARDS;SS14 之版本取自 faithCheck 之 SS14;其餘為 1
//   ④scan 為 true 者＝掃描之 SUMMARIZE_AUDITED_STANDARD_IDS(依全集之序);AI 標準(SS5、SS9、SS14)不掃、掃描說明載明只計待判
//   ⑤能證明／不能證明為中立措辭(不含特定產業領域之詞彙、不指他工作之名);SS11 以 {check} 代稱規則之用詞並註明依 evidenceRule、未給規則不適用;
//     SS8 明示截斷
// 執行:自套件根 node <mocha> test/unit-summarize-registry.test.mjs(只讀檔與 import,不寫檔、不連網)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SUMMARIZE_STANDARDS } from '../src/standards/registry.mjs'
import { SUMMARIZE_AUDITED_STANDARD_IDS, SUMMARIZE_AI_PENDING_STANDARD_IDS, auditSummarizeStandards } from '../src/standards/audit.mjs'
import { NOTE_STANDARDS } from '../src/standards/noteStandards.mjs'
import { SS14 } from '../src/standards/faithCheck.mjs'
import { memStore, DOMAIN_TERM_RE } from './tools/captureForTest.mjs'

// 套件根(以本檔位置定,不依 cwd)
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IDS = ['SS1', 'SS2', 'SS3', 'SS4', 'SS5', 'SS6', 'SS7', 'SS8', 'SS9', 'SS11', 'SS14']
const KEY_ORDER = ['id', 'title', 'object', 'kind', 'v', 'proves', 'notProves', 'enforcedAt', 'scan', 'scanNote']
const byId = (id) => SUMMARIZE_STANDARDS.find((s) => s.id === id)
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// 檔案內宣告該名稱(函數宣告、const／let／var、或 export { … }):以讀檔＋正則驗
const declares = (src, name) => [
    new RegExp(`(^|\\n)\\s*(export\\s+)?(async\\s+)?function\\s*\\*?\\s*${esc(name)}\\s*\\(`),
    new RegExp(`(^|\\n)\\s*(export\\s+)?(const|let|var)\\s+${esc(name)}\\s*=`),
    new RegExp(`export\\s*\\{[^}]*\\b${esc(name)}\\b[^}]*\\}`),
].some((r) => r.test(src))
// 特定產業領域之詞彙(中英;與本套件原始碼之中立掃描同一詞表:抓取套件之 test/tools/domainTerms 之 DOMAIN_TERM_RE,經 test/tools/captureForTest)與他工作之名
const OTHER_JOBS = /提煉|鄰居|(?<!「)關聯(?!與衝突章|」)/

describe('unit-summarize-registry', function() {

    it('全集為 SS1～SS9、SS11、SS14(依序、不重複);SS10、SS12、SS13 不存在', () => {
        assert.deepEqual(SUMMARIZE_STANDARDS.map((s) => s.id), IDS)
        assert.equal(new Set(SUMMARIZE_STANDARDS.map((s) => s.id)).size, IDS.length)
        for (const id of ['SS10', 'SS12', 'SS13']) assert.equal(byId(id), undefined, `${id} 不存在`)
    })

    it('每條標準之欄位齊全且型別正確、欄序固定;全集與各列(含執行處)皆凍結', () => {
        assert.ok(Object.isFrozen(SUMMARIZE_STANDARDS))
        for (const s of SUMMARIZE_STANDARDS) {
            assert.ok(Object.isFrozen(s) && Object.isFrozen(s.enforcedAt), `${s.id} 凍結`)
            assert.deepEqual(Object.keys(s), KEY_ORDER, `${s.id} 欄序`)
            for (const k of ['id', 'title', 'object', 'proves', 'notProves', 'scanNote']) assert.ok(typeof s[k] === 'string' && s[k].trim().length > 0, `${s.id}.${k} 須為非空字串(能證明／不能證明與不掃之理由皆須寫明)`)
            assert.ok(['program', 'ai', 'program+ai'].includes(s.kind), `${s.id}.kind=${s.kind}`)
            assert.ok(Number.isInteger(s.v) && s.v > 0, `${s.id}.v`)
            assert.equal(typeof s.scan, 'boolean', `${s.id}.scan`)
            assert.ok(Array.isArray(s.enforcedAt) && s.enforcedAt.length > 0, `${s.id} 須有執行處`)
        }
        assert.throws(() => {
            SUMMARIZE_STANDARDS[0].title = 'x'
        }, TypeError, '凍結之列不可改')
    })

    it('kind:SS5、SS14 為 AI 判定(判定小組＋題組);SS7、SS9 為程式＋AI;其餘為程式判定', () => {
        const kinds = Object.fromEntries(SUMMARIZE_STANDARDS.map((s) => [s.id, s.kind]))
        assert.deepEqual([kinds.SS5, kinds.SS14, kinds.SS7, kinds.SS9], ['ai', 'ai', 'program+ai', 'program+ai'])
        for (const id of ['SS1', 'SS2', 'SS3', 'SS4', 'SS6', 'SS8', 'SS11']) assert.equal(kinds[id], 'program', id)
    })

    it('執行處:每條皆為「套件內檔案:函數」——檔存在、檔內宣告該名、import 後為函數;路徑相對原始碼根 src/、不含 ..、不重複', async () => {
        let n = 0
        const mods = new Map()
        for (const s of SUMMARIZE_STANDARDS) {
            assert.equal(new Set(s.enforcedAt).size, s.enforcedAt.length, `${s.id} 執行處不重複`)
            for (const ref of s.enforcedAt) {
                n++
                const m = /^([A-Za-z0-9_./-]+\.mjs):([A-Za-z_$][\w$]*)$/.exec(ref)
                assert.ok(m, `${s.id} 執行處格式「檔案:函數」:${ref}`)
                const [, file, name] = m
                assert.ok(!file.split('/').includes('..') && !path.isAbsolute(file), `${ref} 須為相對原始碼根 src/ 之路徑`)
                const abs = path.join(PKG, 'src', file)
                assert.ok(fs.existsSync(abs), `${s.id} 執行處之檔不存在:${ref}`)
                assert.ok(declares(fs.readFileSync(abs, 'utf8'), name), `${s.id} 執行處之名未宣告於檔內:${ref}`)
                if (!mods.has(abs)) mods.set(abs, await import(pathToFileURL(abs).href))
                assert.equal(typeof mods.get(abs)[name], 'function', `${s.id} 執行處 import 後須為函數:${ref}`)
            }
        }
        assert.ok(n >= SUMMARIZE_STANDARDS.length, '走訪須真涵蓋各執行處')
        // 對照:宣告檢查須真能分辨有無(否則上列恆過)
        assert.equal(declares('function foo() {}', 'foo'), true)
        assert.equal(declares('export const foo = () => {}', 'foo'), true)
        assert.equal(declares('// function foo() {}', 'foo'), false, '註解中之宣告不算')
        assert.equal(declares('const x = 1', 'foo'), false)
    })

    it('執行處涵蓋各寫入入口:SS2／SS3／SS6／SS11 列新進閘、落地再驗、人工匯入、筆記同步、還原筆記、存量修正與處置、掃描;SS4 同而不列人工匯入(無原文不檢);修補後重閘列於 SS2、SS4', () => {
        const ENTRIES = {
            '新進閘': 'standards/noteGate.mjs:gateNoteItem',
            '落地再驗': 'stages/noteStage.mjs:mwGateNote',
            '判定': 'standards/noteStandards.mjs:checkNote',
            '筆記同步': 'ops/syncNotes.mjs:syncNotes',
            '還原筆記': 'ops/noteRestoreGate.mjs:createNoteRestoreGate',
            '存量修正': 'ops/noteStockFix.mjs:noteFixOf',
            '存量處置': 'standards/stockFix.mjs:applyNoteStockFix',
            '掃描': 'standards/audit.mjs:auditSummarizeStandards',
        }
        const INGEST = 'ops/ingestNotes.mjs:ingestNotes'
        const REPAIR = ['standards/noteRepair.mjs:repairProblemsOf', 'standards/noteRepair.mjs:applyRepairs']
        for (const id of ['SS2', 'SS3', 'SS4', 'SS6', 'SS11']) {
            const at = byId(id).enforcedAt
            for (const [name, ref] of Object.entries(ENTRIES)) assert.ok(at.includes(ref), `${id} 須列${name}:${ref}`)
            assert.equal(at.includes(INGEST), id !== 'SS4', `${id} 之人工匯入`)
            for (const r of REPAIR) assert.equal(at.includes(r), ['SS2', 'SS4'].includes(id), `${id} 之修補後重閘:${r}`)
        }
        assert.ok(byId('SS11').enforcedAt.includes('core/standards/evidenceRules.mjs:evidenceRuleOf'), 'SS11 之規則單一實作')
        assert.ok(byId('SS4').enforcedAt.includes('standards/noteStandards.mjs:noteMaterialOf'), 'SS4 之材料單一定義')
    })

    it('版本單一來源:SS2／SS3／SS4／SS6／SS11 之標題與版本取自 NOTE_STANDARDS;SS14 之版本取自 faithCheck 之 SS14;其餘為 1', () => {
        for (const s of SUMMARIZE_STANDARDS) {
            const d = NOTE_STANDARDS.find((x) => x.id === s.id)
            if (d) assert.deepEqual([s.title, s.v], [d.title, d.v], s.id)
            else if (s.id === 'SS14') assert.equal(s.v, SS14.v)
            else assert.equal(s.v, 1, `${s.id} 版本為 1`)
        }
        assert.deepEqual(NOTE_STANDARDS.map((s) => s.id).sort(), ['SS11', 'SS2', 'SS3', 'SS4', 'SS6'], '筆記標準皆在全集內')
    })

    it('掃描旗標與掃描器一致:scan 為 true 者即 SUMMARIZE_AUDITED_STANDARD_IDS(依全集之序)＝筆記標準;AI 標準(SS5、SS9、SS14)不掃、掃描說明載明只計待判;掃描報告之標題、kind、版本、對象取自全集', async () => {
        assert.deepEqual(SUMMARIZE_AUDITED_STANDARD_IDS, SUMMARIZE_STANDARDS.filter((s) => s.scan).map((s) => s.id))
        assert.deepEqual([...SUMMARIZE_AUDITED_STANDARD_IDS], ['SS2', 'SS3', 'SS4', 'SS6', 'SS11'])
        assert.ok(Object.isFrozen(SUMMARIZE_AUDITED_STANDARD_IDS) && Object.isFrozen(SUMMARIZE_AI_PENDING_STANDARD_IDS))
        assert.deepEqual([...SUMMARIZE_AI_PENDING_STANDARD_IDS], ['SS5', 'SS9', 'SS14'])
        for (const id of SUMMARIZE_AI_PENDING_STANDARD_IDS) {
            const s = byId(id)
            assert.equal(s.scan, false, id)
            assert.match(s.scanNote, new RegExp(`只計.{0,4}(待判|待確認).*ai\\.${id}\\b`), `${id} 之掃描說明`)
            assert.notEqual(s.kind, 'program', `${id} 為 AI 判定`)
        }
        const rep = await auditSummarizeStandards({ stores: { notes: memStore([]), holds: memStore([]), docs: memStore([]) } })
        assert.deepEqual(Object.keys(rep.standards), [...SUMMARIZE_AUDITED_STANDARD_IDS])
        for (const [id, b] of Object.entries(rep.standards)) {
            const s = byId(id)
            assert.deepEqual([b.id, b.title, b.kind, b.v, b.object, b.module], [s.id, s.title, s.kind, s.v, s.object, 'summarize'], id)
        }
        assert.deepEqual(Object.keys(rep.ai), [...SUMMARIZE_AI_PENDING_STANDARD_IDS])
        for (const [id, a] of Object.entries(rep.ai)) {
            const s = byId(id)
            assert.deepEqual([a.id, a.title, a.kind, a.v, a.object, a.module], [s.id, s.title, s.kind, s.v, s.object, 'summarize'], id)
        }
    })

    it('能證明／不能證明、標題、對象、掃描說明為中立措辭:不含特定產業領域之詞彙(中英)、不指他工作之名;規則自檢', () => {
        const bad = []
        for (const s of SUMMARIZE_STANDARDS) {
            for (const k of ['title', 'object', 'proves', 'notProves', 'scanNote']) {
                for (const [name, re] of [['領域詞彙', DOMAIN_TERM_RE], ['他工作', OTHER_JOBS]]) if (re.test(s[k])) bad.push(`${s.id}.${k}〔${name}〕${s[k].slice(0, 60)}`)
            }
        }
        assert.deepEqual(bad, [])
        // 規則自檢:詞表真能抓到(中、英)
        assert.ok(DOMAIN_TERM_RE.test('最高證據等級與明確自承無樣本外驗證不並存'))
        assert.ok(DOMAIN_TERM_RE.test('a backtest of trading rules'))
        assert.ok(OTHER_JOBS.test('提煉之銳評與爭議'))
    })

    it('SS11:能證明以 {check} 代稱規則之用詞;對象與掃描說明註明依 vocab.evidenceRule、未給規則判不適用、報告附規則指紋;SS8 明示截斷', () => {
        const s = byId('SS11')
        assert.match(s.proves, /最高證據等級與「明確自承無 \{check\}」不並存/)
        assert.match(s.object, /evidenceRule.*未給規則判不適用/)
        assert.match(s.scanNote, /vocab\.evidenceRule.*未給規則判不適用.*fp/)
        assert.match(byId('SS8').title, /截斷明示/)
        assert.match(byId('SS8').proves, /截至上限/)
    })
})
