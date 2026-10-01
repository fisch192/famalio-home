import { randomUUID } from 'node:crypto';
import { ApiError, invalidInput, payloadTooLarge } from '../errors.ts';
import { depth, MAX_JSON_DEPTH } from '../http.ts';
import { sha256Hex } from '../secrets.ts';
import { isSharedRecordType, unsupportedReason } from './inventory.ts';

/**
 * Family snapshot format v1 (P03, 03_MIGRATION.md MIG-03).
 *
 * A snapshot is an immutable manifest plus bounded chunks. Chunk bytes are the
 * canonical JSON of {format, format_version, family_id, index, records}; the manifest
 * lists every chunk with its byte length and SHA-256, a total hash over the chunk
 * hashes, per-type counts and a content digest over all records independent of
 * chunking (records_sha256), so the target can re-derive it from its own database.
 * Hashes prove integrity relative to the manifest, not its origin (MIG-03); binding
 * to the target instance is checked, signing the manifest is P04 work.
 *
 * Nothing in here executes, follows paths or URLs, or decompresses: records are
 * JSON values keyed by validated record names, chunks are plain JSON bytes.
 */

export const SNAPSHOT_FORMAT = 'famalio-family-snapshot';
export const CHUNK_FORMAT = 'famalio-snapshot-chunk';
export const CLOUD_EXPORT_FORMAT = 'famalio-cloud-export';
export const FORMAT_VERSION = 1;
/** Record semantics of supabase/migrations/202609210001_canonical_functions.sql. */
export const SCHEMA_SEMANTICS_VERSION = 'famalio-records-2026-09-21';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const RECORD_NAME = /^(event-|member-|group-|calendar-)[a-zA-Z0-9_-]{1,100}$/;
const TYPE_PREFIX: Record<string, string> = { FC_Event: 'event-', FC_Member: 'member-', FC_Group: 'group-', FC_Calendar: 'calendar-' };
const MEMBER_ALIAS = /^member-sb_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_FIELDS_BYTES = 25_165_824;
const MAX_MEMBERS = 1000;

export type Fields = Record<string, { type: string; value?: unknown }>;

export interface SnapshotRecord {
  name: string;
  type: string;
  fields: Fields;
  deleted: boolean;
  visibility: 'family' | 'parentsOnly';
  audience_group: string | null;
  calendar_name: string | null;
}

export interface ChunkDescriptor { chunk_id: string; index: number; byte_length: number; sha256: string; record_count: number }
export interface MemberMapping { member_record_name: string; role: 'owner' | 'editor' | 'viewer' }

export interface Manifest {
  format: typeof SNAPSHOT_FORMAT;
  format_version: number;
  schema_semantics_version: string;
  snapshot_id: string;
  source_kind: 'cloud';
  family_id: string;
  source_revision: number;
  target_instance_id: string;
  record_counts: Record<string, number>;
  tombstone_counts: Record<string, number>;
  members: MemberMapping[];
  open_invite_count: number;
  chunks: ChunkDescriptor[];
  records_sha256: string;
  total_sha256: string;
}

export interface Limits { maxChunkBytes: number; maxChunkRecords: number; maxChunks: number; maxTotalBytes: number }

/** Unsupported/never-exported data: blocks the migration with a concrete reason (T029). */
export class UnsupportedRecord extends ApiError {
  readonly reasons: string[];
  constructor(reasons: string[]) {
    super(400, 'UNSUPPORTED_RECORD', reasons.slice(0, 20).join(','));
    this.reasons = reasons;
  }
}

export const hashMismatch = (what: string) => new ApiError(409, 'CHUNK_HASH_MISMATCH', `${what} does not match the manifest`);
export const bindingMismatch = (what: string) => new ApiError(409, 'MANIFEST_BINDING_MISMATCH', `Manifest ${what} binding rejected`);

/** Deterministic JSON: object keys sorted by code unit, no whitespace, finite numbers only. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidInput('Non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  throw invalidInput('Unsupported JSON value');
}

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

const nonNegativeInt = (value: unknown, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= max;

function isFields(value: unknown): value is Fields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, entry]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)
    && entry && typeof entry === 'object' && !Array.isArray(entry)
    && typeof (entry as { type?: unknown }).type === 'string' && Object.keys(entry).every((k) => k === 'type' || k === 'value'));
}

/**
 * Validates one record against the family it must belong to. Unknown types are
 * reported as UnsupportedRecord (block), anything else malformed as INVALID_INPUT.
 */
