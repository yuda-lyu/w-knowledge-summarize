// unit-summarize-bench.test.mjs — 摘要之 AI 能力評分(bench/summarizeBench.mjs、bench/cli.mjs)之單元測試:以替身調度層(不連網、不呼叫真 AI)驗五角色
//   ①題組:五份通用題組全數通過驗證;既有檢定標準題組(SS5 預篩／SS5 摘要／SS14／SS9)之形狀相容與拒收(以樣本檔定位之案須轉檔)
//   ②分頁與提示詞:預篩 20、摘要依字數打包、修補一案、忠實性 10、重標同焦點;各頁之提示詞與直接呼叫正式 domain 之結果逐字同
//   ③逐案類別:示範回覆(應然之答案)逐案通過(應然可達);錯誤回覆與邊界(note-bad 之各關、unfixed、缺票、平移不採、同 index 重複)
//   ④詞彙注入(opt.vocab／--vocab)、--role 解析、--role all 之準備期、多角色評比表並存、受測名單、命令列薄殼
//   ⑤領域中立:五份題組與評分原始碼不含量化／金融詞與網址
// 執行:自套件根 node <mocha> test/unit-summarize-bench.test.mjs(暫存 test/_tmp/summarize-bench-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
    SUMMARIZE_BENCH_ROLES, SUMMARIZE_BENCH_CASES_FILES, SUMMARIZE_BENCH_MODELS, SUMMARIZE_BENCH_USAGE,
    triageBenchRole, summarizeBenchRole, repairBenchRole, faithBenchRole, retagBenchRole,
    summarizeBenchRoleOf, runSummarizeBench, planSummarizeBench, runSummarizeBenchCli, parseSummarizeBenchArgs, benchAdmitNoteItem,
} from '../src/bench/summarizeBench.mjs'
import * as cli from '../src/bench/cli.mjs'
import { DEFAULT_FREE_MODELS } from '../src/core/capturePackage.mjs'
import { planBench } from './tools/captureForTest.mjs'
import { SUMMARIZE_DEFAULT } from '../src/core/summarizeSettings.mjs'
import { createTriageDomain } from '../src/domain/triageDomain.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { createRetagDomain } from '../src/domain/retagDomain.mjs'
import { normalizeNoteItem } from '../src/standards/noteNormalize.mjs'
import { repairProblemsOf, fieldPlaceOf } from '../src/standards/noteRepair.mjs'
import { faithNoteText } from '../src/standards/faithCheck.mjs'
import { packDocsByChars } from '../src/stores/packByChars.mjs'
import { domainTermsIn, BENCH_BOARD_HEADER, validateBenchCases, loadBenchCases, plainLog, msgOf, parseCsv } from './tools/captureForTest.mjs'

// 套件根與測試暫存(以本檔位置定,不依 cwd;帶 pid 使並行互不干擾;測完即刪)
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(PKG, 'src')
const TMP = path.join(PKG, 'test', '_tmp', `summarize-bench-${process.pid}`)

/** 固定時鐘(報表時間戳可斷言) */
const FIXED = { timeZone: 'Fixed/Test', iso8: () => '2031-03-04T05:06:07+08:00', stamp8: () => '20310304050607', date8: () => '2031-03-04', day8: () => '20310304' }

/** 各角色之內建題組(已驗) */
const SET = Object.fromEntries(SUMMARIZE_BENCH_ROLES.map((r) => [r.id, loadBenchCases(r)]))
const caseOf = (roleId, id) => SET[roleId].cases.find((c) => c.id === id)

// ════════════════ 示範回覆(各案之應然答案;驗應然可達) ════════════════

/** 摘要之示範筆記(知識文件;數字皆取自原文,依提示詞忠實萃取) */
const ORACLE_NOTES = {
    k01: { title: '以比熱計算加熱所需之熱量', category: '原理與概念', summary: '加熱所需之熱量可用 Q = m × c × ΔT 計算，水的比熱約為 4.18 J/(g·°C)', key_points: ['1 公克水升高攝氏 1 度約需 4.18 焦耳', '500 公克水由攝氏 20 度加熱到 80 度約需 125,400 焦耳', '容器吸熱與散熱使實際耗能高於計算值'], parameters: [{ name: '水的比熱', value: '約 4.18 J/(g·°C)', note: '' }], methods: ['以 Q = m × c × ΔT 計算所需熱量'], concepts: ['比熱', '熱量計算'], claim_type: '教學示範', evidence_level: '中', evidence_note: '教科書之計算示例' },
    k02: { title: '快速排序之運作與時間複雜度', category: '模型與演算法', summary: '快速排序以樞紐元素分割後遞迴排序，平均時間複雜度為 O(n log n)，最壞退化為 O(n²)', key_points: ['每次都選到最大或最小之元素當樞紐時會退化為 O(n²)', '隨機選樞紐或取首、中、尾三數之中位數可避免退化', '元素很少之小區段（常見門檻 10 至 20 個）可改用插入排序'], concepts: ['快速排序', '時間複雜度', '插入排序'], claim_type: '教學示範', evidence_level: '中', evidence_note: '演算法教材之說明' },
    k03: { title: '身體質量指數之計算與限制', category: '資料與指標', summary: 'BMI 等於體重（公斤）除以身高（公尺）的平方，低於 18.5 一般視為體重過輕', key_points: ['體重 70 公斤、身高 1.75 公尺者之 BMI 約為 22.9', 'BMI 無法區分肌肉與脂肪，肌肉量多者可能被誤判為過重', '評估時宜搭配腰圍等其他指標'], concepts: ['身體質量指數', '體重評估'], claim_type: '教學示範', evidence_level: '中', evidence_note: '衛教資料之一般說明' },
    k04: { title: '以字母頻率分析破解凱撒密碼', category: '方法與技術', summary: '凱撒密碼只有 25 種有效位移，可逐一嘗試或以字母頻率推得位移量', key_points: ['一般英文文章中字母 E 最常見，約占 12% 至 13%', '密文中最常見之字母很可能是 E 之密文，兩者距離即為位移量'], methods: ['統計密文之字母頻率，以最常見之字母對應 E'], concepts: ['凱撒密碼', '頻率分析'], claim_type: '教學示範', evidence_level: '中', evidence_note: '密碼學入門之說明' },
    k05: { title: '放射性碳定年法之原理', category: '原理與概念', summary: '生物死亡後碳-14 以約 5,730 年之半衰期衰變，由殘留比例即可推算年代', key_points: ['殘留四分之一約經過 11,460 年', '此法一般只適用於約 5 萬年以內之有機遺物'], concepts: ['放射性碳定年', '半衰期'], claim_type: '教學示範', evidence_level: '高', evidence_note: '廣泛應用之定年方法' },
    k06: { title: '梅納反應與食物褐變', category: '原理與概念', summary: '胺基酸與還原糖受熱發生梅納反應，約在攝氏 140 至 165 度時進行得很快', key_points: ['水在一大氣壓下約攝氏 100 度沸騰，水煮之食物表面不易褐變', '煎肉前先擦乾表面水分較易煎出焦香', '焦糖化是糖本身受熱分解，不需要胺基酸'], concepts: ['梅納反應', '焦糖化'], claim_type: '教學示範', evidence_level: '中', evidence_note: '食品化學之一般說明' },
    k07: { title: '結構設計中之安全係數', category: '原理與概念', summary: '安全係數為材料破壞強度與設計容許應力之比值，用以涵蓋各種不確定性', key_points: ['抗拉強度 400 MPa、容許應力 160 MPa 時安全係數為 2.5', '安全係數越高越不易破壞，但材料用量、重量與成本也隨之增加'], concepts: ['安全係數', '容許應力'], claim_type: '教學示範', evidence_level: '中', evidence_note: '材料力學之定義與示例' },
    h1: { title: '取樣頻率與奈奎斯特頻率', category: '原理與概念', summary: '取樣頻率須高於訊號最高頻率之兩倍，才不會產生混疊', key_points: ['取樣頻率之一半稱為奈奎斯特頻率', 'CD 音訊之取樣頻率為 44.1 kHz，奈奎斯特頻率為 22.05 kHz', '人耳可聽之上限約為 20 kHz', '取樣前須先以抗混疊低通濾波器濾除過高之頻率'], concepts: ['取樣定理', '混疊', '低通濾波器'], claim_type: '教學示範', evidence_level: '高', evidence_note: '訊號處理之基本定理' },
    h3: { title: '低滲透壓口服補液鹽之配方', category: '方法與技術', summary: '低滲透壓口服補液鹽每公升含氯化鈉 2.6 公克、無水葡萄糖 13.5 公克、氯化鉀 1.5 公克與檸檬酸鈉 2.9 公克', key_points: ['總滲透壓約為每公升 245 毫滲透莫耳', '葡萄糖幫助腸道吸收鈉，進而帶動水分吸收', '濃度過高反而可能加重腹瀉'], parameters: [{ name: '氯化鈉', value: '2.6 公克／公升', note: '' }, { name: '無水葡萄糖', value: '13.5 公克／公升', note: '' }], concepts: ['口服補液鹽', '脫水'], claim_type: '教學示範', evidence_level: '高', evidence_note: '通行之標準配方' },
}

