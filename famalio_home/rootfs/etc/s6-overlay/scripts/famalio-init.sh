#!/command/with-contenv bash
# shellcheck shell=bash
# Oneshot (root): prepare directories under /data and create the PostgreSQL
# cluster on first start. Never deletes or re-initialises existing data.
set -euo pipefail
# shellcheck source=SCRIPTDIR/famalio-env.sh
. "$(dirname "$0")/famalio-env.sh"

install -d -o postgres -g postgres -m 0700 "$(dirname "$PGDATA")"
install -d -o postgres -g famalio_db -m 0750 "$PG_SOCKET_DIR"

if [ -s "$PGDATA/PG_VERSION" ]; then
  found="$(cat "$PGDATA/PG_VERSION")"
  if [ "$found" != "$PG_MAJOR" ]; then
    # No automatic major upgrade: refuse to start instead of touching the data.
    echo "[famalio] data directory is PostgreSQL $found, image ships $PG_MAJOR; restore a backup or run a documented upgrade" >&2
    exit 1
  fi
  echo "[famalio] existing PostgreSQL $found cluster found"
else
  if [ -e "$PGDATA" ] && [ -n "$(ls -A "$PGDATA" 2>/dev/null)" ]; then
    echo "[famalio] $PGDATA is not empty but has no PG_VERSION; refusing to initialise over it" >&2
    exit 1
  fi
  install -d -o postgres -g postgres -m 0700 "$PGDATA"
  echo "[famalio] initialising PostgreSQL $PG_MAJOR cluster"
  as postgres "$PG_BIN/initdb" -D "$PGDATA" -E UTF8 --no-locale \
    --auth-local=peer --auth-host=reject >/dev/null
fi

# Tailscale state (node key, TLS certificates) is persistent and private to the
# famalio_ts account; the socket directory is recreated on every start.
install -d -o "$FAMALIO_TS_USER" -g "$FAMALIO_TS_USER" -m 0700 "$TS_STATE_DIR"
install -d -o "$FAMALIO_TS_USER" -g "$FAMALIO_TS_USER" -m 0750 "$TS_RUN_DIR"
install -d -o "$FAMALIO_TS_USER" -g "$FAMALIO_TS_USER" -m 0700 "$FAMALIO_SETUP_DIR"
