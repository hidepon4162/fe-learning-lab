var Codeview = (function () {
    function parseCodeview(value) {
        return value === "csharp" ? "csharp" : "ipa";
    }

    function stripPseudoComments(text) {
        return String(text ?? "")
            .split("\n")
            .map((line) => line.replace(/\s*\/\/.*$/, "").trimEnd())
            .filter((line) => line.length > 0)
            .join("\n");
    }

    function filterForCodeview(list, mode) {
        const src = Array.isArray(list) ? list : [];
        if (parseCodeview(mode) !== "ipa") return src.slice();
        return src.filter((q) => !q?.csharpOnly);
    }

    function usesCsharpDisplay(q, mode) {
        return q?.csharpOnly === true || parseCodeview(mode) === "csharp";
    }

    function displayLangOf(q, mode) {
        return usesCsharpDisplay(q, mode) ? "C#" : "擬似言語";
    }

    function csharpSource(q) {
        const code = String(q?.code ?? "").trim();
        if (code) return String(q.code);
        return String(q?.expr ?? "");
    }

    return {
        parseCodeview,
        stripPseudoComments,
        filterForCodeview,
        usesCsharpDisplay,
        displayLangOf,
        csharpSource
    };
})();
