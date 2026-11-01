// WKnowledgeSummarize.mjs — 主入口:通用知識摘要套件
//
// 安裝即用(僅 workDir 必填);設定、詞彙、提示詞皆有通用預設,安裝方逐鍵覆寫即可收斂到自己的主題。
// 全部積木具名匯出,並預設匯出同一物件——安裝方依自己的管線自由組裝,不需改套件。
//
// 【匯出單一來源:模組清單】各公開模組於下方各列一次「命名空間匯入＋export *」;預設匯出物件由同一組命名空間合成,
//   具名匯出與預設物件必然同一組名稱(不另手寫名稱清單——三處各寫一份必然漂移)。
// 【名稱衝突即拋】兩模組匯出同名而不同實體時,export * 會靜默剔除該名(以具名匯入取用時才爆),故載入時即檢查並拋錯(合成之規則取抓取套件之
//   composeNamespaces,四套件同一份)。
// 【不轉出抓取套件之件】core/capturePackage.mjs 為取用抓取套件之單一匯入點(抓取埠),不是本套件之公開模組;抓取之件請自抓取套件取用。

import { composeNamespaces } from './core/capturePackage.mjs'
import * as createKnowledgeSummarizeNs from './createKnowledgeSummarize.mjs'
import * as summarizeObjectNs from './summarizeObject.mjs'
// ── 摘要執行期件之組裝(總組裝共用)與日誌／報告契約 ──
import * as summarizeRuntimeNs from './summarizeRuntime.mjs'
import * as logContractNs from './logContract.mjs'
// ── 設定預設、詞彙與核心件(本套件自有;抓取套件無之模組)──
import * as summarizeSettingsNs from './core/summarizeSettings.mjs'
import * as summarizeVocabNs from './core/vocab/summarizeVocab.mjs'
import * as conceptGroupsNs from './core/vocab/conceptGroups.mjs'
import * as evidenceRulesNs from './core/standards/evidenceRules.mjs'
import * as numbersNs from './core/standards/numbers.mjs'
import * as panelNs from './core/standards/panel.mjs'
import * as panelConfigNs from './core/standards/panelConfig.mjs'
import * as panelRunNs from './core/standards/panelRun.mjs'
import * as aiBatchStageNs from './core/stages/aiBatchStage.mjs'
import * as mdNs from './core/md/md.mjs'
import * as noteContentNs from './core/md/noteContent.mjs'
// ── 子階段工廠與 mw 積木 ──
import * as triageStageNs from './stages/triageStage.mjs'
import * as noteStageNs from './stages/noteStage.mjs'
import * as retagStageNs from './stages/retagStage.mjs'
import * as syncStageNs from './stages/syncStage.mjs'
// ── 預篩／摘要／重標之提示詞與輸出契約 ──
import * as triageDomainNs from './domain/triageDomain.mjs'
import * as noteDomainNs from './domain/noteDomain.mjs'
import * as digestDomainNs from './domain/digestDomain.mjs'
import * as retagDomainNs from './domain/retagDomain.mjs'
// ── 筆記組裝、內容同步、分類法、待判、素材問題與文件欄位值 ──
import * as noteBuildNs from './stores/noteBuild.mjs'
import * as noteSyncNs from './stores/noteSync.mjs'
import * as knownConceptsNs from './stores/knownConcepts.mjs'
import * as packByCharsNs from './stores/packByChars.mjs'
import * as noteHoldsNs from './stores/noteHolds.mjs'
import * as taxonomyNs from './stores/taxonomy.mjs'
import * as materialPolicyNs from './stores/materialPolicy.mjs'
import * as docStatusNs from './stores/docStatus.mjs'
import * as notePatchNs from './stores/notePatch.mjs'
// ── 檢定標準(筆記標準、納入閘、正規化、修補、忠實性覆核)──
import * as noteStandardsNs from './standards/noteStandards.mjs'
import * as noteNormalizeNs from './standards/noteNormalize.mjs'
import * as noteGateNs from './standards/noteGate.mjs'
import * as noteRepairNs from './standards/noteRepair.mjs'
import * as faithCheckNs from './standards/faithCheck.mjs'
// ── 檢定標準之登記、存量掃描與存量處置 ──
import * as registryNs from './standards/registry.mjs'
import * as auditNs from './standards/audit.mjs'
import * as stockFixNs from './standards/stockFix.mjs'
// ── 維運(分類法、內容同步、還原閘、存量修正、重開、人工匯入)──
import * as taxonomyOpsNs from './ops/taxonomyOps.mjs'
import * as syncNotesNs from './ops/syncNotes.mjs'
import * as noteRestoreGateNs from './ops/noteRestoreGate.mjs'
import * as noteStockFixNs from './ops/noteStockFix.mjs'
import * as reviveFailedNs from './ops/reviveFailed.mjs'
import * as ingestNotesNs from './ops/ingestNotes.mjs'
// ── AI 能力評分(五角色;核心為抓取套件之 benchKit;命令列 bench/cli.mjs 被 import 時不執行,只轉出同一實體)──
import * as summarizeBenchNs from './bench/summarizeBench.mjs'
import * as benchCliNs from './bench/cli.mjs'

