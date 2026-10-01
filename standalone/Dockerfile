# syntax=docker/dockerfile:1
# Famalio Home server – standalone image (P06, not released).
#
# Build from this directory (standalone/); server sources are in ./server:
#   docker build -t famalio-home-server:dev .   (run inside standalone/)
# BuildKit picks up Dockerfile.dockerignore next to this file and sends only
# server/{package.json,package-lock.json,src,sql} plus the entrypoint.
#
# Supply-chain policy (SEC-09 / OPS-04):
#   The base image MUST be pinned by digest for any release build:
#     --build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:<digest>
#   TODO(P06/G8): record the digest that was actually pulled and tested; it is
#   intentionally NOT filled in here because no image could be pulled in the
#   environment that wrote this file (no Docker daemon). Never use a `latest` tag.
#
# No secrets are baked in: database passwords arrive at runtime as files
# (docker secrets) and are read by entrypoint.sh.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /opt/famalio
COPY server/package.json server/package-lock.json ./
# Lockfile install, runtime deps only, no lifecycle scripts from dependencies.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    FAMALIO_HOST=0.0.0.0 \
    FAMALIO_PORT=8787
# Dedicated unprivileged account; no shell login, no home directory writes needed.
RUN groupadd --system --gid 10001 famalio \
 && useradd --system --uid 10001 --gid famalio --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin famalio
WORKDIR /opt/famalio
# Application files are owned by root and read-only for the runtime user, so the
# container works with `read_only: true` and the process cannot modify its code.
COPY --from=deps --chown=root:root /opt/famalio/node_modules ./node_modules
COPY --chown=root:root server/package.json ./package.json
COPY --chown=root:root server/src ./src
COPY --chown=root:root server/sql ./sql
COPY --chown=root:root --chmod=0755 entrypoint.sh /usr/local/bin/famalio-entrypoint
USER 10001:10001
EXPOSE 8787
# Liveness only (no family content). Uses Node's built-in fetch; no curl in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.FAMALIO_PORT||8787)+'/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/famalio-entrypoint"]
CMD ["serve"]
