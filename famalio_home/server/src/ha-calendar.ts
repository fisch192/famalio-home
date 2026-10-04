import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Auth, Principal } from './auth.ts';
import type { Db, Tx } from './db.ts';
import { transaction } from './db.ts';
import { ApiError, accessDenied, authRequired, invalidInput, notFound } from './errors.ts';
import type { Request } from './http.ts';
import type { Records } from './records.ts';
import { hashSecret, newSecret, parseSecret } from './secrets.ts';

const FAMILY_CALENDAR = 'family';
const MAX_GRANT_CALENDARS = 30;
const MAX_GRANT_DAYS = 90;
const MAX_CALENDAR_ROWS = 5000;
const MAX_PROJECTED_EVENTS = 2000;
const APPLE_EPOCH_SECONDS = 978_307_200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_TTL_MS = 15 * 60_000;
const MAX_PENDING_REQUESTS = 5;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
type Projection = 'full' | 'busy';
type Access = 'read' | 'write';
type GrantInput = { label: string; projection: Projection; maxDays: number; calendarNames: string[]; access: Access };
type CalendarRow = { id: string; name: string; color: string | null };
type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function field(fields: Record<string, any>, name: string): unknown { return fields[name]?.value; }

function localParts(date: Date, zone: string): Parts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day),
    hour: Number(value.hour), minute: Number(value.minute), second: Number(value.second) };
}

