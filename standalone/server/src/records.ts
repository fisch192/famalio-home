import { transaction, type Db, type Tx } from './db.ts';
import type { Principal, Role } from './auth.ts';
import {
  ApiError, accessDenied, cursorExpired, idempotencyMismatch, invalidInput, placementChanged, recoveryRequired, versionConflict,
} from './errors.ts';
import { sha256Hex } from './secrets.ts';

/**
 * Record rules are a port of supabase/sql/famalio_functions.sql actions `changes`,
 * `save` and `deleteRecords`, with the subject's member record name in place of
 * 'member-sb_'||auth.uid(). Wire format (FieldValue {type,value}) is unchanged so the
 * existing Swift/Kotlin record builders and golden fixtures apply.
 */

export interface Context { instance_id: string; family_id: string; placement_epoch: number; recovery_epoch: string }

type Fields = Record<string, { type: string; value: unknown }>;

const RECORD_NAME = /^(event-|member-|group-|calendar-)[a-zA-Z0-9_-]{1,100}$/;
const UUID_NAME = (prefix: string) => new RegExp(`^${prefix}-[a-f0-9-]{36}$`);
const EVENT_ICONS = new Set(['none', 'birthday', 'holiday', 'anniversary', 'vacation', 'medical', 'school', 'sports', 'music', 'work', 'celebration', 'reminder', 'important']);
const MAX_PAGE = 100;
const MAX_PAGE_BYTES = 25_165_824;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function keysOnly(fields: Fields, allowed: string[]): boolean {
  return Object.keys(fields).every((key) => allowed.includes(key));
}

function field(fields: Fields, key: string, type: string): unknown {
  const entry = fields[key];
  return entry && entry.type === type ? entry.value : undefined;
}

function decodeJsonBase64(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') throw invalidInput();
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw invalidInput();
  }
}

function isFields(value: unknown): value is Fields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
    && typeof (entry as { type?: unknown }).type === 'string' && Object.keys(entry).every((k) => k === 'type' || k === 'value'));
}

interface Validated { fields: Fields; visibility: 'family' | 'parentsOnly'; audience: string | null; calendar: string | null; hasCalendarKey: boolean }

