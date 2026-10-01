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
export const RULE_SCOPES = ["occurrence", "title", "keyword", "calendar"];
const normalScope = (scope) => (scope === "activity" ? "title" : RULE_SCOPES.includes(scope) ? scope : "title");

/**
 * Builds the template condition for a rule. Every user-controlled string travels
 * base64-encoded in a variable, so titles are never evaluated as templates.
 * Returns null for calendar-wide rules, which need no condition.
 */
export function calendarMatchTemplate(event, scope = "title", keyword = "") {
  scope = normalScope(scope);
  if (scope === "calendar") return null;
  if (scope === "keyword") {
    const needle = String(keyword || "").trim();
    if (!needle) throw new Error("Bitte ein Stichwort eingeben.");
    return {
      template: "{{ (famalio_keyword_b64 | base64_decode | lower) in (trigger.calendar_event.summary | default('') | lower) }}",
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
  return list.map((item) => {
    if (typeof item === "string") {
      if (!/^[a-z_]+\.[a-z0-9_]+$/.test(item)) throw new Error("Ungültige Aktion.");
      return { action: `${item.split(".")[0]}.turn_on`, target: { entity_id: item } };
    }
    const service = item?.action || item?.service;
    if (typeof service !== "string" || !/^[a-z_]+\.[a-z0-9_]+$/.test(service)) throw new Error("Bitte eine Aktion auswählen.");
    const result = { action: service };
    const entities = [].concat(item.target?.entity_id || []).filter((id) => typeof id === "string" && id);
    if (entities.length) result.target = { entity_id: entities.length === 1 ? entities[0] : entities };
    if (item.data && typeof item.data === "object" && !Array.isArray(item.data) && Object.keys(item.data).length) result.data = item.data;
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

export function createCalendarAutomation(event, action, scope, timing, offsetMinutes, keyword = "") {
  scope = normalScope(scope);
  const eventType = timing === "end" || timing.endsWith("_end") ? "ended" : "started";
  const offsetType = timing.startsWith("before") ? "before" : "after";
  const offset = timing === "start" || timing === "end" ? undefined : { minutes: Math.max(1, Math.min(1440, Number(offsetMinutes) || 15)) };
  const trigger = { trigger: `calendar.event_${eventType}`, target: { entity_id: event.entity_id } };
  if (offset) trigger.options = { offset, offset_type: offsetType };
  const match = calendarMatchTemplate(event, scope, keyword);
  const rule = { v: 1, scope };
  if (match) Object.assign(rule, match.variables);
  const label = scope === "calendar" ? (event.calendar_name || "Kalender")
    : scope === "keyword" ? `„${String(keyword).trim()}“` : String(event.summary || "Termin");
  const config = {
    alias: `Famalio · ${label.slice(0, 100)}`,
    description: "Erstellt im Famalio Kalender.",
    mode: "queued",
    max: 10,
    triggers: [trigger],
    conditions: match ? [{ condition: "template", value_template: match.template }] : [],
    variables: { ...(match?.variables || {}), famalio_rule: rule },
    actions: normalizeActions(action),
  };
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
  return rule;
}

export function ruleMatchesEvent(rule, event) {
  if (!rule) return false;
  const summary = String(event.summary || "");
  switch (rule.scope) {
    case "calendar": return true;
    case "keyword": return !!rule.keyword && summary.toLowerCase().includes(rule.keyword.toLowerCase());
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
