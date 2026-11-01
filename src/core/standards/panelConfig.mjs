// panelConfig.mjs — 判定小組之設定面(本套件與下游工作同一份):席位之 schema、小組之組成(開啟與成員之必填由功能表推導)、問題之判定
//   (缺必填、同家、須叫第三席)、同家之啟動期警告、席位表之列——各工作之設定解析與啟動期警告、組裝者之席位檢核同讀,不另寫判準與字樣
//
// 【小組之定義】{ std, path(設定路徑,不含 settings.), name, members:(settings, on)=>[{ key?:'first'|'second'|'third'(小組之席), label, seat, required? }],
//   ballots?:(settings, on)=>[[首票, 次票, 第三席]](成員之索引;未給為 [[0, 1, 2]]) };on＝功能表中已開啟之功能鍵之集合(抓取套件之 featuresOnOf)。
// 【開啟與必填由功能表推導】功能表(各工作宣告:功能 × 開啟判準 × 判定小組之必填席 × 所需 domain 成員;抓取套件之 featureProblemsOf 為其必填之
//   單一判定)——小組開啟＝以本小組為席之功能任一開啟;具 key 之成員之必填＝已開啟之功能所需之席(皆未開時以全部功能所需之席計,供「開啟前須先改」
//   之提示);不具 key 之成員(工作席,如預篩席、提案席——其席位另有沿用之規則)之必填依其定義。
// 【同家】首選 use 相同即同家:某一投票組合之首兩票同家而無首選不同之第三席 → 兩票恆為同一供應者,判定小組永遠無法成立(只會逐輪重試、
//   逾次轉使用者);首兩票同家而第三席不同家 → 每次皆須叫第三席。

import isobj from 'wsemi/src/isobj.mjs'
import isarr from 'wsemi/src/isarr.mjs'
import isfun from 'wsemi/src/isfun.mjs'
import { featuresOnOf } from '../capturePackage.mjs'

/** 判定小組之席位之 schema(各工作之設定 schema 同用;三席皆可為 null＝未設) */
export const PANEL_SCHEMA = Object.freeze({ first: 'seatOrNull', second: 'seatOrNull', third: 'seatOrNull' })

/**
 * 一個判定小組之組成(檔頭【小組之定義】【開啟與必填由功能表推導】)
 *
 * @param {Object} def 輸入小組之定義
 * @param {Object} settings 輸入已解析之設定
 * @param {Array} features 輸入該工作之功能表(抓取套件之 featureProblemsOf 之表)
 * @returns {Object} 回傳 { std, path, name, on:Boolean, members:[{ label, seat:Object|null, required:Boolean }], ballots:[[i, j, k]] }
 * @example
 * const F = [{ key: 'x', on: (s) => s.on === true, panel: { path: 'a.ai', seats: ['first', 'second'] } }]
 * const def = { std: 'X1', path: 'a.ai', name: '甲', members: (s) => [{ key: 'first', label: 'first', seat: s.a.ai.first }, { key: 'second', label: 'second', seat: null }, { key: 'third', label: 'third', seat: null }] }
 * console.log(panelGroupOf(def, { on: true, a: { ai: { first: { use: 'p' } } } }, F).members.map((m) => m.required))
 * // => [ true, true, false ]
 */
export function panelGroupOf(def, settings, features) {
    const on = new Set(featuresOnOf(features, settings).map((f) => f.key))
    const mine = (isarr(features) ? features : []).filter((f) => isobj(f) && f.panel?.path === def.path)
    const active = mine.filter((f) => on.has(f.key))
    const need = new Set((active.length ? active : mine).flatMap((f) => (isarr(f.panel.seats) ? f.panel.seats : [])))
    const members = def.members(settings, on).map((m) => ({ label: m.label, seat: isobj(m.seat) ? m.seat : null, required: m.key ? need.has(m.key) : m.required === true }))
    return { std: def.std, path: def.path, name: def.name, on: active.length > 0, members, ballots: isfun(def.ballots) ? def.ballots(settings, on) : [[0, 1, 2]] }
}

