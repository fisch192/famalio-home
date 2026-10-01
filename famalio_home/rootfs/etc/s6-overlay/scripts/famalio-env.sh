# shellcheck shell=bash
# Shared settings for the Famalio Home add-on services. Sourced, not executed.
# Every value can be overridden from the environment; the defaults are the
# add-on layout. (Overrides exist only so the same scripts can be smoke-tested
# outside the add-on – see packaging/famalio-home/smoke-local.sh.)
PG_MAJOR="${PG_MAJOR:-16}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/${PG_MAJOR}/bin}"
FAMALIO_DATA_DIR="${FAMALIO_DATA_DIR:-/data}"
PGDATA="${PGDATA:-${FAMALIO_DATA_DIR}/postgres/${PG_MAJOR}}"
PG_SOCKET_DIR="${PG_SOCKET_DIR:-/run/postgresql}"
PG_HBA_FILE="${PG_HBA_FILE:-/etc/famalio/pg_hba.conf}"
FAMALIO_APP_DIR="${FAMALIO_APP_DIR:-/opt/famalio}"
FAMALIO_OPTIONS_FILE="${FAMALIO_OPTIONS_FILE:-${FAMALIO_DATA_DIR}/options.json}"
FAMALIO_SETUP_DIR="${FAMALIO_SETUP_DIR:-${FAMALIO_DATA_DIR}/setup}"
FAMALIO_SETUP_CONFIG="${FAMALIO_SETUP_CONFIG:-${FAMALIO_SETUP_DIR}/config.json}"
# Tool that drops to an unprivileged account: "$FAMALIO_SETUIDGID" <user> <cmd...>
FAMALIO_SETUIDGID="${FAMALIO_SETUIDGID:-s6-setuidgid}"

# as <user> <cmd...> – run a command as an unprivileged account.
as() {
  local user="$1"
  shift
  "$FAMALIO_SETUIDGID" "$user" "$@"
}

# Connection string over the unix socket (no password; peer authentication).
pg_socket_url() { # <role>
  printf 'postgres://%s@%s/famalio' "$1" "$(printf '%s' "$PG_SOCKET_DIR" | sed 's|/|%2F|g')"
}

wait_for_postgres() {
  local _
  for _ in $(seq 1 60); do
    if as postgres "$PG_BIN/pg_isready" -q -h "$PG_SOCKET_DIR" -d postgres; then
      return 0
    fi
    sleep 1
  done
  echo "[famalio] PostgreSQL did not become ready within 60 s" >&2
  return 1
}

# --- Tailscale (userspace node inside this add-on; decision 2026-09-25) ------
TS_STATE_DIR="${TS_STATE_DIR:-${FAMALIO_DATA_DIR}/tailscale}"
TS_RUN_DIR="${TS_RUN_DIR:-/run/tailscale}"
TS_SOCKET="${TS_SOCKET:-${TS_RUN_DIR}/tailscaled.sock}"
TAILSCALE_BIN="${TAILSCALE_BIN:-tailscale}"
TAILSCALED_BIN="${TAILSCALED_BIN:-tailscaled}"
FAMALIO_TS_USER="${FAMALIO_TS_USER:-famalio_ts}"

# String option from the Supervisor-written options.json; prints "" if absent.
opt_str() { # <key>
  node -e '
    const [file, key] = process.argv.slice(1);
    let v; try { v = JSON.parse(require("fs").readFileSync(file, "utf8"))[key]; } catch {}
    process.stdout.write(typeof v === "string" ? v : "");
  ' "$FAMALIO_OPTIONS_FILE" "$1"
}

remote_access_mode() {
  local mode
  mode="$(node -e '
    const fs = require("fs");
    try {
      const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (c && c.version === 1 && (c.mode === "tailscale" || c.mode === "reverse_proxy")) process.stdout.write(c.mode);
    } catch {}
  ' "$FAMALIO_SETUP_CONFIG")"
  case "$mode" in
    tailscale|reverse_proxy) echo "$mode"; return ;;
  esac
  mode="$(opt_str remote_access)"
  case "$mode" in
    disabled) echo disabled ;;
    tailscale) echo tailscale ;; # preserve an explicitly selected 0.1.x option
    *) echo disabled ;;   # fresh installs wait for an explicit wizard choice
  esac
}

setup_https_url() {
  node -e '
    const fs = require("fs");
    try {
      const c = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (c && c.version === 1 && typeof c.https_url === "string") process.stdout.write(c.https_url);
    } catch {}
  ' "$FAMALIO_SETUP_CONFIG"
}
