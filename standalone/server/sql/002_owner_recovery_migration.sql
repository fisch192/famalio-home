-- Famalio Home schema v2: owner recovery/transfer, journal retention and the
-- quarantined migration import (P02 remainder, P03). Applied by the schema owner.

-- Journal retention (P02): tombstones older than the retention window are purged;
-- journal_floor is the highest purged revision. A delta cursor below it can no
-- longer see every deletion and is answered with 410 CURSOR_EXPIRED.
alter table famalio.families add column journal_floor bigint not null default 0;
alter table famalio.records add column deleted_at timestamptz;
update famalio.records set deleted_at = now() where deleted and deleted_at is null;

-- One-time owner recovery code per family (256 bit, SHA-256 only). Shown once.
create table famalio.owner_recovery_codes(
  family_id uuid primary key references famalio.families(id) on delete cascade,
  code_hash bytea not null unique check (octet_length(code_hash) = 32),
  created_at timestamptz not null default now()
);

-- Fresh confirmations for owner-critical actions: short-lived, single use, bound to
-- the session that proved possession of its current refresh credential, a purpose
-- and (optionally) a target.
create table famalio.confirmations(
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  session_id uuid not null references famalio.sessions(id) on delete cascade,
  purpose text not null check (purpose in ('owner_transfer','recovery_code','migration_import')),
  target text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Inbound (target-side) migration. family_id is the imported family, created in
-- placement_state 'importing' by famalio.begin_import and never activated here.
-- No foreign key to families: an abort deletes the quarantined family but keeps
-- this row as the durable record of the decision.
create table famalio.migrations(
  id uuid primary key,
  operation_id uuid not null unique,
  family_id uuid not null,
  initiator_family_id uuid not null references famalio.families(id) on delete cascade,
  initiated_by uuid not null references famalio.subjects(id) on delete cascade,
  direction text not null check (direction = 'cloud_to_home'),
  state text not null check (state in ('STAGING','VERIFIED','BLOCKED','ABORTED')),
  manifest jsonb not null,
  manifest_digest bytea not null check (octet_length(manifest_digest) = 32),
  request_hash bytea not null check (octet_length(request_hash) = 32),
  blocker text,
  transfer_hash bytea unique check (octet_length(transfer_hash) = 32),
  transfer_expires_at timestamptz,
  verify_result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index migrations_one_open_per_family on famalio.migrations(family_id) where state <> 'ABORTED';

create table famalio.migration_chunks(
  migration_id uuid not null references famalio.migrations(id) on delete cascade,
  chunk_id uuid not null,
  chunk_index int not null check (chunk_index >= 0),
  sha256 bytea not null check (octet_length(sha256) = 32),
  byte_length int not null check (byte_length > 0),
  record_count int not null check (record_count >= 0),
  record_names text[],
  received_at timestamptz,
  primary key (migration_id, chunk_id),
  unique (migration_id, chunk_index)
);

-- Membership role mapping from the export: business alias -> role. No accounts,
-- e-mails or credentials; local subjects are created only by individual pairing.
create table famalio.migration_members(
  migration_id uuid not null references famalio.migrations(id) on delete cascade,
  member_record_name text not null check (member_record_name ~ '^member-sb_[0-9a-f-]{36}$'),
  role text not null check (role in ('owner','editor','viewer')),
  primary key (migration_id, member_record_name)
);

-- Placement fence, extended: an 'importing' family accepts record writes only when
-- they execute inside one of the import functions below. Those are SECURITY DEFINER
-- functions owned by the schema owner, so inside them current_user is the schema
-- owner. The runtime role can set any custom GUC, which is why a transaction-local
-- setting is NOT used as the gate: current_user cannot be forged by famalio_app
-- (no SET ROLE membership in the owner role). Combined with the column privileges
-- from src/migrate.ts (famalio_app may neither create 'importing' families nor
-- change placement_state), the runtime role can reach a non-active family only
-- through these validated functions, and never write into 'fenced'/'retired' ones.
create or replace function famalio.enforce_active_placement() returns trigger
language plpgsql set search_path = '' as $$
declare state text;
begin
  select placement_state into state from famalio.families where id = new.family_id;
  if state = 'active' then return new; end if;
  if state = 'importing' and current_user = (
      select pg_catalog.pg_get_userbyid(n.nspowner) from pg_catalog.pg_namespace n where n.nspname = 'famalio') then
    return new;
  end if;
  raise exception 'PLACEMENT_CHANGED' using errcode = 'P0001';
end $$;

-- Creates the quarantined target family. It is never 'active' here (P04 activates).
create function famalio.begin_import(p_family uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from famalio.families where id = p_family) then
    raise exception 'MIGRATION_STATE_CONFLICT' using errcode = 'P0001';
  end if;
  insert into famalio.families(id, placement_state) values (p_family, 'importing');
end $$;

-- Writes one validated chunk. Re-checks state below the application: the migration
-- must be STAGING, the chunk listed and not yet received, the family 'importing'.
-- Record names are unique per family, so a record repeated in another chunk fails.
create function famalio.import_chunk(p_migration uuid, p_chunk uuid, p_records jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare m famalio.migrations; r jsonb; rev bigint; n int := 0; names text[] := '{}';
begin
  select * into m from famalio.migrations where id = p_migration for update;
  if m.id is null or m.state <> 'STAGING' then raise exception 'MIGRATION_STATE_CONFLICT' using errcode = 'P0001'; end if;
  perform 1 from famalio.families where id = m.family_id and placement_state = 'importing' for update;
  if not found then raise exception 'MIGRATION_STATE_CONFLICT' using errcode = 'P0001'; end if;
  perform 1 from famalio.migration_chunks where migration_id = p_migration and chunk_id = p_chunk and received_at is null for update;
  if not found then raise exception 'MIGRATION_STATE_CONFLICT' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_records) <> 'array' then raise exception 'INVALID_INPUT' using errcode = 'P0001'; end if;
  for r in select value from jsonb_array_elements(p_records) loop
    update famalio.families set revision = revision + 1 where id = m.family_id returning revision into rev;
    insert into famalio.records(family_id, name, type, fields, revision, deleted, visibility, audience_group, calendar_name, deleted_at)
    values (m.family_id, r->>'name', r->>'type', r->'fields', rev, (r->>'deleted')::boolean,
            r->>'visibility', r->>'audience_group', r->>'calendar_name',
            case when (r->>'deleted')::boolean then now() end);
    names := names || (r->>'name');
    n := n + 1;
  end loop;
  update famalio.migration_chunks set received_at = now(), record_names = names
   where migration_id = p_migration and chunk_id = p_chunk;
  return n;
end $$;

-- Removes staged records of chunks that a newer snapshot of the same migration no
-- longer contains (pre-transfer superseded by the final snapshot, T024/T025).
create function famalio.discard_import_records(p_migration uuid, p_names text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare fam uuid;
begin
  select family_id into fam from famalio.migrations where id = p_migration and state in ('STAGING','VERIFIED','BLOCKED');
  if fam is null then raise exception 'MIGRATION_STATE_CONFLICT' using errcode = 'P0001'; end if;
  perform 1 from famalio.families where id = fam and placement_state = 'importing' for update;
  if not found then raise exception 'MIGRATION_STATE_CONFLICT' using errcode = 'P0001'; end if;
  delete from famalio.records where family_id = fam and name = any(p_names);
end $$;

-- Abort deletes the quarantined family (never an active one) and all staged data.
create function famalio.abort_import(p_migration uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare fam uuid;
begin
  select family_id into fam from famalio.migrations where id = p_migration and state <> 'ABORTED' for update;
  if fam is null then raise exception 'MIGRATION_STATE_CONFLICT' using errcode = 'P0001'; end if;
  delete from famalio.families where id = fam and placement_state = 'importing';
  update famalio.migrations set state = 'ABORTED', transfer_hash = null, transfer_expires_at = null, updated_at = now()
   where id = p_migration;
end $$;

revoke all on all functions in schema famalio from public;
