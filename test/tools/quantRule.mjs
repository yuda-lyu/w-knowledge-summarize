// quantRule.mjs — 測試用之證據規則(詞彙表之 evidenceRule;共用層,不帶 .test. 中綴)
//
// 【為何要有】最高證據等級之要件(SS11)與提煉之推定標記一律讀詞彙表之 evidenceRule(本套件編譯;未給＝停用:要件恆不適用、推定恆不成立)。
//   驗這些規則之測試須在詞彙表給規則;本檔為其唯一一份——本套件之測試直接取本檔,關聯、提煉之測試經各自之 test/tools/summarizeForTest.mjs
//   取用(不在各測試檔手寫第二份)。
// 【值】一組具體之領域規則(最高級須有指定之驗證;嚴式＝明確自承無該驗證／僅有對照之另一種,寬式＝否定詞後 10 字內涉及該驗證)——
//   只作測試之夾具,不是本套件之預設(本套件之預設不啟用任何證據規則)。

const OOS = '樣本外'
const INS = '樣本內'

/**
 * 測試用之證據規則(vocab.evidenceRule 之 JSON 形;交 resolveSummarizeVocab／resolveExtractVocab 編譯)
 *
 * @type {Object}
 */
export const QUANT_RULE = Object.freeze({
    subject: OOS,
    check: `${OOS}驗證`,
    strict: [{ p: `(?:無|沒有|缺乏|未(?:經|做|進行|有|曾|提供|提及|說明|驗證|檢驗|測試|做過)?)(?:任何|獨立|額外)?(?:的)?${OOS}|僅(?:限)?${INS}|只有${INS}` }],
    loose: [{ p: `(?:無|未|沒有|缺乏|未提供|未提及|未說明|未明確|未經)[^；;。]{0,10}${OOS}|僅${INS}|僅限${INS}` }],
})

export default QUANT_RULE
