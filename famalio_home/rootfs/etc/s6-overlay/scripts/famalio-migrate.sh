#!/command/with-contenv bash
# shellcheck shell=bash
# Oneshot (as famalio_owner): apply the schema. On failure the oneshot fails,
# s6 stops the container (S6_BEHAVIOUR_IF_STAGE2_FAILS=2) and the migration is
# NOT retried in a loop (OPS-04). The API process never gets the owner role.
set -euo pipefail
# shellcheck source=SCRIPTDIR/famalio-env.sh
. "$(dirname "$0")/famalio-env.sh"
cd "$FAMALIO_APP_DIR"
FAMALIO_OWNER_DATABASE_URL="$(pg_socket_url famalio_owner)"
export FAMALIO_OWNER_DATABASE_URL
export FAMALIO_APP_ROLE=famalio_app
unset FAMALIO_DATABASE_URL
as famalio_owner node src/migrate.ts
