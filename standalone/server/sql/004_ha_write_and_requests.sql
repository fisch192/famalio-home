-- Home Assistant grants may optionally edit events in their granted calendars,
-- and the HA app can request a connection that the owner approves in Famalio.
-- The integration token is minted only when the approved request is claimed, so
-- no usable plaintext credential is ever stored.
alter table famalio.ha_integrations
  add column access text not null default 'read' check (access in ('read','write'));

create table famalio.ha_connection_requests(
  id uuid primary key,
  label text not null check (length(label) between 1 and 80),
  code text not null check (code ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}$'),
  claim_hash bytea not null unique check (octet_length(claim_hash) = 32),
  state text not null default 'pending' check (state in ('pending','approved','denied','claimed')),
  family_id uuid references famalio.families(id) on delete cascade,
  integration_id uuid references famalio.ha_integrations(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check ((state in ('approved','claimed')) = (integration_id is not null))
);
create index ha_connection_requests_pending on famalio.ha_connection_requests(state, expires_at);
