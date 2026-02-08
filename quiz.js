const TOTAL_TIME = 10 * 60;

// localStorage keys
const LS_KEY_BEGINNER = "fe_quiz_beginnerMode";
const LS_KEY_SETTINGS = "fe_quiz_settings_v1";
const LS_KEY_USER_PRESETS = "fe_quiz_user_presets_v1";

// ★セッション保存（生徒ロック時のみ）
const LS_KEY_SESSION = "fe_quiz_session_v1";
const SESSION_VERSION = 1;

// ★多重起動防止（生徒ロック時のみ）
const LS_KEY_RUNLOCK = "fe_quiz_runlock_v1";
const LOCK_TTL_MS = 6000;
const LOCK_HEARTBEAT_MS = 2000;

let allQuestions = [];
let questions = [];
let current = 0;
let score = 0;
let timeLeft = TOTAL_TIME;

let mode = "idle"; // "idle" | "main" | "review"
let timerHandle = null;
let lockHeartbeatHandle = null;

let reviewChecked = false;
let mainChecked = false; // ★メイン出題の採点済みフラグ
let pendingMainLog = null; // ★メイン出題の採点結果を一時保持
let answersLog = [];

const quizEl = document.getElementById("quiz");
const progressEl = document.getElementById("progress");
const timerEl = document.getElementById("timer");
const topicsEl = document.getElementById("topics");
const difficultyEl = document.getElementById("difficulty");

const nextBtn = document.getElementById("nextBtn");
const beginnerToggleEl = document.getElementById("beginnerToggle");

const setupPanelEl = document.getElementById("setupPanel");
const startBtnEl = document.getElementById("startBtn");
const countSelectEl = document.getElementById("countSelect");

const langBoxEl = document.getElementById("langBox");
const genreBoxEl = document.getElementById("genreBox");
const langAllEl = document.getElementById("langAll");
const genreAllEl = document.getElementById("genreAll");

const diffChkEls = Array.from(document.querySelectorAll(".diffChk"));

const presetBarEl = document.getElementById("presetBar");
const userPresetButtonsEl = document.getElementById("userPresetButtons");

const presetNameInputEl = document.getElementById("presetNameInput");
const savePresetBtnEl = document.getElementById("savePresetBtn");
const deletePresetSelectEl = document.getElementById("deletePresetSelect");
const deletePresetBtnEl = document.getElementById("deletePresetBtn");
const presetMsgEl = document.getElementById("presetMsg");

// Export/Import UI
const exportPresetsBtnEl = document.getElementById("exportPresetsBtn");
const copyExportBtnEl = document.getElementById("copyExportBtn");
const exportAreaEl = document.getElementById("exportArea");
const importPresetsBtnEl = document.getElementById("importPresetsBtn");
const importAreaEl = document.getElementById("importArea");

// ロックモードUI
const lockBadgeEl = document.getElementById("lockBadge");
const lockNoteEl = document.getElementById("lockNote");
const presetManageSectionEl = document.getElementById("presetManageSection");
const presetIOSectionEl = document.getElementById("presetIOSection");

// ロック判定：URLに ?student=1 が付いていたらON
const params = new URLSearchParams(location.search);
const isStudentLock = params.get("student") === "1";

// ★強制プリセット（ロック時のみ有効）
const forcedPresetKey = isStudentLock ? (params.get("preset") || "beginner") : null;

// ★自動開始（ロック時のみ有効）
const isAutoStart = isStudentLock && params.get("autostart") === "1";

// ★必ず最初から（ロック時のみ）
const isFreshStart = isStudentLock && params.get("fresh") === "1";

// キャッシュ対策：questions.json?qver= を付ける
const qver = params.get("qver") || new Date().toISOString().slice(0, 10).replaceAll("-", "");
const questionsUrl = `questions.json?qver=${encodeURIComponent(qver)}`;

let selectedFilter = {
    langs: ["all"],
    genres: ["all"],
    count: "all",
    difficulties: [1, 2, 3]
};

let lastPickedSet = [];

// --- 初心者モード（localStorage） ---
let beginnerMode = loadBeginnerMode();
beginnerToggleEl.checked = beginnerMode;

beginnerToggleEl.addEventListener("change", () => {
    beginnerMode = beginnerToggleEl.checked;
    saveBeginnerMode(beginnerMode);

    // ロックでも「初心者モード」は生徒が切替OK
    saveSettingsFromUI();

    if (mode !== "idle" && current < questions.length && !(mode === "review" && reviewChecked)) {
        showQuestion();
    }
});

nextBtn.onclick = onNextButton;
startBtnEl.onclick = onStart;