/** Structural validation of one upsert; access checks follow in [authorizeUpsert]. */
export function validateUpsert(principal: Principal, familyId: string, name: string, type: string, raw: unknown): Validated {
  if (typeof name !== 'string' || !RECORD_NAME.test(name)) throw invalidInput();
  if (!['FC_Event', 'FC_Member', 'FC_Group', 'FC_Calendar'].includes(type)) throw invalidInput();
  if (!isFields(raw)) throw invalidInput();
  let fields: Fields = raw;
  if (field(fields, 'familyID', 'string') !== familyId.toUpperCase()) throw invalidInput();
  if ((type === 'FC_Event' && !UUID_NAME('event').test(name)) || (type === 'FC_Member' && !name.startsWith('member-'))
    || (type === 'FC_Group' && !UUID_NAME('group').test(name))) throw invalidInput();
  let visibility: 'family' | 'parentsOnly' = 'family';
  let audience: string | null = null;
  let calendar: string | null = null;
  let hasCalendarKey = false;

  if (type === 'FC_Calendar') {
    if (principal.role !== 'owner') throw accessDenied();
    const nameValue = field(fields, 'name', 'string');
    const symbol = field(fields, 'symbol', 'string');
    const color = field(fields, 'colorHex', 'string');
    const access = field(fields, 'defaultAccess', 'string');
    if (!UUID_NAME('calendar').test(name) || !keysOnly(fields, ['familyID', 'name', 'symbol', 'colorHex', 'defaultAccess', 'readGroups', 'writeGroups', 'sortOrder'])
      || typeof nameValue !== 'string' || nameValue.trim().length < 1 || nameValue.trim().length > 60
      || typeof symbol !== 'string' || symbol.length < 1 || symbol.length > 60
      || typeof color !== 'string' || !/^#[a-fA-F0-9]{6}$/.test(color)
      || typeof access !== 'string' || !['none', 'viewer', 'editor'].includes(access)
      || !Number.isInteger(field(fields, 'sortOrder', 'integer'))) throw invalidInput();
    for (const key of ['readGroups', 'writeGroups']) {
      const groups = field(fields, key, 'stringArray');
      if (!Array.isArray(groups) || groups.length > 200 || !groups.every((g) => typeof g === 'string')) throw invalidInput();
    }
  }
  if (type === 'FC_Group') {
    if (principal.role !== 'owner') throw accessDenied();
    const nameValue = field(fields, 'name', 'string');
    if (!keysOnly(fields, ['familyID', 'name', 'symbol', 'members', 'sortOrder'])
      || typeof nameValue !== 'string' || nameValue.length < 1 || nameValue.length > 60
      || ('symbol' in fields && (typeof field(fields, 'symbol', 'string') !== 'string' || (field(fields, 'symbol', 'string') as string).length > 60))
      || ('members' in fields && (!Array.isArray(field(fields, 'members', 'stringArray')) || (field(fields, 'members', 'stringArray') as unknown[]).length > 200
        || !(field(fields, 'members', 'stringArray') as unknown[]).every((m) => typeof m === 'string')))
      || ('sortOrder' in fields && !Number.isInteger(field(fields, 'sortOrder', 'integer')))) throw invalidInput();
  }
  if (type === 'FC_Event') {
    if (principal.role === 'viewer') throw accessDenied();
    if (!keysOnly(fields, ['familyID', 'payload', 'collaboration', 'lastModified'])) throw invalidInput();
    const payload = decodeJsonBase64(field(fields, 'payload', 'data'));
    if ('lastModified' in fields && typeof field(fields, 'lastModified', 'date') !== 'number') throw invalidInput();
    if ('collaboration' in fields) {
      const collaboration = field(fields, 'collaboration', 'asset');
      if (typeof collaboration !== 'string') throw invalidInput();
      if (collaboration !== '') decodeJsonBase64(collaboration);
    }
    for (const key of ['startDate', 'endDate', 'lastModified']) if (typeof payload[key] !== 'number') throw invalidInput();
    for (const key of ['isAllDay', 'notificationsEnabled', 'requiresTransport']) if (typeof payload[key] !== 'boolean') throw invalidInput();
    const title = payload.title;
    if (!Array.isArray(payload.assignedTo) || !Array.isArray(payload.reminders)
      || (payload.visibility !== 'family' && payload.visibility !== 'parentsOnly')
      || typeof payload.eventIcon !== 'string' || !EVENT_ICONS.has(payload.eventIcon)
      || String(payload.version) !== '1' || typeof payload.id !== 'string' || !UUID.test(payload.id)
      || `event-${payload.id.toLowerCase()}` !== name
      || typeof title !== 'string' || title.length < 1 || title.length > 1000
      || (payload.endDate as number) < (payload.startDate as number)) throw invalidInput();
    visibility = payload.visibility;
    const aud = payload.audienceGroup;
    if (aud !== undefined && aud !== null && (typeof aud !== 'string' || !/^group-[a-f0-9-]{36}$/.test(aud))) throw invalidInput();
    audience = typeof aud === 'string' ? aud : null;
    hasCalendarKey = 'calendar' in payload;
    const cal = payload.calendar;
    if (cal !== undefined && cal !== null && typeof cal !== 'string') throw invalidInput();
    calendar = typeof cal === 'string' ? cal : null;
  } else if (name === principal.memberRecordName) {
    // Own profile: role and account link come from the server, never from the client.
    const profileRole: Record<Role, string> = { owner: 'owner', editor: 'parent', viewer: 'viewer' };
    fields = { ...fields,
      role: { type: 'string', value: profileRole[principal.role] },
      userRecordID: { type: 'string', value: principal.memberRecordName.slice('member-'.length) } };
  } else if (type === 'FC_Member') {
    const role = field(fields, 'role', 'string');
    if (principal.role !== 'owner' || !UUID_NAME('member').test(name) || 'userRecordID' in fields
      || typeof role !== 'string' || !['child', 'viewer', 'parent'].includes(role)) throw accessDenied();
  }
  if (type === 'FC_Member') {
    if (!keysOnly(fields, ['familyID', 'displayName', 'colorHex', 'iconName', 'role', 'userRecordID', 'avatarData'])) throw invalidInput();
    for (const key of ['displayName', 'colorHex', 'iconName', 'role']) {
      const value = field(fields, key, 'string');
      if (typeof value !== 'string' || value.length > 100) throw invalidInput();
    }
    if ('avatarData' in fields && typeof field(fields, 'avatarData', 'data') !== 'string') throw invalidInput();
  }
  return { fields, visibility, audience, calendar, hasCalendarKey };
}

