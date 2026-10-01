import { randomUUID } from 'node:crypto';
import type { Config } from './config.ts';
import { transaction, type Db, type Tx } from './db.ts';
import { ApiError, accessDenied, authRequired, invalidInput, notFound, rateLimited, tokenRevoked } from './errors.ts';
import type { Request } from './http.ts';
import { linkMemberRecord, putRecord } from './records.ts';
import { hashSecret, newSecret, parseSecret } from './secrets.ts';

export type Role = 'owner' | 'editor' | 'viewer';

/** Authenticated mobile context. Family and role always come from the database, never the request. */
export interface Principal {
  sessionId: string;
  deviceId: string;
  subjectId: string;
  familyId: string;
  role: Role;
  memberRecordName: string;
}

export interface SessionGrant {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export interface Enrollment {
  instance_id: string;
  recovery_epoch: string;
  family_id: string;
  device_id: string;
  subject_id: string;
  member_record_name: string;
  role: Role;
  session: SessionGrant;
  /** Only in the bootstrap and recovery responses: shown once, stored as a hash. */
  recovery_code?: string;
}

export type ConfirmationPurpose = 'owner_transfer' | 'recovery_code' | 'migration_import' | 'ha_grant_create' | 'ha_grant_revoke';
const CONFIRMATION_PURPOSES: ConfirmationPurpose[] = ['owner_transfer', 'recovery_code', 'migration_import', 'ha_grant_create', 'ha_grant_revoke'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const confirmationRequired = () => new ApiError(403, 'CONFIRMATION_REQUIRED', 'Fresh owner confirmation required');

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };
const MEMBER_NAME = /^member-[A-Za-z0-9_-]{1,100}$/;

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= max ? trimmed : null;
}

export async function audit(tx: Tx | Db, action: string, ids: { familyId?: string | null; subjectId?: string | null; deviceId?: string | null }) {
  await tx.query('insert into famalio.audit_log(family_id,subject_id,device_id,action) values($1,$2,$3,$4)',
    [ids.familyId ?? null, ids.subjectId ?? null, ids.deviceId ?? null, action]);
}