/** 摘要項目之全欄位(提示詞之 JSON 格式) */
const fullItem = (index, note) => ({ index, relevant: true, reason: '', conditions: [], verifiable: [], caveats: [], sample_period: '未載明', pros: [], cons: [], regime_dependency: [], counter_views: [], explore: [], ...note })

/** 修補:各案須修補之處(依題組之設計)與示範回覆之值(依原文更正;null＝刪除該行) */
const REPAIR_ORACLE = {
    rp01: { places: ['核心知識（第 3 行）'], values: ['浮充電壓約為 13.5 至 13.8 伏特'] },
    rp02: { places: ['關鍵參數（第 2 列）'], values: [{ name: 'MD5 十六進位長度', value: '32 個字元', note: '' }] },
    rp03: { places: ['標題'], values: ['海拔每升高約 300 公尺水的沸點約降 1 度'] },
    rp04: { places: ['一句話重點'], values: ['光速約每秒 30 萬公里，陽光約需 500 秒才到達地球'] },
    rp05: { places: ['概念'], values: [['TCP', '三次握手', '埠號']] },
    rp06: { places: ['內容類型'], values: ['教學示範'] },
    rp07: { places: ['證據等級'], values: ['中'] },
    rp08: { places: ['方法與步驟（第 1 行）'], values: ['以每分鐘 100 至 120 下之速率按壓'] },
    rp09: { places: ['適用條件與限制（第 1 行）'], values: [null] },
    rp10: { places: ['概念（第 3 個）'], values: [null] },
    rp11: { places: ['一句話重點'], values: ['番茄屬酸性食品，自製罐頭常加檸檬汁使 pH 值低於 4.6'] },
    rp12: { places: ['證據說明'], values: [null] },
    rh1: { places: ['概念', '核心知識（第 1 行）'], values: [['聲速', '溫度'], '溫度每升高攝氏 1 度，聲速約增加每秒 0.6 公尺'] },
    rh2: { places: ['關鍵參數（第 3 列）'], values: [{ name: '鋰離子電芯', value: '3.6 至 3.7 伏特', note: '標稱電壓' }] },
    rh3: { places: ['標題'], values: ['成人骨骼一般為 206 塊'] },
}

/** 各角色之示範回覆:(該頁之案) => 回覆 */
const ORACLE = {
    triage: (cases) => cases.map((c, i) => ({ index: i + 1, relevant: c.expect.relevant, reason: '依判準' })),
    summarize: (cases) => cases.map((c, i) => (c.expect.relevant ? fullItem(i + 1, ORACLE_NOTES[c.id]) : { index: i + 1, relevant: false, reason: '非知識', explore: [] })),
    repair: (cases) => ({ repairs: REPAIR_ORACLE[cases[0].id].values.map((value, k) => ({ no: k + 1, value })) }),
    faith: (cases) => ({ checks: cases.map((c, i) => ({ index: i + 1, verdict: c.expect.verdict, reason: '筆記之結論與原文對應處之比對說明' })) }),
    retag: (cases) => cases.map((c, i) => ({ index: i + 1, category: c.expect.category })),
}

/**
 * 替身調度層:以各角色之規劃(planBench)認出提示詞屬哪一頁,依 reply[角色](同頁之案, 模型) 或示範回覆作答;認不出之提示詞依 unknown(提示詞) 作答
 *   (未給回空陣列);fail[模型] 給了即該模型每次呼叫皆以該錯誤訊息失敗。回覆經 check 驗證(同正式調度層);記錄每次呼叫
 *
 * @param {Object} [o={}] 輸入 { reply:{ 角色 id: 函數 }, unknown:函數, plan:{ 角色 id: planBench 之設定 }, fail:{ 模型: 錯誤訊息 } }
 * @returns {Object} 回傳 { calls, callJson }
 */
function benchStub(o = {}) {
    const byPrompt = new Map()
    for (const role of SUMMARIZE_BENCH_ROLES) {
        const plan = planBench(role, o.plan?.[role.id] || {})
        const byId = new Map(plan.set.cases.map((c) => [c.id, c]))
        for (const p of plan.pages) byPrompt.set(p.prompt, { role: role.id, cases: p.ids.map((id) => byId.get(id)) })
    }
    const calls = []
    return {
        calls,
        callJson: async (prompt, check, callOpt) => {
            const model = callOpt?.spec?.use
            const hit = byPrompt.get(String(prompt))
            calls.push({ model, role: hit?.role || '', ids: hit ? hit.cases.map((c) => c.id) : [], prompt: String(prompt) })
            if (o.fail?.[model]) return { ok: false, data: null, error: o.fail[model], providerId: '', attempts: 1, skipped: false, errors: [] }
            const data = hit ? (o.reply?.[hit.role] || ORACLE[hit.role])(hit.cases, model) : (o.unknown ? o.unknown(String(prompt)) : [])
            let ok
            try {
                ok = check(data)
            }
            catch (e) {
                ok = `check 拋錯：${e.message}`
            }
            if (ok !== true) return { ok: false, data: null, error: 'OUTPUT_VALIDATION_FAILED', providerId: '', attempts: 1, skipped: false, errors: [`${model}:validation(0.0s)：${ok}`] }
            return { ok: true, data, error: '', providerId: `${model}#p`, attempts: 1, skipped: false, errors: [] }
        },
    }
}

/**
 * 直接呼叫角色之 verdictOf(該頁之第 i 案;domain 以預設詞彙建)
 *
 * @param {Object} role 輸入角色
 * @param {*} data 輸入回覆
 * @param {Array} cases 輸入同頁之案
 * @param {Integer} i 輸入案於頁內之位置(0 起)
 * @param {Object} [roleOpt={}] 輸入角色參數
 * @returns {Object} 回傳 verdictOf 之結果
 */
const verdictOf = (role, data, cases, i, roleOpt = {}) => role.verdictOf(data, cases[i], { index: i + 1, domain: role.domainOf(null), cases, roleOpt })

