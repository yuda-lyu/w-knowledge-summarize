// unit-summarize-entry.test.mjs — 入口契約:具名匯出與預設匯出為同一組成員、全部公開模組之匯出皆掛入入口(同名即同一實作)、無名稱衝突、
//   不轉出抓取套件之件、關鍵積木存在
// 規則(出自 WKnowledgeSummarize 檔頭):
//   ①公開模組各列一次,具名匯出與預設物件由同一組命名空間合成,必然同一組名稱
//   ②兩個公開模組匯出同名而不同實體時載入即拋(export * 會靜默剔除該名,以具名匯入取用時才爆)
//   ③不列入者:單一匯入點 core/capturePackage.mjs(抓取埠,轉出抓取套件之件;不是本套件之公開模組)
// 執行:自套件根 node <mocha> test/unit-summarize-entry.test.mjs
// 【以本檔位置定根,不用 cwd】本測試會 import(＝執行)根下每一支 .mjs,套件根須與 cwd 無關

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import WKnowledgeSummarize, * as NS from '../src/WKnowledgeSummarize.mjs'
import * as CapturePort from '../src/core/capturePackage.mjs'

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 不是公開模組:抓取埠(轉出抓取套件之件)
const NOT_PUBLIC = new Set(['core/capturePackage.mjs'])

// 入口中與抓取套件之件同一實體之名:摘要之詞彙表模組轉出抓取套件之知識庫稱呼函數(詞彙之 kbLabel 鍵屬兩套件共用)
const CAPTURE_NAMES_ALLOWED = ['kbLabelOf']

/**
 * 走訪原始碼根(src/)下之 .mjs(略過測試、暫存與 node_modules)
 *
 * @param {String} dir 輸入目錄
 * @param {String} [rel=''] 輸入相對路徑前綴
 * @returns {Array} 回傳相對路徑陣列(正斜線)
 */
const walk = (dir, rel = '') => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const r = rel ? `${rel}/${d.name}` : d.name
    if (d.isDirectory()) return /^(test|node_modules|_tmp)$/.test(d.name) ? [] : walk(path.join(dir, d.name), r)
    return [r]
})

const libraryFiles = () => walk(path.join(PKG, 'src')).filter((f) => f.endsWith('.mjs') && f !== 'WKnowledgeSummarize.mjs' && !NOT_PUBLIC.has(f))

