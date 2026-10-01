import { randomUUID } from 'node:crypto';
import type { Auth, Principal } from '../auth.ts';
import { audit } from '../auth.ts';
import type { Config } from '../config.ts';
import { transaction, type Db, type Tx } from '../db.ts';
import { ApiError, accessDenied, authRequired, invalidInput, notFound } from '../errors.ts';
import type { Request } from '../http.ts';
import { hashSecret, newSecret, parseSecret, sha256Hex } from '../secrets.ts';
import {
  bindingMismatch, canonicalJson, hashMismatch, parseChunk, parseManifest, recordsDigest, UnsupportedRecord,
  type Limits, type Manifest, type SnapshotRecord,
} from './format.ts';

/**
 * Target-side, quarantined import of a family snapshot (P03).
 *
 * Authority split (10_API_CONTRACT.md access profiles):
 * - prepare / snapshot / verify / abort: the local instance owner's mobile session
 *   plus, for prepare, a fresh confirmation (`family_owner`).
 * - chunk upload: only the purpose-bound transfer credential (`fht_`, `migration_transfer`)
 *   of exactly this migration. It is not a mobile session and grants nothing else.
 *
 * The imported family is created in placement_state 'importing' and is written only
 * through the SECURITY DEFINER import functions (sql/002). Nothing here activates it:
 * activation with a commit proof is P04. Member aliases (member-sb_<uuid>) and their
 * roles are kept as a mapping; no local subject or login is created from the export.
 */

type State = 'STAGING' | 'VERIFIED' | 'BLOCKED' | 'ABORTED';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const stateConflict = (message = 'Migration is not in the expected state') => new ApiError(409, 'MIGRATION_STATE_CONFLICT', message);

function isStateConflict(error: unknown): boolean {
  return error instanceof Error && (error as { code?: string }).code === 'P0001' && error.message === 'MIGRATION_STATE_CONFLICT';
}

interface Row {
  id: string; family_id: string; initiator_family_id: string; state: State; manifest: Manifest; manifest_digest: Buffer;
  request_hash: Buffer; blocker: string | null; verify_result: unknown; operation_id: string;
}

export class Migrations {
  private readonly db: Db;
  private readonly config: Config;
  private readonly auth: Auth;

  constructor(db: Db, config: Config, auth: Auth) {
    this.db = db;
    this.config = config;
    this.auth = auth;
  }

  private get limits(): Limits {
    return {
      maxChunkBytes: this.config.migrationMaxChunkBytes, maxChunkRecords: this.config.migrationMaxChunkRecords,
      maxChunks: this.config.migrationMaxChunks, maxTotalBytes: this.config.migrationMaxTotalBytes,
    };
  }

  private async load(tx: Tx | Db, migrationId: string, lock = false): Promise<Row | undefined> {
    if (!UUID.test(migrationId)) return undefined;
    const { rows } = await tx.query(`select * from famalio.migrations where id=$1 ${lock ? 'for update' : ''}`, [migrationId]);
    return rows[0];
  }

  /** Owner of the family that started the migration; anyone else sees 404 (no existence leak). */
  private async owned(tx: Tx | Db, principal: Principal, migrationId: string, lock = false): Promise<Row> {
    if (principal.role !== 'owner') throw accessDenied();
    const row = await this.load(tx, migrationId, lock);
    if (!row || row.initiator_family_id !== principal.familyId) throw notFound();
    return row;
  }

  async status(tx: Tx | Db, row: Row) {
    const chunks = await tx.query(
      'select chunk_id, received_at is not null as received from famalio.migration_chunks where migration_id=$1 order by chunk_index', [row.id]);
    const family = await tx.query('select placement_state from famalio.families where id=$1', [row.family_id]);
    const instance = await this.auth.instance();
    return {
      migration_id: row.id,
      direction: 'cloud_to_home',
      family_id: row.family_id,
      target_instance_id: instance.instance_id,
      target_state: row.state,
      placement_state: family.rows[0]?.placement_state ?? null,
      snapshot_id: row.manifest.snapshot_id,
      source_revision: row.manifest.source_revision,
      manifest_digest: Buffer.from(row.manifest_digest).toString('hex'),
      chunks_total: chunks.rowCount ?? 0,
      chunks_received: chunks.rows.filter((c) => c.received).length,
      missing_chunk_ids: chunks.rows.filter((c) => !c.received).map((c) => c.chunk_id as string),
      blocker: row.blocker,
      can_abort: row.state !== 'ABORTED',
      verify_result: row.verify_result ?? null,
    };
  }

