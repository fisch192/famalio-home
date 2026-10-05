const base64 = (value) => {
  const bytes = new TextEncoder().encode(String(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};
const unbase64 = (value) => {
  try {
    const binary = atob(String(value || ""));
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch { return ""; }
};

/** Rule scopes offered by the automation builder, broadest last. */
export const RULE_SCOPES = ["occurrence", "title", "keyword", "titles", "description", "location", "all_day", "timed", "calendar", "empty_day"];
const normalScope = (scope) => (scope === "activity" ? "title" : RULE_SCOPES.includes(scope) ? scope : "title");
const lines = (value) => [...new Set(String(value || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
const validTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function normalizeRuleFilters(filters = {}) {
  const result = { zone: filters.zone || "Europe/Rome" };
  // Validate the zone before it reaches a stored rule or the event preview.
  new Intl.DateTimeFormat("en", { timeZone: result.zone });
  result.weekdays = [...new Set(filters.weekdays || [])].map(Number).sort();
  if (result.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error("Bitte gültige Wochentage wählen.");
  result.exclude = lines(filters.exclude);
  if (filters.matchMode) {
    if (!["contains", "starts_with", "ends_with", "not_contains"].includes(filters.matchMode)) throw new Error("Bitte einen Textvergleich auswählen.");
    result.matchMode = filters.matchMode;
  }
  for (const key of ["startAfter", "startBefore", "dailyTime"]) {
    if (filters[key] && !validTime(filters[key])) throw new Error("Bitte gültige Uhrzeiten wählen.");
    if (filters[key]) result[key] = filters[key];
  }
  if (filters.entity) {
    if (!/^[a-z_]+\.[a-z0-9_]+$/.test(filters.entity) || !String(filters.state || "").trim()) throw new Error("Bitte Entität und Zustand wählen.");
    result.entity = filters.entity;
    result.state_b64 = base64(filters.state);
  }
  return result;
}

/** Extra filters use the event's start, not the offset trigger's firing time. */
function filterTemplate(filters, daily = false) {
  const clauses = [];
  const start = daily ? "now()" : "(strptime(trigger.calendar_event.start, '%Y-%m-%d') if trigger.calendar_event.start | string | length == 10 else (as_datetime(trigger.calendar_event.start) | as_local))";
  if (filters.weekdays.length) clauses.push(`${start}.weekday() in famalio_filters.weekdays`);
  if (!daily) {
    const clock = `${start}.strftime('%H:%M')`;
    if (filters.startAfter && filters.startBefore && filters.startAfter > filters.startBefore) {
      clauses.push(`(${clock} >= famalio_filters.startAfter or ${clock} < famalio_filters.startBefore)`);
    } else {
      if (filters.startAfter) clauses.push(`${clock} >= famalio_filters.startAfter`);
      if (filters.startBefore) clauses.push(`${clock} < famalio_filters.startBefore`);
    }
    filters.exclude.forEach((_value, index) => clauses.push(`(famalio_filters.exclude_b64[${index}] | base64_decode | lower) not in (trigger.calendar_event.summary | default('', true) | lower)`));
  }
  if (filters.entity) clauses.push("states(famalio_filters.entity) == (famalio_filters.state_b64 | base64_decode)");
  return clauses.length ? { condition: "template", value_template: `{{ ${clauses.join(" and ")} }}` } : null;
}

/**
 * Builds the template condition for a rule. Every user-controlled string travels
 * base64-encoded in a variable, so titles are never evaluated as templates.
 * Returns null for calendar-wide rules, which need no condition.
 */
export function calendarMatchTemplate(event, scope = "title", keyword = "", matchMode = "contains") {
  scope = normalScope(scope);
  if (scope === "calendar" || scope === "empty_day") return null;
  if (scope === "all_day" || scope === "timed") return {
    template: `{{ (trigger.calendar_event.start | string | length == 10) ${scope === "all_day" ? "== true" : "== false"} }}`, variables: {},
  };
  if (scope === "titles") {
    const titles = lines(keyword);
    if (!titles.length) throw new Error("Bitte mindestens einen Titel eingeben.");
    return { template: "{{ (trigger.calendar_event.summary | default('', true) | lower) in (famalio_titles_b64 | base64_decode | from_json | map('lower') | list) }}",
      variables: { famalio_titles_b64: base64(JSON.stringify(titles)) } };
  }
  if (["keyword", "description", "location"].includes(scope)) {
    const needle = String(keyword || "").trim();
    if (!needle) throw new Error("Bitte ein Stichwort eingeben.");
    const haystack = `(trigger.calendar_event.${scope === "keyword" ? "summary" : scope} | default('', true) | lower)`;
    const needleTemplate = "(famalio_keyword_b64 | base64_decode | lower)";
    const clause = matchMode === "starts_with" ? `${haystack}.startswith(${needleTemplate})`
      : matchMode === "ends_with" ? `${haystack}.endswith(${needleTemplate})`
      : `${needleTemplate} ${matchMode === "not_contains" ? "not in" : "in"} ${haystack}`;
    return {
      template: `{{ ${clause} }}`,
      variables: { famalio_keyword_b64: base64(needle) },
    };
  }
  const clauses = ["trigger.calendar_event.summary == (famalio_summary_b64 | base64_decode)"];
  const variables = { famalio_summary_b64: base64(event.summary || "") };
  if (scope === "occurrence") {
    if (event.uid) {
      clauses.push("trigger.calendar_event.uid is defined and trigger.calendar_event.uid == (famalio_uid_b64 | base64_decode)");
      variables.famalio_uid_b64 = base64(event.uid);
    }
    if (event.all_day) {
      clauses.push("trigger.calendar_event.start == famalio_start");
      variables.famalio_start = String(event.start).slice(0, 10);
    } else {
      clauses.push("as_timestamp(trigger.calendar_event.start) == as_timestamp(famalio_start)");
      variables.famalio_start = new Date(event.start).toISOString();
    }
  }
  return { template: `{{ ${clauses.join(" and ")} }}`, variables };
}

/**
 * Normalizes the builder's action into HA action objects. A bare entity id keeps
 * the original scene/script shortcut; objects are any HA service call.
 */
export function normalizeActions(action) {
  const list = Array.isArray(action) ? action : [action];
  if (!list.length) throw new Error("Bitte eine Aktion auswählen.");
  return list.map((item) => {
    if (typeof item === "string") {
      if (!/^[a-z_]+\.[a-z0-9_]+$/.test(item)) throw new Error("Ungültige Aktion.");
      const domain = item.split(".")[0];
      return { action: domain === "automation" ? "automation.trigger" : `${domain}.turn_on`, target: { entity_id: item },
        ...(domain === "automation" ? { data: { skip_condition: false } } : {}) };
    }
    const service = item?.action || item?.service;
    if (typeof service !== "string" || !/^[a-z_]+\.[a-z0-9_]+$/.test(service)) throw new Error("Bitte eine Aktion auswählen.");
    const result = { action: service };
    const entities = [].concat(item.target?.entity_id || []).filter((id) => typeof id === "string" && id);
    if (entities.length) result.target = { entity_id: entities.length === 1 ? entities[0] : entities };
    for (const key of ["area_id", "device_id", "label_id", "floor_id"]) {
      if (item.target?.[key]) (result.target ||= {})[key] = item.target[key];
    }
    if (item.data && typeof item.data === "object" && !Array.isArray(item.data) && Object.keys(item.data).length) result.data = item.data;
    if (service === "automation.trigger") result.data = { skip_condition: false, ...(result.data || {}) };
    return result;
  });
}

/** Parses the optional JSON/YAML-lite data field of the builder. */
export function parseActionData(text) {
  const value = String(text || "").trim();
  if (!value) return {};
  let parsed;
  try { parsed = JSON.parse(value); } catch {
    parsed = {};
    for (const line of value.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*(.*)$/);
      if (!match) throw new Error("Daten als JSON oder als einfache Zeilen „schlüssel: wert“ eingeben.");
      const raw = match[2].trim();
      let item = raw.replace(/^(["'])(.*)\1$/, "$2");
      if (/^-?\d+(\.\d+)?$/.test(raw)) item = Number(raw);
      else if (raw === "true" || raw === "false") item = raw === "true";
      parsed[match[1]] = item;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Daten müssen ein Objekt sein.");
  return parsed;
}

export function createCalendarAutomation(event, action, scope, timing, offsetMinutes, keyword = "", filters = {}) {
  scope = normalScope(scope);
  if (!/^calendar\.[a-z0-9_]+$/.test(event.entity_id)) throw new Error("Bitte einen Kalender auswählen.");
  if (!["start", "end", "before_start", "after_start", "before_end", "after_end"].includes(timing)) throw new Error("Bitte einen Zeitpunkt auswählen.");
  const normalized = normalizeRuleFilters(filters);
  const storedFilters = { ...normalized, exclude_b64: normalized.exclude.map(base64) };
  delete storedFilters.exclude;
  const eventType = timing === "end" || timing.endsWith("_end") ? "ended" : "started";
  const offsetType = timing.startsWith("before") ? "before" : "after";
  const offset = timing === "start" || timing === "end" ? undefined : { minutes: Math.max(1, Math.min(1440, Number(offsetMinutes) || 15)) };
  const trigger = { trigger: `calendar.event_${eventType}`, target: { entity_id: event.entity_id } };
  if (offset) trigger.options = { offset, offset_type: offsetType };
  const match = calendarMatchTemplate(event, scope, keyword, normalized.matchMode);
  const rule = { v: 2, scope, calendar_id: event.entity_id, filters: storedFilters };
  if (match) Object.assign(rule, match.variables);
  const label = scope === "calendar" ? (event.calendar_name || "Kalender") : scope === "empty_day" ? "Tag ohne Termine"
    : ["keyword", "titles", "description", "location"].includes(scope) ? `„${String(keyword).trim()}“` : String(event.summary || "Termin");
  const extra = filterTemplate(normalized, scope === "empty_day");
  const config = {
    alias: `Famalio · ${label.slice(0, 100)}`,
    description: "Erstellt im Famalio Kalender.",
    mode: "queued",
    max: 10,
    triggers: [trigger],
    conditions: [...(match ? [{ condition: "template", value_template: match.template }] : []), ...(extra ? [extra] : [])],
    variables: { ...(match?.variables || {}), famalio_rule: rule, famalio_filters: storedFilters },
    actions: normalizeActions(action),
  };
  if (scope === "empty_day") {
    config.triggers = [{ trigger: "time", at: normalized.dailyTime || "07:00" }];
    config.actions.unshift(
      { action: "calendar.get_events", target: { entity_id: event.entity_id }, data: {
        start_date_time: "{{ today_at('00:00').isoformat() }}",
        end_date_time: "{{ (today_at('00:00') + timedelta(days=1)).isoformat() }}",
      }, response_variable: "famalio_day" },
      { condition: "template", value_template: "{{ has_value(famalio_rule.calendar_id) and famalio_day is defined and famalio_rule.calendar_id in famalio_day and famalio_day[famalio_rule.calendar_id].events is defined and (famalio_day[famalio_rule.calendar_id].events | length == 0) }}" },
    );
  }
  return config;
}

export function automationCalendarIDs(config, calendarIDs) {
  const known = new Set(calendarIDs);
  const matches = new Set();
  const visit = (value) => {
    for (const trigger of Array.isArray(value) ? value : value ? [value] : []) {
      if (trigger.triggers) visit(trigger.triggers);
      const type = trigger.trigger || trigger.platform;
      if (!["calendar", "calendar.event_started", "calendar.event_ended"].includes(type)) continue;
      const targets = trigger.target?.entity_id || trigger.entity_id;
      for (const id of Array.isArray(targets) ? targets : [targets]) if (known.has(id)) matches.add(id);
    }
  };
  visit(config?.triggers || config?.trigger);
  const meta = config?.variables?.famalio_rule;
  if (meta?.scope === "empty_day" && known.has(meta.calendar_id)
    && [].concat(config?.actions || config?.action || []).some((a) => a.action === "calendar.get_events" && a.target?.entity_id === meta.calendar_id)) matches.add(meta.calendar_id);
  return [...matches];
}

/**
 * Describes which events a stored automation targets. Rules created here carry
 * `famalio_rule`; older Famalio rules are recognized from their variables; any
 * other calendar-triggered rule without conditions covers the whole calendar.
 * Unknown condition shapes return null, so the UI never claims a false match.
 */
export function automationRule(config) {
  const vars = config?.variables || {};
  const meta = vars.famalio_rule && typeof vars.famalio_rule === "object" ? vars.famalio_rule : null;
  const pick = (key) => meta?.[key] ?? vars[key];
  const scope = meta?.scope
    || (vars.famalio_keyword_b64 ? "keyword" : vars.famalio_start ? "occurrence" : vars.famalio_summary_b64 ? "title" : null);
  const conditions = [].concat(config?.conditions || config?.condition || []);
  if (!scope) return conditions.length ? null : { scope: "calendar" };
  const rule = { scope: normalScope(scope) };
  if (pick("famalio_summary_b64")) rule.summary = unbase64(pick("famalio_summary_b64"));
  if (pick("famalio_keyword_b64")) rule.keyword = unbase64(pick("famalio_keyword_b64"));
  if (pick("famalio_uid_b64")) rule.uid = unbase64(pick("famalio_uid_b64"));
  if (pick("famalio_start")) rule.start = String(pick("famalio_start"));
  if (pick("famalio_titles_b64")) {
    try { rule.titles = JSON.parse(unbase64(pick("famalio_titles_b64"))); } catch { return null; }
  }
  if (meta?.filters) rule.filters = { ...meta.filters, exclude: (meta.filters.exclude_b64 || []).map(unbase64) };
  return rule;
}

export function ruleMatchesEvent(rule, event) {
  if (!scopeMatchesEvent(rule, event)) return false;
  const filters = rule.filters;
  if (!filters) return true;
  if (filters.exclude?.some((word) => String(event.summary || "").toLowerCase().includes(word.toLowerCase()))) return false;
  if (filters.weekdays?.length || filters.startAfter || filters.startBefore) {
    let day, clock;
    if (event.all_day || /^\d{4}-\d{2}-\d{2}$/.test(event.start)) {
      day = (new Date(`${String(event.start).slice(0, 10)}T12:00:00Z`).getUTCDay() + 6) % 7; clock = "00:00";
    } else {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: filters.zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(event.start));
      const get = (type) => parts.find((p) => p.type === type).value;
      day = (new Date(`${get("year")}-${get("month")}-${get("day")}T12:00:00Z`).getUTCDay() + 6) % 7;
      clock = `${get("hour")}:${get("minute")}`;
    }
    if (filters.weekdays?.length && !filters.weekdays.includes(day)) return false;
    if (filters.startAfter && filters.startBefore && filters.startAfter > filters.startBefore) {
      if (!(clock >= filters.startAfter || clock < filters.startBefore)) return false;
    } else if ((filters.startAfter && clock < filters.startAfter) || (filters.startBefore && clock >= filters.startBefore)) return false;
  }
  return true;
}

function scopeMatchesEvent(rule, event) {
  if (!rule) return false;
  const summary = String(event.summary || "");
  switch (rule.scope) {
    case "calendar": return true;
    case "keyword": case "description": case "location": {
      if (!rule.keyword) return false;
      const text = String(rule.scope === "keyword" ? summary : event[rule.scope] || "").toLowerCase();
      const word = rule.keyword.toLowerCase();
      switch (rule.filters?.matchMode) {
        case "starts_with": return text.startsWith(word);
        case "ends_with": return text.endsWith(word);
        case "not_contains": return !text.includes(word);
        default: return text.includes(word);
      }
    }
    case "titles": return rule.titles?.some((title) => title.toLowerCase() === summary.toLowerCase()) || false;
    case "all_day": return !!event.all_day || /^\d{4}-\d{2}-\d{2}$/.test(event.start);
    case "timed": return !event.all_day && !/^\d{4}-\d{2}-\d{2}$/.test(event.start);
    case "title": return rule.summary === summary;
    case "occurrence": {
      if (rule.summary !== undefined && rule.summary !== summary) return false;
      if (rule.uid && event.uid && rule.uid !== event.uid) return false;
      if (!rule.start) return false;
      if (event.all_day) return String(event.start).slice(0, 10) === rule.start.slice(0, 10);
      return new Date(event.start).getTime() === new Date(rule.start).getTime();
    }
    default: return false;
  }
}

/** HA calendar feature bits (CalendarEntityFeature). */
export const FEATURE = { CREATE: 1, DELETE: 2, UPDATE: 4 };
export const canWrite = (state, bit) => (Number(state?.attributes?.supported_features) & bit) === bit;

/**
 * Converts editor fields into HA's calendar/event WS payload. Timed values are
 * wall-clock times in the HA zone, sent with an explicit offset.
 */
export function zoneOffsetMinutes(instant, zone) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(instant);
  const get = (type) => Number(parts.find((part) => part.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((wall - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** Wall-clock date+time in `zone` as an ISO string with the correct offset (DST aware). */
export function zonedISO(date, time, zone = "UTC") {
  const [y, m, d] = date.split("-").map(Number); const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let offset = zoneOffsetMinutes(new Date(guess), zone);
  offset = zoneOffsetMinutes(new Date(guess - offset * 60000), zone);
  const sign = offset >= 0 ? "+" : "-"; const abs = Math.abs(offset);
  return `${date}T${time}:00${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function editorEvent({ summary, allDay, startDate, startTime, endDate, endTime, description, location }, zone = "UTC") {
  const title = String(summary || "").trim();
  if (!title) throw new Error("Bitte einen Titel eingeben.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || "") || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || "")) throw new Error("Bitte gültige Daten wählen.");
  const event = { summary: title };
  if (allDay) {
    if (endDate < startDate) throw new Error("Das Ende liegt vor dem Beginn.");
    const end = new Date(`${endDate}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1);
    event.dtstart = startDate; event.dtend = end.toISOString().slice(0, 10);
  } else {
    if (!/^\d{2}:\d{2}$/.test(startTime || "") || !/^\d{2}:\d{2}$/.test(endTime || "")) throw new Error("Bitte gültige Uhrzeiten wählen.");
    const start = `${startDate}T${startTime}:00`; const end = `${endDate}T${endTime}:00`;
    if (end <= start) throw new Error("Das Ende muss nach dem Beginn liegen.");
    event.dtstart = zonedISO(startDate, startTime, zone); event.dtend = zonedISO(endDate, endTime, zone);
  }
  if (String(description || "").trim()) event.description = String(description).trim();
  if (String(location || "").trim()) event.location = String(location).trim();
  return event;
}
