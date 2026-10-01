#!/bin/sh
# Creates the database secrets for compose.yaml if they do not exist yet.
# Idempotent: never overwrites an existing secret (the data volume was
# initialised with it). Does not create the Tailscale auth key.
#
#   ./make-secrets.sh            # -> ./secrets next to this script
#   ./make-secrets.sh /some/dir  # -> /some/dir (used by ../install.sh)
#
# The directory is 0700 (owner only). The files are 0644 because two different
# container users read them through Docker's bind mounts (postgres uid 999 and
# famalio uid 10001); the 0700 directory keeps other host users out.
set -eu
dir="${1:-${FAMALIO_SECRETS_DIR:-$(cd "$(dirname "$0")" && pwd)/secrets}}"
mkdir -p "$dir"
chmod 0700 "$dir"
for name in postgres_superuser_password famalio_owner_password famalio_app_password; do
  file="$dir/$name"
  if [ -s "$file" ]; then
    echo "keep     $name"
    continue
  fi
  # 256 bit, hex (URL-safe; no quoting issues in connection strings).
  umask 022
  od -An -tx1 -N32 /dev/urandom | tr -d ' \n' >"$file"
  chmod 0644 "$file"
  echo "created  $name"
done
