// unit-evidence.test.mjs — 證據等級與限制相符(SS11)之單一實作(core/standards/evidenceRules):預設停用、規則驗證與編譯、三態判定、降級、
//   回饋與訊息模板、比對前正規化、可重複套用與指紋
// 規則(出自 evidenceRules 之設計):
//   ①未給規則(null／undefined)＝停用:判定恆為不適用、不降級、回饋不附更正方向、states／admits 恆假、指紋為空字串、JSON 化為 null
//   ②給了規則須前四鍵齊備 { subject, check, strict, loose }(loose 可為 [];alt 選用);非物件、不認得之鍵、用詞非非空字串、strict 空或非陣列、
//     樣式形狀或語法錯、帶 g／y 旗標、命中空字串一律拋錯,訊息含設定路徑
//   ③判定:非最高級(或無等級)→ 不適用;嚴式命中 → 不合格(detail 列第一個嚴式命中者,即使寬式命中者在前);只命中寬式 → 未能判定;皆無 → 合格
//   ④降級:等級兩級以上、為最高級且嚴式命中才降至次高級;只命中寬式、非最高級、只有一級者不降
//   ⑤比對前文字先 NFKC 再轉正體(全形、簡體亦命中)
//   ⑥訊息模板:以中立題材之覆寫值(獨立觀測),判定之 detail、回饋、新進修正說明、存量變更說明之全文逐字固定
//   ⑦可重複套用:同一規則(物件或其正規形)得同一已編譯物件;JSON 往返後重編譯之指紋相同;寫法不同而內容相同者指紋相同
//   ⑧另一種合格證據(alt;選用):證據說明或 caveats 逐句肯定陳述者 → 合格、不降級;否定句不算;未給 alt 者正規形與指紋不變
//   ⑨自承無最高證據等級之要件(noTopEvidenceOf;下游以同一判準判讀):caveats 有一則命中嚴式或寬式、且證據說明與 caveats 皆無另一種合格證據
//     → true;規則未給或停用、caveats 空或非陣列 → false;與「最高級之判定為不合格或未能判定」恆同義
// 規則之覆寫值為中立題材(test/tools/neutralRule);套件之領域中立掃描只掃非測試之原始碼、README 與題組。
// 執行:自套件根 node <mocha> test/unit-evidence.test.mjs(純函數,不連網、不寫檔)

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
    EVIDENCE_STD, EVIDENCE_RULE_KEYS, EVIDENCE_RULE_DEFAULT, evidenceCaveatsOf, evidenceMessagesOf, isEvidenceRule, evidenceRuleOf, noTopEvidenceOf,
} from '../src/core/standards/evidenceRules.mjs'
import { STATUS } from '../src/core/capturePackage.mjs'
import { msgOf } from './tools/captureForTest.mjs'
import { NEUTRAL_RULE } from './tools/neutralRule.mjs'

const LEVELS = ['高', '中', '低']

// ── 中立之自訂規則(同儕審查;展示任意領域之用法)──
const PEER = {
    subject: '同儕審查',
    check: '同儕審查',
    strict: [{ p: '(?:未經|沒有|無)同儕審查' }],
    loose: [{ p: '(?:未|無)[^；;。]{0,10}同儕審查' }],
}
const PEER_STRICT = '未經同儕審查'
const PEER_LOOSE = '未說明是否經同儕審查'
const PEER_NONE = '樣本小'

// ── 中立題材之覆寫值(OOS、INS 為規則之兩個四字詞,CHECK 為其 check;規則 NEUTRAL_RULE 本身取 test/tools/neutralRule)──
const OOS = NEUTRAL_RULE.subject // 獨立觀測
const INS = '單次觀測'
const CHECK = NEUTRAL_RULE.check // 獨立觀測證實

