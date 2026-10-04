-- Opt-in (default off, SEC-07): the owner may let one Home Assistant grant read
-- parents-only and closed-group events, for example to drive automations.
-- Restricted events stay read-only for Home Assistant even for write grants.
alter table famalio.ha_integrations
  add column include_restricted boolean not null default false;