function dateKey(p: Parts): string { return `${p.year.toString().padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; }
function dayNumber(p: Parts): number { return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000); }
function fromDayNumber(day: number): Parts {
  const date = new Date(day * 86_400_000);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: 0, minute: 0, second: 0 };
}

/** Resolve a wall time in an IANA zone, preferring the earlier fold and moving
 * nonexistent spring-forward times to the first valid local minute after the gap. */
export function resolveLocalWallTime(p: Parts, zone: string): Date {
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const candidates = new Set<number>();
  for (let h = -36; h <= 36; h += 3) {
    const probe = new Date(wall + h * 3_600_000);
    const q = localParts(probe, zone);
    const offset = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) - probe.getTime();
    candidates.add(wall - offset);
  }
  const ordered = [...candidates].sort((a, b) => a - b);
  const exact = ordered.find((stamp) => {
    const q = localParts(new Date(stamp), zone);
    return q.year === p.year && q.month === p.month && q.day === p.day
      && q.hour === p.hour && q.minute === p.minute && q.second === p.second;
  });
  if (exact !== undefined) return new Date(exact);
  const targetMinutes = p.hour * 60 + p.minute;
  const lower = Math.min(...ordered);
  const upper = Math.max(...ordered);
  for (let stamp = lower; stamp <= upper; stamp += 60_000) {
    const q = localParts(new Date(stamp), zone);
    if (q.year === p.year && q.month === p.month && q.day === p.day
      && q.hour * 60 + q.minute >= targetMinutes && q.second === p.second) return new Date(stamp);
  }
  throw invalidInput('Could not resolve event wall time in requested timezone');
}

const zonedDate = resolveLocalWallTime;

function isoInstant(value: string | null): Date {
  if (!value || !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value)) throw invalidInput('Expected an ISO date-time with an explicit offset');
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw invalidInput();
  return result;
}

function validZone(zone: string | null): string {
  const value = zone ?? 'UTC';
  if (value.length > 64) throw invalidInput('Invalid timezone');
  try { new Intl.DateTimeFormat('en', { timeZone: value }); } catch { throw invalidInput('Invalid timezone'); }
  return value;
}

function frequencyMatch(recurrence: Record<string, any>, start: Parts, day: Parts): boolean {
  const freq = recurrence.frequency;
  const interval = Number.isInteger(recurrence.interval) ? Math.max(1, recurrence.interval) : 1;
  const deltaDays = dayNumber(day) - dayNumber(start);
  if (deltaDays < 0) return false;
  if (freq === 'daily') return deltaDays % interval === 0;
  if (freq === 'weekly') {
    const monday = recurrence.weekStartOnMonday !== false;
    const startWeekday = new Date(dayNumber(start) * 86_400_000).getUTCDay();
    const targetWeekday = new Date(dayNumber(day) * 86_400_000).getUTCDay();
    const weekOffset = (weekday: number) => (weekday - (monday ? 1 : 0) + 7) % 7;
    const weeks = Math.floor((deltaDays + weekOffset(startWeekday) - weekOffset(targetWeekday)) / 7);
    if (weeks < 0 || weeks % interval !== 0) return false;
    const weekdays = recurrence.byWeekday;
    return Array.isArray(weekdays) && weekdays.length > 0
      ? weekdays.includes(targetWeekday === 0 ? 1 : targetWeekday + 1)
      : targetWeekday === startWeekday;
  }
  if (freq === 'monthly') {
    const deltaMonths = (day.year - start.year) * 12 + day.month - start.month;
    if (deltaMonths < 0 || deltaMonths % interval !== 0) return false;
    const monthDays = recurrence.byMonthDay;
    return Array.isArray(monthDays) && monthDays.length > 0 ? monthDays.includes(day.day) : day.day === start.day;
  }
  if (freq === 'yearly') return (day.year - start.year) >= 0 && (day.year - start.year) % interval === 0 && day.month === start.month && day.day === start.day;
  throw new ApiError(422, 'UNSUPPORTED_RECURRENCE', 'This recurrence pattern cannot be projected safely');
}

function isOccurrence(recurrence: Record<string, any>, start: Parts, candidate: Parts, startStamp: number, zone: string): boolean {
  if (!frequencyMatch(recurrence, start, candidate)) return false;
  const candidateDate = zonedDate(candidate, zone);
  if (typeof recurrence.until === 'number') {
    const until = localParts(new Date((recurrence.until + APPLE_EPOCH_SECONDS) * 1000), zone);
    if (dayNumber(candidate) > dayNumber(until)) return false;
  }
  const exceptions = Array.isArray(recurrence.exceptions) ? recurrence.exceptions : [];
  if (exceptions.some((item: unknown) => typeof item === 'number'
    && dayNumber(localParts(new Date((item + APPLE_EPOCH_SECONDS) * 1000), zone)) === dayNumber(candidate))) return false;
  if (Number.isInteger(recurrence.count)) {
    const count = Number(recurrence.count);
    if (count <= 0) return false;
    const startDay = dayNumber(start);
    const candDay = dayNumber(candidate);
    let used = 0;
    for (let n = startDay; n < candDay; n += 1) {
      if (frequencyMatch(recurrence, start, fromDayNumber(n))) used += 1;
      if (used >= count) return false;
    }
  }
  return candidateDate.getTime() >= startStamp;
}

function decodePayload(fields: any): Record<string, any> {
  const encoded = field(fields, 'payload');
  if (typeof encoded !== 'string') throw new ApiError(422, 'INVALID_EVENT', 'Calendar event payload is invalid');
  try { return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')); }
  catch { throw new ApiError(422, 'INVALID_EVENT', 'Calendar event payload is invalid'); }
}

function eventOccurrences(row: any, start: Date, end: Date, zone: string, projection: Projection): any[] {
  const payload = decodePayload(row.fields);
  if (payload.isMemo === true) return [];
  if (typeof payload.startDate !== 'number' || typeof payload.endDate !== 'number' || payload.endDate < payload.startDate) {
    throw new ApiError(422, 'INVALID_EVENT', 'Calendar event date range is invalid');
  }
  const startStamp = (payload.startDate + APPLE_EPOCH_SECONDS) * 1000;
  const endStamp = (payload.endDate + APPLE_EPOCH_SECONDS) * 1000;
  const localStart = localParts(new Date(startStamp), zone);
  const durationMs = Math.max(60_000, endStamp - startStamp);
  const isAllDay = payload.isAllDay === true;
  const recurrence = payload.recurrence == null ? null : object(payload.recurrence);
  const rangeStart = localParts(start, zone);
  const rangeEnd = localParts(end, zone);
  const durationDays = Math.max(1, Math.ceil((endStamp - startStamp) / 86_400_000) + 1);
  const firstDay = Math.max(dayNumber(rangeStart) - durationDays, dayNumber(localStart));
  const lastDay = dayNumber(rangeEnd) + 1;

  if (!recurrence) {
    const eventStart = isAllDay ? zonedDate({ ...localStart, hour: 0, minute: 0, second: 0 }, zone) : new Date(startStamp);
    const endLocalDay = dayNumber(localParts(new Date(endStamp), zone));
    const imported = typeof payload.sharedBy === 'string' && payload.sharedBy.length > 0;
    const endIsMidnight = localParts(new Date(endStamp), zone).hour === 0
      && localParts(new Date(endStamp), zone).minute === 0 && localParts(new Date(endStamp), zone).second === 0;
    const allDayEndDay = imported && endIsMidnight ? endLocalDay : endLocalDay + 1;
    const eventEnd = isAllDay
      ? zonedDate({ ...fromDayNumber(allDayEndDay), hour: 0, minute: 0, second: 0 }, zone)
      : new Date(endStamp);
    if (eventStart >= end || eventEnd <= start) return [];
    return [projectEvent(row.name, payload, eventStart, eventEnd, isAllDay, projection, zone, false)];
  }

  const events = [];
  for (let day = firstDay; day < lastDay; day += 1) {
    const candidate = { ...fromDayNumber(day), hour: localStart.hour, minute: localStart.minute, second: localStart.second };
    if (!isOccurrence(recurrence, localStart, candidate, startStamp, zone)) continue;
    let eventStart: Date;
    let eventEnd: Date;
    if (isAllDay) {
      eventStart = zonedDate({ ...candidate, hour: 0, minute: 0, second: 0 }, zone);
      eventEnd = zonedDate({ ...fromDayNumber(day + 1), hour: 0, minute: 0, second: 0 }, zone);
    } else {
      eventStart = zonedDate(candidate, zone);
      eventEnd = new Date(eventStart.getTime() + (durationMs > 60_000 ? durationMs : 3_600_000));
    }
    if (eventStart < end && eventEnd > start) events.push(projectEvent(row.name, payload, eventStart, eventEnd, isAllDay, projection, zone, true));
  }
  return events;
}

function projectEvent(recordName: string, payload: Record<string, any>, start: Date, end: Date, allDay: boolean, projection: Projection, zone: string, recurring: boolean) {
  const common = { uid: recordName, start: allDay ? dateKey(localParts(start, zone)) : start.toISOString(), end: allDay ? dateKey(localParts(end, zone)) : end.toISOString() };
  if (projection === 'busy') return { ...common, title: 'Busy' };
  // Editing hints for HA write grants: series and imported mirrors stay app-only.
  const flags = { ...(recurring ? { recurring: true } : {}), ...(typeof payload.sharedBy === 'string' && payload.sharedBy ? { read_only: true } : {}) };
  return { ...common, ...flags, title: String(payload.title ?? 'Event'), ...(typeof payload.notes === 'string' && payload.notes ? { description: payload.notes } : {}),
    ...(typeof payload.location === 'string' && payload.location ? { location: payload.location } : {}) };
}

function grantInput(body: Record<string, unknown>): GrantInput {
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  const projection = body.projection;
  const maxDays = body.max_days;
  const calendarNames = body.calendar_ids;
  const access = body.access ?? 'read';
  if (!label || label.length > 80 || (projection !== 'full' && projection !== 'busy')
    || (access !== 'read' && access !== 'write') || (access === 'write' && projection !== 'full')
    || !Number.isInteger(maxDays) || (maxDays as number) < 1 || (maxDays as number) > MAX_GRANT_DAYS
    || !Array.isArray(calendarNames) || calendarNames.length < 1 || calendarNames.length > MAX_GRANT_CALENDARS
    || new Set(calendarNames).size !== calendarNames.length
    || !calendarNames.every((name) => typeof name === 'string' && (name === FAMILY_CALENDAR || /^calendar-[0-9a-f-]{36}$/i.test(name)))) throw invalidInput();
  return { label, projection, maxDays: maxDays as number, calendarNames: calendarNames as string[], access };
}

function requestCode(): string {
  const pick = () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${Array.from({ length: 4 }, pick).join('')}-${Array.from({ length: 4 }, pick).join('')}`;
}

