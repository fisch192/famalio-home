#!/command/with-contenv bash
# shellcheck shell=bash
# Oneshot (as postgres): idempotently create/enforce the Famalio roles and the
# database (ADR-002 §1, SEC-05). Users never create roles by hand (05_HA).
# Attributes are re-asserted on every start, so a drifted role is corrected.
set -euo pipefail
# shellcheck source=SCRIPTDIR/famalio-env.sh
. "$(dirname "$0")/famalio-env.sh"
wait_for_postgres

psql=("$PG_BIN/psql" -X -q -v ON_ERROR_STOP=1 -h "$PG_SOCKET_DIR")
as postgres "${psql[@]}" -d postgres <<'SQL'
select 'create role famalio_owner' where not exists (select 1 from pg_roles where rolname = 'famalio_owner') \gexec
select 'create role famalio_app' where not exists (select 1 from pg_roles where rolname = 'famalio_app') \gexec
alter role famalio_owner login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password null;
alter role famalio_app login nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit password null;
select 'create database famalio owner famalio_owner encoding ''UTF8''' where not exists (select 1 from pg_database where datname = 'famalio') \gexec
revoke all on database famalio from public;
grant connect on database famalio to famalio_app;
SQL
as postgres "${psql[@]}" -d famalio -c 'revoke create on schema public from public'
echo "[famalio] database roles verified"
