#!/bin/sh
# Runs ONCE, on first initialisation of an empty data volume, from the official
# postgres image entrypoint (/docker-entrypoint-initdb.d). Creates the two
# Famalio roles (ADR-002 §1, SEC-05) and the database:
#   famalio_owner – owns schema, runs migrations only (no superuser, no createrole)
#   famalio_app   – runtime API role: login, NOSUPERUSER, NOBYPASSRLS, no DDL
# Passwords come from docker secrets via psql backticks, so they never appear
# in argv, in this file or in the image.
set -eu

: "${FAMALIO_OWNER_PASSWORD_FILE:?}"
: "${FAMALIO_APP_PASSWORD_FILE:?}"
for f in "$FAMALIO_OWNER_PASSWORD_FILE" "$FAMALIO_APP_PASSWORD_FILE"; do
  [ -s "$f" ] || { echo "10-famalio-roles: secret $f missing or empty" >&2; exit 1; }
done

psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<'SQL'
\set owner_pw `cat "$FAMALIO_OWNER_PASSWORD_FILE"`
\set app_pw `cat "$FAMALIO_APP_PASSWORD_FILE"`
create role famalio_owner login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password :'owner_pw';
create role famalio_app login nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit password :'app_pw';
create database famalio owner famalio_owner;
revoke all on database famalio from public;
grant connect on database famalio to famalio_app;
SQL

psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname famalio <<'SQL'
revoke create on schema public from public;
SQL