/** Simple fixed-window limiter for unauthenticated endpoints (SEC-03 manual codes / pairing). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }
  check(key: string, now = Date.now()): void {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    entry.count += 1;
    if (entry.count > this.limit) throw rateLimited(Math.ceil((entry.resetAt - now) / 1000));
  }
}

export class Auth {
  private readonly db: Db;
  private readonly config: Config;
  readonly limiter: RateLimiter;

  constructor(db: Db, config: Config) {
    this.db = db;
    this.config = config;
    this.limiter = new RateLimiter(config.unauthenticatedRatePerMinute, 60_000);
  }

  async instance(): Promise<{ instance_id: string; recovery_epoch: string }> {
    const { rows } = await this.db.query('select instance_id, recovery_epoch from famalio.instance');
    if (!rows[0]) throw new ApiError(503, 'UNAVAILABLE', 'Instance not initialised');
    return { instance_id: rows[0].instance_id, recovery_epoch: rows[0].recovery_epoch };
  }

  /**
   * Creates a one-time owner setup code when no owner exists yet. The caller prints it
   * to the local console only; possession of the host console is the documented trust
   * anchor for bootstrap (ADR-002 §2). Returns null when a family already exists.
   */
  async createSetupCodeIfUnclaimed(): Promise<string | null> {
    return transaction(this.db, async (tx) => {
      await tx.query('lock table famalio.setup_codes in exclusive mode');
      const owners = await tx.query("select 1 from famalio.subjects where role='owner' and removed_at is null limit 1");
      if (owners.rowCount) return null;
      await tx.query('delete from famalio.setup_codes where used_at is null');
      const code = newSecret('fhs');
      await tx.query("insert into famalio.setup_codes(code_hash, expires_at) values($1, now() + make_interval(secs => $2))",
        [hashSecret(code), this.config.setupTtlSeconds]);
      await audit(tx, 'setup.code_created', {});
      return code;
    });
  }

  /** POST /v1/setup/owner: exchanges the console setup code for the first owner device. */
  async bootstrapOwner(request: Request): Promise<Enrollment> {
    this.limiter.check(`setup:${request.remoteAddress}`);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const code = parseSecret(body.setup_code, 'fhs');
    const deviceName = text(body.device_display_name, 80);
    const familyName = text(body.family_name, 100);
    const ownerName = text(body.owner_display_name, 100);
    if (!code || !deviceName || !familyName || !ownerName) throw invalidInput();
    return transaction(this.db, async (tx) => {
      await tx.query('lock table famalio.setup_codes in exclusive mode');
      const found = await tx.query(
        'select code_hash from famalio.setup_codes where code_hash=$1 and used_at is null and expires_at>now()', [hashSecret(code)]);
      if (!found.rowCount) throw authRequired();
      const owners = await tx.query("select 1 from famalio.subjects where role='owner' and removed_at is null limit 1");
      if (owners.rowCount) throw authRequired();
      await tx.query('update famalio.setup_codes set used_at=now() where code_hash=$1', [hashSecret(code)]);
      const familyId = randomUUID();
      const subjectId = randomUUID();
      await tx.query('insert into famalio.families(id) values($1)', [familyId]);
      const member = `member-hm_${subjectId}`;
      await tx.query("insert into famalio.subjects(id,family_id,member_record_name,role) values($1,$2,$3,'owner')",
        [subjectId, familyId, member]);
      await putRecord(tx, familyId, `family-${familyId}`, 'FC_Family', {
        name: { type: 'string', value: familyName }, colorHex: { type: 'string', value: '#8F7CFF' } });
      await linkMemberRecord(tx, familyId, member, 'owner', ownerName);
      const enrollment = await this.enroll(tx, familyId, subjectId, member, 'owner', deviceName);
      const recoveryCode = await this.replaceRecoveryCode(tx, familyId);
      await audit(tx, 'setup.owner_bootstrapped', { familyId, subjectId, deviceId: enrollment.device_id });
      return { ...enrollment, recovery_code: recoveryCode };
    });
  }

  private async enroll(tx: Tx, familyId: string, subjectId: string, member: string, role: Role, deviceName: string): Promise<Enrollment> {
    const deviceId = randomUUID();
    await tx.query('insert into famalio.devices(id,subject_id,display_name) values($1,$2,$3)', [deviceId, subjectId, deviceName]);
    const session = await this.issueSession(tx, deviceId);
    const instance = (await tx.query('select instance_id, recovery_epoch from famalio.instance')).rows[0];
    return {
      instance_id: instance.instance_id, recovery_epoch: instance.recovery_epoch, family_id: familyId,
      device_id: deviceId, subject_id: subjectId, member_record_name: member, role, session,
    };
  }

  private async issueSession(tx: Tx, deviceId: string, sessionId = randomUUID()): Promise<SessionGrant> {
    const access = newSecret('fha');
    const refresh = newSecret('fhr');
    await tx.query(
      `insert into famalio.sessions(id,device_id,access_hash,access_expires_at,refresh_expires_at)
       values($1,$2,$3,now()+make_interval(secs=>$4),now()+make_interval(secs=>$5))
       on conflict (id) do update set access_hash=excluded.access_hash, access_expires_at=excluded.access_expires_at,
         refresh_expires_at=excluded.refresh_expires_at`,
      [sessionId, deviceId, hashSecret(access), this.config.accessTtlSeconds, this.config.refreshTtlSeconds]);
    await tx.query('insert into famalio.refresh_tokens(token_hash,session_id) values($1,$2)', [hashSecret(refresh), sessionId]);
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: this.config.accessTtlSeconds };
  }

  /**
   * Resolves the bearer access token. Device revocation, subject removal, role and
   * family are re-read on every request (SEC-04). Any other credential type fails.
   */
  async authenticate(request: Request): Promise<Principal> {
    const header = request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) throw authRequired();
    const token = parseSecret(header.slice(7), 'fha');
    if (!token) throw authRequired();
    const { rows } = await this.db.query(
      `select s.id as session_id, s.revoked_at as session_revoked, s.access_expires_at > now() as fresh,
              d.id as device_id, d.revoked_at as device_revoked,
              sub.id as subject_id, sub.family_id, sub.role, sub.member_record_name, sub.removed_at
         from famalio.sessions s
         join famalio.devices d on d.id = s.device_id
         join famalio.subjects sub on sub.id = d.subject_id
        where s.access_hash = $1`, [hashSecret(token)]);
    const row = rows[0];
    if (!row) throw authRequired();
    if (row.session_revoked || row.device_revoked || row.removed_at) throw tokenRevoked();
    if (!row.fresh) throw authRequired();
    await this.db.query('update famalio.devices set last_seen_at=now() where id=$1 and (last_seen_at is null or last_seen_at < now() - interval \'5 minutes\')', [row.device_id]);
    return {
      sessionId: row.session_id, deviceId: row.device_id, subjectId: row.subject_id,
      familyId: row.family_id, role: row.role, memberRecordName: row.member_record_name,
    };
  }

  /** POST /v1/auth/refresh: rotates both credentials; reuse of a rotated refresh token revokes the session. */
  async refresh(request: Request): Promise<SessionGrant> {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const token = parseSecret(body.refresh_token, 'fhr');
    if (!token) throw authRequired();
    const outcome = await transaction(this.db, async (tx): Promise<{ reused: true } | { reused: false; grant: SessionGrant }> => {
      const { rows } = await tx.query(
        `select r.session_id, r.rotated_at, s.revoked_at, s.refresh_expires_at > now() as fresh,
                d.id as device_id, d.revoked_at as device_revoked, sub.removed_at, sub.family_id, sub.id as subject_id
           from famalio.refresh_tokens r
           join famalio.sessions s on s.id = r.session_id
           join famalio.devices d on d.id = s.device_id
           join famalio.subjects sub on sub.id = d.subject_id
          where r.token_hash = $1 for update of r, s`, [hashSecret(token)]);
      const row = rows[0];
      if (!row) throw authRequired();
      const ids = { familyId: row.family_id, subjectId: row.subject_id, deviceId: row.device_id };
      if (row.rotated_at) {
        await tx.query("update famalio.sessions set revoked_at=coalesce(revoked_at,now()), revoke_reason='refresh_reuse' where id=$1", [row.session_id]);
        await audit(tx, 'session.refresh_reuse_revoked', ids);
        return { reused: true };
      }
      if (row.revoked_at || row.device_revoked || row.removed_at) throw tokenRevoked();
      if (!row.fresh) throw authRequired();
      await tx.query('update famalio.refresh_tokens set rotated_at=now() where token_hash=$1', [hashSecret(token)]);
      const grant = await this.issueSession(tx, row.device_id, row.session_id);
      await audit(tx, 'session.refreshed', ids);
      return { reused: false, grant };
    });
    // The reuse revocation commits first; only then is the error reported.
    if (outcome.reused) throw tokenRevoked();
    return outcome.grant;
  }

  async logout(principal: Principal): Promise<void> {
    await this.db.query("update famalio.sessions set revoked_at=now(), revoke_reason='logout' where id=$1 and revoked_at is null", [principal.sessionId]);
    await audit(this.db, 'session.logout', { familyId: principal.familyId, subjectId: principal.subjectId, deviceId: principal.deviceId });
  }

  /** POST /v1/pairing/offers (owner): QR secret, 256 bit, 5 min, single use. */
  async createPairingOffer(principal: Principal, body: unknown): Promise<{ offer_id: string; pairing_secret: string; expires_at: string; max_role: Role }> {
    if (principal.role !== 'owner') throw accessDenied();
    const maxRole = (body as Record<string, unknown> | undefined)?.max_role ?? 'editor';
    if (maxRole !== 'editor' && maxRole !== 'viewer') throw invalidInput();
    const secret = newSecret('fhp');
    const offerId = randomUUID();
    const { rows } = await this.db.query(
      `insert into famalio.pairing_offers(id,family_id,created_by,secret_hash,max_role,expires_at)
       values($1,$2,$3,$4,$5,now()+make_interval(secs=>$6)) returning expires_at`,
      [offerId, principal.familyId, principal.subjectId, hashSecret(secret), maxRole, this.config.pairingTtlSeconds]);
    await audit(this.db, 'pairing.offer_created', { familyId: principal.familyId, subjectId: principal.subjectId, deviceId: principal.deviceId });
    return { offer_id: offerId, pairing_secret: secret, expires_at: new Date(rows[0].expires_at).toISOString(), max_role: maxRole };
  }

  /** POST /v1/pairing/requests (new device): consumes the offer exactly once. */
  async requestPairing(request: Request): Promise<{ pairing_id: string; state: string; expires_at: string; claim_secret: string }> {
    this.limiter.check(`pair:${request.remoteAddress}`);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const secret = parseSecret(body.pairing_secret, 'fhp');
    const deviceName = text(body.device_display_name, 80);
    if (!secret || !deviceName) throw invalidInput();
    return transaction(this.db, async (tx) => {
      const { rows } = await tx.query(
        `select id, family_id, expires_at from famalio.pairing_offers
          where secret_hash=$1 and consumed_at is null and expires_at>now() for update`, [hashSecret(secret)]);
      const offer = rows[0];
      if (!offer) throw authRequired();
      await tx.query('update famalio.pairing_offers set consumed_at=now() where id=$1', [offer.id]);
      const claim = newSecret('fhc');
      const pairingId = randomUUID();
      await tx.query(
        `insert into famalio.pairing_requests(id,offer_id,family_id,device_display_name,claim_hash,expires_at)
         values($1,$2,$3,$4,$5,$6)`, [pairingId, offer.id, offer.family_id, deviceName, hashSecret(claim), offer.expires_at]);
      await audit(tx, 'pairing.requested', { familyId: offer.family_id });
      return { pairing_id: pairingId, state: 'pending', expires_at: new Date(offer.expires_at).toISOString(), claim_secret: claim };
    });
  }

  /** GET /v1/pairing/requests (owner): pending requests with the displayed device name. */
  async pendingPairings(principal: Principal) {
    if (principal.role !== 'owner') throw accessDenied();
    const { rows } = await this.db.query(
      `select id, device_display_name, expires_at from famalio.pairing_requests
        where family_id=$1 and state='pending' and expires_at>now() order by created_at`, [principal.familyId]);
    return rows.map((row) => ({ pairing_id: row.id, device_display_name: row.device_display_name, expires_at: new Date(row.expires_at).toISOString() }));
  }

  /**
   * POST /v1/pairing/requests/{id}/approve (owner). Binds the request to a member
   * profile and a role no higher than the offer allows. Never grants owner.
   */
  async approvePairing(principal: Principal, pairingId: string, body: unknown): Promise<{ pairing_id: string; state: string }> {
    if (principal.role !== 'owner') throw accessDenied();
    const input = (body ?? {}) as Record<string, unknown>;
    const role = input.role;
    const member = input.member_record_name;
    if ((role !== 'editor' && role !== 'viewer') || (member !== undefined && (typeof member !== 'string' || !MEMBER_NAME.test(member)))) throw invalidInput();
    if (input.decision !== undefined && input.decision !== 'approve' && input.decision !== 'deny') throw invalidInput();
    return transaction(this.db, async (tx) => {
      const { rows } = await tx.query(
        `select r.id, r.state, r.expires_at > now() as fresh, o.max_role
           from famalio.pairing_requests r join famalio.pairing_offers o on o.id = r.offer_id
          where r.id=$1 and r.family_id=$2 for update of r`, [pairingId, principal.familyId]);
      const row = rows[0];
      if (!row) throw notFound();
      if (row.state !== 'pending' || !row.fresh) throw new ApiError(409, 'PAIRING_STATE_CONFLICT', 'Pairing is no longer pending');
      if (input.decision === 'deny') {
        await tx.query("update famalio.pairing_requests set state='denied', approved_by=$2 where id=$1", [pairingId, principal.subjectId]);
        await audit(tx, 'pairing.denied', { familyId: principal.familyId, subjectId: principal.subjectId });
        return { pairing_id: pairingId, state: 'denied' };
      }
      if (ROLE_RANK[role as Role] > ROLE_RANK[row.max_role as Role]) throw accessDenied();
      if (typeof member === 'string') {
        // An existing active subject cannot be re-bound by pairing (no takeover via profile name).
        const taken = await tx.query('select 1 from famalio.subjects where family_id=$1 and member_record_name=$2 and removed_at is null', [principal.familyId, member]);
        if (taken.rowCount) throw new ApiError(409, 'MEMBER_ALREADY_LINKED', 'Profile already has a signed-in account');
      }
      await tx.query("update famalio.pairing_requests set state='approved', approved_by=$2, role=$3, member_record_name=$4 where id=$1",
        [pairingId, principal.subjectId, role, member ?? null]);
      await audit(tx, 'pairing.approved', { familyId: principal.familyId, subjectId: principal.subjectId });
      return { pairing_id: pairingId, state: 'approved' };
    });
  }

  /** POST /v1/pairing/requests/{id}/status (new device, claim secret in body). */
  async pairingStatus(request: Request, pairingId: string) {
    this.limiter.check(`pair:${request.remoteAddress}`);
    const claim = parseSecret((request.body as Record<string, unknown> | undefined)?.claim_secret, 'fhc');
    if (!claim) throw authRequired();
    const { rows } = await this.db.query(
      'select state, expires_at, expires_at > now() as fresh from famalio.pairing_requests where id=$1 and claim_hash=$2', [pairingId, hashSecret(claim)]);
    const row = rows[0];
    if (!row) throw authRequired();
    const state = row.state === 'claimed' || row.state === 'denied' || row.fresh ? row.state : 'expired';
    return { pairing_id: pairingId, state, expires_at: new Date(row.expires_at).toISOString() };
  }

  /**
   * POST /v1/pairing/requests/{id}/claim: the new device redeems the owner's approval.
   * Row lock + state check make concurrent claims yield at most one enrollment (SEC-03).
   */
  async claimPairing(request: Request, pairingId: string): Promise<Enrollment> {
    this.limiter.check(`pair:${request.remoteAddress}`);
    const claim = parseSecret((request.body as Record<string, unknown> | undefined)?.claim_secret, 'fhc');
    if (!claim) throw authRequired();
    const displayName = text((request.body as Record<string, unknown>).display_name, 100);
    return transaction(this.db, async (tx) => {
      const { rows } = await tx.query(
        `select id, family_id, state, role, member_record_name, device_display_name, expires_at > now() as fresh
           from famalio.pairing_requests where id=$1 and claim_hash=$2 for update`, [pairingId, hashSecret(claim)]);
      const row = rows[0];
      if (!row) throw authRequired();
      if (row.state !== 'approved' || !row.fresh) throw new ApiError(409, 'PAIRING_STATE_CONFLICT', 'Pairing is not approved or has expired');
      const subjectId = randomUUID();
      const member = row.member_record_name ?? `member-hm_${subjectId}`;
      await tx.query('insert into famalio.subjects(id,family_id,member_record_name,role) values($1,$2,$3,$4)',
        [subjectId, row.family_id, member, row.role]);
      await tx.query("update famalio.pairing_requests set state='claimed' where id=$1", [pairingId]);
      await tx.query('select 1 from famalio.families where id=$1 for update', [row.family_id]);
      await linkMemberRecord(tx, row.family_id, member, row.role, displayName ?? row.device_display_name);
      const enrollment = await this.enroll(tx, row.family_id, subjectId, member, row.role, row.device_display_name);
      await audit(tx, 'pairing.claimed', { familyId: row.family_id, subjectId, deviceId: enrollment.device_id });
      return enrollment;
    });
  }

  async devices(principal: Principal) {
    const ownerView = principal.role === 'owner';
    const { rows } = await this.db.query(
      `select d.id, d.display_name, d.created_at, d.last_seen_at, d.revoked_at, s.id as subject_id, s.member_record_name, s.role
         from famalio.devices d join famalio.subjects s on s.id = d.subject_id
        where s.family_id=$1 and s.removed_at is null and ($2 or s.id=$3) order by d.created_at`,
      [principal.familyId, ownerView, principal.subjectId]);
    return rows.map((row) => ({
      device_id: row.id, display_name: row.display_name, subject_id: row.subject_id,
      member_record_name: row.member_record_name, role: row.role, current: row.id === principal.deviceId,
      created_at: new Date(row.created_at).toISOString(), revoked: row.revoked_at !== null,
    }));
  }

  /** Owner may revoke any device of the family; everyone may revoke their own devices. */
  async revokeDevice(principal: Principal, deviceId: string): Promise<void> {
    await transaction(this.db, async (tx) => {
      const { rows } = await tx.query(
        `select d.id, s.id as subject_id from famalio.devices d join famalio.subjects s on s.id=d.subject_id
          where d.id=$1 and s.family_id=$2 for update of d`, [deviceId, principal.familyId]);
      const row = rows[0];
      if (!row) throw notFound();
      if (principal.role !== 'owner' && row.subject_id !== principal.subjectId) throw accessDenied();
      await tx.query('update famalio.devices set revoked_at=coalesce(revoked_at,now()) where id=$1', [deviceId]);
      await tx.query("update famalio.sessions set revoked_at=coalesce(revoked_at,now()), revoke_reason='device_revoked' where device_id=$1", [deviceId]);
      await audit(tx, 'device.revoked', { familyId: principal.familyId, subjectId: principal.subjectId, deviceId });
    });
  }

  /** Owner changes another subject's role (never to/from owner; owner transfer is a separate flow). */
  async setRole(principal: Principal, subjectId: string, body: unknown): Promise<void> {
    if (principal.role !== 'owner') throw accessDenied();
    const role = (body as Record<string, unknown> | undefined)?.role;
    if (role !== 'editor' && role !== 'viewer') throw invalidInput();
    await transaction(this.db, async (tx) => {
      await tx.query('select 1 from famalio.families where id=$1 for update', [principal.familyId]);
      const { rows } = await tx.query(
        "update famalio.subjects set role=$3 where id=$1 and family_id=$2 and role<>'owner' and removed_at is null returning member_record_name",
        [subjectId, principal.familyId, role]);
      if (!rows[0]) throw notFound();
      const profile = await tx.query("select fields->'displayName'->>'value' as name from famalio.records where family_id=$1 and name=$2", [principal.familyId, rows[0].member_record_name]);
      await linkMemberRecord(tx, principal.familyId, rows[0].member_record_name, role, profile.rows[0]?.name ?? 'Member');
      await republishRoleDependent(tx, principal.familyId);
      await audit(tx, 'subject.role_changed', { familyId: principal.familyId, subjectId: principal.subjectId });
    });
  }

  // ---------------------------------------------------------------------------
  // Owner-critical actions (P02.2): fresh confirmation, recovery code, transfer.
  // ---------------------------------------------------------------------------

  /**
   * POST /v1/owner/confirmations (owner). Step-up for owner-critical actions: the
   * owner device proves possession of its *current* refresh credential, which lives
   * in Keychain/Keystore behind user presence and is never sent with normal
   * requests. A leaked access token alone therefore cannot transfer ownership,
   * rotate the recovery code or start an import. The confirmation is single use,
   * short-lived and bound to this session, the purpose and an optional target.
   */
  async createConfirmation(principal: Principal, body: unknown): Promise<{ confirmation_token: string; purpose: ConfirmationPurpose; expires_at: string }> {
    if (principal.role !== 'owner') throw accessDenied();
    const input = (body ?? {}) as Record<string, unknown>;
    const purpose = input.purpose as ConfirmationPurpose;
    if (!CONFIRMATION_PURPOSES.includes(purpose)) throw invalidInput();
    const target = input.target;
    if (target !== undefined && (typeof target !== 'string' || !UUID.test(target))) throw invalidInput();
    const refresh = parseSecret(input.refresh_token, 'fhr');
    if (!refresh) throw confirmationRequired();
    const current = await this.db.query(
      'select 1 from famalio.refresh_tokens where token_hash=$1 and session_id=$2 and rotated_at is null', [hashSecret(refresh), principal.sessionId]);
    if (!current.rowCount) {
      await audit(this.db, 'owner.confirmation_failed', { familyId: principal.familyId, subjectId: principal.subjectId, deviceId: principal.deviceId });
      throw confirmationRequired();
    }
    const token = newSecret('fho');
    const { rows } = await this.db.query(
      `insert into famalio.confirmations(token_hash,session_id,purpose,target,expires_at)
       values($1,$2,$3,$4,now()+make_interval(secs=>$5)) returning expires_at`,
      [hashSecret(token), principal.sessionId, purpose, typeof target === 'string' ? target.toLowerCase() : null, this.config.confirmationTtlSeconds]);
    await audit(this.db, 'owner.confirmation_created', { familyId: principal.familyId, subjectId: principal.subjectId, deviceId: principal.deviceId });
    return { confirmation_token: token, purpose, expires_at: new Date(rows[0].expires_at).toISOString() };
  }

  /** Consumes a confirmation inside the caller's transaction; throws CONFIRMATION_REQUIRED otherwise. */
  async consumeConfirmation(tx: Tx, principal: Principal, value: unknown, purpose: ConfirmationPurpose, target: string | null = null): Promise<void> {
    const token = parseSecret(value, 'fho');
    if (!token) throw confirmationRequired();
    const { rowCount } = await tx.query(
      `update famalio.confirmations c set used_at=now()
        from famalio.sessions s
       where c.token_hash=$1 and c.session_id=$2 and c.purpose=$3 and c.target is not distinct from $4
         and c.used_at is null and c.expires_at>now() and s.id=c.session_id and s.revoked_at is null`,
      [hashSecret(token), principal.sessionId, purpose, target]);
    if (!rowCount) throw confirmationRequired();
  }

  private async replaceRecoveryCode(tx: Tx, familyId: string): Promise<string> {
    const code = newSecret('fhk');
    await tx.query(
      `insert into famalio.owner_recovery_codes(family_id,code_hash) values($1,$2)
       on conflict (family_id) do update set code_hash=excluded.code_hash, created_at=now()`, [familyId, hashSecret(code)]);
    return code;
  }

  /** POST /v1/owner/recovery-code (owner + confirmation): replaces the recovery code; the old one stops working. */
  async rotateRecoveryCode(principal: Principal, body: unknown): Promise<{ recovery_code: string }> {
    if (principal.role !== 'owner') throw accessDenied();
    return transaction(this.db, async (tx) => {
      await tx.query('select 1 from famalio.families where id=$1 for update', [principal.familyId]);
      await this.consumeConfirmation(tx, principal, (body as Record<string, unknown> | undefined)?.confirmation_token, 'recovery_code');
      const code = await this.replaceRecoveryCode(tx, principal.familyId);
      await audit(tx, 'owner.recovery_code_rotated', { familyId: principal.familyId, subjectId: principal.subjectId, deviceId: principal.deviceId });
      return { recovery_code: code };
    });
  }

  /**
   * POST /v1/owner/recover (unauthenticated, rate limited): the one-time recovery code
   * enrolls a new device for the current owner subject (same member alias), revokes
   * every other device and session of that owner, and returns a new recovery code.
   * Other members' devices are untouched.
   */
  async recoverOwner(request: Request): Promise<Enrollment> {
    this.limiter.check(`recover:${request.remoteAddress}`);
    const body = (request.body ?? {}) as Record<string, unknown>;
    const code = parseSecret(body.recovery_code, 'fhk');
    const deviceName = text(body.device_display_name, 80);
    if (!code || !deviceName) throw invalidInput();
    return transaction(this.db, async (tx) => {
      const found = await tx.query('select family_id from famalio.owner_recovery_codes where code_hash=$1 for update', [hashSecret(code)]);
      const familyId = found.rows[0]?.family_id as string | undefined;
      if (!familyId) throw authRequired();
      await tx.query('select 1 from famalio.families where id=$1 for update', [familyId]);
      const owner = await tx.query("select id, member_record_name from famalio.subjects where family_id=$1 and role='owner' and removed_at is null", [familyId]);
      if (!owner.rows[0]) throw authRequired();
      const subjectId = owner.rows[0].id as string;
      await tx.query('update famalio.devices set revoked_at=coalesce(revoked_at,now()) where subject_id=$1', [subjectId]);
      await tx.query(
        "update famalio.sessions set revoked_at=coalesce(revoked_at,now()), revoke_reason='owner_recovery' where device_id in (select id from famalio.devices where subject_id=$1)",
        [subjectId]);
      const enrollment = await this.enroll(tx, familyId, subjectId, owner.rows[0].member_record_name, 'owner', deviceName);
      const recoveryCode = await this.replaceRecoveryCode(tx, familyId);
      await audit(tx, 'owner.recovered', { familyId, subjectId, deviceId: enrollment.device_id });
      return { ...enrollment, recovery_code: recoveryCode };
    });
  }

  /**
   * POST /v1/owner/transfer (owner + confirmation bound to the target subject). The
   * target must be an active editor of the same family with a non-revoked device.
   * The previous owner becomes editor. The recovery code is deleted so the previous
   * owner cannot reclaim ownership; the new owner creates one with a confirmation.
   */
  async transferOwnership(principal: Principal, body: unknown): Promise<{ owner_subject_id: string; previous_owner_role: Role }> {
    if (principal.role !== 'owner') throw accessDenied();
    const input = (body ?? {}) as Record<string, unknown>;
    const target = input.subject_id;
    if (typeof target !== 'string' || !UUID.test(target)) throw invalidInput();
    const targetId = target.toLowerCase();
    if (targetId === principal.subjectId) throw invalidInput();
    return transaction(this.db, async (tx) => {
      await tx.query('select 1 from famalio.families where id=$1 for update', [principal.familyId]);
      await this.consumeConfirmation(tx, principal, input.confirmation_token, 'owner_transfer', targetId);
      const me = await tx.query('select role from famalio.subjects where id=$1 and family_id=$2 and removed_at is null for update', [principal.subjectId, principal.familyId]);
      if (me.rows[0]?.role !== 'owner') throw accessDenied();
      const { rows } = await tx.query(
        `select s.id, s.role, s.member_record_name,
                exists(select 1 from famalio.devices d where d.subject_id=s.id and d.revoked_at is null) as has_device
           from famalio.subjects s where s.id=$1 and s.family_id=$2 and s.removed_at is null for update`, [targetId, principal.familyId]);
      const candidate = rows[0];
      if (!candidate) throw notFound();
      if (candidate.role !== 'editor' || !candidate.has_device) throw new ApiError(409, 'TRANSFER_TARGET_INELIGIBLE', 'Target must be an editor with an active device');
      // Demote first: the partial unique index allows exactly one active owner.
      await tx.query("update famalio.subjects set role='editor' where id=$1", [principal.subjectId]);
      await tx.query("update famalio.subjects set role='owner' where id=$1", [targetId]);
      const changes: Array<[string, Role]> = [[principal.memberRecordName, 'editor'], [candidate.member_record_name, 'owner']];
      for (const [member, role] of changes) {
        const profile = await tx.query("select fields->'displayName'->>'value' as name from famalio.records where family_id=$1 and name=$2", [principal.familyId, member]);
        await linkMemberRecord(tx, principal.familyId, member, role, profile.rows[0]?.name ?? 'Member');
      }
      await republishRoleDependent(tx, principal.familyId);
      // The previous owner must not be able to reclaim ownership with an old code or confirmation.
      await tx.query('delete from famalio.owner_recovery_codes where family_id=$1', [principal.familyId]);
      await tx.query(
        'update famalio.confirmations set used_at=coalesce(used_at,now()) where session_id in (select s.id from famalio.sessions s join famalio.devices d on d.id=s.device_id where d.subject_id=$1)',
        [principal.subjectId]);
      await audit(tx, 'owner.transferred', { familyId: principal.familyId, subjectId: principal.subjectId, deviceId: principal.deviceId });
      return { owner_subject_id: targetId, previous_owner_role: 'editor' };
    });
  }
}

/**
 * Role-dependent records get a new revision so delta clients receive the grant or
 * revocation (as the cloud `participant` action does for parentsOnly records).
 */
async function republishRoleDependent(tx: Tx, familyId: string): Promise<void> {
  const affected = await tx.query(
    "select name from famalio.records where family_id=$1 and not deleted and (visibility='parentsOnly' or audience_group is not null or calendar_name is not null) order by revision",
    [familyId]);
  for (const record of affected.rows) {
    const next = await tx.query('update famalio.families set revision=revision+1 where id=$1 returning revision', [familyId]);
    await tx.query('update famalio.records set revision=$3 where family_id=$1 and name=$2', [familyId, record.name, next.rows[0].revision]);
  }
}