async function allows(tx: Tx, fn: 'audience' | 'calendar', principal: Principal, target: string | null, editing: boolean): Promise<boolean> {
  const { rows } = fn === 'audience'
    ? await tx.query('select famalio.audience_allows($1,$2,$3,$4) as ok', [principal.familyId, target, principal.memberRecordName, principal.role])
    : await tx.query('select famalio.calendar_allows($1,$2,$3,$4,$5) as ok', [principal.familyId, target, principal.memberRecordName, principal.role, editing]);
  return rows[0]?.ok === true;
}

async function nextRevision(tx: Tx, familyId: string): Promise<number> {
  const { rows } = await tx.query('update famalio.families set revision=revision+1 where id=$1 returning revision', [familyId]);
  return Number(rows[0].revision);
}

/** Low-level write shared by bootstrap/pairing and mutations. Caller holds the family row lock. */
export async function putRecord(tx: Tx, familyId: string, name: string, type: string, fields: Fields,
  meta: { visibility?: string; audience?: string | null; calendar?: string | null } = {}): Promise<number> {
  const revision = await nextRevision(tx, familyId);
  await tx.query(
    `insert into famalio.records(family_id,name,type,fields,revision,deleted,visibility,audience_group,calendar_name)
     values($1,$2,$3,$4,$5,false,$6,$7,$8)
     on conflict (family_id,name) do update set fields=excluded.fields, revision=excluded.revision, deleted=false, deleted_at=null,
       visibility=excluded.visibility, audience_group=excluded.audience_group, calendar_name=excluded.calendar_name`,
    [familyId, name, type, JSON.stringify(fields), revision, meta.visibility ?? 'family', meta.audience ?? null, meta.calendar ?? null]);
  return revision;
}

const PROFILE_ROLE: Record<Role, string> = { owner: 'owner', editor: 'parent', viewer: 'viewer' };

/**
 * Links a member profile record to a signed-in subject: creates it for a new member or
 * sets role/userRecordID on an existing (e.g. previously unlinked) profile.
 */
export async function linkMemberRecord(tx: Tx, familyId: string, memberName: string, role: Role, displayName: string): Promise<void> {
  const { rows } = await tx.query("select fields, deleted from famalio.records where family_id=$1 and name=$2 and type='FC_Member'", [familyId, memberName]);
  const existing = rows[0] && !rows[0].deleted ? rows[0].fields as Fields : undefined;
  const fields: Fields = {
    displayName: { type: 'string', value: displayName },
    colorHex: { type: 'string', value: '#FFB26B' },
    iconName: { type: 'string', value: 'person.fill' },
    ...existing,
    role: { type: 'string', value: PROFILE_ROLE[role] },
    userRecordID: { type: 'string', value: memberName.slice('member-'.length) },
    familyID: { type: 'string', value: familyId.toUpperCase() },
  };
  await putRecord(tx, familyId, memberName, 'FC_Member', fields);
}

export class Records {
  private readonly db: Db;
  constructor(db: Db) { this.db = db; }

  async context(tx: Tx | Db, familyId: string): Promise<Context> {
    const { rows } = await tx.query(
      `select i.instance_id, i.recovery_epoch, f.placement_epoch from famalio.instance i, famalio.families f where f.id=$1`, [familyId]);
    const row = rows[0];
    if (!row) throw accessDenied();
    return { instance_id: row.instance_id, family_id: familyId, placement_epoch: Number(row.placement_epoch), recovery_epoch: row.recovery_epoch };
  }

  private requireFamily(principal: Principal, familyId: string): void {
    // Path family must equal the authenticated family; no existence detail leaks (SEC-04).
    if (familyId.toLowerCase() !== principal.familyId.toLowerCase()) throw accessDenied();
  }

