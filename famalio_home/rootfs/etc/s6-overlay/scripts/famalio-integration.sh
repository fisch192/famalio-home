#!/command/with-contenv bash
# shellcheck shell=bash
# Oneshot (root): copy the bundled Home Assistant integration into the HA config
# folder (the add-on's only host mapping) when it is missing or older. A copy
# with the same or a newer version (e.g. installed by HACS or by hand) is never
# touched. Never fails the add-on start: problems are logged and reported to the
# setup panel through $FAMALIO_SETUP_DIR/integration.json.
set -uo pipefail
# shellcheck source=SCRIPTDIR/famalio-env.sh
. "$(dirname "$0")/famalio-env.sh"

status_file="$FAMALIO_SETUP_DIR/integration.json"
write_status() { # <state> <bundled> <installed>
  install -d -o "$FAMALIO_TS_USER" -g "$FAMALIO_TS_USER" -m 0700 "$FAMALIO_SETUP_DIR" 2>/dev/null || mkdir -p "$FAMALIO_SETUP_DIR"
  node -e '
    const [file, state, bundled, installed] = process.argv.slice(1);
    const fs = require("fs");
    fs.writeFileSync(file + ".tmp", JSON.stringify({ state, bundled_version: bundled || null, installed_version: installed || null }) + "\n", { mode: 0o600 });
    fs.renameSync(file + ".tmp", file);
  ' "$status_file" "$1" "$2" "$3" && chown "$FAMALIO_TS_USER:$FAMALIO_TS_USER" "$status_file" || true
}
manifest_version() { # <dir>
  node -e '
    try { const v = JSON.parse(require("fs").readFileSync(process.argv[1] + "/manifest.json", "utf8")).version; process.stdout.write(typeof v === "string" ? v : ""); } catch {}
  ' "$1"
}
# prints -1, 0 or 1 for <installed> vs <bundled>; non-numeric parts count as 0
compare_versions() {
  node -e '
    const parse = (v) => String(v).split(/[.+-]/).slice(0, 4).map((x) => (/^\d+$/.test(x) ? Number(x) : 0));
    const a = parse(process.argv[1]), b = parse(process.argv[2]);
    let r = 0;
    for (let i = 0; i < 4 && r === 0; i++) r = Math.sign((a[i] || 0) - (b[i] || 0));
    process.stdout.write(String(r));
  ' "$1" "$2"
}

root=""
# /homeassistant is the mapped path (config.yaml); the second is the legacy default.
for candidate in ${FAMALIO_HA_CONFIG_DIRS:-/homeassistant /homeassistant_config}; do
  if [ -d "$candidate" ]; then root="$candidate"; break; fi
done
bundled="$(manifest_version "$FAMALIO_INTEGRATION_SRC")"
if [ -z "$root" ] || [ -z "$bundled" ]; then
  echo "[famalio] integration auto-install unavailable (HA config folder or bundled integration missing)" >&2
  write_status unavailable "$bundled" ""
  exit 0
fi

dest="$root/custom_components/famalio"
installed=""
[ -d "$dest" ] && installed="$(manifest_version "$dest")"
state=installed
if [ -d "$dest" ]; then
  if [ -z "$installed" ]; then
    state=updated   # unreadable manifest: replace the broken copy
  else
    case "$(compare_versions "$installed" "$bundled")" in
      -1) state=updated ;;
      0)  state=current ;;
      *)  state=newer ;;
    esac
  fi
fi

if [ "$state" = installed ] || [ "$state" = updated ]; then
  mkdir -p "$root/custom_components"
  tmp="$root/custom_components/.famalio.new.$$"
  rm -rf "$tmp"
  if cp -R "$FAMALIO_INTEGRATION_SRC" "$tmp" && rm -rf "$dest" && mv "$tmp" "$dest"; then
    echo "[famalio] Home Assistant integration $state: $installed -> $bundled (restart Home Assistant to load it)"
    installed="$bundled"
  else
    rm -rf "$tmp"
    echo "[famalio] could not copy the integration into $root/custom_components" >&2
    write_status unavailable "$bundled" "$installed"
    exit 0
  fi
else
  echo "[famalio] Home Assistant integration $installed is $state; leaving it untouched (bundled $bundled)"
fi
write_status "$state" "$bundled" "$installed"
