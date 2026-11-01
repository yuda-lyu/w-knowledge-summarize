// unit-summarize-package.test.mjs — 套件結構測試:邊界(單一匯入點)、package.json 之依賴與實際 import 對帳、預設領域中立、舊名不出現
//
// 【佈局】原始碼全在 src/(主入口 src/WKnowledgeSummarize.mjs);套件根另有 g.mjs(範例)、toolg/(編譯與文件工具)、test/;下文路徑除註明外皆相對套件根
// ① 邊界:套件內全部 .mjs(排除 node_modules、test/_tmp 與產物夾 tmp、dist、docs)之 import 只限套件內相對路徑、npm 套件,以及單一匯入點 src/core/capturePackage.mjs
//   (抓取套件之主入口;測試專用之抓取橋接 test/tools/captureForTest.mjs 亦許可,另可取抓取套件之共用測試件 test/tools/*,如領域中立詞表);
//   不得引用專案既有程式與資料;本套件之 core/ 不得有與
//   抓取套件之 core/ 同相對路徑之檔(同名異實);匯入點所列名稱皆可自抓取套件解析;非測試檔不引用 test/ 下之檔
// ② package.json:名稱與版本、scripts 為 test(mocha 標準指令)與 deploy;dependencies＝src/ 實際 import 之 npm 套件＋抓取套件(經匯入點)、devDependencies＝
//   測試與編譯工具(g.mjs、toolg/)另 import 者(測試執行器 mocha 經 scripts.test 呼叫、不 import,隨編譯工具套件 w-package-tools 安裝;wsemi 自帶之依賴依自有套件之慣例不列);
//   抓取套件之版本合於所列範圍;入口可載入;發布面(main 指向 dist 之 UMD、不設 exports 與 files,使下游得以「套件名/src/…」與「套件名/test/tools/…」深層路徑取用;
//   .npmignore 排除 sgud、CLAUDE*.md、暫存與測試檔而保留 test/tools;LICENSE 為 MIT);範例 g.mjs 離線可執行且 README 含其全文;
//   發布內容(README、*.csv、非測試 .mjs)不含宿主之痕跡:磁碟機絕對路徑與使用者目錄
// ③ 預設領域中立:預設設定、詞彙、提示詞、零設定組裝之 info()、README、package.json、g.mjs 與原始碼(含註解、日誌與待判字樣;不含測試與評分題組)
//   不含特定產業領域之詞彙
// ④ 舊名、沿革與面向使用者之字樣:原始碼(非測試,含 bench)、package.json 與 README 逐行不含舊之套件名與以 extract 指稱摘要之名、沿革指標、
//   執行端之指令與他工作之名;字串字面與 README 不含執行端之指令、他工作之名與帳本代號(判準取抓取套件之 test/tools/historyMarks;具名例外只一項)
// 執行:在套件根 node <mocha> test/unit-summarize-package.test.mjs(暫存 test/_tmp/summarize-package-<pid>,測完即刪;不連網、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isBuiltin } from 'node:module'
import * as CapturePort from '../src/core/capturePackage.mjs'
import { createKnowledgeSummarize } from '../src/createKnowledgeSummarize.mjs'
import { resolveSummarizeSettings, SUMMARIZE_DEFAULT, SUMMARIZE_AI_DEFAULT } from '../src/core/summarizeSettings.mjs'
import { SUMMARIZE_VOCAB_DEFAULT, resolveSummarizeVocab, guideDefaultOf } from '../src/core/vocab/summarizeVocab.mjs'
import { renderSummarizePrompts } from './tools/promptFixtures.mjs'
import { tmpRoot, removeRoots, resetConceptFold, scriptedAi } from './tools/summarizeTestKit.mjs'
import {
    domainTermsIn, lexSource, specifiersOf, exportedNamesOf, namedImportsOf, HOST_CLI, historyHitsOf, userTextHitsOf, historyScanOf, userTextScanOf, benchCaseNotesOf,
} from './tools/captureForTest.mjs'
import { NON_CONTENT_SECTIONS } from '../src/core/md/noteContent.mjs'

/** 套件根(以本檔位置推導,與 cwd 無關) */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/')

/** 宿主之痕跡:磁碟機絕對路徑(盤符＋反斜線;字串字面中之跳脫形亦含)與使用者目錄 */
const HOST_PATH = /\b[A-Za-z]:\\|\/Users\/|C:\/Users/

/** 單一匯入點與測試專用之抓取橋接(許可引用抓取套件之檔) */
const BRIDGE = 'src/core/capturePackage.mjs'
const TEST_BRIDGE = 'test/tools/captureForTest.mjs'

/** 抓取套件之套件名(匯入點移植為 npm 套件後之指定詞) */
const CAPTURE_PKG = 'w-knowledge-capture'

// ═══════════════════════ 掃描工具(①②共用) ═══════════════════════

/**
 * 套件內全部指定副檔名之檔(預設 .mjs;相對路徑,正斜線;排除 node_modules、test/_tmp 與套件根之產物夾 tmp、dist、docs)——逐層走訪:並行之他測試會建立與刪除 test/_tmp 內之檔案
 *
 * @param {String} [ext='.mjs'] 輸入副檔名
 * @returns {Array} 回傳相對路徑陣列
 */
function sourceFiles(ext = '.mjs') {
    const out = []
    const walk = (rel) => {
        let entries = []
        try {
            entries = fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })
        }
        catch {
            return
        }
        for (const d of entries) {
            const r = rel ? `${rel}/${d.name}` : d.name
            if (d.isDirectory()) {
                if (d.name === 'node_modules' || r === 'test/_tmp' || (!rel && ['tmp', 'dist', 'docs'].includes(d.name))) continue
                walk(r)
            }
            else if (d.name.endsWith(ext)) out.push(r)
        }
    }
    walk('')
    return out.sort()
}

