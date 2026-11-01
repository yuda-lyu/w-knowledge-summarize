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
