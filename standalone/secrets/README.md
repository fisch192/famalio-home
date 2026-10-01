# secrets/

Host-only secret files for `compose.yaml`. Everything except this README and
`.gitignore` is ignored by git. Never commit or share these files.

| File | Created by | Used by |
|---|---|---|
| `postgres_superuser_password` | `../make-secrets.sh` | `postgres` only |
| `famalio_owner_password` | `../make-secrets.sh` | `postgres` (init), `famalio-migrate` |
| `famalio_app_password` | `../make-secrets.sh` | `postgres` (init), `famalio-server` |
| `ts_authkey` | you (Tailscale admin console) | `tailscale` (optional profile) |
