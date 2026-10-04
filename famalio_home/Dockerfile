# syntax=docker/dockerfile:1
# Famalio Home – Home Assistant app/add-on image (P06, experimental).
#
# Build context is this directory. In the public repository server/ and wizard/ are already staged (publish-repo.sh); the monorepo script stage-ha-addon.sh does: it copies
# server/famalio-home/{package.json,package-lock.json,src,sql} and the setup
# wizard into this build context (git-ignored), because the HA builder cannot
# see files outside the add-on directory.
#
# Supervisor 2026.04+ no longer reads build.yaml or supplies BUILD_FROM.
# BUILD_ARCH is supplied by the current Supervisor builder; this explicit
# mapping also keeps local builds architecture-correct. Pin the base tag and
# digest after a release image has been built and tested.
#   ghcr.io/home-assistant/{aarch64|amd64}-base-debian:<version>
# NODE_IMAGE must be pinned by digest for a release (TODO, see ../README.md).
ARG BUILD_ARCH=amd64
ARG BUILD_VERSION=0.5.5
ARG BUILD_FROM=ghcr.io/home-assistant/${BUILD_ARCH}-base-debian:bookworm
ARG NODE_IMAGE=node:22-bookworm-slim
# Official Tailscale image; only its two static binaries are copied (userspace
# networking, no capabilities). TODO(release): pin a version + digest.
ARG TAILSCALE_IMAGE=tailscale/tailscale:stable

FROM ${NODE_IMAGE} AS node
FROM ${TAILSCALE_IMAGE} AS tailscale

FROM ${NODE_IMAGE} AS deps
WORKDIR /opt/famalio
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force

FROM ${BUILD_FROM}
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ARG BUILD_ARCH
ARG BUILD_VERSION

# PostgreSQL 16 from the PostgreSQL Global Development Group apt repository.
# The signing key is verified against its full fingerprint before use (no
# `curl | sh`). Fingerprint checked against the key shipped in Ubuntu's
# postgresql-common package: B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8.
ARG PGDG_KEY_FPR=B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8
ARG PG_MAJOR=16
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /tmp/pgdg.asc \
 && gpg --batch --show-keys --with-colons /tmp/pgdg.asc | grep -q "^fpr:::::::::${PGDG_KEY_FPR}:$" \
 && gpg --batch --dearmor -o /usr/share/keyrings/pgdg.gpg /tmp/pgdg.asc \
 && rm /tmp/pgdg.asc \
 && . /etc/os-release \
 && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && mkdir -p /etc/postgresql-common/createcluster.d \
 && echo "create_main_cluster = false" > /etc/postgresql-common/createcluster.d/00-famalio.conf \
 && apt-get update \
 && apt-get install -y --no-install-recommends "postgresql-${PG_MAJOR}" \
 && apt-get purge -y gnupg \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

# Node.js runtime copied from the (pinned) official image of the same arch.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
# Tailscale CLI + daemon (static Go binaries) for the add-on's own tailnet node.
COPY --from=tailscale /usr/local/bin/tailscale /usr/local/bin/tailscaled /usr/local/bin/

# Separate unix accounts (ADR-002 §3): postgres (from the package) runs the
# database; famalio_owner runs migrations only; famalio_app runs the API;
# famalio_ts runs the userspace Tailscale node (not in famalio_db: no DB access).
# PostgreSQL peer authentication maps each account to the role of the same
# name, so there are no database passwords at all in the add-on. Both Famalio
# accounts have famalio_db as primary group: only that group (and postgres) may
# enter the socket directory /run/postgresql (postgres:famalio_db, 0750).
RUN groupadd --system famalio_db \
 && useradd --system --uid 10001 --gid famalio_db --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin famalio_app \
 && useradd --system --uid 10002 --gid famalio_db --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin famalio_owner \
 && useradd --system --uid 10003 --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin famalio_ts

WORKDIR /opt/famalio
COPY --from=deps --chown=root:root /opt/famalio/node_modules ./node_modules
COPY --chown=root:root server/package.json ./package.json
COPY --chown=root:root server/src ./src
COPY --chown=root:root server/sql ./sql
COPY --chown=root:root wizard/ /opt/famalio-wizard/
# Bundled Home Assistant integration; copied into /homeassistant/custom_components on start.
COPY --chown=root:root integration/ /opt/famalio-integration/famalio/
COPY rootfs /
RUN chmod 0755 /etc/s6-overlay/scripts/*.sh \
 && find /etc/s6-overlay/s6-rc.d \( -name run -o -name finish \) -exec chmod 0755 {} +

ENV FAMALIO_PORT=8787 \
    S6_BEHAVIOUR_IF_STAGE2_FAILS=2 \
    S6_CMD_WAIT_FOR_SERVICES_MAXTIME=0 \
    S6_SERVICES_GRACETIME=45000

# Container-network peers can reach the TLS-only relay; no Supervisor host port
# is mapped. The wizard uses 8099 through authenticated Supervisor Ingress.
EXPOSE 9443/tcp

# The image has no default USER because s6-overlay (PID 1) must start as root
# to drop each service to its own account (s6-setuidgid). No service process
# runs as root: postgres, famalio_owner, famalio_app and famalio_ts only.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD ["/usr/local/bin/node", "-e", "fetch('http://127.0.0.1:8787/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

LABEL io.hass.type="app" \
      io.hass.version="${BUILD_VERSION}" \
      io.hass.arch="${BUILD_ARCH}" \
      io.hass.name="Famalio Home" \
      io.hass.stage="experimental"
