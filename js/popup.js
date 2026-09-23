const DEFAULTS = { language: "en", mode: "classic", sound: true, numbered: false, reducedMotion: false, highScore: 0, maxSequence: 0 };
const LANGUAGES = { en: "English", fa: "فارسی", ar: "العربية", es: "Español", fr: "Français", de: "Deutsch", tr: "Türkçe", sv: "Svenska", et: "Eesti", ja: "日本語", ko: "한국어", zh: "中文", it: "Italiano" };
const $ = (id) => document.getElementById(id);
const storage = typeof browser !== "undefined" ? browser.storage.local : chrome.storage.local;
class MemoryFlash {
    constructor() {
        this.settings = { ...DEFAULTS };
        this.messages = {};
        this.sequence = [];
        this.input = [];
        this.score = 0;
        this.level = 1;
        this.streak = 0;
        this.attempts = 0;
        this.correct = 0;
        this.lives = 3;
        this.accepting = false;
        this.timers = [];
        this.tiles = [];
        this.resumeAfterSettings = false;
        this.advanceAfterSettings = false;
        this.returnToGameOver = false;
        this.paused = false;
    }
    async init() {
        this.settings = { ...DEFAULTS, ...(await storage.get(DEFAULTS)) };
        this.bind();
        await this.loadLanguage(this.settings.language);
        this.renderGrid();
        this.updateUI();
        this.updateHint();
    }
    bind() {
        $("start-button").onclick = () => this.start();
        document.getElementById("play-again").onclick = () => this.start(); document.getElementById("pause-button").onclick = () => this.togglePause();
        $("settings-button").onclick = () => this.showSettings(true);
        $("close-settings").onclick = () => this.showSettings(false);
        const language = $("language");
        Object.entries(LANGUAGES).forEach(([code, name]) => language.add(new Option(name, code)));
        language.onchange = async () => { this.settings.language = language.value; await this.persist(); await this.loadLanguage(this.settings.language); };
        ["mode", "sound", "numbered", "reduced-motion"].forEach(id => $(id).onchange = () => this.changeSettings());
        window.addEventListener("pagehide", () => this.clearTimers());
        document.addEventListener("visibilitychange", () => {
            if (document.hidden)
                this.clearTimers();
        });
    }
    async changeSettings() {
        this.settings.mode = $("mode").value;
        this.settings.sound = $("sound").checked;
        this.settings.numbered = $("numbered").checked;
        this.settings.reducedMotion = $("reduced-motion").checked;
        await this.persist();
        this.renderGrid();
        this.updateUI();
        this.updateHint();
    }
    async persist() { await storage.set(this.settings); }
    async loadLanguage(lang) {
        this.messages = await fetch(`locales/${lang}.json`).then(r => r.json());
        document.documentElement.lang = lang;
        document.documentElement.dir = ["fa", "ar"].includes(lang) ? "rtl" : "ltr";
        document.querySelectorAll("[data-i18n]").forEach(el => el.textContent = this.t(el.dataset.i18n));
        $("subtitle").textContent = this.t("focus");
        $("settings-button").setAttribute("aria-label", this.t("settingsOpen"));
        $("close-settings").setAttribute("aria-label", this.t("settingsClose"));
        $("start-button").textContent = this.t("start");
        $("play-again").textContent = this.t("playAgain");
        this.updateUI();
        this.updateHint();
        this.updatePauseButton();
    }
    t(key, vars = {}) { return (this.messages[key] || key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? "")); }
    updateHint() {
        const messages = []; if (this.settings.mode === "lives")
            messages.push(this.t("livesLeft", { count: this.lives })); if (this.settings.numbered)
            messages.push(this.t("tutorial")); $("hint").textContent = messages.join(" · ");
    }
    renderGrid() {
        const size = this.level >= 6 ? 4 : 3;
        const grid = $("grid");
        grid.replaceChildren();
        grid.style.setProperty("--grid-size", String(size));
        this.tiles = [];
        for (let i = 0; i < size * size; i++) {
            const tile = document.createElement("button");
            tile.className = "tile";
            tile.type = "button";
            tile.role = "gridcell";
            tile.dataset.index = String(i);
            tile.tabIndex = i === 0 ? 0 : -1;
            tile.setAttribute("aria-label", this.t("tile", { number: i + 1 }));
            tile.textContent = this.settings.numbered ? String(i + 1) : "";
            tile.onclick = () => this.choose(i);
            tile.onkeydown = e => this.moveFocus(e, i, size);
            grid.append(tile);
            this.tiles.push(tile);
        }
    }
    moveFocus(e, i, size) {
        const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: size, ArrowUp: -size }; if (!(e.key in delta))
            return; e.preventDefault(); const next = i + delta[e.key]; if (next >= 0 && next < this.tiles.length) {
                this.tiles[i].tabIndex = -1;
                this.tiles[next].tabIndex = 0;
                this.tiles[next].focus();
            }
    }
    updatePauseButton() { const button = document.getElementById("pause-button"); button.textContent = this.paused ? this.t("resume") : this.t("pause"); button.classList.toggle("hidden", this.sequence.length === 0 && !this.paused); }
    togglePause() { if (this.paused) { this.paused = false; this.replayRound(); } else { this.paused = true; this.clearTimers(); this.accepting = false; document.getElementById("round-status").textContent = this.t("paused"); } this.updatePauseButton(); }
    start() { this.clearTimers(); this.sequence = []; this.input = []; this.score = 0; this.level = 1; this.streak = 0; this.attempts = 0; this.correct = 0; this.lives = 3; this.accepting = false; this.paused = false; document.getElementById("pause-button").classList.remove("hidden"); document.getElementById("start-button").classList.add("hidden"); $("game-over").classList.add("hidden"); $("game-view").classList.remove("hidden"); this.renderGrid(); this.nextRound(); }
    nextRound() { this.sequence.push(Math.floor(Math.random() * this.tiles.length)); this.replayRound(); }
    replayRound() { this.clearTimers(); this.input = []; this.accepting = false; $("round-status").textContent = this.t("watch"); this.updateHint(); this.updateUI(); const pause = this.settings.reducedMotion ? 700 : 450; this.sequence.forEach((tile, index) => this.schedule(() => this.flash(tile), 350 + index * (pause + 190))); this.schedule(() => { this.accepting = true; $("round-status").textContent = this.t("yourTurn"); this.updateHint(); this.tiles[0]?.focus(); }, 500 + this.sequence.length * (pause + 190)); }
    choose(tile) {
        if (!this.accepting)
            return; this.flash(tile, true); this.play(tile); this.input.push(tile); this.attempts++; const expected = this.sequence[this.input.length - 1]; if (tile !== expected) {
                this.accepting = false;
                this.streak = 0;
                if (this.settings.mode === "endless" || (this.settings.mode === "lives" && --this.lives > 0)) {
                    $("round-status").textContent = this.t("incorrect");
                    this.updateHint();
                    this.schedule(() => this.nextRound(), 900);
                }
                else
                    this.finish(this.settings.mode === "lives" ? this.t("outOfLives") : this.t("incorrect"));
                return;
            } this.correct++; if (this.input.length === this.sequence.length) {
                this.accepting = false;
                this.score += this.level * 10;
                this.streak++;
                this.level++;
                this.settings.maxSequence = Math.max(this.settings.maxSequence, this.sequence.length);
                this.persist();
                $("round-status").textContent = this.t("correct");
                this.schedule(() => { this.renderGrid(); this.nextRound(); }, 800);
            } this.updateUI();
    }
    finish(reason) { this.clearTimers(); document.getElementById("pause-button").classList.add("hidden"); this.settings.highScore = Math.max(this.settings.highScore, this.score); this.persist(); $("game-view").classList.add("hidden"); $("game-over").classList.remove("hidden"); $("game-over-copy").textContent = `${reason} ${this.t("final", { level: this.level })}`; $("final-score").textContent = String(this.score); $("final-best").textContent = String(this.settings.highScore); $("final-accuracy").textContent = `${this.attempts ? Math.round(this.correct / this.attempts * 100) : 0}%`; }
    flash(index, pressed = false) {
        const tile = this.tiles[index]; if (!tile)
            return; tile.classList.add(pressed ? "pressed" : "lit"); if (!pressed)
            this.play(index); this.schedule(() => tile.classList.remove("lit", "pressed"), this.settings.reducedMotion ? 250 : 380);
    }
    play(index) {
        if (!this.settings.sound)
            return; this.audio ?? (this.audio = new AudioContext()); const osc = this.audio.createOscillator(); const gain = this.audio.createGain(); osc.frequency.value = 300 + index * 33; gain.gain.setValueAtTime(.04, this.audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001, this.audio.currentTime + .12); osc.connect(gain).connect(this.audio.destination); osc.start(); osc.stop(this.audio.currentTime + .13);
    }
    schedule(fn, ms) { this.timers.push(window.setTimeout(fn, ms)); }
    clearTimers() { this.timers.forEach(clearTimeout); this.timers = []; this.tiles.forEach(t => t.classList.remove("lit", "pressed")); }
    updateUI() { $("score").textContent = String(this.score); $("level").textContent = String(this.level); $("streak").textContent = String(this.streak); $("language").value = this.settings.language; $("mode").value = this.settings.mode; $("sound").checked = this.settings.sound; $("numbered").checked = this.settings.numbered; $("reduced-motion").checked = this.settings.reducedMotion; }
    showSettings(show) {
        if (show) {
            this.resumeAfterSettings = !$("game-view").classList.contains("hidden") && $("start-button").classList.contains("hidden");
            this.advanceAfterSettings = this.resumeAfterSettings && this.sequence.length > 0 && this.input.length === this.sequence.length;
            this.returnToGameOver = !$("game-over").classList.contains("hidden");
            this.clearTimers();
            this.accepting = false;
            $("settings").classList.remove("hidden");
            $("game-view").classList.add("hidden");
            $("game-over").classList.add("hidden");
            return;
        }
        $("settings").classList.add("hidden");
        $("game-view").classList.toggle("hidden", this.returnToGameOver);
        $("game-over").classList.toggle("hidden", !this.returnToGameOver);
        if (this.returnToGameOver) {
            this.returnToGameOver = false;
            return;
        }
        if (!this.resumeAfterSettings)
            return;
        this.renderGrid();
        if (this.advanceAfterSettings)
            this.nextRound();
        else
            this.replayRound();
        this.resumeAfterSettings = false;
        this.advanceAfterSettings = false;
    }
}
new MemoryFlash().init();
export { };