describe('unit-evidence', function() {

    describe('① 預設停用', function() {

        it('預設規則為 null;evidenceRuleOf(null／undefined) 回同一停用物件(標記可辨認、凍結、JSON 化為 null、指紋空字串)', () => {
            assert.equal(EVIDENCE_RULE_DEFAULT, null)
            const off = evidenceRuleOf(null)
            assert.equal(evidenceRuleOf(undefined), off)
            assert.equal(evidenceRuleOf(), off)
            assert.equal(evidenceRuleOf(off), off, '停用物件本身原樣回傳')
            assert.ok(isEvidenceRule(off))
            assert.ok(Object.isFrozen(off))
            assert.deepEqual([off.enabled, off.std, off.subject, off.check, off.config, off.fp], [false, EVIDENCE_STD, '', '', null, ''])
            assert.equal(JSON.stringify(off), 'null')
            assert.equal(JSON.stringify({ evidenceRule: off }), '{"evidenceRule":null}')
        })

        it('停用:判定恆為不適用(最高級＋任何 caveats 皆然)、不降級、回饋不附更正方向、states／admits 恆假、訊息函數回空字串', () => {
            const off = evidenceRuleOf(null)
            for (const caveats of [[PEER_STRICT], [PEER_LOOSE], [`無${OOS}驗證`], []]) {
                assert.deepEqual(off.judge({ level: '高', levels: LEVELS, caveats }), { std: 'SS11', status: 'na', detail: '', field: '' })
                assert.equal(off.downgrade({ level: '高', levels: LEVELS, caveats }), null)
            }
            assert.deepEqual([off.states(PEER_STRICT), off.admits(PEER_LOOSE)], [false, false])
            assert.equal(off.feedbackHintOf({ std: 'SS11', status: 'undetermined', detail: 'x' }), '', '即使收到未能判定之判定結果亦不附')
            assert.deepEqual(Object.values(off.messages).map((f) => f('高', 'x')), ['', '', '', '', ''])
            assert.deepEqual(off.caveatsOf({ caveats: ['a'] }, {}), ['a'], 'caveats 之取法與啟用者同一函數')
        })
    })

    describe('② 規則之驗證(四鍵齊備,錯誤一律拋並附設定路徑)', function() {

        it('非物件(含陣列、布林、字串)→ 拋;訊息列四鍵與選用之 alt、「null 不啟用」', () => {
            const m = 'vocab.evidenceRule 須為物件 { subject, check, strict, loose, alt? } 或 null（不啟用）'
            for (const bad of ['x', [], true, 0]) assert.equal(msgOf(() => evidenceRuleOf(bad)), m, JSON.stringify(bad))
            assert.deepEqual(EVIDENCE_RULE_KEYS, ['subject', 'check', 'strict', 'loose', 'alt'])
        })

        it('不認得之鍵 → 拋並列可用鍵', () => {
            assert.equal(msgOf(() => evidenceRuleOf({ ...PEER, sujbect: 'x' })), 'vocab.evidenceRule 含不認得之鍵：sujbect（可用：subject、check、strict、loose、alt）')
        })

        it('subject／check 缺、空白或非字串 → 拋', () => {
            for (const k of ['subject', 'check']) {
                for (const bad of [undefined, null, '', '  ', 1, ['x']]) {
                    assert.equal(msgOf(() => evidenceRuleOf({ ...PEER, [k]: bad })), `vocab.evidenceRule.${k} 須為非空字串`, `${k}=${JSON.stringify(bad)}`)
                }
            }
        })

        it('strict 缺或非陣列、為空 → 拋(嚴式為空即永不判不合格);loose 缺或非陣列 → 拋,為 [] 合法(無未能判定)', () => {
            const arr = (k) => `vocab.evidenceRule.${k} 須為樣式陣列（RegExp 或 { p: 樣式字串, f?: 旗標 }）`
            for (const bad of [undefined, null, 'x', { p: 'x' }]) {
                assert.equal(msgOf(() => evidenceRuleOf({ ...PEER, strict: bad })), arr('strict'), `strict=${JSON.stringify(bad)}`)
                assert.equal(msgOf(() => evidenceRuleOf({ ...PEER, loose: bad })), arr('loose'), `loose=${JSON.stringify(bad)}`)
            }
            assert.equal(msgOf(() => evidenceRuleOf({ ...PEER, strict: [] })), 'vocab.evidenceRule.strict 至少須有一個樣式（嚴式為空即永不判不合格、永不降級；不啟用規則請不給 evidenceRule）')
            const r = evidenceRuleOf({ ...PEER, loose: [] })
            assert.equal(r.judge({ level: '高', levels: LEVELS, caveats: [PEER_LOOSE] }).status, 'pass', 'loose [] → 只命中寬式之句不再是未能判定')
            assert.equal(r.judge({ level: '高', levels: LEVELS, caveats: [PEER_STRICT] }).status, 'violation')
        })

        it('樣式形狀或語法錯 → 拋(交抓取套件之 toPatterns 驗;訊息含索引)', () => {
            assert.equal(msgOf(() => evidenceRuleOf({ ...PEER, strict: [1] })), 'vocab.evidenceRule.strict[0] 須為 RegExp 或 { p: 樣式字串, f?: 旗標 }，收到：1')
            assert.equal(msgOf(() => evidenceRuleOf({ ...PEER, strict: [/a/, { p: '' }] })), 'vocab.evidenceRule.strict[1] 須為 RegExp 或 { p: 樣式字串, f?: 旗標 }，收到：{"p":""}')
            assert.equal(msgOf(() => evidenceRuleOf({ ...PEER, loose: [{ p: 'x', f: 1 }] })), 'vocab.evidenceRule.loose[0] 須為 RegExp 或 { p: 樣式字串, f?: 旗標 }，收到：{"p":"x","f":1}')
            assert.match(msgOf(() => evidenceRuleOf({ ...PEER, strict: [{ p: '(' }] })), /^vocab\.evidenceRule\.strict\[0\] 樣式不合法：/)
            assert.match(msgOf(() => evidenceRuleOf({ ...PEER, loose: [{ p: 'x', f: 'q' }] })), /^vocab\.evidenceRule\.loose\[0\] 樣式不合法：/)
        })

        it('帶狀態之旗標(g、y)與命中空字串之樣式 → 拋', () => {
            assert.equal(msgOf(() => evidenceRuleOf({ ...PEER, strict: [{ p: '同儕', f: 'g' }] })), 'vocab.evidenceRule.strict[0] 之旗標不可含 g 或 y（帶狀態之比對會使同一句之結果隨呼叫次數改變）')
            assert.equal(msgOf(() => evidenceRuleOf({ ...PEER, loose: [/同儕/y] })), 'vocab.evidenceRule.loose[0] 之旗標不可含 g 或 y（帶狀態之比對會使同一句之結果隨呼叫次數改變）')
            assert.equal(msgOf(() => evidenceRuleOf({ ...PEER, strict: [{ p: '未經', f: 'i' }, { p: 'a*' }] })), 'vocab.evidenceRule.strict[1] 會命中空字串（任何文字皆命中）')
            assert.equal(msgOf(() => evidenceRuleOf({ ...PEER, loose: [/(?:)/] })), 'vocab.evidenceRule.loose[0] 會命中空字串（任何文字皆命中）')
        })

        it('設定名可自訂(錯誤訊息之路徑前綴)', () => {
            assert.equal(msgOf(() => evidenceRuleOf({ ...PEER, check: '' }, 'cfg.rule')), 'cfg.rule.check 須為非空字串')
        })
    })

    describe('③ 三態判定(judge)', function() {
        const rule = evidenceRuleOf(PEER)
        const judge = (caveats, level = '高', levels = LEVELS) => rule.judge({ level, levels, caveats })

        it('最高級:嚴式命中 → 不合格、只命中寬式 → 未能判定、皆無 → 合格(判定結果之形狀同檢定標準之判定)', () => {
            assert.deepEqual(judge([PEER_STRICT]), { std: 'SS11', status: 'violation', detail: `證據等級「高」卻自承：${PEER_STRICT}`, field: '' })
            assert.deepEqual(judge([PEER_LOOSE]), { std: 'SS11', status: 'undetermined', detail: `caveat 涉及同儕審查而未明確自承(須判讀)：${PEER_LOOSE}`, field: '' })
            assert.deepEqual(judge([PEER_NONE]), { std: 'SS11', status: 'pass', detail: '', field: '' })
            assert.deepEqual(judge([]), { std: 'SS11', status: 'pass', detail: '', field: '' })
        })

        it('非最高級、等級清單缺或空、等級第一項為空 → 不適用', () => {
            for (const [level, levels] of [['中', LEVELS], ['低', LEVELS], ['高', undefined], ['高', []], ['高', 'x'], ['', ['', '中']]]) {
                assert.equal(rule.judge({ level, levels, caveats: [PEER_STRICT] }).status, 'na', `${level}／${JSON.stringify(levels)}`)
            }
            assert.equal(rule.judge().status, 'na', '未給參數')
            assert.equal(judge([PEER_STRICT], '高', ['高']).status, 'violation', '只有一級亦判(判定只需最高級)')
        })

        it('多則 caveats:嚴式優先(即使寬式命中者在前),detail 列第一個嚴式命中者;只有寬式時列第一個寬式命中者;非字串元素不誤判', () => {
            assert.equal(judge([PEER_NONE, PEER_LOOSE, '沒有同儕審查', PEER_STRICT]).detail, '證據等級「高」卻自承：沒有同儕審查')
            assert.equal(judge(['未提及同儕審查', PEER_LOOSE]).detail, 'caveat 涉及同儕審查而未明確自承(須判讀)：未提及同儕審查')
            assert.equal(judge([null, 123, { a: 1 }, PEER_NONE]).status, 'pass')
            assert.equal(judge('未經同儕審查').status, 'pass', 'caveats 非陣列視為無')
        })

        it('caveat 原文於說明中取前 60 字', () => {
            const long = `${PEER_STRICT}${'一'.repeat(80)}`
            assert.equal(judge([long]).detail, `證據等級「高」卻自承：${long.slice(0, 60)}`)
        })

        it('caveats 之來源:front 優先,其次記錄;皆非陣列為 [](evidenceCaveatsOf 與規則之 caveatsOf 同一函數)', () => {
            assert.equal(rule.caveatsOf, evidenceCaveatsOf)
            const a = ['甲']
            assert.equal(evidenceCaveatsOf({ caveats: a }, { caveats: ['乙'] }), a)
            assert.deepEqual(evidenceCaveatsOf({ caveats: 'x' }, { caveats: ['乙'] }), ['乙'])
            assert.deepEqual(evidenceCaveatsOf(undefined, undefined), [])
            assert.equal(rule.judge({ level: '高', levels: LEVELS, caveats: rule.caveatsOf({}, { caveats: [PEER_STRICT] }) }).status, 'violation')
        })
    })

    describe('④ 降級(downgrade)', function() {
        const rule = evidenceRuleOf(PEER)

        it('最高級＋嚴式命中 → 降至次高級;回傳第一個嚴式命中者與兩種說明(新進修正說明 fix、存量變更說明 change)', () => {
            assert.deepEqual(rule.downgrade({ level: '高', levels: LEVELS, caveats: [PEER_NONE, PEER_LOOSE, PEER_STRICT, '無同儕審查'] }), {
                from: '高', to: '中', caveat: PEER_STRICT,
                fix: '證據等級「高」與 caveat 自承無同儕審查矛盾 → 降為「中」',
                change: `證據等級「高」→「中」（自承：${PEER_STRICT}）`,
            })
            assert.equal(rule.downgrade({ level: 'A', levels: ['A', 'B'], caveats: [PEER_STRICT] }).to, 'B', '自訂等級名')
        })

        it('只命中寬式、皆未命中、非最高級、只有一級、等級清單缺、caveats 非陣列 → 不降(null)', () => {
            const d = (o) => rule.downgrade({ level: '高', levels: LEVELS, caveats: [PEER_STRICT], ...o })
            assert.equal(d({ caveats: [PEER_LOOSE] }), null)
            assert.equal(d({ caveats: [PEER_NONE] }), null)
            assert.equal(d({ level: '中' }), null)
            assert.equal(d({ levels: ['高'] }), null)
            assert.equal(d({ levels: undefined }), null)
            assert.equal(d({ caveats: PEER_STRICT }), null)
            assert.equal(rule.downgrade(), null)
        })
    })

    describe('⑤ 比對前正規化(NFKC＋轉正體)', function() {

        it('全形英數與全形空白(NFKC)、簡體(轉正體)皆命中以正體半形書寫之樣式', () => {
            const rule = evidenceRuleOf({ subject: '標準稽核', check: 'ISO 9001 稽核', strict: [{ p: '未經ISO 9001稽核' }], loose: [{ p: '未[^；;。]{0,20}稽核' }] })
            assert.equal(rule.states('未經ＩＳＯ　９００１稽核'), true, '全形')
            assert.equal(rule.states('未经ISO 9001稽核'), true, '簡體之「经」')
            assert.equal(rule.states('未說明 ISO 9001 稽核'), false)
            assert.equal(rule.admits('未說明 ISO 9001 稽核'), true)
            assert.equal(evidenceRuleOf(PEER).states('未经同侪审查'), true, '簡體之整句')
            assert.equal(rule.states(null), false, 'null／undefined 視為空字串')
        })
    })

    describe('⑥ 訊息模板:中立題材之覆寫值代入模板後之全文逐字固定', function() {
        const rule = evidenceRuleOf(NEUTRAL_RULE)

        it('判準式:嚴式／寬式之命中(期望值為判準式之結果)', () => {
            const table = [
                [`無${OOS}驗證`, true, true], [`摘要未揭露${OOS}驗證之資料範圍與細節`, false, true], ['樣本小', false, false], [`只有${INS}`, true, false],
                [`僅${INS}`, true, true], [`未發現${OOS}衰退`, false, true], ['无独立观测验证', true, true], [`無　${OOS}驗證`, false, true],
                [`無一二三四五六七八九十${OOS}`, false, true], [`無一二三四五六七八九十一${OOS}`, false, false], [`無。${OOS}結果良好`, false, false],
                [`僅限${INS}`, true, true], [`未經${OOS}驗證`, true, true], [`${OOS}表現有待觀察`, false, false],
            ]
            for (const [t, s, a] of table) assert.deepEqual([rule.states(t), rule.admits(t)], [s, a], t)
        })

        it('判定之 detail(不合格、未能判定)逐字固定', () => {
            const v = rule.judge({ level: '高', levels: LEVELS, caveats: [`無${OOS}驗證`] })
            assert.equal(v.detail, '證據等級「高」卻自承：無獨立觀測驗證')
            const u = rule.judge({ level: '高', levels: LEVELS, caveats: [`摘要未揭露${OOS}驗證之資料範圍與細節`] })
            assert.equal(u.detail, 'caveat 涉及獨立觀測而未明確自承(須判讀)：摘要未揭露獨立觀測驗證之資料範圍與細節')
        })

        it('回饋:未能判定者於基本回饋後接「——」與更正方向,全文逐字固定;不合格與他標準不附', () => {
            const u = rule.judge({ level: '高', levels: LEVELS, caveats: [`摘要未揭露${OOS}驗證之資料範圍與細節`] })
            const feedbackOf = (r) => {
                const base = `${r?.std || ''} ${r?.detail || ''}`.trim()
                const hint = rule.feedbackHintOf(r)
                return hint ? `${base}——${hint}` : base
            }
            assert.equal(rule.feedbackHintOf(u), '請明確寫出是否做過獨立觀測證實，或降低證據等級')
            assert.equal(feedbackOf(u), 'SS11 caveat 涉及獨立觀測而未明確自承(須判讀)：摘要未揭露獨立觀測驗證之資料範圍與細節——請明確寫出是否做過獨立觀測證實，或降低證據等級')
            assert.equal(rule.feedbackHintOf(rule.judge({ level: '高', levels: LEVELS, caveats: [`無${OOS}驗證`] })), '')
            assert.equal(rule.feedbackHintOf({ std: 'SS4', status: 'undetermined', detail: '原文不可得' }), '')
            assert.equal(rule.feedbackHintOf(null), '')
        })

        it('新進修正說明與存量變更說明逐字固定', () => {
            const d = rule.downgrade({ level: '高', levels: LEVELS, caveats: [`未經${OOS}驗證`] })
            assert.equal(d.fix, '證據等級「高」與 caveat 自承無獨立觀測證實矛盾 → 降為「中」')
            assert.equal(d.change, '證據等級「高」→「中」（自承：未經獨立觀測驗證）')
            assert.equal(d.to, '中')
        })

        it('evidenceMessagesOf(獨立之訊息產生函數)與規則之 messages 同一模板;用詞缺即拋', () => {
            const m = evidenceMessagesOf({ subject: OOS, check: CHECK })
            assert.equal(m.undetermined('甲'), rule.messages.undetermined('甲'))
            assert.equal(m.feedback(), rule.messages.feedback())
            assert.equal(m.downgradeFix('高', '中'), rule.messages.downgradeFix('高', '中'))
            assert.equal(m.violation('高', '甲'), '證據等級「高」卻自承：甲')
            assert.equal(m.downgradeChange('高', '中', '甲'), '證據等級「高」→「中」（自承：甲）')
            assert.equal(msgOf(() => evidenceMessagesOf({ subject: OOS })), 'evidenceRule.check 須為非空字串')
        })
    })

    describe('⑦ 正規形、可重複套用與指紋', function() {

        it('正規形:RegExp 取 source／flags;{ p, f } 原樣保留 p;空旗標省略 f;已深凍結', () => {
            const r = evidenceRuleOf({ subject: '甲', check: '乙', strict: [/a\/b/i, { p: 'a/b', f: '' }, { p: 'c', f: 'u' }], loose: [] })
            assert.deepEqual(r.config, { subject: '甲', check: '乙', strict: [{ p: 'a\\/b', f: 'i' }, { p: 'a/b' }, { p: 'c', f: 'u' }], loose: [] })
            assert.ok(Object.isFrozen(r) && Object.isFrozen(r.config) && Object.isFrozen(r.config.strict) && Object.isFrozen(r.config.strict[0]))
            assert.equal(r.enabled, true)
            assert.equal(r.std, EVIDENCE_STD)
        })

        it('同一規則得同一物件:已編譯者原樣回傳、以其正規形再呼叫命中同一物件;使用方之物件每次重新驗證(可能被就地修改)', () => {
            const r = evidenceRuleOf(PEER)
            assert.equal(evidenceRuleOf(r), r)
            assert.equal(evidenceRuleOf(r.config), r)
            const mine = { ...PEER, strict: [...PEER.strict] }
            const r1 = evidenceRuleOf(mine)
            mine.strict.push({ p: '' })
            assert.throws(() => evidenceRuleOf(mine), /strict\[1\]/, '就地改壞後再呼叫仍會驗出')
            assert.equal(r1.config.strict.length, 1, '先前之編譯結果不受影響')
        })

        it('JSON 化即正規形;JSON 往返後重編譯得相同指紋與行為', () => {
            const r = evidenceRuleOf(NEUTRAL_RULE)
            assert.equal(JSON.stringify(r), JSON.stringify(r.config))
            const back = evidenceRuleOf(JSON.parse(JSON.stringify(r)))
            assert.equal(back.fp, r.fp)
            assert.deepEqual(back.config, r.config)
            assert.equal(back.states(`無${OOS}驗證`), true)
        })

        it('指紋:正規形之 sha1 前 16 碼(十六進位);寫法不同而內容相同者相同、內容不同者不同', () => {
            const r = evidenceRuleOf(PEER)
            assert.match(r.fp, /^[0-9a-f]{16}$/)
            assert.equal(r.fp, createHash('sha1').update(JSON.stringify(r.config), 'utf8').digest('hex').slice(0, 16))
            const same = evidenceRuleOf({ subject: '同儕審查', check: '同儕審查', strict: [/(?:未經|沒有|無)同儕審查/], loose: [{ p: '(?:未|無)[^；;。]{0,10}同儕審查', f: '' }] })
            assert.equal(same.fp, r.fp)
            assert.notEqual(evidenceRuleOf({ ...PEER, check: '外部審查' }).fp, r.fp)
            assert.notEqual(evidenceRuleOf({ ...PEER, loose: [] }).fp, r.fp)
        })

        it('isEvidenceRule:只認已編譯之規則(含停用者);正規形、原始設定、他物件皆否', () => {
            const r = evidenceRuleOf(PEER)
            assert.deepEqual([isEvidenceRule(r), isEvidenceRule(evidenceRuleOf(null)), isEvidenceRule(r.config), isEvidenceRule(PEER), isEvidenceRule(null), isEvidenceRule({ ...r })], [true, true, false, false, false, true])
        })
    })

    describe('⑧ 另一種合格證據(alt;最高級之定義為「A 或 B」)', function() {
        // 最高級＝經同儕審查或獲獨立重現:只自承未經同儕審查而肯定陳述已獲獨立重現者不矛盾
        const ALT = { ...PEER, alt: [{ p: '^(?!.*(?:未|無|沒有|缺乏)).*(?<!非)獨立重現' }] }

        it('證據說明或 caveats 逐句肯定陳述 B → 合格、不降級;句中有否定或「非 B」者不算 → 照嚴式／寬式判', () => {
            const r = evidenceRuleOf(ALT)
            const j = (o) => r.judge({ level: '高', levels: LEVELS, caveats: [PEER_STRICT], ...o }).status
            const dg = (o) => r.downgrade({ level: '高', levels: LEVELS, caveats: [PEER_STRICT], ...o })
            assert.equal(j({ evidence: '結果已獲兩個實驗室獨立重現' }), STATUS.PASS)
            assert.equal(dg({ evidence: '結果已獲兩個實驗室獨立重現' }), null)
            assert.equal(j({ evidence: '樣本充足，已獲獨立重現，惟期間短' }), STATUS.PASS, '逐句:任一句肯定即算')
            assert.equal(j({ caveats: [PEER_STRICT, '已獲獨立重現但只一次'] }), STATUS.PASS, 'caveats 之肯定陳述亦算')
            assert.equal(j({ evidence: '未見獨立重現' }), STATUS.VIOLATION, '句中有否定 → 不算')
            assert.equal(j({ evidence: '屬模擬而非獨立重現' }), STATUS.VIOLATION, '「非 B」→ 不算')
            assert.equal(j({ evidence: '' }), STATUS.VIOLATION)
            assert.equal(j({}), STATUS.VIOLATION, '未給證據說明 → 照嚴式判(與加入 alt 前同)')
            assert.ok(dg({ evidence: '未見獨立重現' }))
            assert.equal(r.judge({ level: '中', levels: LEVELS, caveats: [PEER_STRICT], evidence: '已獲獨立重現' }).status, STATUS.NA, '非最高級仍不適用')
            assert.equal(r.judge({ level: '高', levels: LEVELS, caveats: [PEER_LOOSE], evidence: '已獲獨立重現' }).status, STATUS.PASS, '寬式只命中者有 B 亦合格')
        })

        it('未給 alt 或給空陣列:正規形不帶 alt、指紋與行為同加入 alt 之前;supports 恆 false(停用之規則亦然)', () => {
            const base = evidenceRuleOf(PEER)
            const empty = evidenceRuleOf({ ...PEER, alt: [] })
            const nul = evidenceRuleOf({ ...PEER, alt: null })
            assert.deepEqual(['alt' in base.config, 'alt' in empty.config, 'alt' in nul.config], [false, false, false])
            assert.deepEqual([empty.fp, nul.fp], [base.fp, base.fp])
            assert.equal(base.judge({ level: '高', levels: LEVELS, caveats: [PEER_STRICT], evidence: '已獲獨立重現' }).status, STATUS.VIOLATION, '未給 alt → 證據說明不影響判定')
            assert.deepEqual([base.supports(['已獲獨立重現']), evidenceRuleOf(null).supports(['已獲獨立重現'])], [false, false])
            const withAlt = evidenceRuleOf(ALT)
            assert.notEqual(withAlt.fp, base.fp, '給 alt → 規則內容不同,指紋不同')
            assert.deepEqual(withAlt.config.alt, ALT.alt)
            assert.equal(evidenceRuleOf(JSON.parse(JSON.stringify(withAlt))).fp, withAlt.fp, 'JSON 往返後指紋相同')
        })

        it('alt 之驗證:非陣列、帶 g／y 旗標、命中空字串 → 拋並附設定路徑', () => {
            assert.equal(msgOf(() => evidenceRuleOf({ ...PEER, alt: 'x' })), 'vocab.evidenceRule.alt 須為樣式陣列（RegExp 或 { p: 樣式字串, f?: 旗標 }）')
            assert.match(String(msgOf(() => evidenceRuleOf({ ...PEER, alt: [{ p: '重現', f: 'g' }] }))), /vocab\.evidenceRule\.alt\[0\] 之旗標不可含 g 或 y/)
            assert.match(String(msgOf(() => evidenceRuleOf({ ...PEER, alt: [{ p: '(?:)' }] }))), /vocab\.evidenceRule\.alt\[0\] 會命中空字串/)
        })
    })

    describe('⑨ 自承無最高證據等級之要件(noTopEvidenceOf;下游以同一判準判讀)', function() {
        // 兩種規則:觀測題材之規則(test/tools/neutralRule 之 NEUTRAL_RULE)與同儕審查之規則(PEER);各配一個另一種合格證據(alt)之版本。
        //   strictOnly／looseOnly／both／none 之分類取自上方 ③⑥ 已釘住之命中表(嚴式／寬式各自之結果)
        const KITS = {
            觀測題材: {
                rule: NEUTRAL_RULE, strictOnly: `只有${INS}`, looseOnly: `摘要未揭露${OOS}驗證之資料範圍與細節`, both: `無${OOS}驗證`, none: '樣本小',
                alt: [{ p: '^(?!.*(?:未|無|沒|缺|不|待|需|可能))(?:(?!非).)*實地(?:觀測|驗證)(?:結果|紀錄)' }], altText: '已有兩年實地觀測紀錄', altNeg: '尚未有實地觀測紀錄',
            },
            中立: {
                rule: PEER, strictOnly: '沒有同儕審查', looseOnly: PEER_LOOSE, both: '無同儕審查', none: PEER_NONE,
                alt: [{ p: '^(?!.*(?:未|無|沒有|缺乏)).*(?<!非)獨立重現' }], altText: '結果已獲兩個實驗室獨立重現', altNeg: '未見獨立重現',
            },
        }

        it('分類之前提:各規則之 strictOnly 只中嚴式、looseOnly 只中寬式、both 兩式皆中、none 皆不中', () => {
            for (const [name, k] of Object.entries(KITS)) {
                const r = evidenceRuleOf(k.rule)
                assert.deepEqual([[r.states(k.strictOnly), r.admits(k.strictOnly)], [r.states(k.looseOnly), r.admits(k.looseOnly)], [r.states(k.both), r.admits(k.both)], [r.states(k.none), r.admits(k.none)]],
                    [[true, false], [false, true], [true, true], [false, false]], name)
            }
        })

        it('只命中嚴式 → true;只命中寬式 → true;兩式皆中 → true;皆未命中 → false;多則 caveats 有一則命中即算(位置不拘)', () => {
            for (const [name, k] of Object.entries(KITS)) {
                for (const rule of [k.rule, evidenceRuleOf(k.rule)]) {
                    const f = (caveats, evidence) => noTopEvidenceOf({ caveats, evidence }, rule)
                    assert.deepEqual([f([k.strictOnly]), f([k.looseOnly]), f([k.both]), f([k.none])], [true, true, true, false], name)
                    assert.equal(f([k.none, k.none, k.looseOnly]), true, `${name}:末則命中`)
                    assert.equal(f([k.none, '其他疑慮']), false, `${name}:皆未命中`)
                }
            }
        })

        it('另一種合格證據:證據說明命中 alt → false(即使 caveats 命中嚴式或寬式);caveats 中一句命中 alt 亦 false;否定之 alt 句不算 → 仍 true;未給 alt 之規則不看證據說明', () => {
            for (const [name, k] of Object.entries(KITS)) {
                const r = evidenceRuleOf({ ...k.rule, alt: k.alt })
                const f = (caveats, evidence) => noTopEvidenceOf({ caveats, evidence }, r)
                for (const hit of [k.strictOnly, k.looseOnly, k.both]) {
                    assert.equal(f([hit], k.altText), false, `${name}:證據說明命中 alt(${hit})`)
                    assert.equal(f([hit], [k.altNeg, k.altText]), false, `${name}:證據說明為陣列、其一命中 alt`)
                    assert.equal(f([hit, k.altText]), false, `${name}:caveats 中一句命中 alt`)
                    assert.equal(f([hit], k.altNeg), true, `${name}:否定句不是 alt 之肯定陳述`)
                    assert.equal(f([hit], ''), true, `${name}:證據說明空`)
                    assert.equal(f([hit]), true, `${name}:未給證據說明`)
                    assert.equal(noTopEvidenceOf({ caveats: [hit], evidence: k.altText }, k.rule), true, `${name}:未給 alt 之規則 → 證據說明不影響`)
                }
            }
        })

        it('規則停用(null、undefined、未給、evidenceRuleOf(null))→ false,即使 caveats 命中他規則之嚴式', () => {
            for (const [name, k] of Object.entries(KITS)) {
                for (const off of [null, undefined, evidenceRuleOf(null)]) assert.equal(noTopEvidenceOf({ caveats: [k.both, k.strictOnly] }, off), false, `${name}:${String(off && 'disabled')}`)
                assert.equal(noTopEvidenceOf({ caveats: [k.both] }), false, `${name}:未給第二參數`)
            }
        })

        it('caveats 空或非陣列 → false;第一參數非物件、未給或缺 caveats → false(不拋)', () => {
            const r = evidenceRuleOf(PEER)
            assert.equal(noTopEvidenceOf({ caveats: [] }, r), false, 'caveats 空')
            for (const bad of [PEER_STRICT, null, undefined, { 0: PEER_STRICT }, 1]) assert.equal(noTopEvidenceOf({ caveats: bad }, r), false, `caveats=${JSON.stringify(bad)}`)
            for (const o of [null, undefined, PEER_STRICT, 0, [], {}]) assert.equal(noTopEvidenceOf(o, r), false, `o=${JSON.stringify(o)}`)
            assert.equal(noTopEvidenceOf(undefined, undefined), false)
            assert.equal(noTopEvidenceOf({ caveats: [null, 123, { a: 1 }, PEER_NONE] }, r), false, '非字串元素不誤判')
        })

        it('規則可給已編譯者或其設定(結果同);不合規格之設定 → 拋(訊息同 evidenceRuleOf,不靜默當成停用)', () => {
            assert.equal(noTopEvidenceOf({ caveats: [PEER_LOOSE] }, PEER), noTopEvidenceOf({ caveats: [PEER_LOOSE] }, evidenceRuleOf(PEER)))
            assert.equal(noTopEvidenceOf({ caveats: [PEER_LOOSE] }, evidenceRuleOf(PEER).config), true, '正規形亦可')
            assert.equal(msgOf(() => noTopEvidenceOf({ caveats: [PEER_STRICT] }, { ...PEER, sujbect: 'x' })), 'vocab.evidenceRule 含不認得之鍵：sujbect（可用：subject、check、strict、loose、alt）')
            assert.equal(msgOf(() => noTopEvidenceOf({ caveats: [] }, 'x')), 'vocab.evidenceRule 須為物件 { subject, check, strict, loose, alt? } 或 null（不啟用）', 'caveats 空亦先驗規則')
        })

        it('比對前正規化同判定(NFKC＋轉正體):簡體、全形之自承亦命中', () => {
            assert.equal(noTopEvidenceOf({ caveats: ['无独立观测验证'] }, NEUTRAL_RULE), true)
            assert.equal(noTopEvidenceOf({ caveats: ['未经同侪审查'] }, PEER), true)
            assert.equal(noTopEvidenceOf({ caveats: ['未經ＩＳＯ　９００１稽核'] }, { subject: '標準稽核', check: 'ISO 9001 稽核', strict: [{ p: '未經ISO 9001稽核' }], loose: [] }), true)
        })

        it('與判定同一判準:同一 caveats 與證據說明,最高級之 judge 為不合格或未能判定 ⟺ noTopEvidenceOf 為真(兩種規則 × 有無 alt × caveats 之組合 × 證據說明)', () => {
            let n = 0
            for (const [name, k] of Object.entries(KITS)) {
                for (const rule of [evidenceRuleOf(k.rule), evidenceRuleOf({ ...k.rule, alt: k.alt })]) {
                    const pool = [k.strictOnly, k.looseOnly, k.both, k.none, k.altText, k.altNeg, null, 7, '']
                    const combos = [[]]
                    for (const a of pool) {
                        combos.push([a])
                        for (const b of pool) combos.push([a, b])
                    }
                    for (const caveats of combos) {
                        for (const evidence of [undefined, '', k.altText, k.altNeg, [k.altText], [k.none, k.altNeg]]) {
                            const st = rule.judge({ level: '高', levels: LEVELS, caveats, evidence }).status
                            assert.equal(noTopEvidenceOf({ caveats, evidence }, rule), st === STATUS.VIOLATION || st === STATUS.UNDETERMINED, `${name}:${JSON.stringify({ caveats, evidence, st, alt: !!rule.config.alt })}`)
                            n++
                        }
                    }
                }
            }
            assert.ok(n > 2000, `組合須足量:${n}`)
        })
    })
})
