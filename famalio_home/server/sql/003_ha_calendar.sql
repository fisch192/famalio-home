-- P07: separately revocable, read-only Home Assistant calendar grants.
-- Integration credentials cannot authenticate as mobile sessions and are stored
-- only as hashes. Calendar names are an explicit owner-approved allowlist; `family`
-- represents records with calendar_name IS NULL.
alter table famalio.confirmations drop constraint confirmations_purpose_check;
alter table famalio.confirmations add constraint confirmations_purpose_check
  check (purpose in ('owner_transfer','recovery_code','migration_import','ha_grant_create','ha_grant_revoke'));

create table famalio.ha_integrations(
  id uuid primary key,
  family_id uuid not null references famalio.families(id) on delete cascade,
  created_by_subject_id uuid not null references famalio.subjects(id),
  recovery_epoch uuid not null,
  label text not null check (length(label) between 1 and 80),
  projection text not null check (projection in ('full','busy')),
  max_days int not null check (max_days between 1 and 90),
  calendar_names text[] not null check (cardinality(calendar_names) between 1 and 30),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (array_position(calendar_names, null) is null)
);
create index ha_integrations_family on famalio.ha_integrations(family_id, created_at);