export function validateRecord(raw: unknown, familyId: string): SnapshotRecord {
  const keys = ['name', 'type', 'fields', 'deleted', 'visibility', 'audience_group', 'calendar_name'];
  if (!exactKeys(raw, keys)) throw invalidInput('Record keys');
  if (typeof raw.type !== 'string') throw invalidInput('Record type');
  if (!isSharedRecordType(raw.type)) throw new UnsupportedRecord([unsupportedReason(raw.type)]);
  const name = raw.name;
  if (typeof name !== 'string') throw invalidInput('Record name');
  if (raw.type === 'FC_Family') {
    if (name !== `family-${familyId}`) throw invalidInput('Family record name');
  } else if (!RECORD_NAME.test(name) || !name.startsWith(TYPE_PREFIX[raw.type]!)) {
    throw invalidInput('Record name');
  }
  if (typeof raw.deleted !== 'boolean' || !isFields(raw.fields)) throw invalidInput('Record fields');
  if (raw.deleted && Object.keys(raw.fields).length !== 0) throw invalidInput('Tombstone with content');
  const familyField = raw.fields.familyID;
  if (familyField !== undefined && (familyField.type !== 'string' || familyField.value !== familyId.toUpperCase())) {
    throw bindingMismatch('family');
  }
  if (raw.visibility !== 'family' && raw.visibility !== 'parentsOnly') throw invalidInput('Record visibility');
  if (raw.audience_group !== null && (typeof raw.audience_group !== 'string' || !/^group-[a-f0-9-]{36}$/.test(raw.audience_group))) throw invalidInput('Record audience');
  if (raw.calendar_name !== null && (typeof raw.calendar_name !== 'string' || !/^calendar-[a-f0-9-]{36}$/.test(raw.calendar_name))) throw invalidInput('Record calendar');
  if (Buffer.byteLength(JSON.stringify(raw.fields)) > MAX_FIELDS_BYTES) throw payloadTooLarge();
  return {
    name, type: raw.type, fields: raw.fields, deleted: raw.deleted, visibility: raw.visibility,
    audience_group: raw.audience_group, calendar_name: raw.calendar_name,
  };
}

/** Content digest over all records, independent of chunking; recomputable from the target DB. */
export function recordsDigest(records: SnapshotRecord[]): string {
  const lines = [...records].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((record) => canonicalJson({
    name: record.name, type: record.type, fields: record.fields, deleted: record.deleted, visibility: record.visibility,
    audience_group: record.audience_group, calendar_name: record.calendar_name,
  }));
  return sha256Hex(lines.join('\n'));
}

export function totalDigest(chunks: ChunkDescriptor[]): string {
  return sha256Hex(chunks.map((chunk) => chunk.sha256).join('\n'));
}

export function manifestDigest(manifest: Manifest): string {
  return sha256Hex(canonicalJson(manifest));
}

function counts(value: unknown): value is Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 64 && entries.every(([key, n]) => /^[A-Za-z0-9_]{1,64}$/.test(key) && nonNegativeInt(n));
}

/**
 * Strict manifest validation (T027, T029, T030). Returns the manifest and blockers
 * (unsupported record types); throws for malformed or inconsistent manifests.
 */