function appleSeconds(date: Date): number { return date.getTime() / 1000 - APPLE_EPOCH_SECONDS; }

function dayKey(value: unknown): Parts {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) throw invalidInput('Expected an all-day date YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw invalidInput('Invalid date');
  return { year, month, day, hour: 0, minute: 0, second: 0 };
}

function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > max) throw invalidInput();
  return value.trim() || undefined;
}

/** Converts HA's calendar event shape into the fields owned by the Famalio event payload. */
export function eventWriteFields(bodyRaw: unknown, zone: string): { title: string; startDate: number; endDate: number; isAllDay: boolean; notes?: string; location?: string; start: Date } {
  const body = object(bodyRaw);
  const title = typeof body.summary === 'string' ? body.summary.trim() : '';
  if (!title || title.length > 1000) throw invalidInput('A title is required');
  const allDay = body.all_day === true;
  let start: Date;
  let last: Date;
  if (allDay) {
    const first = dayKey(body.start);
    const endExclusive = dayKey(body.end);
    const days = dayNumber(endExclusive) - dayNumber(first);
    if (days < 1 || days > 366) throw invalidInput('All-day events end after their start day');
    start = resolveLocalWallTime(first, zone);
    // Famalio stores the last covered day; the server projects the exclusive end.
    last = resolveLocalWallTime(fromDayNumber(dayNumber(endExclusive) - 1), zone);
  } else {
    start = isoInstant(typeof body.start === 'string' ? body.start : null);
    last = isoInstant(typeof body.end === 'string' ? body.end : null);
    if (last <= start || last.getTime() - start.getTime() > 366 * 86_400_000) throw invalidInput('Events end after they start');
  }
  return { title, startDate: appleSeconds(start), endDate: appleSeconds(last), isAllDay: allDay,
    notes: optionalText(body.description, 10_000), location: optionalText(body.location, 1000), start };
}

