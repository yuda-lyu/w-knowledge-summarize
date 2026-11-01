// promptFixtures.mjs — 摘要套件各類提示詞之固定輸入與一次產出(預設提示詞標準檔之產製、測試比對與他版實作之逐字差分共用)
// 不帶 .test. 中綴:共用層,避免被 runner 當測試檔抓取。
//
// 只經公開工廠(createTriageDomain／createSummarizeDomain／createRetagDomain)與標準層之公開函數(faithNoteText、normalizeNoteItem、
// repairProblemsOf)產出,工廠可換成他版實作(renderSummarizePromptsWith),故同一份輸入可用於「凍結標準檔」與「逐字比對」。
// 輸入皆為中立假資料,網址僅用保留網域 example.com。預篩、摘要之基本輸入(triage、triageReason、summarize、summarizeNoVocab)與原實作之
// 提示詞標準檔之產製輸入相同,故兩版之同名項目可逐字比對。

import { createTriageDomain } from '../../src/domain/triageDomain.mjs'
import { createSummarizeDomain } from '../../src/domain/noteDomain.mjs'
import { createRetagDomain } from '../../src/domain/retagDomain.mjs'
import { faithNoteText } from '../../src/standards/faithCheck.mjs'
import { normalizeNoteItem } from '../../src/standards/noteNormalize.mjs'
import { repairProblemsOf } from '../../src/standards/noteRepair.mjs'

/** 標準檔之兩組詞彙(無詞彙＝全用內建;domain＝只給主題範圍) */
export const PROMPT_VARIANTS = Object.freeze({ noDomain: null, domain: Object.freeze({ domain: '機器學習' }) })

const TRIAGE_DOCS = [
    { title: '標題甲', sourceName: '來源甲', text: '開頭片段甲' },
    { title: '標題乙', sourceName: '來源乙', feedText: '開頭片段乙' },
]
const TRIAGE_LONG_DOCS = [
    { title: '標題丙', sourceName: '來源丙', text: `開頭丙${'甲'.repeat(3500)}中段丙${'乙'.repeat(3500)}` },
]
const SUMMARIZE_DOCS = [
    { title: '標題甲', sourceName: '來源甲', url: 'https://example.com/a', text: '內文甲' },
]
const SUMMARIZE_BUDGET_DOCS = [
    { title: '標題丙', sourceName: '來源丙', url: 'https://example.com/c', text: '內文丙'.repeat(40) },
    { title: '標題丁', sourceName: '來源丁', url: 'https://example.com/d', text: '內文丁'.repeat(5) },
]
const CONCEPT_VOCAB = ['概念甲', '概念乙']
const FAITH_NOTES = [
    { title: '筆記甲', summary: '重點甲', key_points: ['知識甲'], parameters: [{ name: '參數甲', value: '3', note: '說明甲' }], claim_type: '實證研究', evidence_level: '中', evidence_note: '單一研究', caveats: ['樣本小'] },
    { title: '筆記乙', summary: '重點乙', key_points: ['知識乙'], conditions: ['條件乙'] },
]
const REPAIR_ITEM = {
    index: 1, relevant: true, title: '方法甲之評估 9.9%', summary: '方法甲提升準確率 4.5%', key_points: ['準確率提升 4.5%', '延遲降低 30%'],
    concepts: ['方法甲', '評估'], claim_type: '實證研究', evidence_level: '中', parameters: [{ name: '批次', value: '64', note: '' }],
}
const REPAIR_MATERIAL = '方法甲研究\nMethod A improves accuracy by 4.5% on the benchmark.'
const RETAG_ITEMS = [
    { title: '筆記甲', category: '其他', summary: '重點甲', points: ['知識甲', '知識乙', '知識丙', '知識丁'] },
    { title: '筆記乙', category: '方法與技術', summary: '重點乙', points: [] },
]

/**
 * 以指定之工廠與詞彙表產出各類提示詞(及預篩預設理由);工廠可換成他版實作以逐字比對
 *
 * @param {Object} f 輸入工廠物件 { createTriageDomain, createSummarizeDomain, createRetagDomain, faithNoteText, normalizeNoteItem, repairProblemsOf }
 * @param {Object} [vocab=null] 輸入詞彙表覆寫物件(交給各 domain 工廠之 opt.vocab)
 * @returns {Object} 回傳 { triage, triageLong, triageReason, summarize, summarizeNoVocab, summarizeBudgets, summarizeFeedback, faith, repair,
 *   retag, retagAdd, retagRetire, retagRequeue }
 */
export function renderSummarizePromptsWith(f, vocab = null) {
    const triage = f.createTriageDomain({ vocab })
    const summarize = f.createSummarizeDomain({ vocab })
    const retag = f.createRetagDomain({ vocab })
    const item = f.normalizeNoteItem(REPAIR_ITEM, { vocab: summarize.vocab }).item
    const problems = f.repairProblemsOf(item, { vocab: summarize.vocab, material: REPAIR_MATERIAL })
    const cat = retag.vocab.categories[0]
    return {
        triage: triage.buildPrompt(TRIAGE_DOCS),
        triageLong: triage.buildPrompt(TRIAGE_LONG_DOCS),
        triageReason: triage.reasonOf({}),
        summarize: summarize.buildPrompt(SUMMARIZE_DOCS, CONCEPT_VOCAB),
        summarizeNoVocab: summarize.buildPrompt(SUMMARIZE_DOCS, []),
        summarizeBudgets: summarize.buildPrompt(SUMMARIZE_BUDGET_DOCS, [], { budgets: [30, 0] }),
        summarizeFeedback: summarize.buildPrompt([{ ...SUMMARIZE_DOCS[0], stdFeedback: '標題含原文沒有之數字（9.9%）' }], CONCEPT_VOCAB),
        faith: summarize.buildFaithCheckPrompt({ items: FAITH_NOTES.map((n, i) => ({ index: i + 1, title: n.title, material: `${n.title}\n原文${i + 1}`, noteText: f.faithNoteText(n) })) }),
        repair: summarize.buildRepairPrompt({ material: REPAIR_MATERIAL, item, problems }),
        retag: retag.buildPrompt(RETAG_ITEMS),
        retagAdd: retag.buildPrompt(RETAG_ITEMS, { focus: { reason: 'add', category: cat } }),
        retagRetire: retag.buildPrompt(RETAG_ITEMS, { focus: { reason: 'retire', category: '已退役類別' } }),
        retagRequeue: retag.buildPrompt(RETAG_ITEMS, { focus: { reason: 'requeue', category: cat } }),
    }
}

/**
 * 以本套件之工廠產出各類提示詞
 *
 * @param {Object} [vocab=null] 輸入詞彙表覆寫物件
 * @returns {Object} 回傳同 renderSummarizePromptsWith
 */
export function renderSummarizePrompts(vocab = null) {
    return renderSummarizePromptsWith({ createTriageDomain, createSummarizeDomain, createRetagDomain, faithNoteText, normalizeNoteItem, repairProblemsOf }, vocab)
}

/**
 * 兩組詞彙(PROMPT_VARIANTS)之全部提示詞(標準檔之內容形狀)
 *
 * @returns {Object} 回傳 { noDomain:{...}, domain:{...} }
 */
export function renderPromptGolden() {
    return Object.fromEntries(Object.entries(PROMPT_VARIANTS).map(([k, v]) => [k, renderSummarizePrompts(v)]))
}

export default renderSummarizePrompts
