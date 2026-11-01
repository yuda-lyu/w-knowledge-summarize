// unit-core.test.mjs — 摘要套件之核心件(core/):md(frontmatter 讀寫與章節)、md/noteContent(內容章與來源章欄位)、
//   standards/panel(AI 標準之判定小組、未成立原因之字樣表)、standards/panelConfig(判定小組之設定面)、standards/panelRun(判定小組之單頁執行器)、
//   standards/numbers(數字紮根)、
//   vocab/conceptGroups(概念詞彙表、標籤清理建議與可疑標籤)
//   批次 AI harness 另見 unit-ai-batch;待判登錄屬抓取套件(其 unit-holds)
// 執行:自套件根 npx mocha test/unit-core.test.mjs(暫存落 test/_tmp/core-<pid>,測完即刪;不發網路、不呼叫 AI)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { memStore, setConceptFold, conceptFoldsOf } from './tools/captureForTest.mjs'
import { renderFrontmatter, parseFrontmatter, writeMd, mdText, readMd, section, sectionOf, dropSection, summaryTextOf, SUMMARY_SECTION } from '../src/core/md/md.mjs'
import { NON_CONTENT_SECTIONS, noteContentText, sectionBodyOf, sectionItemsOf, originalTitleOf, publishedOf, evidenceNoteOf, noteMaterialText } from '../src/core/md/noteContent.mjs'
import { PANEL_UNSURE, PANEL_WHY, PANEL_WHY_LABELS, decidePanel, needThird, panelSeats } from '../src/core/standards/panel.mjs'
import { PANEL_SCHEMA, panelGroupOf, panelFindingsOf, panelSameProviderWarnings, panelSeatRowsOf } from '../src/core/standards/panelConfig.mjs'
import { PANEL_STAGES, PANEL_THIRD_STOP, runPanelPage } from '../src/core/standards/panelRun.mjs'
import { sha1 } from '../src/core/capturePackage.mjs'
import { createSummarizeDomain } from '../src/domain/noteDomain.mjs'
import N from '../src/core/standards/numbers.mjs'
import { conceptVocabulary, suggestConceptRenames, tagSuspects } from '../src/core/vocab/conceptGroups.mjs'

// 暫存路徑由本檔位置推導(與 cwd 無關);帶 pid 後綴使並行之多個 mocha 行程互不干擾;after 清除
const TMP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), `_tmp/core-${process.pid}`).replace(/\\/g, '/')

