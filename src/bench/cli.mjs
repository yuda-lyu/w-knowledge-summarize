// cli.mjs — 摘要之 AI 能力評分之命令列(薄殼:直接執行時交 bench/summarizeBench 之 runSummarizeBenchCli;參數解析、評分、報表皆在該處)
//
// 用法:node bench/cli.mjs [--role <triage|summarize|repair|faith|retag|all>] [--models <id,…>|free] [--cases <題組 json>] [--vocab <詞彙 json>]
//                          [--runs 2] [--out <目錄>] [--env <金鑰檔>] [--timeout <毫秒>] [--concurrency <n>] [--tz <IANA 時區>] [--board <評比表 csv>]
//   各選項之說明見 summarizeBench 之 SUMMARIZE_BENCH_USAGE(--help 印出);報表落 --out(預設 cwd 之 ./bench-out/)。
//
// 【被 import 時不執行】只在直接執行(node bench/cli.mjs …;判定取抓取套件之 isDirectRun,各命令列同一份)時跑;被 import 時只轉出
//   runSummarizeBenchCli(與套件入口同一實體),故可與其他公開模組一樣被載入檢查,不必列為例外。

import { isDirectRun } from '../core/capturePackage.mjs'
import { runSummarizeBenchCli } from './summarizeBench.mjs'

export { runSummarizeBenchCli }

if (isDirectRun(import.meta.url)) {
    runSummarizeBenchCli(process.argv.slice(2)).catch((e) => {
        console.error(`摘要 AI 能力評分失敗：${e?.message || e}\n（用法：node bench/cli.mjs --help）`)
        process.exitCode = 1
    })
}

export default runSummarizeBenchCli
