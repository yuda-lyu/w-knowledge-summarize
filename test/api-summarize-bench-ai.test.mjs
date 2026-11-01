// api-summarize-bench-ai.test.mjs — 摘要之 AI 能力評分之真 AI 測試:以免費模型跑五角色(預篩、摘要、修補、忠實性、重標)之內建通用題組(每案兩回),
//   驗執行器全程無例外、每模型每案每回皆有結果;評分只報告、不作通過門檻(模型能力隨時間變動),報表落 test/_tmp/summarize-bench-ai-<時間戳>/ 並印出路徑
//
// 【閘門】會呼叫真 AI、耗用免費額度:只在 WK_LIVE_AI=1 時執行,否則整組略過(mocha pending)並印出原因。
// 【受測模型】WK_SUMMARIZE_MODELS(逗號分隔之條目 id)給了即用之;否則為摘要之預設席位(summarize.ai 之 use 與 fallback;預篩、重標未設席位即沿用之)。
// 【角色】WK_SUMMARIZE_ROLES(逗號分隔之角色 id)給了只跑所列者;否則依序跑五角色。
// 【金鑰】WK_ENV_FILE(.env 格式之金鑰檔)給了即讀之;未給讀 process.env(預設席位為免金鑰之免費模型)。
// 【工作目錄】AI 子行程之工作目錄在 test/_tmp 下、測完即刪;CLI 型模型會讀工作目錄上層之指示檔,量通用能力請改用命令列並把 --out 放在專案外。
// 【逐回即存】每回結果一完成即附寫報表目錄之 <角色>-progress.jsonl:中途被終止也留得下已跑之結果。報表目錄保留(供人閱讀)。
// 執行(套件根):WK_LIVE_AI=1 node <mocha> --timeout 180000 test/api-summarize-bench-ai.test.mjs

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUMMARIZE_BENCH_ROLES, summarizeBenchRoleOf, runSummarizeBench } from '../src/bench/summarizeBench.mjs'
import { createAiAdapter, loadBenchCases, writeBenchReport, BENCH_FAIL_KINDS } from './tools/captureForTest.mjs'
import { resolveSummarizeSettings } from '../src/core/summarizeSettings.mjs'

const LIVE = process.env.WK_LIVE_AI === '1'
const RUNS = 2
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))

/**
 * 逗號分隔之環境變數(未給回 null)
 *
 * @param {String} name 輸入變數名
 * @returns {Array|null} 回傳字串陣列或 null
 */
const listEnv = (name) => (process.env[name] ? process.env[name].split(',').map((s) => s.trim()).filter(Boolean) : null)

