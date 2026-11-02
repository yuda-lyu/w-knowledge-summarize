// strictProbe.mjs — 在 wsemi 第 3 輪嚴格版(strictWsemiHook.mjs 換入之 strTruncate 替身)下跑字數類案例,結果以一行 JSON 印至 stdout
//
// 用法:node --import ./test/tools/strictWsemiHook.mjs test/tools/strictProbe.mjs [原始碼根(src 目錄;預設本套件 src)]
//   第二參數供「修前碼」對照(git archive 解出之舊 src)用。輸出 { hookLive, results }:hookLive 為 false 表替身未生效(結果不可信)。

import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import { runCharCountCases } from './charCountKit.mjs'

const srcRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')
const load = async (rel) => import(pathToFileURL(path.join(srcRoot, rel)).href)

// 替身是否生效:嚴格版對 Infinity 與未給之 maxLen 須拋錯(現行 wsemi 則原樣回傳或不截斷)
const throws = (f) => {
    try {
        f()
        return false
    }
    catch (e) {
        return true
    }
}
const hookLive = throws(() => strTruncate('abc', Infinity)) && throws(() => strTruncate('abc')) && !throws(() => strTruncate('abc', 2))

const D = {
    ...(await load('domain/triageDomain.mjs')),
    ...(await load('domain/noteDomain.mjs')),
    ...(await load('domain/digestDomain.mjs')),
}

console.log(JSON.stringify({ hookLive, results: runCharCountCases(D) }))
