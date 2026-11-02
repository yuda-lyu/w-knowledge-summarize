// strictWsemiHook.mjs — 以 node --import 載入:把 `wsemi/src/strTruncate.mjs` 換成嚴格版替身(strictWsemi.mjs)
//
// 用法:node --import ./test/tools/strictWsemiHook.mjs <腳本>;只影響該行程(測試以子行程執行,不污染同行程內其他測試檔已載入之模組)。
// 比對解析後之網址(不論從 src 以套件指定詞載入,或 wsemi 內部以相對路徑載入);替身自己載入真正的 strTruncate 時(parentURL 為替身本身)放行,避免自我取代。

import { registerHooks } from 'node:module'

const STRICT_URL = new URL('./strictWsemi.mjs', import.meta.url).href

registerHooks({
    resolve(specifier, context, nextResolve) {
        const r = nextResolve(specifier, context)
        if (context.parentURL !== STRICT_URL && /\/wsemi\/src\/strTruncate\.mjs$/.test(r.url)) {
            return { ...r, url: STRICT_URL, shortCircuit: true }
        }
        return r
    },
})
