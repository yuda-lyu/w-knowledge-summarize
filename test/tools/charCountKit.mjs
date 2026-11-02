// charCountKit.mjs — 字數類 opt(summarizeCharsPerDoc、triageCharsPerDoc、longDocChars、逐篇 budgets[i])之案例組:程序內測試與嚴格版子行程共用
//
// 【觀察法】文件正文全為標記字元 MARK(提示詞固定段不含它),數提示詞內 MARK 之個數＝該篇實際送入之字數(截斷後);
//   各選項以兩種正文長度(3000、9000)觀察,使「是否截斷」「是否另附中段」皆可分辨。
// 【應然】有效值(1～4294967295 之整數,或其十進位數字字串)依其值;非預期值(Infinity、'0x10'、包裝物件、逾上限者、非整數、非數字…)視為未給、改用預設
//   (dspec〈輸入參數之檢測機制〉§11 第 19、20 項;opt 類 K3)——故非預期值之觀察結果須等於「未給」(undefined)之觀察結果。

export const MARK = ''
export const LENS = Object.freeze([3000, 9000])

const countIn = (s) => s.split(MARK).length - 1
const docOf = (n) => ({
    id: 'd1',
    title: '標題',
    sourceName: '來源',
    url: 'https://example.com/a',
    text: MARK.repeat(n),
})

/**
 * 選項表:id、觀察函數 build(D, v, n)＝以值 v、正文長度 n 組出之提示詞;valid＝有效值之基準(其變體寫法觀察結果須相同)與其觀察結果 validCounts;
 *   maxCounts＝值為 4294967295(count 上限)之觀察結果;defaultCounts＝未給(預設)之觀察結果
 *
 * @type {Array}
 */
export const OPTIONS = Object.freeze([
    {
        id: 'note.summarizeCharsPerDoc',
        valid: 100,
        validCounts: [100, 100],
        maxCounts: [3000, 9000],
        defaultCounts: [3000, 6000],
        build: (D, v, n) => D.createSummarizeDomain({ summarizeCharsPerDoc: v }).buildPrompt([docOf(n)], []),
    },
    {
        id: 'digest.summarizeCharsPerDoc',
        valid: 100,
        validCounts: [100, 100],
        maxCounts: [3000, 9000],
        defaultCounts: [3000, 6000],
        build: (D, v, n) => D.createDigestDomain({ summarizeCharsPerDoc: v }).buildPrompt([docOf(n)], []),
    },
    {
        id: 'triage.triageCharsPerDoc',
        valid: 100,
        validCounts: [100, 200],
        maxCounts: [3000, 9000],
        defaultCounts: [400, 800],
        build: (D, v, n) => D.createTriageDomain({ triageCharsPerDoc: v }).buildPrompt([docOf(n)]),
    },
    {
        id: 'triage.longDocChars',
        valid: 2000,
        validCounts: [200, 200],
        maxCounts: [100, 100],
        defaultCounts: [100, 200],
        build: (D, v, n) => D.createTriageDomain({ triageCharsPerDoc: 100, longDocChars: v }).buildPrompt([docOf(n)]),
    },
    {
        id: 'note.budgets[0]',
        valid: 50,
        validCounts: [50, 50],
        maxCounts: [3000, 9000],
        defaultCounts: [777, 777],
        build: (D, v, n) => D.createSummarizeDomain({ summarizeCharsPerDoc: 777 }).buildPrompt([docOf(n)], [], { budgets: [v] }),
    },
    {
        id: 'digest.budgets[0]',
        valid: 50,
        validCounts: [50, 50],
        maxCounts: [3000, 9000],
        defaultCounts: [777, 777],
        build: (D, v, n) => D.createDigestDomain({ summarizeCharsPerDoc: 777 }).buildPrompt([docOf(n)], [], { budgets: [v] }),
    },
])

/** 有效值之變體寫法(皆等價於數字 n):數字、數字字串、頭尾空白、帶 .0、帶正號、前導零 */
export const validVariants = (n) => [n, `${n}`, ` ${n} `, `${n}.0`, `+${n}`, `0${n}`]

/**
 * 非預期值(名稱 → 值):改用預設;名稱即錯誤訊息用(字串值以 str 起頭)
 *
 * @type {Array}
 */
export const UNEXPECTED = Object.freeze([
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['NaN', NaN],
    ['str Infinity', 'Infinity'],
    ['str 0x10', '0x10'],
    ['str 0b11', '0b11'],
    ['str 0o17', '0o17'],
    ['Number wrapper 100', Object(100)],
    ['String wrapper 100', Object('100')],
    ['object with valueOf 100', { valueOf: () => 100 }],
    ['Number.MAX_VALUE', Number.MAX_VALUE],
    ['2**32 (over count max)', 2 ** 32],
    ['2**53', 2 ** 53],
    ['1e21', 1e21],
    ['str 9007199254740993', '9007199254740993'],
    ['0', 0],
    ['str 0', '0'],
    ['-1', -1],
    ['1.5', 1.5],
    ['str 1.5', '1.5'],
    ['str empty', ''],
    ['str space', ' '],
    ['str abc', 'abc'],
    ['str 1,000', '1,000'],
    ['null', null],
    ['true', true],
    ['false', false],
    ['[]', []],
    ['[100]', [100]],
    ['{}', {}],
    ['100n', 100n],
    ['function', () => 100],
    ['Symbol', Symbol('x')],
])

/**
 * 逐選項、逐值觀察(程序內與嚴格版子行程同一份):回傳 { '<選項 id>|<值名>': [各長度之 MARK 數] 或 { error } }
 *
 * @param {Object} D 輸入 { createTriageDomain, createSummarizeDomain, createDigestDomain }
 * @returns {Object} 回傳觀察結果
 */
export function runCharCountCases(D) {
    const out = {}
    for (const o of OPTIONS) {
        const values = [
            ...validVariants(o.valid).map((v) => [`valid ${JSON.stringify(v)}`, v]),
            ['max 4294967295', 4294967295],
            ['omitted', undefined],
            ...UNEXPECTED,
        ]
        for (const [name, v] of values) {
            const key = `${o.id}|${name}`
            try {
                out[key] = LENS.map((n) => countIn(o.build(D, v, n)))
            }
            catch (e) {
                out[key] = { error: String(e?.message ?? e) }
            }
        }
    }
    return out
}
