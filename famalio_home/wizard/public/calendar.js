import {
  createCalendarAutomation, automationCalendarIDs, automationRule, ruleMatchesEvent,
  parseActionData, editorEvent, canWrite, FEATURE,
} from "./calendar-helpers.js";

const byId = (id) => document.getElementById(id);
const node = (tag, className, text) => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};
const button = (label, className = "fx-btn") => { const el = node("button", className, label); el.type = "button"; return el; };
const option = (value, label) => { const o = document.createElement("option"); o.value = value; o.textContent = label; return o; };
const field = (label, control, hint) => {
  const wrap = node("label", "fx-field"); wrap.append(node("span", "fx-label", label), control);
  if (hint) wrap.append(node("span", "fx-hint", hint));
  return wrap;
};
const input = (type, value = "", attrs = {}) => {
  const el = document.createElement(type === "textarea" ? "textarea" : "input");
  if (type !== "textarea") el.type = type;
  el.className = "fx-input"; el.value = value;
  for (const [key, val] of Object.entries(attrs)) el.setAttribute(key, val);
  return el;
};
const select = (options, value) => {
  const el = document.createElement("select"); el.className = "fx-input";
  for (const [v, label] of options) el.append(option(v, label));
  if (value !== undefined) el.value = value;
  return el;
};

const DAY = 86400000;
const PALETTE = ["#5b56c8", "#1f8a70", "#d9544f", "#e08a1e", "#2b7bd6", "#a14fb0", "#3a9ca8", "#7a8a2e"];
const VIEWS = [["month", "Monat"], ["week", "Woche"], ["day", "Tag"], ["agenda", "Agenda"]];
const TIMINGS = [["start", "Zum Beginn"], ["before_start", "Vor Beginn"], ["after_start", "Nach Beginn"], ["end", "Zum Ende"], ["before_end", "Vor Ende"], ["after_end", "Nach Ende"]];
const HOUR_PX = 44;
const DOMAIN_LABEL = { scene: "Szene", script: "Skript", automation: "Automation", light: "Licht", switch: "Schalter", climate: "Thermostat", cover: "Rollladen", media_player: "Medienplayer", fan: "Ventilator", input_boolean: "Helfer" };