describe('api-summarize-bench-ai：免費 AI 跑五角色之通用題組（真 AI；評分只報告、不設門檻）', function() {

    this.timeout(6 * 3600_000)

    // AI 子行程工作目錄(帶 pid;測完即刪)
    const workspace = path.join(TEST_DIR, '_tmp', `summarize-bench-ai-ws-${process.pid}`)
    const roles = (listEnv('WK_SUMMARIZE_ROLES') || SUMMARIZE_BENCH_ROLES.map((r) => r.id)).map(summarizeBenchRoleOf)
    let ai = null
    let models = []
    let outDir = ''

    before(function() {
        if (!LIVE) {
            console.log('    略過：未設 WK_LIVE_AI=1（本測試呼叫真 AI、耗用免費額度）')
            this.skip()
        }
        const settings = resolveSummarizeSettings({})
        const seat = settings.summarize.ai
        models = listEnv('WK_SUMMARIZE_MODELS') || [seat.use, ...(seat.fallback || [])]
        assert.ok(models.length > 0, '受測模型為空')
        const envFile = process.env.WK_ENV_FILE ? path.resolve(process.env.WK_ENV_FILE) : ''
        if (envFile) assert.ok(fs.existsSync(envFile), `WK_ENV_FILE 指定之金鑰檔不存在：${envFile}`)
        ai = createAiAdapter({ ai: settings.ai, workspace, ...(envFile ? { envFile } : {}) })
    })

    after(() => {
        if (LIVE) fs.rmSync(workspace, { recursive: true, force: true })
    })

    for (const role of roles) {
        it(`${role.name}：每案 ${RUNS} 回，執行器全程無例外、每模型每案每回皆有結果(呼叫失敗與停測亦記原因);報表落地並印出路徑`, async () => {
            const set = loadBenchCases(role)
            let progressFile = ''
            const onProgress = (ev) => {
                if (ev.type === 'start') {
                    if (!outDir) outDir = path.join(TEST_DIR, '_tmp', `summarize-bench-ai-${ev.meta.stamp}`)
                    fs.mkdirSync(outDir, { recursive: true })
                    progressFile = path.join(outDir, `${role.id}-progress.jsonl`)
                    console.log(`    ${role.name}：受測 ${ev.meta.models.join('、')}；${ev.meta.cases} 案 × ${ev.meta.runs} 回；提示詞指紋 ${ev.meta.promptFp}；逐回進度 ${progressFile}`)
                    return
                }
                fs.appendFileSync(progressFile, `${JSON.stringify({ at: new Date().toISOString(), ...ev })}\n`, 'utf8')
                if (ev.type === 'call') {
                    const r = ev.record
                    const what = r.callFail ? `失敗（${BENCH_FAIL_KINDS[r.failKind] || r.failKind}：${String(r.error).slice(0, 80)}）` : (r.cls || `無裁決（${r.problem}）`)
                    console.log(`      [${ev.model}] 第 ${r.run} 回 ${ev.caseId}：${what}（${(r.ms / 1000).toFixed(1)}s）`)
                }
                else if (ev.type === 'model-stopped') console.log(`      [${ev.model}] ${ev.reason}`)
            }

            // 執行器全程無例外:runSummarizeBench 拋錯即本測試失敗(呼叫失敗、限流、停測皆應記入結果而非拋出)
            const result = await runSummarizeBench(role.id, { models, cases: set, runs: RUNS, aiAdapter: ai, onProgress })

            // 每模型每案每回皆有結果:裁決(類別或無裁決之原因)、呼叫失敗(類別與錯誤)或未呼叫(原因)三者之一;未通過之案皆附原因
            assert.equal(result.models.length, models.length)
            for (const m of result.models) {
                assert.equal(m.cases.length, set.cases.length, `${m.model} 之案數`)
                for (const c of m.cases) {
                    assert.equal(c.runs.length, RUNS, `${m.model}／${c.id} 之回數`)
                    c.runs.forEach((r, k) => {
                        assert.equal(r.run, k + 1)
                        const has = r.notRun ? !!r.error : r.callFail ? !!(r.failKind && r.error) : (r.cls !== null || !!r.problem)
                        assert.ok(has, `${m.model}／${c.id} 第 ${k + 1} 回無結果：${JSON.stringify(r)}`)
                    })
                    if (!c.pass) assert.ok(c.note, `${m.model}／${c.id} 未通過而無原因`)
                }
                const { score, general, holdout, contract, calls } = m
                assert.equal(score.total, set.cases.length)
                assert.equal(general.total + holdout.total, score.total)
                console.log(`    ${m.model}：通過 ${score.pass}/${score.total}（一般 ${general.pass}/${general.total}、保留 ${holdout.pass}/${holdout.total}）；合契約 ${contract.valid}/${contract.total}；平均 ${m.avgMs === null ? '-' : (m.avgMs / 1000).toFixed(1)}s；呼叫失敗 ${calls.failed}${calls.notRun ? `、未呼叫 ${calls.notRun}` : ''}${m.stopped ? `；${m.stopped}` : ''}`)
            }

            // 報表落地(評分只報告,不設門檻)
            const rep = writeBenchReport(result, outDir, { role, name: `${role.id}-bench` })
            for (const f of Object.values(rep.files)) assert.ok(fs.statSync(f).size > 0, f)
            console.log(`    報表：\n      ${[...Object.values(rep.files), progressFile].join('\n      ')}`)
        })
    }
})
