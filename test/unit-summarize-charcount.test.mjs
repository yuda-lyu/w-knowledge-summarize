// unit-summarize-charcount.test.mjs — 傳給 wsemi 計算類函數之字數值:先判定、再取值(排程第 271 項第 3 輪,下游先行;GEN-25)
// 規則(出自派工〈要做〉與 dspec〈輸入參數之檢測機制〉§11 第 18、19、20 項):
//   ①opt 類字數(summarizeCharsPerDoc、triageCharsPerDoc、longDocChars)與逐篇 budgets[i] 以 iseint(count,下限 1)判定、再 Number() 取值;
//     有效值(1～4294967295 之整數或其十進位數字字串)依其值,行為逐字不變;非預期(Infinity、'0x10'、包裝物件、逾上限者、非整數、非數字…)視為未給、
//     改用預設(budgets[i] 無效即用 summarizeCharsPerDoc)。修前:ispint→cint 把 Infinity 變 Number.MAX_VALUE、'0x10' 變 16、包裝物件解包
//   ②前瞻:wsemi 第 3 輪 strTruncate 之 maxLen 為必須參數(iseint count 判定,未給或非預期即拋錯)——於子行程以嚴格版替身(test/tools/strictWsemi.mjs)
//     驗證本套件改後不拋錯、行為與現行 wsemi 下逐值相同
//   ③站點全集:src/ 內對 strTruncate 之呼叫與其 maxLen 運算式有明列;interp1／arrGroupByMaxmin／arrLookupByMaxmin 於本套件 0 站點(新增即須回頭審)
// 執行:自套件根 node <mocha> test/unit-summarize-charcount.test.mjs(純函數、唯讀原始碼掃描與一個無網路子行程;不連網、不呼叫 AI、不寫檔)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import strTruncate from 'wsemi/src/strTruncate.mjs'
import { createTriageDomain } from '../src/domain/triageDomain.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import { createDigestDomain } from '../src/domain/digestDomain.mjs'
import { strictStrTruncate } from './tools/strictWsemi.mjs'
import { OPTIONS, UNEXPECTED, validVariants, runCharCountCases } from './tools/charCountKit.mjs'

// 套件根(以本檔位置定,不依 cwd)
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const D = { createTriageDomain, createSummarizeDomain, createDigestDomain }

/** 遞迴列出 src 下全部 .mjs(相對 src 之路徑,正斜線) */
function srcFiles(dir = path.join(PKG, 'src'), rel = '') {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? srcFiles(path.join(dir, e.name), `${rel}${e.name}/`) : e.name.endsWith('.mjs') ? [`${rel}${e.name}`] : []))
}

/** 取一檔內對 name 之全部呼叫之第 2 個引數運算式(括號與引號配對;頂層逗號分隔) */
function secondArgsOf(text, name) {
    const out = []
    const re = new RegExp(`\\b${name}\\(`, 'g')
    for (let m = re.exec(text); m; m = re.exec(text)) {
        let depth = 1
        let quote = ''
        let cur = ''
        const args = []
        for (let i = m.index + m[0].length; i < text.length && depth > 0; i++) {
            const c = text[i]
            if (quote) {
                if (c === '\\') {
                    cur += c + text[++i]
                    continue
                }
                if (c === quote) quote = ''
            }
            else if (c === '\'' || c === '"' || c === '`') quote = c
            else if (c === '(' || c === '[' || c === '{') depth++
            else if (c === ')' || c === ']' || c === '}') {
                depth--
                if (depth === 0) break
            }
            else if (c === ',' && depth === 1) {
                args.push(cur.trim())
                cur = ''
                continue
            }
            cur += c
        }
        args.push(cur.trim())
        out.push(args[1] ?? '')
    }
    return out
}