  private async issueTransfer(tx: Tx, migrationId: string): Promise<string> {
    const token = newSecret('fht');
    await tx.query(
      'update famalio.migrations set transfer_hash=$2, transfer_expires_at=now()+make_interval(secs=>$3), updated_at=now() where id=$1',
      [migrationId, hashSecret(token), this.config.transferTtlSeconds]);
    return token;
  }

  private async insertChunks(tx: Tx, migrationId: string, manifest: Manifest): Promise<void> {
    for (const chunk of manifest.chunks) {
      await tx.query(
        'insert into famalio.migration_chunks(migration_id,chunk_id,chunk_index,sha256,byte_length,record_count) values($1,$2,$3,$4,$5,$6)',
        [migrationId, chunk.chunk_id, chunk.index, Buffer.from(chunk.sha256, 'hex'), chunk.byte_length, chunk.record_count]);
    }
  }

  private async replaceMembers(tx: Tx, migrationId: string, manifest: Manifest): Promise<void> {
    await tx.query('delete from famalio.migration_members where migration_id=$1', [migrationId]);
    for (const member of manifest.members) {
      await tx.query('insert into famalio.migration_members(migration_id,member_record_name,role) values($1,$2,$3)',
        [migrationId, member.member_record_name, member.role]);
    }
  }

  private async checkManifest(raw: unknown) {
    const { manifest, digest, blockers } = parseManifest(raw, this.limits);
    // T029: unsupported mandatory data blocks the migration with a concrete reason.
    if (blockers.length) throw new UnsupportedRecord(blockers);
    const instance = await this.auth.instance();
    if (manifest.target_instance_id !== instance.instance_id) throw bindingMismatch('target');
    return { manifest, digest };
  }

  /**
   * POST /v1/migrations: owner + fresh confirmation. Creates the quarantined family,
   * the chunk ledger and a transfer credential. Replaying the same operation_id with
   * the same manifest returns the same migration and a rotated transfer credential
   * (each issuance needs its own confirmation); a different request is a conflict.
   */
  async prepare(principal: Principal, body: unknown) {
    if (principal.role !== 'owner') throw accessDenied();
    const input = (body ?? {}) as Record<string, unknown>;
    const keys = Object.keys(input).sort().join(',');
    if (keys !== 'confirmation_token,direction,manifest,operation_id') throw invalidInput();
    if (typeof input.operation_id !== 'string' || !UUID.test(input.operation_id) || input.direction !== 'cloud_to_home') throw invalidInput();
    const operationId = input.operation_id;
    const { manifest, digest } = await this.checkManifest(input.manifest);
    const requestHash = Buffer.from(sha256Hex(canonicalJson({ direction: input.direction, manifest_digest: digest })), 'hex');
    try {
      return await transaction(this.db, async (tx) => {
        await tx.query('select 1 from famalio.families where id=$1 for update', [principal.familyId]);
        await this.auth.consumeConfirmation(tx, principal, input.confirmation_token, 'migration_import');
        const prior = (await tx.query('select * from famalio.migrations where operation_id=$1 for update', [operationId])).rows[0] as Row | undefined;
        if (prior) {
          if (prior.initiator_family_id !== principal.familyId || !Buffer.from(prior.request_hash).equals(requestHash)) {
            throw new ApiError(409, 'IDEMPOTENCY_MISMATCH', 'Operation id reused with different content');
          }
          if (prior.state !== 'STAGING') throw stateConflict();
          const transfer = await this.issueTransfer(tx, prior.id);
          return { status: 200, body: { migration: await this.status(tx, prior), transfer_token: transfer } };
        }
        await tx.query('select famalio.begin_import($1)', [manifest.family_id]);
        const migrationId = randomUUID();
        await tx.query(
          `insert into famalio.migrations(id,operation_id,family_id,initiator_family_id,initiated_by,direction,state,manifest,manifest_digest,request_hash)
           values($1,$2,$3,$4,$5,'cloud_to_home','STAGING',$6,$7,$8)`,
          [migrationId, operationId, manifest.family_id, principal.familyId, principal.subjectId, JSON.stringify(manifest), Buffer.from(digest, 'hex'), requestHash]);
        await this.insertChunks(tx, migrationId, manifest);
        await this.replaceMembers(tx, migrationId, manifest);
        const transfer = await this.issueTransfer(tx, migrationId);
        await audit(tx, 'migration.prepared', { familyId: principal.familyId, subjectId: principal.subjectId, deviceId: principal.deviceId });
        const row = (await this.load(tx, migrationId))!;
        return { status: 201, body: { migration: await this.status(tx, row), transfer_token: transfer } };
      });
    } catch (error) {
      if (isStateConflict(error)) throw stateConflict('Family already exists on this server or has an open migration');
      if ((error as { code?: string }).code === '23505') throw stateConflict('Family already exists on this server or has an open migration');
      throw error;
    }
  }

