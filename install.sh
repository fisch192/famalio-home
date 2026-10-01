#!/bin/sh
# Famalio Home – one-command installer for Linux servers (no Home Assistant needed).
#
#   curl -fsSL https://raw.githubusercontent.com/fisch192/famalio-home/main/install.sh | sudo bash
#   sudo ./install.sh [--dir /opt/famalio-home] [--mode tailscale|domain|local]
#                     [--domain calendar.example.com --email you@example.com]
#                     [--ts-authkey tskey-...] [--non-interactive] [--update] [--uninstall]
#
# Run ./install.sh --help for all options. POSIX sh; works with bash, dash and ash.
#
# What it does: detects the distribution, installs curl/tar/openssl/CA certificates
# and Docker Engine + Compose v2 if missing, downloads Famalio Home into --dir,
# generates random database passwords (never printed), starts the containers from
# standalone/compose.yaml, waits until the API is healthy and prints the server
# address and the one-time owner setup code. Re-running is safe.
#
# The whole script is wrapped in main() so that `curl ... | sh` only starts after
# the file has been downloaded completely.

set -eu

REPO="fisch192/famalio-home"
DEFAULT_DIR="/opt/famalio-home"
API_PORT="8787"

# ---------------------------------------------------------------- output helpers
if [ -t 1 ]; then
  C_B="$(printf '\033[1m')"; C_G="$(printf '\033[32m')"; C_Y="$(printf '\033[33m')"
  C_R="$(printf '\033[31m')"; C_0="$(printf '\033[0m')"
else
  C_B=""; C_G=""; C_Y=""; C_R=""; C_0=""
fi
info() { printf '%s==>%s %s\n' "$C_G" "$C_0" "$*"; }
warn() { printf '%sWARNING:%s %s\n' "$C_Y" "$C_0" "$*" >&2; }
die() { printf '%sERROR:%s %s\n' "$C_R" "$C_0" "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Famalio Home installer (Linux, Docker Compose, no Home Assistant needed)

Usage: sudo ./install.sh [options]
       curl -fsSL https://raw.githubusercontent.com/fisch192/famalio-home/main/install.sh | sudo bash -s -- [options]

Options
  --dir PATH            Install directory (default /opt/famalio-home)
  --mode MODE           How phones reach the server over HTTPS:
                          tailscale  private HTTPS inside your tailnet (recommended)
                          domain     own domain, automatic Let's Encrypt certificate (Caddy)
                          local      loopback only, bring your own reverse proxy
  --domain NAME         Public DNS name for --mode domain (e.g. calendar.example.com)
  --email ADDRESS       E-mail for Let's Encrypt notices (--mode domain)
  --ts-authkey KEY      Tailscale auth key (tskey-...) for --mode tailscale.
                        Safer: set FAMALIO_TS_AUTHKEY or enter it at the prompt.
  --ts-hostname NAME    Tailscale device name (default famalio-home)
  --ref REF             Branch or tag to download (default main)
  --source PATH         Use a local checkout instead of downloading (CI/development)
  --no-backup           Do not install the daily database backup
  --non-interactive     Never ask; fail if required values are missing
  --update              Download the new version and rebuild; keeps data and secrets
  --uninstall           Stop and remove Famalio Home (asks before deleting data)
  --purge               With --uninstall: also delete database, secrets and backups
  --check-only          Only detect OS, architecture, package manager and Docker; change nothing
  --prereqs-only        Only install the base tools (curl, tar, openssl, CA certificates)
  -h, --help            Show this help
EOF
}

# ------------------------------------------------------------------ state
DIR=""; MODE=""; DOMAIN=""; EMAIL=""; TS_AUTHKEY="${FAMALIO_TS_AUTHKEY:-}"; TS_HOSTNAME=""
REF="${FAMALIO_REF:-main}"; SOURCE=""; BACKUP=""; NONINTERACTIVE=0; ACTION="install"; PURGE=0
TTY=""
OS_ID=""; OS_LIKE=""; OS_VER=""; OS_NAME=""; FAMILY=""; PKG=""; ARCH=""