/** 讀檔;讀取當下已被他行程刪除者回 null */
function readText(rel) {
    try {
        return fs.readFileSync(path.join(ROOT, rel), 'utf8')
    }
    catch {
        return null
    }
}

// ── 模組指定詞之取出:詞法器(lexSource)與指定詞／轉出名／具名匯入之取出(specifiersOf、exportedNamesOf、namedImportsOf)取抓取套件之
//   test/tools/sourceScan(經 test/tools/captureForTest;四套件同一份):逐字元之小型詞法器先剝註解與字串(字串換成編號之佔位、正規表示式字面
//   換成記號)再比對 import／export 之形式,註解含分號、引號或「import … from …」之字樣時不會漏抓或誤抓。自檢見下 ① 之兩案。

/** 抓取套件之主入口、原始碼根(入口所在)與套件根(package.json 所在)——依匯入點之指定詞解析:已安裝之 npm 套件(「套件名/src/入口檔」)或相對路徑 */
const BRIDGE_SPEC = specifiersOf(readText(BRIDGE) || '')[0] || ''
const CAPTURE_ENTRY_SPEC = `${CAPTURE_PKG}/src/WKnowledgeCapture.mjs`
const CAPTURE_ENTRY = (BRIDGE_SPEC.startsWith('.') ? path.resolve(ROOT, 'src/core', BRIDGE_SPEC) : fileURLToPath(import.meta.resolve(BRIDGE_SPEC))).replace(/\\/g, '/')
const CAPTURE_ROOT = path.dirname(CAPTURE_ENTRY)
const CAPTURE_PKG_ROOT = BRIDGE_SPEC.startsWith('.') ? CAPTURE_ROOT : path.dirname(fileURLToPath(import.meta.resolve(`${CAPTURE_PKG}/package.json`))).replace(/\\/g, '/')

/** 專案內不屬本套件之目錄名:指定詞以之起頭即引用專案既有程式或資料 */
const PROJECT_DIRS = ['srcPack', 'src', 'test', 'data', 'srcCapture']

/**
 * 分類一個指定詞
 *
 * @param {String} file 輸入引用者(相對套件根)
 * @param {String} spec 輸入指定詞
 * @returns {Object} 回傳 { kind:'builtin'|'relative'|'package', pkg?:套件名, problem?:問題說明 }
 */
function classify(file, spec) {
    const bridge = file === BRIDGE || file === TEST_BRIDGE
    if (spec.startsWith('node:') || isBuiltin(spec)) return { kind: 'builtin' }
    if (spec === '.' || spec === '..' || spec.startsWith('./') || spec.startsWith('../')) {
        const target = path.resolve(path.dirname(path.join(ROOT, file)), spec).replace(/\\/g, '/')
        const rel = path.relative(ROOT, target).replace(/\\/g, '/')
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            // 抓取套件只經匯入點(與測試專用之橋接)取用,且指向其主入口:其指定詞即抓取套件(移植後為 npm 套件名);
            //   測試專用之橋接另可取抓取套件之共用測試件(其 test/tools/ 下,如四套件同一份之領域中立詞表)——同關聯、提煉套件之邊界規則
            if (bridge && target === CAPTURE_ENTRY && fs.existsSync(target)) return { kind: 'package', pkg: CAPTURE_PKG }
            if (file === TEST_BRIDGE && (`${target}/`).startsWith(`${CAPTURE_ROOT}/test/tools/`) && fs.existsSync(target)) return { kind: 'package', pkg: CAPTURE_PKG }
            return { kind: 'relative', problem: `相對 import 跑出套件根 → ${spec}${(`${target}/`).startsWith(`${CAPTURE_ROOT}/`) ? '(取抓取套件須經 src/core/capturePackage.mjs,且指向其主入口;測試專用之橋接另可取其 test/tools/)' : ''}` }
        }
        if (!fs.existsSync(target)) return { kind: 'relative', problem: `目標不存在 → ${spec}` }
        return { kind: 'relative' }
    }
    if (spec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(spec) || /^[a-z][a-z0-9+.-]*:/i.test(spec)) return { kind: 'package', problem: `絕對路徑或 URL 形式之指定詞 → ${spec}` }
    if (PROJECT_DIRS.some((d) => spec === d || spec.startsWith(`${d}/`))) return { kind: 'package', problem: `引用專案既有程式或資料 → ${spec}` }
    const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
    if (pkg === CAPTURE_PKG) {
        // npm 套件之形:匯入點(與橋接)只指向其主入口「套件名/src/入口檔」;測試專用之橋接另可取其共用測試件「套件名/test/tools/<檔>」(須為實有檔)
        if (!bridge) return { kind: 'package', pkg, problem: `抓取套件須經單一匯入點 src/core/capturePackage.mjs 取用 → ${spec}` }
        if (spec === CAPTURE_ENTRY_SPEC) return { kind: 'package', pkg }
        if (file === TEST_BRIDGE && spec.startsWith(`${CAPTURE_PKG}/test/tools/`) && fs.existsSync(path.join(CAPTURE_PKG_ROOT, spec.slice(CAPTURE_PKG.length + 1)))) return { kind: 'package', pkg }
        return { kind: 'package', pkg, problem: `取抓取套件須指向其主入口 ${CAPTURE_ENTRY_SPEC}(測試專用之橋接另可取其 test/tools/)→ ${spec}` }
    }
    return { kind: 'package', pkg }
}

/** 全套件掃描結果(逐檔之指定詞與分類) */
function scanAll() {
    const files = sourceFiles()
    const rows = []
    for (const f of files) {
        const code = readText(f)
        if (code === null) continue
        for (const spec of specifiersOf(code)) rows.push({ file: f, spec, ...classify(f, spec) })
    }
    return { files, rows }
}

