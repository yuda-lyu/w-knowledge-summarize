// registry.mjs — 摘要檢定標準之全集(定義表;純資料,不判定)
//
// 【一條一列】{ id, title, object(對象與入口), kind, v, proves(能證明), notProves(不能證明), enforcedAt(執行處), scan, scanNote }:
//   kind:'program'＝程式判定;'ai'＝由 AI 判定小組(兩席,不一致時第三席)判定、以題組逐案評;'program+ai'＝部分由程式判(契約、清單、
//   樣式)、部分由 AI 判(以題組逐案評)。
//   enforcedAt:執行之所在,「套件內檔案:函數」(路徑相對套件根);同一標準多處執行者皆列——新進閘、修補後重閘、人工匯入、筆記同步、
//   還原筆記、存量處置、符合度掃描各入口依實際之碼列出。
//   scan:auditSummarizeStandards(standards/audit)是否以本條 id 逐件判定並計數;scanNote 寫掃描之範圍,或不掃之理由。
// 【版本單一來源】程式判定之筆記標準(SS2、SS3、SS4、SS6、SS11)之標題與版本取自 standards/noteStandards 之 NOTE_STANDARDS(判定改變即升版,
//   掃描與存量處置據以判斷是否須重掃);SS14 之版本取自 standards/faithCheck 之 SS14;其餘為 1。
// 【編號】SS10、SS12、SS13 不存在(編號不用;新標準另取新號,不補用之)。
// 【SS11 之規則屬安裝方】判定依詞彙表之 evidenceRule(core/standards/evidenceRules);未給規則判不適用。能證明欄以 {check} 代稱規則之用詞。
// 【能證明／不能證明】程式標準只證明形式、來源與結構(判定可重算);AI 標準證明的是兩個不同供應者之席位對該案得出同一類別(題組以應然
//   釘住判準),不證明客觀真偽。「不能證明」即該標準之已知盲區,由所列之他標準或使用者判讀補位。

import { NOTE_STANDARDS } from './noteStandards.mjs'
import { SS14 } from './faithCheck.mjs'

/**
 * 筆記標準之標題與版本(NOTE_STANDARDS 為唯一來源;缺者即拋——表與判定脫節時於載入當下發現)
 *
 * @param {String} id 輸入標準 id
 * @returns {Object} 回傳 { title, v }
 * @throws {Error} NOTE_STANDARDS 無此 id 時拋出
 */
function noteStd(id) {
    const s = NOTE_STANDARDS.find((x) => x.id === id)
    if (!s) throw new Error(`registry:NOTE_STANDARDS 缺 ${id}`)
    return { title: s.title, v: s.v }
}

/** 筆記標準之執行處(五個寫入入口、存量處置與掃描共用;各條另加其專屬者) */
const NOTE_ENTRIES = {
    judge: 'standards/noteStandards.mjs:checkNote',
    gate: 'standards/noteGate.mjs:gateNoteItem',
    landed: 'stages/noteStage.mjs:mwGateNote',
    ingest: 'ops/ingestNotes.mjs:ingestNotes',
    sync: 'ops/syncNotes.mjs:syncNotes',
    restore: 'ops/noteRestoreGate.mjs:createNoteRestoreGate',
    fix: 'ops/noteStockFix.mjs:noteFixOf',
    stockApply: 'standards/stockFix.mjs:applyNoteStockFix',
    scan: 'standards/audit.mjs:auditSummarizeStandards',
}
const E = NOTE_ENTRIES