export * from './createKnowledgeSummarize.mjs'
export * from './summarizeObject.mjs'
export * from './summarizeRuntime.mjs'
export * from './logContract.mjs'
export * from './core/summarizeSettings.mjs'
export * from './core/vocab/summarizeVocab.mjs'
export * from './core/vocab/conceptGroups.mjs'
export * from './core/standards/evidenceRules.mjs'
export * from './core/standards/numbers.mjs'
export * from './core/standards/panel.mjs'
export * from './core/standards/panelConfig.mjs'
export * from './core/standards/panelRun.mjs'
export * from './core/stages/aiBatchStage.mjs'
export * from './core/md/md.mjs'
export * from './core/md/noteContent.mjs'
export * from './stages/triageStage.mjs'
export * from './stages/noteStage.mjs'
export * from './stages/retagStage.mjs'
export * from './stages/syncStage.mjs'
export * from './domain/triageDomain.mjs'
export * from './domain/noteDomain.mjs'
export * from './domain/digestDomain.mjs'
export * from './domain/retagDomain.mjs'
export * from './stores/noteBuild.mjs'
export * from './stores/noteSync.mjs'
export * from './stores/knownConcepts.mjs'
export * from './stores/packByChars.mjs'
export * from './stores/noteHolds.mjs'
export * from './stores/taxonomy.mjs'
export * from './stores/materialPolicy.mjs'
export * from './stores/docStatus.mjs'
export * from './stores/notePatch.mjs'
export * from './standards/noteStandards.mjs'
export * from './standards/noteNormalize.mjs'
export * from './standards/noteGate.mjs'
export * from './standards/noteRepair.mjs'
export * from './standards/faithCheck.mjs'
export * from './standards/registry.mjs'
export * from './standards/audit.mjs'
export * from './standards/stockFix.mjs'
export * from './ops/taxonomyOps.mjs'
export * from './ops/syncNotes.mjs'
export * from './ops/noteRestoreGate.mjs'
export * from './ops/noteStockFix.mjs'
export * from './ops/reviveFailed.mjs'
export * from './ops/ingestNotes.mjs'
export * from './bench/summarizeBench.mjs'
export * from './bench/cli.mjs'

/**
 * 公開模組之命名空間(預設匯出物件之來源;與上方 export * 為同一組模組)
 *
 * @type {Array}
 */
const NAMESPACES = [
    createKnowledgeSummarizeNs, summarizeObjectNs, summarizeRuntimeNs, logContractNs,
    summarizeSettingsNs, summarizeVocabNs, conceptGroupsNs, evidenceRulesNs, numbersNs, panelNs, panelConfigNs, panelRunNs, aiBatchStageNs, mdNs, noteContentNs,
    triageStageNs, noteStageNs, retagStageNs, syncStageNs,
    triageDomainNs, noteDomainNs, digestDomainNs, retagDomainNs,
    noteBuildNs, noteSyncNs, knownConceptsNs, packByCharsNs, noteHoldsNs, taxonomyNs, materialPolicyNs, docStatusNs, notePatchNs,
    noteStandardsNs, noteNormalizeNs, noteGateNs, noteRepairNs, faithCheckNs,
    registryNs, auditNs, stockFixNs,
    taxonomyOpsNs, syncNotesNs, noteRestoreGateNs, noteStockFixNs, reviveFailedNs, ingestNotesNs,
    summarizeBenchNs, benchCliNs,
]

/**
 * 通用知識摘要套件
 *
 * 提供一輪摘要之完整管線(預篩 → 摘要 → 重標 → 同步):
 * ① 安裝即用:createKnowledgeSummarize({ workDir }) 零注入即可跑,讀抓取套件交出之 raw 文件,預設席位為免金鑰之免費模型
 * ② 逐層可覆寫:cfg 設定逐鍵覆寫、cfg.data.vocab 詞彙與提示詞之領域句、cfg.prompts 提示詞、cfg.domains 整組 domain、
 *    cfg.stages／stageOpts 子階段與動作鏈 tap、cfg.aiAdapter 調度層
 * ③ 領域中立:主題範圍、知識庫稱呼、分類法、標注清單、最高證據等級之要件皆由安裝方決定
 * ④ 檢定標準:筆記之納入閘與各標準之純函數判定、標準之登記(SUMMARIZE_STANDARDS)、存量掃描(auditSummarizeStandards)與存量處置
 *    (planNoteStockFix 等)、待判登錄與維運處置,供測試與維運檢查功能是否正常
 * ⑤ 免費 AI 能力評分:五角色(預篩、摘要、修補、忠實性、重標)以正式提示詞量模型(runSummarizeBench、runSummarizeBenchCli)
 *
 * @returns {Object} 回傳套件物件,含 createKnowledgeSummarize、createSummarizeObject、createSummarizeRuntime、子階段工廠(stage*)、
 *     mw 積木(mw*)、設定預設(resolveSummarizeSettings、SUMMARIZE_*)、詞彙(resolveSummarizeVocab 等)、domain 工廠、檢定標準、
 *     存量掃描與處置、維運件、AI 能力評分與日誌契約等(與具名匯出同一組)
 * @throws {Error} 兩個公開模組匯出同名而不同實體時於載入期拋出
 * @example
 * import WKnowledgeSummarize from 'w-knowledge-summarize/src/WKnowledgeSummarize.mjs'
 *
 * //零注入:僅 workDir 必填(金鑰放 workDir/.env;預設 AI 席位為免金鑰之免費模型)
 * let flow = WKnowledgeSummarize.createKnowledgeSummarize({
 *     workDir: './my-kb', //docs 集合中 status 為 raw 之文件(抓取套件交出)即本套件之輸入
 *     data: { vocab: { domain: '天文學' } }, //主題範圍(選填), 未給即不限主題
 * })
 * let report = await flow.run() //摘要一輪, 筆記寫入 my-kb/knowledge/notes, 結束後寫 log/<day>/<stamp>-run.json
 * console.log(report.ok)
 */
const WKnowledgeSummarize = composeNamespaces('WKnowledgeSummarize', NAMESPACES)


export default WKnowledgeSummarize
