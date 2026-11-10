# w-knowledge-summarize
A general-purpose pipeline for summarizing knowledge: triage, note-taking, relabeling and syncing.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-knowledge-summarize.svg?style=flat)](https://npmjs.org/package/w-knowledge-summarize) 
[![license](https://img.shields.io/npm/l/w-knowledge-summarize.svg?style=flat)](https://npmjs.org/package/w-knowledge-summarize) 
[![npm download](https://img.shields.io/npm/dt/w-knowledge-summarize.svg)](https://npmjs.org/package/w-knowledge-summarize) 
[![npm download](https://img.shields.io/npm/dm/w-knowledge-summarize.svg)](https://npmjs.org/package/w-knowledge-summarize) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-knowledge-summarize.svg)](https://www.jsdelivr.com/package/npm/w-knowledge-summarize)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-knowledge-summarize/global.html).

## Installation

### Using npm(ES6 module):
```alias
npm i w-knowledge-summarize
```

#### Example:
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-knowledge-summarize/blob/master/g.mjs)]
```alias
import fs from 'fs'
import WKnowledgeSummarize from './src/WKnowledgeSummarize.mjs'


let { createKnowledgeSummarize } = WKnowledgeSummarize


let test = async () => {
    let ms = []

    //workDir, 知識庫根目錄(唯一必填): db/log/state/knowledge/tmp 等皆由此展開, 筆記 md 寫入 knowledge/notes
    let workDir = './_test_knowledge_summarize'
    fs.rmSync(workDir, { recursive: true, force: true })

    //docs, 模擬抓取套件交出之 raw 文件(status 為 raw, 正文在 text), 實務上由 w-knowledge-capture 寫入同一個 workDir
    let rawDoc = (id, title, text) => {
        return {
            id,
            url: `https://example.com/post/${id}`,
            title,
            text,
            status: 'raw',
            sourceName: '範例天文部落格',
            sourceTier: 1,
            collectedAt: '2026-09-01T00:00:00+08:00',
            rawAt: '2026-09-01T00:00:00+08:00',
            textFrom: 'full',
        }
    }
    let docs = [
        rawDoc('d1', '黑洞吸積盤之輻射機制', '黑洞吸積盤中的氣體因摩擦而加熱，並以 X 射線輻射出重力位能。觀測者可由光譜線的輪廓推估盤的內緣位置與黑洞自旋。'.repeat(4)),
        rawDoc('d2', '系外行星大氣之光譜分析', '行星凌星時，恆星光線穿過行星大氣，不同波長被吸收的程度不同，由穿越光譜即可推估大氣成分與雲層高度。'.repeat(4)),
        rawDoc('d3', 'Weekly Roundup', '本週貼文彙整，內容為各篇文章之連結與標題。'.repeat(8)),
    ]

    //aiAdapter, AI 調度層替身(cfg.aiAdapter 為正當擴充口): 依提示詞之角色作答, 預篩攔下彙整貼文, 摘要逐篇給合格項目, 離線可跑
    let calls = { triage: 0, summarize: 0 }
    let titlesOf = (prompt, re) => [...prompt.matchAll(re)].map((m) => m[1])
    let answerOf = (prompt) => {
        if (/的預篩器/.test(prompt)) {
            calls.triage++
            return titlesOf(prompt, /^\d+\. 【(.+?)】/gm).map((t, i) => {
                let relevant = !/Roundup/.test(t)
                return { index: i + 1, relevant, reason: relevant ? '' : '彙整貼文' }
            })
        }
        if (/的萃取器。請閱讀/.test(prompt)) {
            calls.summarize++
            return titlesOf(prompt, /^--- 第\d+篇 ---\n標題：(.*)$/gm).map((t, i) => {
                return {
                    index: i + 1,
                    relevant: true,
                    reason: '',
                    title: t,
                    summary: `${t}之重點說明`,
                    key_points: ['機制之成因', '觀測之方法'],
                    concepts: ['天文觀測', '光譜分析'],
                    category: '方法與技術',
                    claim_type: '實證研究',
                    evidence_level: '中',
                    evidence_note: '單一研究',
                    caveats: ['適用範圍狹窄'],
                    sample_period: '未載明',
                    explore: [],
                }
            })
        }
        return []
    }
    let aiAdapter = {
        callJson: async (prompt, check, opt) => {
            let data = answerOf(prompt)
            let ok = typeof check !== 'function' || check(data) === true
            return { ok, data: ok ? data : null, error: ok ? '' : '替身形狀不合', providerId: ok ? String(opt?.spec?.use || 'stub') : '', attempts: 1, skipped: false }
        },
        drainStats: () => '無呼叫',
        aiUsageToday: () => ({ today: '', used: 0, byKey: {} }),
    }

    //flow, 總組裝: 內建設定/詞彙/提示詞/筆記標準/LMDB/鎖/日誌/執行摘要走預設, 只置換 AI 調度層
    let silent = { info: () => {}, warn: () => {}, error: () => {} }
    let flow = createKnowledgeSummarize({
        workDir,
        data: {
            vocab: { domain: '天文學' }, //主題範圍(選填), 提示詞之領域句據此限定, 未給即不限主題
        },
        aiAdapter,
        scheduleLimitMin: 60, //排程執行上限(分鐘), 整輪時間預算與鎖陳舊期限由此推導
        netGuard: null, //不探測本機網路(預設會探測 AI 供應商之端點)
        afterRun: false, //無收尾鉤子
        logFactory: () => silent, //靜音日誌(預設每輪寫 log/<day>/<stamp>-run.log)
    })

    //stores, 寫入 raw 文件(實務上由抓取套件寫入, 此處直接插入作為輸入)
    let stores = flow.openStores()
    await stores.docs.insertNew(docs)
    await flow.closeStores(stores)

    //run, 一輪: 預篩 → 摘要 → 重標 → 同步
    let r = await flow.run()
    ms.push({ round: `ok[${r.ok}], ` + r.stages.map((s) => `${s.name}[${s.status}]`).join(', ') })
    for (let s of r.stages) {
        ms.push({ [s.name]: s.result.summary })
    }

    //stores, 讀回結果(預篩攔下者轉 skip, 其餘成筆記轉 noted)
    stores = flow.openStores()
    let ds = await stores.docs.select()
    ms.push({ docs: ds.map((d) => `${d.title}｜${d.status}`).sort() })
    let ns = await stores.notes.select()
    ms.push({ notes: ns.map((n) => `${n.title}｜${n.category}｜${n.concepts.join('、')}`).sort() })
    await flow.closeStores(stores)
    ms.push({ calls })

    //clear
    fs.rmSync(workDir, { recursive: true, force: true })

    console.log('ms', ms)
    return ms
}
await test()
    .catch((err) => {
        console.log(err)
    })
// => ms [
//   { round: 'ok[true], 摘要[ok]' },
//   { '摘要': '處理 2、新知識 2、略過 0、線索 0（AI 1 次）｜預篩 3 篇放行 2（AI 1 次）' },
//   {
//     docs: [ 'Weekly Roundup｜skip', '系外行星大氣之光譜分析｜noted', '黑洞吸積盤之輻射機制｜noted' ]
//   },
//   {
//     notes: [ '系外行星大氣之光譜分析｜方法與技術｜天文觀測、光譜分析', '黑洞吸積盤之輻射機制｜方法與技術｜天文觀測、光譜分析' ]
//   },
//   { calls: { triage: 1, summarize: 1 } }
// ]
```

---

## 概述

通用知識摘要:把抓取套件交出之文章(`docs` 中 `status:'raw'` 者)先預篩、再摘要成結構化之知識筆記(md＋記錄),分類法變更時自動重標既有筆記,並偵測使用者對筆記之修改、同步回記錄供下游重判。

- **領域中立**:預設不綁任何主題。主題範圍、知識庫稱呼、分類法、內容類型與證據等級之清單、提示詞之領域句、最高證據等級之要件,全由使用方給。
- **逐層可覆寫**:設定、詞彙、提示詞、domain、子階段與動作鏈、AI 調度層、儲存皆有預設,使用方只給要改的部分。
- **自成一體**:本套件只 import 自己的檔案、`package.json` 所列套件,以及抓取套件(經單一匯入點 `src/core/capturePackage.mjs`);原始碼在 `src/`,下文所列檔案路徑(`core/…`、`stages/…`、`createKnowledgeSummarize.mjs` 等)皆相對 `src/`(測試輔助件在 `test/tools/`,隨 npm 包發布供下游取用)。

---

## 1. 一輪做什麼

`flow.run()` 依序跑四個子階段(`cfg.stageOpts` 之鍵):

| 子階段 | 鍵 | 做什麼 | 呼叫 AI |
|---|---|---|---|
| 預篩 | `triage` | 未預篩之 raw 文件以「標題＋開頭片段(長文另附中段)」判是否含可長期複用之知識;明確無關者攔下(轉 `skip`,理由「預篩：…」),拿不準一律放行;失敗達上限亦放行(fail-open) | 是(席位 `summarize.triage.ai`,未設即 `summarize.ai`) |
| 摘要 | `summarize` | 已放行之文件依字數打包成批,AI 逐篇萃取欄位與待探索線索 → 納入閘(正規化、硬性欄位、數字紮根)→ 組 md 筆記 → 落地前再驗筆記標準 → 寫 md、入 `notes`、文件轉 `noted`;判非知識者轉 `skip` 但仍收線索 | 是(`summarize.ai`) |
| 重標 | `retag` | 每輪以現行詞彙表同步分類法狀態;改名者機械改寫、新增／退役之類別由 AI 重判落點類別之筆記;未宣告之移除只守門告警、資料不動 | 有工作時(`summarize.retag.ai`,未設即 `summarize.ai`) |
| 同步 | `sync` | 筆記 md 之標題／概念／一句話重點被改者,先過筆記標準(確定性修正、仍不合格者登錄待判),再同步回記錄並寫 `knowledgeChangedAt` | 否 |

文件狀態(值域屬抓取套件):本套件讀 `raw`,轉為 `noted`(已成筆記)、`skip`(預篩攔下、判非知識或素材壞了而不能換法重抓)或 `summarize-failed`(試滿 `maxTries` 仍做不出合格筆記;`reviveFailedDocs` 可重開)。素材壞了(亂碼、正文未載入、被截斷…)而抓取套件判可換法重抓者,退回抓取(狀態回 `new`)。

### 與上下游之介面

| 方向 | 內容 |
|---|---|
| 抓取 → 本套件 | `docs` 中 `status:'raw'` 之文件(正文在 `text`、取得方式在 `textFrom`、進入 raw 之時刻 `rawAt`);原文另存在 `docTexts`(唯讀,筆記標準之數字紮根以之為材料) |
| 本套件 → 抓取 | ①文件之狀態轉移與欄位:預篩判定 `triage`／`triagedAt`／`triageTries`、摘要 `summarizeTries`／`summarizeProviders`／`stdFeedback`／`lastError`、略過 `skipKind`／`skipReason`、成筆記 `noteSlug`／`notedAt`、素材退回之欄位(由抓取套件之 `refetchRequestOf` 決定);②**待探索線索**以抓取套件之 `saveClues` 寫入 `frontier`(知識文件 `doc:<id>`、略過文件 `skip:<id>`) |
| 本套件 → 下游 | ①**筆記記錄**(`notes`):`id`、`title`、`category`(清單外之原值存 `categoryRaw`)、`concepts`、`summary`、`claimType`、`evidenceLevel`、`caveats`、`samplePeriod`、`sourceUrl`、`sourceName`、`docId`、`sourceChars`／`processedChars`(截斷明示)、`file`、`createdAt`、`syncHash`、`stdFixes`;下游處理時刻之欄位 `relatedAt`、`extractedAt` 初值為空字串、由下游寫。②**筆記 md**:frontmatter 與章名、行首標籤為版型契約(「一句話重點」「品質與證據標注」「核心知識」「關鍵參數」「方法與步驟」「適用條件與限制」「利弊與取捨」「時效與機制相依」「爭議與反方觀點」「可驗證要點」「來源」);「關聯」「⚠ 衝突與反例」兩章由下游寫入,本套件不讀不寫(`NON_CONTENT_SECTIONS`)。下游讀版型一律取本套件之讀法件:`noteContentText`、`noteMaterialText`、`sectionBodyOf`、`sectionItemsOf`(條列章之項:「- 」「* 」起首之行)、`originalTitleOf`、`publishedOf`(來源章之「發布時間：」;「（未提供）」為空)、`evidenceNoteOf` |
| 變更之通知 | **跨套件一律以記錄欄為準**:分類已改 → `tagChangedAt`;內容已改 → `knowledgeChangedAt`。ctx 旗標 `notesTagChanged`(重標寫)、`notesChanged`(同步寫)為本輪篇數之累計,**只在同一條管線內**有效(下游段與本套件同一 `definePipeline` 時才讀得到) |
| 執行摘要 | run.json 中段名「摘要」之段,其 `sub` 為 `triage`／`summarize`／`retag`／`sync` 之 report;鍵之全集見 `SUMMARIZE_REPORT_KEYS`(`logContract.mjs`) |
| 日誌 | 外部巡檢所需之字樣與正則:`SUMMARIZE_LOG_KNOWN`(已知常態)、`SUMMARIZE_LOG_MUST_SEE`(一律須見)、`SUMMARIZE_LOG_PARSE`(run.json 缺時之退路);皆以實際日誌驗證 |
| 還原閘 | 下游把封存之筆記放回庫時,注入 `createNoteRestoreGate({ stores, vocab, clock })` 之 `{ check({ record, md }), hold(record, results) }`:check 回確定性修正後之 md、記錄 patch、各標準之判定與 `contentChanged`(內容章有變)／`titleChanged`(標題有變)兩旗標(與存量處置之帳列同義;已被下游消化者任一為真即須重設基準);hold 把仍不合格或未能判定者登錄待判 |
| 筆記之刪除與還原 | 由下游之維運執行(刪除連帶撤邊、封存;還原自封存整份放回):本套件不提供刪除,亦不重組被還原之筆記內容——還原時之內容判定與修正一律經上列還原閘 |

---

## 2. 安裝與執行環境

```
npm i w-knowledge-summarize
```

依賴套件(`dependencies`,隨本套件一併安裝):w-knowledge-capture、wsemi。

| 外部程式 | 用途 | 沒有時 |
|---|---|---|
| opencode CLI | 預設 AI 席位(免費模型,免金鑰) | 各段之 AI 呼叫失敗:預篩失敗達上限即放行、摘要記 tries(達上限轉 `summarize-failed`) |

金鑰(付費或 REST 供應商)放 `<workDir>/.env`(或 `cfg.envFile`),不寫在設定裡。與抓取套件共用同一個 LMDB(`<workDir>/db`,庫名 `knowledge`)時,集合名一致即可,不必遷移。

---

## 3. 快速開始

```js
import W from 'w-knowledge-summarize/src/WKnowledgeSummarize.mjs'

const flow = W.createKnowledgeSummarize({
    workDir: 'd:/my-kb', //唯一必填(與抓取套件同一個 workDir:讀其 docs)
    data: {
        vocab: { kbLabel: '天文學知識庫', domain: '天文學' }, //皆選填;未給 domain 即不限主題
    },
    scheduleLimitMin: 60, //每輪時間上限(分),據以推導整輪預算與鎖之陳舊期限
})
const report = await flow.run()
console.log(report.ok, report.summaryFile) //筆記寫入 d:/my-kb/knowledge/notes
```

`createKnowledgeSummarize` 回傳 `{ run, openStores, closeStores, info }`:`run` 跑一輪;`openStores`／`closeStores` 給維運工具開關集合;`info()` 揭露生效之目錄、設定、時鐘、AI 調度層、domain(與管線同一份)、去重身分、詞彙、時間預算與集合名。

**設定錯誤一律在建構期拋錯**:`cfg` 與設定(`ai`、`summarize`、`capture`)之不認得鍵、型別或值域不合、詞彙表不合規格、注入之 domain 缺成員、啟用之功能缺 domain 成員或判定小組席位、AI 席位引用不存在之條目 id、時區無效、樣式無法編譯——都不會靜默改用預設。

---

## 4. 覆寫點一覽

| 層 | cfg 鍵 | 預設 |
|---|---|---|
| 路徑 | `workDir`(必填)、`dirs`(逐鍵:`db`、`log`、`tmp`、`state`、`knowledge`、`notes`) | `<workDir>/db` 等;筆記 `<workDir>/knowledge/notes`(不隨 `knowledge` 之覆寫移動) |
| 管線名 | `name`(日誌之管道名與執行摘要 `run.json` 之 `name`;非空字串) | `'知識摘要'` |
| 時鐘 | `timeZone`(IANA 時區)、`clock`(整組置換) | `'Asia/Taipei'` |
| 語言 | `lang`(BCP 47 代碼;抓取套件之 `resolveLocale`):提示詞之輸出語言句(三個內建 domain 與速報 domain)、筆記標準 SS3 之適用(只有繁體中文有字形標準——其餘語言掃描逐篇列「不適用」、納入閘、存量處置與內容同步不轉字形)、概念標籤跨文字系統註記之保留方向(中文保留漢字半、其餘保留非漢字半)、概念鍵之繁簡折疊(中文才折)、筆記 slug 之字元政策。每輪依賴 `deps.locale` 與 `info().locale` 為解析後之語言設定;domain 工廠收 `opt.locale`,摘要 domain 帶 `locale` 成員(注入者須與 `lang` 同一語言) | `'zh-TW'` |
| 設定 | `ai`、`summarize`、`capture`(組逐層合併,見 §5) | `core/summarizeSettings.mjs` |
| 資料 | `data.vocab`(見 §6) | 中立之預設詞彙 |
| 提示詞 | `prompts.{triage,summarize,faith,repair,retag}`(見 §7) | 內建通用提示詞 |
| domain | `domains.{triage,summarize,retag}`(整組置換;見 §7);摘要 domain 之 `contract`(產物契約:欄位、組裝、適用之標準;見 §9) | 內建三工廠(摘要為筆記契約;另有速報 `createDigestDomain`) |
| 子階段 | `stageOpts.<鍵>`(各子階段之 opt,含動作鏈 `tap`;`triage`／`summarize`／`retag` 之 `reserveMs`;契約欄位 `enabled:false` 停用、`when(ctx)` 條件執行,每個子階段皆收——停用者 report 為 `{ detail:{ disabled:true } }`)或 `stages`(整組自訂,與 `stageOpts` 擇一) | 四個內建子階段 |
| AI | `aiAdapter`(整組置換)、`aiOptions`(內建調度層之建構選項:`providerPick`、`exes`、`persistStore`、`usageCounter`;抓取套件之 `AI_OPTIONS_KEYS`)、`envFile`、`aiWorkspace` | 內建調度層(抓取套件之 `createAiAdapter`) |
| 儲存 | `lmdb`:`WOrm`、`path`、`db`、`cls`(集合名);`cores`;`dedup` | w-orm-lmdb、`<workDir>/db`、`'knowledge'` |
| 時間與鎖 | `scheduleLimitMin`、`deadlineMs`、`lockStaleMs`、`lock` | 預算 50 分、鎖 `<workDir>/tmp/run.lock` |
| 其他 | `conceptFold`(繁簡折疊;與抓取套件同一單例)、`netGuard`(本機網路判斷;`null` 不判斷)、`logFactory`、`afterRun`(收尾鉤子) | 內建 |

可用鍵之全集在 `createKnowledgeSummarize.mjs` 之 `CFG_KEYS`、`DATA_KEYS`、`PROMPT_KEYS`、`COLLECTION_KEYS`。

**相對路徑之基準各鍵不同**:`envFile` 以 `workDir` 為基準;`lock`(字串)與 `aiWorkspace` 以執行時之 cwd 為基準。`info()` 回報的是解析後之絕對路徑。

**集合**:`docs`、`docTexts`(唯讀)、`frontier`、`notes`、`holds`(待判登錄);`cfg.cores` 給 `true` 或集合名才唯讀加開 `cores`(下游之核心集合:擠在一個標籤之多概念以「各段皆為既有概念」為拆分條件,既有概念另含核心之概念)。

---

## 5. 設定(`ai`／`summarize`／`capture`)

**合併規則**:**組**(物件)逐鍵遞迴合併——給了的鍵取代預設、其餘沿用;**葉**(席位物件、樣式陣列)整個取代、不逐層合併。完整鍵、型別與註解以 `core/summarizeSettings.mjs` 為準(`SUMMARIZE_DEFAULT`／`SUMMARIZE_SCHEMA`／`SUMMARIZE_AI_DEFAULT`／`SUMMARIZE_AI_SCHEMA`;合併與型別規則取自抓取套件,兩套件同一份)。

```js
createKnowledgeSummarize({
    workDir,
    summarize: {
        rounds: 8,                                              //只改所給之鍵
        triage: { docsPerCall: 40 },                            //巢狀組逐層合併:其餘 triage 鍵沿用預設
        ai: { use: 'oc:opencode/big-pickle' },                  //葉(席位)整個取代:不與預設之 fallback 合併
    },
    ai: { parallel: 2 },
})
```

| 組 | 鍵 | 預設 | 意義 |
|---|---|---|---|
| `summarize` | `rounds`／`docsPerCall` | 6／3 | 摘要容量＝`rounds`×`ai.parallel`×`docsPerCall`(54 篇/輪) |
| | `charsPerDoc` | 6000 | 每篇送 AI 之字數;每批字數上限＝`docsPerCall`×本值,依字數打包,單篇逾上限者獨佔一批並截至上限(截斷明示) |
| | `yieldRate` | 0.5 | 產出率估計值(`capacity.notesOut` 供下游之容量檢核;取偏高) |
| | `ai` | 見 §8 | 摘要席位(修補呼叫同席) |
| `summarize.triage` | `enabled` | true | 預篩;停用時摘要不看 `triage` 欄 |
| | `rounds`／`docsPerCall`／`charsPerDoc` | 2／20／400 | 預篩容量＝`rounds`×`ai.parallel`×`docsPerCall`(120 篇/輪);每篇片段字數 |
| | `maxTries`／`passRate` | 2／0.5 | 失敗幾次即放行;放行率估計值(容量自洽檢核用) |
| | `ai` | null | 預篩席位;null＝沿用 `summarize.ai` |
| `summarize.refetch` | `patterns`／`max` | `[]`／1 | 素材問題之追加樣式(接在內建之後)／同一篇至多退回抓取幾次(0＝停用) |
| `summarize.retag` | `perRun`／`notesPerCall`／`mechanicalPerRun` | 60／20／500 | AI 每輪至多重判篇數／每次呼叫篇數／機械改名每輪上限 |
| | `ai` | null | 重標席位;null＝沿用 `summarize.ai` |
| `summarize.standards` | `triageConfirm` | `{ enabled:false, ai:{ first:null, third:null } }` | 預篩攔下之第二席確認(預篩席即另一票,故無 second) |
| | `faithCheck` | `{ enabled:false, maxTries:3, ai:{ first, second, third } }` | 筆記忠實性覆核之判定小組(first、second 必填) |
| | `repair` | `{ enabled:false }` | 欄位定向修補呼叫(未過閘者先依原文修補一次) |
| | `scanEachRun` | false | 每輪結束掃一次可確定性判定之標準(大庫耗時) |
| `ai` | 抓取套件之 `AI_SCHEMA` 各鍵 | 同抓取套件 | `timeoutMs`、`maxRetries`、`cooldownMs`、`providerTimeouts`、`extraProviders`、`pools`、`providerLimits` |
| | `healthStreak` | **3** | 供應商健康降序:同一條目連續幾次整組皆敗即降至鏈尾(抓取套件預設 0＝不開;摘要為呼叫量最大之工作) |
| | `parallel` | 3 | 同時併發之 AI 呼叫數(預篩、摘要、重標各批共用) |
| `capture` | 抓取套件之設定 | 同抓取套件 | 交抓取套件驗;本套件只用素材退回抓取之欄位與 raw 進料上界 |

**字數類之取值**(`summarize.charsPerDoc`、`summarize.triage.charsPerDoc`,及直接使用內建 domain 工廠時之 `createSummarizeDomain`／`createDigestDomain` 的 `summarizeCharsPerDoc`、`createTriageDomain` 的 `triageCharsPerDoc`／`longDocChars`、`buildPrompt` 的 `budgets[i]`):有效值為 1～4294967295 之整數(domain 工廠之 opt 與 `budgets[i]` 亦收其十進位數字字串,如 `'400'`)。`cfg.summarize` 之設定給了非正整數(含 `Infinity`、字串)啟動期拋錯;domain 工廠之 opt 與 `budgets[i]` 給了非預期值(`Infinity`、`'0x10'`、`new Number(n)` 等包裝物件、逾 4294967295 者、`0`、負數、非整數、非數字)視為未給、改用預設(`budgets[i]` 無效則用該 domain 之 `summarizeCharsPerDoc`)。**`Infinity` 不再等於「不截斷」**(舊版經 `Number.MAX_VALUE` 實際不截斷);需「幾乎不截斷」者請給足夠大之有限值,如 `4294967295`。

**容量自洽(啟動期警告)**:抓取(raw 進料上界,取抓取套件之 `captureCapacityOf`)→ 預篩 → 摘要,每關每輪容量須 ≥ 該關之進料上界;只警告「進料 > 容量」。已開啟之判定小組其兩席首選同家且無不同家之第三席者,亦於啟動期警告(兩票恆為同一供應者,永遠判不成)。推導值在 `settings.capacity`(`summarizeCapacityOf`)。

**席位之形狀**:`{ use, fallback?, timeoutMs?, minAttemptMs?, budgetMs? }`——`use` 為條目 id、`fallback` 為條目 id 之陣列、數值鍵為正數(毫秒),其他鍵拋錯(規則取自抓取套件之 `seatProblem`)。可為 null 者只有 `triage.ai`、`retag.ai`(null＝沿用 `summarize.ai`)與判定小組各席;`summarize.ai` 不得為 null。

---

## 6. 資料(`cfg.data.vocab`)

`cfg.data` 只收 `vocab`。詞彙表**整鍵替換**(給 `categories` 就整組換),唯 `guide` 逐欄回退預設;不認得之鍵拋錯。與他段共用一份詞彙表者,以 `pickSummarizeVocab(vocab)` 取本套件所讀之鍵。

| 鍵 | 預設 | 說明 |
|---|---|---|
| `domain`、`kbLabel` | `''` | 主題範圍(提示詞之範圍句;空＝不限)、知識庫稱呼(與抓取套件共用之鍵) |
| `conceptRenames`、`conceptAliases` | `{}` | 概念鍵之改名與別名(與抓取套件同一折疊) |
| `categories`／`fallbackCategory` | 9 類中立類別／`'其他'` | 分類清單(提示詞之單選清單);清單外之類別落 `fallbackCategory`(須在清單內) |
| `categoryRenames`／`categoryRetire`／`categoryHints` | `{}`／`[]`／`{}` | 分類法變更之宣告:改名(機械改寫)、退役(AI 依現行清單重判)、新增類別之重判範圍關鍵詞 |
| `claimTypes`／`evidenceLevels` | 6 種內容類型／`['高','中','低']` | 品質標注之清單(證據等級由高至低) |
| `claimTypeRenames`／`evidenceLevelRenames` | `{}` | 內容類型／證據等級改名之機械對照 |
| `guide` | 中立句 | 提示詞之領域句,三段:`triage`(預篩之判斷對象、排除與放行清單…)、`summarize`(萃取對象、相關性判準、證據等級定義、品質疑慮例…)、`faith`(忠實性判準之條件詞 `scope` 與誇大例 `overclaim`);欄位見 `SUMMARIZE_GUIDE_FIELDS` |
| `evidenceRule` | `null`(**不啟用**) | 最高證據等級之要件 `{ subject, check, strict:[樣式], loose:[樣式], alt?:[樣式] }`:最高級而 caveat 明確自承無此要件(嚴式)→ 降一級;只涉及而未明確(寬式)→ 未能判定。最高級之定義為「A 或 B」者,以 `alt` 給另一種合格證據 B 之樣式:證據說明(品質章「證據等級：高（…）」之括號內文)或 caveats 有一句(以逗號、句號等切分)命中 `alt` 即判合格、不降級——否定、展望與「只是資料來源」之句由樣式自行排除:全句不含否定與展望詞、關鍵詞之前不含「非」、關鍵詞之後接結果類名詞(例:`'^(?!.*(?:未\|無\|不\|待\|需\|可能))(?:(?!非).)*真實世界數據(?:之)?(?:結果\|分析\|佐證)'`)。未給 `alt` 者規則指紋不變。預設不啟用(最高級之定義因領域而異,通用規則會系統性誤判) |

---

## 7. 提示詞(三層覆寫)

輸出契約(欄位、格式、驗證、md 版型)固定;覆寫的是「怎麼問」。

1. **`vocab.guide` 逐句**:填回自己調校過之領域句即可逐字重現自己的提示詞,輸出契約仍隨套件演進。
2. **`cfg.prompts` 整個提示詞函數**:收原參數＋末參數 `ctx:{ kbLabel, domain, vocab, defaultPrompt }`(`defaultPrompt` 為內建提示詞函數,可包裝而不必重寫):

   ```js
   createKnowledgeSummarize({
       workDir,
       prompts: {
           triage: (docs, ctx) => `${ctx.defaultPrompt(docs)}\n（補充：…）`,
           summarize: (docs, conceptVocab, o, ctx) => ctx.defaultPrompt(docs, conceptVocab, o),
           faith: (input, ctx) => ctx.defaultPrompt(input),
           repair: (input, ctx) => ctx.defaultPrompt(input),
           retag: (items, o, ctx) => ctx.defaultPrompt(items, o),
       },
   })
   ```
   回傳非空字串之外者於組提示詞時拋錯(該批落帳為批次例外)。
3. **`cfg.domains` 整組 domain**:`{ triage?, summarize?, retag? }`,須具備內建 domain 之全部成員(建議以 `createSummarizeDomain({ vocab, prompts })` 等工廠之產物展開後覆寫),其 `vocab` 須為 `resolveSummarizeVocab` 之產物。摘要 domain 之 `buildFaithCheckPrompt`、`buildRepairPrompt` 為選填,缺之則對應功能不可開啟(開啟即建構期拋錯)。同一 domain 不可同時給 `cfg.prompts` 之對應提示詞(注入者整組置換內建者,提示詞覆寫會靜默失效——給了即拋)。

**生效之 domain 只有一份**:`info().domains` 即每輪 `deps.domains`;維運工具(人工匯入、評分)取 `info().domains` 即與管線同一套提示詞。子階段之 `opt.domain` 仍可另給(屬自組)。

---

## 8. AI 調度

- **預設席位全為免費模型**:`summarize.ai = { use: 'oc:opencode/mimo-v2.6-flash-free', fallback: ['oc:opencode/big-pickle'] }`;預篩、重標未設即沿用;判定小組預設關閉。付費家請自行加在 `fallback` 尾端。免費模型之目錄會隨供應方變動,實際可用之條目以 `opencode models` 之輸出為準。
- 席位不在 `ai` 段:各子階段於 `callJson` 之 `callOpt.spec` 給(席位清單 `summarizeSeatsOf`、顯示名 `SUMMARIZE_SEAT_LABELS`;啟動期交調度層之 `validateSeats` 檢核,不可解析即拋)。判定小組之組成(兩組:預篩確認 SS5、忠實性覆核 SS14;成員、必填、投票組合、是否開啟)以 `summarizePanelsOf(settings)` 取——席位檢核工具與啟動期之同家警告同讀這一份,呼叫端不另寫。
- **逐次截斷放行**:陣列輸出之呼叫點(預篩、預篩確認、摘要、重標)每次給 `acceptTruncated:true`——輸出被截斷時收前段完整項目,未涵蓋者記 tries 留佇列(部分接受);物件輸出之修補與忠實性覆核不給。建構期不開,故同一調度實例給多個工作共用時互不影響。
- **避開**:摘要之末次重試給 `avoid`(曾對本批文件產出不合格結果之供應者);避開後無條目則不避。
- **扣保留之 AI 呼叫**:預篩、預篩確認(SS5)、摘要、修補、忠實性覆核(SS14)、重標之每次呼叫一律經抓取套件之 `reservedAiCallOf`——送出前以該席位一次呼叫之估計進門(抓取套件之 `captureCallMsOf`;重標固定 5 分;未給保留時預篩與摘要為 0),遞補鏈內(主席失敗後之嘗試之間)以續派門檻 min(進門門檻, 席位 `minAttemptMs` ?? 60 秒)判停,`budgetMs`＝整輪剩餘−保留;重標之本輪 AI 名額用盡併入判停。守門閘:預篩與摘要取抓取套件之 `stageReserveGateOf`(保留為 0 時只看整輪是否逾期),重標維持 `reserveOf`(恆以 5 分為門檻)。整輪已逾期時每次送出前即不送出(同調度層之略過,不記失敗)。覆寫之 `callAI` 收到之 `callOpt` 鍵與以往相同;判定小組之呼叫次數(`confirmCalls`、`faithCalls`)只計確實送出者。
- **免費池額度**(`ai.pools`)、**健康降序**(`ai.healthStreak`,預設 3)、**能力預篩**(`ai.providerLimits` 逐條目上限;內建調度層另計條目與 kind 之固有上限):事件各以 WARN 一行寫入當輪日誌(「供應商額度：」「供應商健康：」「供應商能力：」;注入 `cfg.aiAdapter` 時不接)。
- **失敗預覽**:內建調度層之失敗形狀帶 `preview`(模型回覆之前 120 字),批次失敗之 WARN 附之。
- **斷網不計**:本機網路判斷器(預設依 `capture.network` 建立;`cfg.netGuard` 置換、`null` 不判斷)確認不通時,整鏈皆敗之呼叫回 `skipped`——該批中止、不記 tries。
- **整組置換**:`cfg.aiAdapter` 給一個具 `callJson(prompt, check, { spec, budgetMs?, shouldStop?, avoid?, acceptTruncated? })` 之物件,回傳 `{ ok, data, error, providerId, attempts, skipped, preview?, truncated? }`;`validateSeats`、`drainStats`、`aiUsageToday` 選用。多工作共用調度狀態(冷卻、健康、用量)時,注入同一個實例。
- CLI 型條目讀取哪些檔由 CLI 決定(會讀工作目錄上層之指示檔);要量不受其影響之能力,把 `aiWorkspace` 放在沒有這些檔之目錄樹。

---

## 9. 擴充點

| 要做的事 | 作法 |
|---|---|
| 改某一環之行為 | `cfg.stageOpts.<triage|summarize>.tap`:對動作鏈之錨點 before／after／replace(預篩:`settleTriage`;摘要:`saveClues`、`skipGate`、`renderNote`、`gateNote`、`persistNote`、`markDoc`);重標與同步無動作鏈(給 tap 即拋) |
| 換筆記版型 | `stageOpts.summarize.tap.renderNote.replace`,或注入摘要 domain 之 `renderNoteBody` |
| 換產物(不是筆記) | 摘要 domain 之 `contract = { kind, fields, buildNote(item, doc, { notesDir, nowIso, chars }) → { record, md\|null, text? }, standards }`:`fields` 為 AI 項目之欄位 schema(`required`／`type`／`maxChars`／`maxItems`;納入閘以 SS2 判)、`buildNote` 組記錄(與 md,無 md 者給 `text` 供 SS3／SS4 判)、`standards` 為落地前以筆記標準判之子集。內建 `createSummarizeDomain` 之契約即現行筆記(`noteContractOf`;`limits` 可加欄位上限);速報 `createDigestDomain({ shortMax, longMax, tolerance })` 為第二實例(§15) |
| 自己落地 | `stageOpts.summarize.sink({ record, md, doc, ctx })`(取代寫 md 與入庫;回 `{ id }` 者作文件回鏈之 slug;既有產物之判定仍以 `notes`) |
| 預篩後自己選文 | `stageOpts.triage.rank(docs, { ctx })` 回要留者(docs＝已放行待摘要之文件);未入選者攔下(`skipReason`「預篩：未入選」)、report 計 `ranked`／`rankSkipped` |
| 關掉某子階段／條件執行 | `stageOpts.<子階段>.enabled:false`(report 為 `{ detail:{ disabled:true } }`)、`when(ctx)`;每個子階段皆收(抓取套件之 `stageFields`) |
| 換掉整條管線 | `cfg.stages` 給 `[{ name, run(ctx) }]`(與 `stageOpts` 擇一);可用匯出之子階段工廠自組,依賴一律走 `ctx.deps` |
| 他總組裝共用摘要件 | `createSummarizeRuntime(cfg, settings, { vocab, prompts, domains })`:資料、詞彙、折疊、素材樣式、domain 與其檢核、去重身分、網路判斷——與本套件之總組裝同一份;集合鍵 `SUMMARIZE_STORE_KEYS`、目錄 `SUMMARIZE_DIRS` |
| 他工作以判定小組判定 AI 標準 | `runPanelPage({ local, buildPrompt, shufflePrefix, call, seats, votesOf, stages?, same?, secondOf?, ballotOf?, decideOf?, needThirdOf?, thirdStop? })`(`core/standards/panelRun.mjs`):提示詞先組後叫、第一、二席並行(第二席項序依前綴與鍵之雜湊打亂、編號不變)、前兩席任一中止即整頁中止、未成立而可成立者只送第三席、逐項 `decidePanel`;回 `{ decisions, byIndex, calls, stopped, undecided }`。opt-in(皆未給即預設骨架):`secondOf(local)` 第二席所見之子集(回空即不叫)、`ballotOf(x, a, b)` 該項之前兩票、`decideOf(x, votes)`／`needThirdOf(x, votes)` 以項為參數之裁定與是否叫第三席、`thirdStop`(`PANEL_THIRD_STOP.PAGE` 預設:第三席中止整頁丟棄;`ITEMS`:只使送第三席之項不判、其餘照回,`undecided` 列其編號)。呼叫結果之正規化(`{ ok, data, providerId, stop }`)、分頁、跨頁合成與裁定後之衍生欄位由呼叫端;本套件之忠實性覆核 `runFaithCheck` 即以之執行;下游以 opt-in 給自己的票組與裁定 |
| 保留時間給後段 | `cfg.stageOpts.<triage｜summarize｜retag>.reserveMs`(毫秒數或 `(ctx) => 毫秒數`)。預篩(含第二席確認)、摘要(含修補、忠實性覆核)、重標三段皆扣保留:保留 > 0 時開工前與每輪(wave)開工前須「扣保留後剩餘 ≥ 該席位一次呼叫之估計」(鏈首家之單次逾時:席位 `timeoutMs` → `ai.providerTimeouts[use]` → `ai.extraProviders` 該條目自帶 `timeoutMs` → `ai.timeoutMs` → 300000),不足則少做幾輪(不縮 `rounds`／`docsPerCall`)、文件原樣留池待下輪,report `detail.deferred:true`,日誌寫明;每次 AI 呼叫以「剩餘−保留」封頂;修補與覆核不足時本批不套用、不記次。重標之開工門檻仍為 5 分。他總組裝亦可於每輪依賴給 `deps.reserveMs`(同形;`opt.reserveMs` 未給時三段同取),自組之管線與預設管線一體適用;保留未給則預篩與摘要行為不變 |
| 換儲存 | `cfg.lmdb.WOrm` 給相容之 ORM 建構函數 |
| 收尾通知／巡檢 | `cfg.afterRun({ report, summaryFile, log, deps })`(管線之外、摘要之後;失敗只記 WARN) |

---

## 10. 執行輸出

| 檔案 | 內容 |
|---|---|
| `<log>/<日>/<時間戳>-run.start.json` | 開工標記(本輪上限之宣告);取鎖之前寫入 |
| `<log>/<日>/<時間戳>-run.log` | 本輪日誌 |
| `<log>/<日>/<時間戳>-run.json` | 結構化摘要(管線名預設「知識摘要」〔`cfg.name` 可覆寫〕、段「摘要」與四個子階段之 report、AI 實績) |
| `<notes>/<slug>.md` | 知識筆記 |
| `<state>/taxonomy.json` | 分類法狀態(已套用之版本、重標工作、守門、md 待修補) |
| `<state>/note-sync.json` | 筆記同步之掃描水位 |

**筆記之產出鏈(`produced`)**:每次本套件落筆記(新建與改寫)即於記錄追加一筆產出紀錄,供「出問題時依輪次、席位、實際成交條目、提示詞版本定位、成批重處理或移除」:

| 位置 | 內容 |
|---|---|
| 記錄 `produced` | 最後一筆:`{ v:1, stamp, stage, seat, provider, promptFp?, pkg, at }`——`stamp` 為該輪 `run.json` 之 `stamp`(輪次外之維運呼叫為 `null`);`stage` 為 `summarize`(摘要新建)、`ingest`(人工匯入)、`retag`(分類法重標之 AI 重判)、`standards-fix`(重標之機械改名與 categoryRaw 採納、同步修正、存量處置);`seat` 為設定路徑(`summarize.ai`;重標席未設即沿用);`provider` 為**該次呼叫實際成交之條目**(遞補時為遞補者,非席位之主席);不呼叫 AI 之寫入(機械改名、確定性修正、人工匯入)`seat`／`provider` 同時為 `null`;`promptFp` 為該角色之提示詞指紋(與評分之 `promptFp` 同一算法,算不出者省略);`pkg` 為 `名稱@版本`;`at` 為寫入時刻 |
| 記錄 `producedHistory`／`producedHistoryDropped` | 每次寫入追加一筆(含最後一筆),至多 50 筆,超出捨最舊並累計捨去數 |
| md front matter | 只加純量鍵 `produced_stamp`、`produced_stage`、`produced_provider`(值為 `null` 者省略;物件不入 front matter);僅供人與檔案搜尋,查詢以記錄為準 |
| 文件記錄 `triageVotes` | 預篩確認小組(`summarize.standards.triageConfirm`)做成決定者:`[{ seat, provider, verdict }]` |

成交條目未知者(覆寫之 `callAI` 未回 `providerId`)不寫產出鏈,筆記照寫;舊記錄不回填。依之選件見〈維運 API〉之 `notesByProvenance`。

段之摘要為固定格式(對外契約;`summarizeSummaryOf`):`處理 N、新知識 N、略過 N、線索 N（AI N 次）`,其後依序附(>0 才附)預篩、素材退回、長文截斷、重標、內容變更、標準修正、忠實性覆核、修補、入待判、同步標準修正、確認席關閉、預篩確認(SS5 開啟時:`預篩確認 N 篇（兩席攔下 N、推翻放行 N、不一致放行 N、留待下輪 N）`;預篩段之「放行」只計預篩席放行者)等段;有子階段失敗時改為通用摘要並列出失敗者。

---

## 11. 維運 API

皆為具名匯出;**寫入者由呼叫端負責取執行鎖(與管線互斥)、備份與同意**。

| 函數 | 寫入 | 做什麼 |
|---|---|---|
| `listHolds(holds, { status, object, std, owner })`、`overdueHolds(rows, nowIso)`(抓取套件) | 否 | 待判登錄(鍵 `<物件>:<id>:<標準>`)之列表與逾期者——待判登錄為四工作同一機制,其件屬抓取套件(經其主入口取用);本套件之筆記待判之期限為 `noteHoldDeadlineOf`(`NOTE_HOLD_DEADLINE_DAYS` 天) |
| `requestRetry(holds, id, { at })`、`waiveHold(holds, id, { by, ruling, at })`(抓取套件) | 是 | 使用者處置待判:要求重試(由負責之子階段下輪執行)／豁免(須記裁示者與內容) |
| `reviveFailedDocs(stores, { match, nowIso, apply })` | apply 時 | `summarize-failed` 之文件重開回待摘要(原文自另存回填、tries 歸零;預設預演) |
| `ingestNotes({ stores, dirs, clock, domain, identity }, items)` | 是 | 人工／代理撰寫之筆記入庫(與管線同一組裝與納入閘;`domain`、`identity` 取 `info()`);記產出鏈(`seat`／`provider` 為 `null`) |
| `syncNotes({ stores, dirs, clock, log, vocab }, { all, ids, stamp })` | 是 | 筆記內容變更之掃描(同步子階段之同一實作);確定性修正有寫回者記產出鏈(`stamp` 輪次外不給＝`null`) |
| `notesByProvenance({ stores }, { stamp, stage, provider, seat, since, until, history })` | 否 | 依產出鏈選件:回 `[{ slug, produced }]`(依 slug 升冪)。條件皆選填、為「且」;`stamp`／`seat`／`provider` 給 `null` 選該欄為 `null` 者;`since`／`until` 以時刻比對 `produced.at`(含邊界);預設只比對最後一筆,`history: true` 比對 `producedHistory` 任一筆(回傳符合之最近一筆);無產出鏈之舊記錄不出現;條件不合即拋。選出後之重處理走既有路徑(重摘要、稽核撤出) |
| `taxonomyStatus({ stores, dirs, vocab, settings }, { nowIso })` | 否 | 分類法狀態預覽(若現在跑會排哪些工作) |
| `requeueCategory({ dirs, vocab }, category, { nowIso })`、`categoryProposals(stores)` | 是／否 | 排入某類別之重判／清單外類別之提案彙整 |
| `createNoteRestoreGate({ stores, vocab, clock })` | 否(hold 登錄待判) | 還原筆記之標準閘(§1 介面) |

---

## 12. 檢定標準

`SUMMARIZE_STANDARDS`(`standards/registry.mjs`)一條一列:對象與入口、判定類別、能證明／不能證明、執行處(`檔案:函數`,同一標準之各寫入入口皆列)、是否可存量掃描。程式判定之筆記標準(SS2／SS3／SS4／SS6／SS11)之標題與版本取自 `NOTE_STANDARDS`(判定改變即升版)。

| id | 標準 | 類別 | 存量掃描 |
|---|---|---|---|
| SS1 | AI 輸出之結構與涵蓋(JSON 陣列、逐篇一項;未涵蓋者留待下輪) | 程式 | 否(產出當下驗) |
| SS2 | 筆記欄位齊全與型別(標題、一句話重點、核心知識、概念個數、清單內之內容類型與證據等級、無空白列) | 程式 | 是 |
| SS3 | 正體(簡體專用字、同形誤用、誤用詞為 0) | 程式 | 是 |
| SS4 | 數字紮根:筆記之數字皆見於原文(原文不可得記未能判定) | 程式 | 是 |
| SS5 | 屬本知識庫範疇(預篩攔下須第二席確認;摘要以全文再判) | AI | 只計待確認(見 §13) |
| SS6 | 概念標籤之形式(無計數尾碼、一標籤一概念、無跨文字括號) | 程式 | 是 |
| SS7 | 素材問題退回抓取換法重抓,不以壞素材判非知識 | 程式＋AI | 否 |
| SS8 | 長文截斷明示(不靜默截斷) | 程式 | 否(明示之取捨) |
| SS9 | 分類在清單內;分類法變更觸發重標 | 程式＋AI | 只計重標待判(見 §13) |
| SS11 | 最高證據等級與「明確自承無 {check}」不並存——**規則屬安裝方**(`vocab.evidenceRule`;未給判不適用) | 程式 | 是(報告附規則指紋 `fp`) |
| SS14 | 筆記忠實於原文(寫入前由判定小組覆核;預設關) | AI | 只計待判(見 §13) |

(SS10、SS12、SS13 不存在;新標準另取新號。)

- **新進即受標準**:摘要之納入閘、修補後重閘、人工匯入、筆記同步、還原筆記、存量處置與掃描呼叫**同一判定**(`checkNote`;輸入為落地形態之 md 與記錄)——掃描之結果即現行標準下存量之真實違反數。未達標準之新進者不納入、附回饋重摘,逾次登錄待判(`<物件>:<id>:<標準>`)。
- **存量掃描(唯讀)**:`auditSummarizeStandards({ stores, vocab }, { only, material, maxIds })` → 逐標準之總量、合格／不合格／未能判定／不適用／已豁免與 id;AI 標準(SS5、SS9、SS14)只計待判(`ai.<標準>.open／waived`;來源集合未給者為 `null`,不報為零)。`vocab` 給了須為 `resolveSummarizeVocab` 之產物(否則拋)。**管線每輪掃描**:`summarize.standards.scanEachRun: true`(預設關;大庫耗時)——管線之後、執行摘要之前掃 SS2／SS3／SS4／SS6／SS11,計數入 `run.json` 之 `standards`(本輪已逾時間預算者略過,失敗只留 WARN)。
- **存量處置**:`planNoteStockFix(deps, { stds, ids, limit, material })`(預演,不寫;`stds` 為處置之標準,SS4 須原文——範圍含 SS4 才讀)→ `applyNoteStockFix`(逐篇以現值重算再寫:md 原子寫、記錄先清陣列欄再寫並回驗、逐筆記於存量處置帳 `stock-fix.jsonl`〔抓取套件之帳協定,四工作與宿主同一本帳〕;修不了者〔未修之標準,與有修正而仍有殘留者——擠標籤未拆之段、SS3 轉正體會改分群鍵而不改之概念;後者之 `detail` 為不改之理由〕以抓取套件之存量待判件登錄待判,故套用後重掃之不合格＝修不了者;失敗之件逐件隔離、記 `{ id, object, error }`)→ `verifyNoteStockChain`(套用後之連鎖斷言:記錄之同步雜湊＝現行 md、未寫 `knowledgeChangedAt`、待判已登錄)→ `rollbackNoteStockFix`(依帳逆序回退;讀帳 `readNoteStockLedger` 遇無法解析之列即拒,`allowBad` 才略過;回退之 `titleChanged` 取帳列所記;回退＝撤銷該次處置之效果:帳列記該次所改之單位〔front 之鍵、章前文字、各章〕,逐單位三態——其後被改動者報 `conflicts` 不覆寫、他單位照回,下游之投影章與使用者新增之章不動,`acceptCurrent` 記取代列)。修法即新進閘之同一確定性修正(`noteFixOf`:SS2 壞行、SS3 正體、SS4 移除原文沒有之數字〔須原文〕、SS6 拆擠標籤〔各段皆既有概念才拆〕、SS11 嚴式命中降一級)。**寫入者由呼叫端負責取執行鎖、備份與同意**;不碰下游(回傳 `applied` 之 `titleChanged`／`contentChanged`／`consumed`／`conceptKeys` 供呼叫端連鎖)。
- **使用者豁免**:待判之 `waiveHold(holds, id, { by, ruling })`(抓取套件);掃描把「不合格／未能判定而有豁免」計為已豁免並逐一列出——豁免是裁示,不是合格。
- **下游共用 SS11 之判準**:`noTopEvidenceOf({ caveats, evidence }, rule)`——caveats 有一則命中嚴式或寬式、且證據說明與 caveats 皆無另一種合格證據之肯定陳述 → true(與最高級之筆記判不合格或未能判定同一條件);規則未給或停用、caveats 空或非陣列 → false;規則為不合規格之設定即拋(不靜默當成停用)。

---

## 13. 免費 AI 能力評分(五角色;核心為抓取套件之 benchKit)

量的是本套件五個 AI 呼叫點在**正式提示詞與正式輸出契約**下之判斷品質;角色以抓取套件之角色化核心(`defineBenchRole`／`runBench`／`runBenchCli`)定義,逐案判準、停測、報表與評比表與其他套件之角色同一套。每頁之逐次呼叫選項與正式呼叫一致(預篩／摘要／重標為陣列輸出,逐次 `acceptTruncated:true`;修補／覆核不給)。

| 角色(`--role`) | 對應標準 | 一頁 | 類別(應然) | 內建題組 |
|---|---|---|---|---|
| `triage` 預篩 | SS5 | 20 案 | 放行／攔下 | `bench/cases/triage-generic.json`(16 案) |
| `summarize` 摘要 | SS5(全文再判)＋新進閘 | 依字數打包(≤3 篇、每篇 6,000 字單位) | 非知識／筆記過閘／筆記不過閘 | `summarize-generic.json`(15 案) |
| `repair` 修補 | SS2＋SS4 | 1 案 | 修好／未修好(以正式納入閘複驗) | `repair-generic.json`(15 案) |
| `faith` 忠實性 | SS14 | 10 案 | 忠實／不忠實 | `faith-generic.json`(15 案) |
| `retag` 重標 | SS9 | 同一焦點(新增／退役／排入之類別)、至多 20 案 | 改歸之類別 | `retag-generic.json`(16 案) |

```
node src/bench/cli.mjs [--role <triage|summarize|repair|faith|retag|all>] [--models <id,…>|free] [--cases <題組 json>] [--vocab <詞彙 json> [--vocab-pick]] [--runs 2] [--out <目錄>] [--env <金鑰檔>] [--timeout <毫秒>] [--concurrency <n>] [--tz <IANA 時區>] [--board <評比表 csv>]
```

- **`--role all`**(預設):依序跑五角色,各用內建通用題組;前面角色已停測之模型(限流、連續失敗)不再於後續角色受測。指定題組或角色專屬參數(`--batch`、`--docs-per-call`、`--chars-per-doc`)須配單一 `--role`。
- **計分**:每案呼叫 `runs` 回,**各回之類別皆等於應然才算通過**(不以比率放行);保留題分列;合契約率、平均耗時、呼叫失敗只列資訊。題組無網址與文獻,各案附 `why`;於任何呼叫之前以正式之 domain 組出提示詞並驗完。
- **自己的題組與詞彙**:`--cases` 給與內建同形之題組(SS5／SS14／SS9 之題組可直接用)、`--vocab` 給詞彙物件之 JSON(只收本套件之鍵,他鍵拋錯;與他段共用一份詞彙表者加 `--vocab-pick`——以 `pickSummarizeVocab` 取子集、子集寫入 `--out` 之 `summarize-vocab-<時間戳>.json` 並以之評分;最高證據等級之要件與忠實性之領域句一併填回)——即以自己的正式提示詞量自己的題組。程式呼叫:`runSummarizeBench(role, { models, cases, runs, aiAdapter, vocab, ... })`、`planSummarizeBench(role, opt)`(只備題、不呼叫 AI)、`runSummarizeBenchCli(argv)`。
- **評比表 `模型評比.csv`**(套件根):`--board 模型評比.csv` 產生與更新,一角色一模型一列;本次覆蓋同角色同模型之舊列,**停測或有未呼叫回合者不寫**。欄位含「AI 工作目錄」:CLI 型模型會讀該目錄上層之指示檔(§8),**量通用能力時 `--out` 放在任何專案之外**(AI 工作目錄＝`<out>/ai-workspace`,結束即刪)。各列之「評比時間」「提示詞指紋」可辨批次與所用之提示詞:指紋與現行提示詞之指紋(`planSummarizeBench(role, opt).promptFp`)不同之列為舊提示詞所評,以同角色同模型重評即覆蓋。
- **免費額度**:opencode 免費模型有每日額度(UTC 0 時重置)。`--role all` 一次全量每模型每回 26 次呼叫(8 模型 × 2 回 ≈ 416 次),可能逾當日額度——撞額度之模型以逾時停測、該角色不寫入評比表,隔日以 `--role <角色> --models <id>` 補跑。分數會浮動(每案只跑 `runs` 回),據以換席位前宜重跑確認。
- **報表**:`<out>/<角色>-bench-<時間戳>` 之逐模型 CSV、逐案 CSV、Markdown、JSON;逐回進度 `.progress.jsonl`(中途被終止也留得下)。

---

## 14. 測試

在套件根執行(`package.json` 之 scripts 為 `test` 與 `deploy`):

```
npm test                                                        # mocha --parallel "test/*.test.mjs" --timeout 180000
node <mocha 路徑>/bin/mocha.js --timeout 180000 test/<檔名>      # 單檔
```

| 層 | 檔案 | 內容 |
|---|---|---|
| 核心與設定 | `unit-core`、`unit-settings`、`unit-vocab`、`unit-evidence`、`unit-ai-batch` | 本套件之核心件、設定與詞彙之逐鍵檢核、證據規則、批次 AI 機制 |
| 模組 | `unit-summarize-{standards,domain,stores,holds,faith,repair,stages,retag,sync,ops}` | 筆記標準與納入閘、提示詞與 domain、筆記組裝與分類法、待判、忠實性覆核、修補、各子階段、維運 |
| 時間(保留) | `unit-summarize-{reserve,reserve-gate,reserved-call}` | 預篩、第二席確認、摘要、修補、忠實性覆核扣保留給後段之時間(開工前與每輪開工前守門、呼叫以「剩餘−保留」封頂、不足時文件留池、保留未給行為不變;以注入之虛擬時鐘同步)；取值器,與所依之抓取套件一次呼叫之估計、守門閘;六站經抓取套件 `reservedAiCallOf` 之接線(逐次進門、遞補鏈內之續派門檻、覆寫之 `callAI` 之鍵、覆核第一席同步拋出不呼叫第二席;接縫一案以真調度層與本機假端點驗遞補是否派出;重標之接線案在 `unit-summarize-retag`) |
| 檢定標準 | `unit-summarize-{registry,audit,stockfix}` | 標準之登記(執行處之檔與函數存在、版本單一來源)、存量掃描(與新進閘同一判定、豁免、AI 標準只計待判、真 LMDB)、存量處置(預演／套用／回驗／回退、處置帳) |
| 物件與組裝 | `unit-summarize-object`、`unit-summarize-assembly`、`unit-summarize-entry`、`unit-summarize-package` | 物件之子階段序列與固定格式摘要;總組裝之逐鍵檢核、domain 與提示詞、核心集合、網路判斷、去重身分、席位與調度層事件、保留時間;入口匯出;**套件邊界、依賴、發布面(不設 `exports` 與 `files`、`.npmignore`、`LICENSE`)、範例 `g.mjs` 離線可執行且 README 含其全文、發布內容不帶宿主之痕跡、預設領域中立、舊名、沿革與面向使用者之字樣**(判準取抓取套件之 `test/tools/historyMarks`,四套件同一份;不以名指下游之工作) |
| 契約與流程 | `unit-summarize-log-contract`、`unit-flow-summarize`、`unit-summarize-contract`、`unit-summarize-material` | 日誌字樣、正則與 report 鍵對實際產出;真 LMDB 上兩輪之完整流程;筆記標準於各寫入入口之處置一致與還原閘之對外契約;素材退回抓取之往返 |
| 評分 | `unit-summarize-bench`、`api-summarize-bench-ai` | 評分角色與題組;真 AI(`WK_LIVE_AI=1` 才跑) |

- **固定埠**(≥8000、不隨機):8841 為無人監聽之埠(內建調度層之「整鏈皆敗」)、8842 為本機假 REST(截斷與失敗預覽)、8847 為本機假 REST(`unit-summarize-reserved-call` 之接縫案);8843～8846、8848～8849 保留。
- **暫存**:各測試自建 `test/_tmp/<名>-<pid>`,測完刪除。
- 測試中之 AI 一律為替身或本機假端點,不連外網、不燒額度。
- **跨工作之原案不在本套件重現,改以本套件一側之契約測試驗其介面**:`unit-summarize-contract`(筆記標準於各寫入入口之處置一致——最高證據等級之要件於新進、修補後重閘、同步、還原、存量處置與掃描,正體與概念標籤於修補後重閘、人工匯入、還原與掃描;還原閘之對外契約)、`unit-summarize-material`(素材退回抓取之往返;抓取之件經測試專用之橋接 `test/tools/captureForTest.mjs`,套件程式碼不 import);領域中立掃描共用之詞表取抓取套件之 `test/tools/domainTerms.mjs`(經 `test/tools/captureForTest.mjs`;四套件同一份,自檢在抓取套件之 `unit-domain-terms`)。本套件 `test/tools/stageKit.mjs` 之子階段 ctx(`bagCtx`:以 Map 為底之 get／set,旗標可斷言)為下游之段測試同一份(經其 `summarizeForTest` 取用);題組檔(`bench/cases/*.json`)之說明文字(頂層 `note` 與各案 `why`)與原始碼同受沿革守門,材料與應然不掃。

---

## 15. 收斂到特定主題

套件預設不限主題;要專注某一領域,只給資料與設定,不改程式。以天文學知識庫為例:

```js
createKnowledgeSummarize({
    workDir: 'd:/astro-kb',
    data: {
        vocab: {
            kbLabel: '天文學知識庫', domain: '天文學',
            categories: ['觀測方法', '儀器與資料', '理論模型', '數值模擬', '其他'],
            guide: {
                summarize: { caveatExamples: ['樣本數少', '單一觀測站', '未經獨立觀測'] },
                faith: { scope: '特定波段、觀測期間或天區', overclaim: '原文只有單次觀測，筆記寫成已獲獨立觀測證實' },
            },
            //最高證據等級須經獨立觀測:caveat 明確自承未經者降一級
            evidenceRule: { subject: '獨立觀測', check: '獨立觀測證實', strict: [{ p: '(?:未經|沒有|無)獨立觀測' }], loose: [{ p: '(?:未|無)[^；;。]{0,10}獨立觀測' }] },
        },
    },
    summarize: { rounds: 8 },
})
```

**整合進多工作之知識庫專案**(專案之設定檔頂層有 `ai`、`capture`、`summarize` 等段,各工作各佔一段):

- **設定**:專案之 `summarize` 段原樣給 `cfg.summarize`(鍵與型別見 §5);`ai` 段只挑本套件認得之鍵(`SUMMARIZE_AI_SCHEMA`)——供應商池等他工作之鍵會被拒收;`capture` 段原樣給 `cfg.capture`。
- **詞彙**:專案之詞彙表含他段之鍵時,以 `pickSummarizeVocab` 取子集;要逐字重現既有之提示詞,把既有之領域措辭填回 `guide`(含 `faith` 段),最高證據等級之要件填回 `evidenceRule`。
- **時間**:同一輪後段另有耗時之工作者,以 `cfg.stageOpts.<triage｜summarize｜retag>.reserveMs`(或其函數形式)保留其時間;他總組裝以自己之每輪依賴驅動本套件之物件者,於依賴給 `reserveMs` 一次即可(預篩、摘要、重標之 `opt.reserveMs` 未給時皆取之)——本套件不讀他工作之設定。時間不足是「少做幾輪」不是「縮容量」,巡檢以 `detail.deferred` 分辨時間不足與容量不足。
- **AI 調度**:多工作共用冷卻、健康與用量者,建一個調度實例以 `cfg.aiAdapter` 注入各工作(截斷放行為逐次給,共用不互相影響)。
- **共用一庫**:`lmdb.db`／`lmdb.cls` 對齊既有之庫名與集合名;既有庫有核心集合者給 `cores: true`。

**速報(digest)契約之零件庫用法**(宿主只要每篇一句話與一段摘要、自己落地、不要筆記 md 與分類):

```js
import { createKnowledgeSummarize, createDigestDomain } from 'w-knowledge-summarize/src/WKnowledgeSummarize.mjs'

const flow = createKnowledgeSummarize({
    workDir: 'd:/daily-brief',
    domains: { summarize: createDigestDomain({ shortMax: 60, longMax: 200, tolerance: 1.5 }) },   //產物契約:short／long、不落 md、落地前判 SS3／SS4
    summarize: { triage: { enabled: true }, docsPerCall: 5 },
    stageOpts: {
        triage: { rank: async (docs) => (await rankByTitle(docs)).slice(0, 10) },             //預篩放行者再由宿主選前 10 篇
        summarize: { sink: async ({ record, doc }) => { await sendTelegram(record); return { id: record.id } } },   //自己落地(不入庫、不寫檔)
        retag: { enabled: false }, sync: { enabled: false },
    },
})
await flow.run()   //文件 noted 並回鏈 record.id;未達契約(欄位逾上限×容差、簡體、原文沒有之數字)者不納入、附回饋下輪重摘
```

---

## Breaking changes

- **須搭配 w-knowledge-capture 1.0.18 以上**(其又須 w-dispatch-ai 1.0.86 以上;共用同一持久 store 之套件同一次升版,見抓取套件之 README〈Breaking changes〉)。
- **刪除 `summarizeCallMsOf`、`reserveGateOf`**(`src/core/stages/stageReserve.mjs`;主入口與預設物件亦不再含,不留相容層):一次呼叫之估計改用抓取套件之 `captureCallMsOf`(單席之取值順序與結果相同,另收席位陣列取最大)、守門閘改用抓取套件之 `stageReserveGateOf`(`keep`／`remainingMs`／`expired`／`shouldStop` 之語意相同;無 `canStart`,以 `!shouldStop(ms)` 代之;另有 `cut(ms)`＝保留 > 0、整輪未逾期而扣保留後剩餘不足)。保留時間取值器 `reserveFnOf` 照舊。
- **遞補鏈內之判停門檻**(預篩、預篩確認、摘要、修補、忠實性覆核、重標):以往與進門門檻相同(該席位一次呼叫之估計;重標 5 分),主席等滿逾時後之剩餘即小於它,遞補一律被中止;今為 min(進門門檻, 席位 `minAttemptMs` ?? 60 秒)——扣保留後剩餘不足一次呼叫而仍 ≥ 續派門檻時,主席失敗後照派遞補(預算仍以「剩餘−保留」封頂)。覆寫之 `callAI` 收到之 `shouldStop` 依此判。
- **逐次進門**:同一輪並行之各批、判定小組之各席於送出前各判一次(以往只在每輪開工前判);前批送出後扣保留後剩餘已不足一次呼叫者,後批不送出(同調度層之略過:不記 tries、文件留池;重標該篇未判、不記失敗)。保留未給(0)時進門門檻為 0,唯整輪已逾期者每次送出前即不送出——以往仍交覆寫之 `callAI`(內建調度層則因預算已盡而略過,結果相同)。判定小組之呼叫次數(`confirmCalls`、`faithCalls`,預篩之 `stats.aiCalls` 含前者)只計確實送出者。
- **重標**:本輪 AI 名額(`summarize.retag.perRun`)用盡併入呼叫內之判停。

---

## 16. 已知限制

- **不做 AI 狀態落檔**:游標、冷卻、用量皆在行程內(排程每輪新行程;冷卻短於排程週期)。
- **長文逾上限只截斷、明示**:單篇逾每批字數上限者截至上限(筆記記 `sourceChars`／`processedChars`、md 來源章多一行處理範圍、report 計 `truncated`),不做分段摘要再合併。
- **網頁原文回溯物不作數字紮根(SS4)之材料**:抓取套件事後回溯另存之原文不回頭改判既有筆記。
- **逐項鏈異常與 AI 失敗共用 tries**:動作鏈之環拋錯(程式或寫入問題)亦記 `summarizeTries`(排隊尾、不擋隊頭)但永不標終態,每次 WARN。
- **內建提示詞與版型為繁體中文**:`lang` 只換輸出語言句、字形政策與 slug 政策,不翻譯提示詞本體與 md 章名(整份提示詞可經 `cfg.prompts` 覆寫;章名為跨套件契約 `NOTE_SECTION_TITLES`,本版不在地化)。字形標準只有臺灣正體一種;其他語言之 SS3 列不適用,無對應之字形檢查。證據規則之比對前折疊固定折向正體(規則以正體書寫即可命中簡體與全形寫法)。
- **最高證據等級之要件(SS11)預設不啟用**:安裝方給 `vocab.evidenceRule` 才判;另一種合格證據(`alt`)以逐句樣式比對,不做語意理解——否定、假設或展望句(「可望用於…」)須由樣式排除,安裝方宜以既有筆記實測其命中再上線。
- **重標失敗兩次即略過、不換家**:同一筆記於同一重標工作 AI 重判 2 次未成即略過之(退役類別者登錄待判 SS9)。
- **內建之預篩排名為後續版本**:預篩只判放行／攔下,「取前 N」由宿主以 `stageOpts.triage.rank` 自排(§9)。
- **非筆記契約之記錄不入重標、同步與符合度掃描**:速報等不落 md 之產物,重標與同步會記 md 讀不到、掃描列未能判定——該類用法請關閉 `retag`／`sync` 子階段並不開 `scanEachRun`。
