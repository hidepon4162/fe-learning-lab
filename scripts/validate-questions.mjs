import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const questions = JSON.parse(readFileSync(join(root, "questions.json"), "utf8"));

const errors = [];
const required = ["id", "lang", "genre", "topics", "difficulty", "question", "choices", "answer", "jp", "jpResult"];

if (!Array.isArray(questions) || questions.length === 0) {
    errors.push("questions.json は空でない配列である必要があります。");
}

const ids = questions.map((q) => q.id);
const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dup.length) errors.push(`ID重複: ${[...new Set(dup)].join(", ")}`);

const answerCounts = [0, 0, 0, 0];
let starConditions = 0;

for (const q of questions) {
    for (const key of required) {
        if (q[key] === undefined || q[key] === null || q[key] === "") {
            errors.push(`${q.id ?? "(idなし)"}: ${key} が空です。`);
        }
    }
    if (!Array.isArray(q.topics) || q.topics.length === 0) {
        errors.push(`${q.id}: topics が空です。`);
    }
    if (![1, 2, 3].includes(q.difficulty)) {
        errors.push(`${q.id}: difficulty は 1〜3 である必要があります。`);
    }
    if (!q.code && !q.expr) {
        errors.push(`${q.id}: code または expr が必要です。`);
    }
    if (!Array.isArray(q.choices) || q.choices.length !== 4) {
        errors.push(`${q.id}: choices は4件である必要があります。`);
        continue;
    }
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.choices.length) {
        errors.push(`${q.id}: answer が範囲外です。`);
        continue;
    }
    answerCounts[q.answer] += 1;
    const correct = String(q.choices[q.answer]).trim();
    const jpResult = String(q.jpResult ?? "").trim();
    if (correct !== jpResult) {
        errors.push(`${q.id}: jpResult "${jpResult}" が正答 "${correct}" と一致しません。`);
    }
    if (q.genre === "conditions" && q.difficulty === 1) starConditions += 1;

    const pseudo = String(q.pseudocode ?? "");
    const pseudoCode = pseudo.replace(/\/\/.*$/gm, "");
    if (/for\s*\(\s*\w+\s*←/.test(pseudoCode)) {
        errors.push(`${q.id}: 擬似言語の for が IPA 形式ではありません（「i を … から … まで」）。`);
    }
    if (/for\s*each/i.test(pseudoCode)) {
        errors.push(`${q.id}: 擬似言語に foreach があります（IPA にはありません）。`);
    }
    if (/関数を宣言|手続を宣言/.test(pseudoCode)) {
        errors.push(`${q.id}: 副プログラム宣言が IPA の ○ 形式ではありません。`);
    }
    if (/^\s+真\s*$/m.test(pseudoCode) || /^\s+偽\s*$/m.test(pseudoCode) || /← 偽\b/.test(pseudoCode)) {
        errors.push(`${q.id}: 論理定数は true / false を使ってください（IPA）。`);
    }
    if (q.genre === "arrays") {
        if (/\[0\]|\[0,|\.Length|←\s*\[/.test(pseudoCode)) {
            errors.push(`${q.id}: 配列の擬似言語が 0 始まりまたは C# 寄りの記法です。`);
        }
    }
    if (q.genre === "subprograms" && !pseudo.includes("○")) {
        errors.push(`${q.id}: 副プログラムの擬似言語に ○ 宣言がありません。`);
    }
}

const n = questions.length;
const maxShare = Math.max(...answerCounts) / n;
if (maxShare > 0.4) {
    errors.push(`正答位置の偏り: 最大 ${(maxShare * 100).toFixed(1)}%（上限40%）。内訳=${answerCounts.join("/")}`);
}
if (answerCounts.some((c) => c === 0)) {
    errors.push(`使われていない正答位置があります: ${answerCounts.join("/")}`);
}
if (starConditions < 10) {
    errors.push(`初級プリセット用の条件式★が ${starConditions} 問しかありません（必要: 10問以上）。`);
}

const csharpOnlyExpected = ["cond-007", "cond-008", "cond-016", "cond-019"];
const csharpOnlyGot = questions.filter((q) => q.csharpOnly === true).map((q) => q.id).sort();
if (csharpOnlyGot.join(",") !== csharpOnlyExpected.slice().sort().join(",")) {
    errors.push(`csharpOnly の対象が違います: 実測=${csharpOnlyGot.join("/") || "(なし)"} 期待=${csharpOnlyExpected.join("/")}`);
}

if (errors.length) {
    console.error(`FAIL (${errors.length}件)`);
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
}

console.log(`OK ${n}問 / 条件式★ ${starConditions}問 / 正答位置 ${answerCounts.join("/")}`);
