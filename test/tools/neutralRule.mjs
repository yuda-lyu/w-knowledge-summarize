// neutralRule.mjs — 測試用之中立證據規則(詞彙表之 evidenceRule;共用層,不帶 .test. 中綴)
//
// 【為何要有】最高證據等級之要件(SS11)一律讀詞彙表之 evidenceRule(本套件編譯;未給＝停用:要件恆不適用)。驗這些規則之測試須在詞彙表給規則;
//   本檔為本套件測試之規則夾具,本套件之測試直接取本檔。
// 【值】一組中立題材之規則(天文觀測):最高級須有指定之驗證「獨立觀測證實」——嚴式＝明確自承無獨立觀測／僅有單次觀測,寬式＝否定詞後 10 字內涉及
//   獨立觀測。只作測試之夾具,不是本套件之預設(本套件之預設不啟用任何證據規則)。

const IND = '獨立觀測'
const ONE = '單次觀測'

/**
 * 測試用之證據規則(vocab.evidenceRule 之 JSON 形;交 resolveSummarizeVocab 編譯)
 *
 * @type {Object}
 */
export const NEUTRAL_RULE = Object.freeze({
    subject: IND,
    check: `${IND}證實`,
    strict: [{ p: `(?:無|沒有|缺乏|未(?:經|做|進行|有|曾|提供|提及|說明|驗證|檢驗|測試|做過)?)(?:任何|獨立|額外)?(?:的)?${IND}|僅(?:限)?${ONE}|只有${ONE}` }],
    loose: [{ p: `(?:無|未|沒有|缺乏|未提供|未提及|未說明|未明確|未經)[^；;。]{0,10}${IND}|僅${ONE}|僅限${ONE}` }],
})

export default NEUTRAL_RULE
