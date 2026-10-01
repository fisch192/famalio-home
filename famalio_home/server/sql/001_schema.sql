-- Famalio Home schema v1. Applied by the schema owner role only (src/migrate.ts).
-- The runtime role famalio_app gets DML on these tables and nothing else:
-- no superuser, no BYPASSRLS, no CREATE on the schema (SEC-05, ADR-002 §1).

create schema if not exists famalio;
revoke all on schema famalio from public;

create table famalio.schema_migrations(
  version int primary key,
  applied_at timestamptz not null default now()
);

-- Singleton instance identity. recovery_epoch changes on every restore (P09); revisions
-- and cursors are only comparable within one epoch.
create table famalio.instance(
  singleton boolean primary key default true check (singleton),
  instance_id uuid not null,
  recovery_epoch uuid not null,
  created_at timestamptz not null default now()
);

create table famalio.setup_codes(
  code_hash bytea primary key check (octet_length(code_hash) = 32),
  expires_at timestamptz not null,
  used_at timestamptz,
  failed_attempts int not null default 0
);

create table famalio.families(
  id uuid primary key,
  revision bigint not null default 0,
  placement_epoch bigint not null default 0,
  -- Exactly one writable placement: writes require 'active' (P04 adds migration states).
  placement_state text not null default 'active' check (placement_state in ('active','importing','fenced','retired')),
  created_at timestamptz not null default now()
);

-- Local authentication subjects. member_record_name is the stable business alias
-- (for migrated families the existing member-sb_<uuid> name is preserved).
create table famalio.subjects(
  id uuid primary key,
  family_id uuid not null references famalio.families(id) on delete cascade,
  member_record_name text not null check (member_record_name ~ '^member-[A-Za-z0-9_-]{1,100}$'),
  role text not null check (role in ('owner','editor','viewer')),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (family_id, member_record_name)
);
create unique index subjects_one_owner on famalio.subjects(family_id) where role = 'owner' and removed_at is null;