describe('unit-core', function() {

    before(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        fs.mkdirSync(TMP, { recursive: true })
        setConceptFold(null) // 概念折疊為模組級單例:本檔之「未注入折疊」案例不依賴他檔是否清乾淨
    })

    after(function() {
        fs.rmSync(TMP, { recursive: true, force: true })
        setConceptFold(null)
    })

    // ══════════════════════════ md/md ══════════════════════════
    describe('md/md', function() {

        it('renderFrontmatter：front 非物件視為{}；有效輸入輸出正確區塊', () => {
            assert.equal(renderFrontmatter('bad'), '---\n---')
            assert.equal(renderFrontmatter({ title: 'T', tags: ['a', 'b'], n: 3, ok: true }), '---\ntitle: "T"\ntags: ["a", "b"]\nn: 3\nok: true\n---')
        })

        it('parseFrontmatter：還原純量與字串陣列；無 frontmatter 區塊時 front 為空、body 為全文', () => {
            const { front, body } = parseFrontmatter('---\ntitle: "T"\ntags: ["a", "b"]\n---\n\n內文')
            assert.deepEqual(front, { title: 'T', tags: ['a', 'b'] })
            assert.equal(body, '\n內文')
            const p2 = parseFrontmatter('no frontmatter here')
            assert.deepEqual(p2.front, {})
            assert.equal(p2.body, 'no frontmatter here')
        })

        it('writeMd：file 非有效字串拋錯；front 非物件視為{}；body 非字串視為""(不得寫入字面 "undefined")', () => {
            assert.throws(() => writeMd(undefined, {}, 'x'), /writeMd 需要 file（檔案路徑字串）/)
            assert.throws(() => writeMd(123, {}, 'x'), /writeMd 需要 file（檔案路徑字串）/)

            const f1 = `${TMP}/undef.md`
            writeMd(f1, { title: 'X' }, undefined)
            const c1 = fs.readFileSync(f1, 'utf8')
            assert.doesNotMatch(c1, /undefined/, 'body 為 undefined 時不得把字面 undefined 寫入筆記')
            assert.equal(c1, '---\ntitle: "X"\n---\n\n\n')

            const f2 = `${TMP}/badfront.md`
            writeMd(f2, 'bad-front', 'body ok')
            assert.equal(fs.readFileSync(f2, 'utf8'), '---\n---\n\nbody ok\n')

            const f3 = `${TMP}/valid.md`
            writeMd(f3, { title: 'A' }, '# A\n\n內文')
            assert.equal(fs.readFileSync(f3, 'utf8'), '---\ntitle: "A"\n---\n\n# A\n\n內文\n')
        })

        it('readMd：file 非有效字串回 null；讀不到檔回 null；有效檔案讀回 front/body', () => {
            assert.equal(readMd(undefined), null)
            assert.equal(readMd(123), null)
            assert.equal(readMd(`${TMP}/not-exist.md`), null)
            const f = `${TMP}/read.md`
            writeMd(f, { title: 'R' }, 'body')
            const r = readMd(f)
            assert.equal(r.front.title, 'R')
            assert.equal(r.body.trim(), 'body')
        })

        it('section：content 為陣列時過濾空白項並轉清單；空內容回傳空字串', () => {
            assert.equal(section('重點', ['a', '', 'b']), '## 重點\n\n- a\n- b')
            assert.equal(section('重點', ''), '')
        })

        it('sectionOf：找出指定 H2 章節,不動其他章節', () => {
            const body = '前言\n\n## 甲\n\n內容甲\n\n## 乙\n\n內容乙'
            assert.deepEqual(sectionOf(body, '甲'), { start: 4, end: 14, text: '## 甲\n\n內容甲\n' })
            assert.equal(sectionOf('無此章節', '甲'), null)
        })

        it('frontmatter 往返：含逗號/引號的陣列元素、數字、布林', () => {
            const front = { title: '含"引號"與,逗號', tags: ['a,b', 'c"d'], n: 3, ok: true }
            const { front: back } = parseFrontmatter(renderFrontmatter(front) + '\n\nbody')
            assert.equal(back.title, front.title)
            assert.deepEqual(back.tags, front.tags)
            assert.equal(back.n, 3)
            assert.equal(back.ok, true)
        })

        it('frontmatter 往返：值含單獨 \\r、U+2028、U+2029 → 寫出時壓成空格、解析不丟鍵;含這些字元之既有值亦解析得回(不再整鍵消失)', () => {
            const LS = String.fromCharCode(0x2028)
            const PS = String.fromCharCode(0x2029)
            const front = { title: `甲\r乙${LS}丙${PS}丁\r\n戊`, tags: [`a\rb`, `c${LS}d`] }
            const text = renderFrontmatter(front) + '\n\nbody'
            assert.ok(!new RegExp(`[\\r${LS}${PS}]`).test(text.split('---')[1]), '寫出之 frontmatter 不含換行類字元')
            const { front: back } = parseFrontmatter(text)
            assert.equal(back.title, '甲 乙 丙 丁 戊')
            assert.deepEqual(back.tags, ['a b', 'c d'])
            // 既有檔之值內含單獨 \r:解析仍取得該鍵(若 `.*` 不跨 \r 則整鍵解析不回,再被 {...md.front} 重寫時永久消失)
            const old = `---\ntitle: "甲\r乙"\nrelated: ["x"]\n---\n\nbody`
            const { front: b2 } = parseFrontmatter(old)
            assert.equal(b2.title, '甲\r乙')
            assert.deepEqual(b2.related, ['x'])
        })

        it('mdText：front 非物件視為{}、本文去頭尾空白後補單一換行;與 writeMd 寫出者逐字相同', () => {
            assert.equal(mdText({}, 'x'), '---\n---\n\nx\n')
            assert.equal(mdText('bad', undefined), '---\n---\n\n\n', 'front 非物件視為{}、body 非字串視為空')
            assert.equal(mdText({ title: 'T' }, '\n# 內容\n\n'), '---\ntitle: "T"\n---\n\n# 內容\n')
            const f = `${TMP}/mdtext.md`
            writeMd(f, { title: 'T', n: 1 }, '# 內容\n\n- a')
            assert.equal(fs.readFileSync(f, 'utf8'), mdText({ title: 'T', n: 1 }, '# 內容\n\n- a'))
        })

        it('sectionOf：止於下一個 H2(章序不拘);章名行容 CRLF 與章名後空白;章名含正則特殊字元仍精確比對;章名須整行相符', () => {
            const body = '前言\n\n## 乙\n\n內容乙\n\n## 甲\n\n內容甲'
            assert.equal(sectionOf(body, '乙').text, '## 乙\n\n內容乙\n', '章在前時止於下一章')
            assert.equal(sectionOf(body, '甲').text, '## 甲\n\n內容甲', '章為最後一章時止於檔尾')
            assert.ok(sectionOf('## 甲 \r\n\r\n內容\r\n\r\n## 乙\r\n\r\n內容乙', '甲'), 'CRLF 與章名後空白容之')
            assert.equal(sectionOf('## ⚠ 衝突與反例\n\nx', '⚠ 衝突與反例').start, 0)
            assert.equal(sectionOf('## 甲(1)\n\nx', '甲(1)').start, 0, '括號為字面')
            assert.equal(sectionOf('## 甲乙\n\nx', '甲'), null, '章名須整行相符')
            assert.equal(sectionOf(null, '甲'), null)
        })

        it('dropSection：只移除該章(章序不拘、不動其後章)、整理空行;無此章回去尾空白之原文;章名行容 CRLF;null 視為空字串', () => {
            const body = '前言\n\n## 甲\n\n內容甲\n\n## 乙\n\n內容乙'
            assert.equal(dropSection(body, '甲'), '前言\n\n## 乙\n\n內容乙', '中間章')
            assert.equal(dropSection(body, '乙'), '前言\n\n## 甲\n\n內容甲', '最後一章')
            assert.equal(dropSection('## 甲\n\n內容甲\n\n## 乙\n\nx', '甲'), '## 乙\n\nx', '第一章')
            assert.equal(dropSection(`${body}\n\n`, '丙'), body, '無此章 → 去尾空白之原文')
            assert.equal(dropSection('## 甲 \r\n\r\n內容\r\n\r\n## 乙\r\n\r\nx', '甲'), '## 乙\r\n\r\nx', 'CRLF 之章名行亦找得到')
            assert.equal(dropSection(null, '甲'), '')
        })

        it('summaryTextOf：取「一句話重點」章全文(CRLF 轉 LF、空白類壓成單一空白);無此章或 md 無效回 null', () => {
            assert.equal(SUMMARY_SECTION, '一句話重點')
            const body = '# T\n\n## 一句話重點\n\n第一行\n第二行\n\n## 核心知識\n\n- k'
            assert.equal(summaryTextOf({ front: {}, body }), '第一行 第二行')
            assert.equal(summaryTextOf({ front: {}, body: body.replace(/\n/g, '\r\n') }), '第一行 第二行', 'CRLF 檔同')
            assert.equal(summaryTextOf({ front: {}, body: '# T\n\n## 核心知識\n\n- k' }), null, '無此章')
            assert.equal(summaryTextOf(null), null)
            assert.equal(summaryTextOf('x'), null)
            // 與 writeMd／readMd 往返:章為最後一章亦可
            const f = `${TMP}/summary.md`
            writeMd(f, { title: 'T' }, '# T\n\n## 一句話重點\n\n只有一章')
            assert.equal(summaryTextOf(readMd(f)), '只有一章')
        })
    })

    // ══════════════════════════ md/noteContent ══════════════════════════
    describe('md/noteContent', function() {

        /** 筆記本文夾具(來源章帶原文標題與發布時間,可附任意尾章) */
        const BODY = (o = {}) => [
            `# ${o.title || '動量因子之台股實證'}`, '',
            '## 一句話重點', '', o.summary ?? '台股十二減一月動量年化超額 8.2%。', '',
            '## 品質與證據標注', '', '- 內容類型：實證研究', `- 證據等級：${o.level || '中'}`, '- 數據樣本期間：2010-2020', ...(o.caveats || ['⚠ 無交易成本']).map((c) => `- ${c}`), '',
            '## 核心知識', '', ...(o.kps ?? ['- 動量年化超額 8.2%']), '',
            '## 來源', '', `- 原文標題：${o.origTitle || '動量研究'}`, '- 來源：測試', '- 網址：https://x.test/a', `- 發布時間：${o.published || '2026-09-01 08:00:00'}`, '- 內文取得方式：原網頁全文', '',
            ...(o.tail ? [o.tail] : []),
        ].join('\n')

        it('內容章、原文標題:內容章不含來源章與下游投影章;原文標題取來源章「原文標題：」行', () => {
            const body = BODY({ tail: '## 關聯\n\n- 關聯行' })
            assert.ok(!noteContentText(body).includes('原文標題') && !noteContentText(body).includes('關聯行'))
            assert.equal(originalTitleOf(body), '動量研究')
        })

        it('sectionBodyOf／originalTitleOf／noteContentText：去章標題行、無此章回空字串、CRLF 容之;「（無）」視為無原文標題;內容章保留「# 標題」行', () => {
            const body = '# 標題\n\n## 一句話重點\n\n重點\n\n## 來源\n\n- 原文標題：（無）\n- 來源：x\n\n## 關聯\n\n- r\n\n## ⚠ 衝突與反例\n\n- c'
            assert.equal(sectionBodyOf(body, '一句話重點'), '重點')
            assert.equal(sectionBodyOf(body, '不存在'), '')
            assert.equal(sectionBodyOf(body.replace(/\n/g, '\r\n'), '一句話重點'), '重點', 'CRLF')
            assert.equal(originalTitleOf(body), '', '「（無）」視為無原文標題')
            assert.equal(originalTitleOf('## 來源\n\n- 原文標題：甲\n'), '甲')
            assert.equal(originalTitleOf('## 來源\n\n原文標題：乙'), '乙', '無「- 」前綴者亦可')
            assert.equal(originalTitleOf(null), '')
            assert.equal(noteContentText(body), '# 標題\n\n## 一句話重點\n\n重點\n')
            assert.deepEqual(NON_CONTENT_SECTIONS, ['來源', '關聯', '⚠ 衝突與反例'])
        })

        it('sectionItemsOf:某章之條列項(「- 」「* 」起首之行,去前綴與頭尾空白、略空項與非條列行);無此章回 [];CRLF 容之——下游讀條列章之讀法只此一份', () => {
            // 規則:noteContent.sectionItemsOf 之 JSDoc
            const body = '# 標題\n\n## 核心知識\n\n- 甲\n*   乙 \n文字行\n- \n  - 丙\n\n## 適用條件與限制\n\n- 丁\n'
            assert.deepEqual(sectionItemsOf(body, '核心知識'), ['甲', '乙', '丙'])
            assert.deepEqual(sectionItemsOf(body, '適用條件與限制'), ['丁'])
            assert.deepEqual([sectionItemsOf(body, '不存在'), sectionItemsOf(null, '核心知識'), sectionItemsOf(body.replace(/\n/g, '\r\n'), '核心知識')], [[], [], ['甲', '乙', '丙']])
        })

        it('evidenceNoteOf:「品質與證據標注」章之「證據等級：X（說明）」之括號內文;無說明、無此章、他章同形之行皆回空字串;說明內之括號保留', () => {
            assert.equal(evidenceNoteOf('## 品質與證據標注\n\n- 內容類型：實證研究\n- 證據等級：高（經兩個團隊獨立重現）\n- 數據樣本期間：未載明\n'), '經兩個團隊獨立重現')
            assert.equal(evidenceNoteOf('## 品質與證據標注\n\n- 證據等級：中\n'), '', '無說明')
            assert.equal(evidenceNoteOf('## 核心知識\n\n- 證據等級：高（不在品質章）\n'), '', '他章同形之行不取')
            assert.equal(evidenceNoteOf('## 品質與證據標注\r\n\r\n- 證據等級：高（甲（乙）丙）\r\n'), '甲（乙）丙', 'CRLF;說明內之括號保留')
            assert.equal(evidenceNoteOf(null), '')
        })

        it('publishedOf(有行):來源章「發布時間：」行之值(去頭尾空白);以本套件之筆記版型(renderNoteBody)產出之 md 為材料亦取得', () => {
            assert.equal(publishedOf(BODY()), '2026-09-01 08:00:00')
            assert.equal(publishedOf(BODY({ published: '  2026-01-02T03:04:05+08:00  ' })), '2026-01-02T03:04:05+08:00', '去頭尾空白')
            const d = createSummarizeDomain({})
            const md = (doc) => d.renderNoteBody({ title: 'T', summary: 's', key_points: ['k'] }, { title: '原文甲', sourceName: '來源乙', url: 'https://x.test/a', ...doc }, d.normalizeQuality({}))
            assert.equal(publishedOf(md({ publishedAt: '2026-09-01T08:00:00+08:00' })), '2026-09-01T08:00:00+08:00', '本套件之版型:有發布時間')
            assert.equal(originalTitleOf(md({ publishedAt: '2026-09-01' })), '原文甲', '同一份 md 之原文標題亦取得(同一章之兩欄)')
            assert.equal(publishedOf(md({ publishedAt: '2026-09-01', textFrom: 'feed' })), '2026-09-01', '內文取得方式在其後之行不影響')
        })

        it('publishedOf(缺行):版型之「（未提供）」、無此行、無來源章、空值、null／undefined 皆回空字串', () => {
            const d = createSummarizeDomain({})
            const md = d.renderNoteBody({ title: 'T', summary: 's', key_points: ['k'] }, { title: 't', sourceName: 's', url: 'u' }, d.normalizeQuality({}))
            assert.match(md, /- 發布時間：（未提供）/, '前提:本套件之版型於未提供時寫缺值字樣')
            assert.equal(publishedOf(md), '', '本套件之版型:未提供 → 空字串')
            assert.equal(publishedOf(BODY({ published: '（未提供）' })), '')
            assert.equal(publishedOf('## 來源\n\n- 原文標題：甲\n- 來源：乙\n'), '', '無此行')
            assert.equal(publishedOf('# T\n\n## 核心知識\n\n- k'), '', '無來源章')
            assert.equal(publishedOf('## 來源\n\n- 發布時間：\n'), '', '空值')
            assert.equal(publishedOf('## 來源\n\n- 發布時間：   \n'), '', '只有空白')
            assert.equal(publishedOf(null), '')
            assert.equal(publishedOf(undefined), '')
        })

        it('publishedOf(格式異常):只認來源章之行(他章同形之行不取);無「- 」前綴者亦取;CRLF 容之;取第一行;全形冒號為準(半形冒號不認)', () => {
            assert.equal(publishedOf('## 核心知識\n\n- 發布時間：2020-01-01\n\n## 來源\n\n- 原文標題：甲\n'), '', '他章同形之行不取')
            assert.equal(publishedOf('## 核心知識\n\n- 發布時間：2020-01-01\n\n## 來源\n\n- 發布時間：2026-02-03\n'), '2026-02-03', '他章與來源章皆有 → 取來源章')
            assert.equal(publishedOf('## 來源\n\n發布時間：2026-02-03'), '2026-02-03', '無「- 」前綴')
            assert.equal(publishedOf('## 來源\r\n\r\n- 發布時間：2026-02-03\r\n- 內文取得方式：x\r\n'), '2026-02-03', 'CRLF')
            assert.equal(publishedOf('## 來源\n\n- 發布時間：甲\n- 發布時間：乙\n'), '甲', '重複之行取第一行')
            assert.equal(publishedOf('## 來源\n\n- 發布時間:2026-02-03\n'), '', '半形冒號不是版型')
            assert.equal(publishedOf('## 來源\n\n- 原文發布時間：2026-02-03\n'), '', '行首須為「發布時間：」(或「- 」)')
            assert.equal(publishedOf(BODY({ tail: '## 關聯\n\n- 發布時間：2000-01-01' })), '2026-09-01 08:00:00', '來源章後之投影章同形之行不影響')
        })

        it('noteMaterialText:原文標題＋換行＋內容章(不含來源章與下游投影章);無原文標題者首行為空', () => {
            const body = BODY({ origTitle: '原文甲', tail: '## 關聯\n\n- 關聯行 99' })
            assert.equal(noteMaterialText(body), `原文甲\n${noteContentText(body)}`)
            assert.ok(!noteMaterialText(body).includes('關聯行 99') && !noteMaterialText(body).includes('發布時間'), '投影章與來源章不入材料')
            assert.equal(noteMaterialText('# T\n\n## 核心知識\n\n- k'), '\n# T\n\n## 核心知識\n\n- k', '無來源章 → 原文標題為空')
            assert.equal(noteMaterialText(null), '\n')
        })
    })

    // ══════════════════════════ standards/panel ══════════════════════════
    // 規格:兩席明確且一致、供應者不同才成立;兩席不一致 → 第三席(與成對之那票不同供應者)裁定;仍無多數 → 未能判定(入待判登錄);
    //   兩份成交之供應者相同 → 不算獨立;未能判定不算合格
    describe('standards/panel(判定小組)', function() {

        const V = (seat, provider, verdict) => ({ seat, provider, verdict })
        const same = (a, b) => a.verdict === b.verdict && (a.verdict !== 'change' || a.type === b.type)
        const keep = { verdict: 'keep' }
        const toA = { verdict: 'change', type: 'A' }
        const toB = { verdict: 'change', type: 'B' }

        it('兩席明確且一致、供應者不同 → 成立(裁決取先者,記兩供應者與席位)', () => {
            const d = decidePanel([V('first', 'p1', toA), V('second', 'p2', { ...toA, reason: '另一理由' })], { same })
            assert.deepEqual([d.status, d.verdict, d.by, d.seats, d.why], ['decided', toA, ['p1', 'p2'], ['first', 'second'], ''])
        })

        it('一致但同一供應者(遞補收斂)或供應者不明 → 未成立(same-provider);第三席不同供應者 → 可成立', () => {
            const two = [V('first', 'p1', keep), V('second', 'p1', keep)]
            assert.deepEqual(decidePanel(two, { same }), { status: 'undetermined', why: PANEL_WHY.SAME_PROVIDER })
            assert.equal(decidePanel([V('first', '', keep), V('second', 'p2', keep)], { same }).why, PANEL_WHY.SAME_PROVIDER)
            assert.equal(needThird(two, { same }), true)
            const d = decidePanel([...two, V('third', 'p3', keep)], { same })
            assert.deepEqual([d.status, d.by], ['decided', ['p1', 'p3']])
            // 第三席又是同一家 → 仍未成立
            assert.equal(decidePanel([...two, V('third', 'p1', keep)], { same }).status, 'undetermined')
        })

        it('不一致 → 未成立(disagree);change 之型別不同即不一致;第三席與其中一票成立', () => {
            const two = [V('first', 'p1', toA), V('second', 'p2', toB)]
            assert.deepEqual(decidePanel(two, { same }), { status: 'undetermined', why: PANEL_WHY.DISAGREE })
            assert.equal(needThird(two, { same }), true)
            const d = decidePanel([...two, V('third', 'p3', toB)], { same })
            assert.deepEqual([d.status, d.verdict, d.by], ['decided', toB, ['p2', 'p3']])
            // 第三席提出第三種 → 仍未成立
            assert.equal(decidePanel([...two, V('third', 'p3', keep)], { same }).why, PANEL_WHY.DISAGREE)
        })

        it('不確定為合法裁決:一席不確定 → 未成立(unsure)、可叫第三席與明確之一票成立;兩席皆不確定 → 不叫第三席', () => {
            const one = [V('first', 'p1', PANEL_UNSURE), V('second', 'p2', keep)]
            assert.deepEqual(decidePanel(one, { same }), { status: 'undetermined', why: PANEL_WHY.UNSURE })
            assert.equal(needThird(one, { same }), true)
            assert.equal(decidePanel([...one, V('third', 'p3', keep)], { same }).status, 'decided')
            const both = [V('first', 'p1', PANEL_UNSURE), V('second', 'p2', PANEL_UNSURE)]
            assert.equal(needThird(both, { same }), false)
            assert.equal(decidePanel(both, { same }).why, PANEL_WHY.UNSURE)
        })

        it('缺票(呼叫失敗或未涵蓋)→ 未成立(missing)、不叫第三席(第三席不是重試);少於兩票同', () => {
            const miss = [V('first', 'p1', keep), V('second', 'p2', null)]
            assert.deepEqual(decidePanel(miss, { same }), { status: 'undetermined', why: PANEL_WHY.MISSING })
            assert.equal(needThird(miss, { same }), false)
            assert.equal(decidePanel([V('first', 'p1', keep)], { same }).why, PANEL_WHY.MISSING)
            assert.equal(decidePanel(null).why, PANEL_WHY.MISSING)
        })

        it('已成立 → 不叫第三席;panelSeats 記供應者串(缺者 -)', () => {
            const two = [V('first', 'p1', keep), V('second', 'p2', keep)]
            assert.equal(needThird(two, { same }), false)
            assert.equal(panelSeats([...two, V('third', '', null)]), 'p1|p2|-')
        })

        it('未給 same → JSON 相等', () => {
            assert.equal(decidePanel([V('a', 'p1', 'supported'), V('b', 'p2', 'supported')]).status, 'decided')
            assert.equal(decidePanel([V('a', 'p1', 'supported'), V('b', 'p2', 'refuted')]).why, PANEL_WHY.DISAGREE)
        })

        it('PANEL_WHY_LABELS:未成立原因之字樣表(凍結;PANEL_WHY 之每一值恰一句)', () => {
            assert.ok(Object.isFrozen(PANEL_WHY_LABELS))
            assert.deepEqual(PANEL_WHY_LABELS, {
                [PANEL_WHY.MISSING]: '缺票（呼叫失敗或回覆不合格）',
                [PANEL_WHY.SAME_PROVIDER]: '一致之兩票為同一供應者',
                [PANEL_WHY.UNSURE]: '有席位不確定',
                [PANEL_WHY.DISAGREE]: '各席裁決不一致',
            })
        })
    })

    // ══════════════════════════ standards/panelConfig ══════════════════════════
    // 規格(panelConfig 檔頭):小組開啟＝以本小組為席之功能任一開啟;具 key 之成員之必填＝已開啟之功能所需之席(皆未開時以全部功能所需之席計);
    //   不具 key 之成員之必填依其定義;同家＝首選 use 相同,首兩票同家而無首選不同之第三席 → 警告(已開啟之小組才判);缺必填＝必填而無首選者
    describe('standards/panelConfig(判定小組之設定面)', function() {

        const S = (o = {}) => ({ x: { a: o.a === true, b: o.b === true, ai: { first: o.first ?? null, second: o.second ?? null, third: o.third ?? null } }, work: o.work ?? null })
        const F = [
            { key: 'a', on: (s) => s.x.a, panel: { path: 'x.ai', seats: ['first'] } },
            { key: 'b', on: (s) => s.x.b, panel: { path: 'x.ai', seats: ['first', 'second'] } },
            { key: 'c', on: () => false },
        ]
        const DEF = { std: 'X1', path: 'x.ai', name: '甲小組', members: (s) => [{ key: 'first', label: 'first', seat: s.x.ai.first }, { key: 'second', label: 'second', seat: s.x.ai.second }, { key: 'third', label: 'third', seat: s.x.ai.third }] }
        const p = (use) => ({ use })

        it('PANEL_SCHEMA:三席皆 seatOrNull(凍結)', () => {
            assert.deepEqual(PANEL_SCHEMA, { first: 'seatOrNull', second: 'seatOrNull', third: 'seatOrNull' })
            assert.ok(Object.isFrozen(PANEL_SCHEMA))
        })

        it('panelGroupOf:開啟由功能表推導;具 key 之成員之必填＝已開啟之功能所需之席(皆未開 → 全部功能所需之席);未設之席為 null;ballots 預設 [[0, 1, 2]]', () => {
            const req = (g) => g.members.map((m) => m.required)
            const off = panelGroupOf(DEF, S(), F)
            assert.deepEqual([off.std, off.path, off.name, off.on, req(off), off.ballots], ['X1', 'x.ai', '甲小組', false, [true, true, false], [[0, 1, 2]]], '皆未開:以全部功能所需之席計(開啟前須先改之提示)')
            assert.deepEqual([panelGroupOf(DEF, S({ a: true }), F).on, req(panelGroupOf(DEF, S({ a: true }), F))], [true, [true, false, false]], '只開 a:second 不必填')
            assert.deepEqual(req(panelGroupOf(DEF, S({ a: true, b: true }), F)), [true, true, false])
            assert.deepEqual(panelGroupOf(DEF, S({ first: p('u1') }), F).members.map((m) => m.seat), [{ use: 'u1' }, null, null])
            assert.equal(panelGroupOf(DEF, S(), [{ key: 'z', on: () => true, panel: { path: 'y.ai', seats: ['first'] } }]).on, false, '他小組之功能不影響本小組')
        })

        it('panelGroupOf:不具 key 之成員(工作席)之必填依其定義;ballots 可由定義給(收 settings 與已開啟之功能鍵之集合)', () => {
            const def = { ...DEF, members: (s) => [{ label: '工作席', seat: s.work, required: true }, ...DEF.members(s)], ballots: (s, on) => (on.has('b') ? [[0, 1, 3], [0, 2, 3]] : [[0, 1, 3]]) }
            const g = panelGroupOf(def, S({ a: true, work: p('w') }), F)
            assert.deepEqual(g.members.map((m) => [m.label, m.required]), [['工作席', true], ['first', true], ['second', false], ['third', false]])
            assert.deepEqual([g.ballots, panelGroupOf(def, S({ b: true }), F).ballots], [[[0, 1, 3]], [[0, 1, 3], [0, 2, 3]]])
        })

        it('panelFindingsOf:缺必填(必填而無首選);各投票組合之首兩票同家 → same(third＝首選不同之第三席之顯示名,無者為 \'\')', () => {
            const g = (first, second, third, required = [true, true, false]) => ({ members: [{ label: 'first', seat: first, required: required[0] }, { label: 'second', seat: second, required: required[1] }, { label: 'third', seat: third, required: required[2] }], ballots: [[0, 1, 2]] })
            assert.deepEqual(panelFindingsOf(g(p('u'), null, null)), { missing: ['second'], same: [] })
            assert.deepEqual(panelFindingsOf(g({}, p('u'), null)), { missing: ['first'], same: [] }, '有席位而無 use 亦算缺')
            assert.deepEqual(panelFindingsOf(g(p('u'), p('u'), null)), { missing: [], same: [{ a: 'first', b: 'second', use: 'u', third: '', thirdUse: '' }] })
            assert.deepEqual(panelFindingsOf(g(p('u'), p('u'), p('u'))).same[0].third, '', '第三席同家不算')
            assert.deepEqual(panelFindingsOf(g(p('u'), p('u'), p('v'))).same, [{ a: 'first', b: 'second', use: 'u', third: 'third', thirdUse: 'v' }])
            assert.deepEqual(panelFindingsOf(g(p('u'), p('v'), null)).same, [])
            assert.deepEqual(panelFindingsOf(null), { missing: [], same: [] })
        })

        it('panelSameProviderWarnings:只判已開啟之小組;首兩票同家且無首選不同之第三席 → 一句(字樣逐字);有不同家之第三席不警告', () => {
            const g = (on, third) => ({ on, name: '甲小組', path: 'x.ai', members: [{ label: 'first', seat: p('u') }, { label: 'second', seat: p('u') }, { label: 'third', seat: third }], ballots: [[0, 1, 2]] })
            assert.deepEqual(panelSameProviderWarnings([g(true, null)]), ['甲小組（x.ai）：first 與 second 之首選同為「u」且無首選不同之第三席（third）——兩票為同一供應者，判定小組永遠無法成立（只會逐輪重試、逾次轉使用者）；請改其一席之 use，或設首選不同之 third'])
            assert.deepEqual(panelSameProviderWarnings([g(false, null)]), [], '未開啟不判')
            assert.deepEqual(panelSameProviderWarnings([g(true, p('v'))]), [])
            assert.deepEqual(panelSameProviderWarnings(null), [])
        })

        it('panelSeatRowsOf:各席之路徑、顯示名與取席位之函數', () => {
            const rows = panelSeatRowsOf('x.ai', [['first', '甲一'], ['third', '甲三']], (w) => w?.ai)
            assert.deepEqual(rows.map((r) => [r.path, r.label]), [['x.ai.first', '甲一'], ['x.ai.third', '甲三']])
            assert.deepEqual([rows[0].of({ ai: { first: p('u') } }), rows[1].of({}), rows[0].of(undefined)], [{ use: 'u' }, undefined, undefined])
        })
    })

    // ══════════════════════════ standards/panelRun ══════════════════════════
    // 規格(panelRun 檔頭):第一、二席並行(第二席項序依 sha1(<前綴>|<key>) 打亂、編號不變;第二席非物件即只叫一席)→ 任一席中止即整頁中止
    //   (decisions 空)→ 逐項收兩票 → 未成立而可成立者(needThird)只送該些項給第三席 → 逐項 decidePanel;票之席位名固定(與段名無關)
    describe('standards/panelRun(判定小組之單頁執行器)', function() {

        const SEATS = { first: { use: 'p1' }, second: { use: 'p2' }, third: { use: 'p3' } }
        const LOCAL = (n) => Array.from({ length: n }, (_, j) => ({ index: j + 1, key: `k${j + 1}`, text: `項${j + 1}` }))
        const prompt = (xs) => xs.map((x) => `${x.index}:${x.key}`).join('\n')
        const itemsIn = (p) => [...String(p).matchAll(/^(\d+):(\S+)$/gm)].map((m) => ({ index: Number(m[1]), key: m[2] }))
        // 替身:verdicts[席位][key] → 票值(未列者不涵蓋);mods[席位] 覆寫回覆之欄(ok、providerId、stop);log 記段名、席位、所見之項
        const mkCall = (verdicts, mods = {}, log = []) => async (stage, seat, p) => {
            const its = itemsIn(p)
            log.push({ stage, use: seat?.use, keys: its.map((x) => x.key), indices: its.map((x) => x.index) })
            const v = verdicts[seat?.use] || {}
            return { ok: true, providerId: seat?.use, data: its.filter((x) => v[x.key] !== undefined).map((x) => ({ index: x.index, v: v[x.key] })), ...(mods[seat?.use] || {}) }
        }
        const votesOf = (data, set) => new Map((Array.isArray(data) ? data : []).filter((c) => set.has(c.index)).map((c) => [c.index, c.v]))
        const run = (o) => runPanelPage({ local: LOCAL(3), buildPrompt: prompt, shufflePrefix: 't', seats: SEATS, votesOf, ...o })

        it('兩席一致(供應者不同)→ 成立、不叫第三席(calls 2);票之形狀 { seat, provider, verdict };decisions 依項序、byIndex 為同一裁定物件', async () => {
            const log = []
            const r = await run({ call: mkCall({ p1: { k1: 'yes', k2: 'yes', k3: 'no' }, p2: { k1: 'yes', k2: 'yes', k3: 'no' } }, {}, log) })
            assert.deepEqual([...r.decisions.keys()], ['k1', 'k2', 'k3'])
            assert.deepEqual(r.decisions.get('k3'), {
                status: 'decided', verdict: 'no', by: ['p1', 'p2'], seats: ['first', 'second'], why: '',
                votes: [{ seat: 'first', provider: 'p1', verdict: 'no' }, { seat: 'second', provider: 'p2', verdict: 'no' }],
            })
            assert.deepEqual([r.calls, r.stopped, log.map((x) => x.stage)], [2, false, ['first', 'second']])
            assert.deepEqual([...r.byIndex.keys()], [1, 2, 3])
            assert.equal(r.byIndex.get(3), r.decisions.get('k3'))
        })

        it('缺票:一席未涵蓋某項 → 該項未成立 missing、不叫第三席(第三席不是重試);一席失敗(ok 非真)→ 該席之票全為缺票(供應者仍記)', async () => {
            const log = []
            const r = await run({ call: mkCall({ p1: { k1: 'yes', k2: 'yes', k3: 'yes' }, p2: { k1: 'yes', k3: 'yes' } }, {}, log) })
            assert.deepEqual([r.decisions.get('k2').status, r.decisions.get('k2').why], ['undetermined', PANEL_WHY.MISSING])
            assert.deepEqual(r.decisions.get('k2').votes[1], { seat: 'second', provider: 'p2', verdict: null })
            assert.ok(!log.some((x) => x.stage === 'third'), '缺票不叫第三席')
            const fail = await run({ call: mkCall({ p1: { k1: 'yes' }, p2: { k1: 'yes' } }, { p2: { ok: false } }) })
            assert.deepEqual(fail.decisions.get('k1').votes, [{ seat: 'first', provider: 'p1', verdict: 'yes' }, { seat: 'second', provider: 'p2', verdict: null }])
            assert.equal(fail.decisions.get('k1').why, PANEL_WHY.MISSING)
        })

        it('同一供應者:兩票一致而供應者相同 → 未成立 same-provider;有第三席(不同家)→ 只送該些項而與其中一票成立;第三席亦同家 → 仍未成立', async () => {
            const V3 = { p1: { k1: 'yes', k2: 'yes', k3: 'yes' }, p2: { k1: 'yes', k2: 'yes', k3: 'yes' }, p3: { k1: 'yes', k2: 'yes', k3: 'yes' } }
            const two = await run({ call: mkCall(V3, { p2: { providerId: 'p1' } }), seats: { first: SEATS.first, second: SEATS.second } })
            assert.deepEqual([...two.decisions.values()].map((d) => d.why), [PANEL_WHY.SAME_PROVIDER, PANEL_WHY.SAME_PROVIDER, PANEL_WHY.SAME_PROVIDER])
            const log = []
            const three = await run({ call: mkCall(V3, { p2: { providerId: 'p1' } }, log) })
            assert.deepEqual(log.find((x) => x.stage === 'third').keys, ['k1', 'k2', 'k3'])
            assert.deepEqual([three.decisions.get('k1').status, three.decisions.get('k1').by, three.decisions.get('k1').seats], ['decided', ['p1', 'p3'], ['first', 'third']])
            const all = await run({ call: mkCall(V3, { p2: { providerId: 'p1' }, p3: { providerId: 'p1' } }) })
            assert.deepEqual([all.decisions.get('k1').status, all.decisions.get('k1').why, all.calls], ['undetermined', PANEL_WHY.SAME_PROVIDER, 3])
        })

        it('需第三席(不一致):只送該些項(提示詞與 indexSet 只含其編號,編號不變);第三席之段名為 stages[2];第三席與其中一票成立;已成立之項無第三票', async () => {
            const log = []
            const sets = []
            const r = await run({
                call: mkCall({ p1: { k1: 'yes', k2: 'yes', k3: 'yes' }, p2: { k1: 'yes', k2: 'no', k3: 'yes' }, p3: { k2: 'no' } }, {}, log),
                votesOf: (d, set) => {
                    sets.push([...set])
                    return votesOf(d, set)
                },
                stages: ['s1', 's2', 's3'],
            })
            assert.deepEqual(log.map((x) => x.stage), ['s1', 's2', 's3'])
            assert.deepEqual(log[2], { stage: 's3', use: 'p3', keys: ['k2'], indices: [2] })
            assert.deepEqual(sets, [[1, 2, 3], [1, 2, 3], [2]], '第一、二席見全頁;第三席只見送去之項')
            const d = r.decisions.get('k2')
            assert.deepEqual([d.status, d.verdict, d.by, d.seats, d.votes.map((v) => v.seat)], ['decided', 'no', ['p2', 'p3'], ['second', 'third'], ['first', 'second', 'third']])
            assert.deepEqual([r.calls, r.decisions.get('k1').votes.length], [3, 2])
        })

        it('第三席不給(非物件)→ 不叫第三席,不一致者未成立 disagree;兩席皆不確定之項不送第三席(unsure)', async () => {
            const V = { p1: { k1: 'yes', k2: PANEL_UNSURE }, p2: { k1: 'no', k2: PANEL_UNSURE } }
            for (const third of [undefined, null, 'p3', ['p3']]) {
                const log = []
                const r = await run({ call: mkCall(V, {}, log), seats: { ...SEATS, third } })
                assert.deepEqual([log.map((x) => x.stage), r.calls], [['first', 'second'], 2], String(third))
                assert.deepEqual([r.decisions.get('k1').why, r.decisions.get('k2').why], [PANEL_WHY.DISAGREE, PANEL_WHY.UNSURE])
            }
            const log = []
            await run({ call: mkCall(V, {}, log) })
            assert.deepEqual(log.find((x) => x.stage === 'third').keys, ['k1'], '有第三席:只送可成立之項(兩席皆不確定與缺票者不送)')
        })

        it('各席中止:第一或第二席 stop → 整頁中止(stopped、decisions／byIndex 皆空、calls 2、不叫第三席);ok 而 stop 亦中止;第三席 stop → 中止(calls 3、decisions 空)', async () => {
            for (const who of ['p1', 'p2']) {
                const log = []
                const r = await run({ call: mkCall({ p1: { k1: 'yes' }, p2: { k1: 'no' } }, { [who]: { ok: false, stop: true } }, log) })
                assert.deepEqual([r.stopped, r.calls, r.decisions.size, r.byIndex.size, log.length], [true, 2, 0, 0, 2], who)
            }
            const okStop = await run({ call: mkCall({ p1: { k1: 'yes' }, p2: { k1: 'yes' } }, { p1: { stop: true } }) })
            assert.deepEqual([okStop.stopped, okStop.decisions.size], [true, 0], 'ok 而 stop → 仍中止')
            const s3 = await run({ call: mkCall({ p1: { k1: 'yes' }, p2: { k1: 'no' } }, { p3: { ok: false, stop: true } }) })
            assert.deepEqual([s3.stopped, s3.calls, s3.decisions.size, s3.byIndex.size], [true, 3, 0, 0])
        })

        it('無第二席(非物件)→ 只叫第一席(calls 1)、第二票為缺票(供應者空)、不叫第三席 → 未成立 missing', async () => {
            for (const second of [undefined, null, 'p2', ['p2']]) {
                const log = []
                const r = await run({ call: mkCall({ p1: { k1: 'yes', k2: 'yes', k3: 'yes' } }, {}, log), seats: { first: SEATS.first, second, third: SEATS.third } })
                assert.deepEqual([r.calls, log.map((x) => x.stage)], [1, ['first']], String(second))
                assert.deepEqual(r.decisions.get('k1').votes, [{ seat: 'first', provider: 'p1', verdict: 'yes' }, { seat: 'second', provider: '', verdict: null }])
                assert.equal(r.decisions.get('k1').why, PANEL_WHY.MISSING)
            }
            const noSeats = await run({ call: mkCall({}), seats: 'x' })
            assert.equal(noSeats.calls, 1, 'seats 非物件視為 {}(第一席恆叫)')
        })

        it('項序打亂而編號不變:第一席為原序;第二席依 sha1(<前綴>|<key>) 排序、編號隨項;前綴不同則序不同;buildPrompt 收 local 之原物件', async () => {
            const local = LOCAL(6)
            const got = []
            const log = []
            const build = (xs) => {
                got.push(xs)
                return prompt(xs)
            }
            await runPanelPage({ local, buildPrompt: build, shufflePrefix: 'ss14', seats: { first: SEATS.first, second: SEATS.second }, votesOf, call: mkCall({}, {}, log) })
            const expect = [...local].sort((a, b) => (sha1(`ss14|${a.key}`) < sha1(`ss14|${b.key}`) ? -1 : 1))
            assert.deepEqual(log[0].keys, ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'])
            assert.deepEqual(log[1].keys, expect.map((x) => x.key))
            assert.deepEqual(log[1].indices, expect.map((x) => x.index), '編號隨項不變')
            assert.notDeepEqual(log[1].keys, log[0].keys, '前提:此 6 項之打亂與原序不同')
            assert.equal(got[0][0], local[0], 'buildPrompt 收 local 之原物件(呼叫端之欄位皆在)')
            const log2 = []
            await runPanelPage({ local, buildPrompt: prompt, shufflePrefix: 'zz', seats: { first: SEATS.first, second: SEATS.second }, votesOf, call: mkCall({}, {}, log2) })
            assert.notDeepEqual(log2[1].keys, log[1].keys, '前綴不同 → 序不同')
            assert.deepEqual(local.map((x) => x.key), ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'], '不改動呼叫端之 local')
        })

        it('段名:預設 PANEL_STAGES(first／second／third,凍結)為 call 之第一參數;空頁(local 為 [])照骨架呼叫(略過與否由呼叫端判斷)', async () => {
            assert.deepEqual(PANEL_STAGES, ['first', 'second', 'third'])
            assert.ok(Object.isFrozen(PANEL_STAGES))
            const log = []
            await run({ call: mkCall({ p1: { k1: 'yes' }, p2: { k1: 'no' } }, {}, log) })
            assert.deepEqual(log.map((x) => x.stage), ['first', 'second', 'third'])
            const empty = []
            const r = await runPanelPage({ local: [], buildPrompt: prompt, shufflePrefix: 't', seats: SEATS, votesOf, call: mkCall({}, {}, empty) })
            assert.deepEqual([r.calls, r.decisions.size, r.stopped, empty.map((x) => x.stage)], [2, 0, false, ['first', 'second']])
        })

        it('same:未給 → JSON 相等(理由不同即不一致);給了即用(如以裁決值判同)', async () => {
            const objs = { p1: { k1: { verdict: 'a', reason: '理由一' } }, p2: { k1: { verdict: 'a', reason: '理由二' } } }
            const two = { first: SEATS.first, second: SEATS.second }
            assert.equal((await run({ call: mkCall(objs), seats: two })).decisions.get('k1').why, PANEL_WHY.DISAGREE)
            const d = (await run({ call: mkCall(objs), seats: two, same: (a, b) => a.verdict === b.verdict })).decisions.get('k1')
            assert.deepEqual([d.status, d.verdict], ['decided', { verdict: 'a', reason: '理由一' }], '成立時裁決取先者')
        })

        it('同鍵之項:decisions 以鍵存(後項覆蓋前項),byIndex 逐項皆有', async () => {
            const r = await runPanelPage({ local: [{ index: 1, key: 'k' }, { index: 2, key: 'k' }], buildPrompt: prompt, shufflePrefix: 't', seats: { first: SEATS.first, second: SEATS.second }, votesOf, call: mkCall({ p1: { k: 'yes' }, p2: { k: 'yes' } }) })
            assert.deepEqual([r.decisions.size, r.byIndex.size], [1, 2])
            assert.equal(r.decisions.get('k'), r.byIndex.get(2))
        })

        // ── opt-in 參數(終審 D5 甲′:擴充預設不變;未給者行為與上列各案逐字同)──
        it('secondOf(opt-in):第二席只見其回傳之子集(依前綴打亂、編號不變),未見之項第二票為缺票;回空即不叫第二席(calls 1);回非 local 之子集 → 拒絕', async () => {
            const local = LOCAL(4)
            const log = []
            const V = { p1: { k1: 'yes', k2: 'yes', k3: 'yes', k4: 'yes' }, p2: { k1: 'yes', k2: 'yes', k3: 'yes', k4: 'yes' } }
            const r = await runPanelPage({ local, buildPrompt: prompt, shufflePrefix: 'sub', seats: { first: SEATS.first, second: SEATS.second }, votesOf, call: mkCall(V, {}, log), secondOf: (xs) => xs.filter((x) => x.index % 2 === 0) })
            const expect = local.filter((x) => x.index % 2 === 0).sort((a, b) => (sha1(`sub|${a.key}`) < sha1(`sub|${b.key}`) ? -1 : 1))
            assert.deepEqual(log[1].keys, expect.map((x) => x.key), '第二席只見子集、依前綴打亂')
            assert.deepEqual([r.decisions.get('k2').status, r.decisions.get('k1').why], ['decided', PANEL_WHY.MISSING])
            assert.deepEqual(r.decisions.get('k1').votes[1], { seat: 'second', provider: 'p2', verdict: null }, '未見之項:第二票缺票(供應者仍記)')
            const none = []
            const r0 = await runPanelPage({ local, buildPrompt: prompt, shufflePrefix: 'sub', seats: SEATS, votesOf, call: mkCall(V, {}, none), secondOf: () => [] })
            assert.deepEqual([r0.calls, none.map((x) => x.stage), r0.decisions.get('k1').votes[1]], [1, ['first'], { seat: 'second', provider: '', verdict: null }], '回空:不叫第二席、缺票不叫第三席')
            await assert.rejects(runPanelPage({ local, buildPrompt: prompt, shufflePrefix: 'sub', seats: SEATS, votesOf, call: mkCall(V), secondOf: () => [{ index: 9, key: 'z' }] }), /secondOf 須回傳 local 之子集/)
        })

        it('ballotOf(opt-in):該項之前兩票由呼叫端組(如單席提案以提案席之票為第一票、第一席為第二票);須回兩票否則拒絕;decideOf／needThirdOf 皆以其為票', async () => {
            const local = LOCAL(2)
            const V = { p1: { k1: 'yes', k2: 'no' }, p2: { k1: 'yes', k2: 'no' }, p3: { k2: 'yes' } }
            const log = []
            const r = await runPanelPage({
                local, buildPrompt: prompt, shufflePrefix: 't', seats: SEATS, votesOf, call: mkCall(V, {}, log),
                secondOf: () => [],
                ballotOf: (x, a) => [{ seat: 'proposer', provider: 'px', verdict: 'yes' }, a],
            })
            assert.deepEqual([r.decisions.get('k1').status, r.decisions.get('k1').by, r.decisions.get('k1').seats], ['decided', ['px', 'p1'], ['proposer', 'first']])
            assert.deepEqual(log.map((x) => x.stage), ['first', 'third'], '第二席未叫;k2 不一致 → 第三席')
            assert.deepEqual([r.decisions.get('k2').status, r.decisions.get('k2').by, r.decisions.get('k2').votes.map((v) => v.seat)], ['decided', ['px', 'p3'], ['proposer', 'first', 'third']])
            await assert.rejects(runPanelPage({ local, buildPrompt: prompt, shufflePrefix: 't', seats: SEATS, votesOf, call: mkCall(V), ballotOf: () => [] }), /ballotOf 須回傳兩票/)
        })

        it('decideOf／needThirdOf(opt-in):以項與票為參數(如兩層判定須見該項之現行值);needThirdOf 決定送第三席之項,decideOf 於第三席後逐項呼叫一次(送第三席者三票)', async () => {
            const local = LOCAL(3).map((x) => ({ ...x, cur: x.index === 3 ? 'yes' : 'no' }))
            const V = { p1: { k1: 'yes', k2: 'yes', k3: 'yes' }, p2: { k1: 'yes', k2: 'no', k3: 'no' }, p3: { k1: 'no', k2: 'no', k3: 'no' } }
            const seen = []
            const log = []
            const r = await runPanelPage({
                local, buildPrompt: prompt, shufflePrefix: 't', seats: SEATS, votesOf, call: mkCall(V, {}, log),
                needThirdOf: (x, vs) => x.cur === 'yes' && vs.some((v) => v.verdict === 'no'),
                decideOf: (x, vs) => {
                    seen.push([x.key, vs.length])
                    return { status: 'custom', cur: x.cur, n: vs.length }
                },
            })
            assert.deepEqual(log.find((x) => x.stage === 'third').keys, ['k3'], '只送 needThirdOf 為真之項(k2 不一致但現行值為 no → 不送)')
            assert.deepEqual(seen, [['k1', 2], ['k2', 2], ['k3', 3]])
            assert.deepEqual(r.decisions.get('k3'), { status: 'custom', cur: 'yes', n: 3, votes: r.decisions.get('k3').votes })
            assert.equal(r.decisions.get('k3').votes[2].seat, 'third')
        })

        it('thirdStop(opt-in):預設 page＝第三席中止整頁丟棄(undecided 為全頁);items＝只使送第三席之項不判(undecided 只含該些項、其餘照回、stopped 仍真);前兩席中止 undecided 恆為全頁', async () => {
            const V = { p1: { k1: 'yes', k2: 'yes', k3: 'yes' }, p2: { k1: 'no', k2: 'yes', k3: 'no' } }
            const stop3 = { p3: { ok: false, stop: true } }
            const page = await run({ call: mkCall(V, stop3) })
            assert.deepEqual([page.stopped, page.decisions.size, page.undecided], [true, 0, [1, 2, 3]])
            const items = await run({ call: mkCall(V, stop3), thirdStop: PANEL_THIRD_STOP.ITEMS })
            assert.deepEqual([items.stopped, items.calls, items.undecided, [...items.decisions.keys()], [...items.byIndex.keys()]], [true, 3, [1, 3], ['k2'], [2]])
            assert.equal(items.decisions.get('k2').status, 'decided')
            const two = await run({ call: mkCall(V, { p2: { ok: false, stop: true } }), thirdStop: PANEL_THIRD_STOP.ITEMS })
            assert.deepEqual([two.stopped, two.decisions.size, two.undecided], [true, 0, [1, 2, 3]], '前兩席中止:整頁未判')
            const ok = await run({ call: mkCall(V), thirdStop: PANEL_THIRD_STOP.ITEMS })
            assert.deepEqual([ok.stopped, ok.undecided, ok.decisions.size], [false, [], 3], '未中止:undecided 空')
            assert.deepEqual(PANEL_THIRD_STOP, { PAGE: 'page', ITEMS: 'items' })
            await assert.rejects(run({ call: mkCall(V), thirdStop: 'x' }), /thirdStop 須為 'page'/)
            for (const k of ['secondOf', 'ballotOf', 'decideOf', 'needThirdOf']) await assert.rejects(run({ call: mkCall(V), [k]: 'x' }), new RegExp(`${k} 須為函數`))
        })

        it('先組後叫(一律):兩席之提示詞先組好才呼叫——第二席之提示詞組字拋錯 → 第一席亦不被呼叫', async () => {
            let n = 0
            let called = 0
            const build = (xs) => {
                if (++n === 2) throw new Error('第二份組不成')
                return prompt(xs)
            }
            await assert.rejects(runPanelPage({ local: LOCAL(2), buildPrompt: build, shufflePrefix: 't', seats: SEATS, votesOf, call: async () => { called++; return { ok: true, providerId: 'p', data: [] } } }), /第二份組不成/)
            assert.equal(called, 0, '不呼叫任何席位')
        })

        it('call 或 buildPrompt 拋錯 → 原樣拒絕;第一席同步拋出 → 第二席不被呼叫', async () => {
            await assert.rejects(run({ call: async () => { throw new Error('甲錯') } }), /甲錯/)
            const seen = []
            await assert.rejects(run({
                call: (stage) => {
                    seen.push(stage)
                    throw new Error('乙錯')
                },
            }), /乙錯/)
            assert.deepEqual(seen, ['first'])
            await assert.rejects(run({ call: mkCall({}), buildPrompt: () => { throw new Error('丙錯') } }), /丙錯/)
        })

        it('參數檢核:不合者拒絕並指明(不呼叫任何席位);votesOf 回非 Map 亦拒絕', async () => {
            let called = 0
            const call = async () => {
                called++
                return { ok: true, providerId: 'p', data: [] }
            }
            const base = { local: LOCAL(2), buildPrompt: prompt, shufflePrefix: 't', seats: SEATS, votesOf, call }
            await assert.rejects(runPanelPage(null), /須給參數物件/)
            await assert.rejects(runPanelPage({ ...base, local: 'x' }), /local 須為陣列/)
            for (const bad of [[null], [{ index: 0, key: 'a' }], [{ index: 1.5, key: 'a' }], [{ index: '1', key: 'a' }], [{ key: 'a' }]]) {
                await assert.rejects(runPanelPage({ ...base, local: bad }), /index 為正整數/, JSON.stringify(bad))
            }
            await assert.rejects(runPanelPage({ ...base, local: [{ index: 1, key: 'a' }, { index: 1, key: 'b' }] }), /index 重複：1/)
            for (const k of ['buildPrompt', 'call', 'votesOf']) await assert.rejects(runPanelPage({ ...base, [k]: 'x' }), new RegExp(`${k} 須為函數`))
            for (const p of [undefined, '', 1]) await assert.rejects(runPanelPage({ ...base, shufflePrefix: p }), /shufflePrefix 須為非空字串/)
            for (const s of ['a', ['a', 'b'], ['a', 'b', ''], ['a', 'b', 3]]) await assert.rejects(runPanelPage({ ...base, stages: s }), /stages 須為三個非空字串/)
            await assert.rejects(runPanelPage({ ...base, same: 'x' }), /same 須為函數/)
            assert.equal(called, 0, '參數不合 → 不呼叫任何席位')
            await assert.rejects(runPanelPage({ ...base, votesOf: () => ({}) }), /votesOf 須回傳 Map/)
        })
    })

    // ══════════════════════════ standards/numbers ══════════════════════════
    // 每條案例對應 SS4 數字紮根之一句;合格者不誤殺之案例與不合格者同列(純函數)
    describe('standards/numbers(數字紮根)', function() {

        const ung = (out, mat) => N.ungroundedNumbers(out, mat)

        it('量級換算:397.7 億美元 對 39.77 billion、150 萬 對 1.5 million、1.5 兆 對 1.5 trillion 皆紮根', () => {
            assert.deepEqual(ung('規模 397.7 億美元', '$39.77 billion fund'), [])
            assert.deepEqual(ung('150 萬', '1.5 million'), [])
            assert.deepEqual(ung('1.5 兆日圓', '1.5 trillion yen'), [])
        })

        it('精度:依受檢數字之小數位四捨五入(10.1% 對 10.09%;24% 對 23.4% 不紮根)', () => {
            assert.deepEqual(ung('單日漲 10.1%', 'jumped 10.09%'), [])
            assert.deepEqual(ung('年化 23.7%', 'annualized 23.66%'), [])
            assert.deepEqual(ung('年化 24%', 'annualized 23.4%'), ['24%'])
            assert.deepEqual(ung('夏普 1.2', 'Sharpe of 1.3'), ['1.2'])
        })

        it('整數須相等;帶量級或約數詞者末尾 0 視為四捨五入(約 400 億 對 397.7 億;2000 年 對 2024 不紮根)', () => {
            assert.deepEqual(ung('約 400 億', 'AUM of 39.77 billion'), [])
            assert.deepEqual(ung('400 億', '397.7億'), [])
            assert.deepEqual(ung('2000 年起', 'since 2024'), ['2000 年'])
        })

        it('黏連數字之切段只供逐字相等、不依精度進位:「3 萬」對原文 299,792 不紮根(切段 29979 進位成 30000 曾誤判);「30 萬」以真值進位紮根;黏連之年份與數字仍紮根', () => {
            assert.deepEqual(ung('光速約 3 萬公里每秒', '真空中之光速約為 299,792 公里每秒'), ['3 萬'])
            assert.deepEqual(ung('光速約 30 萬公里每秒', '真空中之光速約為 299,792 公里每秒'), [])
            assert.deepEqual(ung('2026 年之回顧', 'Annual Review in 20261. Overview'), [], '黏連切段逐字相等仍紮根')
            assert.deepEqual(ung('數值 100', 'value = 100100'), [])
            assert.deepEqual(ung('約 1.2 萬', '編號 12345678'), ['1.2 萬'], '切段不進位:12345678 之切段 12345 不得支持「約 1.2 萬」')
            assert.deepEqual([...N.materialExactValues('value = 100100')].includes(100), true)
            assert.equal(N.materialValues('value = 100100').includes(1001), false, '切段不入一般材料值')
        })

        it('一位數:受檢側無事實單位者不檢(序號、計數);帶單位者檢;2.0 與 2 對稱', () => {
            assert.deepEqual(ung('第 3 種方法', '無'), [])
            assert.deepEqual(ung('3 年', '無'), ['3 年'])
            assert.deepEqual(ung('報酬 2.0 倍', 'returns doubled to 2x'), [])
            assert.deepEqual(ung('報酬 2 倍', 'returns 2.0x'), [])
        })

        it('全形數字受檢(NFKC);千分位', () => {
            assert.deepEqual(ung('５年期', 'five-year horizon'), [])
            assert.deepEqual(ung('１２％', '無'), ['12%'])
            assert.deepEqual(ung('1,234 張', '1234 contracts'), [])
        })

        it('材料側之中文數字與英文數字詞、月份名(正確翻譯不誤殺)', () => {
            assert.deepEqual(ung('佔 30%', '三成的投資人'), [])
            assert.deepEqual(ung('佔 30%', '百分之三十'), [])
            assert.deepEqual(ung('回看 12 個月', 'a twelve-month lookback'), [])
            assert.deepEqual(ung('約 50%', 'around half of all trades'), [])
            assert.deepEqual(ung('逾 50 萬股', 'more than half a million shares'), [])
            assert.deepEqual(ung('5 月 12 日', 'the week of May 12-18'), [])
        })

        it('基點與百分點互換', () => {
            assert.deepEqual(ung('降息 50 個基點', 'cut by 0.5 percentage points'), [])
            assert.deepEqual(ung('降息 0.5 個百分點', 'cut by 50 bps'), [])
        })

        it('識別碼不當數字:[[slug-雜湊]]、〔C12〕、N 代號、網址、DOI(slug 雜湊尾碼之 927 不當成數字)', () => {
            assert.deepEqual(ung('若採[[vix與趨勢跟蹤再檢視近十年樣本外實證-e2e927cd]]之設計', '無'), [])
            assert.deepEqual(ung('〔C12〕之說法', '無'), [])
            assert.deepEqual(ung('N12 指出', '無'), [], '受檢側:緊接字母之數字為名稱,不抽')
            // 他工作之識別碼(如提煉之批內代號 N12)不由本檔預設剝除:材料側之 N12 預設可支持「12」;呼叫端以 opt.stripPatterns 傳入樣式(須帶 g)即不可
            assert.deepEqual(ung('樣本 12 年', 'N12'), [])
            assert.deepEqual(N.ungroundedNumbers('樣本 12 年', 'N12', { stripPatterns: [/(?<![A-Za-z0-9])N\d+(?![0-9])/g] }), ['12 年'])
            assert.throws(() => N.ungroundedNumbers('x', 'y', { stripPatterns: [/N\d+/] }), /stripPatterns 須為帶 g 旗標之 RegExp 陣列/)
            assert.deepEqual(ung('見 https://x.com/a/2024/123456', '無'), [])
            assert.deepEqual(ung('doi 10.1016/j.jfineco.2020.05.001', '無'), [])
            // 材料側之識別碼亦不得充當支持
            assert.deepEqual(ung('927 筆', '[[x-e2e927cd]]'), ['927'])
        })

        it('slug(字母／數字串＋雜湊尾碼)之去除與原正則逐字相同,且長串為線性(2026-10-10 改寫:原正則於無尾碼之長串每個起點皆掃到串尾,5 萬字約 59 秒)', () => {
            // 應然＝原正則之全域取代(下列輸入不含 stripIdentifiers 其餘步驟所處理者,故兩者應逐字相同)
            const REF = /[\p{L}\p{N}]*-(?=[0-9]*[a-f])[0-9a-f]{8}(?![0-9a-z])/gu
            for (const t of ['abc-1ab6294c中文-2bc7305d', 'x-1ab6294c-2bc7305d', 'ab-cd-1ab6294c', 'abc-12345678', 'abc-1234abcd5', '𠀀𠀁-1ab6294c 與 𠀂', '\uD800-1ab6294c', 'a\uDC00-1ab6294c', '前文-1ab6294c後文']) {
                assert.equal(N.stripIdentifiers(t), t.replace(REF, ' '), JSON.stringify(t))
            }
            assert.deepEqual(['abc-1ab6294c中文-2bc7305d', 'ab-cd-1ab6294c', '𠀀𠀁-1ab6294c 與 𠀂'].map((t) => N.stripIdentifiers(t)), ['  ', 'ab- ', '  與 𠀂'], '相鄰兩處各一空白;不越過非字母數字;擴充區字以碼位計')
            const t0 = Date.now()
            N.stripIdentifiers('量'.repeat(50000))
            assert.ok(Date.now() - t0 < 1000, `5 萬字無尾碼之長串須為線性:${Date.now() - t0}ms`)
        })

        it('符合度掃描抽核所見之誤判類別皆不再誤殺(每案一類)', () => {
            assert.deepEqual(ung('2003–2018，530萬則新聞', '2003 to 2018, 5.3 million news items'), [], '全形逗號不是千分位')
            assert.deepEqual(ung('樣本外R²0.9794', 'out-of-sample R² of 0.9794'), [], '上標是記號,不黏後面之數')
            assert.deepEqual(ung('bdd7415f 用融資維持率監測', '無'), [], '單獨之筆記雜湊')
            assert.deepEqual(ung('7172982B 強調特徵工程', '無'), [], '大寫雜湊')
            assert.deepEqual(ung('篇55以GARCH殘差接EVT', '無'), [], '候選編號')
            assert.deepEqual(ung('2008–2009 金融危機期間', '2008-09 crisis period'), [], '年份區間簡寫')
            assert.deepEqual(ung('年收入逾 120 萬盧比', 'earning over Rs 12 lakh a year'), [], '印度計數 lakh')
            assert.deepEqual(ung('於15:00前平倉', 'Square off the position by 3 PM'), [], '12 小時制')
            assert.deepEqual(ung('標的 100 之買權', 'Underlying stock = 100100 CE = 3'), [], '爬回原文之數字黏連')
            assert.deepEqual(ung('2026年加密交易AI工具', 'Best AI Tools for Crypto Trading in 20261. Glassnode'), [], '年份與序號黏連')
            assert.deepEqual(ung('折價為面額的 0.041%', 'underpricing amounts to .041% of face value'), [], '小數點開頭')
            assert.deepEqual(ung('p 值皆小於 0.001', 'p < .001'), [], '小數點開頭')
            assert.deepEqual(ung('他篇研究(SET50)', '無'), [], '受檢側緊接字母者為名稱不抽')
            assert.deepEqual(ung('Nifty 50 成分股', 'Nifty50 constituents'), [], '材料側緊接字母者照抽')
        })

        it('模型自補之年份為未紮根(原文只有 May 12-18)', () => {
            assert.deepEqual(ung('2024 年 5 月 12 日至 18 日', 'the week of May 12-18'), ['2024 年'])
        })

        it('numberSet:同一主張判定用之數字集合(含一位數帶單位、量級換算)', () => {
            assert.deepEqual([...N.numberSet('回撤 3% 與 12 個月、150 萬')].sort(), ['12', '1500000', '3'])
            assert.notDeepEqual([...N.numberSet('回撤 3%')], [...N.numberSet('回撤 5%')])
        })
    })

    // ══════════════════════════ vocab/conceptGroups ══════════════════════════
    describe('vocab/conceptGroups(概念詞彙表、標籤清理建議與可疑標籤)', function() {

        const mk = (id, c) => ({ id, concepts: [c] })

        it('conceptVocabulary：notes 缺 select 拋錯；limit 非正整數回退為 60', async () => {
            await assert.rejects(() => conceptVocabulary({}), /conceptVocabulary 需要 notes 集合/)
            const notes = memStore(Array.from({ length: 2 }, (_, i) => ({ id: `${i}`, concepts: ['甲'] })))
            const vocab = await conceptVocabulary(notes, -1, { counts: true })
            assert.match(vocab[0], /^甲\(2\)$/, 'limit 非正整數回退為 60，不影響本例(僅 1 個概念)之輸出')
            const vocab2 = await conceptVocabulary(notes, 1)
            assert.equal(vocab2.length, 1, '有效輸入 limit 行為不變')
            assert.deepEqual(await conceptVocabulary(notes, 60, 'bad'), ['甲'], 'opt 非物件視為{}(預設只回名稱)')
        })

        it('conceptVocabulary：normalizeConcept 歸群(全形、空白、大小寫);預設只回名稱(篇數會被模型照抄成「名稱(3)」分身標籤,故不餵回 prompt),維運顯示可附篇數', async () => {
            const notes = [mk('1', 'Transformer 架構'), mk('2', 'transformer架構'), mk('3', 'Ｔransformer架構')] // 全形Ｔ
            const vocabStore = memStore(notes.map((n) => ({ ...n })))
            const vocab = await conceptVocabulary(vocabStore)
            assert.deepEqual(vocab, ['Transformer 架構'], '預設只回名稱(篇數會被模型照抄成「名稱(3)」分身標籤,故不餵回 prompt)')
            assert.deepEqual(await conceptVocabulary(vocabStore, 60, { counts: true }), ['Transformer 架構(3)'], '維運顯示可附篇數')
        })

        it('conceptVocabulary：折疊注入後繁簡標籤同鍵、display 取多數寫法(不被少數簡體帶偏)、清除後復原', async () => {
            const FOLD = { '机': '機' }
            setConceptFold((s) => [...s].map((ch) => FOLD[ch] || ch).join(''))
            try {
                const notes = [mk('1', '注意力機制'), mk('2', '注意力機制'), mk('3', '注意力机制')]
                const vocab = await conceptVocabulary(memStore(notes.map((n) => ({ ...n }))), 60, { counts: true })
                assert.match(vocab[0], /^注意力機制\(3\)$/, '詞彙表回饋 prompt 的寫法必須是多數（繁體）形')
            }
            finally {
                setConceptFold(null)
            }
            // 清除後行為復原:無折疊時繁簡仍是兩鍵
            const vocab2 = await conceptVocabulary(memStore([mk('1', '注意力機制'), mk('2', '注意力机制')]), 60, { counts: true })
            assert.deepEqual(vocab2.slice().sort(), ['注意力机制(1)', '注意力機制(1)'].sort(), '未注入折疊時不可偷偷合併')
        })

        it('conceptVocabulary：同一篇筆記之多個標籤折疊成同一鍵時只計一次(詞彙表之使用篇數)', async () => {
            const notes = [
                { id: '1', concepts: ['Transformer 架構', 'transformer架構'] }, // 同篇兩種寫法,折疊後同鍵
                { id: '2', concepts: ['Transformer 架構'] },
            ]
            const vocab = await conceptVocabulary(memStore(notes.map((n) => ({ ...n }))), 60, { counts: true })
            assert.match(vocab[0], /\(2\)$/, '詞彙表之使用篇數亦只計一次')
        })

        it('conceptVocabulary：依使用篇數降冪、limit 截取;無概念或空標籤略過', async () => {
            const notes = memStore([
                { id: '1', concepts: ['乙', '甲'] }, { id: '2', concepts: ['甲'] }, { id: '3', concepts: ['甲', '丙'] },
                { id: '4', concepts: ['', '  ', '乙'] }, { id: '5' }, { id: '6', concepts: null },
            ])
            assert.deepEqual(await conceptVocabulary(notes, 60, { counts: true }), ['甲(3)', '乙(2)', '丙(1)'])
            assert.deepEqual(await conceptVocabulary(notes, 2), ['甲', '乙'])
        })

        it('suggestConceptRenames(只建議不改資料):「名稱(N)」分身 → renames(yearLike 標示看似年份者);括號說明／英文對照 → annotated(不入 renames);一個標籤擠多個概念 → multi(括號與引號內不切)', () => {
            const notes = [
                { concepts: ['市場微結構', '價格發現'] },
                { concepts: ['市場微結構(743)'] },
                { concepts: ['金融危機', '金融危機(2008)'] },
                { concepts: ['AR(1)', 'GARCH(1,1)'] },
                { concepts: ['價格發現(未在清單中)', '動量(time-series momentum)'] },
                { concepts: ['價格發現（未載入）'] },
                { concepts: ['訂單流, 流動性', '波動率、風險溢酬', '「甲,乙」', 'GARCH(1,1)'] },
            ]
            const check = () => {
                const r = suggestConceptRenames(notes)
                assert.deepEqual(r.renames, { '市場微結構(743)': '市場微結構', '金融危機(2008)': '金融危機' })
                assert.deepEqual(r.renameDetail.map((x) => [x.form, x.yearLike]), [['市場微結構(743)', false], ['金融危機(2008)', true]], '(2008) 看似年份,多為誤報,供人判讀')
                const ann = Object.fromEntries(r.annotated.map((x) => [x.form, [x.base, x.inner, x.baseUsed]]))
                assert.deepEqual(ann, {
                    '價格發現(未在清單中)': ['價格發現', '未在清單中', true],
                    '價格發現（未載入）': ['價格發現', '未載入', true],
                    '動量(time-series momentum)': ['動量', 'time-series momentum', false],
                }, '括號內只有數字／分隔符者(743、2008、AR(1)、GARCH(1,1))不列')
                assert.equal(r.annotated.at(-1).form, '動量(time-series momentum)', '基名已被使用者排前(較可能是同一概念)')
                assert.deepEqual(r.multi.map((x) => [x.form, x.parts]).sort(), [['波動率、風險溢酬', ['波動率', '風險溢酬']], ['訂單流, 流動性', ['訂單流', '流動性']]].sort())
                assert.deepEqual(Object.keys(suggestConceptRenames(null)), ['renames', 'renameDetail', 'foldGroups', 'annotated', 'multi'])
            }
            check()
            // 建議輸出原字形,不隨折疊變動:於內建繁簡折疊(tw→cn;與總組裝之預設同一函數)下須得同一結果
            const folds = conceptFoldsOf()
            setConceptFold(folds.fold, { clueFold: folds.clueFold })
            try {
                check()
            }
            finally {
                setConceptFold(null)
            }
        })

        it('suggestConceptRenames：minSuffix 門檻(預設 10;opt 非物件視為{})、同一篇之同形標籤只計一次而跨篇累計、無基名者不列、yearLike 範圍 1000～2100、notes 非陣列視為空', () => {
            const notes = [
                { concepts: ['資料結構', '資料結構(9)', '資料結構(10)'] },
                { concepts: ['資料結構(10)', '資料結構(10)'] }, // 同篇重複
            ]
            assert.deepEqual(suggestConceptRenames(notes).renames, { '資料結構(10)': '資料結構' }, '預設門檻 10:(9) 不列')
            assert.deepEqual(suggestConceptRenames(notes, { minSuffix: 5 }).renames, { '資料結構(9)': '資料結構', '資料結構(10)': '資料結構' })
            assert.deepEqual(suggestConceptRenames(notes, 'bad').renames, { '資料結構(10)': '資料結構' }, 'opt 非物件視為{}')
            assert.deepEqual(suggestConceptRenames(notes).renameDetail.map((x) => [x.form, x.notes]), [['資料結構(10)', 2]], '同篇重複只計一次、跨篇累計')
            assert.deepEqual(suggestConceptRenames([{ concepts: ['孤立(50)'] }]).renames, {}, '詞彙中無基名者不列')
            const yl = suggestConceptRenames([{ concepts: ['奧運(1000)', '奧運', '甲(2100)', '甲', '乙(2101)', '乙', '丙(999)', '丙'] }], { minSuffix: 1 })
            assert.deepEqual(yl.renameDetail.map((x) => [x.form, x.yearLike]), [['奧運(1000)', true], ['甲(2100)', true], ['乙(2101)', false], ['丙(999)', false]])
            assert.deepEqual(suggestConceptRenames('x').renames, {}, 'notes 非陣列視為空')
        })

        it('suggestConceptRenames：foldGroups 列折疊後同鍵之不同寫法(群依合計篇數降冪、群內依篇數降冪);未注入折疊時無折疊群', () => {
            const FOLD = { '机': '機' }
            const notes = [
                { concepts: ['注意力機制'] }, { concepts: ['注意力機制'] }, { concepts: ['注意力机制'] },
                { concepts: ['甲機', '甲机'] },
                { concepts: ['乙'] },
            ]
            assert.deepEqual(suggestConceptRenames(notes).foldGroups, [], '未注入折疊時兩種寫法是兩鍵、無折疊群')
            setConceptFold((s) => [...s].map((ch) => FOLD[ch] || ch).join(''))
            try {
                assert.deepEqual(suggestConceptRenames(notes).foldGroups, [
                    { key: '注意力機制', forms: [{ form: '注意力機制', notes: 2 }, { form: '注意力机制', notes: 1 }] },
                    { key: '甲機', forms: [{ form: '甲機', notes: 1 }, { form: '甲机', notes: 1 }] },
                ])
            }
            finally {
                setConceptFold(null)
            }
        })

        it('tagSuspects(摘要段計數用):括號說明／英文對照 → annotated;一個標籤擠多個概念 → multi(括號與引號內不切);非陣列視為空', () => {
            assert.deepEqual(tagSuspects(['GARCH(1,1)', '價格發現(未載入)', '甲, 乙', 'AR(1)', '甲；乙', '「甲,乙」', '甲(乙,丙)', '均值回歸']).map((x) => `${x.tag}:${x.kind}`),
                ['價格發現(未載入):annotated', '甲, 乙:multi', '甲；乙:multi', '甲(乙,丙):annotated'])
            assert.deepEqual(tagSuspects('x'), [])
        })
    })
})
