#!/bin/sh
# Famalio Home container entrypoint.
#   migrate – apply schema as the OWNER role (famalio_owner), then exit.
#   serve   – run the API as the least-privilege APP role (famalio_app).
# The password is read from a file (docker secret), never from the image or
# the command line. A failed migration exits non-zero; compose then does not
# start the server, so there is no restart loop of repeated migrations (OPS-04).
set -eu

mode="${1:-serve}"
cd "${FAMALIO_APP_DIR:-/opt/famalio}"

die() { echo "famalio-entrypoint: $*" >&2; exit 64; }

# Builds postgres://user:pw@host:port/db from FAMALIO_DB_* and a password file.
# The password is URL-encoded by Node reading stdin (not argv, so it never shows
# up in the process list).
build_url() {
  user="$1"; pw_file="$2"
  [ -n "$pw_file" ] || die "password file variable is empty"
  [ -r "$pw_file" ] || die "password file $pw_file is not readable"
  host="${FAMALIO_DB_HOST:-postgres}"
  port="${FAMALIO_DB_PORT:-5432}"
  db="${FAMALIO_DB_NAME:-famalio}"
  pw_enc="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(encodeURIComponent(s.replace(/\r?\n$/,""))))' <"$pw_file")"
  [ -n "$pw_enc" ] || die "password file $pw_file is empty"
  printf 'postgres://%s:%s@%s:%s/%s' "$user" "$pw_enc" "$host" "$port" "$db"
}

case "$mode" in
  migrate)
    if [ -z "${FAMALIO_OWNER_DATABASE_URL:-}" ]; then
      FAMALIO_OWNER_DATABASE_URL="$(build_url "${FAMALIO_OWNER_DB_USER:-famalio_owner}" "${FAMALIO_OWNER_DB_PASSWORD_FILE:-}")"
      export FAMALIO_OWNER_DATABASE_URL
    fi
    export FAMALIO_APP_ROLE="${FAMALIO_APP_ROLE:-famalio_app}"
    exec node src/migrate.ts
    ;;
  serve)
    if [ -z "${FAMALIO_DATABASE_URL:-}" ]; then
      FAMALIO_DATABASE_URL="$(build_url "${FAMALIO_APP_DB_USER:-famalio_app}" "${FAMALIO_APP_DB_PASSWORD_FILE:-}")"
      export FAMALIO_DATABASE_URL
    fi
    # The owner credentials must never be visible to the API process.
    unset FAMALIO_OWNER_DATABASE_URL FAMALIO_OWNER_DB_PASSWORD_FILE
    exec node src/main.ts
    ;;
  *)
    die "unknown mode '$mode' (expected: migrate | serve)"
    ;;
esac