describe('unit-summarize-bench', function() {

    before(() => {
        fs.mkdirSync(TMP, { recursive: true })
    })

    after(() => {
        fs.rmSync(TMP, { recursive: true, force: true })
    })

    // ══════════════════════════ ①題組 ══════════════════════════
    describe('① 題組', function() {

        it('五份通用題組全數通過驗證:各 12～16 案、保留題 3～5 案;std／v 與角色相符;題組檔在 src/bench/cases/<角色>-generic.json', () => {
            assert.deepEqual(SUMMARIZE_BENCH_ROLES.map((r) => r.id), ['triage', 'summarize', 'repair', 'faith', 'retag'])
            for (const role of SUMMARIZE_BENCH_ROLES) {
                const set = SET[role.id]
                const n = set.cases.length
                const h = set.cases.filter((c) => c.holdout).length
                assert.ok(n >= 12 && n <= 16, `${role.id} 案數 ${n}`)
                assert.ok(h >= 3 && h <= 5, `${role.id} 保留題 ${h}`)
                assert.ok(role.std.includes(set.std), `${role.id} 之 std ${set.std}`)
                assert.equal(set.v, role.v, `${role.id} 之 v`)
                assert.equal(role.casesFile, SUMMARIZE_BENCH_CASES_FILES[role.id])
                assert.equal(path.relative(PKG, role.casesFile).replace(/\\/g, '/'), `src/bench/cases/${role.id}-generic.json`)
                assert.ok(set.cases.every((c) => typeof c.type === 'string' && c.type && typeof c.why === 'string' && c.why), `${role.id} 每案有題型與依據`)
            }
            assert.deepEqual(SUMMARIZE_BENCH_ROLES.map((r) => [r.name, [...r.std], r.v]), [
                ['預篩(triage)', ['SS5'], 1], ['摘要(summarize)', ['SS5'], 2], ['修補(repair)', ['SS2', 'SS4'], 1], ['忠實性(faith)', ['SS14'], 1], ['重標(retag)', ['SS9'], 1],
            ])
            // 應然分布:兩類皆有(全判同一類之模型不得通過)
            const kinds = (id) => [...new Set(SET[id].cases.map((c) => SUMMARIZE_BENCH_ROLES.find((r) => r.id === id).expectOf(c)))].sort()
            assert.deepEqual(kinds('triage'), ['irrelevant', 'relevant'])
            assert.deepEqual(kinds('summarize'), ['irrelevant', 'note-ok'])
            assert.deepEqual(kinds('repair'), ['fixed'], '修補之應然一律 fixed')
            assert.deepEqual(kinds('faith'), ['faithful', 'unfaithful'])
            assert.ok(kinds('retag').length >= 6, '重標之應然涵蓋多個類別')
            assert.deepEqual([...new Set(SET.retag.cases.map((c) => c.focus.reason))], ['add', 'retire', 'requeue'], '重標焦點涵蓋新增、退役、重排')
            assert.ok(SET.summarize.cases.every((c) => c.input.material.url === ''), '合成材料不給網址(url 為空字串)')
        })

        it('既有檢定標準題組之形狀相容:預篩(SS5 v1)、忠實性(SS14 v1)、重標(SS9 v1,focus 在頂層)、摘要(SS5 v2 之自帶材料案)可直接驗過;以樣本檔定位之案拒收並說明須轉檔;版本不符拒收', () => {
            const tri = { std: 'SS5', v: 1, note: '', cases: [{ id: 'x1', holdout: false, input: { title: '甲', sourceName: '乙', text: '丙' }, expect: { relevant: true }, why: 'w' }] }
            assert.equal(validateBenchCases(triageBenchRole, tri).cases.length, 1)
            const fai = { std: 'SS14', v: 1, cases: [{ id: 'f1', input: { title: '甲', material: '甲\n丙', note: { title: '丁', summary: '戊' } }, expect: { verdict: 'faithful' }, why: 'w' }] }
            assert.equal(validateBenchCases(faithBenchRole, fai).cases.length, 1)
            const ret = { std: 'SS9', v: 1, cases: [{ id: 'r1', holdout: true, focus: { reason: 'add', category: '資料與指標' }, input: { title: '甲', category: '其他', summary: '乙', points: ['丙'] }, expect: { category: '資料與指標' }, why: 'w' }] }
            assert.equal(validateBenchCases(retagBenchRole, ret).cases[0].focus.reason, 'add')
            const mat = { title: '甲', sourceName: '乙', url: '', text: '丙' }
            const sum = { std: 'SS5', v: 2, excluded: [{ id: 'z', why: '兩可' }], cases: [{ id: 'K01', input: { docId: 'abc', material: mat }, expect: { relevant: true }, why: 'w' }] }
            assert.equal(validateBenchCases(summarizeBenchRole, sum).cases.length, 1, '自帶材料案(含 docId)可直接讀;excluded 不影響')
            const fx = { ...sum, cases: [...sum.cases, { id: 'E1-d1', input: { fixture: 'E1', doc: 1, url: '' }, expect: { relevant: true }, why: 'w' }] }
            assert.match(msgOf(() => validateBenchCases(summarizeBenchRole, fx)), /cases\[1\]\(E1-d1\) 以樣本檔定位之案\(input\.fixture\)須先轉為自帶材料/)
            assert.match(msgOf(() => validateBenchCases(summarizeBenchRole, { ...sum, v: 1 })), /題組之 v「1」非本角色所讀之題組版本（2）/)
            assert.match(msgOf(() => validateBenchCases(triageBenchRole, { ...tri, std: 'SS9' })), /題組之 std「SS9」非本角色之標準（SS5）/)
            assert.match(msgOf(() => validateBenchCases(repairBenchRole, { std: 'SS5', cases: SET.repair.cases })), /非本角色之標準（SS2、SS4）/)
        })

        it('各角色之逐案檢核:缺欄、應然非法、材料首行非原文標題、修補項目不合格式或應然非 fixed、重標焦點與工作範圍不合、自帶詞彙不合 → 任何呼叫之前拋錯並列出全部問題', () => {
            const bad = (role, cases) => msgOf(() => validateBenchCases(role, cases)) || ''
            const t = bad(triageBenchRole, [{ id: 'a', input: { text: 1 }, expect: { relevant: 'yes' }, why: 'w' }])
            for (const p of [/缺 input\.title/, /缺 input\.text/, /expect\.relevant 須為布林/]) assert.match(t, p)
            const s = bad(summarizeBenchRole, [{ id: 'a', input: { material: { title: '', text: ' ', sourceName: 1 } }, expect: {}, why: 'w' }])
            for (const p of [/material\.title 須為非空字串/, /material\.text 須為非空字串/, /material\.sourceName 須為字串/, /material\.url 須為字串/, /expect\.relevant 須為布林/]) assert.match(s, p)
            const item = { title: '甲', key_points: ['乙'], concepts: ['丙'] }
            const r = bad(repairBenchRole, [
                { id: 'a', input: { title: '甲', material: '別的標題\n內文', item }, expect: { fixed: true }, why: 'w' },
                { id: 'b', input: { title: '甲', material: '甲\n內文', item: { title: '甲', key_points: [], concepts: ['丙'] } }, expect: { fixed: false }, why: 'w' },
            ])
            for (const p of [/cases\[0\]\(a\) input\.material 須以原文標題為首行/, /cases\[1\]\(b\) input\.item 須合輸出格式/, /cases\[1\]\(b\) expect\.fixed 須為 true/]) assert.match(r, p)
            const f = bad(faithBenchRole, [{ id: 'a', input: { title: '甲', material: '甲\n乙' }, expect: { verdict: 'maybe' }, why: 'w' }])
            for (const p of [/缺 input\.note/, /expect\.verdict 須為 faithful／unfaithful／unsure/]) assert.match(f, p)
            const g = bad(retagBenchRole, [
                { id: 'a', focus: { reason: 'move', category: '甲' }, input: { title: '甲', category: '其他', summary: '' }, expect: { category: '其他' }, why: 'w' },
                { id: 'b', focus: { reason: 'add', category: '資料與指標' }, input: { title: '甲', category: '資料與指標', summary: '', points: [1] }, expect: { category: '其他' }, why: 'w' },
                { id: 'c', focus: { reason: 'retire', category: '應用與案例' }, input: { title: '甲', category: '其他', summary: '' }, expect: { category: '其他' }, why: 'w' },
            ])
            for (const p of [/cases\[0\]\(a\) focus 須為 \{ reason:add\|retire\|requeue, category \}/, /cases\[1\]\(b\) input\.points 須為字串陣列/, /cases\[1\]\(b\) 新增類別之工作不含已屬該類別之筆記/, /cases\[2\]\(c\) retire 之工作只含原類別＝焦點類別之筆記/]) assert.match(g, p)
            const v = bad(triageBenchRole, [{ id: 'a', input: { title: '甲', text: '乙', vocab: { bogus: 1 } }, expect: { relevant: true }, why: 'w' }])
            assert.match(v, /input\.vocab 不合：vocab 含不認得之鍵：bogus/)
        })
    })

    // ══════════════════════════ ②分頁與提示詞 ══════════════════════════
    describe('② 分頁與提示詞(與正式 domain 逐字同)', function() {

        it('預篩:16 案一頁(每頁 summarize.triage.docsPerCall＝20);roleOpt.batch 5 → 5／5／5／1;提示詞＝正式預篩 domain(預設之片段字數與長文門檻)之 buildPrompt(各案之 input)', () => {
            assert.equal(SUMMARIZE_DEFAULT.triage.docsPerCall, 20)
            const plan = planSummarizeBench('triage')
            assert.deepEqual(plan.pages.map((p) => p.ids.length), [16])
            const d = createTriageDomain({ vocab: null, triageCharsPerDoc: SUMMARIZE_DEFAULT.triage.charsPerDoc, longDocChars: SUMMARIZE_DEFAULT.charsPerDoc })
            assert.equal(plan.pages[0].prompt, d.buildPrompt(SET.triage.cases.map((c) => c.input)))
            assert.equal(plan.pages[0].prompt, createTriageDomain().buildPrompt(SET.triage.cases.map((c) => c.input)), '預設之建構參數同 domain 之預設')
            assert.match(plan.pages[0].prompt, /^你是知識庫的預篩器。以下 16 篇只給標題、來源與開頭片段/)
            const p5 = planSummarizeBench('triage', { roleOpt: { batch: 5 } })
            assert.deepEqual(p5.pages.map((p) => p.ids.length), [5, 5, 5, 1])
            assert.equal(p5.pages[3].prompt, d.buildPrompt([SET.triage.cases[15].input]))
            assert.notEqual(p5.promptFp, plan.promptFp, '分頁一改指紋即不同')
            assert.match(msgOf(() => planSummarizeBench('triage', { roleOpt: { batch: 0 } })), /roleOpt\.batch 須為正整數/)
        })

        it('摘要:依字數打包同正式(packDocsByChars;每頁至多 3 篇、字數 ≤ 3×6000,長文獨佔一頁並截至上限);提示詞＝正式摘要 domain 之 buildPrompt(該頁文件, [], { budgets });roleOpt.docsPerCall／charsPerDoc 生效', () => {
            const plan = planSummarizeBench('summarize')
            assert.deepEqual(plan.pages.map((p) => p.ids), [['k01', 'n01', 'k02'], ['k03', 'k04', 'n02'], ['n03', 'k05', 'k06'], ['k07', 'n04', 'h1'], ['h2', 'h3', 'h4']])
            const d = createSummarizeDomain({ vocab: null, summarizeCharsPerDoc: SUMMARIZE_DEFAULT.charsPerDoc })
            const docOf = (c) => ({ id: c.id, ...c.input.material })
            const { batches, budgets } = packDocsByChars(SET.summarize.cases.map(docOf), { batchSize: SUMMARIZE_DEFAULT.docsPerCall, charsPerDoc: SUMMARIZE_DEFAULT.charsPerDoc })
            assert.deepEqual(batches.map((b) => b.map((x) => x.id)), plan.pages.map((p) => p.ids), '分頁＝正式之打包')
            batches.forEach((b, k) => assert.equal(plan.pages[k].prompt, d.buildPrompt(b, [], { budgets: b.map((x) => budgets.get(x.id)) }), `第 ${k + 1} 頁`))
            assert.match(plan.pages[0].prompt, /^你是知識庫的萃取器。請閱讀以下 3 篇資料/)
            assert.doesNotMatch(plan.pages[0].prompt, /下列是知識庫既有的概念標籤/, '概念詞彙為空(新庫)')
            // 長文:獨佔一頁並截至每頁字數上限(與正式同一規則);短文同頁
            const mat = (id, text) => ({ id, input: { material: { title: `標題${id}`, sourceName: '來源', url: '', text } }, expect: { relevant: true }, why: 'w' })
            const longText = `${'甲'.repeat(18000)}${'乙'.repeat(2000)}`
            const cases = [mat('s1', '短'.repeat(1000)), mat('s2', '文'.repeat(1000)), mat('L', longText), mat('s3', '末'.repeat(1000))]
            const lp = planSummarizeBench('summarize', { cases })
            assert.deepEqual(lp.pages.map((p) => p.ids), [['s1', 's2'], ['L'], ['s3']])
            assert.ok(lp.pages[1].prompt.includes('甲'.repeat(18000)) && !lp.pages[1].prompt.includes('乙'), '長文截至 18000 字')
            assert.equal(lp.pages[1].prompt, d.buildPrompt([docOf(cases[2])], [], { budgets: [18000] }))
            const p2 = planSummarizeBench('summarize', { roleOpt: { docsPerCall: 2 } })
            assert.deepEqual(p2.pages.map((p) => p.ids.length), [2, 2, 2, 2, 2, 2, 2, 1])
            const pc = planSummarizeBench('summarize', { cases, roleOpt: { charsPerDoc: 500 } })
            assert.deepEqual(pc.pages.map((p) => p.ids), [['s1'], ['s2'], ['L'], ['s3']], '每頁字數上限 3×500＝1500:千字之短文各自一頁')
            assert.ok(pc.pages[2].prompt.includes('甲'.repeat(1500)) && !pc.pages[2].prompt.includes('甲'.repeat(1501)))
        })

        it('修補:一頁一案;提示詞＝正式 buildRepairPrompt({ material, item:正規化後之項目, problems:repairProblemsOf });各案須修補之處同題組之設計;無須修補之案 → 任何呼叫之前拋錯', () => {
            const plan = planSummarizeBench('repair')
            assert.deepEqual(plan.pages.map((p) => p.ids), SET.repair.cases.map((c) => [c.id]))
            const d = createSummarizeDomain()
            plan.pages.forEach((p) => {
                const c = caseOf('repair', p.ids[0])
                const n0 = normalizeNoteItem({ ...c.input.item, index: 1, relevant: true }, { vocab: d.vocab, knownConcept: () => false })
                const problems = repairProblemsOf(n0.item, { vocab: d.vocab, material: c.input.material })
                assert.deepEqual(problems.map(fieldPlaceOf), REPAIR_ORACLE[c.id].places, `${c.id} 之須修補之處`)
                assert.equal(p.prompt, d.buildRepairPrompt({ material: c.input.material, item: n0.item, problems }), `${c.id} 之提示詞`)
            })
            assert.ok(plan.pages.every((p) => p.prompt.includes('【需更正之處】')))
            const clean = { ...caseOf('repair', 'rp01'), id: 'ok1', input: { ...caseOf('repair', 'rp01').input, item: { ...caseOf('repair', 'rp01').input.item, key_points: ['每個單電池之標稱電壓約 2 伏特'] } } }
            assert.match(msgOf(() => planSummarizeBench('repair', { cases: [clean] })), /修補之案 ok1 依現行詞彙與原文無須修補之處/)
        })

        it('忠實性:每頁 10 案(15 → 10／5);提示詞＝正式 buildFaithCheckPrompt({ items:[{ index, title, material, noteText:faithNoteText(note) }] })(同正式覆核之項)', () => {
            const plan = planSummarizeBench('faith')
            assert.deepEqual(plan.pages.map((p) => p.ids.length), [10, 5])
            const d = createSummarizeDomain()
            let at = 0
            for (const p of plan.pages) {
                const cs = SET.faith.cases.slice(at, at + p.ids.length)
                at += p.ids.length
                assert.equal(p.prompt, d.buildFaithCheckPrompt({ items: cs.map((c, j) => ({ index: j + 1, title: c.input.title, material: c.input.material, noteText: faithNoteText(c.input.note) })) }))
            }
            assert.match(plan.pages[0].prompt, /^你是知識庫的忠實性核對員/)
            assert.deepEqual(planSummarizeBench('faith', { roleOpt: { batch: 4 } }).pages.map((p) => p.ids.length), [4, 4, 4, 3])
        })

        it('重標:同焦點之案同頁(新增 8、退役 4、重排 4);batch 3 → 3／3／2、3／1、3／1;提示詞＝正式重標 domain 之 buildPrompt(items, { focus });焦點或應然與詞彙不合 → 任何呼叫之前拋錯', () => {
            const plan = planSummarizeBench('retag')
            assert.deepEqual(plan.pages.map((p) => p.ids.length), [8, 4, 4])
            const d = createRetagDomain()
            for (const p of plan.pages) {
                const cs = p.ids.map((id) => caseOf('retag', id))
                assert.ok(cs.every((c) => c.focus.reason === cs[0].focus.reason && c.focus.category === cs[0].focus.category), '同頁同焦點')
                assert.equal(p.prompt, d.buildPrompt(cs.map((c) => c.input), { focus: cs[0].focus }))
            }
            assert.match(plan.pages[0].prompt, /本次分類清單新增了「資料與指標」：請判斷各篇是否更適合歸入「資料與指標」/)
            assert.match(plan.pages[1].prompt, /「應用與案例」已自分類清單移除：各篇須改選分類清單中之類別。/)
            assert.doesNotMatch(plan.pages[2].prompt, /本次分類清單新增了|已自分類清單移除/, '重排無焦點句(同正式)')
            assert.deepEqual(planSummarizeBench('retag', { roleOpt: { batch: 3 } }).pages.map((p) => p.ids.length), [3, 3, 2, 3, 1, 3, 1])
            // 焦點與詞彙之一致:新增之類別不在清單、退役之類別仍在清單、應然不在清單、新增類別之工作中非落點筆記之應然不可達
            const one = (over) => [{ id: 'z', focus: { reason: 'add', category: '資料與指標' }, input: { title: '甲', category: '其他', summary: '乙' }, expect: { category: '資料與指標' }, why: 'w', ...over }]
            assert.match(msgOf(() => planSummarizeBench('retag', { cases: one({ focus: { reason: 'add', category: '新類' } }) })), /焦點 add 之類別「新類」不在分類清單/)
            assert.match(msgOf(() => planSummarizeBench('retag', { cases: one({ focus: { reason: 'retire', category: '其他' }, expect: { category: '原理與概念' } }) })), /焦點 retire 之類別「其他」仍在分類清單/)
            assert.match(msgOf(() => planSummarizeBench('retag', { cases: one({ expect: { category: '不存在' } }) })), /案 z 之應然類別「不存在」不在分類清單/)
            assert.match(msgOf(() => planSummarizeBench('retag', { cases: one({ input: { title: '甲', category: '原理與概念', summary: '乙' }, expect: { category: '方法與技術' } }) })), /案 z 之應然「方法與技術」不可達/)
        })
    })

    // ══════════════════════════ ③逐案類別 ══════════════════════════
    describe('③ 逐案類別', function() {

        it('示範回覆(各案之應然答案)→ 五角色逐案每回皆通過、合契約率 100%:應然可達(知識文件之示範筆記過納入閘、修補案之示範回覆修得好);呼叫數＝頁數×回數', async () => {
            const stub = benchStub()
            const want = { triage: 2, summarize: 10, repair: 30, faith: 4, retag: 6 }
            for (const role of SUMMARIZE_BENCH_ROLES) {
                const before = stub.calls.length
                const r = await runSummarizeBench(role.id, { models: ['good'], aiAdapter: stub, clock: FIXED })
                const m = r.models[0]
                assert.deepEqual(m.cases.filter((c) => !c.pass).map((c) => `${c.id}：${c.note}`), [], `${role.id} 未通過之案`)
                assert.equal(m.score.pass, SET[role.id].cases.length)
                assert.equal(m.contract.rate, 1, `${role.id} 合契約率`)
                assert.equal(stub.calls.length - before, want[role.id], `${role.id} 之呼叫數`)
                assert.equal(r.meta.promptFp, planSummarizeBench(role.id).promptFp, '指紋＝實際送出之提示詞')
            }
            assert.ok(stub.calls.every((c) => c.role && c.model === 'good'), '每次呼叫之提示詞皆為規劃之頁;席位只放受測模型')
            // 摘要之示範筆記確實過閘(而非恰被逐條移除救回):逐條移除 0
            const r = await runSummarizeBench('summarize', { models: ['good'], aiAdapter: benchStub(), clock: FIXED, runs: 1 })
            const okCases = r.models[0].cases.filter((c) => c.expect === 'note-ok')
            assert.equal(okCases.length, 9)
            assert.ok(okCases.every((c) => c.runs[0].gate === '合格' && c.runs[0].removed === 0), JSON.stringify(okCases.map((c) => [c.id, c.runs[0].removed])))
        })

        it('預篩:判錯 → 不通過;relevant 非布林 → 無裁決(不合契約);缺項 → 無裁決;同 index 重複取第一個合格式者;非陣列 → 無裁決', () => {
            const cs = SET.triage.cases
            assert.deepEqual(verdictOf(triageBenchRole, [{ index: 1, relevant: false, reason: '快訊' }], cs, 0), { cls: 'irrelevant', valid: true, problem: '', fields: { relevant: false, reason: '快訊' } })
            const s = verdictOf(triageBenchRole, [{ index: 1, relevant: 'false' }], cs, 0)
            assert.deepEqual([s.cls, s.valid, s.problem], [null, false, 'index 1 之項不合輸出格式（relevant 須為布林）'])
            assert.equal(verdictOf(triageBenchRole, [{ index: 2, relevant: true }], cs, 0).problem, '回覆無 index 1 之項')
            assert.equal(verdictOf(triageBenchRole, [], cs, 0).problem, '回覆為空陣列')
            assert.equal(verdictOf(triageBenchRole, [{ index: 1, relevant: 'x' }, { index: 1, relevant: true }, { index: 1, relevant: false }], cs, 0).cls, 'relevant', '同 index 取第一個合格式者')
            assert.equal(verdictOf(triageBenchRole, { index: 1 }, cs, 0).problem, '回覆非 JSON 陣列（object）')
            assert.equal(verdictOf(triageBenchRole, [{ index: 17, relevant: true }], cs, 15).cls, null, 'index 須在頁內範圍')
        })

        it('摘要:知識判非知識 → irrelevant;一句話重點含原文沒有之數字 → note-bad(SS4,閘);概念 1 個 → note-bad(SS2,閘);擠標籤 → note-bad(SS6,組版後之筆記標準);清單行含原文沒有之數字 → 仍 note-ok(逐條移除);缺核心知識 → note-bad 且不合契約;無布林 relevant → 無裁決', () => {
            const page = ['k01', 'n01', 'k02'].map((id) => caseOf('summarize', id))
            const k01 = (over) => fullItem(1, { ...ORACLE_NOTES.k01, ...over })
            const v = (items, i = 0) => verdictOf(summarizeBenchRole, items, page, i)
            assert.equal(v([k01()]).cls, 'note-ok')
            assert.deepEqual(v([{ index: 1, relevant: false, reason: '只是物理講義' }]).fields, { relevant: false, noteTitle: '', gate: '', reasons: '', removed: 0, reason: '只是物理講義' })
            // 「130 千」不算(量級單位之末尾 0 視為四捨五入,原文 125.4 千焦即紮根——數字紮根之精度規則);「200 千」才是原文沒有之數字
            assert.equal(v([k01({ summary: '把 500 公克水由 20 度加熱到 80 度約需 130 千焦' })]).cls, 'note-ok')
            const ss4 = v([k01({ summary: '把 500 公克水由 20 度加熱到 80 度約需 200 千焦' })])
            assert.deepEqual([ss4.cls, ss4.valid, ss4.fields.gate], ['note-bad', true, 'SS4'])
            assert.match(ss4.fields.reasons, /一句話重點含原文沒有之數字（200 千）/)
            const ss2 = v([k01({ concepts: ['比熱'] })])
            assert.deepEqual([ss2.cls, ss2.fields.gate, ss2.fields.reasons], ['note-bad', 'SS2', '概念 1 個（須 2～6）'])
            const ss6 = v([k01({ concepts: ['比熱、熱容量', '熱量計算'] })])
            assert.deepEqual([ss6.cls, ss6.valid, ss6.fields.gate], ['note-bad', true, 'SS6'])
            assert.match(ss6.fields.reasons, /SS6 多概念擠一標籤「比熱、熱容量」/)
            const drop = v([k01({ key_points: [...ORACLE_NOTES.k01.key_points, '水在一大氣壓下之沸點為攝氏 100 度'] })])
            assert.deepEqual([drop.cls, drop.fields.gate, drop.fields.removed], ['note-ok', '合格', 1], '逐條移除後仍成立者照正式納入')
            assert.equal(summarizeBenchRole.detailOf({ cls: drop.cls, ...drop.fields }), '（逐條移除 1 處）')
            assert.equal(summarizeBenchRole.detailOf({ cls: ss4.cls, ...ss4.fields }), `（SS4：${ss4.fields.reasons}）`)
            const fmt = v([k01({ key_points: [] })])
            assert.deepEqual([fmt.cls, fmt.valid, fmt.fields.gate], ['note-bad', false, '格式'])
            assert.equal(v([{ index: 1, title: '甲' }]).problem, 'index 1 之項無布林之 relevant')
            assert.equal(v([{ index: 3, relevant: false }]).problem, '回覆無 index 1 之項')
            // 非知識判為知識(產出合格之筆記)→ note-ok,不符應然 irrelevant
            const fake = fullItem(2, { title: '大霧與公車延誤', summary: '大霧使能見度低於 200 公尺', key_points: ['公車班次延誤 10 至 20 分鐘'], concepts: ['大霧', '能見度'], claim_type: '觀點評論', evidence_level: '低', evidence_note: '' })
            assert.equal(v([fake], 1).cls, 'note-ok')
            // 同 index 重複(正式之部分接受):先未過閘者換下一項;先判非知識者即定;先已收而筆記標準不合格者即定(不再換)
            assert.equal(v([k01({ concepts: ['比熱'] }), k01()]).cls, 'note-ok')
            assert.equal(v([{ index: 1, relevant: false }, k01()]).cls, 'irrelevant')
            assert.equal(v([k01({ concepts: ['比熱、熱容量', '熱量計算'] }), k01()]).cls, 'note-bad')
            // 納入閘之關卡(直接呼叫)
            const d = createSummarizeDomain()
            const adm = benchAdmitNoteItem({ index: 1, relevant: true, title: '甲', summary: '乙', key_points: ['丙'], concepts: ['丁'], claim_type: '教學示範', evidence_level: '中' }, { domain: d, doc: { id: 'x', title: '甲', sourceName: '', url: '' }, material: '甲\n丙', count: 1 })
            assert.deepEqual([adm.ok, adm.stage, adm.std, adm.reasons], [false, 'gate', 'SS2', ['概念 1 個（須 2～6）']])
            assert.throws(() => benchAdmitNoteItem(k01(), { domain: { ...d, vocab: { evidenceLevels: ['高'] } }, doc: { id: 'x' }, material: '', count: 1 }), /須為 resolveSummarizeVocab 之產物/)
        })

        it('修補:不回修補(repairs 空)→ 每案皆 unfixed(題組之問題皆真實存在);刪除可刪之行 → fixed;刪除標題 → unfixed(SS2);no 越界 → 不合契約;回覆非 { repairs } → 無裁決', () => {
            for (const c of SET.repair.cases) {
                const r = verdictOf(repairBenchRole, { repairs: [] }, [c], 0)
                assert.deepEqual([r.cls, r.valid], ['unfixed', true], c.id)
                assert.ok(r.fields.left, `${c.id} 列出仍未合格之處`)
            }
            const rp01 = [caseOf('repair', 'rp01')]
            assert.equal(verdictOf(repairBenchRole, { repairs: [{ no: 1, value: null }] }, rp01, 0).cls, 'fixed', '刪除該行即算修好')
            const del = verdictOf(repairBenchRole, { repairs: [{ no: 1, value: null }] }, [caseOf('repair', 'rp03')], 0)
            assert.deepEqual([del.cls, del.fields.left], ['unfixed', 'SS2：缺標題'])
            const far = verdictOf(repairBenchRole, { repairs: [{ no: 2, value: '浮充電壓約為 13.5 至 13.8 伏特' }] }, rp01, 0)
            assert.deepEqual([far.cls, far.valid, far.fields.applied], ['unfixed', false, 0])
            assert.match(repairBenchRole.detailOf({ cls: far.cls, ...far.fields }), /^（移除含原文沒有之數字：key_points「浮充電壓約為 14\.5 至 15\.0 伏特」（14\.5、15\.0））$/)
            const still = verdictOf(repairBenchRole, { repairs: [{ no: 1, value: '浮充電壓約為 14.0 伏特' }] }, rp01, 0)
            assert.deepEqual([still.cls, still.fields.applied], ['unfixed', 1], '更正後仍不見於原文 → 逐條移除,不算修好')
            assert.equal(verdictOf(repairBenchRole, [], rp01, 0).problem, '回覆非 {"repairs":[…]} 物件（array）')
            assert.equal(verdictOf(repairBenchRole, { fixes: [] }, rp01, 0).cls, null)
        })

        it('忠實性:unsure 為合法裁決;unfaithful 之理由過短 → 缺票(無裁決);同編號矛盾 → 缺票;裁決不在清單 → 缺票;回覆非 { checks } 或缺項 → 無裁決', () => {
            const cs = SET.faith.cases.slice(0, 10)
            const v = (checks) => verdictOf(faithBenchRole, { checks }, cs, 1)
            assert.deepEqual(v([{ index: 2, verdict: 'unfaithful', reason: '筆記之一句話重點把原文之否定寫成肯定' }]).cls, 'unfaithful')
            assert.deepEqual([v([{ index: 2, verdict: 'unsure', reason: '' }]).cls, v([{ index: 2, verdict: 'unsure', reason: '' }]).valid], ['unsure', true])
            const short = v([{ index: 2, verdict: 'unfaithful', reason: '太短' }])
            assert.deepEqual([short.cls, short.valid], [null, false])
            assert.match(short.problem, /unfaithful 之理由過短或缺/)
            assert.match(v([{ index: 2, verdict: 'faithful', reason: '' }, { index: 2, verdict: 'unfaithful', reason: '筆記之一句話重點把原文之否定寫成肯定' }]).problem, /同編號 2 之裁決互相矛盾/)
            assert.match(v([{ index: 2, verdict: 'maybe', reason: '' }]).problem, /裁決「maybe」非 faithful／unfaithful／unsure/)
            assert.equal(v([{ index: 3, verdict: 'faithful', reason: '' }]).problem, '回覆無 index 2 之裁決')
            assert.equal(verdictOf(faithBenchRole, [], cs, 1).problem, '回覆非 {"checks":[…]} 物件（array）')
            assert.equal(v([{ index: '2', verdict: 'FAITHFUL', reason: '' }]).cls, 'faithful', '編號與裁決之寬鬆寫法同正式單票驗證')
        })

        it('重標:新增類別之工作,非落點筆記之平移 → retagTargetOf 維持原類別(仍通過);改歸新類別而應然維持者 → 不通過;類別不在清單或回覆退役類別 → 無裁決', () => {
            const add = SET.retag.cases.filter((c) => c.focus.reason === 'add')
            const lateral = verdictOf(retagBenchRole, add.map((c, i) => ({ index: i + 1, category: i === 2 ? '方法與技術' : c.expect.category })), add, 2)
            assert.deepEqual([lateral.cls, lateral.fields.replied], ['原理與概念', '方法與技術'])
            assert.match(retagBenchRole.detailOf({ cls: lateral.cls, ...lateral.fields }), /回覆「方法與技術」：新增類別之工作不採非落點筆記之平移，維持原類別/)
            assert.equal(verdictOf(retagBenchRole, [{ index: 3, category: '資料與指標' }], add, 2).cls, '資料與指標', '改歸新類別照採(應然為維持者即不通過)')
            assert.equal(verdictOf(retagBenchRole, [{ index: 1, category: '方法與技術' }], add, 0).cls, '方法與技術', '落點筆記可改選任一類別')
            assert.match(verdictOf(retagBenchRole, [{ index: 1, category: '不存在' }], add, 0).problem, /index 1 之類別「不存在」不在分類清單/)
            const ret = SET.retag.cases.filter((c) => c.focus.reason === 'retire')
            assert.equal(verdictOf(retagBenchRole, [{ index: 1, category: '應用與案例' }], ret, 0).cls, null, '退役之類別不在清單')
            assert.equal(verdictOf(retagBenchRole, { index: 1 }, ret, 0).problem, '回覆非 JSON 陣列（object）')
        })

        it('錯誤回覆經 runBench:判錯之案逐回列原因、他案照常;同一模型兩回不一致不通過', async () => {
            let k = 0
            const flip = (cases) => cases.map((c, i) => ({ index: i + 1, relevant: c.id === 't01' ? (k++ % 2 === 0) : c.expect.relevant, reason: '依判準' }))
            const r = await runSummarizeBench('triage', { models: ['m'], aiAdapter: benchStub({ reply: { triage: flip } }), clock: FIXED })
            const m = r.models[0]
            assert.equal(m.score.pass, 15)
            const t01 = m.cases.find((c) => c.id === 't01')
            assert.deepEqual([t01.pass, t01.consistent], [false, false])
            assert.match(t01.note, /^第 1 回判 relevant（依判準），應然 irrelevant；各回不一致$/)
        })
    })

    // ══════════════════════════ ④詞彙注入與命令列 ══════════════════════════
    describe('④ 詞彙注入與命令列', function() {

        it('opt.vocab:提示詞隨詞彙改變(kbLabel 進首句、domain 進範圍句)且指紋不同;詞彙不合 → 任何呼叫之前拋錯;重標之分類清單換掉而應然不在清單 → 拋錯', () => {
            const vocab = { kbLabel: '天文學知識庫', domain: '天文學' }
            const heads = { triage: '你是天文學知識庫的預篩器', summarize: '你是天文學知識庫的萃取器', repair: '你是天文學知識庫的萃取器', faith: '你是天文學知識庫的忠實性核對員', retag: '你是天文學知識庫的分類器' }
            for (const role of SUMMARIZE_BENCH_ROLES) {
                const p = planSummarizeBench(role.id, { vocab })
                assert.ok(p.pages.every((x) => x.prompt.startsWith(heads[role.id])), role.id)
                assert.notEqual(p.promptFp, planSummarizeBench(role.id).promptFp, `${role.id} 指紋`)
            }
            assert.match(planSummarizeBench('triage', { vocab }).pages[0].prompt, /本知識庫之主題範圍為「天文學」：與此主題無關者判 false。/)
            assert.match(msgOf(() => planSummarizeBench('faith', { vocab: { relationTypes: ['相關'] } })), /runSummarizeBench\(faith\) 之 vocab 不合：vocab 含不認得之鍵：relationTypes/)
            assert.match(msgOf(() => planSummarizeBench('retag', { vocab: { categories: ['甲', '其他'] } })), /重標之題組與詞彙不合（\d+ 項）：焦點 add 之類別「資料與指標」不在分類清單/)
            // 程式端可注入同一工廠之產物(覆寫提示詞者):domain 直給;或 vocab＋domainOf(核心:domainOf 只用於 vocab 與案自帶之詞彙)
            const prompts = { faith: (input, ctx) => `${ctx.defaultPrompt(input)}\n（附註）` }
            assert.ok(planSummarizeBench('faith', { domain: createSummarizeDomain({ prompts }) }).pages.every((x) => x.prompt.endsWith('（附註）')))
            const viaOf = planSummarizeBench('faith', { vocab, domainOf: (v) => createSummarizeDomain({ vocab: v, prompts }) })
            assert.ok(viaOf.pages.every((x) => x.prompt.startsWith(heads.faith) && x.prompt.endsWith('（附註）')))
        })

        it('--role 解析:預設 all(依序五角色);--role x／--role=x;缺值、重複、不認得 → 拋;all 配 --cases 或角色專屬參數 → 拋;--help 不驗;用法說明列出五角色與其參數', () => {
            const a = parseSummarizeBenchArgs([])
            assert.deepEqual([a.role, a.roles.map((r) => r.id), a.rest, a.help], ['all', ['triage', 'summarize', 'repair', 'faith', 'retag'], [], false])
            assert.deepEqual(parseSummarizeBenchArgs(['--runs', '1', '--role', 'faith']).rest, ['--runs', '1'])
            assert.equal(parseSummarizeBenchArgs(['--role=retag']).roles[0], retagBenchRole)
            assert.equal(summarizeBenchRoleOf('repair'), repairBenchRole)
            assert.match(msgOf(() => parseSummarizeBenchArgs(['--role'])), /^--role 缺值$/)
            assert.match(msgOf(() => parseSummarizeBenchArgs(['--role', '--runs', '1'])), /^--role 缺值$/)
            assert.match(msgOf(() => parseSummarizeBenchArgs(['--role', 'faith', '--role=retag'])), /^--role 重複給定$/)
            assert.match(msgOf(() => parseSummarizeBenchArgs(['--role', 'nope'])), /不認得之評分角色：nope（可用：triage、summarize、repair、faith、retag、all）/)
            assert.match(msgOf(() => parseSummarizeBenchArgs(['--cases', 'x.json'])), /--role all 不可給 --cases/)
            assert.match(msgOf(() => parseSummarizeBenchArgs(['--role', 'all', '--batch', '5', '--docs-per-call=2'])), /--role all 不可給角色專屬參數 --batch、--docs-per-call/)
            assert.deepEqual(parseSummarizeBenchArgs(['--role', 'nope', '-h']).help, true)
            for (const r of SUMMARIZE_BENCH_ROLES) assert.ok(SUMMARIZE_BENCH_USAGE.includes(`【${r.name}】`) && SUMMARIZE_BENCH_USAGE.includes(`node src/bench/cli.mjs --role ${r.id}`), r.id)
            assert.match(SUMMARIZE_BENCH_USAGE, /^用法：node src\/bench\/cli\.mjs \[--role <triage\|summarize\|repair\|faith\|retag\|all>\]/)
            assert.match(SUMMARIZE_BENCH_USAGE, /--batch <n>/)
            assert.match(SUMMARIZE_BENCH_USAGE, /--docs-per-call <n>/)
        })

        it('命令列單一角色:--vocab 詞彙檔進提示詞;角色專屬參數經 roleOpt 改變分頁;報表與進度檔以角色 id 為檔名主幹;--help 印用法', async () => {
            const vf = path.join(TMP, 'vocab.json')
            fs.writeFileSync(vf, JSON.stringify({ kbLabel: '天文學知識庫' }), 'utf8')
            const out = path.join(TMP, 'cli-single')
            const log = plainLog()
            const stub = benchStub()
            const res = await runSummarizeBenchCli(['--role', 'faith', '--models', 'm', '--vocab', vf, '--runs', '1', '--out', out], { aiAdapter: stub, log })
            assert.equal(res.role, 'faith')
            assert.deepEqual(res.runs.map((x) => x.role), ['faith'])
            assert.ok(stub.calls.length === 2 && stub.calls.every((c) => c.prompt.startsWith('你是天文學知識庫的忠實性核對員')), '詞彙檔之稱呼進入提示詞')
            const stamp = res.runs[0].result.meta.stamp
            assert.deepEqual(Object.values(res.runs[0].report.files).map((f) => path.basename(f)), [`faith-bench-${stamp}-models.csv`, `faith-bench-${stamp}-cases.csv`, `faith-bench-${stamp}.md`, `faith-bench-${stamp}.json`])
            assert.equal(path.basename(res.runs[0].progressFile), `faith-bench-${stamp}.progress.jsonl`)
            assert.ok(log.lines.some((l) => l.startsWith('筆記忠實性覆核 AI 能力評分：1 個模型 × 15 案 × 1 回（題組 SS14 v1')))
            const st2 = benchStub()
            await runSummarizeBenchCli(['--role', 'triage', '--batch', '5', '--models', 'm', '--runs', '1', '--out', out], { aiAdapter: st2, log: plainLog() })
            assert.equal(st2.calls.length, 4, '--batch 5 → 16 案 4 頁')
            const st3 = benchStub()
            await runSummarizeBenchCli(['--role', 'summarize', '--docs-per-call', '5', '--models', 'm', '--runs', '1', '--out', out], { aiAdapter: st3, log: plainLog() })
            assert.equal(st3.calls.length, 3, '--docs-per-call 5 → 15 案 3 頁')
            const hl = plainLog()
            assert.deepEqual(await runSummarizeBenchCli(['--help'], { log: hl }), { help: true })
            assert.equal(hl.lines[0], SUMMARIZE_BENCH_USAGE)
        })

        it('--role all:五角色依序執行,逐角色報表;評比表(--board)五角色之列並存且同一表頭;再跑單一角色只覆蓋該角色之列', async () => {
            const out = path.join(TMP, 'cli-all')
            const board = path.join(TMP, 'board', '模型評比.csv')
            const log = plainLog()
            const stub = benchStub()
            const res = await runSummarizeBenchCli(['--role', 'all', '--models', 'good', '--runs', '1', '--out', out, '--board', board], { aiAdapter: stub, log })
            assert.deepEqual(res.runs.map((x) => x.role), ['triage', 'summarize', 'repair', 'faith', 'retag'])
            assert.deepEqual([...new Set(stub.calls.map((c) => c.role))], ['triage', 'summarize', 'repair', 'faith', 'retag'], '依序執行')
            assert.ok(log.lines.some((l) => l === '── 角色 1/5：預篩(triage) ──') && log.lines.some((l) => l === '── 角色 5/5：重標(retag) ──'))
            for (const run of res.runs) for (const f of Object.values(run.report.files)) assert.ok(fs.statSync(f).size > 0, f)
            const rows = () => parseCsv(fs.readFileSync(board, 'utf8'))
            assert.equal(rows()[0].join(','), BENCH_BOARD_HEADER.join(','))
            assert.deepEqual(rows().slice(1).map((r) => [r[0], r[1], r[2], r[3]]).sort(), SUMMARIZE_BENCH_ROLES.map((r) => [r.name, 'good', String(SET[r.id].cases.length), String(SET[r.id].cases.length)]).sort())
            const before = Object.fromEntries(rows().slice(1).map((r) => [r[0], r.join(',')]))
            // 再跑單一角色(預篩判錯一案):只覆蓋預篩之列,他角色之列原樣
            const wrong = (cases) => cases.map((c, i) => ({ index: i + 1, relevant: c.id === 't01' ? true : c.expect.relevant, reason: '依判準' }))
            await runSummarizeBenchCli(['--role', 'triage', '--models', 'good', '--runs', '1', '--out', out, '--board', board], { aiAdapter: benchStub({ reply: { triage: wrong } }), log: plainLog() })
            const after = rows().slice(1)
            assert.equal(after.length, 5)
            const tri = after.find((r) => r[0] === triageBenchRole.name)
            assert.deepEqual([tri[2], tri[10]], ['15', 't01'])
            for (const r of after.filter((x) => x[0] !== triageBenchRole.name)) assert.equal(r.join(','), before[r[0]])
        })

        it('--role all:前面角色已停測之模型(限流)不再於後續角色受測(--models 兩種寫法皆換);受測模型皆已停測即略過其餘角色', async () => {
            const out = path.join(TMP, 'cli-stop')
            const LIMIT = 'FreeUsageLimitError: Rate limit exceeded'
            const stub = benchStub({ fail: { limited: LIMIT } })
            const log = plainLog()
            const res = await runSummarizeBenchCli(['--models=good,limited', '--runs', '1', '--out', out], { aiAdapter: stub, log })
            assert.deepEqual(res.runs.map((x) => x.role), ['triage', 'summarize', 'repair', 'faith', 'retag'])
            assert.deepEqual([res.stopped, res.skipped], [['limited'], []])
            assert.match(res.runs[0].result.models.find((m) => m.model === 'limited').stopped, /^額度用盡或限流，停測/)
            assert.equal(stub.calls.filter((c) => c.model === 'limited').length, 1, '限流後不再呼叫')
            assert.deepEqual(res.runs.map((x) => x.result.models.map((m) => m.model)), [['good', 'limited'], ['good'], ['good'], ['good'], ['good']])
            assert.ok(res.runs.slice(1).every((x) => x.result.models[0].score.pass === x.result.models[0].score.total), '他模型照跑')
            assert.ok(log.lines.some((l) => l === '── 角色 2/5：摘要(summarize)（已停測不再受測：limited） ──'))
            const both = benchStub({ fail: { a: LIMIT, b: LIMIT } })
            const lg = plainLog()
            const res2 = await runSummarizeBenchCli(['--models', 'a,b', '--runs', '1', '--out', out], { aiAdapter: both, log: lg })
            assert.deepEqual([res2.runs.map((x) => x.role), res2.skipped], [['triage'], ['summarize', 'repair', 'faith', 'retag']])
            assert.equal(both.calls.length, 2)
            assert.ok(lg.lines.some((l) => /^── 其餘角色（summarize、repair、faith、retag）略過：受測模型皆已停測（a、b）──$/.test(l)))
            // 單一角色不涉此規則
            const one = await runSummarizeBenchCli(['--role', 'faith', '--models', 'limited', '--runs', '1', '--out', out], { aiAdapter: benchStub({ fail: { limited: LIMIT } }), log: plainLog() })
            assert.deepEqual([one.runs.length, one.stopped, one.skipped], [1, ['limited'], []])
        })

        it('--role all 之準備期:後面角色之錯誤(詞彙使重標之應然不在清單、詞彙檔不存在或非物件)於任何呼叫與寫檔之前拋出', async () => {
            const vf = path.join(TMP, 'vocab-cats.json')
            fs.writeFileSync(vf, JSON.stringify({ categories: ['甲', '其他'] }), 'utf8')
            const out = path.join(TMP, 'cli-pre')
            const stub = benchStub()
            await assert.rejects(runSummarizeBenchCli(['--models', 'm', '--vocab', vf, '--out', out], { aiAdapter: stub, log: plainLog() }), /重標之題組與詞彙不合/)
            await assert.rejects(runSummarizeBenchCli(['--models', 'm', '--vocab', path.join(TMP, 'none.json'), '--out', out], { aiAdapter: stub, log: plainLog() }), /--vocab 指定之詞彙檔不存在/)
            fs.writeFileSync(path.join(TMP, 'v-arr.json'), '[1]', 'utf8')
            await assert.rejects(runSummarizeBenchCli(['--models', 'm', '--vocab', path.join(TMP, 'v-arr.json'), '--out', out], { aiAdapter: stub, log: plainLog() }), /--vocab 詞彙檔須為 JSON 物件/)
            await assert.rejects(runSummarizeBenchCli(['--models', 'm', '--runs', '0', '--out', out], { aiAdapter: stub, log: plainLog() }), /--runs 須為正整數/)
            assert.equal(stub.calls.length, 0, '不燒任何呼叫')
            assert.ok(!fs.existsSync(out), '不建輸出目錄')
        })

        it('--vocab-pick:多段共用之詞彙表(含他段之鍵)→ 取本套件之鍵、子集檔寫入 --out 並以之評分;未給 --vocab-pick 者 → 準備期拋錯(不呼叫、不建目錄);--vocab-pick 帶值、重複或未配 --vocab → 拋', async () => {
            const vf = path.join(TMP, 'vocab-shared.json')
            fs.writeFileSync(vf, JSON.stringify({ kbLabel: '天文學知識庫', relationTypes: ['互補搭配', '衝突'], conflictType: '衝突' }), 'utf8')
            const out = path.join(TMP, 'cli-pick')
            const st0 = benchStub()
            await assert.rejects(runSummarizeBenchCli(['--role', 'faith', '--models', 'm', '--vocab', vf, '--runs', '1', '--out', out], { aiAdapter: st0, log: plainLog() }), /vocab 不合/)
            assert.deepEqual([st0.calls.length, fs.existsSync(out)], [0, false], '他段之鍵:不加 --vocab-pick 即拒收')
            const log = plainLog()
            const stub = benchStub()
            const res = await runSummarizeBenchCli(['--role', 'faith', '--vocab-pick', '--models', 'm', '--vocab', vf, '--runs', '1', '--out', out], { aiAdapter: stub, log })
            assert.deepEqual(res.runs.map((x) => x.role), ['faith'])
            assert.ok(stub.calls.length === 2 && stub.calls.every((c) => c.prompt.startsWith('你是天文學知識庫的忠實性核對員')), '子集之稱呼進入提示詞')
            const picked = fs.readdirSync(out).filter((f) => /^summarize-vocab-.+\.json$/.test(f))
            assert.equal(picked.length, 1)
            assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, picked[0]), 'utf8')), { kbLabel: '天文學知識庫' }, '子集只含本套件之鍵')
            assert.ok(log.lines.some((l) => l.startsWith(`--vocab-pick：自 ${vf} 取本套件之鍵（kbLabel）→ `)))
            assert.ok(log.lines.some((l) => l.includes(`，詞彙 ${path.join(out, picked[0])}）`)), '報表記之詞彙檔即子集檔')
            assert.match(msgOf(() => parseSummarizeBenchArgs(['--vocab-pick=1', '--vocab', vf])), /^--vocab-pick 不帶值/)
            assert.match(msgOf(() => parseSummarizeBenchArgs(['--vocab-pick', '--vocab-pick', '--vocab', vf])), /^--vocab-pick 重複給定$/)
            assert.match(msgOf(() => parseSummarizeBenchArgs(['--role', 'faith', '--vocab-pick'])), /^--vocab-pick 須配 --vocab/)
            assert.deepEqual([parseSummarizeBenchArgs(['--vocab-pick', `--vocab=${vf}`]).pick, parseSummarizeBenchArgs([]).pick], [true, false])
        })

        it('受測名單:預設席位(summarize.ai 之 use 與 fallback)在前,其餘為核心之免費名單(去重);命令列 --models 未給或 free 即用之;cli.mjs 為薄殼(被 import 時不執行,轉出同一個 runSummarizeBenchCli)', () => {
            const seat = [SUMMARIZE_DEFAULT.ai.use, ...SUMMARIZE_DEFAULT.ai.fallback]
            assert.deepEqual(SUMMARIZE_BENCH_MODELS.slice(0, seat.length), seat)
            assert.deepEqual([...SUMMARIZE_BENCH_MODELS].sort(), [...new Set([...seat, ...DEFAULT_FREE_MODELS])].sort())
            for (const r of SUMMARIZE_BENCH_ROLES) assert.deepEqual(r.models, SUMMARIZE_BENCH_MODELS)
            assert.deepEqual(parseSummarizeBenchArgs([]).roles.map((r) => r.models.length), SUMMARIZE_BENCH_ROLES.map(() => SUMMARIZE_BENCH_MODELS.length))
            assert.equal(cli.runSummarizeBenchCli, runSummarizeBenchCli)
            assert.equal(cli.default, runSummarizeBenchCli)
            // 另起行程只 import(不直接執行):無輸出、離開碼 0——被 import 時不跑命令列
            const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(path.join(SRC, 'bench', 'cli.mjs')).href)})`], { encoding: 'utf8' })
            assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''])
        })

        it('印出之命令列用法與題組路徑為套件佈局下實際可用之路徑(node src/bench/cli.mjs、src/bench/cases/…):各角色 cli.command 之腳本與 cli.casesHelp 之題組於套件根存在;直接執行 --help 之首行、各角色用法行、題組路徑與失敗時之錯誤訊息皆指向同一佈局', () => {
            // 規則:套件原始碼在 src/,命令列為 src/bench/cli.mjs、內建題組為 src/bench/cases/<角色 id>-generic.json;用法字串不得仍印佈局改動前之 node bench/cli.mjs 與 bench/cases/(該路徑於套件根不存在)
            for (const r of SUMMARIZE_BENCH_ROLES) {
                const m = r.cli.command.match(/^node (\S+\.mjs) --role (\S+)$/)
                assert.ok(m, `${r.id} 之 command 形狀:${r.cli.command}`)
                assert.deepEqual([m[1], m[2]], ['src/bench/cli.mjs', r.id])
                assert.ok(fs.existsSync(path.join(PKG, m[1])), `${r.id} 之 command 所指腳本須存在:${m[1]}`)
                const c = r.cli.casesHelp.match(/\((src\/bench\/cases\/\S+\.json)\)$/)
                assert.ok(c, `${r.id} 之 casesHelp 須以(src/bench/cases/…json)結尾:${r.cli.casesHelp}`)
                assert.equal(c[1], `src/bench/cases/${r.id}-generic.json`)
                assert.ok(fs.existsSync(path.join(PKG, c[1])), `${r.id} 之 casesHelp 所指題組須存在:${c[1]}`)
            }
            const cwd = path.join(TMP, 'cli-spawn')
            fs.mkdirSync(cwd, { recursive: true })
            const run = (args) => spawnSync(process.execPath, [path.join(SRC, 'bench', 'cli.mjs'), ...args], { cwd, encoding: 'utf8', timeout: 60_000 })
            const help = run(['--help'])
            assert.equal(help.status, 0)
            assert.ok(help.stdout.startsWith('用法：node src/bench/cli.mjs [--role <triage|summarize|repair|faith|retag|all>]'), `--help 首行須為 node src/bench/cli.mjs:${help.stdout.split('\n')[0]}`)
            for (const r of SUMMARIZE_BENCH_ROLES) {
                assert.ok(help.stdout.includes(`node src/bench/cli.mjs --role ${r.id}`), `--help 須印 ${r.id} 之用法`)
                assert.ok(help.stdout.includes(`(src/bench/cases/${r.id}-generic.json)`), `--help 須印 ${r.id} 之內建題組路徑`)
            }
            assert.ok(!/node bench\/cli\.mjs/.test(help.stdout), '--help 之首行與各角色用法不得仍印 node bench/cli.mjs')
            assert.ok(!/[(\s]bench\/cases\//.test(help.stdout), '--help 之題組路徑不得仍印 bench/cases/(缺 src/)')
            const bad = run(['--role', 'nope'])
            assert.equal(bad.status, 1)
            assert.ok(bad.stderr.includes('摘要 AI 能力評分失敗：不認得之評分角色：nope'), bad.stderr)
            assert.ok(bad.stderr.includes('（用法：node src/bench/cli.mjs --help）'), bad.stderr)
        })
    })

    // ══════════════════════════ ⑤領域中立 ══════════════════════════
    describe('⑤ 領域中立', function() {
        // 量化／金融類之詞彙(詞表與命中函數取抓取套件之 test/tools/domainTerms,經 test/tools/captureForTest;四套件同一份)與網址(bench/ 之全部檔——
        //   題組與評分原始碼——皆不得含;走訪而不手列,新增之檔自動納入;bench/ 以外之原始碼在 unit-summarize-package ③)
        const hits = (text) => [...domainTermsIn(text), ...(/https?:\/\//i.test(text) ? ['網址'] : [])]
        const FILES = fs.readdirSync(path.join(SRC, 'bench'), { recursive: true }).map((f) => path.join(SRC, 'bench', f)).filter((f) => fs.statSync(f).isFile())

        it('詞表自檢:領域詞與網址被抓到;中立詞不誤判', () => {
            assert.deepEqual(hits('量化交易之股票回測、樣本外與 Alpha，見 https://x'), ['量化', '交易', '股票', '回測', '樣本外', 'alpha', '網址'])
            assert.deepEqual(hits('天文學知識庫：比熱、快速排序、HTTPS 協定、跳出率'), [])
        })

        it('bench/ 之全部檔(五份通用題組與評分原始碼;含註解)不含量化／金融詞與網址', () => {
            const rel = FILES.map((f) => path.relative(SRC, f).replace(/\\/g, '/'))
            assert.ok(['bench/summarizeBench.mjs', 'bench/cli.mjs', ...Object.values(SUMMARIZE_BENCH_CASES_FILES).map((f) => path.relative(SRC, f).replace(/\\/g, '/'))].every((f) => rel.includes(f)), `走訪須含題組與評分原始碼:${rel.join('、')}`)
            const bad = FILES.map((f) => [path.relative(SRC, f).replace(/\\/g, '/'), hits(fs.readFileSync(f, 'utf8'))]).filter(([, h]) => h.length)
            assert.deepEqual(bad, [])
        })
    })

    it('逐次呼叫選項與正式呼叫一致:陣列輸出之預篩、摘要、重標逐次截斷放行(acceptTruncated:true);物件輸出之修補、忠實性不給', () => {
        assert.deepEqual([triageBenchRole, summarizeBenchRole, retagBenchRole].map((r) => r.callOpt), [{ acceptTruncated: true }, { acceptTruncated: true }, { acceptTruncated: true }])
        assert.deepEqual([repairBenchRole, faithBenchRole].map((r) => r.callOpt), [{}, {}])
    })

    it('交調度層之 check 驗外層形狀(調度層取回覆中最後一段過 check 者):陣列角色須有帶整數 index 之物件項,尾隨之 [3]、空陣列、物件皆不過;修補／忠實性同正式之 check', () => {
        for (const r of [triageBenchRole, summarizeBenchRole, retagBenchRole]) {
            assert.equal(r.check([{ index: 1 }]), true, r.id)
            for (const bad of [[3], [], [{ i: 1 }], [{ index: '1' }], { index: 1 }, null]) assert.notEqual(r.check(bad), true, `${r.id}:${JSON.stringify(bad)}`)
        }
        assert.equal(repairBenchRole.check({ repairs: [] }), true)
        for (const bad of [[{ index: 1 }], { fixes: [] }, [3]]) assert.match(String(repairBenchRole.check(bad)), /^回覆非 \{"repairs":\[…\]\} 物件/)
        assert.equal(faithBenchRole.check({ checks: [] }), true)
        for (const bad of [[{ index: 1 }], { verdicts: [] }, [3]]) assert.match(String(faithBenchRole.check(bad)), /^回覆非 \{"checks":\[…\]\} 物件/)
    })
})
