// panelRun.mjs — 判定小組之單頁執行器:一頁之受檢項交第一、二席(並行;第二席項序打亂、編號不變)→ 前兩席任一中止即整頁中止 →
//   逐項收兩票 → 未成立而第三席可成立者(needThird)只送該些項給第三席 → 逐項裁定(decidePanel)
//
// 【為何獨立成檔】各 AI 標準之判定小組執行同一骨架(本套件之 SS14 忠實性覆核,以及下游以判定小組判定之標準),各標準只差:席位之呼叫、
//   提示詞、一席回覆之逐項票、兩票「相同」之定義、打亂之前綴與傳給呼叫之段名——骨架只此一份,各標準只給差異(同一規則多處手寫必然漂移)。
//   裁定之規則(成立、第三席、未成立之原因)在 panel.mjs(純函數、無匯入);本檔是其執行器(需雜湊),故另成一檔。
// 【可選之差異(opt-in;皆未給即預設骨架)】第二席所見之項(secondOf:如只送既有邊)、該項之前兩票(ballotOf:如單席之提案以提案席之票為第一票)、
//   以項為參數之裁定與是否叫第三席(decideOf、needThirdOf:如兩層判定須見該項之現行型別)、第三席中止之語意(thirdStop:'page' 整頁丟棄｜
//   'items' 只使送第三席之項不判、其餘照回)。擴充預設不變:未給者行為與未擴充前逐字同。
// 【先組後叫】本頁各席之提示詞先組好才呼叫(組字拋錯即不呼叫任何席位);兩席之呼叫並行。
// 【骨架之外,由呼叫端處理】①呼叫結果之正規化:各調度層之原始形狀(如 { ok, data, providerId, skipped }、{ ok, json, providerId, stopped })
//   由呼叫端轉成 { ok, data, providerId, stop } 再交 call(轉換勿包成 async 函數:同步拋出者須原樣拋出,第二席才不會被呼叫);
//   ②分頁:依材料字數分頁者逐頁呼叫本函數、累計 calls,某頁中止即依該標準之規定收尾;③跨頁合成與裁定後之衍生欄位(如成對兩票
//   所列出處之聯集、裁定附項編號):以回傳之 decisions／byIndex 於本函數之外計算;④空頁是否呼叫:本函數不略過空頁(各標準之略過
//   條件不同,由呼叫端於呼叫前判斷)。
// 【票之形狀】{ seat:'first'|'second'|'third', provider:實際成交之供應者(無為 ''), verdict:votesOf 之值(未涵蓋或該席失敗＝null) }——
//   席位名固定,與傳給 call 之段名(stages)無關。無第二席者(或 secondOf 回空)第二票恆為缺票(未成立 missing,不叫第三席)。

import isarr from 'wsemi/src/isarr.mjs'
import isobj from 'wsemi/src/isobj.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import isestr from 'wsemi/src/isestr.mjs'
import { decidePanel, needThird } from './panel.mjs'
import { sha1 } from '../capturePackage.mjs'

/** 傳給 call 之段名之預設(依席序:第一、二、三席;各標準可另給,如 ['check1', 'check2', 'check3']) */
export const PANEL_STAGES = Object.freeze(['first', 'second', 'third'])

/** 第三席中止之語意:page＝整頁丟棄(預設);items＝只使送第三席之項不判、其餘照回 */
export const PANEL_THIRD_STOP = Object.freeze({ PAGE: 'page', ITEMS: 'items' })