  /**
   * GET /v1/families/{id}/changes. A null cursor pages through the full visible state
   * (snapshot); hidden or revoked records are delivered as removed names.
   */
  async changes(principal: Principal, familyId: string, cursor: string | null, limitRaw: string | null) {
    this.requireFamily(principal, familyId);
    const limit = limitRaw === null ? MAX_PAGE : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) throw invalidInput();
    return transaction(this.db, async (tx) => {
      await tx.query('set transaction isolation level repeatable read read only');
      const context = await this.context(tx, principal.familyId);
      const since = cursor === null ? 0 : this.parseCursor(cursor, context);
      const family = (await tx.query('select revision, journal_floor from famalio.families where id=$1', [principal.familyId])).rows[0];
      const current = Number(family.revision);
      if (since > current) throw cursorExpired();
      // Tombstones up to journal_floor were purged by retention: an older cursor would miss deletions.
      if (cursor !== null && since < Number(family.journal_floor)) throw cursorExpired();
      const { rows } = await tx.query(
        `select r.name, r.type, r.revision, famalio.record_visible(r.family_id, r, $3, $4) as visible,
                case when famalio.record_visible(r.family_id, r, $3, $4) then r.fields else null end as fields,
                sum(octet_length(r.fields::text)) over (order by r.revision) as bytes
           from famalio.records r
          where r.family_id=$1 and r.revision>$2 ${cursor === null ? 'and not r.deleted' : ''}
          order by r.revision limit $5`,
        [principal.familyId, since, principal.memberRecordName, principal.role, limit]);
      const page = rows.filter((row, index) => index === 0 || Number(row.bytes) <= MAX_PAGE_BYTES);
      const records = page.filter((row) => row.visible).map((row) => ({
        record_name: row.name, record_type: row.type, revision: Number(row.revision), fields: row.fields }));
      const removed = cursor === null ? [] : page.filter((row) => !row.visible).map((row) => row.name);
      const last = page.length ? Number(page[page.length - 1].revision) : since;
      const more = await tx.query(
        `select exists(select 1 from famalio.records where family_id=$1 and revision>$2 ${cursor === null ? 'and not deleted' : ''}) as more`,
        [principal.familyId, last]);
      const hasMore = more.rows[0].more === true;
      // A snapshot's final cursor is the family revision it observed, so later deltas start after it.
      const nextRevision = hasMore ? last : Math.max(last, current);
      return { context, records, removed_record_names: removed, next_cursor: this.makeCursor(context, nextRevision), has_more: hasMore };
    });
  }

  private makeCursor(context: Context, revision: number): string {
    return Buffer.from(`v1:${context.recovery_epoch}:${context.family_id}:${context.placement_epoch}:${revision}`).toString('base64url');
  }

  /** Cursors are opaque and non-secret; they bind epoch/family/placement but never grant access. */
  private parseCursor(cursor: string, context: Context): number {
    if (!/^[A-Za-z0-9_-]{1,300}$/.test(cursor)) throw invalidInput();
    const parts = Buffer.from(cursor, 'base64url').toString('utf8').split(':');
    if (parts.length !== 5 || parts[0] !== 'v1') throw invalidInput();
    if (parts[1] !== context.recovery_epoch) throw cursorExpired();
    if (parts[2] !== context.family_id || Number(parts[3]) !== context.placement_epoch) throw cursorExpired();
    const revision = Number(parts[4]);
    if (!Number.isSafeInteger(revision) || revision < 0) throw invalidInput();
    return revision;
  }

  private checkContext(principal: Principal, sent: unknown, actual: Context): void {
    const context = (sent ?? {}) as Partial<Context>;
    if (context.family_id?.toLowerCase() !== principal.familyId.toLowerCase()) throw accessDenied();
    if (context.instance_id !== actual.instance_id || context.recovery_epoch !== actual.recovery_epoch) throw recoveryRequired();
    if (context.placement_epoch !== actual.placement_epoch) throw placementChanged();
  }

  /**
   * POST /v1/families/{id}/mutations. The batch is atomic: any conflict or denial
   * rolls back every mutation. Replays of an applied operation_id with identical
   * content return the stored result without writing again.
   */
  async mutate(principal: Principal, familyId: string, body: unknown) {
    this.requireFamily(principal, familyId);
    const input = (body ?? {}) as { context?: unknown; mutations?: unknown };
    if (!Array.isArray(input.mutations) || input.mutations.length < 1 || input.mutations.length > 50) throw invalidInput();
    const mutations = input.mutations as Array<Record<string, unknown>>;
    const seen = new Set<string>();
    for (const m of mutations) {
      if (!m || typeof m !== 'object' || typeof m.operation_id !== 'string' || !UUID.test(m.operation_id)
        || (m.operation !== 'upsert' && m.operation !== 'delete') || typeof m.record_name !== 'string'
        || !Number.isSafeInteger(m.expected_revision) || (m.expected_revision as number) < 0) throw invalidInput();
      if (m.operation === 'delete' && ('fields' in m || 'record_type' in m)) throw invalidInput();
      if (seen.has(m.operation_id.toLowerCase())) throw invalidInput();
      seen.add(m.operation_id.toLowerCase());
    }
    try {
      return await transaction(this.db, async (tx) => {
        const family = await tx.query('select placement_state from famalio.families where id=$1 for update', [principal.familyId]);
        const context = await this.context(tx, principal.familyId);
        this.checkContext(principal, input.context, context);
        if (family.rows[0]?.placement_state !== 'active') throw placementChanged();
        const results: Array<{ operation_id: string; record_name: string; revision: number }> = [];
        for (const m of mutations) {
          const operationId = (m.operation_id as string).toLowerCase();
          const hash = Buffer.from(sha256Hex(JSON.stringify([m.operation, m.record_name, m.record_type ?? null, m.expected_revision, m.fields ?? null])), 'hex');
          const prior = await tx.query('select request_hash, result from famalio.operations where family_id=$1 and operation_id=$2', [principal.familyId, operationId]);
          if (prior.rows[0]) {
            if (!Buffer.from(prior.rows[0].request_hash).equals(hash)) throw idempotencyMismatch();
            results.push(prior.rows[0].result);
            continue;
          }
          const revision = m.operation === 'upsert'
            ? await this.upsert(tx, principal, m.record_name as string, m.record_type as string, m.fields, m.expected_revision as number)
            : await this.remove(tx, principal, m.record_name as string, m.expected_revision as number);
          const result = { operation_id: operationId, record_name: m.record_name as string, revision };
          await tx.query('insert into famalio.operations(family_id,operation_id,request_hash,subject_id,result) values($1,$2,$3,$4,$5)',
            [principal.familyId, operationId, hash, principal.subjectId, JSON.stringify(result)]);
          results.push(result);
        }
        const revision = Number((await tx.query('select revision from famalio.families where id=$1', [principal.familyId])).rows[0].revision);
        return { context, operation_ids: results.map((r) => r.operation_id), results, revision };
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'P0001' && error.message === 'PLACEMENT_CHANGED') throw placementChanged();
      throw error;
    }
  }

  private async upsert(tx: Tx, principal: Principal, name: string, type: string, raw: unknown, expected: number): Promise<number> {
    const valid = validateUpsert(principal, principal.familyId, name, type, raw);
    const { rows } = await tx.query('select type, fields, revision, deleted, audience_group, calendar_name from famalio.records where family_id=$1 and name=$2',
      [principal.familyId, name]);
    const previous = rows[0];
    if (previous && previous.type !== type) throw invalidInput();
    if (type === 'FC_Calendar' || type === 'FC_Group') {
      if (type === 'FC_Calendar') {
        for (const key of ['readGroups', 'writeGroups']) {
          const groups = valid.fields[key]!.value as string[];
          if (groups.length) {
            const found = await tx.query("select count(*)::int as n from famalio.records where family_id=$1 and name = any($2) and type='FC_Group' and not deleted",
              [principal.familyId, groups]);
            if (found.rows[0].n !== new Set(groups).size) throw invalidInput();
          }
        }
      }
    }
    if (type === 'FC_Event') {
      if (previous?.calendar_name && !valid.hasCalendarKey) throw new ApiError(409, 'CALENDAR_CLIENT_UPDATE_REQUIRED', 'Client must send the calendar field');
      if (!(await allows(tx, 'audience', principal, valid.audience, true))
        || (previous && !(await allows(tx, 'audience', principal, previous.audience_group, true)))
        || !(await allows(tx, 'calendar', principal, valid.calendar, true))
        || (previous && !(await allows(tx, 'calendar', principal, previous.calendar_name, true)))) throw accessDenied();
      if (previous) {
        if (previous.deleted) throw versionConflict();
        if (JSON.stringify(previous.fields) === JSON.stringify(valid.fields)) return Number(previous.revision);
        if (expected !== Number(previous.revision)) throw versionConflict();
      } else if (expected !== 0) {
        throw versionConflict();
      }
    } else if (previous && !previous.deleted && expected !== 0 && expected !== Number(previous.revision)) {
      throw versionConflict();
    }
    return putRecord(tx, principal.familyId, name, type, valid.fields, { visibility: valid.visibility, audience: valid.audience, calendar: valid.calendar });
  }

  private async remove(tx: Tx, principal: Principal, name: string, expected: number): Promise<number> {
    if (principal.role === 'viewer') throw accessDenied();
    const { rows } = await tx.query('select type, revision, deleted, audience_group, calendar_name from famalio.records where family_id=$1 and name=$2',
      [principal.familyId, name]);
    const previous = rows[0];
    if (!previous || previous.deleted) return previous ? Number(previous.revision) : 0;
    if (previous.type === 'FC_Event' && (!(await allows(tx, 'calendar', principal, previous.calendar_name, true))
      || !(await allows(tx, 'audience', principal, previous.audience_group, true)))) throw accessDenied();
    if ((previous.type === 'FC_Calendar' || previous.type === 'FC_Group') && principal.role !== 'owner') throw accessDenied();
    if (previous.type === 'FC_Calendar') {
      const used = await tx.query('select 1 from famalio.records where family_id=$1 and calendar_name=$2 and not deleted limit 1', [principal.familyId, name]);
      if (used.rowCount) throw new ApiError(409, 'CALENDAR_NOT_EMPTY', 'Calendar still has events');
    }
    if (previous.type === 'FC_Event' && expected !== Number(previous.revision)) throw versionConflict();
    if (previous.type === 'FC_Family' || (previous.type === 'FC_Member' && (principal.role !== 'owner' || !UUID_NAME('member').test(name)))) throw accessDenied();
    const linked = await tx.query('select 1 from famalio.subjects where family_id=$1 and member_record_name=$2 and removed_at is null', [principal.familyId, name]);
    if (linked.rowCount) throw accessDenied();
    const revision = await nextRevision(tx, principal.familyId);
    await tx.query("update famalio.records set deleted=true, deleted_at=now(), fields='{}', revision=$3 where family_id=$1 and name=$2", [principal.familyId, name, revision]);
    return revision;
  }
}