const localDayKey = (value, zone) => {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const minutesInZone = (value, zone) => {
  const date = new Date(value); if (!Number.isFinite(date.getTime())) return 0;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return part("hour") * 60 + part("minute");
};
const hhmm = (value, zone) => {
  const m = minutesInZone(value, zone); return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
const utcDate = (key) => new Date(`${key}T00:00:00Z`);
const addDays = (key, amount) => { const d = utcDate(key); d.setUTCDate(d.getUTCDate() + amount); return d.toISOString().slice(0, 10); };
const mondayOf = (key) => addDays(key, -((utcDate(key).getUTCDay() + 6) % 7));
const eventTime = (value) => typeof value === "string" ? value : value?.dateTime || value?.date || "";
const todayInZone = (zone) => localDayKey(new Date(), zone);
const randomId = () => { const bytes = new Uint8Array(16); crypto.getRandomValues(bytes); return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""); };
const fmt = (options, value) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", ...options }).format(utcDate(value));
const timeLabel = (event, zone) => event.all_day ? "Ganztägig" : `${hhmm(event.start, zone)} – ${hhmm(event.end, zone)}`;
const store = {
  get(key, fallback) { try { const v = localStorage.getItem(`famalio.${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`famalio.${key}`, JSON.stringify(value)); } catch { /* optional */ } },
};
const scopeLabel = (rule) => {
  if (!rule) return "Eigene Bedingung";
  if (rule.scope === "calendar") return "Alle Termine";
  if (["keyword", "description", "location"].includes(rule.scope)) {
    const label = { keyword: "Titel", description: "Notiz", location: "Ort" }[rule.scope];
    const mode = { starts_with: "beginnt mit", ends_with: "endet mit", not_contains: "enthält nicht" }[rule.filters?.matchMode] || "enthält";
    return `${label} ${mode} „${rule.keyword || ""}“`;
  }
  if (rule.scope === "title") return `Titel „${rule.summary || ""}“`;
  if (rule.scope === "titles") return (rule.titles || []).join(" / ");
  if (rule.scope === "all_day") return "Ganztägige Termine";
  if (rule.scope === "timed") return "Termine mit Uhrzeit";
  if (rule.scope === "empty_day") return "Tag ohne Termine";
  return "Ein einzelner Termin";
};

class FamalioCalendar {
  constructor(host) {
    this.host = host;
    this.hass = null;
    this.zone = "UTC";
    this.calendars = [];
    this.events = [];
    this.view = store.get("view", "month");
    if (!VIEWS.some(([v]) => v === this.view)) this.view = "month";
    this.anchor = new Date().toISOString().slice(0, 10);
    this.hidden = new Set(store.get("hidden", []));
    this.loadSequence = 0;
    this.automationSequence = 0;
    this.automations = [];
    this.automationError = "";
    this.error = "";
    this.loading = false;
    this.connecting = false;
    this.confirmingFlow = false;
    this.restoreFocus = null;
    this.render();
    this.connect();
    // The integration is confirmed outside this iframe; keep checking while setup
    // is still missing so the first registered calendar opens by itself.
    this.timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && (!this.calendars.length || this.host.hidden)) this.connect();
    }, 15000);
    window.addEventListener("famalio-view", (event) => { this.closeDrawer(); if (event.detail === "calendar") this.connect(); });
    window.addEventListener("famalio-setup-status", (event) => this.onSetupStatus(event.detail));
    window.addEventListener("pagehide", () => window.clearInterval(this.timer));
  }

  // ---------- shell ----------
  render() {
    const app = node("div", "fx-app");
    const side = node("aside", "fx-side");
    this.newButton = button("＋ Neuer Termin", "fx-btn fx-primary fx-new");
    this.newButton.addEventListener("click", () => (this.writableCalendars().length ? this.openEditor(null, this.anchor) : this.openEditNotice()));
    this.mini = node("section", "fx-mini");
    const calSection = node("section", "fx-side-section");
    calSection.append(node("h3", "fx-side-title", "Kalender"));
    this.calendarList = node("div", "fx-cal-list"); calSection.append(this.calendarList);
    const ruleSection = node("section", "fx-side-section");
    const ruleHead = node("div", "fx-side-row"); ruleHead.append(node("h3", "fx-side-title", "Automationen"));
    this.ruleCount = node("span", "fx-pill", "0"); ruleHead.append(this.ruleCount);
    const ruleJump = button("Alle Regeln ansehen", "fx-link"); ruleJump.addEventListener("click", () => this.rulesPanel.scrollIntoView({ behavior: "smooth", block: "start" }));
    ruleSection.append(ruleHead, node("p", "fx-side-note", "Tippen Sie auf einen Termin, um eine Aktion für ihn anzulegen."), ruleJump);
    this.connectionCard = node("div", "fx-connection");
    this.connectionDot = node("span", "fx-dot"); this.connectionLabel = node("span", "", "Verbinde mit Home Assistant …");
    this.connectionCard.append(this.connectionDot, this.connectionLabel);
    side.append(this.newButton, this.mini, calSection, ruleSection, this.connectionCard);

    const main = node("section", "fx-main");
    const top = node("header", "fx-top");
    const nav = node("div", "fx-nav");
    this.prevButton = button("‹", "fx-icon"); this.prevButton.setAttribute("aria-label", "Zurück");
    this.todayButton = button("Heute", "fx-btn");
    this.nextButton = button("›", "fx-icon"); this.nextButton.setAttribute("aria-label", "Weiter");
    this.title = node("h1", "fx-title");
    nav.append(this.todayButton, this.prevButton, this.nextButton, this.title);
    const controls = node("div", "fx-controls");
    this.segment = node("div", "fx-segment"); this.segment.setAttribute("role", "tablist");
    this.viewButtons = VIEWS.map(([value, label]) => {
      const b = button(label, "fx-seg"); b.setAttribute("role", "tab"); b.dataset.view = value;
      b.addEventListener("click", () => this.setView(value)); this.segment.append(b); return b;
    });
    const refresh = button("↻", "fx-icon"); refresh.setAttribute("aria-label", "Aktualisieren"); refresh.title = "Aktualisieren";
    refresh.addEventListener("click", () => this.connect());
    controls.append(this.segment, refresh);
    top.append(nav, controls);
    this.status = node("div", "fx-status"); this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");
    this.body = node("div", "fx-body");
    this.rulesPanel = node("section", "fx-rules"); this.rulesPanel.setAttribute("aria-label", "Kalender-Automationen");
    main.append(top, this.status, this.body, this.rulesPanel);
    app.append(side, main);

    this.drawer = node("aside", "fx-drawer"); this.drawer.setAttribute("aria-label", "Termin"); this.drawer.hidden = true;
    this.backdrop = node("button", "fx-backdrop"); this.backdrop.type = "button"; this.backdrop.setAttribute("aria-label", "Schließen");
    this.host.replaceChildren(app, this.backdrop, this.drawer);

    this.prevButton.addEventListener("click", () => this.shift(-1));
    this.nextButton.addEventListener("click", () => this.shift(1));
    this.todayButton.addEventListener("click", () => { this.anchor = todayInZone(this.zone); this.loadEvents(); });
    this.backdrop.addEventListener("click", () => this.closeDrawer());
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !this.drawer.hidden) this.closeDrawer(); });
  }

  setView(view) { this.view = view; store.set("view", view); this.loadEvents(); }
  shift(direction) {
    if (this.view === "month") {
      const d = utcDate(this.anchor); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + direction); this.anchor = d.toISOString().slice(0, 10);
    } else this.anchor = addDays(this.anchor, direction * (this.view === "week" ? 7 : this.view === "day" ? 1 : 30));
    this.loadEvents();
  }
  range() {
    if (this.view === "month") {
      const first = `${this.anchor.slice(0, 7)}-01`; const start = mondayOf(first);
      return { from: start, until: addDays(start, 42) };
    }
    if (this.view === "week") { const start = mondayOf(this.anchor); return { from: start, until: addDays(start, 7) }; }
    if (this.view === "day") return { from: this.anchor, until: addDays(this.anchor, 1) };
    return { from: this.anchor, until: addDays(this.anchor, 30) };
  }
  headline() {
    const { from, until } = this.range();
    if (this.view === "month") return fmt({ month: "long", year: "numeric" }, this.anchor);
    if (this.view === "day") return fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }, this.anchor);
    const last = addDays(until, -1);
    return `${fmt({ day: "numeric", month: "short" }, from)} – ${fmt({ day: "numeric", month: "short", year: "numeric" }, last)}`;
  }
  calendarColor(id) { const index = this.calendars.findIndex((c) => c.id === id); return this.calendars[index]?.color || PALETTE[Math.max(0, index) % PALETTE.length]; }
  writable(id, bit) { return canWrite(this.hass?.states?.[id], bit); }
  writableCalendars() { return this.calendars.filter((c) => this.writable(c.id, FEATURE.CREATE)); }

  // ---------- data ----------
  async connect() {
    if (this.connecting) return;
    this.connecting = true;
    try {
      const ha = parent.document.querySelector("home-assistant");
      this.hass = ha?.hass;
      if (!this.hass?.callWS || !this.hass?.callApi) throw new Error("Bitte öffnen Sie diesen Kalender in einer angemeldeten Home Assistant Sitzung.");
      const firstLoad = !this.calendars.length;
      this.zone = this.hass.config?.time_zone || "UTC";
      if (firstLoad) this.anchor = todayInZone(this.zone);
      const entities = await this.hass.callWS({ type: "config/entity_registry/list" });
      this.calendars = (Array.isArray(entities) ? entities : [])
        .filter((e) => e.platform === "famalio" && !e.disabled_by && e.entity_id?.startsWith("calendar."))
        .map((e) => ({ id: e.entity_id, name: this.hass.states?.[e.entity_id]?.attributes?.friendly_name || e.name || e.original_name || e.entity_id }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c, i) => ({ ...c, color: PALETTE[i % PALETTE.length] }));
      this.connectionLabel.textContent = this.calendars.length ? `${this.calendars.length} ${this.calendars.length === 1 ? "Kalender" : "Kalender"} verbunden` : "Noch kein Famalio Kalender";
      this.connectionCard.classList.toggle("ok", this.calendars.length > 0);
      this.host.classList.toggle("is-connected", this.calendars.length > 0);
      window.dispatchEvent(new CustomEvent("famalio-calendar-state", { detail: this.calendars.length ? "ready" : "setup" }));
      if (!this.calendars.length) {
        if (await this.confirmDiscoveredFlow()) { this.connecting = false; return this.connect(); }
        this.events = []; this.automations = [];
        this.error = "Noch keine Famalio Integration eingerichtet. Verbinden Sie Home Assistant unter Einrichtung.";
        this.paint(); return;
      }
      await Promise.all([this.loadEvents(), this.loadAutomations()]);
    } catch (error) {
      this.error = error?.message || "Home Assistant konnte nicht erreicht werden.";
      this.connectionLabel.textContent = "Verbindung nicht verfügbar";
      this.connectionCard.classList.remove("ok");
      this.paint();
    } finally {
      this.connecting = false;
    }
  }

  /** One-click setup: completes the Famalio discovery flow the add-on started. */
  async confirmDiscoveredFlow() {
    if (this.confirmingFlow || !this.hass?.callWS) return false;
    this.confirmingFlow = true;
    try {
      const flows = await this.hass.callWS({ type: "config_entries/flow/progress" });
      const flow = (Array.isArray(flows) ? flows : []).find((f) => f.handler === "famalio" && f.context?.source === "hassio" && f.step_id === "hassio_confirm");
      if (!flow) return false;
      window.dispatchEvent(new CustomEvent("famalio-integration", { detail: { phase: "confirming" } }));
      const result = await this.hass.callApi("POST", `config/config_entries/flow/${encodeURIComponent(flow.flow_id)}`, {});
      const ok = result?.type === "create_entry" || (result?.type === "abort" && result?.reason === "already_configured");
      window.dispatchEvent(new CustomEvent("famalio-integration", { detail: { phase: ok ? "confirmed" : "failed", errors: result?.errors } }));
      if (ok) await new Promise((resolve) => setTimeout(resolve, 1500));
      return ok;
    } catch (error) {
      window.dispatchEvent(new CustomEvent("famalio-integration", { detail: { phase: "failed", message: error?.message } }));
      return false;
    } finally { this.confirmingFlow = false; }
  }
  onSetupStatus(status) {
    const ha = status?.home_assistant || {};
    if (!this.calendars.length && (ha.phase === "discovered" || ha.request?.state === "connected")) this.connect();
  }

  async loadAutomations() {
    this.hass = parent.document.querySelector("home-assistant")?.hass || this.hass;
    const sequence = ++this.automationSequence;
    const candidates = Object.values(this.hass.states || {}).filter((state) => state.entity_id?.startsWith("automation."));
    const results = [];
    for (let index = 0; index < candidates.length; index += 8) {
      results.push(...await Promise.allSettled(candidates.slice(index, index + 8).map(async (state) => {
        const result = await this.hass.callWS({ type: "automation/config", entity_id: state.entity_id });
        const calendarIDs = automationCalendarIDs(result?.config, this.calendars.map((c) => c.id));
        if (!calendarIDs.length) return null;
        return { id: state.attributes?.id, entity_id: state.entity_id, name: state.attributes?.friendly_name || result.config.alias || state.entity_id,
          state: state.state, calendarIDs, rule: automationRule(result.config), actions: [].concat(result.config.actions || result.config.action || []) };
      })));
    }
    if (sequence !== this.automationSequence) return;
    this.automations = results.filter((r) => r.status === "fulfilled" && r.value).map((r) => r.value).sort((a, b) => a.name.localeCompare(b.name));
    this.automationError = results.some((r) => r.status === "rejected") ? "Einige Automationen konnten nicht gelesen werden. Die vollständige Liste finden Sie in Home Assistant." : "";
    this.paint();
  }
  rulesFor(event) {
    return this.automations.filter((rule) => rule.calendarIDs.includes(event.entity_id) && ruleMatchesEvent(rule.rule, event));
  }

  async loadEvents() {
    if (!this.hass || !this.calendars.length) { this.paint(); return; }
    this.hass = parent.document.querySelector("home-assistant")?.hass || this.hass;
    const sequence = ++this.loadSequence;
    this.loading = true; this.error = ""; this.paint();
    const { from, until } = this.range();
    // Pad by a day on both sides so zone offsets never clip boundary events.
    const start = utcDate(addDays(from, -1)); const end = utcDate(addDays(until, 1));
    const visible = this.calendars.filter((c) => !this.hidden.has(c.id));
    const failures = [];
    const result = await Promise.all(visible.map(async (calendar) => {
      try {
        if (["unavailable", "unknown"].includes(this.hass.states?.[calendar.id]?.state)) throw new Error("unavailable");
        const query = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
        const events = await this.hass.callApi("GET", `calendars/${encodeURIComponent(calendar.id)}?${query}`);
        if (!Array.isArray(events)) throw new Error("invalid");
        return events.map((event) => {
          const startValue = eventTime(event.start); const endValue = eventTime(event.end);
          return { ...event, start: startValue, end: endValue, entity_id: calendar.id, calendar_name: calendar.name,
            all_day: /^\d{4}-\d{2}-\d{2}$/.test(startValue) };
        });
      } catch { failures.push(calendar.name); return []; }
    }));
    if (sequence !== this.loadSequence) return;
    this.events = result.flat().sort((a, b) => String(a.start).localeCompare(String(b.start)));
    this.error = failures.length ? `Nicht erreichbar: ${failures.join(", ")}. Prüfen Sie die Verbindung und versuchen Sie es erneut.` : "";
    this.loading = false; this.paint();
  }

  // ---------- painting ----------
  paint() {
    this.title.textContent = this.headline();
    for (const b of this.viewButtons) { const active = b.dataset.view === this.view; b.classList.toggle("active", active); b.setAttribute("aria-selected", String(active)); }
    this.newButton.hidden = !this.calendars.length;
    this.newButton.classList.toggle("fx-muted", !this.writableCalendars().length);
    this.newButton.title = this.writableCalendars().length ? "" : "Bearbeiten ist nicht aktiviert";
    this.status.replaceChildren();
    if (this.loading) this.status.append(node("span", "fx-loading", "Termine werden geladen …"));
    else if (this.error) {
      this.status.append(node("span", "", this.error));
      if (!this.calendars.length) { const open = button("Einrichtung öffnen", "fx-link"); open.dataset.openSettings = ""; this.status.append(open); }
    }
    this.status.classList.toggle("error", !!this.error && !this.loading);
    this.paintMini(); this.paintCalendars();
    this.body.replaceChildren();
    if (!this.calendars.length) this.paintEmpty();
    else if (this.view === "month") this.paintMonth();
    else if (this.view === "agenda") this.paintAgenda();
    else this.paintTimeGrid(this.view === "week" ? 7 : 1);
    this.paintRules();
  }
  paintEmpty() {
    const empty = node("div", "fx-empty-state");
    empty.append(node("div", "fx-empty-art", "📅"), node("h2", "", "Ihr Familienkalender in Home Assistant"),
      node("p", "", "Verbinden Sie Famalio mit einem Klick. Danach sehen Sie hier alle Termine und können Automationen daran knüpfen."));
    const go = button("Jetzt verbinden", "fx-btn fx-primary"); go.dataset.openSettings = ""; empty.append(go);
    this.body.append(empty);
  }
  paintMini() {
    this.mini.replaceChildren();
    const month = `${this.anchor.slice(0, 7)}-01`;
    const head = node("div", "fx-mini-head"); head.append(node("strong", "", fmt({ month: "long", year: "numeric" }, month)));
    const grid = node("div", "fx-mini-grid");
    ["M", "D", "M", "D", "F", "S", "S"].forEach((d) => grid.append(node("span", "fx-mini-dow", d)));
    const start = mondayOf(month); const today = todayInZone(this.zone);
    const busy = new Set(this.events.map((e) => localDayKey(e.start, this.zone)));
    for (let i = 0; i < 42; i++) {
      const key = addDays(start, i); const b = button(String(utcDate(key).getUTCDate()), "fx-mini-day");
      if (key.slice(0, 7) !== month.slice(0, 7)) b.classList.add("outside");
      if (key === today) b.classList.add("today");
      if (key === this.anchor) b.classList.add("selected");
      if (busy.has(key)) b.classList.add("busy");
      b.addEventListener("click", () => { this.anchor = key; if (this.view === "month") this.view = "day"; this.loadEvents(); });
      grid.append(b);
    }
    this.mini.append(head, grid);
  }
  paintCalendars() {
    this.calendarList.replaceChildren();
    if (!this.calendars.length) { this.calendarList.append(node("p", "fx-side-note", "Nach der Einrichtung erscheinen hier Ihre Kalender.")); return; }
    for (const cal of this.calendars) {
      const row = node("label", "fx-cal-row");
      const box = document.createElement("input"); box.type = "checkbox"; box.checked = !this.hidden.has(cal.id);
      box.style.setProperty("--cal", cal.color);
      box.addEventListener("change", () => { if (box.checked) this.hidden.delete(cal.id); else this.hidden.add(cal.id); store.set("hidden", [...this.hidden]); this.loadEvents(); });
      const name = node("span", "fx-cal-name", cal.name);
      row.append(box, name);
      if (this.writable(cal.id, FEATURE.CREATE)) row.append(node("span", "fx-tag", "bearbeitbar"));
      this.calendarList.append(row);
    }
  }
  chip(event, compact = false) {
    const chip = button("", `fx-chip${event.all_day ? " all-day" : ""}`);
    chip.style.setProperty("--cal", this.calendarColor(event.entity_id));
    if (!event.all_day && !compact) chip.append(node("span", "fx-chip-time", hhmm(event.start, this.zone)));
    chip.append(node("span", "fx-chip-title", event.summary || "(ohne Titel)"));
    const rules = this.rulesFor(event);
    if (rules.length) { const badge = node("span", "fx-bolt", "⚡"); badge.title = `${rules.length} Automation${rules.length === 1 ? "" : "en"}`; chip.append(badge); }
    chip.setAttribute("aria-label", `${timeLabel(event, this.zone)} ${event.summary || "(ohne Titel)"}${rules.length ? `, ${rules.length} Automationen` : ""}`);
    chip.addEventListener("click", (e) => { e.stopPropagation(); this.openEvent(event); });
    return chip;
  }
  eventOccursOnDay(event, key) {
    const startKey = localDayKey(event.start, this.zone); const endKey = localDayKey(event.end, this.zone);
    if (!startKey) return false;
    if (event.all_day) return key >= startKey && key < endKey;
    return key >= startKey && (key < endKey || (key === endKey && minutesInZone(event.end, this.zone) > 0) || startKey === endKey && key === startKey);
  }
  eventsForDay(key) { return this.events.filter((e) => this.eventOccursOnDay(e, key)); }
  paintMonth() {
    const grid = node("section", "fx-month");
    const head = node("div", "fx-dow"); ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].forEach((d) => head.append(node("div", "", d))); grid.append(head);
    const { from } = this.range(); const today = todayInZone(this.zone); const month = this.anchor.slice(0, 7);
    const days = node("div", "fx-days");
    for (let i = 0; i < 42; i++) {
      const key = addDays(from, i); const cell = node("div", "fx-cell");
      if (key.slice(0, 7) !== month) cell.classList.add("outside");
      if (key === today) cell.classList.add("today");
      const num = button(String(utcDate(key).getUTCDate()), "fx-cell-num"); num.setAttribute("aria-label", fmt({ weekday: "long", day: "numeric", month: "long" }, key));
      num.addEventListener("click", () => { this.anchor = key; this.setView("day"); });
      cell.append(num);
      const items = this.eventsForDay(key).sort((a, b) => Number(b.all_day) - Number(a.all_day) || String(a.start).localeCompare(String(b.start)));
      items.slice(0, 3).forEach((event) => cell.append(this.chip(event)));
      if (items.length > 3) { const more = button(`+${items.length - 3} weitere`, "fx-more"); more.addEventListener("click", () => { this.anchor = key; this.setView("day"); }); cell.append(more); }
      if (this.writableCalendars().length) cell.addEventListener("dblclick", () => this.openEditor(null, key));
      days.append(cell);
    }
    grid.append(days); this.body.append(grid);
  }
  paintTimeGrid(count) {
    const from = count === 7 ? mondayOf(this.anchor) : this.anchor;
    const keys = Array.from({ length: count }, (_, i) => addDays(from, i));
    const today = todayInZone(this.zone);
    const wrap = node("section", `fx-grid ${count === 1 ? "single" : ""}`); wrap.style.setProperty("--days", count);
    const header = node("div", "fx-grid-head"); header.append(node("div", "fx-gutter"));
    const allDay = node("div", "fx-grid-allday"); allDay.append(node("div", "fx-gutter fx-allday-label", "ganztägig"));
    for (const key of keys) {
      const h = node("div", `fx-grid-day${key === today ? " today" : ""}`);
      h.append(node("span", "fx-grid-dow", fmt({ weekday: "short" }, key)), node("span", "fx-grid-num", String(utcDate(key).getUTCDate())));
      header.append(h);
      const col = node("div", "fx-allday-col"); this.eventsForDay(key).filter((e) => e.all_day).forEach((e) => col.append(this.chip(e, true))); allDay.append(col);
    }
    const scroller = node("div", "fx-grid-scroll");
    const body = node("div", "fx-grid-body");
    const gutter = node("div", "fx-gutter fx-hours");
    for (let h = 0; h < 24; h++) gutter.append(node("span", "fx-hour", h ? `${String(h).padStart(2, "0")}:00` : ""));
    body.append(gutter);
    for (const key of keys) {
      const col = node("div", `fx-col${key === today ? " today" : ""}`);
      if (this.writableCalendars().length) col.addEventListener("dblclick", (e) => {
        if (e.target !== col) return;
        const minute = Math.max(0, Math.min(23 * 60, Math.floor(e.offsetY / HOUR_PX * 2) * 30));
        this.openEditor(null, key, `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
      });
      const timed = this.eventsForDay(key).filter((e) => !e.all_day).map((event) => {
        const startKey = localDayKey(event.start, this.zone); const endKey = localDayKey(event.end, this.zone);
        const top = startKey < key ? 0 : minutesInZone(event.start, this.zone);
        const bottom = endKey > key ? 1440 : Math.max(top + 20, minutesInZone(event.end, this.zone));
        return { event, top, bottom };
      }).sort((a, b) => a.top - b.top || b.bottom - a.bottom);
      // Greedy column packing for overlaps.
      const lanes = []; for (const item of timed) { let lane = lanes.findIndex((end) => end <= item.top); if (lane < 0) { lane = lanes.length; lanes.push(0); } lanes[lane] = item.bottom; item.lane = lane; }
      for (const item of timed) {
        const block = this.chip(item.event); block.classList.add("fx-block");
        block.style.top = `${item.top / 60 * HOUR_PX}px`; block.style.height = `${Math.max(18, (item.bottom - item.top) / 60 * HOUR_PX - 2)}px`;
        block.style.left = `${item.lane / lanes.length * 100}%`; block.style.width = `calc(${100 / lanes.length}% - 4px)`;
        col.append(block);
      }
      if (key === today) { const line = node("div", "fx-now"); line.style.top = `${minutesInZone(new Date(), this.zone) / 60 * HOUR_PX}px`; col.append(line); }
      body.append(col);
    }
    scroller.append(body); wrap.append(header, allDay, scroller); this.body.append(wrap);
    const earliest = Math.min(7 * 60, ...keys.flatMap((key) => this.eventsForDay(key).filter((e) => !e.all_day && localDayKey(e.start, this.zone) === key).map((e) => minutesInZone(e.start, this.zone))));
    requestAnimationFrame(() => { scroller.scrollTop = Math.max(0, earliest - 30) / 60 * HOUR_PX; });
  }
  paintAgenda() {
    const section = node("section", "fx-agenda");
    const { from, until } = this.range(); let any = false;
    for (let key = from; key < until; key = addDays(key, 1)) {
      const items = this.eventsForDay(key).sort((a, b) => Number(b.all_day) - Number(a.all_day) || String(a.start).localeCompare(String(b.start)));
      if (!items.length) continue; any = true;
      const group = node("div", "fx-agenda-day");
      const date = node("div", "fx-agenda-date"); date.append(node("span", "fx-agenda-num", String(utcDate(key).getUTCDate())), node("span", "", `${fmt({ weekday: "short" }, key)} · ${fmt({ month: "short" }, key)}`));
      const list = node("div", "fx-agenda-list");
      for (const event of items) {
        const row = button("", "fx-agenda-row"); row.style.setProperty("--cal", this.calendarColor(event.entity_id));
        const info = node("span", "fx-agenda-info"); info.append(node("strong", "", event.summary || "(ohne Titel)"), node("span", "fx-meta", `${timeLabel(event, this.zone)} · ${event.calendar_name}${event.location ? ` · ${event.location}` : ""}`));
        row.append(node("span", "fx-rail"), info);
        const rules = this.rulesFor(event); if (rules.length) row.append(node("span", "fx-badge", `⚡ ${rules.length}`));
        row.addEventListener("click", () => this.openEvent(event)); list.append(row);
      }
      group.append(date, list); section.append(group);
    }
    if (!any && !this.loading) section.append(node("div", "fx-empty", "Keine Termine in den nächsten 30 Tagen."));
    this.body.append(section);
  }
  paintRules() {
    this.ruleCount.textContent = String(this.automations.length);
    this.rulesPanel.replaceChildren();
    if (!this.calendars.length) return;
    const head = node("div", "fx-section-head");
    const manage = node("a", "fx-link", "In Home Assistant verwalten ↗"); manage.href = "/config/automation/dashboard"; manage.target = "_top";
    const add = button("＋ Automation", "fx-btn"); add.addEventListener("click", () => this.openBuilder());
    head.append(node("h2", "", "Kalender-Automationen"), add, manage); this.rulesPanel.append(head);
    if (this.automationError) this.rulesPanel.append(node("p", "fx-warning", this.automationError));
    if (!this.automations.length) { this.rulesPanel.append(node("p", "fx-empty", "Noch keine Automationen. Wählen Sie einen Termin und legen Sie fest, was passieren soll.")); return; }
    const list = node("div", "fx-rule-list");
    for (const rule of this.automations) {
      const row = node("a", "fx-rule"); row.target = "_top";
      row.href = typeof rule.id === "string" && rule.id ? `/config/automation/edit/${encodeURIComponent(rule.id)}` : "/config/automation/dashboard";
      const info = node("span", "fx-rule-info");
      const cals = rule.calendarIDs.map((id) => this.calendars.find((c) => c.id === id)?.name || id).join(", ");
      info.append(node("strong", "", rule.name), node("span", "fx-meta", `${scopeLabel(rule.rule)} · ${cals}`));
      const state = node("span", `fx-state ${rule.state === "on" ? "on" : ""}`, rule.state === "on" ? "Aktiv" : rule.state === "off" ? "Aus" : rule.state === "saved" ? "Gespeichert" : "Nicht verfügbar");
      row.append(node("span", "fx-rule-icon", "⚡"), info, state); list.append(row);
    }
    this.rulesPanel.append(list);
  }

  // ---------- drawer ----------
  showDrawer(label) {
    if (this.drawer.hidden) this.restoreFocus = document.activeElement;
    this.drawer.replaceChildren(); this.drawer.hidden = false; this.drawer.setAttribute("aria-label", label);
    this.backdrop.classList.add("visible");
    const top = node("div", "fx-drawer-top"); const close = button("×", "fx-icon"); close.setAttribute("aria-label", "Schließen");
    close.addEventListener("click", () => this.closeDrawer()); top.append(node("span", "fx-eyebrow", label), close);
    this.drawer.append(top);
  }
  closeDrawer() { this.drawer.hidden = true; this.backdrop.classList.remove("visible"); this.restoreFocus?.focus?.(); this.restoreFocus = null; }

  openEvent(event) {
    this.showDrawer(event.calendar_name || "Termin");
    const hero = node("div", "fx-hero"); hero.style.setProperty("--cal", this.calendarColor(event.entity_id));
    const startKey = localDayKey(event.start, this.zone);
    const endKey = event.all_day ? addDays(localDayKey(event.end, this.zone), -1) : localDayKey(event.end, this.zone);
    const when = startKey === endKey ? fmt({ weekday: "long", day: "numeric", month: "long" }, startKey)
      : `${fmt({ day: "numeric", month: "short" }, startKey)} – ${fmt({ day: "numeric", month: "short" }, endKey)}`;
    hero.append(node("h2", "fx-drawer-title", event.summary || "(ohne Titel)"), node("p", "fx-when", `${when} · ${timeLabel(event, this.zone)}`));
    if (event.location) hero.append(node("p", "fx-meta", `📍 ${event.location}`));
    if (event.description) hero.append(node("p", "fx-description", event.description));
    this.drawer.append(hero);

    const recurring = !!(event.rrule || event.recurrence_id);
    const actions = node("div", "fx-row");
    if (this.writable(event.entity_id, FEATURE.UPDATE) && event.uid) {
      const edit = button("Bearbeiten", "fx-btn"); edit.disabled = recurring; edit.addEventListener("click", () => this.openEditor(event)); actions.append(edit);
    }
    if (this.writable(event.entity_id, FEATURE.DELETE) && event.uid) {
      const del = button("Löschen", "fx-btn fx-danger"); del.disabled = recurring;
      del.addEventListener("click", async () => {
        if (!confirm(`„${event.summary || "Termin"}“ wirklich löschen?`)) return;
        del.disabled = true;
        try { await this.hass.callWS({ type: "calendar/event/delete", entity_id: event.entity_id, uid: event.uid }); this.closeDrawer(); await this.loadEvents(); }
        catch (error) { del.disabled = false; alert(error?.message || "Löschen fehlgeschlagen."); }
      });
      actions.append(del);
    }
    if (actions.childElementCount) this.drawer.append(actions);
    if (recurring) this.drawer.append(node("p", "fx-hint", "Wiederkehrende Termine bearbeiten Sie in der Famalio App."));
    else if (!this.writable(event.entity_id, FEATURE.UPDATE)) {
      const more = button("So aktivierst du das Bearbeiten", "fx-link"); more.addEventListener("click", () => this.openEditNotice(event));
      const box = node("div", "fx-notice"); box.append(node("strong", "", "Bearbeiten ist nicht aktiviert"),
        node("span", "", "Home Assistant darf Termine hier nur ansehen. Automationen kannst du trotzdem anlegen."), more);
      this.drawer.append(box);
    }

    const rulesBox = node("section", "fx-card");
    const head = node("div", "fx-section-head"); head.append(node("h3", "", "Automationen"));
    const add = button("＋ Automation", "fx-btn fx-primary"); add.addEventListener("click", () => this.openBuilder(event)); head.append(add);
    rulesBox.append(head);
    const rules = this.rulesFor(event);
    if (!rules.length) rulesBox.append(node("p", "fx-hint", "Noch nichts verknüpft. Zum Beispiel: 30 Minuten vor „Frühschicht“ das Licht im Flur einschalten."));
    for (const rule of rules) {
      const row = node("a", "fx-rule compact"); row.target = "_top";
      row.href = rule.id ? `/config/automation/edit/${encodeURIComponent(rule.id)}` : "/config/automation/dashboard";
      const info = node("span", "fx-rule-info"); info.append(node("strong", "", rule.name), node("span", "fx-meta", scopeLabel(rule.rule)));
      row.append(node("span", "fx-rule-icon", "⚡"), info); rulesBox.append(row);
    }
    this.drawer.append(rulesBox);
    add.focus();
  }

  /** Explains, in plain words, why editing is off and exactly how to turn it on in the Famalio app. */
  openEditNotice(event = null) {
    this.showDrawer("Bearbeiten aktivieren");
    const card = node("section", "fx-card fx-notice-card");
    card.append(node("h2", "fx-drawer-title", "Bearbeiten ist nicht aktiviert"),
      node("p", "fx-description", "Home Assistant darf deine Termine im Moment nur lesen. Du kannst hier trotzdem Automationen zu Terminen anlegen. Um Termine auch hier anzulegen, zu ändern oder zu löschen, musst du das in der Famalio-App erlauben:"));
    const steps = document.createElement("ol"); steps.className = "fx-steps";
    for (const text of [
      "Öffne die Famalio-App auf deinem Handy.",
      "Tippe auf Einstellungen → Famalio Home → Home-Server verbinden → Home Assistant.",
      "Unter „Verbunden“ die bestehende Verbindung löschen (nach links wischen → Widerrufen).",
      "Hier im Panel auf „Einrichtung → Mit Famalio verbinden“ tippen und den neuen Code in der App bestätigen.",
      "Dort den Schalter „Home Assistant darf bearbeiten“ einschalten und „Verbindung erlauben“ tippen.",
    ]) steps.append(node("li", "", text));
    card.append(steps, node("p", "fx-hint", "Wiederkehrende und importierte Termine bleiben immer nur in der Famalio-App bearbeitbar."));
    const setup = button("Zur Einrichtung", "fx-btn fx-primary"); setup.dataset.openSettings = "";
    setup.addEventListener("click", () => this.closeDrawer());
    card.append(setup);
    this.drawer.append(card);
    if (event) { const back = button("Zurück zum Termin", "fx-link"); back.addEventListener("click", () => this.openEvent(event)); this.drawer.append(back); }
  }

  openEditor(event, dayKey = this.anchor, time = "09:00") {
    const editing = !!event;
    this.showDrawer(editing ? "Termin bearbeiten" : "Neuer Termin");
    const writable = editing ? this.calendars.filter((c) => c.id === event.entity_id) : this.writableCalendars();
    if (!writable.length) { this.openEditNotice(event); return; }
    const form = document.createElement("form"); form.className = "fx-form";
    const startKey = editing ? localDayKey(event.start, this.zone) : dayKey;
    const endKey = editing ? (event.all_day ? addDays(localDayKey(event.end, this.zone), -1) : localDayKey(event.end, this.zone)) : dayKey;
    const endDefault = `${String(Math.min(23, Number(time.slice(0, 2)) + 1)).padStart(2, "0")}:${time.slice(3)}`;
    const title = input("text", editing ? event.summary || "" : "", { required: "", maxlength: "200", placeholder: "z. B. Elternabend" });
    const calendar = select(writable.map((c) => [c.id, c.name]), editing ? event.entity_id : writable[0].id); calendar.disabled = editing;
    const allDay = input("checkbox"); allDay.className = "fx-switch"; allDay.checked = editing ? event.all_day : false;
    const startDate = input("date", startKey); const endDate = input("date", endKey);
    const startTime = input("time", editing && !event.all_day ? hhmm(event.start, this.zone) : time);
    const endTime = input("time", editing && !event.all_day ? hhmm(event.end, this.zone) : endDefault);
    const location = input("text", event?.location || "", { maxlength: "200", placeholder: "Optional" });
    const description = input("textarea", event?.description || "", { rows: "3", maxlength: "2000", placeholder: "Optional" });
    const toggleTimes = () => { startTime.hidden = allDay.checked; endTime.hidden = allDay.checked; };
    allDay.addEventListener("change", toggleTimes); toggleTimes();
    startDate.addEventListener("change", () => { if (endDate.value < startDate.value) endDate.value = startDate.value; });
    const startRow = node("div", "fx-pair"); startRow.append(startDate, startTime);
    const endRow = node("div", "fx-pair"); endRow.append(endDate, endTime);
    const allDayRow = node("label", "fx-toggle-row"); allDayRow.append(allDay, node("span", "", "Ganztägig"));
    form.append(field("Titel", title), field("Kalender", calendar), allDayRow, field("Beginn", startRow), field("Ende", endRow), field("Ort", location), field("Notiz", description));
    const feedback = node("p", "fx-feedback"); feedback.setAttribute("role", "status");
    const save = button(editing ? "Änderungen speichern" : "Termin anlegen", "fx-btn fx-primary"); save.type = "submit";
    const footer = node("div", "fx-row"); footer.append(save); form.append(footer, feedback);
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); save.disabled = true; feedback.textContent = "Wird gespeichert …";
      try {
        const payload = editorEvent({ summary: title.value, allDay: allDay.checked, startDate: startDate.value, startTime: startTime.value,
          endDate: endDate.value, endTime: endTime.value, description: description.value, location: location.value }, this.zone);
        if (editing) await this.hass.callWS({ type: "calendar/event/update", entity_id: event.entity_id, uid: event.uid, event: payload });
        else await this.hass.callWS({ type: "calendar/event/create", entity_id: calendar.value, event: payload });
        this.anchor = startDate.value; this.closeDrawer(); await this.loadEvents();
      } catch (error) { feedback.textContent = error?.message || "Speichern fehlgeschlagen."; save.disabled = false; }
    });
    this.drawer.append(form); title.focus();
  }

  // ---------- automation builder ----------
  entityOptions(domain) {
    return Object.values(this.hass.states || {})
      .filter((s) => !domain || s.entity_id.startsWith(`${domain}.`))
      .map((s) => [s.entity_id, s.attributes?.friendly_name || s.entity_id])
      .sort((a, b) => a[1].localeCompare(b[1]));
  }
  openBuilder(event = null) {
    const sourceEvent = event;
    if (!event) {
      const calendar = this.calendars[0];
      if (!calendar) return;
      event = { entity_id: calendar.id, calendar_name: calendar.name, summary: "", start: this.anchor, all_day: true };
    }
    this.showDrawer("Neue Automation");
    const calendarName = event.calendar_name || "Kalender";
    const form = document.createElement("form"); form.className = "fx-form";
    form.append(node("p", "fx-hint", `Ausgelöst durch Termine in „${calendarName}“. Home Assistant führt die Aktion aus, auch wenn dieses Fenster geschlossen ist.`));

    const calendar = select(this.calendars.map((c) => [c.id, c.name]), event.entity_id);
    form.append(field("Kalender", calendar));

    // 1 · Which events, with editable names and reusable shift/day-off presets.
    const firstWord = String(event.summary || "").split(/\s+/).find((w) => w.length > 2) || "";
    const choices = [
      ...(sourceEvent ? [["occurrence", "Nur dieser Termin"]] : []),
      ["title", "Gleicher Titel"], ["keyword", "Titel enthält …"], ["titles", "Einer dieser Titel"],
      ["description", "Notiz enthält …"], ["location", "Ort enthält …"],
      ["all_day", "Ganztägige Termine"], ["timed", "Termine mit Uhrzeit"],
      ["calendar", "Ganzer Kalender"], ["empty_day", "Tag ohne Termine"],
    ];
    const scope = select(choices, sourceEvent ? "title" : "calendar");
    const keyword = input("textarea", event.summary || firstWord, { rows: "3", placeholder: "Titel oder Stichwort; mehrere Titel jeweils in einer Zeile" });
    const keywordField = field("Titel oder Stichwort", keyword);
    const matchMode = select([["contains", "Enthält"], ["starts_with", "Beginnt mit"], ["ends_with", "Endet mit"], ["not_contains", "Enthält nicht"]], "contains");
    const matchField = field("Textvergleich", matchMode);
    const presets = node("div", "fx-presets");
    for (const [label, value] of [["Freie Tage", ["Frei", "Freier Tag", "Free day", "Day off"]], ["Tagschicht", ["Tagschicht", "Tagdienst", "Day shift"]], ["Frühschicht", ["Frühschicht", "Frühdienst", "Early shift"]], ["Spätschicht", ["Spätschicht", "Spätdienst", "Late shift"]], ["Nachtschicht", ["Nachtschicht", "Nachtdienst", "Night shift"]], ["Urlaub", ["Urlaub", "Holiday", "Vacation"]]]) {
      const b = button(label, "fx-preset"); b.addEventListener("click", () => { scope.value = "titles"; keyword.value = value.join("\n"); syncScope(); }); presets.append(b);
    }
    const scopeBox = node("div", "fx-form"); scopeBox.append(field("Für welche Termine?", scope), keywordField, matchField, presets);

    const filtersBox = node("details", "fx-card fx-filters"); filtersBox.append(node("summary", "fx-label", "Weitere Bedingungen"));
    const filterFields = node("div", "fx-form");
    const weekdays = node("div", "fx-presets"); const weekdayInputs = [];
    for (const [index, label] of ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].entries()) {
      const check = input("checkbox"); check.value = index; check.className = "";
      const wrap = node("label", "fx-weekday"); wrap.append(check, node("span", "", label)); weekdays.append(wrap); weekdayInputs.push(check);
    }
    const startAfter = input("time"); const startBefore = input("time");
    const exclude = input("textarea", "", { rows: "2", placeholder: "Je ein Stichwort pro Zeile" });
    const stateEntity = select([["", "Keine Zustandsbedingung"], ...this.entityOptions()]);
    const stateValue = input("text", "", { placeholder: "z. B. on, off, home" });
    const timeFilters = node("div", "fx-pair"); timeFilters.append(field("Beginn ab", startAfter), field("Beginn vor", startBefore));
    const excludeField = field("Titel ausschließen", exclude);
    filterFields.append(field("Wochentage", weekdays, "Keine Auswahl bedeutet jeden Tag. Es zählt der Beginn des Termins."), timeFilters, excludeField,
      field("Nur wenn Entität", stateEntity), field("Diesen Zustand hat", stateValue)); filtersBox.append(filterFields);
    const readFilters = () => ({ zone: this.zone, weekdays: weekdayInputs.filter((c) => c.checked).map((c) => Number(c.value)),
      exclude: scope.value === "empty_day" ? "" : exclude.value, startAfter: scope.value === "empty_day" ? "" : startAfter.value,
      startBefore: scope.value === "empty_day" ? "" : startBefore.value, entity: stateEntity.value, state: stateValue.value, dailyTime: dailyTime.value, matchMode: matchMode.value });

    // 2 · When
    const timing = select(TIMINGS, "start");
    const offset = input("number", "15", { min: "1", max: "1440", "aria-label": "Minuten" });
    const offsetWrap = node("div", "fx-pair"); offsetWrap.append(offset, node("span", "fx-meta", "Minuten"));
    const syncOffset = () => { offsetWrap.hidden = timing.value === "start" || timing.value === "end"; }; timing.addEventListener("change", syncOffset); syncOffset();
    const whenRow = node("div", "fx-pair"); whenRow.append(timing, offsetWrap);
    const dailyTime = input("time", "07:00");
    const dailyField = field("Täglich prüfen um", dailyTime, "Prüft den ganzen heutigen Tag im gewählten Kalender, auch über Mitternacht laufende Termine. Ein freier Tag mit einem Termin ist nicht leer.");
    const whenField = field("Wann?", whenRow);
    const preview = node("p", "fx-hint"); preview.setAttribute("role", "status");
    const syncScope = () => {
      keywordField.hidden = !["title", "keyword", "titles", "description", "location"].includes(scope.value);
      matchField.hidden = !["keyword", "description", "location"].includes(scope.value);
      dailyField.hidden = scope.value !== "empty_day"; whenField.hidden = scope.value === "empty_day";
      timeFilters.hidden = excludeField.hidden = scope.value === "empty_day";
      if (scope.value === "occurrence") calendar.value = event.entity_id;
      calendar.disabled = scope.value === "occurrence";
      try {
        if (scope.value === "empty_day") { preview.textContent = "Die Aktion läuft nur, wenn der Kalender heute erreichbar und vollständig leer ist."; return; }
        const candidate = { ...event, entity_id: calendar.value, summary: scope.value === "title" ? keyword.value : event.summary };
        const config = createCalendarAutomation(candidate, "scene.preview", scope.value, timing.value, offset.value, keyword.value, readFilters());
        const count = this.events.filter((e) => e.entity_id === calendar.value && ruleMatchesEvent(automationRule(config), e)).length;
        preview.textContent = `${count} passende Termine im geladenen Zeitraum. Zustandsbedingungen werden bei Ausführung geprüft.`;
      } catch (error) { preview.textContent = error.message; }
    };
    form.addEventListener("input", syncScope); form.addEventListener("change", syncScope);

    // 3 · What (any HA action, one or more)
    const actionsBox = node("div", "fx-actions");
    const services = Object.entries(this.hass.services || {}).flatMap(([domain, list]) => Object.keys(list || {}).map((svc) => `${domain}.${svc}`)).sort();
    const serviceList = document.createElement("datalist"); serviceList.id = `fx-services-${randomId().slice(0, 8)}`;
    for (const svc of services) serviceList.append(option(svc, svc));
    const rows = [];
    const PRESETS = [
      ["Szene", "scene.turn_on", "scene"], ["Skript", "script.turn_on", "script"], ["Licht an", "light.turn_on", "light"],
      ["Licht aus", "light.turn_off", "light"], ["Schalter", "switch.turn_on", "switch"], ["Klima", "climate.set_temperature", "climate"],
      ["Mitteilung", "notify.notify", null], ["Automation", "automation.trigger", "automation"],
      ["Schalter aus", "switch.turn_off", "switch"], ["Rollladen auf", "cover.open_cover", "cover"], ["Rollladen zu", "cover.close_cover", "cover"],
      ["Musik", "media_player.media_play", "media_player"], ["Pause", "media_player.media_pause", "media_player"],
      ["Ventilator", "fan.turn_on", "fan"], ["Helfer", "input_boolean.turn_on", "input_boolean"], ["Beliebig", "", null],
    ];
    const addRow = (preset = PRESETS[0]) => {
      const row = node("div", "fx-action-row");
      const entityList = document.createElement("datalist"); entityList.id = `fx-entities-${randomId().slice(0, 8)}`; row.append(entityList);
      const presetBar = node("div", "fx-presets");
      const service = input("text", preset[1], { list: serviceList.id, placeholder: "domain.aktion, z. B. light.turn_on", spellcheck: "false", "aria-label": "Aktion" });
      const targets = node("div", "fx-targets");
      const targetInput = input("text", "", { list: entityList.id, placeholder: "Gerät oder Entität hinzufügen …", spellcheck: "false", "aria-label": "Ziel" });
      const chosen = new Set();
      const paintTargets = () => {
        targets.querySelectorAll(".fx-target").forEach((el) => el.remove());
        for (const id of chosen) {
          const tag = button(`${this.hass.states?.[id]?.attributes?.friendly_name || id} ×`, "fx-target");
          tag.addEventListener("click", () => { chosen.delete(id); paintTargets(); }); targets.insertBefore(tag, targetInput);
        }
      };
      targetInput.addEventListener("change", () => { const id = targetInput.value.trim(); if (this.hass.states?.[id]) { chosen.add(id); targetInput.value = ""; paintTargets(); } });
      targets.append(targetInput);
      const data = input("textarea", preset[1] === "notify.notify" ? `message: ${event.summary || "Termin"} beginnt` : preset[1] === "automation.trigger" ? "skip_condition: false" : "", { rows: "2", spellcheck: "false", placeholder: "Optionale Daten, z. B. brightness_pct: 60" });
      const automationHint = node("p", "fx-hint", "Bei einer bestehenden Automation werden ihre Bedingungen beachtet. Ihre eigenen Auslöser bleiben aktiv; Vorlagen mit ursprünglichen Auslöserdaten brauchen eventuell Anpassung.");
      const applyPreset = (p, b, focus) => {
        presetBar.querySelectorAll(".fx-preset").forEach((x) => x.classList.toggle("active", x === b));
        if (service.value !== p[1]) { chosen.clear(); targetInput.value = ""; paintTargets(); data.value = ""; }
        service.value = p[1]; if (p[1] === "notify.notify" && !data.value) data.value = `message: ${event.summary || "Termin"} beginnt`;
        if (p[1] === "automation.trigger" && !data.value) data.value = "skip_condition: false";
        automationHint.hidden = p[1] !== "automation.trigger";
        const domain = p[2]; targetInput.placeholder = domain ? `${DOMAIN_LABEL[domain]} auswählen …` : "Gerät oder Entität hinzufügen …";
        entityList.replaceChildren(...this.entityOptions(domain).map(([id, label]) => option(id, label)));
        if (focus) service.focus();
      };
      service.addEventListener("change", () => {
        entityList.replaceChildren(...this.entityOptions(service.value.split(".")[0] === "notify" ? undefined : service.value.split(".")[0]).map(([id, label]) => option(id, label)));
        automationHint.hidden = service.value !== "automation.trigger";
      });
      for (const p of PRESETS) {
        const b = button(p[0], "fx-preset");
        b.addEventListener("click", () => applyPreset(p, b, true));
        presetBar.append(b);
        if (p === preset) applyPreset(p, b, false);
      }
      const remove = button("Entfernen", "fx-link"); remove.addEventListener("click", () => { rows.splice(rows.indexOf(entry), 1); row.remove(); });
      row.append(presetBar, field("Aktion", service), field("Ziel", targets, "Leer lassen, wenn die Aktion kein Ziel braucht."), field("Daten", data),
        automationHint);
      if (rows.length) row.append(remove);
      const entry = { service, chosen, data, row, targetInput }; rows.push(entry);
      actionsBox.append(row);
    };
    addRow();
    const more = button("＋ Weitere Aktion", "fx-link"); more.addEventListener("click", () => addRow(PRESETS.at(-1)));

    const name = input("text", "", { maxlength: "120", placeholder: "Wird automatisch benannt" });
    form.append(scopeBox, filtersBox, whenField, dailyField, preview, node("span", "fx-label", "Was soll passieren?"), actionsBox, more, serviceList, field("Name", name));
    const feedback = node("p", "fx-feedback"); feedback.setAttribute("role", "status");
    const save = button("Automation speichern", "fx-btn fx-primary"); save.type = "submit";
    form.append(save, feedback, node("p", "fx-hint", "Tipp: Neue Termine sollten mehr als 15 Minuten in der Zukunft liegen, damit Home Assistant sie rechtzeitig sieht."));
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); save.disabled = true; feedback.textContent = "Wird gespeichert …";
      try {
        const actions = rows.map(({ service, chosen, data, targetInput }) => {
          const pending = targetInput.value.trim();
          if (pending) {
            if (!this.hass.states?.[pending]) throw new Error(`Unbekannte Entität „${pending}“.`);
            chosen.add(pending); targetInput.value = "";
          }
          return { action: service.value.trim(), target: { entity_id: [...chosen] }, data: parseActionData(data.value) };
        });
        for (const action of actions) {
          const [domain, svc] = action.action.split(".");
          if (!this.hass.services?.[domain]?.[svc]) throw new Error(`Unbekannte Aktion „${action.action || "…"}“.`);
          if (DOMAIN_LABEL[domain] && !action.target.entity_id.length && !action.data.entity_id) throw new Error("Bitte ein Ziel auswählen.");
        }
        const candidate = { ...event, entity_id: calendar.value, calendar_name: this.calendars.find((c) => c.id === calendar.value)?.name,
          summary: scope.value === "title" ? keyword.value : event.summary };
        if (scope.value === "title" && !candidate.summary.trim()) throw new Error("Bitte einen Titel eingeben.");
        if (scope.value === "empty_day" && !this.hass.services?.calendar?.get_events) throw new Error("Kalenderabfragen sind nicht verfügbar.");
        const config = createCalendarAutomation(candidate, actions, scope.value, timing.value, Number(offset.value), keyword.value, readFilters());
        if (name.value.trim()) config.alias = name.value.trim();
        const id = randomId();
        await this.hass.callApi("POST", `config/automation/config/${id}`, config);
        await this.loadAutomations();
        const active = this.automations.find((rule) => rule.id === id && rule.state === "on");
        feedback.textContent = active ? "Gespeichert. Home Assistant übernimmt ab jetzt." : "Gespeichert. Aktivierung noch nicht bestätigt. Bitte in Home Assistant prüfen.";
        if (!this.automations.some((rule) => rule.id === id)) {
          this.automations.push({ id, name: config.alias, state: "saved", calendarIDs: [calendar.value], rule: automationRule(config), actions: config.actions });
          this.paint();
        }
        if (sourceEvent && active) setTimeout(() => this.openEvent(event), 700);
      } catch (error) { feedback.textContent = error?.message || "Speichern fehlgeschlagen. Prüfen Sie Ihre Home Assistant Berechtigungen."; save.disabled = false; }
    });
    syncScope(); this.drawer.append(form);
  }
}

const mount = () => { const host = byId("calendar-workspace"); if (host && !host.__famalioCalendar) host.__famalioCalendar = new FamalioCalendar(host); };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true }); else mount();