parse_args() {
  while [ $# -gt 0 ]; do
    opt="$1"; val=""
    case "$opt" in
      --*=*) val="${opt#*=}"; opt="${opt%%=*}" ;;
    esac
    case "$opt" in
      --dir|--mode|--domain|--email|--ts-authkey|--ts-hostname|--ref|--source)
        if [ -z "$val" ]; then
          [ $# -ge 2 ] || die "$opt needs a value"
          val="$2"; shift
        fi
        case "$opt" in
          --dir) DIR="$val" ;;
          --mode) MODE="$val" ;;
          --domain) DOMAIN="$val" ;;
          --email) EMAIL="$val" ;;
          --ts-authkey) TS_AUTHKEY="$val" ;;
          --ts-hostname) TS_HOSTNAME="$val" ;;
          --ref) REF="$val" ;;
          --source) SOURCE="$val" ;;
        esac
        ;;
      --no-backup) BACKUP=0 ;;
      --backup) BACKUP=1 ;;
      --non-interactive|-y|--yes) NONINTERACTIVE=1 ;;
      --update) ACTION="update" ;;
      --uninstall) ACTION="uninstall" ;;
      --purge) PURGE=1 ;;
      --check-only) ACTION="check" ;;
      --prereqs-only) ACTION="prereqs" ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; die "unknown option: $1" ;;
    esac
    shift
  done
  [ -n "$DIR" ] || DIR="$DEFAULT_DIR"
  case "$DIR" in
    /*) ;;
    *) die "--dir must be an absolute path" ;;
  esac
  DIR="${DIR%/}"
  [ -n "$DIR" ] && [ "$DIR" != "/" ] || die "refusing to use / as install directory"
  if [ -n "$SOURCE" ]; then
    [ -f "$SOURCE/standalone/compose.yaml" ] || die "--source $SOURCE does not look like a famalio-home checkout"
    SOURCE="$(cd "$SOURCE" && pwd)"
  fi
  case "$MODE" in
    ""|tailscale|domain|local) ;;
    *) die "--mode must be tailscale, domain or local" ;;
  esac
}

# ------------------------------------------------------------------ prompts
setup_tty() {
  if [ "$NONINTERACTIVE" -eq 0 ] && (exec </dev/tty) 2>/dev/null; then
    TTY="/dev/tty"
  fi
}

# ask "Question" "default" -> answer on stdout
ask() {
  if [ -n "$2" ]; then printf '%s [%s]: ' "$1" "$2" >/dev/tty; else printf '%s: ' "$1" >/dev/tty; fi
  ans=""
  IFS= read -r ans </dev/tty || ans=""
  [ -n "$ans" ] || ans="$2"
  printf '%s' "$ans"
}

ask_secret() {
  printf '%s: ' "$1" >/dev/tty
  ans=""
  stty -echo </dev/tty 2>/dev/null || true
  IFS= read -r ans </dev/tty || ans=""
  stty echo </dev/tty 2>/dev/null || true
  printf '\n' >/dev/tty
  printf '%s' "$ans"
}

# confirm "Question" y|n -> exit status
confirm() {
  if [ "$2" = "y" ]; then hint="Y/n"; else hint="y/N"; fi
  a="$(ask "$1 ($hint)" "")"
  [ -n "$a" ] || a="$2"
  case "$a" in [Yy]|[Yy][Ee][Ss]) return 0 ;; *) return 1 ;; esac
}

# ------------------------------------------------------------------ detection
osr() { sed -n "s/^$1=//p" /etc/os-release 2>/dev/null | head -n1 | tr -d '"'"'"; }

detect_system() {
  [ "$(uname -s)" = "Linux" ] || die "Famalio Home needs Linux (found $(uname -s))."
  if [ -r /etc/os-release ]; then
    OS_ID="$(osr ID)"; OS_LIKE="$(osr ID_LIKE)"; OS_VER="$(osr VERSION_ID)"; OS_NAME="$(osr PRETTY_NAME)"
  fi
  [ -n "$OS_NAME" ] || OS_NAME="unknown Linux"

  m="$(uname -m)"
  case "$m" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) die "unsupported CPU architecture '$m'. Famalio Home supports x86_64 (amd64) and aarch64 (arm64) only. On a Raspberry Pi install the 64-bit OS." ;;
  esac
  # 64-bit kernel with a 32-bit userland (old Raspberry Pi OS images).
  if command -v dpkg >/dev/null 2>&1; then
    case "$(dpkg --print-architecture 2>/dev/null || true)" in
      armhf|armel|i386) die "this is a 32-bit system ($(dpkg --print-architecture)). Install a 64-bit OS (amd64 or arm64)." ;;
    esac
  fi

  case " $OS_ID $OS_LIKE " in
    *" alpine "*) FAMILY="alpine" ;;
    *" arch "*|*" manjaro "*|*" endeavouros "*) FAMILY="arch" ;;
    *" opensuse"*|*" suse "*|*" sles "*|*" sled "*) FAMILY="suse" ;;
    *" fedora "*)
      if [ "$OS_ID" = "fedora" ]; then FAMILY="fedora"; else FAMILY="rhel"; fi ;;
    *" rhel "*|*" centos "*|*" rocky "*|*" almalinux "*|*" ol "*) FAMILY="rhel" ;;
    *" debian "*|*" ubuntu "*|*" raspbian "*) FAMILY="debian" ;;
    *) FAMILY="unknown" ;;
  esac

  for p in apt-get dnf yum zypper pacman apk; do
    if command -v "$p" >/dev/null 2>&1; then PKG="$p"; break; fi
  done
  [ -n "$PKG" ] || PKG="none"
}

docker_state() {
  if ! command -v docker >/dev/null 2>&1; then echo "not installed"; return; fi
  if docker compose version >/dev/null 2>&1; then
    echo "installed ($(docker --version 2>/dev/null | sed 's/^Docker version //'), $(docker compose version --short 2>/dev/null || echo compose))"
  else
    echo "installed ($(docker --version 2>/dev/null | sed 's/^Docker version //')), Compose v2 plugin missing"
  fi
}

print_system() {
  info "System: $OS_NAME (id=$OS_ID${OS_VER:+, version=$OS_VER}, family=$FAMILY)"
  info "Architecture: $ARCH ($(uname -m))"
  info "Package manager: $PKG"
  info "Docker: $(docker_state)"
  case "$FAMILY" in
    unknown) warn "unrecognised distribution; install Docker Engine + Compose v2 yourself, then re-run." ;;
  esac
  case "$OS_ID:$OS_VER" in
    ubuntu:20.04*|debian:10*|debian:11*) warn "$OS_NAME is end of life or close to it; Docker support is best effort." ;;
  esac
  [ "$FAMILY" != "alpine" ] || warn "Alpine Linux support is best effort."
}

# ------------------------------------------------------------------ packages
pkg_install() {
  [ $# -gt 0 ] || return 0
  info "Installing packages: $*"
  case "$PKG" in
    apt-get)
      DEBIAN_FRONTEND=noninteractive apt-get update -qq </dev/null
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends "$@" </dev/null ;;
    dnf) dnf install -y -q "$@" </dev/null ;;
    yum) yum install -y -q "$@" </dev/null ;;
    zypper) zypper --non-interactive --quiet install --no-recommends "$@" </dev/null ;;
    pacman) pacman -Sy --noconfirm --needed "$@" </dev/null ;;
    apk) apk add --no-cache "$@" </dev/null ;;
    *) die "no supported package manager found; please install: $*" ;;
  esac
}

have_ca_bundle() {
  for f in /etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt \
           /etc/ssl/ca-bundle.pem /etc/ssl/cert.pem /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem; do
    [ -s "$f" ] && return 0
  done
  return 1
}

install_prereqs() {
  missing=""
  for c in curl tar gzip openssl; do
    command -v "$c" >/dev/null 2>&1 || missing="$missing $c"
  done
  # BusyBox tar (Alpine) lacks some options; use GNU tar there.
  if command -v tar >/dev/null 2>&1 && tar --version 2>&1 | grep -qi busybox; then
    missing="$missing tar"
  fi
  have_ca_bundle || missing="$missing ca-certificates"
  if [ -z "$missing" ]; then
    info "Base tools present (curl, tar, gzip, openssl, CA certificates)."
    return 0
  fi
  # shellcheck disable=SC2086
  pkg_install $missing
  for c in curl tar gzip openssl; do
    command -v "$c" >/dev/null 2>&1 || die "could not install $c"
  done
  have_ca_bundle || die "could not install CA certificates"
}

start_docker_service() {
  if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker >/dev/null 2>&1 || systemctl start docker || true
  elif command -v rc-update >/dev/null 2>&1; then
    rc-update add docker default >/dev/null 2>&1 || true
    rc-service docker start >/dev/null 2>&1 || service docker start || true
  elif command -v service >/dev/null 2>&1; then
    service docker start || true
  fi
  i=0
  while ! docker info >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -le 30 ] || die "the Docker daemon is not running. Start it (e.g. 'systemctl start docker') and re-run."
    sleep 2
  done
}

add_repo_file() {
  info "Adding Docker's package repository ($1)"
  curl -fsSL "$1" -o /etc/yum.repos.d/docker-ce.repo
}

install_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    start_docker_service
    info "Docker $(docker compose version --short 2>/dev/null) is ready."
    return 0
  fi
  if command -v docker >/dev/null 2>&1; then
    info "Docker is installed but the Compose v2 plugin is missing; installing it."
    case "$FAMILY" in
      debian|fedora|rhel) pkg_install docker-compose-plugin || true ;;
      suse) pkg_install docker-compose || true ;;
      arch) pkg_install docker-compose || true ;;
      alpine) pkg_install docker-cli-compose || true ;;
    esac
  else
    info "Installing Docker Engine and Docker Compose v2 ..."
    case "$FAMILY" in
      debian)
        # Docker's official convenience script (Debian, Ubuntu, Raspberry Pi OS).
        tmp="$(mktemp)"
        curl -fsSL https://get.docker.com -o "$tmp"
        sh "$tmp" </dev/null
        rm -f "$tmp" ;;
      fedora)
        add_repo_file https://download.docker.com/linux/fedora/docker-ce.repo
        dnf install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin </dev/null ;;
      rhel)
        if [ "$OS_ID" = "rhel" ]; then
          add_repo_file https://download.docker.com/linux/rhel/docker-ce.repo
        else
          add_repo_file https://download.docker.com/linux/centos/docker-ce.repo
        fi
        # --allowerasing replaces conflicting podman/runc packages if present.
        if command -v dnf >/dev/null 2>&1; then
          dnf install -y -q --allowerasing docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin </dev/null
        else
          yum install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin </dev/null
        fi ;;
      suse)
        pkg_install docker docker-compose
        pkg_install docker-buildx 2>/dev/null || warn "docker-buildx package not available; using the built-in builder." ;;
      arch)
        pkg_install docker docker-compose docker-buildx ;;
      alpine)
        pkg_install docker docker-cli-compose
        pkg_install docker-cli-buildx 2>/dev/null || warn "docker-cli-buildx package not available." ;;
      *)
        die "cannot install Docker automatically on '$OS_NAME'. Install Docker Engine and the Compose v2 plugin (https://docs.docker.com/engine/install/), then re-run." ;;
    esac
  fi
  start_docker_service
  docker compose version >/dev/null 2>&1 || die "'docker compose' (Compose v2) is not available after installation. Install the Compose plugin and re-run."
  info "Docker $(docker --version | sed 's/^Docker version //'), Compose $(docker compose version --short 2>/dev/null) ready."
}

# ------------------------------------------------------------------ files
env_get() { # key -> value from $DIR/famalio.env
  [ -f "$DIR/famalio.env" ] || return 0
  sed -n "s/^$1=//p" "$DIR/famalio.env" | tail -n1
}

dc() {
  docker compose --project-directory "$DIR/app/standalone" \
    --env-file "$DIR/famalio.env" -f "$DIR/app/standalone/compose.yaml" "$@" </dev/null
}

fetch_source() { # dest
  dest="$1"
  rm -rf "$dest"
  mkdir -p "$dest"
  if [ -n "$SOURCE" ]; then
    info "Copying Famalio Home from $SOURCE"
    (cd "$SOURCE" && tar --exclude=./.git -cf - .) | tar -xf - -C "$dest"
  else
    url="https://github.com/$REPO/archive/$REF.tar.gz"
    info "Downloading Famalio Home ($REF) from github.com/$REPO"
    curl -fsSL --retry 3 "$url" | tar -xzf - --strip-components=1 -C "$dest" \
      || die "download failed: $url"
  fi
  [ -f "$dest/standalone/compose.yaml" ] || die "downloaded files are incomplete ($dest/standalone/compose.yaml missing)"
  # Secrets never live inside the (replaceable) app folder.
  ln -sfn "$DIR/famalio.env" "$dest/standalone/.env"
}

write_env() {
  profiles=""
  case "$MODE" in
    tailscale) profiles="tailscale" ;;
    domain) profiles="domain" ;;
  esac
  umask 077
  cat >"$DIR/famalio.env.tmp" <<EOF
# Famalio Home settings, written by install.sh. Change them by re-running
# install.sh with new options (e.g. --mode domain --domain ... --email ...).
FAMALIO_MODE=$MODE
COMPOSE_PROFILES=$profiles
FAMALIO_SECRETS_DIR=$DIR/secrets
FAMALIO_DOMAIN=$DOMAIN
FAMALIO_ACME_EMAIL=$EMAIL
FAMALIO_TS_HOSTNAME=$TS_HOSTNAME
FAMALIO_BACKUP=$BACKUP
FAMALIO_REF=$REF
EOF
  mv "$DIR/famalio.env.tmp" "$DIR/famalio.env"
  chmod 0600 "$DIR/famalio.env"
  umask 022
}

make_secrets() {
  mkdir -p "$DIR/secrets"
  chmod 0700 "$DIR/secrets"
  # Creates the three database passwords once; never overwrites, never prints them.
  sh "$DIR/app/standalone/make-secrets.sh" "$DIR/secrets" >/dev/null
  # The directory is root-only (0700). The files themselves must stay readable
  # for the container users (postgres uid 999, famalio uid 10001), which read
  # them through Docker's bind mounts, not through this directory.
  ts="$DIR/secrets/ts_authkey"
  if [ -n "$TS_AUTHKEY" ]; then
    umask 077
    printf '%s' "$TS_AUTHKEY" >"$ts"
    umask 022
  elif [ ! -f "$ts" ]; then
    : >"$ts"
  fi
  chmod 0600 "$ts"
}

# ------------------------------------------------------------------ configuration
load_previous() {
  [ -n "$MODE" ] || MODE="$(env_get FAMALIO_MODE)"
  [ -n "$DOMAIN" ] || DOMAIN="$(env_get FAMALIO_DOMAIN)"
  [ -n "$EMAIL" ] || EMAIL="$(env_get FAMALIO_ACME_EMAIL)"
  [ -n "$TS_HOSTNAME" ] || TS_HOSTNAME="$(env_get FAMALIO_TS_HOSTNAME)"
  [ -n "$BACKUP" ] || BACKUP="$(env_get FAMALIO_BACKUP)"
  if [ "$REF" = "main" ] && [ -n "$(env_get FAMALIO_REF)" ]; then REF="$(env_get FAMALIO_REF)"; fi
  [ -n "$TS_HOSTNAME" ] || TS_HOSTNAME="famalio-home"
}

valid_domain() {
  case "$1" in
    localhost) return 0 ;;
    *[!A-Za-z0-9.-]*|.*|*.|*..*|"") return 1 ;;
    *.*) return 0 ;;
    *) return 1 ;;
  esac
}

choose_mode() {
  if [ -z "$MODE" ]; then
    [ -n "$TTY" ] || die "--mode is required with --non-interactive (tailscale, domain or local)."
    cat >/dev/tty <<'EOF'

How should phones reach Famalio Home? The app only talks to an https:// address.
  1) tailscale  Private HTTPS inside your Tailscale network (recommended, no open ports).
                Needs a free Tailscale account and the Tailscale app on every phone.
  2) domain     Public HTTPS on your own domain with a free Let's Encrypt certificate.
                Needs a DNS name pointing to this server and ports 80 + 443 open.
  3) local      Only on this machine (http://127.0.0.1:8787), for your own reverse proxy.
EOF
    c="$(ask "Choose 1, 2 or 3" "1")"
    case "$c" in
      1|tailscale) MODE="tailscale" ;;
      2|domain) MODE="domain" ;;
      3|local) MODE="local" ;;
      *) die "invalid choice '$c'" ;;
    esac
  fi

  case "$MODE" in
    domain)
      if [ -z "$DOMAIN" ] && [ -n "$TTY" ]; then DOMAIN="$(ask "Domain name for Famalio Home (e.g. calendar.example.com)" "")"; fi
      [ -n "$DOMAIN" ] || die "--domain is required for --mode domain."
      valid_domain "$DOMAIN" || die "'$DOMAIN' is not a valid domain name."
      if [ -z "$EMAIL" ] && [ -n "$TTY" ]; then EMAIL="$(ask "E-mail for Let's Encrypt expiry notices" "")"; fi
      [ -n "$EMAIL" ] || die "--email is required for --mode domain."
      case "$EMAIL" in *@*.*) ;; *) die "'$EMAIL' is not a valid e-mail address." ;; esac
      ;;
    tailscale)
      if [ -z "$TS_AUTHKEY" ] && [ ! -s "$DIR/secrets/ts_authkey" ]; then
        if [ -n "$TTY" ]; then
          cat >/dev/tty <<'EOF'

Create an auth key at https://login.tailscale.com/admin/settings/keys
(Generate auth key; "Reusable" is not needed). Also enable HTTPS certificates:
admin console -> DNS -> HTTPS Certificates. The key is stored root-only and not shown.
EOF
          TS_AUTHKEY="$(ask_secret "Tailscale auth key (tskey-...)")"
        fi
        [ -n "$TS_AUTHKEY" ] || die "a Tailscale auth key is required for --mode tailscale (--ts-authkey or FAMALIO_TS_AUTHKEY)."
      fi
      if [ -n "$TS_AUTHKEY" ]; then
        case "$TS_AUTHKEY" in tskey-*) ;; *) die "the Tailscale auth key must start with 'tskey-'." ;; esac
      fi
      ;;
  esac

  if [ -z "$BACKUP" ]; then
    if [ -n "$TTY" ]; then
      if confirm "Install a daily database backup to $DIR/backups (kept 14 days)?" y; then BACKUP=1; else BACKUP=0; fi
    else
      BACKUP=1
    fi
  fi
}

port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"
  else
    return 1
  fi
}

preflight_domain() {
  [ "$MODE" = "domain" ] || return 0
  if [ -z "$(dc ps -q caddy 2>/dev/null)" ]; then
    for p in 80 443; do
      if port_in_use "$p"; then
        die "port $p is already used by another program on this host. Stop it (or use --mode local behind your existing proxy)."
      fi
    done
  fi
  if command -v getent >/dev/null 2>&1 && [ "$DOMAIN" != "localhost" ] && ! getent hosts "$DOMAIN" >/dev/null 2>&1; then
    warn "$DOMAIN does not resolve yet. Create a DNS A/AAAA record pointing to this server's public IP; Caddy retries automatically."
  fi
}

# ------------------------------------------------------------------ backups
write_backup_script() {
  cat >"$DIR/backup.sh" <<EOF
#!/bin/sh
# Famalio Home – consistent PostgreSQL dump (pg_dump custom format) into
# $DIR/backups, keeping 14 days. Written by install.sh; safe to run any time.
set -eu
dest="$DIR/backups"
mkdir -p "\$dest"
chmod 0700 "\$dest"
umask 077
stamp="\$(date +%Y%m%d-%H%M%S)"
tmp="\$dest/.famalio-\$stamp.dump.partial"
docker compose --project-directory "$DIR/app/standalone" --env-file "$DIR/famalio.env" \\
  -f "$DIR/app/standalone/compose.yaml" exec -T -u postgres postgres \\
  pg_dump -Fc -d famalio >"\$tmp" </dev/null
[ -s "\$tmp" ] || { rm -f "\$tmp"; echo "famalio backup: empty dump" >&2; exit 1; }
mv "\$tmp" "\$dest/famalio-\$stamp.dump"
find "\$dest" -maxdepth 1 -type f -name 'famalio-*.dump' -mtime +13 -exec rm -f {} \\;
echo "\$dest/famalio-\$stamp.dump"
EOF
  chmod 0700 "$DIR/backup.sh"
}

remove_backup_schedule() {
  if [ -f /etc/systemd/system/famalio-home-backup.timer ]; then
    systemctl disable --now famalio-home-backup.timer >/dev/null 2>&1 || true
    rm -f /etc/systemd/system/famalio-home-backup.timer /etc/systemd/system/famalio-home-backup.service
    systemctl daemon-reload >/dev/null 2>&1 || true
  fi
  rm -f /etc/cron.d/famalio-home-backup /etc/periodic/daily/famalio-home-backup
}

install_backup_schedule() {
  mkdir -p "$DIR/backups"
  chmod 0700 "$DIR/backups"
  write_backup_script
  if [ "$BACKUP" != "1" ]; then
    remove_backup_schedule
    return 0
  fi
  if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
    cat >/etc/systemd/system/famalio-home-backup.service <<EOF
[Unit]
Description=Famalio Home database backup
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=$DIR/backup.sh
EOF
    cat >/etc/systemd/system/famalio-home-backup.timer <<'EOF'
[Unit]
Description=Daily Famalio Home database backup

[Timer]
OnCalendar=*-*-* 03:30:00
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now famalio-home-backup.timer >/dev/null 2>&1
    BACKUP_HOW="systemd timer famalio-home-backup.timer (daily ~03:30)"
  elif [ -d /etc/periodic/daily ]; then
    printf '#!/bin/sh\n%s/backup.sh >/dev/null\n' "$DIR" >/etc/periodic/daily/famalio-home-backup
    chmod 0755 /etc/periodic/daily/famalio-home-backup
    rc-update add crond default >/dev/null 2>&1 || true
    rc-service crond start >/dev/null 2>&1 || true
    BACKUP_HOW="/etc/periodic/daily (crond)"
  elif [ -d /etc/cron.d ]; then
    printf 'SHELL=/bin/sh\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n30 3 * * * root %s/backup.sh >/dev/null\n' "$DIR" >/etc/cron.d/famalio-home-backup
    chmod 0644 /etc/cron.d/famalio-home-backup
    BACKUP_HOW="/etc/cron.d/famalio-home-backup (daily 03:30)"
  else
    warn "no systemd or cron found; run $DIR/backup.sh regularly yourself."
    BACKUP_HOW="manual ($DIR/backup.sh)"
  fi
}

# ------------------------------------------------------------------ run
stop_unused_profiles() {
  [ "$MODE" = "tailscale" ] || dc --profile tailscale rm -s -f tailscale >/dev/null 2>&1 || true
  [ "$MODE" = "domain" ] || dc --profile domain rm -s -f caddy >/dev/null 2>&1 || true
}

wait_healthy() {
  info "Waiting for the API on http://127.0.0.1:$API_PORT/health/live ..."
  i=0
  until curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/health/live" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -gt 90 ]; then
      dc ps || true
      dc logs --no-color --tail 60 famalio-migrate famalio-server postgres || true
      die "the API did not become healthy within 3 minutes (logs above)."
    fi
    sleep 2
  done
  info "API is healthy."
}

start_stack() {
  stop_unused_profiles
  info "Building and starting containers (the first build takes a few minutes) ..."
  dc up -d --build
  wait_healthy
}

tailscale_url() {
  i=0
  while [ "$i" -lt 45 ]; do
    for sock in /tmp/tailscaled.sock /var/run/tailscale/tailscaled.sock; do
      name="$(dc exec -T tailscale tailscale --socket="$sock" status --json 2>/dev/null \
        | sed -n 's/^[[:space:]]*"DNSName":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)"
      name="${name%.}"
      if [ -n "$name" ]; then printf 'https://%s' "$name"; return 0; fi
    done
    i=$((i + 1))
    sleep 2
  done
  return 1
}

server_url() {
  case "$MODE" in
    domain) printf 'https://%s' "$DOMAIN" ;;
    tailscale) tailscale_url || printf '' ;;
    *) printf '' ;;
  esac
}

check_domain() {
  [ "$MODE" = "domain" ] || return 0
  k=""
  [ "$DOMAIN" != "localhost" ] || k="-k"
  info "Waiting for the HTTPS certificate for $DOMAIN (up to 2 minutes) ..."
  i=0
  # shellcheck disable=SC2086
  until curl -fsS $k -o /dev/null --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/health/live" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -gt 40 ]; then
      warn "https://$DOMAIN is not answering with a valid certificate yet. Check DNS, that ports 80/443 are reachable from the internet, and: docker compose logs caddy"
      return 0
    fi
    sleep 3
  done
  info "https://$DOMAIN answers with a valid certificate."
}

setup_code() {
  dc logs --no-color --no-log-prefix famalio-server 2>/dev/null \
    | awk '/owner setup code/ { if ((getline line) > 0) code = line } END { if (code != "") print code }'
}

print_summary() {
  url="$(server_url)"
  code="$(setup_code)"
  printf '\n%s============================================================%s\n' "$C_B" "$C_0"
  printf '%s Famalio Home is running.%s\n' "$C_B" "$C_0"
  printf '%s============================================================%s\n\n' "$C_B" "$C_0"
  case "$MODE" in
    local)
      printf ' Mode:            local (loopback only)\n'
      printf ' Proxy upstream:  http://127.0.0.1:%s\n' "$API_PORT"
      printf ' Server address:  the https:// address of YOUR reverse proxy\n'
      printf '                  (publicly trusted certificate; self-signed is refused by the app)\n' ;;
    domain)
      printf ' Mode:            own domain (Caddy + Let'"'"'s Encrypt)\n'
      printf ' Server address:  %s%s%s\n' "$C_B" "$url" "$C_0" ;;
    tailscale)
      printf ' Mode:            Tailscale (private HTTPS in your tailnet)\n'
      if [ -n "$url" ]; then
        printf ' Server address:  %s%s%s\n' "$C_B" "$url" "$C_0"
      else
        printf ' Server address:  not known yet. Check: cd %s/app/standalone && docker compose logs tailscale\n' "$DIR"
        printf '                  (then https://%s.<your-tailnet>.ts.net)\n' "$TS_HOSTNAME"
      fi
      printf '                  Enable HTTPS certificates in the Tailscale admin console (DNS page)\n'
      printf '                  and install Tailscale on every phone (same tailnet).\n' ;;
  esac
  printf '\n'
  if [ -n "$code" ]; then
    printf ' Owner setup code: %s%s%s\n' "$C_B" "$code" "$C_0"
    printf '                   single use, valid 30 minutes after the server started.\n'
  else
    printf ' Owner setup code: none printed (an owner already exists, or the server was\n'
    printf '                   not restarted). While no owner exists, get a fresh code with:\n'
    printf '                   cd %s/app/standalone && sudo docker compose restart famalio-server\n' "$DIR"
    printf '                   sudo docker compose logs famalio-server\n'
  fi
  cat <<EOF

 Next steps in the Famalio app (phone):
   1. Settings -> Famalio Home -> Home server connection
   2. Enter the server address and tap "Check connection".
   3. Expand "Set up a new Home family": your display name, family name and the
      server setup code above, then tap "Create Home family".
   4. Write down the recovery code the app shows once.

 Files:
   Install directory:  $DIR   (app/, secrets/ root-only, backups/)
   Backups:            $DIR/backups  ${BACKUP_HOW:-(not scheduled; run $DIR/backup.sh)}
   Logs:               cd $DIR/app/standalone && sudo docker compose logs -f famalio-server
   Update:             sudo sh $DIR/install.sh --update
   Uninstall:          sudo sh $DIR/install.sh --uninstall
   Guide:              https://github.com/$REPO#installation-without-home-assistant-docker-compose
EOF
}

do_install() {
  install_prereqs
  install_docker
  mkdir -p "$DIR"
  chmod 0755 "$DIR"
  load_previous
  choose_mode
  if [ ! -f "$DIR/app/standalone/compose.yaml" ] || [ -n "$SOURCE" ]; then
    fetch_source "$DIR/app.new"
    rm -rf "$DIR/app"
    mv "$DIR/app.new" "$DIR/app"
    ln -sfn "$DIR/famalio.env" "$DIR/app/standalone/.env"
  else
    info "Keeping the installed version in $DIR/app (use --update for a new one)."
  fi
  cp "$DIR/app/install.sh" "$DIR/install.sh" 2>/dev/null && chmod 0755 "$DIR/install.sh" || true
  write_env
  make_secrets
  preflight_domain
  install_backup_schedule
  start_stack
  check_domain
  print_summary
}

do_update() {
  [ -f "$DIR/famalio.env" ] || die "no installation found in $DIR (run without --update first)."
  install_prereqs
  install_docker
  load_previous
  choose_mode
  if [ -n "$(dc ps -q postgres 2>/dev/null)" ] && [ -x "$DIR/backup.sh" ]; then
    info "Taking a backup before the update ..."
    "$DIR/backup.sh" >/dev/null || warn "pre-update backup failed; continuing."
  fi
  fetch_source "$DIR/app.new"
  rm -rf "$DIR/app.old"
  [ ! -d "$DIR/app" ] || mv "$DIR/app" "$DIR/app.old"
  mv "$DIR/app.new" "$DIR/app"
  ln -sfn "$DIR/famalio.env" "$DIR/app/standalone/.env"
  cp "$DIR/app/install.sh" "$DIR/install.sh" 2>/dev/null && chmod 0755 "$DIR/install.sh" || true
  write_env
  make_secrets
  install_backup_schedule
  start_stack
  rm -rf "$DIR/app.old"
  check_domain
  print_summary
}

do_uninstall() {
  [ -d "$DIR" ] || die "nothing installed in $DIR."
  old_mode="$(env_get FAMALIO_MODE)"
  if [ -n "$TTY" ]; then
    confirm "Stop and remove the Famalio Home containers in $DIR?" y || { info "Nothing changed."; exit 0; }
    if [ "$PURGE" -eq 0 ]; then
      printf '\nDelete ALL Famalio Home data too (database, secrets, backups in %s)?\n' "$DIR" >/dev/tty
      printf 'This cannot be undone. Type "delete" to confirm, or press Enter to keep the data: ' >/dev/tty
      a=""; IFS= read -r a </dev/tty || a=""
      [ "$a" != "delete" ] || PURGE=1
    fi
  fi
  if command -v docker >/dev/null 2>&1 && [ -f "$DIR/app/standalone/compose.yaml" ] && [ -f "$DIR/famalio.env" ]; then
    if [ "$PURGE" -eq 1 ]; then
      dc --profile tailscale --profile domain down -v --rmi local --remove-orphans || true
    else
      dc --profile tailscale --profile domain down --remove-orphans || true
    fi
  fi
  remove_backup_schedule
  if [ "$PURGE" -eq 1 ]; then
    rm -rf "$DIR"
    info "Famalio Home and all its data were removed."
  else
    info "Containers removed. Data kept: Docker volumes famalio-home_pgdata (database)"
    info "and $DIR (secrets, backups). Re-run install.sh to start again, or"
    info "run 'sudo sh $DIR/install.sh --uninstall --purge' to delete everything."
  fi
  if [ "$old_mode" = "tailscale" ]; then
    info "Remove the device in the Tailscale admin console as well."
  fi
}

main() {
  parse_args "$@"
  detect_system
  if [ "$ACTION" = "check" ]; then
    print_system
    info "Check only: nothing was changed."
    exit 0
  fi
  [ "$(id -u)" -eq 0 ] || die "please run as root, e.g. with sudo."
  print_system
  if [ "$ACTION" = "prereqs" ]; then
    install_prereqs
    exit 0
  fi
  setup_tty
  case "$ACTION" in
    install) do_install ;;
    update) do_update ;;
    uninstall) do_uninstall ;;
  esac
}

main "$@"