export function parseManifest(raw: unknown, limits: Limits): { manifest: Manifest; digest: string; blockers: string[] } {
  const keys = ['format', 'format_version', 'schema_semantics_version', 'snapshot_id', 'source_kind', 'family_id', 'source_revision',
    'target_instance_id', 'record_counts', 'tombstone_counts', 'members', 'open_invite_count', 'chunks', 'records_sha256', 'total_sha256'];
  if (!exactKeys(raw, keys)) throw invalidInput('Manifest keys');
  if (raw.format !== SNAPSHOT_FORMAT || raw.format_version !== FORMAT_VERSION) throw invalidInput('Unsupported snapshot format');
  if (raw.schema_semantics_version !== SCHEMA_SEMANTICS_VERSION) throw invalidInput('Unsupported schema semantics');
  if (raw.source_kind !== 'cloud') throw invalidInput('Unsupported source');
  for (const key of ['snapshot_id', 'family_id', 'target_instance_id']) {
    if (typeof raw[key] !== 'string' || !UUID.test(raw[key] as string)) throw invalidInput(`Manifest ${key}`);
  }
  if (!nonNegativeInt(raw.source_revision) || !nonNegativeInt(raw.open_invite_count, 100_000)) throw invalidInput('Manifest counters');
  if (typeof raw.records_sha256 !== 'string' || !HEX64.test(raw.records_sha256)
    || typeof raw.total_sha256 !== 'string' || !HEX64.test(raw.total_sha256)) throw invalidInput('Manifest hashes');
  if (!counts(raw.record_counts) || !counts(raw.tombstone_counts)) throw invalidInput('Manifest counts');
  const blockers = Object.keys(raw.record_counts).filter((type) => !isSharedRecordType(type)).map(unsupportedReason);
  for (const [type, n] of Object.entries(raw.tombstone_counts)) {
    if (n > (raw.record_counts[type] ?? 0)) throw invalidInput('Manifest tombstone counts');
  }
  if ((raw.record_counts.FC_Family ?? 0) - (raw.tombstone_counts.FC_Family ?? 0) !== 1) throw invalidInput('Manifest needs one family record');

  if (!Array.isArray(raw.members) || raw.members.length < 1 || raw.members.length > MAX_MEMBERS) throw invalidInput('Manifest members');
  const aliases = new Set<string>();
  for (const member of raw.members) {
    if (!exactKeys(member, ['member_record_name', 'role']) || typeof member.member_record_name !== 'string'
      || !MEMBER_ALIAS.test(member.member_record_name) || !['owner', 'editor', 'viewer'].includes(member.role as string)
      || aliases.has(member.member_record_name)) throw invalidInput('Manifest member');
    aliases.add(member.member_record_name);
  }
  if ((raw.members as MemberMapping[]).filter((m) => m.role === 'owner').length !== 1) throw invalidInput('Manifest needs exactly one owner');

  if (!Array.isArray(raw.chunks) || raw.chunks.length < 1) throw invalidInput('Manifest chunks');
  if (raw.chunks.length > limits.maxChunks) throw payloadTooLarge();
  const ids = new Set<string>();
  let total = 0;
  let records = 0;
  raw.chunks.forEach((chunk: unknown, index: number) => {
    if (!exactKeys(chunk, ['chunk_id', 'index', 'byte_length', 'sha256', 'record_count'])
      || typeof chunk.chunk_id !== 'string' || !UUID.test(chunk.chunk_id) || ids.has(chunk.chunk_id)
      || chunk.index !== index || typeof chunk.sha256 !== 'string' || !HEX64.test(chunk.sha256)
      || !nonNegativeInt(chunk.byte_length) || (chunk.byte_length as number) < 1
      || !nonNegativeInt(chunk.record_count) || (chunk.record_count as number) < 1) throw invalidInput('Manifest chunk');
    if ((chunk.byte_length as number) > limits.maxChunkBytes || (chunk.record_count as number) > limits.maxChunkRecords) throw payloadTooLarge();
    ids.add(chunk.chunk_id);
    total += chunk.byte_length as number;
    records += chunk.record_count as number;
  });
  if (total > limits.maxTotalBytes) throw payloadTooLarge();
  const declared = Object.values(raw.record_counts).reduce((sum, n) => sum + n, 0);
  if (declared !== records) throw invalidInput('Manifest counts do not match its chunks');
  const manifest = raw as unknown as Manifest;
  if (totalDigest(manifest.chunks) !== manifest.total_sha256) throw bindingMismatch('hash');
  return { manifest, digest: manifestDigest(manifest), blockers };
}

/**
 * Validates chunk bytes against their descriptor: exact length and SHA-256 first
 * (T028), then bounded JSON parsing and per-record validation bound to the family.
 */
export function parseChunk(bytes: Buffer, descriptor: { index: number; sha256: string; byte_length: number; record_count: number }, familyId: string): SnapshotRecord[] {
  if (bytes.length !== descriptor.byte_length || sha256Hex(bytes) !== descriptor.sha256) throw hashMismatch('Chunk');
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw invalidInput('Malformed chunk');
  }
  if (depth(parsed) > MAX_JSON_DEPTH) throw invalidInput('Chunk nested too deeply');
  if (!exactKeys(parsed, ['format', 'format_version', 'family_id', 'index', 'records'])
    || parsed.format !== CHUNK_FORMAT || parsed.format_version !== FORMAT_VERSION) throw invalidInput('Chunk keys');
  if (parsed.family_id !== familyId) throw bindingMismatch('family');
  if (parsed.index !== descriptor.index || !Array.isArray(parsed.records) || parsed.records.length !== descriptor.record_count) {
    throw invalidInput('Chunk does not match its descriptor');
  }
  const names = new Set<string>();
  const unsupported: string[] = [];
  const records: SnapshotRecord[] = [];
  for (const raw of parsed.records) {
    try {
      const record = validateRecord(raw, familyId);
      if (names.has(record.name)) throw invalidInput('Duplicate record');
      names.add(record.name);
      records.push(record);
    } catch (error) {
      if (error instanceof UnsupportedRecord) unsupported.push(...error.reasons);
      else throw error;
    }
  }
  if (unsupported.length) throw new UnsupportedRecord([...new Set(unsupported)]);
  return records;
}

