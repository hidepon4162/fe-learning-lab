import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "codeview.js"), "utf8");
const ctx = createContext({});
runInContext(src, ctx);
const C = ctx.Codeview;

test("parseCodeview: 未保存と不正値は ipa", () => {
    assert.equal(C.parseCodeview(null), "ipa");
    assert.equal(C.parseCodeview(""), "ipa");
    assert.equal(C.parseCodeview("night"), "ipa");
    assert.equal(C.parseCodeview("csharp"), "csharp");
    assert.equal(C.parseCodeview("ipa"), "ipa");
});

test("stripPseudoComments: 行末の // 注記を消す", () => {
    const src = 'if ((x ≠ 0) and ((10 ÷ x) ＞ 1))  // C#の && は短絡評価\n  true';
    const out = C.stripPseudoComments(src);
    assert.equal(out.includes("//"), false);
    assert.match(out, /if \(\(x ≠ 0\)/);
    assert.match(out, /true/);
});

test("filterForCodeview: ipa では csharpOnly を除く", () => {
    const list = [
        { id: "a", csharpOnly: true },
        { id: "b" },
        { id: "c", csharpOnly: false }
    ];
    assert.deepEqual(C.filterForCodeview(list, "ipa").map((q) => q.id), ["b", "c"]);
    assert.deepEqual(C.filterForCodeview(list, "csharp").map((q) => q.id), ["a", "b", "c"]);
});

test("usesCsharpDisplay: csharpOnly は擬似言語モードでも C#", () => {
    assert.equal(C.usesCsharpDisplay({ csharpOnly: true }, "ipa"), true);
    assert.equal(C.usesCsharpDisplay({}, "ipa"), false);
    assert.equal(C.usesCsharpDisplay({}, "csharp"), true);
    assert.equal(C.displayLangOf({ csharpOnly: true }, "ipa"), "C#");
    assert.equal(C.displayLangOf({}, "ipa"), "擬似言語");
});

test("csharpSource: code を優先し、なければ expr", () => {
    assert.equal(C.csharpSource({ code: "int x;", expr: "x" }), "int x;");
    assert.equal(C.csharpSource({ expr: "x < 1" }), "x < 1");
});