/** 摘要檢定標準全集(依 id 排序) */
export const SUMMARIZE_STANDARDS = Object.freeze([
    {
        id: 'SS1',
        title: 'AI 輸出之結構與涵蓋(JSON 陣列、逐篇一項;未涵蓋者留待下輪)',
        object: 'AI 輸出;入口 預篩、摘要、重標之批次呼叫',
        kind: 'program',
        v: 1,
        proves: '輸出為合乎契約之 JSON(逐篇一項、索引在批次範圍內、必要欄位之型別);不合者不收,未涵蓋之篇記嘗試次數、留待下輪,不靜默丟失',
        notProves: '欄位內容之正確性(SS4、SS14)',
        enforcedAt: [
            'core/stages/aiBatchStage.mjs:runAiBatchStage',
            'domain/triageDomain.mjs:createTriageDomain',
            'domain/noteDomain.mjs:createSummarizeDomain',
            'domain/retagDomain.mjs:createRetagDomain',
            'stages/triageStage.mjs:stageTriage',
            'stages/noteStage.mjs:stageSummarize',
            'stages/retagStage.mjs:stageRetag',
        ],
        scan: false,
        scanNote: '未掃:輸出之結構與涵蓋於產出當下驗(不合者不收、未涵蓋者記嘗試次數),AI 之原始輸出不落庫',
    },
    {
        id: 'SS2',
        ...noteStd('SS2'),
        object: '筆記(md 之 frontmatter 與本文、筆記記錄);入口 摘要納入閘、修補後重閘、人工匯入、筆記同步、還原筆記、存量處置',
        kind: 'program',
        proves: '落地筆記之欄位齊全與型別:標題與一句話重點非空、核心知識至少一條、概念個數在範圍內且皆為字串、內容類型與證據等級在詞彙表清單內、無 [object Object]、參數表無空白列',
        notProves: '欄位內容之正確性(SS4、SS14);未給詞彙表時不驗內容類型與證據等級之清單',
        enforcedAt: [
            E.judge,
            'standards/noteNormalize.mjs:normalizeNoteItem',
            'standards/noteNormalize.mjs:noteItemProblems',
            E.gate,
            'standards/noteRepair.mjs:repairProblemsOf',
            'standards/noteRepair.mjs:applyRepairs',
            E.landed,
            E.ingest,
            E.sync,
            E.restore,
            E.fix,
            E.stockApply,
            E.scan,
        ],
        scan: true,
        scanNote: '全部筆記;與新進閘同一判定(checkNote,輸入為落地形態之 md 與記錄);md 讀不到者記未能判定',
    },
    {
        id: 'SS3',
        ...noteStd('SS3'),
        object: '筆記之內容章、標題、概念(來源章之原文標題、下游投影之章、[[連結]] 與網址不計);入口 同 SS2',
        kind: 'program',
        proves: '正體:簡體專用字、同形字誤用、誤用詞皆為 0;存量與同步之修正只改違規處',
        notProves: '錯字(錯字仍是正體字)、譯名一致性',
        enforcedAt: [
            E.judge,
            'standards/noteNormalize.mjs:normalizeNoteItem',
            E.gate,
            E.landed,
            E.ingest,
            E.sync,
            E.restore,
            E.fix,
            E.stockApply,
            E.scan,
        ],
        scan: true,
        scanNote: '全部筆記;與新進閘同一判定(checkNote);md 讀不到者記未能判定',
    },
    {
        id: 'SS4',
        ...noteStd('SS4'),
        object: '筆記之內容章與概念;入口 摘要納入閘、修補後重閘、筆記同步與還原筆記(有原文時)、存量處置(須原文);人工匯入不檢(無原文)',
        kind: 'program',
        proves: '筆記之數字皆見於原文(原文標題＋摘要當時送出之內文;依精度比對);含原文沒有之數字之清單行與參數列逐條移除,標題與一句話重點有之即不納入',
        notProves: '數字之語意與正負號是否正確(SS14);原文不可得或為今日之頁面者(未能判定);人工匯入之筆記(無原文,不檢)',
        enforcedAt: [
            E.judge,
            'standards/noteStandards.mjs:noteMaterialOf',
            E.gate,
            'standards/noteGate.mjs:dropUngrounded',
            'standards/noteRepair.mjs:repairProblemsOf',
            'standards/noteRepair.mjs:applyRepairs',
            E.landed,
            E.sync,
            E.restore,
            E.fix,
            E.stockApply,
            E.scan,
        ],
        scan: true,
        scanNote: '全部筆記;原文取抓取套件之原文取得(文件或另存),不可得或為今日之頁面者記未能判定;掃描給 material:false 時不讀原文、亦記未能判定',
    },
    {
        id: 'SS5',
        title: '屬本知識庫範疇(預篩攔下須第二席確認;摘要以全文再判相關性)',
        object: '預篩攔下之文件(raw)、摘要判非知識之文件;入口 預篩之第二席確認(預設關)、摘要之非知識判定',
        kind: 'ai',
        v: 1,
        proves: '屬本知識庫範疇(預篩攔下者經兩席確認;題組逐案評)',
        notProves: '兩可之篇(題組不收;由詞彙表之預篩與摘要判準明文補)',
        enforcedAt: [
            'stages/triageStage.mjs:stageTriage',
            'stages/triageStage.mjs:mwSettleTriage',
            'core/standards/panel.mjs:decidePanel',
            'domain/triageDomain.mjs:createTriageDomain',
            'stages/noteStage.mjs:mwSkipGate',
        ],
        scan: false,
        scanNote: '未掃:AI 判定以題組逐案評;掃描只計待確認者(預篩判定為 reject-pending 之 raw 文件;給 docs 集合時,見掃描之 ai.SS5),此標準無待判登錄與豁免',
    },
    {
        id: 'SS6',
        ...noteStd('SS6'),
        object: '筆記之概念標籤;入口 同 SS2',
        kind: 'program',
        proves: '概念標籤之形式:無計數尾碼、一標籤一概念(擠標籤須各段皆為既有概念才拆)、無跨文字系統之括號註記',
        notProves: '標籤選得對不對(由下游之候選品質間接反映)',
        enforcedAt: [
            E.judge,
            'standards/noteStandards.mjs:conceptLabelProblem',
            'standards/noteNormalize.mjs:normConcepts',
            'stores/knownConcepts.mjs:knownConceptOf',
            E.gate,
            E.landed,
            E.ingest,
            E.sync,
            E.restore,
            E.fix,
            E.stockApply,
            E.scan,
        ],
        scan: true,
        scanNote: '全部筆記;與新進閘同一判定(checkNote);md 讀不到者記未能判定',
    },
    {
        id: 'SS7',
        title: '素材問題退回抓取換法重抓(不以壞素材判非知識)',
        object: '預篩攔下與摘要判非知識之理由;入口 預篩落帳、摘要之非知識判定',
        kind: 'program+ai',
        v: 1,
        proves: '理由直指素材壞了(亂碼、未載入、截斷等;理由由 AI 給、樣式由程式判)者退回抓取以另一種方法重抓,不以壞素材判非知識;退回有次數上限,素材類之略過另記略過類別',
        notProves: '理由未直指素材之壞素材(AI 未察覺者);換法後仍壞者(達上限即依原判略過、記素材類)',
        enforcedAt: [
            'stores/materialPolicy.mjs:createMaterialPolicy',
            'stages/triageStage.mjs:mwSettleTriage',
            'stages/noteStage.mjs:mwSkipGate',
        ],
        scan: false,
        scanNote: '未掃:判定所需之理由為當時之 AI 輸出,只以略過理由留存;素材類與內容之判定以略過類別區分',
    },
    {
        id: 'SS8',
        title: '長文截斷明示(逾每批字數上限之單篇截至上限並記處理範圍,不靜默截斷)',
        object: '摘要送入 AI 之原文;入口 摘要(依字數打包)、預篩(長文另附中段)',
        kind: 'program',
        v: 1,
        proves: '依字數打包:篇數與字數皆不逾上限者全文進 AI;單篇逾上限者獨佔一批並截至上限,筆記記原文字數與處理字數、md 來源章載處理範圍、報告計截斷篇數',
        notProves: '截斷後段之內容(未讀到者不在筆記);未記處理範圍之筆記(如人工匯入)是否曾截斷',
        enforcedAt: [
            'stores/packByChars.mjs:packDocsByChars',
            'stages/noteStage.mjs:stageSummarize',
            'domain/noteDomain.mjs:createSummarizeDomain',
            'stores/noteBuild.mjs:buildNote',
            'domain/triageDomain.mjs:createTriageDomain',
        ],
        scan: false,
        scanNote: '未掃:處理範圍於產出當下記錄並明示於筆記;截斷是明示之取捨,不是違反',
    },
    {
        id: 'SS9',
        title: '分類在清單內;分類法變更觸發重標',
        object: '筆記之類別;入口 摘要(清單外落後備類別、原值存記錄)、分類法變更之重標、維運排入重判、還原筆記(改名對照、清單外落後備類別)',
        kind: 'program+ai',
        v: 1,
        proves: '分類在清單(清單外落後備類別並留原值);分類法之版本含類別定義,變更即觸發重標(改名機械改寫,新增與退役由 AI 重判;題組逐案評);退役類別重判逾次未成者入待判',
        notProves: '類別之語意邊界(安裝方定義)',
        enforcedAt: [
            'stores/noteBuild.mjs:categoryOf',
            'stores/taxonomy.mjs:syncTaxonomy',
            'stores/taxonomy.mjs:retagTargetOf',
            'stages/retagStage.mjs:stageRetag',
            'stores/noteHolds.mjs:putRetagHold',
            'stores/noteHolds.mjs:settleRetagHolds',
            'ops/taxonomyOps.mjs:requeueCategory',
            'stores/taxonomy.mjs:taxonomyFixOf',
            E.restore,
        ],
        scan: false,
        scanNote: '未掃:清單內由產出與重標保證;重標之 AI 判定以題組逐案評;掃描只計重標待判(見掃描之 ai.SS9)',
    },
    {
        id: 'SS11',
        ...noteStd('SS11'),
        object: '筆記之證據等級、限制(caveats)與證據說明(規則給 alt 時);入口 同 SS2;依詞彙表之 evidenceRule,未給規則判不適用',
        kind: 'program',
        proves: '最高證據等級與「明確自承無 {check}」不並存({check} 為詞彙表 evidenceRule 之用詞;嚴式命中為不合格、只命中寬式為未能判定;新進與存量只在嚴式命中時降一級;規則給 alt 者,證據說明或 caveats 有一句命中另一種合格證據即判合格)',
        notProves: '證據等級本身是否恰當(SS14 之證據等級誇大);未給規則時不判(不適用);alt 為逐句樣式比對,不理解語意(否定、展望句之排除由樣式負責)',
        enforcedAt: [
            'core/standards/evidenceRules.mjs:evidenceRuleOf',
            E.judge,
            'standards/noteNormalize.mjs:normalizeNoteItem',
            E.gate,
            E.landed,
            E.ingest,
            E.sync,
            E.restore,
            E.fix,
            E.stockApply,
            E.scan,
        ],
        scan: true,
        scanNote: '全部筆記;依 vocab.evidenceRule,未給規則判不適用;報告附規則指紋 fp(停用者為空字串),供判讀規則是否變更',
    },
    {
        id: 'SS14',
        title: '筆記忠實於原文(寫入前由判定小組覆核)',
        object: '新進之筆記(寫入前);入口 摘要之忠實性覆核(預設關)',
        kind: 'ai',
        v: SS14.v,
        proves: '筆記忠實於原文:無無據之結論、否定與方向未翻錯、條件未遺失、證據等級未誇大(兩席;題組逐案評)',
        notProves: '原文本身之對錯(下游之評析);未開覆核時寫入之筆記與存量筆記(存量不覆核)',
        enforcedAt: [
            'standards/faithCheck.mjs:runFaithCheck',
            'standards/faithCheck.mjs:checkFaithVerdictOf',
            'core/standards/panelRun.mjs:runPanelPage',
            'core/standards/panel.mjs:decidePanel',
            'domain/noteDomain.mjs:createSummarizeDomain',
            'stages/noteStage.mjs:stageSummarize',
        ],
        scan: false,
        scanNote: '未掃:AI 判定(須原文),以題組逐案評,存量不覆核;掃描只計待判(見掃描之 ai.SS14),不計檢核紀錄(本套件不寫檢核紀錄)',
    },
].map((s) => Object.freeze({
    // 欄序固定(報表與比對之輸出可重現)
    id: s.id, title: s.title, object: s.object, kind: s.kind, v: s.v, proves: s.proves, notProves: s.notProves,
    enforcedAt: Object.freeze([...s.enforcedAt]), scan: s.scan, scanNote: s.scanNote,
})))

export default { SUMMARIZE_STANDARDS }
