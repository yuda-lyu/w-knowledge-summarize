// genPromptGolden.mjs — 預設提示詞標準檔(test/golden/prompts-default.json)之產生器與比對
// 不帶 .test. 中綴:配套工具,不被 runner 當測試檔抓取。
//
// 用法(任一 cwd):
//   node <套件根>/test/tools/genPromptGolden.mjs           只比對現行輸出與標準檔,逐鍵列出不同者(不寫檔;離開碼 0＝全同)
//   node <套件根>/test/tools/genPromptGolden.mjs --write   重產標準檔(標準檔是提示詞之逐字契約——重產前須確認差異皆為刻意變更並取得同意)
// 標準檔之內容由 promptFixtures.renderPromptGolden 產生(兩組詞彙 × 各類提示詞);路徑以本檔位置推導(與 cwd 無關)。
// 比對與重產之規則取抓取套件之 test/tools/promptGolden(經 test/tools/captureForTest;四套件同一份),本檔只給標準檔路徑與產生函數。

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderPromptGolden } from './promptFixtures.mjs'
import { runPromptGolden } from './captureForTest.mjs'

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'golden', 'prompts-default.json')

runPromptGolden({ file: FILE, render: renderPromptGolden, argv: process.argv })