describe('unit-summarize-entry', function() {

    this.timeout(60_000)

    it('具名匯出與預設匯出為同一組名稱、同一實體;預設物件不含 default 鍵', () => {
        const named = Object.keys(NS).filter((k) => k !== 'default').sort()
        const dflt = Object.keys(WKnowledgeSummarize).sort()
        assert.deepEqual(named, dflt, '兩種取用方式之成員須完全相同')
        for (const k of named) assert.equal(NS[k], WKnowledgeSummarize[k], `${k}:具名與預設須為同一實體`)
        assert.equal('default' in WKnowledgeSummarize, false)
        assert.ok(named.length > 100)
    })

    it('入口成員皆有定義(無 undefined 成員)', () => {
        for (const [k, v] of Object.entries(WKnowledgeSummarize)) assert.notEqual(v, undefined, k)
    })

    it('走訪涵蓋全部公開模組(各層目錄皆有模組、關鍵檔皆在):走訪不得空轉,否則下列匯出檢查恆過', () => {
        const files = libraryFiles()
        for (const f of ['createKnowledgeSummarize.mjs', 'summarizeObject.mjs', 'summarizeRuntime.mjs', 'logContract.mjs', 'core/summarizeSettings.mjs', 'core/vocab/summarizeVocab.mjs', 'core/standards/panelRun.mjs', 'stages/noteStage.mjs', 'standards/noteStandards.mjs', 'standards/registry.mjs', 'standards/audit.mjs', 'standards/stockFix.mjs', 'ops/ingestNotes.mjs', 'domain/noteDomain.mjs', 'stores/taxonomy.mjs', 'stores/notePatch.mjs', 'bench/summarizeBench.mjs', 'bench/cli.mjs']) {
            assert.ok(files.includes(f), `走訪缺 ${f}`)
        }
        for (const d of ['stages', 'stores', 'ops', 'standards', 'domain', 'core', 'bench']) assert.ok(files.some((f) => f.startsWith(`${d}/`)), `走訪缺目錄 ${d}/`)
        assert.ok(files.every((f) => !f.startsWith('test/') && !f.includes('node_modules')))
        assert.ok(!files.includes('core/capturePackage.mjs'), '抓取埠不列入')
    })

    it('全部公開模組之具名匯出皆掛入入口且為同一實體(新增模組 export 而未掛入口即失敗)', async () => {
        const missing = []
        for (const f of libraryFiles()) {
            const mod = await import(pathToFileURL(path.join(PKG, 'src', f)).href)
            const own =Object.keys(mod).filter((k) => k !== 'default')
            assert.ok(own.length > 0, `${f} 無任何具名匯出(公開模組須有具名積木)`)
            for (const k of own) if (WKnowledgeSummarize[k] !== mod[k]) missing.push(`${f}:${k}`)
        }
        assert.deepEqual(missing, [], '未掛入入口(或同名而不同實體)之具名匯出')
    })

    it('名稱無衝突:不同公開模組匯出同名時須為同一實體(獨立走訪重驗,不依賴載入期之檢查);入口之成員恰為各公開模組具名匯出之聯集', async () => {
        const owner = new Map()
        const conflicts = []
        for (const f of libraryFiles()) {
            const mod = await import(pathToFileURL(path.join(PKG, 'src', f)).href)
            for (const [k, v] of Object.entries(mod)) {
                if (k === 'default') continue
                const prev = owner.get(k)
                if (prev && prev.v !== v) conflicts.push(`${k}:${prev.f}／${f}`)
                if (!prev) owner.set(k, { f, v })
            }
        }
        assert.deepEqual(conflicts, [])
        assert.deepEqual([...owner.keys()].sort(), Object.keys(WKnowledgeSummarize).sort(), '入口之成員恰為各公開模組具名匯出之聯集(無遺漏、無憑空名稱)')
    })

    it('不轉出抓取套件之件:入口中與抓取埠所轉出者同一實體之名只有詞彙表模組轉出之知識庫稱呼函數;抓取埠本身不是公開模組', () => {
        const same = Object.keys(WKnowledgeSummarize).filter((k) => Object.prototype.hasOwnProperty.call(CapturePort, k) && CapturePort[k] === WKnowledgeSummarize[k])
        assert.deepEqual(same.sort(), [...CAPTURE_NAMES_ALLOWED].sort())
        // 待判登錄屬抓取套件(四工作同一機制):本入口不轉出,使用者處置(列表、逾期、重試、豁免)經抓取套件取用
        for (const k of ['createKnowledgeCapture', 'createAiAdapter', 'createRoundRunner', 'stdReport', 'saveClues', 'docTextOf', 'listHolds', 'putHold', 'HOLD_STATUSES']) assert.equal(k in WKnowledgeSummarize, false, k)
    })

    it('關鍵積木存在且型別正確:總組裝、物件、執行期件、子階段工廠、設定、詞彙、domain、檢定標準(含登記、存量掃描與處置)、維運件、AI 能力評分、日誌契約', () => {
        const FUNCS = [
            'createKnowledgeSummarize', 'createSummarizeObject', 'summarizeSummaryOf', 'createSummarizeRuntime', 'resolveSummarizeData',
            'stageTriage', 'stageSummarize', 'stageRetag', 'stageSync', 'mwSettleTriage', 'mwSaveClues', 'mwSkipGate', 'mwRenderNote', 'mwGateNote', 'mwPersistNote', 'mwMarkDoc',
            'resolveSummarizeSettings', 'summarizeCapacityOf', 'summarizeSeatsOf', 'summarizePanelsOf', 'summarizeFeatureProblems', 'summarizeSeatOf', 'notesInflowOf', 'notesInflowProblem',
            'panelGroupOf', 'panelFindingsOf', 'panelSameProviderWarnings', 'panelSeatRowsOf', 'resolveSummarizeVocab', 'assertSummarizeVocab', 'pickSummarizeVocab', 'guideDefaultOf', 'evidenceRuleOf',
            'createTriageDomain', 'createSummarizeDomain', 'createRetagDomain', 'buildNote', 'createMaterialPolicy', 'packDocsByChars', 'knownConceptOf',
            'checkNote', 'gateNoteItem', 'normalizeNoteItem', 'repairProblemsOf', 'applyRepairs', 'runFaithCheck', 'decidePanel', 'runPanelPage', 'ungroundedNumbers', 'runAiBatchStage',
            'noTopEvidenceOf', 'evidenceCaveatsOf', 'publishedOf', 'originalTitleOf', 'evidenceNoteOf', 'noteMaterialText', 'sectionItemsOf',
            'ingestNotes', 'syncNotes', 'reviveFailedDocs', 'taxonomyStatus', 'requeueCategory', 'categoryProposals', 'createNoteRestoreGate', 'noteFixOf',
            'readMd', 'writeMd', 'summaryTextOf', 'conceptVocabulary', 'suggestConceptRenames',
            'auditSummarizeStandards', 'summarizeScanOf', 'planNoteStockFix', 'applyNoteStockFix', 'verifyNoteStockChain', 'readNoteStockLedger', 'rollbackNoteStockFix', 'patchNoteRecord',
            'runSummarizeBench', 'planSummarizeBench', 'runSummarizeBenchCli', 'summarizeBenchRoleOf',
        ]
        for (const k of FUNCS) assert.equal(typeof WKnowledgeSummarize[k], 'function', k)
        const ARRAYS = ['CFG_KEYS', 'DATA_KEYS', 'PROMPT_KEYS', 'COLLECTION_KEYS', 'SUMMARIZE_STAGE_KEYS', 'SUMMARIZE_TAP_STAGE_KEYS', 'SUMMARIZE_SHARED_KEYS', 'SUMMARIZE_STORE_KEYS', 'SUMMARIZE_DATA_KEYS', 'SUMMARIZE_LOG_KNOWN', 'SUMMARIZE_LOG_MUST_SEE', 'NOTE_STANDARDS', 'SUMMARIZE_VOCAB_KEYS', 'NOTE_FIX_STDS',
            'SUMMARIZE_STANDARDS', 'SUMMARIZE_AUDITED_STANDARD_IDS', 'SUMMARIZE_AI_PENDING_STANDARD_IDS', 'NOTE_ARRAY_FIELDS', 'SUMMARIZE_BENCH_ROLES', 'SUMMARIZE_BENCH_MODELS', 'PANEL_STAGES',
            'SUMMARIZE_FEATURES']
        for (const k of ARRAYS) assert.ok(Array.isArray(WKnowledgeSummarize[k]) && WKnowledgeSummarize[k].length > 0, k)
        const OBJECTS = ['SUMMARIZE_REPORT_KEYS', 'SUMMARIZE_LOG_PARSE', 'SUMMARIZE_PROMPT_SIGS', 'SUMMARIZE_DIRS', 'SUMMARIZE_DEFAULT', 'SUMMARIZE_SCHEMA', 'SUMMARIZE_AI_DEFAULT', 'SUMMARIZE_AI_SCHEMA', 'SUMMARIZE_VOCAB_DEFAULT', 'SUMMARIZE_GUIDE_FIELDS', 'SUMMARIZE_DOC_STATUS', 'TRIAGE_STATE', 'DOC_HOLD_NEXT', 'SUMMARIZE_SEAT_LABELS',
            'PANEL_SCHEMA', 'PANEL_WHY', 'PANEL_WHY_LABELS', 'PANEL_THIRD_STOP']
        for (const k of OBJECTS) assert.equal(typeof WKnowledgeSummarize[k], 'object', k)
        // 判定小組未成立原因之字樣表:PANEL_WHY 之每一值皆有字樣(摘要、關聯、提煉同用;不另寫字面)
        assert.deepEqual(Object.keys(WKnowledgeSummarize.PANEL_WHY_LABELS).sort(), Object.values(WKnowledgeSummarize.PANEL_WHY).sort())
        assert.equal(WKnowledgeSummarize.SUMMARIZE_SCAN_OBJECT, 'notes')
    })
})