create table famalio.devices(
  id uuid primary key,
  subject_id uuid not null references famalio.subjects(id) on delete cascade,
  display_name text not null check (length(display_name) between 1 and 80),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

-- Opaque session credentials, stored only as SHA-256 hashes (ADR-002 §2).
create table famalio.sessions(
  id uuid primary key,
  device_id uuid not null references famalio.devices(id) on delete cascade,
  access_hash bytea not null unique check (octet_length(access_hash) = 32),
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text
);
create index on famalio.sessions(device_id);

-- Every refresh credential ever issued for a session; a rotated one presented again
-- revokes the whole session (refresh token reuse detection, RFC 9700 §4.14.2).
create table famalio.refresh_tokens(
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  session_id uuid not null references famalio.sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create table famalio.pairing_offers(
  id uuid primary key,
  family_id uuid not null references famalio.families(id) on delete cascade,
  created_by uuid not null references famalio.subjects(id) on delete cascade,
  secret_hash bytea not null unique check (octet_length(secret_hash) = 32),
  max_role text not null check (max_role in ('editor','viewer')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table famalio.pairing_requests(
  id uuid primary key,
  offer_id uuid not null unique references famalio.pairing_offers(id) on delete cascade,
  family_id uuid not null references famalio.families(id) on delete cascade,
  device_display_name text not null check (length(device_display_name) between 1 and 80),
  claim_hash bytea not null unique check (octet_length(claim_hash) = 32),
  state text not null default 'pending' check (state in ('pending','approved','denied','claimed')),
  approved_by uuid references famalio.subjects(id) on delete set null,
  member_record_name text,
  role text check (role in ('editor','viewer')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table famalio.records(
  family_id uuid not null references famalio.families(id) on delete cascade,
  name text not null,
  type text not null check (type in ('FC_Family','FC_Member','FC_Event','FC_Group','FC_Calendar')),
  fields jsonb not null,
  revision bigint not null,
  deleted boolean not null default false,
  visibility text not null default 'family' check (visibility in ('family','parentsOnly')),
  audience_group text,
  calendar_name text,
  primary key (family_id, name),
  check (octet_length(fields::text) <= 25165824)
);
create index on famalio.records(family_id, revision);

-- Idempotency log: the same operation_id with the same request hash returns the
-- stored result; a different request under the same id is a conflict.
create table famalio.operations(
  family_id uuid not null references famalio.families(id) on delete cascade,
  operation_id uuid not null,
  request_hash bytea not null,
  subject_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (family_id, operation_id)
);

-- Security audit without content: no titles, names, tokens or payloads.
create table famalio.audit_log(
  id bigserial primary key,
  family_id uuid,
  subject_id uuid,
  device_id uuid,
  action text not null,
  created_at timestamptz not null default now()
);

-- Access helpers, ported from supabase/sql/famalio_functions.sql (audience_allows,
-- calendar_allows) with the subject's member record name instead of 'member-sb_'||auth.uid().
-- Group membership is read from the FC_Group record itself, so no derived index can drift.
create function famalio.group_has_member(f uuid, g text, member text) returns boolean
language sql stable set search_path = '' as $$
  select exists(select 1 from famalio.records r
    where r.family_id = f and r.name = g and r.type = 'FC_Group' and not r.deleted
      and coalesce(r.fields #> '{members,value}', '[]'::jsonb) ? member)
$$;

create function famalio.audience_allows(f uuid, n text, member text, access_role text) returns boolean
language sql stable set search_path = '' as $$
  select n is null or access_role = 'owner' or famalio.group_has_member(f, n, member)
$$;

create function famalio.calendar_allows(f uuid, n text, member text, access_role text, editing boolean) returns boolean
language plpgsql stable set search_path = '' as $$
declare policy jsonb; granted text[];
begin
  if access_role is null or (editing and access_role = 'viewer') then return false; end if;
  if n is null then return true; end if;
  select fields into policy from famalio.records where family_id = f and name = n and type = 'FC_Calendar' and not deleted;
  if policy is null then return false; end if;
  if access_role = 'owner' then return true; end if;
  if policy #>> '{defaultAccess,value}' = 'editor' or (not editing and policy #>> '{defaultAccess,value}' = 'viewer') then return true; end if;
  select array_agg(x) into granted from jsonb_array_elements_text(
    coalesce(policy #> '{writeGroups,value}', '[]') ||
    case when editing then '[]'::jsonb else coalesce(policy #> '{readGroups,value}', '[]') end) x;
  return exists(select 1 from unnest(coalesce(granted, '{}')) g where famalio.group_has_member(f, g, member));
end $$;

-- True when the subject may read the record's content (otherwise it is sent as removed).
create function famalio.record_visible(f uuid, r famalio.records, member text, access_role text) returns boolean
language sql stable set search_path = '' as $$
  select not r.deleted
    and not (access_role = 'viewer' and r.visibility = 'parentsOnly')
    and famalio.calendar_allows(f, r.calendar_name, member, access_role, false)
    and famalio.audience_allows(f, r.audience_group, member, access_role)
$$;

-- Policy changes republish affected events so delta clients receive revocations
-- (port of famalio_private.republish_calendar_events).
create function famalio.republish_calendar_events() returns trigger
language plpgsql set search_path = '' as $$
declare item record; rev bigint;
begin
  if new.type not in ('FC_Calendar','FC_Group') then return null; end if;
  if tg_op = 'UPDATE' and new.fields is not distinct from old.fields and new.deleted = old.deleted then return null; end if;
  for item in select name from famalio.records
    where family_id = new.family_id and type = 'FC_Event' and not deleted
      and (calendar_name = new.name or (new.type = 'FC_Group' and (calendar_name is not null or audience_group = new.name)))
  loop
    update famalio.families set revision = revision + 1 where id = new.family_id returning revision into rev;
    update famalio.records set revision = rev where family_id = new.family_id and name = item.name;
  end loop;
  return null;
end $$;
create trigger records_republish after insert or update on famalio.records
  for each row execute function famalio.republish_calendar_events();

-- Placement fence below every writer: no record change unless the family is active.
create function famalio.enforce_active_placement() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from famalio.families where id = new.family_id and placement_state = 'active') then
    raise exception 'PLACEMENT_CHANGED' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger records_placement_fence before insert or update on famalio.records
  for each row execute function famalio.enforce_active_placement();

revoke all on all functions in schema famalio from public;