/**
 * 判定小組之單頁執行器(見檔頭)
 *
 * @param {Object} o 輸入 {
 *   local:Array([{ index:正整數(項編號,頁內互異;提示詞與回覆以之對應), key(裁定之鍵), ...呼叫端之欄位 }]),
 *   buildPrompt:(xs)=>String(xs 為 local、第二席所見之項之打亂序、或第三席之子集;回提示詞),
 *   shufflePrefix:String(第二席項序依 sha1(`<前綴>|<key>`) 排序;各標準一個前綴,編號不變),
 *   call:(stage, seat, prompt)=>Promise<{ ok, data, providerId, stop }>(呼叫端把原始結果正規化成此形狀;stop 為真＝預算或額度中止),
 *   seats:{ first, second?, third? }(first 恆叫;second、third 為物件才叫;非物件視為 {}),
 *   votesOf:(data, indexSet)=>Map(項編號 → 票|PANEL_UNSURE|null;indexSet 為該席所見之項編號),
 *   stages?:[String, String, String](傳給 call 之第一參數;預設 PANEL_STAGES),
 *   same?:(a, b)=>Boolean(兩明確裁決是否相同;未給為 JSON 相等,同 decidePanel),
 *   secondOf?:(local)=>Array(第二席所見之項;預設整頁;回空即不叫第二席),
 *   ballotOf?:(x, a, b)=>Array(該項之前兩票;a、b 為第一、二席之票;預設 [a, b]),
 *   decideOf?:(x, votes)=>Object(該項之裁定;預設 decidePanel(votes, { same })),
 *   needThirdOf?:(x, votes)=>Boolean(前兩票未成立時是否送第三席;預設 needThird(votes, { same })),
 *   thirdStop?:'page'|'items'(第三席中止之語意;預設 'page') }
 * @returns {Promise} 回傳 Promise，resolve 回傳 {
 *   decisions:Map(key → { ...decideOf 之結果, votes:[{ seat, provider, verdict }] };同鍵者後項覆蓋前項),
 *   byIndex:Map(項編號 → 同一裁定物件), calls:Integer(實際呼叫次數), stopped:Boolean(任一席中止),
 *   undecided:Array(中止而未判之項編號:前兩席中止＝全頁;第三席中止＝thirdStop 為 'page' 時全頁、'items' 時只送第三席之項) };
 *   前兩席中止、或第三席中止而 thirdStop 為 'page' 時 decisions 與 byIndex 皆空;call 或 buildPrompt 拋錯則原樣拒絕
 * @throws {Error} 參數不合(local 非陣列、項非物件或 index 非正整數或重複、buildPrompt／call／votesOf 非函數、shufflePrefix 非非空字串、
 *   stages 非三個非空字串、same／secondOf／ballotOf／decideOf／needThirdOf 非函數、thirdStop 非 'page'|'items')或 votesOf 回傳非 Map、
 *   secondOf 回傳非 local 之子集、ballotOf 回傳非兩票時拒絕
 * @example
 * need test in nodejs.
 *
 * let r = await runPanelPage({
 *     local: [{ index: 1, key: 'a', text: '甲' }, { index: 2, key: 'b', text: '乙' }],
 *     buildPrompt: (xs) => xs.map((x) => `${x.index}. ${x.text}`).join('\n'),
 *     shufflePrefix: 'demo',
 *     seats: { first: { use: 'p1' }, second: { use: 'p2' }, third: { use: 'p3' } },
 *     call: async (stage, seat, prompt) => ({ ok: true, providerId: seat.use, data: [...prompt.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1])) }),
 *     votesOf: (data, indexSet) => new Map(data.filter((i) => indexSet.has(i)).map((i) => [i, 'yes'])),
 * })
 * console.log([...r.decisions].map(([k, d]) => `${k}:${d.status}:${d.by.join('+')}`), r.calls, r.stopped)
 * // => [ 'a:decided:p1+p2', 'b:decided:p1+p2' ] 2 false
 */