/**
 * 一組判定小組之問題(同家＝首選 use 相同):必填而未設之成員;各投票組合之首兩票同家者(third＝首選不同之第三席之顯示名,無者為 ''——
 *   無則兩票恆為同一供應者、判定小組永不成立;有則每次皆須叫第三席)
 *
 * @param {Object} g 輸入 panelGroupOf 之產物(或同形)
 * @returns {Object} 回傳 { missing:Array(成員顯示名), same:[{ a, b(成員顯示名), use(首選), third(第三席顯示名｜''), thirdUse }] }
 * @example
 * const g = { members: [{ label: 'first', seat: { use: 'p' }, required: true }, { label: 'second', seat: { use: 'p' }, required: true }, { label: 'third', seat: null, required: false }], ballots: [[0, 1, 2]] }
 * console.log(panelFindingsOf(g))
 * // => { missing: [], same: [ { a: 'first', b: 'second', use: 'p', third: '', thirdUse: '' } ] }
 */
export function panelFindingsOf(g) {
    const members = isarr(g?.members) ? g.members : []
    const use = (i) => String(members[i]?.seat?.use || '')
    const missing = members.filter((m) => m?.required && !m.seat?.use).map((m) => m.label)
    const same = []
    for (const [i, j, t] of isarr(g?.ballots) ? g.ballots : []) {
        const u = use(i)
        if (!u || u !== use(j)) continue
        const diff = t !== undefined && use(t) && use(t) !== u
        same.push({ a: members[i].label, b: members[j].label, use: u, third: diff ? members[t].label : '', thirdUse: diff ? use(t) : '' })
    }
    return { missing, same }
}

/**
 * 判定小組之同家警告(啟動期;各工作之設定解析同用):已開啟之小組,其任一投票組合之首兩票同家而無首選不同之第三席 → 兩票恆為同一供應者,
 *   判定小組永遠無法成立。未開啟之小組不判(開啟時才生效);必填席位未設屬組裝者之啟動期檢核(功能表)
 *
 * @param {Array} groups 輸入 panelGroupOf 之產物之陣列
 * @returns {Array} 回傳警告字串陣列
 * @example
 * const g = { on: true, name: '甲', path: 'a.ai', members: [{ label: 'first', seat: { use: 'p' } }, { label: 'second', seat: { use: 'p' } }, { label: 'third', seat: null }], ballots: [[0, 1, 2]] }
 * console.log(panelSameProviderWarnings([g]).length)
 * // => 1
 */
export function panelSameProviderWarnings(groups) {
    const out = []
    for (const g of isarr(groups) ? groups : []) {
        if (!g?.on) continue
        for (const x of panelFindingsOf(g).same) {
            if (x.third) continue
            out.push(`${g.name}（${g.path}）：${x.a} 與 ${x.b} 之首選同為「${x.use}」且無首選不同之第三席（third）——兩票為同一供應者，判定小組永遠無法成立（只會逐輪重試、逾次轉使用者）；請改其一席之 use，或設首選不同之 third`)
        }
    }
    return out
}

/**
 * 判定小組之各席之席位表列(設定路徑、顯示名、取席位之函數;各工作之席位表同用)
 *
 * @param {String} base 輸入小組之設定路徑
 * @param {Array} seats 輸入 [[鍵, 顯示名]]
 * @param {Function} of 輸入 (工作段之設定) => 小組物件
 * @returns {Array} 回傳 [{ path, label, of:(工作段之設定)=>席位 }]
 * @example
 * const rows = panelSeatRowsOf('relate.standards.ai', [['first', '第一席']], (r) => r?.standards?.ai)
 * console.log(rows[0].path, rows[0].of({ standards: { ai: { first: { use: 'p' } } } }).use)
 * // => relate.standards.ai.first p
 */
export function panelSeatRowsOf(base, seats, of) {
    return seats.map(([k, label]) => ({ path: `${base}.${k}`, label, of: (s) => of(s)?.[k] }))
}

export default { PANEL_SCHEMA, panelGroupOf, panelFindingsOf, panelSameProviderWarnings, panelSeatRowsOf }