/**
 * Journal retention (P02). For every active family, tombstones deleted longer ago
 * than the retention window are purged and journal_floor is raised to the highest
 * purged revision. Revisions grow monotonically, so every tombstone at or below that
 * revision is older too and is purged with it. A delta cursor below journal_floor
 * cannot see those deletions any more and receives 410 CURSOR_EXPIRED; the client
 * then loads a fresh snapshot and keeps its outbox (10_API_CONTRACT.md).
 * Runs at server start and daily (src/main.ts) or once via `node src/retention.ts`.
 */
export async function compactJournal(db: Db, retentionSeconds: number): Promise<{ families: number; purged: number }> {
  const { rows } = await db.query("select id from famalio.families where placement_state='active' order by id");
  let purged = 0;
  let families = 0;
  for (const { id } of rows) {
    const removed = await transaction(db, async (tx) => {
      await tx.query('select 1 from famalio.families where id=$1 for update', [id]);
      const floor = await tx.query(
        'select max(revision) as floor from famalio.records where family_id=$1 and deleted and deleted_at < now() - make_interval(secs => $2)',
        [id, retentionSeconds]);
      if (floor.rows[0].floor === null) return 0;
      const result = await tx.query('delete from famalio.records where family_id=$1 and deleted and revision <= $2', [id, floor.rows[0].floor]);
      await tx.query('update famalio.families set journal_floor=greatest(journal_floor,$2) where id=$1', [id, floor.rows[0].floor]);
      return result.rowCount ?? 0;
    });
    if (removed) families += 1;
    purged += removed;
  }
  return { families, purged };
}