export class HomeAssistantCalendar {
  private readonly db: Db;
  private readonly auth: Auth;
  private readonly records: Records;

  constructor(db: Db, auth: Auth, records: Records) {
    this.db = db;
    this.auth = auth;
    this.records = records;
  }

  async create(principal: Principal, bodyRaw: unknown) {
    if (principal.role !== 'owner') throw accessDenied();
    const body = object(bodyRaw);
    const input = grantInput(body);
    const token = newSecret('fhi');
    return transaction(this.db, async (tx) => {
      await this.auth.consumeConfirmation(tx, principal, body.confirmation_token, 'ha_grant_create');
      const id = await this.insertGrant(tx, principal, input, hashSecret(token));
      return { integration_id: id, label: input.label, projection: input.projection, max_days: input.maxDays,
        calendar_ids: input.calendarNames, access: input.access, integration_token: token };
    });
  }

  private async insertGrant(tx: Tx, principal: Principal, input: GrantInput, tokenHash: Buffer): Promise<string> {
    const actor = await tx.query("select 1 from famalio.subjects where id=$1 and family_id=$2 and role='owner' and removed_at is null for update", [principal.subjectId, principal.familyId]);
    if (!actor.rowCount) throw accessDenied();
    const available = await this.availableCalendars(tx, principal.familyId);
    if (!input.calendarNames.every((name) => available.some((calendar) => calendar.id === name))) throw invalidInput('Grant can include only existing family calendars');
    const instance = await tx.query('select recovery_epoch from famalio.instance');
    if (!instance.rows[0]) throw new ApiError(503, 'UNAVAILABLE', 'Instance not initialised');
    const id = randomUUID();
    await tx.query(
      `insert into famalio.ha_integrations(id,family_id,created_by_subject_id,recovery_epoch,label,projection,max_days,calendar_names,token_hash,access)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, principal.familyId, principal.subjectId, instance.rows[0].recovery_epoch, input.label, input.projection, input.maxDays, input.calendarNames, tokenHash, input.access]);
    await this.audit(tx, principal, input.access === 'write' ? 'ha_grant.created_write' : 'ha_grant.created');
    return id;
  }

  async list(principal: Principal) {
    if (principal.role !== 'owner') throw accessDenied();
    const { rows } = await this.db.query(
      'select id,label,projection,max_days,calendar_names,access,created_at,revoked_at from famalio.ha_integrations where family_id=$1 order by created_at', [principal.familyId]);
    return { integrations: rows.map((row) => ({ integration_id: row.id, label: row.label, projection: row.projection,
      max_days: row.max_days, calendar_ids: row.calendar_names, access: row.access, created_at: new Date(row.created_at).toISOString(),
      revoked: row.revoked_at !== null })) };
  }

  async revoke(principal: Principal, integrationId: string, bodyRaw: unknown): Promise<void> {
    if (principal.role !== 'owner' || !UUID.test(integrationId)) throw accessDenied();
    await transaction(this.db, async (tx) => {
      await this.auth.consumeConfirmation(tx, principal, object(bodyRaw).confirmation_token, 'ha_grant_revoke', integrationId.toLowerCase());
      const actor = await tx.query("select 1 from famalio.subjects where id=$1 and family_id=$2 and role='owner' and removed_at is null for update", [principal.subjectId, principal.familyId]);
      if (!actor.rowCount) throw accessDenied();
      const result = await tx.query(
        'update famalio.ha_integrations set revoked_at=coalesce(revoked_at,now()) where id=$1 and family_id=$2 returning id', [integrationId, principal.familyId]);
      if (!result.rowCount) throw notFound();
      await this.audit(tx, principal, 'ha_grant.revoked');
    });
  }

  // ---- Connection requests: the HA app asks, the owner approves in Famalio ----

  /** POST /v1/ha/connection-requests (unauthenticated, rate limited). */
  async requestConnection(request: Request) {
    this.auth.limiter.check(`ha-request:${request.remoteAddress}`);
    const body = object(request.body);
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 80) : 'Home Assistant';
    const owner = await this.db.query("select 1 from famalio.subjects where role='owner' and removed_at is null limit 1");
    if (!owner.rowCount) throw new ApiError(409, 'OWNER_SETUP_REQUIRED', 'Set up Famalio Home in the app first');
    const claim = newSecret('fhq');
    const id = randomUUID();
    const code = requestCode();
    return transaction(this.db, async (tx) => {
      await tx.query('select pg_advisory_xact_lock(4242002)');
      await tx.query("delete from famalio.ha_connection_requests where expires_at < now() - interval '1 day'");
      const pending = await tx.query("select count(*)::int as n from famalio.ha_connection_requests where state='pending' and expires_at>now()");
      if (pending.rows[0].n >= MAX_PENDING_REQUESTS) throw new ApiError(429, 'RATE_LIMITED', 'Too many open connection requests');
      const { rows } = await tx.query(
        `insert into famalio.ha_connection_requests(id,label,code,claim_hash,expires_at) values($1,$2,$3,$4,now()+make_interval(secs=>$5)) returning expires_at`,
        [id, label, code, hashSecret(claim), REQUEST_TTL_MS / 1000]);
      await tx.query('insert into famalio.audit_log(action) values($1)', ['ha_request.created']);
      return { request_id: id, code, label, state: 'pending', expires_at: new Date(rows[0].expires_at).toISOString(), claim_secret: claim };
    });
  }

  /** GET /v1/owner/ha-connection-requests: open requests awaiting the owner. */
  async pendingConnections(principal: Principal) {
    if (principal.role !== 'owner') throw accessDenied();
    const { rows } = await this.db.query(
      "select id,label,code,created_at,expires_at from famalio.ha_connection_requests where state='pending' and expires_at>now() order by created_at");
    const calendars = await this.availableCalendars(this.db, principal.familyId);
    return { requests: rows.map((row) => ({ request_id: row.id, label: row.label, code: row.code,
      created_at: new Date(row.created_at).toISOString(), expires_at: new Date(row.expires_at).toISOString() })),
      calendars: calendars.map((calendar) => ({ calendar_id: calendar.id, name: calendar.name, color: calendar.color })) };
  }

  /** POST /v1/owner/ha-connection-requests/{id}/approve (owner + fresh confirmation). */
  async approveConnection(principal: Principal, requestId: string, bodyRaw: unknown) {
    if (principal.role !== 'owner' || !UUID.test(requestId)) throw accessDenied();
    const body = object(bodyRaw);
    const input = grantInput({ label: 'Home Assistant', ...body });
    return transaction(this.db, async (tx) => {
      await this.auth.consumeConfirmation(tx, principal, body.confirmation_token, 'ha_grant_create');
      const { rows } = await tx.query(
        "select label from famalio.ha_connection_requests where id=$1 and state='pending' and expires_at>now() for update", [requestId]);
      if (!rows[0]) throw notFound();
      // Unusable random hash until the requester claims it; no plaintext token is stored.
      const integrationId = await this.insertGrant(tx, principal, { ...input, label: body.label === undefined ? rows[0].label : input.label }, randomBytes(32));
      await tx.query("update famalio.ha_connection_requests set state='approved', family_id=$2, integration_id=$3 where id=$1",
        [requestId, principal.familyId, integrationId]);
      return { request_id: requestId, integration_id: integrationId, state: 'approved', access: input.access };
    });
  }

  /** POST /v1/owner/ha-connection-requests/{id}/deny */
  async denyConnection(principal: Principal, requestId: string): Promise<void> {
    if (principal.role !== 'owner' || !UUID.test(requestId)) throw accessDenied();
    const result = await this.db.query("update famalio.ha_connection_requests set state='denied' where id=$1 and state='pending' returning id", [requestId]);
    if (!result.rowCount) throw notFound();
    await this.db.query('insert into famalio.audit_log(family_id,subject_id,device_id,action) values($1,$2,$3,$4)',
      [principal.familyId, principal.subjectId, principal.deviceId, 'ha_request.denied']);
  }

  /** POST /v1/ha/connection-requests/{id}/claim: pending → 202, approved → token exactly once. */
  async claimConnection(request: Request, requestId: string): Promise<{ status: number; body: unknown }> {
    this.auth.limiter.check(`ha-claim:${request.remoteAddress}`);
    const claim = parseSecret(object(request.body).claim_secret, 'fhq');
    if (!claim || !UUID.test(requestId)) throw authRequired();
    return transaction(this.db, async (tx) => {
      const { rows } = await tx.query(
        `select state, integration_id, expires_at > now() as fresh from famalio.ha_connection_requests
          where id=$1 and claim_hash=$2 for update`, [requestId, hashSecret(claim)]);
      const row = rows[0];
      if (!row) throw authRequired();
      if (row.state === 'pending') return { status: 202, body: { state: row.fresh ? 'pending' : 'expired' } };
      if (row.state !== 'approved') return { status: 409, body: { state: row.state } };
      const token = newSecret('fhi');
      await tx.query('update famalio.ha_integrations set token_hash=$2 where id=$1 and revoked_at is null', [row.integration_id, hashSecret(token)]);
      await tx.query("update famalio.ha_connection_requests set state='claimed' where id=$1", [requestId]);
      return { status: 200, body: { state: 'claimed', integration_id: row.integration_id, integration_token: token } };
    });
  }

  // ---- Integration-token routes ----

  async calendars(request: Request) {
    const grant = await this.authenticate(request);
    const active = await this.activeGrant(grant);
    const available = await this.availableCalendars(this.db, grant.family_id);
    const instance = await this.db.query('select instance_id, recovery_epoch from famalio.instance');
    return { instance_id: instance.rows[0]?.instance_id, recovery_epoch: instance.rows[0]?.recovery_epoch,
      family_id: grant.family_id, integration_id: grant.id,
      projection: grant.projection, max_days: grant.max_days, access: grant.access,
      calendars: available.filter((calendar) => active.calendar_names.includes(calendar.id))
        .map((calendar) => ({ calendar_id: calendar.id, name: calendar.name, color: calendar.color })) };
  }

  async events(request: Request, calendarId: string) {
    const grant = await this.authenticate(request);
    const active = await this.activeGrant(grant);
    if (!active.calendar_names.includes(calendarId)) throw accessDenied();
    const start = isoInstant(request.query.get('start'));
    const end = isoInstant(request.query.get('end'));
    const zone = validZone(request.query.get('tz'));
    const now = Date.now();
    const maxRange = active.max_days * 86_400_000;
    if (end <= start || end.getTime() - start.getTime() > maxRange
      || start.getTime() < now - maxRange || end.getTime() > now + maxRange) throw invalidInput('Requested interval exceeds this integration grant');
    const calendarName = calendarId === FAMILY_CALENDAR ? null : calendarId;
    const { rows } = await this.db.query(
      // SEC-07: parents-only and closed-group events are never projected; HA is not a family member.
      `select name,fields from famalio.records where family_id=$1 and type='FC_Event' and not deleted
         and visibility <> 'parentsOnly' and audience_group is null
         and calendar_name is not distinct from $2 order by revision limit $3`,
      [active.family_id, calendarName, MAX_CALENDAR_ROWS + 1]);
    if (rows.length > MAX_CALENDAR_ROWS) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Too many events in this calendar to project safely');
    const events: any[] = [];
    for (const row of rows) {
      events.push(...eventOccurrences(row, start, end, zone, active.projection));
      if (events.length > MAX_PROJECTED_EVENTS) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Too many events in the requested interval');
    }
    events.sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.uid.localeCompare(b.uid));
    return { events };
  }

  /** POST /v1/ha/calendars/{calendar_id}/events (write grants only). */
  async createEvent(request: Request, calendarId: string) {
    const { grant, principal } = await this.writer(request, calendarId);
    const fields = eventWriteFields(request.body, validZone(object(request.body).tz as string ?? null));
    this.checkWindow(grant, fields.start);
    const id = randomUUID();
    const now = appleSeconds(new Date());
    const payload: Record<string, unknown> = {
      version: 1, id: id.toUpperCase(), title: fields.title, startDate: fields.startDate, endDate: fields.endDate,
      isAllDay: fields.isAllDay, lastModified: now, visibility: 'family', eventIcon: 'none', notificationsEnabled: true,
      requiresTransport: false, assignedTo: [], reminders: [], calendar: calendarId === FAMILY_CALENDAR ? null : calendarId,
      modifiedBy: principal.memberRecordName, createdBy: principal.memberRecordName,
      ...(fields.notes ? { notes: fields.notes } : {}), ...(fields.location ? { location: fields.location } : {}),
    };
    await this.write(principal, `event-${id}`, 0, payload);
    await this.auditGrant(grant, 'ha_event.created');
    return { uid: `event-${id}` };
  }

  /** PATCH /v1/ha/calendars/{calendar_id}/events/{uid}: single, non-recurring events. */
  async updateEvent(request: Request, calendarId: string, uid: string) {
    const { grant, principal } = await this.writer(request, calendarId);
    const existing = await this.editableEvent(grant, calendarId, uid);
    const fields = eventWriteFields(request.body, validZone(object(request.body).tz as string ?? null));
    this.checkWindow(grant, fields.start);
    const payload: Record<string, unknown> = { ...existing.payload, title: fields.title, startDate: fields.startDate, endDate: fields.endDate,
      isAllDay: fields.isAllDay, lastModified: appleSeconds(new Date()), modifiedBy: principal.memberRecordName,
      calendar: calendarId === FAMILY_CALENDAR ? null : calendarId };
    if (fields.notes) payload.notes = fields.notes; else delete payload.notes;
    if (fields.location) payload.location = fields.location; else delete payload.location;
    await this.write(principal, uid, existing.revision, payload);
    await this.auditGrant(grant, 'ha_event.updated');
    return { uid };
  }

  /** DELETE /v1/ha/calendars/{calendar_id}/events/{uid}: single, non-recurring events. */
  async deleteEvent(request: Request, calendarId: string, uid: string): Promise<void> {
    const { grant, principal } = await this.writer(request, calendarId);
    const existing = await this.editableEvent(grant, calendarId, uid);
    const context = await this.records.context(this.db, grant.family_id);
    await this.records.mutate(principal, grant.family_id, { context, mutations: [
      { operation_id: randomUUID(), operation: 'delete', record_name: uid, expected_revision: existing.revision }] });
    await this.auditGrant(grant, 'ha_event.deleted');
  }

  private async writer(request: Request, calendarId: string) {
    const grant = await this.authenticate(request);
    if (grant.access !== 'write' || grant.projection !== 'full') throw accessDenied();
    const active = await this.activeGrant(grant);
    if (!active.calendar_names.includes(calendarId)) throw accessDenied();
    const owner = await this.db.query('select member_record_name from famalio.subjects where id=$1', [grant.created_by_subject_id]);
    // Writes run with the approving owner's record permissions, never broader.
    const principal: Principal = { sessionId: '00000000-0000-0000-0000-000000000000', deviceId: null as unknown as string,
      subjectId: grant.created_by_subject_id, familyId: grant.family_id, role: 'owner', memberRecordName: owner.rows[0].member_record_name };
    return { grant: active, principal };
  }

  private checkWindow(grant: any, start: Date) {
    const range = grant.max_days * 86_400_000;
    if (Math.abs(start.getTime() - Date.now()) > range) throw invalidInput('Event is outside the time range shared with Home Assistant');
  }

  private async editableEvent(grant: any, calendarId: string, uid: string) {
    if (!/^event-[0-9a-f-]{36}$/.test(uid)) throw notFound();
    const { rows } = await this.db.query(
      `select fields, revision from famalio.records where family_id=$1 and name=$2 and type='FC_Event' and not deleted
         and visibility <> 'parentsOnly' and audience_group is null
         and calendar_name is not distinct from $3`, [grant.family_id, uid, calendarId === FAMILY_CALENDAR ? null : calendarId]);
    if (!rows[0]) throw notFound();
    const payload = decodePayload(rows[0].fields);
    if (payload.recurrence != null) throw new ApiError(409, 'RECURRING_EVENT', 'Edit recurring events in the Famalio app');
    if (typeof payload.sharedBy === 'string' && payload.sharedBy) throw new ApiError(409, 'READ_ONLY_EVENT', 'Imported events are read-only');
    return { payload, revision: Number(rows[0].revision) };
  }

  private async write(principal: Principal, name: string, expected: number, payload: Record<string, unknown>) {
    const context = await this.records.context(this.db, principal.familyId);
    const fields = { familyID: { type: 'string', value: principal.familyId.toUpperCase() },
      payload: { type: 'data', value: Buffer.from(JSON.stringify(payload)).toString('base64') },
      lastModified: { type: 'date', value: payload.lastModified } };
    await this.records.mutate(principal, principal.familyId, { context, mutations: [
      { operation_id: randomUUID(), operation: 'upsert', record_name: name, record_type: 'FC_Event', expected_revision: expected, fields }] });
  }

  private async auditGrant(grant: any, action: string) {
    await this.db.query('insert into famalio.audit_log(family_id,subject_id,action) values($1,$2,$3)', [grant.family_id, grant.created_by_subject_id, action]);
  }

  private async authenticate(request: Request) {
    const token = parseSecret(request.headers.authorization?.replace(/^Bearer /, ''), 'fhi');
    if (!token) throw authRequired();
    const { rows } = await this.db.query(
      `select h.id,h.family_id,h.created_by_subject_id,h.projection,h.max_days,h.calendar_names,h.access
         from famalio.ha_integrations h join famalio.subjects s on s.id=h.created_by_subject_id and s.family_id=h.family_id
         join famalio.families f on f.id=h.family_id join famalio.instance i on i.recovery_epoch=h.recovery_epoch
        where h.token_hash=$1 and h.revoked_at is null and s.role='owner' and s.removed_at is null and f.placement_state='active'`,
      [hashSecret(token)]);
    if (!rows[0]) throw authRequired();
    return rows[0];
  }

  private async activeGrant(grant: any) {
    const available = await this.availableCalendars(this.db, grant.family_id);
    // Explicit grants fail closed if a selected calendar is deleted or renamed.
    const ids = grant.calendar_names.filter((id: string) => available.some((calendar) => calendar.id === id));
    return { ...grant, calendar_names: ids };
  }

  private async availableCalendars(db: Db | Tx, familyId: string): Promise<CalendarRow[]> {
    const { rows } = await db.query(
      `select name,fields from famalio.records where family_id=$1 and not deleted and type='FC_Calendar' order by revision`, [familyId]);
    const family = await db.query(
      `select fields from famalio.records where family_id=$1 and not deleted and type='FC_Family' order by revision limit 1`, [familyId]);
    const result: CalendarRow[] = [{ id: FAMILY_CALENDAR, name: String(field(family.rows[0]?.fields ?? {}, 'name') ?? 'Family calendar'), color: null }];
    for (const row of rows) result.push({ id: row.name, name: String(field(row.fields, 'name') ?? 'Calendar'),
      color: typeof field(row.fields, 'colorHex') === 'string' ? field(row.fields, 'colorHex') as string : null });
    return result;
  }

  private async audit(tx: Tx, principal: Principal, action: string) {
    await tx.query('insert into famalio.audit_log(family_id,subject_id,device_id,action) values($1,$2,$3,$4)',
      [principal.familyId, principal.subjectId, principal.deviceId, action]);
  }
}