export function chunkBytes(familyId: string, index: number, records: SnapshotRecord[]): Buffer {
  return Buffer.from(canonicalJson({ format: CHUNK_FORMAT, format_version: FORMAT_VERSION, family_id: familyId, index, records }), 'utf8');
}

/** Shape returned by public.famalio_export (supabase/sql/famalio_functions.sql). */
export interface CloudExport {
  format: typeof CLOUD_EXPORT_FORMAT;
  format_version: number;
  family_id: string;
  revision: number;
  exported_at: string;
  records: Array<SnapshotRecord & { revision: number }>;
  memberships: MemberMapping[];
  open_invite_count: number;
}

/**
 * Turns a cloud export into an immutable snapshot for one target instance. Records
 * are sorted by name and cut into chunks of at most chunkRecords, so an unchanged
 * range keeps identical chunk bytes across snapshots (resumable pre-transfer).
 * Unknown record types are passed through unchanged so the target blocks visibly
 * instead of the builder dropping them.
 */
export function buildSnapshot(input: unknown, options: { targetInstanceId: string; chunkRecords?: number; snapshotId?: string }): { manifest: Manifest; chunks: Array<{ descriptor: ChunkDescriptor; bytes: Buffer }> } {
  if (!exactKeys(input, ['format', 'format_version', 'family_id', 'revision', 'exported_at', 'records', 'memberships', 'open_invite_count'])
    || input.format !== CLOUD_EXPORT_FORMAT || input.format_version !== FORMAT_VERSION
    || typeof input.family_id !== 'string' || !UUID.test(input.family_id) || !Array.isArray(input.records) || !Array.isArray(input.memberships)) {
    throw invalidInput('Unsupported cloud export');
  }
  const exported = input as unknown as CloudExport;
  const size = options.chunkRecords ?? 200;
  const records = exported.records.map((r) => ({
    name: r.name, type: r.type, fields: r.fields, deleted: r.deleted, visibility: r.visibility,
    audience_group: r.audience_group ?? null, calendar_name: r.calendar_name ?? null,
  })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const recordCounts: Record<string, number> = {};
  const tombstoneCounts: Record<string, number> = {};
  for (const record of records) {
    recordCounts[record.type] = (recordCounts[record.type] ?? 0) + 1;
    if (record.deleted) tombstoneCounts[record.type] = (tombstoneCounts[record.type] ?? 0) + 1;
  }
  const chunks: Array<{ descriptor: ChunkDescriptor; bytes: Buffer }> = [];
  for (let start = 0, index = 0; start < records.length; start += size, index++) {
    const slice = records.slice(start, start + size);
    const bytes = chunkBytes(exported.family_id, index, slice);
    chunks.push({ bytes, descriptor: { chunk_id: randomUUID(), index, byte_length: bytes.length, sha256: sha256Hex(bytes), record_count: slice.length } });
  }
  const descriptors = chunks.map((chunk) => chunk.descriptor);
  const manifest: Manifest = {
    format: SNAPSHOT_FORMAT, format_version: FORMAT_VERSION, schema_semantics_version: SCHEMA_SEMANTICS_VERSION,
    snapshot_id: options.snapshotId ?? randomUUID(), source_kind: 'cloud', family_id: exported.family_id,
    source_revision: exported.revision, target_instance_id: options.targetInstanceId,
    record_counts: recordCounts, tombstone_counts: tombstoneCounts,
    members: exported.memberships.map((m) => ({ member_record_name: m.member_record_name, role: m.role })),
    open_invite_count: exported.open_invite_count, chunks: descriptors,
    records_sha256: recordsDigest(records as SnapshotRecord[]), total_sha256: totalDigest(descriptors),
  };
  return { manifest, chunks };
}