  /** Bearer transfer credential of exactly this migration; mobile tokens and other migrations fail. */
  private async transferRow(request: Request, migrationId: string): Promise<Row> {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) throw authRequired();
    const token = parseSecret(header.slice(7), 'fht');
    if (!token || !UUID.test(migrationId)) throw authRequired();
    const { rows } = await this.db.query(
      'select * from famalio.migrations where id=$1 and transfer_hash=$2 and transfer_expires_at>now()', [migrationId, hashSecret(token)]);
    if (!rows[0]) throw authRequired();
    return rows[0];
  }

  /** Pre-body check for chunk uploads: rejects before the body is read. */
  async authorizeTransfer(request: Request, migrationId: string): Promise<void> {
    await this.transferRow(request, migrationId);
  }

  /** GET /v1/migrations/{id}: owner session of the initiating family, or this migration's transfer credential (resume). */
  async getStatus(request: Request, migrationId: string) {
    const header = request.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer fht_')) {
      return this.status(this.db, await this.transferRow(request, migrationId));
    }
    const principal = await this.auth.authenticate(request);
    return this.status(this.db, await this.owned(this.db, principal, migrationId));
  }

  private async block(migrationId: string, reason: string): Promise<void> {
    await this.db.query("update famalio.migrations set state='BLOCKED', blocker=$2, updated_at=now() where id=$1 and state='STAGING'", [migrationId, reason.slice(0, 500)]);
    await audit(this.db, 'migration.blocked', {});
  }

  /**
   * PUT /v1/migrations/{id}/chunks/{chunk_id} (transfer credential, octet-stream).
   * Bytes are hashed before parsing. Identical re-upload is idempotent; different
   * bytes under a known chunk id are rejected (409) and never replace stored data.
   * Content that matches the manifest hash but is invalid or unsupported blocks the
   * migration: retrying cannot fix a bad snapshot.
   */
  async uploadChunk(request: Request, migrationId: string, chunkId: string) {
    const row = await this.transferRow(request, migrationId);
    if (!UUID.test(chunkId)) throw notFound();
    const bytes = request.body as Buffer;
    const chunk = (await this.db.query(
      'select chunk_index, sha256, byte_length, record_count, received_at from famalio.migration_chunks where migration_id=$1 and chunk_id=$2',
      [migrationId, chunkId])).rows[0];
    if (!chunk) throw notFound();
    const descriptor = { index: chunk.chunk_index, sha256: Buffer.from(chunk.sha256).toString('hex'), byte_length: chunk.byte_length, record_count: chunk.record_count };
    if (bytes.length !== descriptor.byte_length || sha256Hex(bytes) !== descriptor.sha256) throw hashMismatch('Chunk');
    if (chunk.received_at) return { chunk_id: chunkId, received: true, already_received: true };
    if (row.state !== 'STAGING') throw stateConflict();
    let records: SnapshotRecord[];
    try {
      records = parseChunk(bytes, descriptor, row.family_id);
    } catch (error) {
      if (error instanceof ApiError) await this.block(migrationId, error instanceof UnsupportedRecord ? error.message : `INVALID_CHUNK:${descriptor.index}:${error.code}`);
      throw error;
    }
    try {
      await transaction(this.db, async (tx) => {
        await tx.query('select famalio.import_chunk($1,$2,$3)', [migrationId, chunkId, JSON.stringify(records)]);
      });
    } catch (error) {
      if (isStateConflict(error)) {
        // A concurrent identical upload won; report it as the idempotent result.
        const again = await this.db.query('select received_at from famalio.migration_chunks where migration_id=$1 and chunk_id=$2', [migrationId, chunkId]);
        if (again.rows[0]?.received_at) return { chunk_id: chunkId, received: true, already_received: true };
        throw stateConflict();
      }
      if ((error as { code?: string }).code === '23505') {
        await this.block(migrationId, `DUPLICATE_RECORD:${descriptor.index}`);
        throw invalidInput('Record repeated across chunks');
      }
      throw error;
    }
    return { chunk_id: chunkId, received: true, already_received: false };
  }

  /**
   * POST /v1/migrations/{id}/snapshot (owner): replaces the manifest with a newer
   * snapshot of the same family for the same target (pre-transfer -> final snapshot).
   * Chunks with byte-identical content are kept; staged records of every other old
   * chunk are removed, so records changed or deleted at the source in between are
   * replaced by the final state and nothing from the earlier snapshot survives (T024/T025).
   */
  async supersede(principal: Principal, migrationId: string, body: unknown) {
    const input = (body ?? {}) as Record<string, unknown>;
    if (Object.keys(input).join(',') !== 'manifest') throw invalidInput();
    const { manifest, digest } = await this.checkManifest(input.manifest);
    return transaction(this.db, async (tx) => {
      const row = await this.owned(tx, principal, migrationId, true);
      if (row.state === 'ABORTED') throw stateConflict();
      if (manifest.family_id !== row.family_id) throw bindingMismatch('family');
      if (manifest.source_revision < row.manifest.source_revision) throw stateConflict('Snapshot is older than the staged one');
      const old = (await tx.query(
        'select chunk_id, chunk_index, sha256, record_names, received_at from famalio.migration_chunks where migration_id=$1', [migrationId])).rows;
      const keep = new Map<string, { names: string[]; received: Date }>();
      const discard: string[] = [];
      const next = new Map(manifest.chunks.map((c) => [`${c.index}:${c.sha256}`, c]));
      for (const chunk of old) {
        if (!chunk.received_at) continue;
        const key = `${chunk.chunk_index}:${Buffer.from(chunk.sha256).toString('hex')}`;
        if (next.has(key)) keep.set(key, { names: chunk.record_names ?? [], received: chunk.received_at });
        else discard.push(...(chunk.record_names ?? []));
      }
      if (discard.length) await tx.query('select famalio.discard_import_records($1,$2)', [migrationId, discard]);
      await tx.query('delete from famalio.migration_chunks where migration_id=$1', [migrationId]);
      await this.insertChunks(tx, migrationId, manifest);
      for (const [key, kept] of keep) {
        await tx.query('update famalio.migration_chunks set received_at=$3, record_names=$4 where migration_id=$1 and chunk_id=$2',
          [migrationId, next.get(key)!.chunk_id, kept.received, kept.names]);
      }
      await this.replaceMembers(tx, migrationId, manifest);
      await tx.query(
        "update famalio.migrations set manifest=$2, manifest_digest=$3, state='STAGING', blocker=null, verify_result=null, updated_at=now() where id=$1",
        [migrationId, JSON.stringify(manifest), Buffer.from(digest, 'hex')]);
      await audit(tx, 'migration.snapshot_replaced', { familyId: principal.familyId, subjectId: principal.subjectId, deviceId: principal.deviceId });
      return this.status(tx, (await this.load(tx, migrationId))!);
    });
  }

  /**
   * POST /v1/migrations/{id}/verify (owner). Exact reconciliation of the staged
   * family against the manifest: every chunk received, the record-name set equal to
   * the union of the chunks, per-type counts and tombstones equal, and the content
   * digest re-derived from the database equal to records_sha256. Only then the
   * target state becomes VERIFIED and the transfer credential is revoked. The family
   * stays 'importing' either way: VERIFIED is not activation.
   */
  async verify(principal: Principal, migrationId: string, body: unknown) {
    const input = (body ?? {}) as Record<string, unknown>;
    if (typeof input.manifest_digest !== 'string' || !/^[a-f0-9]{64}$/.test(input.manifest_digest)
      || (input.expected_state !== 'STAGING' && input.expected_state !== 'VERIFIED')) throw invalidInput();
    return transaction(this.db, async (tx) => {
      const row = await this.owned(tx, principal, migrationId, true);
      if (row.state !== input.expected_state) throw stateConflict();
      if (Buffer.from(row.manifest_digest).toString('hex') !== input.manifest_digest) throw bindingMismatch('digest');
      const manifest = row.manifest;
      const chunks = (await tx.query('select record_names, received_at from famalio.migration_chunks where migration_id=$1', [migrationId])).rows;
      const missing = chunks.filter((c) => !c.received_at).length;
      const expectedNames = new Set<string>(chunks.flatMap((c) => (c.record_names ?? []) as string[]));
      const stored = (await tx.query(
        `select name, type, fields, deleted, visibility, audience_group, calendar_name
           from famalio.records where family_id=$1`, [row.family_id])).rows as SnapshotRecord[];
      const recordCounts: Record<string, number> = {};
      const tombstoneCounts: Record<string, number> = {};
      for (const record of stored) {
        recordCounts[record.type] = (recordCounts[record.type] ?? 0) + 1;
        if (record.deleted) tombstoneCounts[record.type] = (tombstoneCounts[record.type] ?? 0) + 1;
      }
      const names = new Set(stored.map((r) => r.name));
      const unexpected = stored.filter((r) => !expectedNames.has(r.name)).length;
      const absent = [...expectedNames].filter((n) => !names.has(n)).length;
      const live = new Set(stored.filter((r) => !r.deleted && r.type === 'FC_Member').map((r) => r.name));
      const members = (await tx.query('select member_record_name from famalio.migration_members where migration_id=$1', [migrationId])).rows;
      const sameCounts = (a: Record<string, number>, b: Record<string, number>) =>
        canonicalJson(Object.fromEntries(Object.entries(a).filter(([, n]) => n > 0))) === canonicalJson(Object.fromEntries(Object.entries(b).filter(([, n]) => n > 0)));
      const digest = recordsDigest(stored);
      const checks = {
        all_chunks_received: missing === 0,
        record_set_exact: unexpected === 0 && absent === 0,
        record_counts_equal: sameCounts(recordCounts, manifest.record_counts),
        tombstone_counts_equal: sameCounts(tombstoneCounts, manifest.tombstone_counts),
        records_sha256_equal: digest === manifest.records_sha256,
        family_record_present: stored.some((r) => r.type === 'FC_Family' && r.name === `family-${row.family_id}` && !r.deleted),
      };
      const ok = Object.values(checks).every(Boolean);
      // Informational: a cloud member may not have saved a profile record yet (accept creates none).
      const membersWithoutProfile = members.filter((m) => !live.has(m.member_record_name)).length;
      const result = {
        ok, checks, missing_chunks: missing, unexpected_records: unexpected, absent_records: absent, members_without_profile: membersWithoutProfile,
        record_counts: recordCounts, tombstone_counts: tombstoneCounts, records_sha256: digest,
        expected_records_sha256: manifest.records_sha256, verified_at: new Date().toISOString(),
      };
      if (ok) {
        await tx.query("update famalio.migrations set state='VERIFIED', verify_result=$2, transfer_hash=null, transfer_expires_at=null, updated_at=now() where id=$1",
          [migrationId, JSON.stringify(result)]);
      } else {
        await tx.query("update famalio.migrations set state='STAGING', verify_result=$2, updated_at=now() where id=$1", [migrationId, JSON.stringify(result)]);
      }
      await audit(tx, ok ? 'migration.verified' : 'migration.verify_failed', { familyId: principal.familyId, subjectId: principal.subjectId, deviceId: principal.deviceId });
      return this.status(tx, (await this.load(tx, migrationId))!);
    });
  }

  /** POST /v1/migrations/{id}/abort (owner): removes the quarantined family and revokes the transfer credential. */
  async abort(principal: Principal, migrationId: string) {
    return transaction(this.db, async (tx) => {
      const row = await this.owned(tx, principal, migrationId, true);
      if (row.state === 'ABORTED') return this.status(tx, row);
      await tx.query('select famalio.abort_import($1)', [migrationId]);
      await audit(tx, 'migration.aborted', { familyId: principal.familyId, subjectId: principal.subjectId, deviceId: principal.deviceId });
      return this.status(tx, (await this.load(tx, migrationId))!);
    });
  }
}