describe('unit-summarize-charcount', function() {

    // ══════════════════════════ ①opt 類字數:有效值依其值、非預期改用預設 ══════════════════════════
    describe('① opt 類字數與逐篇 budgets[i]:iseint(count,下限 1)判定後 Number() 取值', function() {
        const got = runCharCountCases(D)

        for (const o of OPTIONS) {
            it(`${o.id}:未給用預設(觀察法自證:預設值之字數)`, () => {
                assert.deepEqual(got[`${o.id}|omitted`], o.defaultCounts)
            })

            it(`${o.id}:有效值之各變體寫法(數字、數字字串、頭尾空白、.0、正號、前導零)皆依其值 ${o.valid}(行為逐字不變)`, () => {
                for (const v of validVariants(o.valid)) {
                    assert.deepEqual(got[`${o.id}|valid ${JSON.stringify(v)}`], o.validCounts, `${JSON.stringify(v)}`)
                }
            })

            it(`${o.id}:上限值 4294967295(count 上限)有效,依其值(長度未逾者不截斷)`, () => {
                assert.deepEqual(got[`${o.id}|max 4294967295`], o.maxCounts)
            })

            it(`${o.id}:非預期值(Infinity、'0x10'、包裝物件、逾 count 上限者、0、負數、非整數、非數字、null、布林、陣列、物件、BigInt、函數、Symbol)視為未給、改用預設`, () => {
                for (const [name] of UNEXPECTED) {
                    assert.deepEqual(got[`${o.id}|${name}`], o.defaultCounts, `${name} 應同未給(預設)`)
                }
            })
        }

        it('逐篇 budgets:同一批內有效項依其值、無效項各自回退 summarizeCharsPerDoc(逐項獨立)', () => {
            const MARK = ''
            const doc = (id) => ({ id, title: 'T', sourceName: 'S', url: 'https://example.com/a', text: MARK.repeat(3000) })
            const counts = (s) => s.split('\n\n').map((b) => b.split(MARK).length - 1)
            for (const make of [createSummarizeDomain, createDigestDomain]) {
                const d = make({ summarizeCharsPerDoc: 777 })
                const p = d.buildPrompt([doc('a'), doc('b'), doc('c'), doc('d'), doc('e')], [], { budgets: [50, Infinity, '30', '0x10', Object(9)] })
                assert.deepEqual(counts(p).filter((n) => n > 0), [50, 777, 30, 777, 777], make.name)
            }
        })

        it('triage 之 chars／longDocChars 互不牽連:triageCharsPerDoc 非預期不影響 longDocChars 之有效值', () => {
            const MARK = ''
            const t = createTriageDomain({ triageCharsPerDoc: Infinity, longDocChars: 2000 })
            const p = t.buildPrompt([{ title: 'T', sourceName: 'S', text: MARK.repeat(3000) }])
            assert.equal(p.split(MARK).length - 1, 800, '片段 400(預設)＋中段 400:3000 逾 longDocChars 2000 才另附中段')
        })
    })

    // ══════════════════════════ ②前瞻:wsemi 第 3 輪嚴格版 strTruncate ══════════════════════════
    describe('② 前瞻:嚴格版 strTruncate(maxLen 必須、iseint count 判定,未給或非預期即拋錯)下不拋錯、行為與現行 wsemi 下逐值相同', function() {

        it('替身契約:maxLen 未給或非預期拋錯;有效者(0、數字字串、4294967295)等同現行 strTruncate', () => {
            for (const bad of [undefined, null, Infinity, -Infinity, NaN, '0x10', -1, 1.5, '1.5', '', 'abc', 2 ** 32, Number.MAX_VALUE, Object(3), true, [], {}, 3n]) {
                assert.throws(() => strictStrTruncate('abcdefghij', bad), /invalid maxLen: must be a non-negative integer/, String(typeof bad))
            }
            assert.throws(() => strictStrTruncate('abcdefghij'), /invalid maxLen/)
            for (const ok of [0, 3, '3', ' 3 ', 4294967295, 20]) {
                assert.equal(strictStrTruncate('abcdefghij', ok), strTruncate('abcdefghij', Number(ok)), String(ok))
            }
            assert.equal(strictStrTruncate('abcdefghij', 3), 'abc...')
            assert.equal(strictStrTruncate(null, 3), '')
        })

        it('子行程(strictWsemiHook 把 wsemi/src/strTruncate.mjs 換成替身):替身生效;全部案例不拋錯;觀察結果與程序內(現行 wsemi)逐值相同', function() {
            this.timeout(120000)
            const hook = pathToFileURL(path.join(PKG, 'test/tools/strictWsemiHook.mjs')).href
            const r = spawnSync(process.execPath, ['--import', hook, path.join(PKG, 'test/tools/strictProbe.mjs')], { cwd: PKG, encoding: 'utf8', windowsHide: true, timeout: 110000 })
            assert.equal(r.status, 0, `${r.stderr}`.slice(-1500))
            const probe = JSON.parse(r.stdout.trim().split('\n').pop())
            assert.equal(probe.hookLive, true, '嚴格版替身須生效(否則下列結果不可信)')
            const keys = Object.keys(probe.results)
            assert.ok(keys.length >= OPTIONS.length * 30, `案例數 ${keys.length}`)
            const errs = keys.filter((k) => probe.results[k].error)
            assert.deepEqual(errs, [], `嚴格版下拋錯之案例:${errs.slice(0, 5).map((k) => `${k}→${probe.results[k].error}`).join('；')}`)
            const inproc = runCharCountCases(D)
            assert.deepEqual(probe.results, JSON.parse(JSON.stringify(inproc)), '嚴格版下之觀察結果同現行 wsemi 下')
        })
    })

    // ══════════════════════════ ③站點全集 ══════════════════════════
    describe('③ 站點全集:src/ 內對 wsemi 第 3 輪變動函數之呼叫', function() {
        // 站點表(新增、刪除、改寫 strTruncate 之呼叫都須回頭審 maxLen 來源並更新本表;maxLen 為變數者其值須來自 iseint 判定後之 Number())
        const STRTRUNCATE_SITES = {
            'domain/triageDomain.mjs': ['chars', 'chars', 'chars', '120'],
            'domain/retagDomain.mjs': ['120', '300', '160'],
            'domain/noteDomain.mjs': ['charsOf(budgets[i])'],
            'domain/digestDomain.mjs': ['charsOf(budgets[i])'],
        }
        const files = srcFiles()

        it('strTruncate:呼叫之檔與各呼叫之 maxLen 運算式等於站點表(字面值或已判定之變數)', () => {
            const found = {}
            for (const f of files) {
                const a = secondArgsOf(fs.readFileSync(path.join(PKG, 'src', f), 'utf8'), 'strTruncate')
                if (a.length) found[f] = a
            }
            assert.deepEqual(found, STRTRUNCATE_SITES)
        })

        it('maxLen 為變數之檔:以 iseint 判定(匯入 iseint)、不再用 ispint→cint 清洗(cint(Infinity) 為 Number.MAX_VALUE)', () => {
            for (const f of Object.keys(STRTRUNCATE_SITES)) {
                const text = fs.readFileSync(path.join(PKG, 'src', f), 'utf8')
                const variable = STRTRUNCATE_SITES[f].some((x) => !/^\d+$/.test(x))
                if (!variable) continue
                assert.match(text, /^import iseint from 'wsemi\/src\/iseint\.mjs'$/m, f)
                assert.doesNotMatch(text, /^import cint from /m, `${f} 不應再匯入 cint`)
                assert.doesNotMatch(text, /\bcint\(/, `${f} 不應再呼叫 cint`)
            }
        })

        it('interp1／arrGroupByMaxmin／arrLookupByMaxmin:本套件 0 站點(新增即須依 wsemi 第 3 輪契約審傳入值)', () => {
            for (const name of ['interp1', 'arrGroupByMaxmin', 'arrLookupByMaxmin']) {
                const hits = files.filter((f) => new RegExp(`\\b${name}\\b`).test(fs.readFileSync(path.join(PKG, 'src', f), 'utf8')))
                assert.deepEqual(hits, [], name)
            }
        })
    })
})