describe('unit-summarize-package', function() {

    this.timeout(60_000)

    after(() => {
        resetConceptFold()
    })

    // ═══════════════════════ ① 邊界 ═══════════════════════
    describe('① 邊界(只經單一匯入點取抓取套件;套件須能整份移植)', () => {
        let scan = null
        before(() => {
            scan = scanAll()
        })

        it('掃描器自檢:各種 import 形式皆能取出指定詞;註解行與範例行不計;分類器抓得到跑出套件、專案目錄、繞過匯入點與絕對路徑', () => {
            // 動態 import 之固定樣本以拼接組成:本檔自身亦在掃描範圍,不可含完整之 import(...) 字樣
            const fixture = [
                "import a from './a.mjs'",
                'import {',
                '    b,',
                "} from '../../srcPack/x.mjs'",
                "export * from 'wsemi/src/isobj.mjs'",
                "import 'side-effect-pkg'",
                `const m = await ${'imp'}${"ort('../../src/y.mjs')"}`,
                "// import c from 'commented-out'",
                '/**',
                " * import d from 'in-jsdoc'",
                ' */',
            ].join('\n')
            assert.deepEqual(specifiersOf(fixture).sort(), ['../../src/y.mjs', '../../srcPack/x.mjs', './a.mjs', 'side-effect-pkg', 'wsemi/src/isobj.mjs'])
            assert.match(classify('test/x.test.mjs', '../../srcPack/x.mjs').problem, /跑出套件根/)
            assert.match(classify('src/stages/x.mjs', CAPTURE_ENTRY_SPEC).problem, /須經單一匯入點 src\/core\/capturePackage\.mjs/)
            assert.match(classify('src/stages/x.mjs', CAPTURE_PKG).problem, /須經單一匯入點/)
            assert.deepEqual(classify(BRIDGE, BRIDGE_SPEC), { kind: 'package', pkg: CAPTURE_PKG })
            // 匯入點與橋接只指向抓取套件之主入口;橋接另可取其共用測試件(test/tools/ 之實有檔),匯入點不可
            assert.deepEqual(classify(TEST_BRIDGE, `${CAPTURE_PKG}/test/tools/domainTerms.mjs`), { kind: 'package', pkg: CAPTURE_PKG })
            assert.match(classify(BRIDGE, `${CAPTURE_PKG}/test/tools/domainTerms.mjs`).problem, /指向其主入口/)
            assert.match(classify(TEST_BRIDGE, `${CAPTURE_PKG}/src/core/kernel.mjs`).problem, /指向其主入口/)
            assert.match(classify(TEST_BRIDGE, `${CAPTURE_PKG}/test/tools/nope.mjs`).problem, /指向其主入口/)
            assert.match(classify('src/core/x.mjs', '../nope/none.mjs').problem, /目標不存在/)
            assert.match(classify('src/core/x.mjs', 'srcPack/core/kernel.mjs').problem, /引用專案既有程式或資料/)
            assert.match(classify('src/core/x.mjs', 'data/vocab.json').problem, /引用專案既有程式或資料/)
            assert.match(classify('src/core/x.mjs', 'C:/proj/a.mjs').problem, /絕對路徑或 URL/)
            assert.deepEqual(classify('src/core/x.mjs', 'wsemi/src/isobj.mjs'), { kind: 'package', pkg: 'wsemi' })
            assert.deepEqual(classify('src/core/x.mjs', 'node:fs'), { kind: 'builtin' })
            assert.deepEqual(classify('src/core/x.mjs', '../core/summarizeSettings.mjs'), { kind: 'relative' })
            for (const f of ['src/WKnowledgeSummarize.mjs', 'src/createKnowledgeSummarize.mjs', 'src/summarizeRuntime.mjs', BRIDGE, 'src/stages/noteStage.mjs', 'g.mjs', 'toolg/gDistRollup.mjs', 'test/unit-summarize-package.test.mjs', 'test/tools/summarizeTestKit.mjs']) {
                assert.ok(scan.files.includes(f), `掃描須含 ${f}`)
            }
            assert.ok(scan.files.length >= 60 && scan.rows.length >= 300, `掃描量過少：${scan.files.length} 檔／${scan.rows.length} 條指定詞`)
            assert.ok(!scan.files.some((f) => f.includes('node_modules') || f.startsWith('test/_tmp/') || /^(tmp|dist|docs)\//.test(f)), '須排除 node_modules、test/_tmp 與產物夾 tmp、dist、docs')
        })

        it('掃描器自檢:import／export 區塊內之註解含分號或引號不致漏抓;區塊註解、字串、樣板與正規表示式字面之內容不被誤認;除號不被當成正規表示式', () => {
            const fixture = [
                'import {',
                '    b, // 註解含;分號與 \'單引號\' 與 "雙引號"',
                "} from './b.mjs'",
                'export {',
                "    c, // 註解;含 'quote'",
                "} from './c.mjs'",
                "/* import e from 'in-block' */",
                "const s = \"import g from './in-string.mjs'\"",
                "const t = `import h from './in-template.mjs'`",
                "const u = `x${'y'}\nimport i from './in-template-expr.mjs'\n`",
                "const re = /['\"]/g; import k from './after-regex.mjs'",
                "const z = a / 2; import l from './after-division.mjs'",
            ].join('\n')
            assert.deepEqual(specifiersOf(fixture).sort(), ['./after-division.mjs', './after-regex.mjs', './b.mjs', './c.mjs'])
            // 骨架:註解、字串與正規表示式字面之內容不留(比對只見程式之結構)
            const sk = lexSource("const x = 'import y from \"z\"' // 註解 import w from 'v'\nconst r = /from 'q'/").skeleton
            assert.doesNotMatch(sk, /import|from|註解/)
        })

        it('全部相對 import 解析後不跑出套件根、目標存在(含 g.mjs 與 toolg/);取抓取套件者只有單一匯入點(與測試專用之橋接),其目標即抓取套件之主入口', () => {
            const bad = scan.rows.filter((r) => r.problem).map((r) => `${r.file}：${r.problem}`)
            assert.deepEqual(bad, [])
            const viaCapture = [...new Set(scan.rows.filter((r) => r.pkg === CAPTURE_PKG).map((r) => r.file))]
            assert.ok(viaCapture.includes(BRIDGE))
            assert.deepEqual(viaCapture.filter((f) => f !== BRIDGE && f !== TEST_BRIDGE), [])
            assert.equal(path.basename(CAPTURE_ENTRY), 'WKnowledgeCapture.mjs')
            assert.deepEqual(specifiersOf(readText(BRIDGE)), [BRIDGE_SPEC], '匯入點只有一個指定詞(移植時只改此處)')
        })

        it('非測試檔不引用 test/ 下之檔(測試工具與測試專用之抓取橋接只供測試;發布之套件可不帶 test/)', () => {
            const intoTestOf = (rows) => rows.filter((r) => !r.file.startsWith('test/') && r.kind === 'relative' && !r.problem)
                .filter((r) => path.relative(ROOT, path.resolve(path.dirname(path.join(ROOT, r.file)), r.spec)).replace(/\\/g, '/').startsWith('test/'))
                .map((r) => `${r.file} → ${r.spec}`)
            // 判準自檢:非測試檔指向 test/ 者被列出;測試檔之互引、指向套件內他目錄者不列
            const probes = [
                { file: 'src/stages/x.mjs', spec: '../../test/tools/summarizeTestKit.mjs' },
                { file: 'test/a.test.mjs', spec: './tools/summarizeTestKit.mjs' },
                { file: 'src/stages/x.mjs', spec: '../stores/taxonomy.mjs' },
            ].map((p) => ({ ...p, ...classify(p.file, p.spec) }))
            assert.deepEqual(intoTestOf(probes), ['src/stages/x.mjs → ../../test/tools/summarizeTestKit.mjs'])
            assert.deepEqual(intoTestOf(scan.rows), [])
        })

        it('匯入點所列名稱皆可自抓取套件之主入口解析(非 undefined);本套件之 core/ 與抓取套件之 core/ 無同相對路徑之檔(同名異實)', () => {
            const names = Object.keys(CapturePort)
            assert.ok(names.length >= 50, `匯入點之名過少:${names.length}`)
            assert.deepEqual(names.filter((k) => CapturePort[k] === undefined), [])
            const listCore = (root) => {
                const out = []
                const walk = (rel) => {
                    for (const d of fs.readdirSync(path.join(root, 'core', rel), { withFileTypes: true })) {
                        const r = rel ? `${rel}/${d.name}` : d.name
                        if (d.isDirectory()) walk(r)
                        else if (d.name.endsWith('.mjs')) out.push(r)
                    }
                }
                walk('')
                return out
            }
            const capCore = new Set(listCore(CAPTURE_ROOT))
            assert.ok(capCore.size >= 20, '前提:抓取套件之 core/ 有檔')
            assert.deepEqual(listCore(`${ROOT}/src`).filter((f) => capCore.has(f)), [])
        })

        it('匯入點只列套件程式碼所需之名:所列每一名,非測試檔至少一檔經匯入點具名取用(只供測試之名經測試專用之橋接)', () => {
            // 規則:上層可依賴之面以埠明列之名為準——埠多列只供測試之名,即把測試之需求寫成套件之依賴面(移植時誤以為套件需要)
            // 判準自檢:轉出取對外之名(x as y → y)、匯入取被匯入之名(y as z → y);多行、註解與字串不干擾
            assert.deepEqual(exportedNamesOf("export {\n    a, // 說明;b\n    c as d,\n} from '../x.mjs'\nconst s = \"export { q } from './q.mjs'\""), ['a', 'd'])
            assert.deepEqual(namedImportsOf("import { d as e, a } from '../core/capturePackage.mjs'\n// import { q } from './q.mjs'").map((x) => `${x.spec}:${x.name}`), ['../core/capturePackage.mjs:d', '../core/capturePackage.mjs:a'])
            const names = exportedNamesOf(readText(BRIDGE))
            assert.deepEqual([...names].sort(), Object.keys(CapturePort).sort(), '解析之清單＝匯入點之命名空間')
            const target = path.join(ROOT, BRIDGE).replace(/\\/g, '/')
            const used = new Set()
            for (const f of scan.files.filter((x) => !x.startsWith('test/') && x !== BRIDGE)) {
                const code = readText(f)
                if (code === null) continue
                for (const { spec, name } of namedImportsOf(code)) {
                    if (spec.startsWith('.') && path.resolve(path.dirname(path.join(ROOT, f)), spec).replace(/\\/g, '/') === target) used.add(name)
                }
            }
            assert.deepEqual(names.filter((n) => !used.has(n)), [], `只供測試之名改列 ${TEST_BRIDGE}`)
        })
    })

    // ═══════════════════════ ② package.json ═══════════════════════
    describe('② package.json', () => {
        const pkg = JSON.parse(fs.readFileSync(`${ROOT}/package.json`, 'utf8'))
        /** 測試執行器(由 scripts.test 呼叫,不被 import;隨編譯工具套件 BUILD_TOOLS 安裝) */
        const TEST_RUNNER = 'mocha'
        /** 編譯與文件工具套件(toolg/ 以 w-package-tools 之 src 深層路徑取用;同自有套件之 devDependencies) */
        const BUILD_TOOLS = 'w-package-tools'
        /** 檔案所屬群組:src/ 為套件原始碼(lib)、test/ 為測試、其餘(g.mjs、toolg/)為範例與編譯工具(tool) */
        const groupOf = (file) => (file.startsWith('test/') ? 'test' : file.startsWith('src/') ? 'lib' : 'tool')

        /**
         * wsemi 自行規定並安裝之依賴:自有套件之慣例是依賴由該自有套件統籌,使用端不重列(自 node_modules 之 wsemi/package.json 讀取,由近而遠)
         *
         * @returns {Set} 回傳套件名集合
         */
        function providedByWsemi() {
            for (let dir = ROOT; ; dir = path.dirname(dir)) {
                const f = `${dir}/node_modules/wsemi/package.json`
                if (fs.existsSync(f)) return new Set(Object.keys(JSON.parse(fs.readFileSync(f, 'utf8')).dependencies || {}))
                if (path.dirname(dir) === dir) throw new Error('找不到 node_modules/wsemi(須先安裝套件依賴)')
            }
        }

        it('scripts 為 test(mocha --parallel 之標準指令)與 deploy(文件發布,同自有套件之範本),不增設其他指令', () => {
            // 規則:套件之 package.json 提供 npm test(有 parallel 之標準寫法)與 deploy(gh-pages -d docs;自有套件範本皆有)
            assert.deepEqual(Object.keys(pkg.scripts), ['test', 'deploy'])
            assert.equal(pkg.scripts.test, 'mocha --parallel "test/*.test.mjs" --timeout 180000')
            assert.equal(pkg.scripts.deploy, 'gh-pages -d docs')
        })

        it('依賴對帳:src/ 之 import 套件＝dependencies(wsemi 自帶者除外;抓取套件經匯入點);測試與編譯工具(g.mjs、toolg/)另 import 者在 devDependencies;所列者皆有使用者', () => {
            const scan = scanAll()
            const deps = new Set(Object.keys(pkg.dependencies || {}))
            const dev = new Set(Object.keys(pkg.devDependencies || {}))
            const byWsemi = providedByWsemi()
            assert.ok(deps.has('wsemi') && byWsemi.has('lodash-es'), '前提:wsemi 為依賴且其依賴含 lodash-es')
            const used = { lib: new Set(), test: new Set(), tool: new Set() }
            for (const r of scan.rows.filter((x) => x.kind === 'package' && x.pkg && !x.problem)) used[groupOf(r.file)].add(r.pkg)
            const libMissing = [...used.lib].filter((p) => !deps.has(p) && !byWsemi.has(p))
            const devMissing = [...used.test, ...used.tool].filter((p) => !deps.has(p) && !dev.has(p) && !byWsemi.has(p))
            assert.deepEqual([libMissing, devMissing], [[], []], '被 import 之套件須列於 package.json')
            assert.deepEqual([...deps].filter((p) => !used.lib.has(p)), [], 'dependencies 不得有 src/ 未使用者')
            // 測試執行器 mocha 由 scripts.test 呼叫、不被 import:隨編譯工具套件安裝(同自有套件),不在 import 對帳之內,但須可解析
            assert.ok(dev.has(BUILD_TOOLS) && used.tool.has(BUILD_TOOLS), `編譯工具套件 ${BUILD_TOOLS} 須列於 devDependencies 且被 toolg/ 使用`)
            assert.doesNotThrow(() => import.meta.resolve(TEST_RUNNER), `測試執行器 ${TEST_RUNNER} 須已安裝`)
            assert.deepEqual([...dev].filter((p) => !used.test.has(p) && !used.tool.has(p)), [], 'devDependencies 不得有測試與編譯工具未使用者')
            assert.deepEqual([...dev].filter((p) => used.lib.has(p)), [], 'src/ 使用者須列於 dependencies')
            assert.ok(used.lib.has(CAPTURE_PKG) && used.lib.has('wsemi'), '掃描非空洞:抓取套件與 wsemi 皆被掃到')
        })

        it('依賴為 semver 範圍(不指向本機路徑);抓取套件之實際版本合於所列範圍', () => {
            for (const [name, range] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) {
                assert.match(range, /^[\^~>=<]*\d+\.\d+\.\d+/, `${name} 之版本範圍須為 semver：${range}`)
            }
            const cap = JSON.parse(fs.readFileSync(`${CAPTURE_PKG_ROOT}/package.json`, 'utf8'))
            assert.equal(cap.name, CAPTURE_PKG)
            const [maj, min] = cap.version.split('.').map(Number)
            const m = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.dependencies[CAPTURE_PKG])
            assert.ok(m, pkg.dependencies[CAPTURE_PKG])
            assert.ok(Number(m[1]) === 0 ? maj === 0 && min === Number(m[2]) : maj === Number(m[1]), `抓取套件 ${cap.version} 須合於 ${pkg.dependencies[CAPTURE_PKG]}`)
        })

        it('入口可載入:main 指向 dist 之 UMD(dist 由發布流程產製,不要求存在),ESM 入口 src/WKnowledgeSummarize.mjs 存在;預設匯出物件與具名匯出為同一組(含 createKnowledgeSummarize)', async () => {
            // 規則(移植指定詞):自有套件發布後 main 指 UMD、原始碼在 src/,下游一律以「套件名/src/入口檔」取 ESM 入口——
            //   套件不設 exports(設了即擋掉該子路徑與 test/tools 之深層路徑),入口檔須實際存在於 src/
            assert.equal(pkg.main, `dist/${pkg.name}.umd.js`)
            assert.ok(fs.existsSync(`${ROOT}/src/WKnowledgeSummarize.mjs`), 'ESM 入口 src/WKnowledgeSummarize.mjs 須存在')
            const mod = await import('../src/WKnowledgeSummarize.mjs')
            assert.equal(typeof mod.createKnowledgeSummarize, 'function')
            assert.equal(mod.default.createKnowledgeSummarize, mod.createKnowledgeSummarize)
            assert.deepEqual(Object.keys(mod.default).sort(), Object.keys(mod).filter((k) => k !== 'default').sort())
        })

        it('發布面:不設 exports 與 files(下游以深層路徑取用 src/ 與 test/tools/);.npmignore 排除 sgud、CLAUDE*.md、暫存、測試檔與文件夾而保留 test/tools;套件根範本檔齊備;LICENSE 為 MIT 且署名同作者', () => {
            // 規則:設 exports 即擋掉「套件名/src/…」「套件名/test/tools/…」之深層路徑(下游套件與專案以之取用);設 files 白名單則套件根新增檔案時易漏
            assert.equal(pkg.exports, undefined, '不設 exports')
            assert.equal(pkg.files, undefined, '不設 files(發布範圍由 .npmignore 決定)')
            assert.equal(pkg.name, 'w-knowledge-summarize')
            assert.deepEqual([pkg.repository.type, pkg.repository.url], ['git', 'git+https://github.com/yuda-lyu/w-knowledge-summarize.git'])
            assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.length >= 3 && typeof pkg.author === 'string' && pkg.author.length > 0, 'keywords 與 author 須有')
            // sgud/(agent 之指引要求文件:經驗、處理要點、規則帳本、現況)入版控、不入 npm 包——.npmignore 明列;CLAUDE*.md 兩者皆不入
            const npmignore = (readText('.npmignore') || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
            const gitignore = (readText('.gitignore') || '').split(/\r?\n/).map((l) => l.trim())
            for (const l of ['sgud', 'CLAUDE*.md', 'tmp', 'test/_tmp', 'test/*.test.mjs', 'test/golden', 'docs', '.env']) assert.ok(npmignore.includes(l), `.npmignore 須列 ${l}`)
            assert.ok(!npmignore.some((l) => /^\/?test\/?(tools\/?)?$/.test(l) || /^\/?test\/tools/.test(l) || /^\/?(src|dist)\/?$/.test(l)), '.npmignore 不得排除 test 夾整體、test/tools、src、dist(下游取用 test/tools)')
            assert.ok(gitignore.includes('CLAUDE*.md') && !gitignore.some((l) => /^!?sgud/.test(l) || l === '!CLAUDE.md'), '.gitignore 須列 CLAUDE*.md、不得排除 sgud、不得加 !CLAUDE.md')
            // 自有套件根目錄範本檔(編譯、文件、風格與安全政策)
            for (const f of ['.editorconfig', '.eslintignore', '.eslintrc.js', '.jsdoc', 'babel.config.js', 'SECURITY.md', 'g.mjs', 'README.md', 'LICENSE', 'script.txt', 'toolg/addVersion.mjs', 'toolg/modifyReadme.mjs', 'toolg/cleanFolder.mjs', 'toolg/gDocsExams.mjs', 'toolg/gDistRollup.mjs', 'test/tools/summarizeTestKit.mjs']) {
                assert.ok(fs.existsSync(`${ROOT}/${f}`), `套件根須有 ${f}`)
            }
            const lic = readText('LICENSE') || ''
            assert.equal(pkg.license, 'MIT')
            assert.ok(lic.startsWith('MIT License') && lic.includes(`Copyright (c) 2026 ${pkg.author}`), 'LICENSE 須為 MIT 並署名作者')
        })

        it('範例 g.mjs 離線可直接執行(不連網、不呼叫真 AI、不留工作目錄),輸出與檔末 `// =>` 逐行相符;README 之 Example 含 g.mjs 全文', () => {
            // 規則:自有套件根目錄 g.mjs 為可直接執行之範例,README 之 Example 連該檔(改 g.mjs 須同步 README)
            const g = (readText('g.mjs') || '').replace(/\r\n/g, '\n')
            const rd = (readText('README.md') || '').replace(/\r\n/g, '\n')
            assert.ok(g.length > 1000 && rd.includes(g.trimEnd()), 'README 之 Example 須含 g.mjs 全文')
            const lines = g.split('\n')
            const at = lines.findIndex((l) => l.startsWith('// => '))
            assert.ok(at > 0, 'g.mjs 檔末須附 `// =>` 輸出')
            const want = lines.slice(at).filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ => /, '').replace(/^\/\/ ?/, ''))
            const cwd = tmpRoot('pkg-g-mjs')
            fs.mkdirSync(cwd, { recursive: true })
            try {
                // 以 g.mjs 之位置載入 src,工作目錄(./_test_knowledge_summarize)落在暫存夾,與套件根無關
                const out = execFileSync(process.execPath, [`${ROOT}/g.mjs`], { cwd, encoding: 'utf8', timeout: 120_000 })
                assert.deepEqual(out.replace(/\r\n/g, '\n').trimEnd().split('\n'), want)
                assert.equal(fs.existsSync(`${cwd}/_test_knowledge_summarize`), false, '範例結束須清掉工作目錄')
            }
            finally {
                removeRoots([cwd])
            }
        })

        it('發布內容(README、*.csv、非測試 .mjs)不含宿主之痕跡:磁碟機絕對路徑(含字串字面中之跳脫形)與使用者目錄;test/ 內不計', () => {
            // 判準自檢:被抓到與不誤判(盤符之相對寫法、網址、正斜線之範例路徑不算)
            for (const s of ['C:\\work\\x', "'d:\\\\kb'", '/Users/me/x', 'C:/Users/me']) assert.ok(HOST_PATH.test(s), s)
            for (const s of ['c:/kb/db', "workDir: 'd:/my-kb'", 'https://a.example/b', 'a:b', '相對\\路徑']) assert.ok(!HOST_PATH.test(s), s)
            const files = [...sourceFiles('.mjs').filter((f) => !f.startsWith('test/')), ...sourceFiles('.csv').filter((f) => !f.startsWith('test/')), 'README.md']
            assert.ok(files.length >= 45 && files.some((f) => f.endsWith('.csv')), `掃描量過少或漏 csv：${files.length}`)
            const bad = []
            for (const f of files) {
                (readText(f) || '').split('\n').forEach((l, i) => {
                    if (HOST_PATH.test(l)) bad.push(`${f}:${i + 1} ${l.trim().slice(0, 80)}`)
                })
            }
            assert.deepEqual(bad, [])
        })
    })

    // ═══════════════════════ ③ 預設領域中立 ═══════════════════════
    describe('③ 預設領域中立', () => {
        /**
         * 特定產業領域之詞彙(中英;預設內容不得含):詞表與命中函數取抓取套件之 test/tools/domainTerms(經 test/tools/captureForTest;四套件同一份)。英文詞前後不得為字母數字或連字號
         *   (quantum 為物理詞;識別字、檔名與模型條目 id 之連字號片段——如存量處置帳之 stock-fix.jsonl、xxx-alpha-free——不是領域詞)
         */
        const hits = domainTermsIn
        /** 值含函數與 RegExp 時之可掃描文字 */
        const textOf = (v) => JSON.stringify(v, (k, x) => (typeof x === 'function' || x instanceof RegExp ? String(x) : x))
        let root = ''
        before(() => {
            root = tmpRoot('summarize-package')
        })
        after(() => {
            removeRoots([root])
        })

        it('詞表自檢:領域詞被抓到;中立題材、物理詞、識別字與模型條目 id 之片段不誤傷', () => {
            assert.deepEqual(hits('量化交易之股票回測與樣本外、市場報酬、倖存者與窺探'), ['量化', '交易', '股票', '回測', '樣本外', '報酬', '市場', '倖存者', '窺探'])
            assert.deepEqual(hits('Quant trading stock backtests sharpe alpha portfolio'), ['quant', 'trading', 'stock', 'backtest', 'portfolio', 'sharpe', 'alpha'])
            assert.deepEqual(hits('天文學知識庫：quantum tunneling、docStockFix、stock-fix.jsonl、oc:opencode/fledge-alpha-free、future work'), [])
        })

        it('預設設定(resolveSummarizeSettings({}) 與預設常數)、預設詞彙(含預設 guide 與解析後之詞彙)不含領域詞彙', () => {
            const all = {
                settingsResolved: resolveSummarizeSettings({}),
                settingsDefault: [SUMMARIZE_DEFAULT, SUMMARIZE_AI_DEFAULT],
                vocabDefault: SUMMARIZE_VOCAB_DEFAULT,
                vocabResolved: resolveSummarizeVocab({}),
                guideNeutral: guideDefaultOf(''),
                guideWithDomain: guideDefaultOf('天文學'),
            }
            for (const [k, v] of Object.entries(all)) assert.deepEqual(hits(textOf(v)), [], `預設「${k}」含領域詞彙`)
        })

        it('預設提示詞(預篩、摘要、忠實性覆核、修補、重標之固定輸入;無詞彙與 { domain:"天文學" } 兩組)不含領域詞彙', () => {
            for (const vocab of [null, { domain: '天文學' }]) {
                const prompts = renderSummarizePrompts(vocab)
                assert.ok(Object.keys(prompts).length >= 5)
                for (const [name, p] of Object.entries(prompts)) assert.deepEqual(hits(p), [], `${JSON.stringify(vocab)}:${name}`)
            }
        })

        it('零設定組裝之 info()(設定、詞彙、資料、生效之 domain 之詞彙表)不含領域詞彙;提示詞首句之稱呼為通用「知識庫」', () => {
            const info = createKnowledgeSummarize({ workDir: `${root}/zero`, aiAdapter: scriptedAi(), netGuard: null, lock: false }).info()
            assert.deepEqual(hits(textOf({ settings: info.settings, vocab: info.vocab, data: info.data, domainVocab: info.domains.summarize.vocab })), [])
            assert.ok(info.domains.triage.buildPrompt([]).startsWith('你是知識庫的預篩器'))
        })

        it('README、package.json 與原始碼(src/ 非評分者,另含套件根之 g.mjs 與 toolg/;不含測試;含註解、日誌與待判字樣)不含領域詞彙', () => {
            const files = sourceFiles().filter((f) => !f.startsWith('test/') && !f.startsWith('src/bench/'))
            assert.ok(files.includes('g.mjs') && files.some((f) => f.startsWith('toolg/')), '掃描須含 g.mjs 與 toolg/')
            assert.ok(files.length >= 45, `掃描量過少：${files.length}`)
            const bad = []
            for (const f of [...files, 'package.json', 'README.md']) {
                const h = hits(readText(f) || '')
                if (h.length) bad.push(`${f}：${h.join('、')}`)
            }
            assert.deepEqual(bad, [])
        })
    })

    // ═══════════════════════ ④ 舊名、沿革與面向使用者之字樣 ═══════════════════════
    describe('④ 舊名、沿革與面向使用者之字樣(README、package.json 與原始碼〔含 bench/*.mjs;不含測試〕;判準取抓取套件之 test/tools/historyMarks)', () => {
        // 舊名:已不存在之套件名與以 extract 指稱摘要之名(下游處理時刻之記錄欄 extractedAt 屬資料契約,不在此列)
        const OLD = /w-knowledge-extract|KnowledgeExtract|extractOpt|\bextract\b|srcPack/
        // 他工作之名:下游之工作一律稱下游;md 版型之章名(NON_CONTENT_SECTIONS——「關聯」章等)與關聯與衝突章為資料契約,不在此列
        const OTHER_JOBS = /提煉|鄰居|(?<!「)關聯(?!與衝突章|」)/
        const OTHER_JOBS_TEXT = /提煉|(?<!「)關聯(?!與衝突章)|鄰居/
        // 本套件較嚴之加項:寬式之帳本代號、裸寫之審查代稱、字面之日期(範例資料一律不帶年月日之字面)、執行端之指令(含本套件之舊子命令名)
        const LEDGER_WIDE = /\b[A-Z]{2,5}-\d{2,3}\b/
        const CLI = new RegExp(`${HOST_CLI.source}|revive-failed`)
        // 具名例外(只此一項):提示詞之原文——改即改提示詞與題目識別(既有評比失效),須經正式席位之評比才改
        const ALLOW = [{ file: 'src/domain/noteDomain.mjs', mark:'他工作', token: '跨篇關聯與提煉', why: '摘要提示詞之原文(concepts 之用途說明)' }]
        const LINE = {
            old: OLD, allow: ALLOW, contractNames: NON_CONTENT_SECTIONS,
            extra: [['審查代稱', /終審|方案|CLAUDE/], ['帳本代號(寬)', LEDGER_WIDE], ['日期(字面)', /\b20\d\d-\d\d-\d\d\b/], ['執行端之指令', CLI], ['他工作', OTHER_JOBS]],
        }
        // 字串字面另禁「CLI」(面向使用者之字樣指本套件之 API);README 之「CLI」為 AI 之種類(opencode CLI 等),不在此列
        const USER = { cli: new RegExp(`${CLI.source}|\\bCLI\\b`), otherJobs: OTHER_JOBS_TEXT, extra: [['帳本代號(寬)', LEDGER_WIDE]], allow: ALLOW, contractNames: NON_CONTENT_SECTIONS }
        const README_USER = { cli: CLI, otherJobs: OTHER_JOBS_TEXT, extra: [['帳本代號(寬)', LEDGER_WIDE]] }
        const files = () => [...sourceFiles().filter((x) => !x.startsWith('test/')), 'package.json', 'README.md']
        // 題組(src/bench/cases/*.json)之說明文字(頂層 note 與各案之 why)亦掃:說明屬原始碼之一部分,不得帶沿革;材料與應然為題材,不掃
        const caseDocs = () => sourceFiles('.json').filter((x) => x.startsWith('src/bench/cases/')).flatMap((f) => benchCaseNotesOf(f, readText(f) || ''))

        it('判準自檢:舊名、沿革、執行端之指令、他工作與帳本代號被抓到;md 版型之章名、本套件之 API 名與記錄欄不誤判;掃描範圍含題組檔之說明(note 與各案之 why,不含材料)', () => {
            const cd = caseDocs()
            assert.ok(cd.filter((d) => /#note$/.test(d.file)).length >= 5 && cd.filter((d) => /\.why$/.test(d.file)).length >= 50, `題組之說明須在掃描範圍:${cd.length}`)
            assert.deepEqual(benchCaseNotesOf('x.json', '{"note":"說明","cases":[{"id":"a","why":"理由","input":{"text":"SHA-256 之審查"}}]}'), [{ file: 'x.json#note', text: '說明' }, { file: 'x.json#a.why', text: '理由' }], '只取說明,不取材料')
            const line = (s) => historyHitsOf(s, LINE)
            const user = (s) => userTextHitsOf(s, USER)
            assert.ok(OLD.test('const extractOpt = 1') && OLD.test('w-knowledge-extract') && OLD.test('srcPack/summarize') && !OLD.test('extractedAt、touchExtracted'), '舊名')
            assert.deepEqual([user('以 notes 工具明示刪除'), user('使用者處置：standards holds retry'), user('以 CLI 重開')], [['執行端之指令'], ['執行端之指令'], ['執行端之指令']])
            assert.deepEqual([user('關聯將重判、鄰居重投'), user('提煉段將依內容鍵偵測'), user('（STD-07）')], [['他工作'], ['他工作'], ['規則帳本代號', '帳本代號(寬)']])
            for (const s of ['不覆寫關聯與衝突章', '使用者重開（reviveFailedDocs）：要求重試（requestRetry）或豁免（waiveHold）', 'SS14 判不了；SS9 待判', '關聯']) assert.deepEqual(user(s), [], s)
            assert.deepEqual([line('// 2026-10-10 剖析'), line("collectedAt: '2026-09-01'"), line('// 見終審與方案'), line('// 如關聯理由')], [['日期', '日期(字面)'], ['日期(字面)'], ['審查代稱'], ['他工作']])
            for (const s of ["export const NON_CONTENT_SECTIONS = ['來源', '關聯', '⚠ 衝突與反例']", '// 下游投影之「關聯」「⚠ 衝突與反例」章', "'2026-01-01T08:00:00+08:00'"]) assert.deepEqual(line(s), [], s)
        })

        it('掃描器自檢:取得字串字面(含樣板字面之文字段與運算式內之字串)、不含註解;本套件之已知字樣取得到', () => {
            assert.deepEqual(lexSource("const a = 'x' // 註解 '不取'\nlog(`甲${b ? 'c' : ''}乙`) /* '亦不取' */").strings, ['x', 'c', '', '甲\u0000乙'])
            const ns = lexSource(readText('src/stages/noteStage.mjs') || '')
            assert.ok(ns.strings.includes('摘要：未開 holds 集合，未達檢定標準之不納入與其終態未登錄待判'))
            assert.ok(ns.strings.some((s) => s.startsWith('使用者判讀：要求重試（requestRetry')))
            assert.ok(!/【納入閘】/.test(ns.code), '註解不入程式碼')
            assert.ok(lexSource(readText('src/ops/reviveFailed.mjs') || '').strings.some((s) => s.startsWith('使用者重開（reviveFailedDocs）')))
        })

        it('不含舊名、沿革指標、執行端之指令與他工作之名(逐行,含註解;題組檔之說明同判;具名例外只一項且仍有對象)', () => {
            const docs = [...files().map((f) => ({ file: f, text: readText(f) || '' })), ...caseDocs()]
            assert.ok(docs.length >= 50, `掃描量過少：${docs.length}`)
            assert.deepEqual(historyScanOf(docs, LINE), [])
        })

        it('面向使用者之字樣(原始碼之字串字面——日誌、訊息、拋錯、待判之原因與下一步——與 README)不含執行端之指令、他工作之名與帳本代號', () => {
            const src = files().filter((f) => f.endsWith('.mjs')).map((f) => ({ file: f, strings: lexSource(readText(f) || '').strings }))
            assert.ok(src.reduce((n, d) => n + d.strings.length, 0) >= 2000, '字串字面過少(掃描空洞)')
            assert.deepEqual(userTextScanOf(src, USER), [])
            assert.deepEqual(userTextScanOf([{ file: 'README.md', strings: [readText('README.md') || ''] }], README_USER), [])
        })
    })
})