// タブID（多重起動防止）
const TAB_ID = (() => {
    try {
        const k = "fe_quiz_tabid_v1";
        let v = sessionStorage.getItem(k);
        if (!v) {
            v = `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
            sessionStorage.setItem(k, v);
        }
        return v;
    } catch {
        return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
    }
})();

window.addEventListener("beforeunload", () => {
    clearRunLockIfOwned();
});

fetch(questionsUrl)
    .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
        return r.json();
    })
    .then(data => {
        if (!Array.isArray(data)) {
            throw new Error("questions.json の形式が不正です（配列になっていません）。");
        }
        if (data.length === 0) {
            throw new Error("questions.json が空です（問題が0件）。");
        }

        allQuestions = data;

        // ★ここで件数を表示（授業中の切り分けが一瞬で済む）
        setLoadedCountBadge(allQuestions.length);

        initSetupOptions(allQuestions);

        initPresetButtons();
        refreshUserPresetsUI();

        initPresetIO();

        applyStudentLockUI();

        // ★追加：固定プリセットボタンの表示を日本語化
        localizeFixedPresetButtons();

        if (isStudentLock) {
            applyForcedPresetOrFallback();

            // ★fresh=1 なら既存セッションを破棄して復元もしない
            if (isFreshStart) {
                clearRunLockIfOwned();
                clearSession();
                if (isAutoStart) {
                    setTimeout(() => onStart(), 0);
                    return;
                } else {
                    setIdleScreen();
                    return;
                }
            }

            // ★復元候補があれば「続き/最初から」選択（autostartより優先）
            const candidate = getResumeCandidate();
            if (candidate) {
                showResumeChoice(candidate);
                return;
            }

            // ★候補なしなら通常フロー
            if (isAutoStart) {
                setTimeout(() => onStart(), 0);
            }
        } else {
            restoreSettingsToUI();
        }

        setIdleScreen();
    })
    .catch(err => {
        console.error(err);

        // ★見た目に分かりやすい停止画面を出す
        stopTimer();
        nextBtn.style.display = "none";
        setupPanelEl.style.display = "none";

        progressEl.textContent = "読み込み失敗";
        timerEl.textContent = "-";
        topicsEl.textContent = "カテゴリ：-";
        difficultyEl.textContent = "難易度：-";

        quizEl.innerHTML = `
      <div class="result-item">
        <div class="small">
          <b>問題データの読み込みに失敗しました。</b><br><br>

          <div>想定ファイル：<span class="k">${escapeHtml(questionsUrl)}</span></div>
          <div style="margin-top:8px;">よくある原因：</div>
          <ul class="small" style="margin-top:6px;">
            <li>ファイル名が違う（例：question.json / Questions.json など）</li>
            <li>配置場所が違う（index.html と同じフォルダにない）</li>
            <li>JSONが壊れている（カンマ抜け等）</li>
            <li>JSONが配列になっていない（{ } で始まっている）</li>
          </ul>

          <div class="small" style="margin-top:8px;">
            ブラウザで直接 <span class="k">/questions.json</span> を開いて表示されるか確認すると早いです。
          </div>

          <div class="small" style="margin-top:10px; color:#ff5a70;">
            詳細：${escapeHtml(String(err.message || err))}
          </div>
        </div>

        <button class="toggleBtn" id="reloadBtn">再読み込み</button>
      </div>
    `;

        document.getElementById("reloadBtn")?.addEventListener("click", () => location.reload());
    });
// ----------------------------
// ロックUI適用
// ----------------------------
function applyStudentLockUI() {
    if (!isStudentLock) return;

    if (lockBadgeEl) lockBadgeEl.style.display = "inline-block";
    if (lockNoteEl) lockNoteEl.style.display = "block";

    // 保存/削除/IO を隠す
    if (presetManageSectionEl) presetManageSectionEl.style.display = "none";
    if (presetIOSectionEl) presetIOSectionEl.style.display = "none";

    // 手動変更はロック
    disableManualControls(true);

    // ロック時はプリセット選択も禁止（強制適用のみ）
    disablePresetButtons(true);
}

function disableManualControls(disabled) {
    countSelectEl.disabled = disabled;

    langAllEl.disabled = disabled;
    genreAllEl.disabled = disabled;

    diffChkEls.forEach(x => x.disabled = disabled);

    Array.from(langBoxEl.querySelectorAll(".langChk")).forEach(x => x.disabled = disabled);
    Array.from(genreBoxEl.querySelectorAll(".genreChk")).forEach(x => x.disabled = disabled);
}

function disablePresetButtons(disabled) {
    if (!presetBarEl) return;

    Array.from(presetBarEl.querySelectorAll("button[data-preset]")).forEach(btn => {
        btn.disabled = disabled;
        btn.style.opacity = disabled ? "0.55" : "1";
        btn.style.cursor = disabled ? "not-allowed" : "pointer";
    });

    Array.from(presetBarEl.querySelectorAll("#userPresetButtons button")).forEach(btn => {
        btn.disabled = disabled;
        btn.style.opacity = disabled ? "0.55" : "1";
        btn.style.cursor = disabled ? "not-allowed" : "pointer";
    });
}

// ----------------------------
// 強制プリセット
// ----------------------------
function applyForcedPresetOrFallback() {
    const fixed = getFixedPresets();
    if (fixed[forcedPresetKey]) {
        applySettingsToUI(fixed[forcedPresetKey]);
        flashMsg(`生徒用：プリセット「${forcedPresetKey}」を適用しました。`);
        return;
    }

    const user = loadUserPresets();
    if (user[forcedPresetKey]) {
        applySettingsToUI(user[forcedPresetKey]);
        flashMsg(`生徒用：保存プリセット「${forcedPresetKey}」を適用しました。`);
        return;
    }

    applySettingsToUI(getFixedPresets().beginner);
    flashMsg(`生徒用：指定プリセットが見つからないため beginner を適用しました。`, true);
}

// ----------------------------
// 初期：チェックボックスを動的生成
// ----------------------------
function initSetupOptions(list) {
    const langs = uniq(list.map(q => q.lang).filter(Boolean));
    const genres = uniq(list.map(q => q.genre).filter(Boolean));

    langAllEl.addEventListener("change", () => {
        if (isStudentLock) return;
        setGroupAllChecked(langBoxEl, "langChk");
        saveSettingsFromUI();
    });
    genreAllEl.addEventListener("change", () => {
        if (isStudentLock) return;
        setGroupAllChecked(genreBoxEl, "genreChk");
        saveSettingsFromUI();
    });

    for (const x of langs) appendCheck(langBoxEl, "langChk", x, x);
    for (const x of genres) appendCheck(genreBoxEl, "genreChk", x, x);

    wireAllLogic(langBoxEl, "langChk", langAllEl);
    wireAllLogic(genreBoxEl, "genreChk", genreAllEl);

    countSelectEl.addEventListener("change", () => { if (!isStudentLock) saveSettingsFromUI(); });
    diffChkEls.forEach(x => x.addEventListener("change", () => { if (!isStudentLock) saveSettingsFromUI(); }));

    savePresetBtnEl.addEventListener("click", () => { if (!isStudentLock) onSavePreset(); });
    deletePresetBtnEl.addEventListener("click", () => { if (!isStudentLock) onDeletePreset(); });
}

function initPresetIO() {
    if (exportPresetsBtnEl) exportPresetsBtnEl.addEventListener("click", () => { if (!isStudentLock) onExportPresets(); });
    if (copyExportBtnEl) copyExportBtnEl.addEventListener("click", () => { if (!isStudentLock) onCopyExport(); });
    if (importPresetsBtnEl) importPresetsBtnEl.addEventListener("click", () => { if (!isStudentLock) onImportPresets(); });
}

function appendCheck(container, className, value, labelText) {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" class="${className}" value="${escapeHtmlAttr(value)}"> ${escapeHtml(labelText)}`;
    container.appendChild(label);
}

function setGroupAllChecked(container, className) {
    const items = Array.from(container.querySelectorAll(`.${className}`));
    items.forEach(x => x.checked = false);
}

function wireAllLogic(container, className, allEl) {
    const items = Array.from(container.querySelectorAll(`.${className}`));
    items.forEach(chk => {
        chk.addEventListener("change", () => {
            if (isStudentLock) return;
            if (chk.checked) allEl.checked = false;

            const any = items.some(x => x.checked);
            if (!any) allEl.checked = true;

            saveSettingsFromUI();
        });
    });
}

function uniq(arr) { return Array.from(new Set(arr)); }

// ----------------------------
// 固定プリセット
// ----------------------------
function initPresetButtons() {
    const container = document.getElementById("presetButtons");
    if (!container) return;

    container.innerHTML = "";

    Object.keys(PRESETS).forEach(key => {
        const btn = document.createElement("button");
        btn.className = "presetBtn";

        // ★ここが変更点：日本語ラベル表示
        btn.textContent = PRESET_LABELS_JP[key] || key;

        btn.addEventListener("click", () => {
            applyPreset(key);
            highlightActivePreset(key);
        });

        container.appendChild(btn);
    });
}

function applyFixedPreset(key) {
    const presets = getFixedPresets();
    const p = presets[key];
    if (!p) return;
    applySettingsToUI(p);
    flashMsg(`固定プリセットを適用しました。`);
}

function getFixedPresets() {
    return {
        beginner: { count: "10", difficulties: [1], langs: ["csharp"], genres: ["conditions"], beginner: true },
        standard: { count: "10", difficulties: [1, 2], langs: ["csharp"], genres: ["conditions", "loops"], beginner: false },
        advanced: { count: "10", difficulties: [2, 3], langs: ["csharp"], genres: ["conditions", "loops", "arrays", "strings"], beginner: false },
        conditionsOnly: { count: "10", difficulties: [1, 2, 3], langs: ["csharp"], genres: ["conditions"], beginner: false },
        mixBasics: { count: "10", difficulties: [1], langs: ["csharp"], genres: ["conditions", "loops", "arrays", "strings"], beginner: true }
    };
}

// ----------------------------
// ユーザープリセット（先生用）
// ----------------------------
function onSavePreset() {
    const name = (presetNameInputEl.value || "").trim();
    if (!name) { flashMsg("プリセット名を入力してください。", true); return; }

    const s = readSettingsFromUI();
    const presets = loadUserPresets();
    presets[name] = s;
    saveUserPresets(presets);

    refreshUserPresetsUI();
    flashMsg(`保存しました：「${name}」`);
}

function onDeletePreset() {
    const name = deletePresetSelectEl.value;
    if (!name) { flashMsg("削除するプリセットを選択してください。", true); return; }

    const presets = loadUserPresets();
    if (!presets[name]) { flashMsg("既に存在しません。", true); refreshUserPresetsUI(); return; }

    delete presets[name];
    saveUserPresets(presets);

    refreshUserPresetsUI();
    flashMsg(`削除しました：「${name}」`);
}

function refreshUserPresetsUI() {
    const presets = loadUserPresets();
    const names = Object.keys(presets).sort((a, b) => a.localeCompare(b, "ja"));

    if (names.length === 0) {
        userPresetButtonsEl.innerHTML = "（まだありません）";
    } else {
        userPresetButtonsEl.innerHTML = "";
        names.forEach(name => {
            const btn = document.createElement("button");
            btn.className = "presetBtn";
            btn.textContent = name;
            btn.addEventListener("click", () => {
                if (isStudentLock) return;
                applySettingsToUI(presets[name]);
                flashMsg(`保存プリセットを適用しました：「${name}」`);
            });
            userPresetButtonsEl.appendChild(btn);
        });
    }

    deletePresetSelectEl.innerHTML = `<option value="">削除するプリセットを選択</option>`;
    names.forEach(name => {
        const opt = document.createElement("option");
        opt.value = name;
        opt.textContent = name;
        deletePresetSelectEl.appendChild(opt);
    });

    if (isStudentLock) disablePresetButtons(true);
}

// ===============================
// プリセット表示名（内部キーは英語のまま）
// ===============================
const PRESET_LABELS_JP = {
    beginner: "初級",
    standard: "標準",
    advanced: "応用",
    conditionsOnly: "条件式のみ",
    mixBasics: "基礎ミックス"
};

// ===============================
// ジャンル表示名（内部キー → 日本語）
// ===============================
const GENRE_LABELS_JP = {
    conditions: "条件式",
    loops: "繰り返し",
    arrays: "配列",
    strings: "文字列"
};

function updateHeaderInfo(q) {
    progressEl.textContent = `問題 ${current + 1}/${questions.length}`;
    timerEl.textContent = `残り時間 ${format(timeLeft)}`;

    const lang = q.lang || "";
    const genre = toGenreLabel(q.genre || "");
    const topics = Array.isArray(q.topics) ? q.topics.join(" / ") : "";

    topicsEl.textContent = `カテゴリ：${lang} / ${genre}${topics ? " / " + topics : ""}`;
    difficultyEl.textContent = `難易度：${"★".repeat(q.difficulty || 1)}`;
}

function toGenreLabel(genre) {
    return GENRE_LABELS_JP[genre] || genre;
}

function loadUserPresets() {
    try {
        const raw = localStorage.getItem(LS_KEY_USER_PRESETS);
        if (!raw) return {};
        const obj = JSON.parse(raw);
        return (obj && typeof obj === "object") ? obj : {};
    } catch { return {}; }
}

function localizeFixedPresetButtons() {
    // 固定プリセットのボタンが置かれているコンテナ（idが違っても拾う）
    const bar =
        document.getElementById("presetBar") ||
        document.getElementById("presetButtons");

    if (!bar) return;

    // ここでは「固定プリセットのボタン」だけを対象にする
    const buttons = Array.from(bar.querySelectorAll("button"));

    buttons.forEach(btn => {
        const key = (btn.textContent || "").trim();
        if (PRESET_LABELS_JP[key]) {
            btn.textContent = PRESET_LABELS_JP[key];
        }
    });
}

function saveUserPresets(obj) {
    try { localStorage.setItem(LS_KEY_USER_PRESETS, JSON.stringify(obj)); } catch { }
}

// ----------------------------
// Export / Import（先生用）
// ----------------------------
function onExportPresets() {
    const presets = loadUserPresets();
    exportAreaEl.value = JSON.stringify(presets, null, 2);
    flashMsg("エクスポートしました。");
}

async function onCopyExport() {
    const text = exportAreaEl.value || "";
    if (!text.trim()) { flashMsg("先に「保存プリセットを出力」を押してください。", true); return; }
    try {
        await navigator.clipboard.writeText(text);
        flashMsg("コピーしました。");
    } catch {
        exportAreaEl.focus();
        exportAreaEl.select();
        flashMsg("選択しました（手動でコピーしてください）。");
    }
}

function onImportPresets() {
    const raw = (importAreaEl.value || "").trim();
    if (!raw) { flashMsg("インポート欄にJSONを貼り付けてください。", true); return; }

    let obj;
    try { obj = JSON.parse(raw); }
    catch { flashMsg("JSONの形式が正しくありません。", true); return; }

    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
        flashMsg("形式は { \"名前\": {設定}, ... } の形にしてください。", true);
        return;
    }

    const current = loadUserPresets();
    let count = 0;

    for (const [name, preset] of Object.entries(obj)) {
        if (!name || typeof name !== "string") continue;
        if (!preset || typeof preset !== "object") continue;
        current[name] = normalizePreset(preset);
        count++;
    }

    saveUserPresets(current);
    refreshUserPresetsUI();
    flashMsg(`インポートしました：${count}件`);
}

function normalizePreset(p) {
    const out = {};
    out.count = (typeof p.count === "string") ? p.count : "10";
    out.beginner = !!p.beginner;

    if (Array.isArray(p.difficulties) && p.difficulties.length) {
        out.difficulties = p.difficulties.map(Number).filter(x => [1, 2, 3].includes(x));
        if (out.difficulties.length === 0) out.difficulties = [1, 2, 3];
    } else {
        out.difficulties = [1, 2, 3];
    }

    out.langs = (Array.isArray(p.langs) && p.langs.length) ? p.langs.map(String) : ["all"];
    out.genres = (Array.isArray(p.genres) && p.genres.length) ? p.genres.map(String) : ["all"];
    return out;
}

function flashMsg(text, isError = false) {
    if (!presetMsgEl) return;
    presetMsgEl.textContent = text;
    presetMsgEl.style.color = isError ? "#ff5a70" : "#21c77a";
    setTimeout(() => {
        if (presetMsgEl.textContent === text) presetMsgEl.textContent = "";
    }, 2500);
}

// ----------------------------
// UI <-> settings 変換
// ----------------------------
function readSettingsFromUI() {
    const diffs = diffChkEls
        .filter(x => x.checked)
        .map(x => Number(x.value))
        .filter(x => !Number.isNaN(x));

    const langs = collectSelected(langAllEl, langBoxEl, "langChk");
    const genres = collectSelected(genreAllEl, genreBoxEl, "genreChk");

    return {
        langs,
        genres,
        count: countSelectEl.value,
        difficulties: diffs.length ? diffs : [1, 2, 3],
        beginner: beginnerToggleEl.checked
    };
}

function applySettingsToUI(s) {
    if (typeof s.count === "string") countSelectEl.value = s.count;

    if (typeof s.beginner === "boolean") {
        beginnerToggleEl.checked = s.beginner;
        beginnerMode = s.beginner;
        saveBeginnerMode(beginnerMode);
    }

    if (Array.isArray(s.difficulties)) {
        const dset = new Set(s.difficulties.map(Number));
        diffChkEls.forEach(chk => chk.checked = dset.has(Number(chk.value)));
        if (!diffChkEls.some(x => x.checked)) diffChkEls.forEach(x => x.checked = true);
    }

    applyGroupValues(langAllEl, langBoxEl, "langChk", s.langs ?? ["all"]);
    applyGroupValues(genreAllEl, genreBoxEl, "genreChk", s.genres ?? ["all"]);

    saveSettingsFromUI();
}

function applyGroupValues(allEl, container, className, values) {
    const items = Array.from(container.querySelectorAll(`.${className}`));
    allEl.checked = false;
    items.forEach(x => x.checked = false);

    if (!Array.isArray(values) || values.length === 0 || (values.length === 1 && values[0] === "all")) {
        allEl.checked = true;
        return;
    }

    const set = new Set(values.map(String));
    let any = false;
    items.forEach(chk => {
        if (set.has(String(chk.value))) {
            chk.checked = true;
            any = true;
        }
    });

    if (!any) allEl.checked = true;
}

// ----------------------------
// 開始
// ----------------------------
function onStart() {
    const diffs = diffChkEls
        .filter(x => x.checked)
        .map(x => Number(x.value))
        .filter(x => !Number.isNaN(x));

    if (diffs.length === 0) { alert("難易度を1つ以上選択してください。"); return; }

    const langs = collectSelected(langAllEl, langBoxEl, "langChk");
    const genres = collectSelected(genreAllEl, genreBoxEl, "genreChk");

    selectedFilter = { langs, genres, count: countSelectEl.value, difficulties: diffs };
    saveSettings(selectedFilter);

    const picked = applyFilter(allQuestions, selectedFilter);
    if (picked.length === 0) { alert("条件に一致する問題がありません。"); return; }

    lastPickedSet = picked.slice();
    startMainMode(lastPickedSet);
}

function collectSelected(allEl, container, className) {
    if (allEl.checked) return ["all"];
    const items = Array.from(container.querySelectorAll(`.${className}`));
    return items.filter(x => x.checked).map(x => x.value);
}

function applyFilter(list, filter) {
    let result = list.slice();

    if (!(filter.langs.length === 1 && filter.langs[0] === "all")) {
        const set = new Set(filter.langs);
        result = result.filter(q => set.has(q.lang));
    }

    if (!(filter.genres.length === 1 && filter.genres[0] === "all")) {
        const set = new Set(filter.genres);
        result = result.filter(q => set.has(q.genre));
    }

    result = result.filter(q => filter.difficulties.includes(Number(q.difficulty ?? 1)));
    result = shuffle(result);

    if (filter.count !== "all") {
        const n = Number(filter.count);
        if (!Number.isNaN(n)) result = result.slice(0, n);
    }

    return result;
}

function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ----------------------------
// モード開始
// ----------------------------
function startMainMode(pickedQuestions) {
    mode = "main";
    questions = pickedQuestions.slice();
    resetRunState(TOTAL_TIME);

    setupPanelEl.style.display = "none";

    showQuestion();
    startTimer();

    nextBtn.style.display = "inline-block";
    nextBtn.textContent = "採点する"; // ★1問ずつ正誤確認

    snapshotSession(false);
}

function startReviewMode(wrongQuestions) {
    mode = "review";
    questions = wrongQuestions.slice();

    const suggested = Math.max(120, Math.min(TOTAL_TIME, questions.length * 60));
    resetRunState(suggested);

    beginnerToggleEl.checked = true;
    beginnerMode = true;

    showQuestion();
    startTimer();

    nextBtn.style.display = "inline-block";
    nextBtn.textContent = "採点する";

    snapshotSession(false);
}

function resetRunState(newTime) {
    stopTimer();
    current = 0;
    score = 0;
    timeLeft = newTime;
    answersLog = [];
    reviewChecked = false;
    mainChecked = false;
    pendingMainLog = null;
}

// ----------------------------
// 出題表示
// ----------------------------
function showQuestion() {
    const q = questions[current];

    // ★メインは「採点する」→フィードバック→「次へ」の2段階
    if (mode === "main") {
        mainChecked = false;
        pendingMainLog = null;
        nextBtn.textContent = "採点する";
    }


    const prefix = (mode === "review") ? "復習" : "問題";
    progressEl.textContent = `${prefix} ${current + 1} / ${questions.length}`;

    const tags = [];
    if (q.lang) tags.push(q.lang);
    if (q.genre) tags.push(q.genre);
    if (Array.isArray(q.topics)) tags.push(...q.topics);
    topicsEl.textContent = `カテゴリ：${tags.join(" / ")}`;

    difficultyEl.textContent = `難易度：${"★".repeat(q.difficulty ?? 1)}`;

    const exprBlock = q.expr ? `<pre class="code"><code>${escapeHtml(q.expr)}</code></pre>` : "";
    const jpBlock = (beginnerMode && q.jp) ? `<div class="jp"><b>日本語化：</b>${escapeHtml(q.jp)}</div>` : "";

    let html = `<h3>${escapeHtml(q.question)}</h3>`;
    html += exprBlock;
    html += jpBlock;

    q.choices.forEach((c, i) => {
        html += `
      <div class="choice">
        <label>
          <input type="radio" name="choice" value="${i}">
          ${escapeHtml(c)}
        </label>
      </div>`;
    });

    if (mode === "main") {
        const explainId = `explain-main-${q.id}`;
        html += `
      <button class="toggleBtn" data-target="${explainId}">▶ 解説を見る（正解でも確認）</button>
      <div id="${explainId}" style="display:none;">
        ${buildExplanationHtml(q, true)}
      </div>
      <div class="small">※採点は下の「採点する」で行います。解説は読み取り確認用です</div>
    `;
    }

    quizEl.innerHTML = html;
    wireToggleButtons();
}

function buildExplanationHtml(q, forceShow) {
    const jpBlock = q.jp ? `<div class="jp"><b>日本語化：</b>${escapeHtml(q.jp)}</div>` : "";

    const pseudoText = autoPseudo(q);
    const pseudoBlock = pseudoText ? `<div class="small"><b>擬似言語：</b>${escapeHtml(pseudoText)}</div>` : "";

    const isHard = (q.difficulty ?? 1) >= 3;
    const pseudocodeText = autoPseudocode(q);

    const pseudoCodeId = `pseudocode-any-${q.id}-${Math.random().toString(16).slice(2)}`;
    const pseudoCodeBlock = (pseudocodeText && (isHard || forceShow))
        ? `
      <button class="toggleBtn" data-target="${pseudoCodeId}">▶ 疑似コード（試験形式）を表示</button>
      <pre class="code" id="${pseudoCodeId}" style="display:none;"><code>${escapeHtml(pseudocodeText)}</code></pre>
    `
        : "";

    return `${jpBlock}${pseudoBlock}${pseudoCodeBlock}`;
}

// ----------------------------
// Nextボタン
// ----------------------------
function onNextButton() {
    if (mode === "review") {
        if (!reviewChecked) checkCurrentReviewQuestion();
        else goNextReviewQuestion();
        return;
    }

    // ★メイン：1問ずつ採点してから進む
    if (mode === "main") {
        if (!mainChecked) checkCurrentMainQuestion();
        else goNextMainQuestion();
        return;
    }
}

function checkCurrentMainQuestion() {
    const sel = document.querySelector('input[name="choice"]:checked');
    if (!sel) { alert("選択してください"); return; }

    const q = questions[current];
    const chosen = Number(sel.value);
    const correctIndex = q.answer;
    const correct = chosen === correctIndex;

    if (correct) score++;
    const log = { id: q.id, chosen, correct, correctIndex, questionObj: q };
    answersLog.push(log);
    pendingMainLog = log;

    showMainFeedback(log);

    mainChecked = true;
    nextBtn.textContent = "次へ";

    snapshotSession(false);
}

function goNextMainQuestion() {
    current++;
    mainChecked = false;
    pendingMainLog = null;

    snapshotSession(false);

    if (current < questions.length) {
        showQuestion();
        nextBtn.textContent = "採点する";
    } else {
        finishMain("全問回答");
    }
}

const q = questions[current];
const chosen = Number(sel.value);
const correctIndex = q.answer;
const correct = chosen === correctIndex;

if (correct) score++;
answersLog.push({ id: q.id, chosen, correct, correctIndex, questionObj: q });

current++;

snapshotSession(false);

if (current < questions.length) showQuestion();
else finishMain("全問回答");
}

// ----------------------------
// 復習モード：採点→解説
// ----------------------------
function checkCurrentReviewQuestion() {
    const sel = document.querySelector('input[name="choice"]:checked');
    if (!sel) { alert("選択してください"); return; }

    const q = questions[current];
    const chosen = Number(sel.value);
    const correctIndex = q.answer;
    const correct = chosen === correctIndex;

    if (correct) score++;
    const log = { id: q.id, chosen, correct, correctIndex, questionObj: q };
    answersLog.push(log);

    showReviewFeedback(log);

    reviewChecked = true;
    nextBtn.textContent = "次へ";

    snapshotSession(false);
}

function goNextReviewQuestion() {
    current++;
    reviewChecked = false;

    if (current < questions.length) {
        showQuestion();
        nextBtn.textContent = "採点する";
        snapshotSession(false);
    } else {
        finishReview("復習完了");
    }
}

function showReviewFeedback(log) {
    const q = log.questionObj;

    const okNgText = log.correct ? "正解" : "不正解";
    const okNgClass = log.correct ? "ok" : "ng";

    const chosenText = q.choices?.[log.chosen] ?? "(不明)";
    const correctText = q.choices?.[log.correctIndex] ?? "(不明)";

    const exprBlock = q.expr ? `<pre class="code"><code>${escapeHtml(q.expr)}</code></pre>` : "";
    const jpBlock = q.jp ? `<div class="jp"><b>日本語化：</b>${escapeHtml(q.jp)}</div>` : "";

    const hintBlock = (!log.correct && q.hint) ? `<div class="small"><b>ヒント：</b>${escapeHtml(q.hint)}</div>` : "";

    const pseudoText = autoPseudo(q);
    const pseudoBlock = (!log.correct && pseudoText) ? `<div class="small"><b>擬似言語：</b>${escapeHtml(pseudoText)}</div>` : "";

    const isHard = (q.difficulty ?? 1) >= 3;
    const pseudocodeText = autoPseudocode(q);
    const shouldShowPseudoCode = (!log.correct) && isHard && pseudocodeText;

    const pseudoCodeId = `pseudocode-review-${q.id}`;
    const pseudoCodeBlock = shouldShowPseudoCode
        ? `
      <button class="toggleBtn" data-target="${pseudoCodeId}">▶ 疑似コード（試験形式）を表示</button>
      <pre class="code" id="${pseudoCodeId}" style="display:none;"><code>${escapeHtml(pseudocodeText)}</code></pre>
    `
        : "";

    quizEl.innerHTML = `
    <div class="result-item">
      <div class="result-badges">
        <span class="tag ${okNgClass}">${okNgText}</span>
        <span class="tag">#${escapeHtml(q.id)}</span>
        <span class="tag">${escapeHtml(q.lang ?? "-")}</span>
        <span class="tag">${escapeHtml(q.genre ?? "-")}</span>
        ${q.skill ? `<span class="tag">${escapeHtml(q.skill)}</span>` : ""}
        <span class="tag">${escapeHtml("★".repeat(q.difficulty ?? 1))}</span>
      </div>

      <div class="small"><b>問題：</b>${escapeHtml(q.question)}</div>
      ${exprBlock}
      ${jpBlock}

      <div class="small"><b>あなたの選択：</b>${escapeHtml(chosenText)}</div>
      <div class="small"><b>正解：</b>${escapeHtml(correctText)}</div>

      ${hintBlock}
      ${pseudoBlock}
      ${pseudoCodeBlock}

      <div class="small">※復習モードは「採点する」→解説確認→「次へ」</div>
    </div>
  `;

    wireToggleButtons();
}

// ----------------------------
// メインモード：採点結果表示（1問ずつ）
// ----------------------------
function showMainFeedback(log) {
    const q = log.questionObj;

    const okNgText = log.correct ? "正解" : "不正解";
    const okNgClass = log.correct ? "ok" : "ng";

    const chosenText = q.choices?.[log.chosen] ?? "(不明)";
    const correctText = q.choices?.[log.correctIndex] ?? "(不明)";

    const exprBlock = q.expr ? `<pre class="code"><code>${escapeHtml(q.expr)}</code></pre>` : "";
    const jpBlock = (beginnerMode && q.jp) ? `<div class="jp"><b>日本語化：</b>${escapeHtml(q.jp)}</div>` : "";

    const hintBlock = (!log.correct && q.hint) ? `<div class="small"><b>ヒント：</b>${escapeHtml(q.hint)}</div>` : "";

    // 解説（読み取り確認）
    const explainId = `explain-main-${q.id}`;
    const explainBtn = `
      <button class="toggleBtn" data-target="${explainId}">▶ 解説を見る（読み取り確認）</button>
      <div id="${explainId}" style="display:none;">
        ${buildExplanationHtml(q, true)}
      </div>
    `;

    quizEl.innerHTML = `
    <div class="result-item">
      <div class="result-badges">
        <span class="tag ${okNgClass}">${okNgText}</span>
        <span class="tag">#${escapeHtml(q.id)}</span>
        <span class="tag">${escapeHtml(q.lang ?? "-")}</span>
        <span class="tag">${escapeHtml(q.genre ?? "-")}</span>
        ${q.skill ? `<span class="tag">${escapeHtml(q.skill)}</span>` : ""}
        <span class="tag">${escapeHtml("★".repeat(q.difficulty ?? 1))}</span>
      </div>

      <div class="small"><b>問題：</b>${escapeHtml(q.question)}</div>
      ${exprBlock}
      ${jpBlock}

      <div class="small"><b>あなたの選択：</b>${escapeHtml(chosenText)}</div>
      <div class="small"><b>正解：</b>${escapeHtml(correctText)}</div>

      ${hintBlock}
      ${explainBtn}

      <div class="small">※「次へ」で次の問題に進みます</div>
    </div>
  `;

    wireToggleButtons();
}


// ----------------------------
// タイマー（多重タブ防止統合）
// ----------------------------
function startTimer() {
    // ★ロック獲得できないなら開始させない
    if (isStudentLock) {
        const ok = tryAcquireRunLock();
        if (!ok) {
            stopBecauseTakenOver();
            return;
        }
    }

    // ownerとして心拍開始
    if (isStudentLock) {
        if (lockHeartbeatHandle) clearInterval(lockHeartbeatHandle);
        lockHeartbeatHandle = setInterval(() => {
            if (!amOwner()) {
                clearInterval(lockHeartbeatHandle);
                lockHeartbeatHandle = null;
                stopBecauseTakenOver();
                return;
            }
            heartbeatRunLock();
        }, LOCK_HEARTBEAT_MS);
    }

    timerEl.textContent = format(timeLeft);
    timerHandle = setInterval(() => {
        // ★ownerでなくなったら停止
        if (isStudentLock && !amOwner()) {
            stopTimer();
            stopBecauseTakenOver();
            return;
        }

        timeLeft--;
        timerEl.textContent = format(timeLeft);

        // ★3秒ごとに保存
        if (isStudentLock && (timeLeft % 3 === 0)) {
            snapshotSession(false);
        }

        if (timeLeft <= 0) {
            stopTimer();
            if (mode === "review") finishReview("時間切れ");
            else finishMain("時間切れ");
        }
    }, 1000);
}

function stopTimer() {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
    if (lockHeartbeatHandle) { clearInterval(lockHeartbeatHandle); lockHeartbeatHandle = null; }

    // ★止めた時点でownerなら解放
    clearRunLockIfOwned();
}

// ----------------------------
// 結果表示
// ----------------------------
function finishMain(reason) {
    snapshotSession(true);
    stopTimer();
    showResultSummary("終了", reason, true);
}

function finishReview(reason) {
    snapshotSession(true);
    stopTimer();
    showResultSummary("復習終了", reason, false);
}

function showResultSummary(title, reason, canOfferReview) {
    topicsEl.textContent = "カテゴリ：-";
    difficultyEl.textContent = "難易度：-";

    const wrongLogs = answersLog.filter(x => !x.correct);

    let html = `
    <h2>${escapeHtml(title)}（${escapeHtml(reason)}）</h2>
    <p>正解数：${score} / ${questions.length}</p>
  `;

    if (canOfferReview) {
        if (wrongLogs.length > 0) {
            html += `
        <div class="result-item">
          <div class="small">
            <b>復習：</b>不正解は ${wrongLogs.length} 問あります。<br>
            「不正解だけ再挑戦」で、今回の出題セットから不正解だけ再挑戦します。
          </div>
          <button class="toggleBtn" id="retryBtn">不正解だけ再挑戦</button>
          <button class="toggleBtn" id="backBtn">出題設定に戻る</button>
        </div>
      `;
        } else {
            html += `
        <div class="result-item">
          <div class="small"><b>全問正解</b>です。</div>
          <button class="toggleBtn" id="backBtn">出題設定に戻る</button>
        </div>
      `;
        }
    } else {
        html += `
      <div class="result-item">
        <button class="toggleBtn" id="backBtn">出題設定に戻る</button>
      </div>
    `;
    }

    if (isStudentLock) {
        html += `
      <div class="result-item">
        <button class="toggleBtn" id="restartBtn">最初からやり直す</button>
      </div>
    `;
    }

    quizEl.innerHTML = html;
    nextBtn.style.display = "none";

    const retryBtn = document.getElementById("retryBtn");
    if (retryBtn) {
        retryBtn.addEventListener("click", () => {
            const wrongIds = new Set(wrongLogs.map(x => x.id));
            const wrongQuestions = questions.filter(q => wrongIds.has(q.id));
            startReviewMode(wrongQuestions);
        });
    }

    const backBtn = document.getElementById("backBtn");
    if (backBtn) backBtn.addEventListener("click", () => setIdleScreen());

    const restartBtn = document.getElementById("restartBtn");
    if (restartBtn) {
        restartBtn.addEventListener("click", () => {
            clearRunLockIfOwned();
            clearSession();
            location.reload();
        });
    }
}

// ----------------------------
// Idle
// ----------------------------
function setIdleScreen() {
    clearRunLockIfOwned();
    mode = "idle";
    stopTimer();

    setupPanelEl.style.display = "block";
    nextBtn.style.display = "none";

    progressEl.textContent = "未開始";
    timerEl.textContent = "-";
    topicsEl.textContent = "カテゴリ：-";
    difficultyEl.textContent = "難易度：-";

    quizEl.innerHTML = `<div class="small">出題設定を選んで「開始」を押してください。</div>`;
}

// ----------------------------
// UI補助
// ----------------------------
function wireToggleButtons() {
    const btns = document.querySelectorAll(".toggleBtn[data-target]");
    btns.forEach(btn => {
        btn.addEventListener("click", () => {
            const targetId = btn.getAttribute("data-target");
            const el = document.getElementById(targetId);
            if (!el) return;

            const isHidden = el.style.display === "none";
            el.style.display = isHidden ? "block" : "none";
            btn.textContent = isHidden ? "▼ 隠す" : "▶ 表示";
        });
    });
}

function setLoadedCountBadge(count) {
    // Idleの初期表示が「未開始」なので、そこを「読み込み：xx問」にしておく
    progressEl.textContent = `読み込み：${count}問`;
}

function format(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `残り時間 ${m}:${String(s).padStart(2, "0")}`;
}

function formatRaw(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
}

function escapeHtml(str) {
    return String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
function escapeHtmlAttr(str) { return String(str).replaceAll('"', "&quot;"); }

// ----------------------------
// 初心者モード 永続化
// ----------------------------
function loadBeginnerMode() {
    try {
        const v = localStorage.getItem(LS_KEY_BEGINNER);
        if (v === null) return false;
        return v === "1";
    } catch { return false; }
}
function saveBeginnerMode(isOn) {
    try { localStorage.setItem(LS_KEY_BEGINNER, isOn ? "1" : "0"); } catch { }
}

// =====================================================
// 出題設定 永続化
// =====================================================
function saveSettingsFromUI() {
    const s = readSettingsFromUI();
    saveSettings(s);
}
function saveSettings(settingsObj) {
    try { localStorage.setItem(LS_KEY_SETTINGS, JSON.stringify(settingsObj)); } catch { }
}
function loadSettings() {
    try {
        const raw = localStorage.getItem(LS_KEY_SETTINGS);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        return obj && typeof obj === "object" ? obj : null;
    } catch { return null; }
}
function restoreSettingsToUI() {
    const s = loadSettings();
    if (!s) return;
    applySettingsToUI(s);
}

// =====================================================
// セッション保存・復元（生徒ロック時のみ）
// =====================================================
function buildSessionKey() {
    return `${LS_KEY_SESSION}__${forcedPresetKey || "none"}`;
}

function loadSession() {
    if (!isStudentLock) return null;
    try {
        const raw = localStorage.getItem(buildSessionKey());
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") return null;
        if (obj.version !== SESSION_VERSION) return null;
        if (obj.presetKey !== forcedPresetKey) return null;
        return obj;
    } catch {
        return null;
    }
}

function saveSession(obj) {
    if (!isStudentLock) return;
    try {
        obj.version = SESSION_VERSION;
        obj.presetKey = forcedPresetKey;
        obj.savedAt = Date.now();
        localStorage.setItem(buildSessionKey(), JSON.stringify(obj));
    } catch { }
}

function clearSession() {
    if (!isStudentLock) return;
    try { localStorage.removeItem(buildSessionKey()); } catch { }
}

function mapQuestionsById(list) {
    const m = new Map();
    list.forEach(q => m.set(q.id, q));
    return m;
}

function clampInt(v, min, max) {
    const n = Number(v);
    if (Number.isNaN(n)) return min;
    return Math.min(max, Math.max(min, Math.floor(n)));
}

function snapshotSession(isFinished = false) {
    if (!isStudentLock) return;
    saveSession({
        isFinished,
        mode,
        pickedIds: questions.map(q => q.id),
        current,
        score,
        timeLeft,
        answersLog,
        reviewChecked
    });
}

function getResumeCandidate() {
    const sess = loadSession();
    if (!sess) return null;
    if (sess.isFinished) return null;
    if (!Array.isArray(sess.pickedIds) || sess.pickedIds.length === 0) return null;

    const byId = mapQuestionsById(allQuestions);
    const restored = [];
    for (const id of sess.pickedIds) {
        const q = byId.get(id);
        if (!q) return null;
        restored.push(q);
    }

    let restoredTime = Number(sess.timeLeft ?? TOTAL_TIME);
    const savedAt = Number(sess.savedAt ?? Date.now());
    const elapsed = Math.max(0, Math.floor((Date.now() - savedAt) / 1000));
    restoredTime = Math.max(0, restoredTime - elapsed);

    return {
        sess,
        questions: restored,
        timeLeft: restoredTime
    };
}

function resumeFromCandidate(candidate) {
    const sess = candidate.sess;

    mode = sess.mode === "review" ? "review" : "main";
    questions = candidate.questions;
    current = clampInt(sess.current ?? 0, 0, questions.length);
    score = clampInt(sess.score ?? 0, 0, questions.length);
    timeLeft = clampInt(candidate.timeLeft, 0, 24 * 60 * 60);
    answersLog = Array.isArray(sess.answersLog) ? sess.answersLog : [];
    reviewChecked = false;

    setupPanelEl.style.display = "none";
    nextBtn.style.display = "inline-block";
    nextBtn.textContent = (mode === "review") ? "採点する" : "次の問題";

    if (timeLeft <= 0) {
        stopTimer();
        if (mode === "review") finishReview("時間切れ");
        else finishMain("時間切れ");
        return;
    }

    showQuestion();
    startTimer();
    flashMsg("生徒用：前回の続きから再開しました。");
}

function showResumeChoice(candidate) {
    stopTimer();
    setupPanelEl.style.display = "none";
    nextBtn.style.display = "none";

    const total = candidate.questions.length;
    const idx = clampInt(candidate.sess.current ?? 0, 0, total);
    const remain = clampInt(candidate.timeLeft ?? TOTAL_TIME, 0, 24 * 60 * 60);

    quizEl.innerHTML = `
    <div class="result-item">
      <div class="small">
        <b>前回の途中データが見つかりました。</b><br>
        進捗：${idx} / ${total} 問<br>
        残り時間：${formatRaw(remain)}
      </div>

      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="toggleBtn" id="resumeBtn">続きから再開</button>
        <button class="toggleBtn" id="restartFromZeroBtn">最初から</button>
      </div>

      <div class="small" style="margin-top:10px;">
        ※複数タブを開いている場合は1つだけ残してください。
      </div>
    </div>
  `;

    document.getElementById("resumeBtn")?.addEventListener("click", () => {
        resumeFromCandidate(candidate);
    });

    document.getElementById("restartFromZeroBtn")?.addEventListener("click", () => {
        clearRunLockIfOwned();
        clearSession();
        if (isAutoStart) onStart();
        else setIdleScreen();
    });
}

// =====================================================
// 多重起動防止（生徒ロック時のみ）
// =====================================================
function buildRunLockKey() {
    return `${LS_KEY_RUNLOCK}__${forcedPresetKey || "none"}`;
}

function readRunLock() {
    try {
        const raw = localStorage.getItem(buildRunLockKey());
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || typeof obj !== "object") return null;
        return obj;
    } catch { return null; }
}

function writeRunLock(ownerTabId) {
    try {
        localStorage.setItem(buildRunLockKey(), JSON.stringify({
            owner: ownerTabId,
            at: Date.now()
        }));
    } catch { }
}

function isLockAlive(lock) {
    if (!lock) return false;
    const at = Number(lock.at);
    if (Number.isNaN(at)) return false;
    return (Date.now() - at) <= LOCK_TTL_MS;
}

function tryAcquireRunLock() {
    if (!isStudentLock) return true;

    const lock = readRunLock();
    if (!isLockAlive(lock)) {
        writeRunLock(TAB_ID);
        return true;
    }
    return lock.owner === TAB_ID;
}

function heartbeatRunLock() {
    if (!isStudentLock) return;
    const lock = readRunLock();
    if (lock && lock.owner === TAB_ID) {
        writeRunLock(TAB_ID);
    }
}

function amOwner() {
    if (!isStudentLock) return true;
    const lock = readRunLock();
    if (!isLockAlive(lock)) return false;
    return lock.owner === TAB_ID;
}

function clearRunLockIfOwned() {
    if (!isStudentLock) return;
    const lock = readRunLock();
    if (lock && lock.owner === TAB_ID) {
        try { localStorage.removeItem(buildRunLockKey()); } catch { }
    }
}

function stopBecauseTakenOver() {
    stopTimer();
    mode = "idle";
    nextBtn.style.display = "none";

    quizEl.innerHTML = `
    <div class="result-item">
      <div class="small">
        <b>別タブでこの問題集が開始されたため、このタブは停止しました。</b><br>
        続ける場合は、いま開いているタブを閉じて、1つのタブだけで実行してください。
      </div>
      <button class="toggleBtn" id="reloadBtn">このタブを更新</button>
    </div>
  `;
    const reloadBtn = document.getElementById("reloadBtn");
    if (reloadBtn) reloadBtn.addEventListener("click", () => location.reload());
}

// =====================================================
// 自動生成：pseudo / pseudocode（将来ジャンル対応）
// =====================================================
function autoPseudo(q) {
    if (typeof q.pseudo === "string" && q.pseudo.trim().length > 0) return q.pseudo;
    const g = String(q.genre ?? "conditions").toLowerCase();
    switch (g) {
        case "loops": return autoPseudoLoops(q);
        case "arrays": return autoPseudoArrays(q);
        case "strings": return autoPseudoStrings(q);
        default: return autoPseudoConditions(q);
    }
}
function autoPseudocode(q) {
    if (typeof q.pseudocode === "string" && q.pseudocode.trim().length > 0) return q.pseudocode;
    const g = String(q.genre ?? "conditions").toLowerCase();
    switch (g) {
        case "loops": return autoPseudocodeLoops(q);
        case "arrays": return autoPseudocodeArrays(q);
        case "strings": return autoPseudocodeStrings(q);
        default: return autoPseudocodeConditions(q);
    }
}

// conditions
function autoPseudoConditions(q) {
    const expr = (q.expr ?? "").trim();
    if (!expr) return "";
    return `もし ${toJapaneseCondition(expr)} なら 真`;
}
function autoPseudocodeConditions(q) {
    const expr = (q.expr ?? "").trim();
    if (!expr) return "";
    const cond = normalizeToPseudoCodeCond(expr);
    return `IF ${cond} THEN\n    (処理)\nENDIF`;
}
function toJapaneseCondition(expr) {
    let s = expr.replace(/\s+/g, " ").trim();
    s = s.replace(/&&/g, " かつ ");
    s = s.replace(/\|\|/g, " または ");
    s = s.replace(/!=/g, "と等しくない");
    s = s.replace(/==/g, "と等しい");
    s = s.replace(/>=/g, "以上");
    s = s.replace(/<=/g, "以下");
    s = s.replace(/>/g, "より大きい");
    s = s.replace(/</g, "より小さい");
    return s.replace(/\s+/g, " ").trim();
}
function normalizeToPseudoCodeCond(expr) {
    let s = expr.replace(/\s+/g, " ").trim();
    s = s.replace(/&&/g, "AND");
    s = s.replace(/\|\|/g, "OR");
    s = s.replace(/!\s*\(/g, "NOT (");
    return s;
}

// loops (将来用)
function autoPseudoLoops(q) {
    const expr = (q.expr ?? "").trim();
    if (!expr) return "";
    return `（繰り返し） ${expr}`;
}
function autoPseudocodeLoops(q) {
    const expr = (q.expr ?? "").trim();
    if (!expr) return "";
    return `(* LOOP *)\n${expr}`;
}

// arrays (将来用)
function autoPseudoArrays(q) {
    const expr = (q.expr ?? "").trim();
    if (!expr) return "";
    return `（配列） ${expr}`;
}
function autoPseudocodeArrays(q) {
    const expr = (q.expr ?? "").trim();
    if (!expr) return "";
    return `(* ARRAY *)\n${expr}`;
}

// strings (将来用)
function autoPseudoStrings(q) {
    const expr = (q.expr ?? "").trim();
    if (!expr) return "";
    return `（文字列） ${expr}`;
}
function autoPseudocodeStrings(q) {
    const expr = (q.expr ?? "").trim();
    if (!expr) return "";
    return `(* STRING *)\n${expr}`;
}