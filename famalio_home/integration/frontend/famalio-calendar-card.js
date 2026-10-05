/** Famalio dashboard calendar. No external scripts, cookies or Famalio credentials. */
const PRESETS = {
  family: { view: "month", days: 14, weekdays: [], text_size: "normal", show_clock: false, show_empty_days: true },
  wall: { view: "week", days: 14, weekdays: [], text_size: "large", show_clock: true, show_empty_days: true },
  school: { view: "agenda", days: 7, weekdays: [1, 2, 3, 4, 5], text_size: "large", show_clock: false, show_empty_days: false },
};
const WORDS = {
  en: { family: "Family calendar", wall: "Wall display", school: "School calendar", month: "Month", week: "Week", day: "Day", agenda: "Agenda", today: "Today", previous: "Previous", next: "Next", empty: "No events", loading: "Loading calendar…", select: "Choose calendars in the card settings.", failed: "Could not load", retry: "Retry", close: "Close", allDay: "All day", calendar: "Calendar", title: "Title", preset: "Layout preset", entities: "Calendars", view: "Default view", days: "Agenda days", weekdays: "Visible weekdays (empty = all)", include: "Include text (comma-separated, any match)", exclude: "Exclude text (comma-separated)", match_field: "Search in", all: "Title, notes and location", summary: "Title", event_type: "Event type", timed: "Timed events", all_day: "All-day events", text_size: "Text size", compact: "Compact", normal: "Normal", large: "Large", first_day: "First weekday", monday: "Monday", sunday: "Sunday", show_navigation: "Show navigation and view switcher", show_legend: "Show calendar names", show_location: "Show location", show_description: "Show notes in event details", show_empty_days: "Show days without events in agenda", show_clock: "Show clock", refresh_interval: "Refresh interval (seconds)", color: "Accent color (optional, e.g. #6750a4)", max_events: "Maximum events per day before expanding", more: "more", less: "Show less", details: "Event details", invalid: "Invalid calendar card configuration", partial: "Some calendars could not be loaded", note: "Pick a preset, then customize it. Filters apply to title/notes/location; choose a separate school calendar to show only school events." },
  de: { family: "Familienkalender", wall: "Wanddisplay", school: "Schulkalender", month: "Monat", week: "Woche", day: "Tag", agenda: "Agenda", today: "Heute", previous: "Zurück", next: "Weiter", empty: "Keine Termine", loading: "Kalender wird geladen…", select: "Kalender in den Karteneinstellungen auswählen.", failed: "Laden fehlgeschlagen", retry: "Erneut versuchen", close: "Schließen", allDay: "Ganztägig", calendar: "Kalender", title: "Titel", preset: "Layout-Vorlage", entities: "Kalender", view: "Standardansicht", days: "Agenda-Tage", weekdays: "Sichtbare Wochentage (leer = alle)", include: "Text einschließen (Komma-getrennt, ein Treffer genügt)", exclude: "Text ausschließen (Komma-getrennt)", match_field: "Suchen in", all: "Titel, Notizen und Ort", summary: "Titel", event_type: "Terminart", timed: "Termine mit Uhrzeit", all_day: "Ganztägige Termine", text_size: "Textgröße", compact: "Kompakt", normal: "Normal", large: "Groß", first_day: "Erster Wochentag", monday: "Montag", sunday: "Sonntag", show_navigation: "Navigation und Ansichten anzeigen", show_legend: "Kalendernamen anzeigen", show_location: "Ort anzeigen", show_description: "Notizen in Termindetails anzeigen", show_empty_days: "Tage ohne Termine in Agenda anzeigen", show_clock: "Uhr anzeigen", refresh_interval: "Aktualisierung (Sekunden)", color: "Akzentfarbe (optional, z. B. #6750a4)", max_events: "Termine pro Tag vor dem Aufklappen", more: "weitere", less: "Weniger anzeigen", details: "Termindetails", invalid: "Ungültige Kalenderkarten-Konfiguration", partial: "Einige Kalender konnten nicht geladen werden", note: "Vorlage wählen und anpassen. Filter durchsuchen Titel/Notizen/Ort; für ausschließlich Schultermine einen eigenen Schulkalender auswählen." },
  it: { family: "Calendario famiglia", wall: "Display a parete", school: "Calendario scuola", month: "Mese", week: "Settimana", day: "Giorno", agenda: "Agenda", today: "Oggi", previous: "Precedente", next: "Successivo", empty: "Nessun evento", loading: "Caricamento calendario…", select: "Scegli i calendari nelle impostazioni della scheda.", failed: "Caricamento non riuscito", retry: "Riprova", close: "Chiudi", allDay: "Tutto il giorno", calendar: "Calendario", title: "Titolo", preset: "Modello", entities: "Calendari", view: "Vista predefinita", days: "Giorni agenda", weekdays: "Giorni visibili (vuoto = tutti)", include: "Includi testo (separato da virgole, almeno uno)", exclude: "Escludi testo (separato da virgole)", match_field: "Cerca in", all: "Titolo, note e luogo", summary: "Titolo", event_type: "Tipo di evento", timed: "Eventi con orario", all_day: "Eventi giornalieri", text_size: "Dimensione testo", compact: "Compatto", normal: "Normale", large: "Grande", first_day: "Primo giorno della settimana", monday: "Lunedì", sunday: "Domenica", show_navigation: "Mostra navigazione e viste", show_legend: "Mostra nomi dei calendari", show_location: "Mostra luogo", show_description: "Mostra note nei dettagli", show_empty_days: "Mostra giorni senza eventi nell’agenda", show_clock: "Mostra orologio", refresh_interval: "Aggiornamento (secondi)", color: "Colore (facoltativo, es. #6750a4)", max_events: "Eventi per giorno prima di espandere", more: "altri", less: "Mostra meno", details: "Dettagli evento", invalid: "Configurazione calendario non valida", partial: "Alcuni calendari non sono disponibili", note: "Scegli un modello e personalizzalo. I filtri cercano titolo/note/luogo; scegli un calendario scolastico separato per mostrare solo gli eventi della scuola." },
};
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const keywords = value => String(value || "").split(/[,\n]/).map(s => s.trim().toLocaleLowerCase()).filter(Boolean);
const dateValue = value => typeof value === "string" ? value : value?.dateTime || value?.date || "";
const shiftDate = (day, count) => new Date(Date.parse(`${day}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
const weekday = day => new Date(`${day}T12:00:00Z`).getUTCDay();
function dayKey(date, zone) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return ["year", "month", "day"].map(key => parts.find(p => p.type === key).value).join("-");
}
// Convert civil midnight to an instant in HA's zone, including DST days.
function midnight(day, zone) {
  const desired = Date.parse(`${day}T00:00:00Z`);
  let instant = desired;
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const civil = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    const delta = desired - civil;
    instant += delta;
    if (!delta) break;
  }
  return instant;
}
function normalizeConfig(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid calendar card configuration");
  const config = { preset: "family", first_day: "monday", include: "", exclude: "", match_field: "all", event_type: "all", show_navigation: true, show_legend: true, show_location: true, show_description: true, refresh_interval: 120, max_events: 4, ...PRESETS[raw.preset || "family"], ...raw };
  config.entities = raw.entities ?? (raw.entity ? [raw.entity] : []);
  if (!Array.isArray(config.entities) || config.entities.length > 30 || config.entities.some(e => typeof e !== "string" || !/^calendar\.[a-z0-9_]+$/.test(e))) throw new Error("Choose up to 30 calendar entities");
  config.entities = [...new Set(config.entities)];
  for (const [key, allowed] of Object.entries({ preset: Object.keys(PRESETS), view: ["month", "week", "day", "agenda"], first_day: ["monday", "sunday"], text_size: ["compact", "normal", "large"], match_field: ["all", "summary"], event_type: ["all", "all_day", "timed"] })) {
    if (!allowed.includes(config[key])) throw new Error(`Invalid ${key}`);
  }
  for (const [key, min, max] of [["days", 1, 31], ["refresh_interval", 60, 3600], ["max_events", 1, 50]]) {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max) throw new Error(`${key} must be ${min}–${max}`);
  }
  if (!Array.isArray(config.weekdays) || config.weekdays.some(d => !/^[0-6]$/.test(String(d)))) throw new Error("Invalid weekdays");
  config.weekdays = [...new Set(config.weekdays.map(Number))];
  for (const key of ["include", "exclude", "title", "color"]) if (config[key] !== undefined && typeof config[key] !== "string") throw new Error(`Invalid ${key}`);
  for (const key of ["show_navigation", "show_legend", "show_location", "show_description", "show_empty_days", "show_clock"]) if (typeof config[key] !== "boolean") throw new Error(`Invalid ${key}`);
  if (config.color && !/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(config.color)) throw new Error("Accent color must be a hex color, e.g. #6750a4");
  return config;
}
function viewRange(anchor, view, config) {
  let start = anchor;
  let count = view === "agenda" ? config.days : view === "week" ? 7 : 1;
  if (view === "month") {
    start = `${anchor.slice(0, 7)}-01`;
    const nextMonth = new Date(`${start}T12:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const offset = (weekday(start) - (config.first_day === "sunday" ? 0 : 1) + 7) % 7;
    start = shiftDate(start, -offset);
    count = Math.ceil((Date.parse(nextMonth.toISOString().slice(0, 10)) - Date.parse(start)) / 86400000 / 7) * 7;
  } else if (view === "week") start = shiftDate(start, -(weekday(start) - (config.first_day === "sunday" ? 0 : 1) + 7) % 7);
  return { start, end: shiftDate(start, count), days: Array.from({ length: count }, (_, i) => shiftDate(start, i)) };
}
function normalizeEvent(raw, entity) {
  const start = dateValue(raw.start), end = dateValue(raw.end);
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(start);
  if (!start || !end || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)) || Date.parse(end) <= Date.parse(start)) return null;
  return { ...raw, summary: raw.summary || raw.title || "", start, end, allDay, entity };
}
function matchesEvent(event, config) {
  if (config.event_type === "all_day" && !event.allDay || config.event_type === "timed" && event.allDay) return false;
  const text = (config.match_field === "summary" ? event.summary : [event.summary, event.description, event.location].join("\n")).toLocaleLowerCase();
  const include = keywords(config.include), exclude = keywords(config.exclude);
  return (!include.length || include.some(word => text.includes(word))) && !exclude.some(word => text.includes(word));
}
function overlapsDay(event, day, zone) {
  if (event.allDay) return event.start <= day && event.end > day; // HA all-day end is exclusive.
  return Date.parse(event.start) < midnight(shiftDate(day, 1), zone) && Date.parse(event.end) > midnight(day, zone);
}
const STYLE = `
:host{display:block;--famalio-accent:var(--primary-color,#6750a4);font-size:var(--famalio-font,14px)}
ha-card{display:block;overflow:hidden;color:var(--primary-text-color,#202124);background:var(--ha-card-background,var(--card-background-color,#fff));border-radius:var(--ha-card-border-radius,16px)}
*{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer;border:0;background:transparent;border-radius:8px;padding:8px}button:hover{background:var(--secondary-background-color,#f0f0f0)}button:focus-visible,dialog:focus-visible{outline:2px solid var(--famalio-accent);outline-offset:2px}button:disabled{opacity:.5;cursor:default}
header{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:18px 18px 8px}h2{font-size:1.3em;font-weight:600;margin:0}h3{font-size:1em;margin:0}time.clock{font-size:1.6em;white-space:nowrap;color:var(--famalio-accent);font-variant-numeric:tabular-nums}.toolbar{display:flex;align-items:center;gap:4px;flex-wrap:wrap;padding:8px 12px}.period{flex:1;font-weight:600;text-align:center;min-width:90px}.views{display:flex;padding:0 16px 12px;gap:4px;flex-wrap:wrap}.views .active{background:var(--famalio-accent);color:var(--text-primary-color,#fff)}.legend{display:flex;flex-wrap:wrap;gap:10px;padding:4px 18px 14px;font-size:.85em;color:var(--secondary-text-color,#656565)}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--event-color,var(--famalio-accent));margin-right:5px}.status{padding:16px;white-space:pre-line}.error{color:var(--error-color,#b00020);font-size:.9em}.days{display:grid;border-top:1px solid var(--divider-color,#ddd)}.days.month,.days.week{grid-template-columns:repeat(var(--day-columns,7),minmax(0,1fr))}.days.agenda,.days.day{grid-template-columns:1fr}.day{min-width:0;border-right:1px solid var(--divider-color,#ddd);border-bottom:1px solid var(--divider-color,#ddd);padding:8px;min-height:115px}.day:last-child{border-right:0}.day-heading{display:flex;gap:4px;align-items:center;margin:0 0 7px;font-size:.9em;font-weight:600}.today .day-heading{color:var(--famalio-accent)}.outside{background:var(--secondary-background-color,#f7f7f7)}.weekday{display:block;font-size:.75em;opacity:.7}.event{display:block;text-align:left;width:100%;padding:7px 6px;margin:4px 0;border-left:3px solid var(--event-color,var(--famalio-accent));border-radius:5px;background:var(--secondary-background-color,#f6f6f6);overflow-wrap:anywhere}.event .summary{display:block;font-weight:500}.event .when,.event .location{font-size:.8em;display:block;opacity:.8;margin-top:3px}.empty{font-size:.85em;color:var(--secondary-text-color,#666);padding:6px 0}.days.agenda .day,.days.day .day{min-height:0;border-right:0;padding:14px 18px}.days.agenda .events{display:flex;gap:8px;flex-wrap:wrap}.days.agenda .event{flex:1 1 200px;max-width:100%}.more{font-size:.8em;text-align:left;color:var(--famalio-accent)}dialog{color:inherit;background:var(--ha-card-background,var(--card-background-color,#fff));border:1px solid var(--divider-color,#ddd);border-radius:16px;width:min(480px,calc(100vw - 32px));max-height:85vh;padding:20px;overflow:auto}dialog::backdrop{background:#0008}dialog h3{font-size:1.3em;margin:0 0 16px}dialog p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5}dialog .close{float:right}dialog .notes{font-size:.95em}.event-calendar{color:var(--secondary-text-color,#666);font-size:.9em}
@media(max-width:520px){.days.month .day,.days.week .day{padding:4px}.days.month .event{font-size:.8em;padding:4px}.days.month .location{display:none}.days.week{grid-template-columns:1fr}.days.week .day{min-height:0;padding:12px}.days.week .day-heading .weekday{display:inline;font-size:1em}.days.week .event{padding:8px}.period{font-size:.9em}header{padding:14px 12px 4px}}
`;
// Extra modules can arrive before HA installs its custom-element registry
// polyfill. Define our elements after the frontend has initialized that registry.
// Otherwise early definitions disappear when HA replaces the native registry.
if (typeof document !== "undefined") {
  await new Promise(resolve => {
    const ready = () => customElements.get("home-assistant") ? resolve() : setTimeout(ready, 25);
    ready();
  });
}
class FamalioCalendarCard extends HTMLElement {
  constructor() {
    super(); this.attachShadow({ mode: "open" }); this._events = []; this._failures = []; this._expanded = new Set(); this._request = 0;
    this.shadowRoot.addEventListener("click", event => this._click(event));
    this.shadowRoot.addEventListener("close", () => { this._detail = null; this._render(); }, true);
  }
  static getConfigElement() { return document.createElement("famalio-calendar-card-editor"); }
  static getStubConfig(hass) {
    const calendars = Object.keys(hass?.states || {}).filter(id => id.startsWith("calendar."));
    const famalio = calendars.filter(id => id.startsWith("calendar.famalio"));
    return { preset: "family", entities: famalio.length ? famalio : calendars.slice(0, 1) };
  }
  setConfig(raw) {
    this._config = normalizeConfig(raw); this._view = this._config.view; this._anchor = null; this._detail = null; this._expanded.clear(); this._request++; this._events = []; this._failures = []; this._signature = null;
    this.style.setProperty("--famalio-font", { compact: "12px", normal: "14px", large: "18px" }[this._config.text_size]);
    if (this._config.color) this.style.setProperty("--famalio-accent", this._config.color); else this.style.removeProperty("--famalio-accent");
    this._render(); this._startTimers(); this._load();
  }
  set hass(hass) {
    const previousZone = this._hass?.config?.time_zone, previousLocale = this._locale; this._hass = hass;
    if (!this._config) return;
    const signature = this._config.entities.map(id => { const s = hass.states[id]; return `${id}:${s?.last_updated}:${s?.state}:${s?.attributes?.friendly_name}`; }).join("|");
    if (previousZone && previousZone !== this._zone) { this._anchor = null; this._signature = null; }
    const changed = this._signature !== signature; this._signature = signature;
    // State-only renders must not dismiss an open event dialog.
    if (!this._detail && (changed || previousLocale !== this._locale)) this._render();
    if (changed) this._load();
  }
  get _zone() { return this._hass?.config?.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  get _locale() { return this._hass?.locale?.language || this._hass?.language || "en"; }
  get _words() { return WORDS[this._locale.split("-")[0]] || WORDS.en; }
  get _today() { return dayKey(new Date(), this._zone); }
  get _range() { return viewRange(this._anchor || this._today, this._view, this._config); }
  getCardSize() { return this._view === "month" ? 9 : this._view === "week" ? 7 : 5; }
  getGridOptions() { return { columns: 12, min_columns: 6, min_rows: 3 }; }
  connectedCallback() { this._startTimers(); this._load(); }
  disconnectedCallback() { clearInterval(this._timer); clearInterval(this._clockTimer); this._request++; this._loading = false; }
  _startTimers() {
    clearInterval(this._timer); clearInterval(this._clockTimer);
    if (!this.isConnected || !this._config) return;
    this._timer = setInterval(() => this._load(), this._config.refresh_interval * 1000);
    this._clockDay = this._today;
    this._clockTimer = setInterval(() => {
      if (this._clockDay !== this._today) { this._clockDay = this._today; this._load(); }
      const clock = this.shadowRoot.querySelector(".clock");
      if (clock) clock.textContent = this._time(new Date());
    }, 30000);
  }
  async _load() {
    if (!this.isConnected || !this._hass?.callApi || !this._config) return;
    const request = ++this._request;
    const range = this._range;
    this._loading = true; this._render();
    const query = new URLSearchParams({ start: new Date(midnight(range.start, this._zone)).toISOString(), end: new Date(midnight(range.end, this._zone)).toISOString() });
    const results = await Promise.allSettled(this._config.entities.map(async entity => {
      const events = await this._hass.callApi("GET", `calendars/${encodeURIComponent(entity)}?${query}`);
      if (!Array.isArray(events)) throw new Error("Invalid calendar response");
      return events.map(e => normalizeEvent(e, entity)).filter(e => e && matchesEvent(e, this._config));
    }));
    if (request !== this._request || !this.isConnected) return;
    this._events = results.flatMap(r => r.status === "fulfilled" ? r.value : []).sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.summary.localeCompare(b.summary));
    this._failures = results.flatMap((r, i) => r.status === "rejected" ? [this._config.entities[i]] : []);
    this._loading = false; if (!this._detail) this._render();
  }
  _date(day, options = {}) { return new Intl.DateTimeFormat(this._locale, { timeZone: "UTC", ...options }).format(new Date(`${day}T12:00:00Z`)); }
  _time(date) { return new Intl.DateTimeFormat(this._locale, { timeZone: this._zone, hour: "2-digit", minute: "2-digit", hour12: this._hass?.locale?.time_format === "12" ? true : this._hass?.locale?.time_format === "24" ? false : undefined }).format(date); }
  _name(entity) { return this._hass?.states?.[entity]?.attributes?.friendly_name || entity; }
  _color(entity) {
    const index = this._config.entities.indexOf(entity);
    const value = this._hass?.states?.[entity]?.attributes?.color;
    return /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(value || "") ? value : ["#6750a4", "#1976d2", "#28875a", "#ad541e", "#b43d77"][index % 5];
  }
  _when(event, day) {
    if (event.allDay) return this._words.allDay;
    const start = dayKey(new Date(event.start), this._zone), end = dayKey(new Date(event.end), this._zone);
    if (start !== end) return `${this._date(start, { month: "short", day: "numeric" })} ${this._time(new Date(event.start))} – ${this._date(end, { month: "short", day: "numeric" })} ${this._time(new Date(event.end))}`;
    return `${this._time(new Date(event.start))} – ${this._time(new Date(event.end))}`;
  }
  _render() {
    if (!this._config || this._detail) return;
    const c = this._config, w = this._words, range = this._range, anchor = this._anchor || this._today;
    const visible = range.days.filter(day => !c.weekdays.length || c.weekdays.includes(weekday(day)));
    const columns = c.weekdays.length || 7;
    const period = this._view === "month" ? this._date(anchor, { month: "long", year: "numeric" }) : `${this._date(range.start, { month: "short", day: "numeric" })}${range.days.length > 1 ? ` – ${this._date(shiftDate(range.end, -1), { month: "short", day: "numeric", year: "numeric" })}` : ""}`;
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><ha-card><header><h2>${escapeHtml(c.title || w[c.preset])}</h2>${c.show_clock ? `<time class="clock">${escapeHtml(this._time(new Date()))}</time>` : ""}</header>
      ${c.show_navigation ? `<div class="toolbar"><button data-nav="previous" aria-label="${w.previous}">‹</button><button data-nav="today">${w.today}</button><div class="period" aria-live="polite">${escapeHtml(period)}</div><button data-nav="next" aria-label="${w.next}">›</button></div><div class="views">${["month", "week", "day", "agenda"].map(view => `<button data-view="${view}" class="${this._view === view ? "active" : ""}" aria-pressed="${this._view === view}">${w[view]}</button>`).join("")}</div>` : `<div class="toolbar"><div class="period">${escapeHtml(period)}</div></div>`}
      ${c.show_legend ? `<div class="legend">${c.entities.map(entity => `<span style="--event-color:${this._color(entity)}"><span class="dot"></span>${escapeHtml(this._name(entity))}</span>`).join("")}</div>` : ""}
      ${!c.entities.length ? `<div class="status">${w.select}</div>` : ""}
      ${this._loading ? `<div class="status" role="status">${w.loading}</div>` : ""}
      ${this._failures.length ? `<div class="status error" role="alert">${w.partial}: ${this._failures.map(entity => escapeHtml(this._name(entity))).join(", ")} <button data-retry>${w.retry}</button></div>` : ""}
      ${c.entities.length && this._view === "agenda" && !c.show_empty_days && !this._loading && !this._failures.length && !visible.some(day => this._events.some(event => overlapsDay(event, day, this._zone))) ? `<div class="status">${w.empty}</div>` : ""}
      <div class="days ${this._view}" style="--day-columns:${columns}">${c.entities.length ? visible.map(day => this._dayHtml(day)).join("") : ""}</div>
    </ha-card>`;
  }
  _dayHtml(day) {
    const c = this._config, w = this._words;
    const events = this._events.map((event, index) => ({ event, index })).filter(({ event }) => overlapsDay(event, day, this._zone));
    if (this._view === "agenda" && !c.show_empty_days && !events.length) return "";
    const shown = this._expanded.has(day) ? events : events.slice(0, c.max_events);
    const heading = this._view === "month" ? `${this._date(day, { day: "numeric" })}<span class="weekday">${this._date(day, { weekday: "short" })}</span>` : this._date(day, { weekday: "long", month: "short", day: "numeric" });
    return `<section class="day ${day === this._today ? "today" : ""} ${this._view === "month" && day.slice(0, 7) !== (this._anchor || this._today).slice(0, 7) ? "outside" : ""}" data-date="${day}"><h3 class="day-heading">${heading}</h3><div class="events">${shown.map(({ event, index }) => `<button class="event" data-event="${index}" style="--event-color:${this._color(event.entity)}" aria-label="${escapeHtml(`${event.summary}, ${this._when(event, day)}`)}"><span class="summary">${escapeHtml(event.summary)}</span><span class="when">${escapeHtml(this._when(event, day))}</span>${c.show_location && event.location ? `<span class="location">${escapeHtml(event.location)}</span>` : ""}</button>`).join("")}</div>${!events.length && !this._loading ? `<div class="empty">${this._failures.length ? "—" : w.empty}</div>` : ""}${events.length > c.max_events ? `<button class="more" data-expand="${day}">${this._expanded.has(day) ? w.less : `+${events.length - shown.length} ${w.more}`}</button>` : ""}</section>`;
  }
  _click(event) {
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.view) { this._view = button.dataset.view; this._navigate(); }
    else if (button.dataset.nav) {
      const direction = button.dataset.nav === "next" ? 1 : -1;
      if (button.dataset.nav === "today") this._anchor = null;
      else if (this._view === "month") {
        const date = new Date(`${(this._anchor || this._today).slice(0, 7)}-01T12:00:00Z`); date.setUTCMonth(date.getUTCMonth() + direction); this._anchor = date.toISOString().slice(0, 10);
      } else this._anchor = shiftDate(this._anchor || this._today, direction * (this._view === "week" ? 7 : this._view === "agenda" ? this._config.days : 1));
      this._navigate();
    } else if (button.hasAttribute("data-retry")) this._load();
    else if (button.dataset.expand) { const day = button.dataset.expand; this._expanded.has(day) ? this._expanded.delete(day) : this._expanded.add(day); this._render(); }
    else if (button.dataset.event !== undefined) this._showDetail(Number(button.dataset.event));
    else if (button.hasAttribute("data-close")) this.shadowRoot.querySelector("dialog")?.close();
  }
  _navigate() { this._detail = null; this._expanded.clear(); this._events = []; this._failures = []; this._load(); this._render(); }
  _showDetail(index) {
    const event = this._events[index]; if (!event) return;
    this._detail = event;
    const w = this._words;
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", w.details);
    const start = event.allDay ? event.start : dayKey(new Date(event.start), this._zone);
    const end = event.allDay ? shiftDate(event.end, -1) : dayKey(new Date(event.end), this._zone);
    dialog.innerHTML = `<button class="close" data-close aria-label="${w.close}">✕</button><h3>${escapeHtml(event.summary)}</h3><div class="event-calendar">${escapeHtml(this._name(event.entity))}</div><p>${escapeHtml(this._date(start, { weekday: "long", year: "numeric", month: "long", day: "numeric" }))}${event.allDay && end !== start ? ` – ${escapeHtml(this._date(end, { year: "numeric", month: "long", day: "numeric" }))}` : ""}<br>${escapeHtml(this._when(event))}</p>${this._config.show_location && event.location ? `<p>${escapeHtml(event.location)}</p>` : ""}${this._config.show_description && event.description ? `<p class="notes">${escapeHtml(event.description)}</p>` : ""}`;
    this.shadowRoot.append(dialog); dialog.showModal();
  }
}
class FamalioCalendarCardEditor extends HTMLElement {
  constructor() { super(); this.attachShadow({ mode: "open" }); }
  setConfig(config) { this._config = { ...config }; this._render(); }
  set hass(hass) { this._hass = hass; if (this._form) this._form.hass = hass; else this._render(); }
  connectedCallback() { this._render(); }
  _render() {
    if (!this._config || !this._hass) return;
    const w = WORDS[(this._hass.locale?.language || this._hass.language || "en").split("-")[0]] || WORDS.en;
    const c = normalizeConfig(this._config);
    if (!this._form) {
      this.shadowRoot.innerHTML = `<style>:host{display:block}p{color:var(--secondary-text-color);font-size:14px;line-height:1.5}</style><ha-form></ha-form><p>${escapeHtml(w.note)}</p>`;
      this._form = this.shadowRoot.querySelector("ha-form");
      this._form.addEventListener("value-changed", event => {
        event.stopPropagation();
        let next = { ...this._config, ...event.detail.value };
        if (next.preset !== (this._config.preset || "family")) next = { ...next, ...PRESETS[next.preset] };
        // Keep weekday selectors as strings, but store canonical integers.
        next.weekdays = (next.weekdays || []).map(Number);
        this._config = next;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: next }, bubbles: true, composed: true }));
        this._render();
      });
    }
    const select = (name, options, multiple = false) => ({ name, selector: { select: { options: options.map(value => ({ value, label: w[value] || value })), multiple, mode: "dropdown" } } });
    this._form.hass = this._hass;
    this._form.computeLabel = schema => w[schema.name] || schema.name;
    this._form.schema = [select("preset", Object.keys(PRESETS)), { name: "title", selector: { text: {} } }, { name: "entities", selector: { entity: { domain: "calendar", multiple: true } } }, select("view", ["month", "week", "day", "agenda"]), { name: "days", selector: { number: { min: 1, max: 31, mode: "box" } } }, { name: "weekdays", selector: { select: { multiple: true, options: [1, 2, 3, 4, 5, 6, 0].map(day => ({ value: String(day), label: new Intl.DateTimeFormat(this._hass.locale?.language || "en", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 4 + day))) })) } } }, { name: "include", selector: { text: {} } }, { name: "exclude", selector: { text: {} } }, select("match_field", ["all", "summary"]), select("event_type", ["all", "all_day", "timed"]), select("text_size", ["compact", "normal", "large"]), select("first_day", ["monday", "sunday"]), { name: "color", selector: { text: {} } }, ...["show_navigation", "show_legend", "show_location", "show_description", "show_empty_days", "show_clock"].map(name => ({ name, selector: { boolean: {} } })), { name: "refresh_interval", selector: { number: { min: 60, max: 3600, mode: "box" } } }, { name: "max_events", selector: { number: { min: 1, max: 50, mode: "box" } } }];
    this._form.data = { ...c, weekdays: c.weekdays.map(String) };
  }
}
if (!customElements.get("famalio-calendar-card")) customElements.define("famalio-calendar-card", FamalioCalendarCard);
if (!customElements.get("famalio-calendar-card-editor")) customElements.define("famalio-calendar-card-editor", FamalioCalendarCardEditor);
window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === "famalio-calendar-card")) window.customCards.push({ type: "famalio-calendar-card", name: "Famalio Calendar", description: "Family, wall display and school calendars with independent layout and filters.", preview: true, documentationURL: "https://github.com/fisch192/famalio-home#calendar-on-your-own-dashboard", getEntitySuggestion: (_hass, entity) => entity.startsWith("calendar.") ? { config: { type: "custom:famalio-calendar-card", entities: [entity] } } : null });
export { normalizeConfig, viewRange, normalizeEvent, matchesEvent, overlapsDay, midnight, dayKey };