export async function runPanelPage(o) {

    //check
    if (!isobj(o)) {
        throw new Error('runPanelPage 須給參數物件 { local, buildPrompt, shufflePrefix, call, seats, votesOf, stages?, same?, secondOf?, ballotOf?, decideOf?, needThirdOf?, thirdStop? }')
    }
    if (!isarr(o.local)) {
        throw new Error('runPanelPage 之 local 須為陣列 [{ index, key, … }]')
    }
    const seen = new Set()
    for (const x of o.local) {
        if (!isobj(x) || !Number.isInteger(x.index) || x.index < 1) {
            throw new Error(`runPanelPage 之 local 每項須為物件且 index 為正整數，收到：${JSON.stringify(x?.index ?? x)}`)
        }
        if (seen.has(x.index)) {
            throw new Error(`runPanelPage 之 local 之 index 重複：${x.index}（項編號為提示詞與回覆之對應，須頁內互異）`)
        }
        seen.add(x.index)
    }
    for (const k of ['buildPrompt', 'call', 'votesOf']) {
        if (!isfun(o[k])) throw new Error(`runPanelPage 之 ${k} 須為函數`)
    }
    if (!isestr(o.shufflePrefix)) {
        throw new Error('runPanelPage 之 shufflePrefix 須為非空字串（第二席項序之打亂前綴；各標準一個）')
    }
    const stages = o.stages === undefined ? PANEL_STAGES : o.stages
    if (!isarr(stages) || stages.length !== 3 || !stages.every((s) => isestr(s))) {
        throw new Error('runPanelPage 之 stages 須為三個非空字串 [第一席, 第二席, 第三席]（傳給 call 之段名）')
    }
    if (o.same !== undefined && !isfun(o.same)) {
        throw new Error('runPanelPage 之 same 須為函數（未給為 JSON 相等）')
    }
    for (const k of ['secondOf', 'ballotOf', 'decideOf', 'needThirdOf']) {
        if (o[k] !== undefined && !isfun(o[k])) throw new Error(`runPanelPage 之 ${k} 須為函數（未給即預設骨架）`)
    }
    const thirdStop = o.thirdStop === undefined ? PANEL_THIRD_STOP.PAGE : o.thirdStop
    if (![PANEL_THIRD_STOP.PAGE, PANEL_THIRD_STOP.ITEMS].includes(thirdStop)) {
        throw new Error(`runPanelPage 之 thirdStop 須為 '${PANEL_THIRD_STOP.PAGE}'（整頁丟棄）或 '${PANEL_THIRD_STOP.ITEMS}'（只使送第三席之項不判）`)
    }

    const local = o.local
    const seats = isobj(o.seats) ? o.seats : {}
    const opt = { same: o.same }
    const decideOf = isfun(o.decideOf) ? o.decideOf : (x, vs) => decidePanel(vs, opt)
    const needThirdOf = isfun(o.needThirdOf) ? o.needThirdOf : (x, vs) => needThird(vs, opt)
    const ballotOf = isfun(o.ballotOf) ? o.ballotOf : (x, a, b) => [a, b]
    const votesFrom = (r, indexSet) => {
        if (!r?.ok) return new Map()
        const m = o.votesOf(r.data, indexSet)
        if (!(m instanceof Map)) throw new Error('runPanelPage 之 votesOf 須回傳 Map（項編號 → 票）')
        return m
    }
    const voteOf = (seat, r, m, index) => ({ seat, provider: String(r?.providerId || ''), verdict: m.has(index) ? m.get(index) : null })
    const decisions = new Map()
    const byIndex = new Map()
    const halt = (calls, undecided) => ({ decisions, byIndex, calls, stopped: true, undecided })

    // 第二席所見之項(預設整頁;須為 local 之子集),依前綴與鍵之雜湊打亂(編號不變——兩席看到不同之順序)
    const sees = isfun(o.secondOf) ? o.secondOf(local) : local
    if (!isarr(sees) || sees.some((x) => !local.includes(x))) {
        throw new Error('runPanelPage 之 secondOf 須回傳 local 之子集（第二席所見之項）')
    }
    // 預設骨架不略過空頁(由呼叫端判斷);給了 secondOf 而回空 → 不叫第二席
    const askSecond = isobj(seats.second) && (!isfun(o.secondOf) || sees.length > 0)
    const shuffled = [...sees].sort((a, b) => (sha1(`${o.shufflePrefix}|${a.key}`) < sha1(`${o.shufflePrefix}|${b.key}`) ? -1 : 1))
    // 先組後叫:兩份提示詞先組好才呼叫(組字拋錯即不呼叫任何席位);兩席並行
    const pA = o.buildPrompt(local)
    const pB = askSecond ? o.buildPrompt(shuffled) : null
    const [ra, rb] = await Promise.all([o.call(stages[0], seats.first, pA), askSecond ? o.call(stages[1], seats.second, pB) : null])
    let calls = askSecond ? 2 : 1
    if (ra?.stop || rb?.stop) return halt(calls, local.map((x) => x.index))
    const va = votesFrom(ra, new Set(local.map((x) => x.index)))
    const vb = votesFrom(rb, new Set(sees.map((x) => x.index)))
    const votes = new Map()
    for (const x of local) {
        const two = ballotOf(x, voteOf('first', ra, va, x.index), voteOf('second', rb, vb, x.index))
        if (!isarr(two) || two.length !== 2) throw new Error('runPanelPage 之 ballotOf 須回傳兩票 [票, 票]')
        votes.set(x.index, two)
    }

    // 第三席:只送未成立而可成立之項(缺票不叫——第三席不是重試)
    const third = isobj(seats.third) ? local.filter((x) => needThirdOf(x, votes.get(x.index))) : []
    let thirdStopped = false
    if (third.length) {
        const rc = await o.call(stages[2], seats.third, o.buildPrompt(third))
        calls++
        if (rc?.stop) {
            // 第三席中止:page＝整頁丟棄;items＝只使送第三席之項不判、其餘照回
            if (thirdStop === PANEL_THIRD_STOP.PAGE) return halt(calls, local.map((x) => x.index))
            thirdStopped = true
        }
        else {
            const vc = votesFrom(rc, new Set(third.map((x) => x.index)))
            for (const x of third) votes.get(x.index).push(voteOf('third', rc, vc, x.index))
        }
    }
    const undecided = thirdStopped ? new Set(third.map((x) => x.index)) : new Set()
    for (const x of local) {
        if (undecided.has(x.index)) continue
        const vs = votes.get(x.index)
        const d = { ...decideOf(x, vs), votes: vs }
        decisions.set(x.key, d)
        byIndex.set(x.index, d)
    }
    return { decisions, byIndex, calls, stopped: thirdStopped, undecided: [...undecided] }
}

export default { PANEL_STAGES, PANEL_THIRD_STOP, runPanelPage }
