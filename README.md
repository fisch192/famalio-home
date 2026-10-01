# Famalio Home

**Famalio Home** is a self-hosted server for the Famalio family
calendar app (iOS and Android). Your family's calendar is stored on a machine you own
instead of in the Famalio cloud. You can run it in two ways:

1. **On Home Assistant**, as an add-on (plus an optional HACS integration that shows your
   Famalio calendars in Home Assistant), or
2. **On any Linux server without Home Assistant** (a mini PC, a Raspberry Pi 4/5 with a
   64-bit OS, a NAS, a VPS) with **one install command**.

| Folder / file | What it is |
|---|---|
| `famalio_home/` | Home Assistant **add-on**: the Famalio server (PostgreSQL 16 + API), setup wizard and calendar workspace |
| `custom_components/famalio/` | Home Assistant **integration** (via HACS): your Famalio calendars as HA calendar entities, optionally editable |
| `install.sh` | **One-command installer** for Linux servers without Home Assistant |
| `standalone/` | The same server as **Docker Compose** project (used by `install.sh`) |

Deutsche Anleitung: [docs/INSTALL.de.md](docs/INSTALL.de.md)

> **Status: experimental, version 0.3.0.** Verified so far: the amd64 Home Assistant
> add-on builds and runs on Home Assistant OS (database, migrations, owner setup, pairing,
> calendar create/read/update/delete, scoped HA reads, restart persistence, cold backup).
> The Linux installer is tested automatically on every change (install, re-run, backup,
> restore of a fresh database, update, uninstall on Ubuntu; OS detection and base tools on
> Debian, Ubuntu, Fedora, Rocky, Alma, openSUSE, Arch and Alpine).
> **Not verified yet:** the `aarch64` add-on build, restoring a Home Assistant backup,
> a real Let's Encrypt certificate and a real Tailscale login with the installer, long-term
> load. Report problems in the [issue tracker](https://github.com/fisch192/famalio-home/issues).
> Keep using Famalio's normal sync as well; do not make this your only copy.

## Contents

- [How it fits together](#how-it-fits-together)
- [Requirements](#requirements)
- [Installation on Home Assistant](#installation-on-home-assistant)
- [Installation without Home Assistant (Docker Compose)](#installation-without-home-assistant-docker-compose)
- [HTTPS options explained](#https-options-explained)
- [Connect the Famalio app](#connect-the-famalio-app)
- [Pair more phones](#pair-more-phones)
- [Backups, restore, updates, uninstall (Linux)](#backups-restore-updates-uninstall-linux)
- [Troubleshooting (Linux)](#troubleshooting-linux)
- [Security](#security)
- [FAQ](#faq)

## How it fits together

```
 Famalio app (phones)                     your machine
 ┌──────────────┐   HTTPS   ┌────────────────────────────────────────┐
 │ iPhone /     │ ────────▶ │ HTTPS entry: Tailscale, Caddy (own     │
 │ Android      │           │ domain) or your reverse proxy          │
 └──────────────┘           │        │                               │
                            │        ▼                               │
                            │ Famalio API ──▶ PostgreSQL (private)   │
                            └────────▲───────────────────────────────┘
                                     │ approved, scoped, revocable grant
                            Home Assistant integration (optional)
```

- The **phones** only talk to the Famalio API over **HTTPS** with a publicly trusted
  certificate. Plain `http://` and self-signed certificates are refused by the app.
- The **database** is never reachable from the network.
- **Home Assistant is optional.** If you use it, it only gets what the owner approves in the
  app: chosen calendars, a detail level and a time range. Home Assistant accounts are not
  Famalio family roles.

## Requirements

- The Famalio app with **Famalio Home** purchased. In the app you will see
  **Settings → Famalio Home**.
- **Either** Home Assistant OS / Supervised (see below), **or** a Linux machine:
  - 64-bit CPU: `x86_64`/`amd64` or `aarch64`/`arm64` (32-bit ARM is not supported),
  - about 1 GB free RAM and a few GB of disk space,
  - Debian 11/12, Ubuntu 20.04/22.04/24.04, Raspberry Pi OS (64-bit), Fedora,
    RHEL/Rocky/AlmaLinux 8/9, CentOS Stream, openSUSE Leap/Tumbleweed, Arch/Manjaro,
    or Alpine (best effort). Docker is installed automatically if missing.
- One way for phones to reach the server over HTTPS (see
  [HTTPS options explained](#https-options-explained)): Tailscale (easiest), your own domain,
  or a reverse proxy you already run.

---

## Installation on Home Assistant

### 1. Requirements

- Home Assistant OS or Supervised, with the add-on store (Settings → Add-ons).
  In the newest Home Assistant versions add-ons are called *Apps*.
- CPU `amd64` (tested) or `aarch64` (builds untested). About 1 GB of free RAM
  and some GB of disk space. The add-on is **built on your Home Assistant** on
  first install; this needs internet access and can take several minutes.
- The Famalio app with **Famalio Home** purchased. In the app you will see
  **Settings → Famalio Home**.
- One way to reach the server from your phones over HTTPS:
  - a free [Tailscale](https://tailscale.com) account (recommended), with the
    Tailscale app on every phone that will use Famalio, **or**
  - an HTTPS reverse proxy you already run, with a public host name and a
    publicly trusted certificate.

### 2. Add the add-on repository

Click the button (opens your Home Assistant):

[![Add repository to my Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Ffisch192%2Ffamalio-home)

or do it by hand:

1. **Settings → Add-ons → Add-on Store**.
2. Top right **⋮ → Repositories**.
3. Paste `https://github.com/fisch192/famalio-home` and click **Add**, then **Close**.

### 3. Install and start the add-on

1. In the add-on store, scroll to **Famalio Home** (reload the page if it is missing) and open **Famalio**.
2. Click **Install** and wait until the local build finishes (several minutes).
3. Turn on **Start on boot**, then click **Start**.
4. Click **Open Web UI**, or use **Famalio** in the Home Assistant sidebar. If the sidebar entry is missing, enable **Show in sidebar** on the add-on page.

### 4. Choose how phones reach the server (HTTPS)

The wizard on the Famalio page asks for this after the database is ready.

**Tailscale (recommended)**

1. Choose **Tailscale** and click the sign-in link shown in the wizard.
2. Log in to Tailscale and approve the new device (default name `famalio-home`).
3. If Tailscale asks, enable **HTTPS certificates** for your tailnet
   (Tailscale admin console → DNS → HTTPS Certificates).
4. Wait until the wizard shows a green address like
   `https://famalio-home.<your-tailnet>.ts.net`. This is your **server address**.
5. Install Tailscale on each phone and log in to the same tailnet.

No router port forwarding, Funnel or subnet routes are needed or enabled.

**Existing HTTPS reverse proxy (advanced)**

1. Choose **Reverse proxy** and enter your HTTPS address (for example
   `https://famalio.example.org`).
2. Configure your proxy upstream to the internal host name and port shown in
   the wizard (for a repository install, the host name contains a hash prefix
   and looks like `xxxxxxxx-famalio-home:8787`; copy it from the wizard).
3. The wizard checks the certificate and the Famalio instance. Plain HTTP and
   self-signed certificates are rejected. Do not publish a port on the host or router.

### 5. Connect the Famalio app (owner setup)

1. In Home Assistant open the add-on, tab **Log**. On the first start it prints a
   one-time **owner setup code**. It is valid for 30 minutes and works once.
   If it expired, restart the add-on to get a new one (only while no owner exists).
2. On your phone open the Famalio app: **Settings → Famalio Home → Home server connection**
   (appears once your Home purchase is activated).
3. Enter the **HTTPS server address** from step 4 and tap **Check connection**.
4. Expand **Set up a new Home family**, enter **Your display name**, **Family name** and the
   **Server setup code**, then tap **Create Home family**.
5. The app now shows a **recovery code exactly once**. Write it down and keep it
   safe. Without a paired device it is the only way to regain owner access.

### 6. Install the integration (HACS)

You need [HACS](https://hacs.xyz). Click:

[![Open your Home Assistant instance and open this repository in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=fisch192&repository=famalio-home&category=integration)

then **Download** and **restart Home Assistant** (Settings → System → power icon → Restart).

Without HACS: copy the folder `custom_components/famalio` from this repository
to `<config>/custom_components/famalio` on your Home Assistant (for example with
the *File editor* or *Samba* add-on), then restart Home Assistant.

### 7. Connect Home Assistant to Famalio (one click)

1. In the sidebar open **Famalio**. Choose **Einrichtung → Mit Famalio verbinden**.
   A short code appears.
2. In the Famalio app open **Settings → Famalio Home → Home server connection → Home Assistant**
   Under **Connection requests** open the request showing exactly that code.
3. Choose which calendars Home Assistant may see, full details or *Busy* only, and
   the time range. Optional: **Allow Home Assistant to edit** lets Home Assistant
   create, change and delete single events (needs full details).
4. Tap **Approve connection** and wait a few seconds. The panel confirms the integration by itself and switches to
   the calendar. Your calendars also appear under Settings → Devices & services → Famalio Home.

No token has to be copied. If the button does not work, expand the manual token
option in the panel or create an integration grant in the app and paste its
`fhi_…` token in Settings → Devices & services → Add integration → Famalio Home.

### 8. Pair more phones

On the owner's phone: **Settings → Famalio Home → Home server connection →
Create device pairing code** (works once) and share it. On the second phone (with
Tailscale running, if you use it) open the same screen, enter the server address, tap
**Check connection**, then under **Join an existing Home family** enter a display name and
the **Device pairing code** and tap **Request connection**. On the owner's phone approve the
device request with **Allow editing**, then tap **Check approval** on the second phone.

### 9. Everyday use

**Calendar.** The Famalio panel shows month, week, day and agenda views. With
edit access you can create events (**Neuer Termin** or double-click a slot),
change (**Bearbeiten**) or delete (**Löschen**) them. Repeating and imported
events stay editable only in the app.

**Automations.** Select an event → **＋ Automation**. Pick the scope (this
occurrence, exact title, title contains a word, whole calendar), timing (start
or end, with offset) and one or more Home Assistant service actions (scenes,
scripts, lights, notify, ...). Rules run in Home Assistant's scheduler and are
listed in its automation editor. Saving never runs the action immediately.

**Backups.** The add-on uses cold backups: Home Assistant stops it briefly during
a backup so the database is consistent. Include *Famalio* in your backups and
keep a copy off the machine. A cold backup works; restoring is **not yet verified**,
so test on a spare Home Assistant instance, never over the running one.

**Updates.** Update from the add-on page (a new local build is performed). Database
changes run automatically and are additive; a newer database is never downgraded,
so installing an older add-on over newer data is not a rollback. Update the
integration in HACS and restart Home Assistant.

**Uninstall.** Revoke the grant in the app (**Home Assistant** screen), remove the
integration (Settings → Devices & services → Famalio Home → Delete), remove it in
HACS, then uninstall the add-on. Uninstalling the add-on deletes its data
including the database. Remove the device in the Tailscale admin console.

### Troubleshooting (Home Assistant)

| Problem | What to do |
|---|---|
| Add-on not shown in the store | Repositories dialog: check the URL, then reload the page or **⋮ → Check for updates**. |
| Installation fails during build | Home Assistant needs internet (Debian, Docker Hub, PostgreSQL apt repository, npm). Check the add-on **Log** and disk space, then retry. |
| Sidebar entry missing | Add-on page → enable **Show in sidebar**. The page is visible to HA administrators only. |
| No setup code in the log | The code appears only while no owner exists and for 30 minutes. Restart the add-on to get a new one. If an owner already exists, pair with a pairing code instead. |
| Tailscale link expired or no green address | Reopen the wizard and restart the Tailscale step. Make sure **HTTPS certificates** are enabled for the tailnet. |
| App cannot connect | The address must be `https://…` and reachable from the phone: is Tailscale running on the phone? Plain HTTP and self-signed certificates are refused. |
| Rate limit / "too many requests" while pairing | Requests share a source address behind the proxy; wait one minute and retry (option `unauthenticated_rate_per_minute`). |
| "Mit Famalio verbinden" waits forever | Approve the code in the app within its lifetime; ensure the integration is installed and Home Assistant was restarted; open **Settings → Devices & services** and confirm a discovered Famalio entry if shown. |
| Calendar stays on Einrichtung | Discovery alone is not enough; the panel waits until HA has registered a Famalio calendar entity (checked every 15 s). |
| No edit buttons | Edit access must be allowed in the app and the grant must use full details (not *Busy*). Repeating events are app-only (HTTP 409). |
| Integration asks to re-authenticate | The grant was revoked or expired; create a new one with **Mit Famalio verbinden**. |
| Update seems to roll back data | Never install an older add-on version over newer data; restore a backup. |

For logs enable debug logging of the *Famalio Home* integration; logs should
not contain tokens or event contents, but remove private addresses before sharing.

### Security and privacy (Home Assistant add-on)

- Your calendar data stays on your machine. There is no Famalio cloud endpoint in this path.
- PostgreSQL has no network listener and no password: unix socket and peer authentication only.
- The add-on has no host ports, host network, Docker or Core API access, hardware or host folders; AppArmor is on.
- Access needs HTTPS with a publicly trusted certificate; nothing is exposed with Tailscale Funnel.
- Home Assistant gets only the scoped grant the owner approved (calendars, detail level, time range, optional editing) and can be revoked at any time in the app.
- Ingress login as a Home Assistant admin does not give a Famalio role. Every API call needs a paired device session.
- Base images are referenced by tag, not by digest; SBOM and signing are not set up yet.

---

<a id="installation-without-home-assistant-docker-compose"></a>
## Installation without Home Assistant (Docker Compose)

For a Linux server, mini PC, Raspberry Pi (64-bit OS), NAS or VPS. Home Assistant is not
needed. The installer sets up Docker, downloads Famalio Home to `/opt/famalio-home`,
creates random database passwords, starts everything and prints what to enter in the app.

### 1. Run the installer

Log in to your server (for example with `ssh`) and run:

```sh
curl -fsSL https://raw.githubusercontent.com/fisch192/famalio-home/main/install.sh | sudo bash
```

It asks two or three questions:

1. **How phones reach the server**: `tailscale` (recommended), `domain` or `local`.
   See [HTTPS options explained](#https-options-explained).
2. Depending on the choice: your **Tailscale auth key**, or your **domain name and e-mail**.
3. Whether to install a **daily backup** (recommended, default yes).

The first run takes a few minutes (Docker install and image build). At the end you see a
box like this:

```
 Famalio Home is running.
 Mode:            Tailscale (private HTTPS in your tailnet)
 Server address:  https://famalio-home.tail1234.ts.net
 Owner setup code: fhs_...
```

Keep this terminal open and continue with [Connect the Famalio app](#connect-the-famalio-app).

Prefer to read the script first? Download, read, then run it:

```sh
curl -fsSLO https://raw.githubusercontent.com/fisch192/famalio-home/main/install.sh
less install.sh
sudo bash install.sh
```

### Installer options

Everything the installer asks can also be given as options, for example for automation:

```sh
# Tailscale (key via environment variable, so it does not end up in your shell history)
curl -fsSL https://raw.githubusercontent.com/fisch192/famalio-home/main/install.sh \
  | sudo FAMALIO_TS_AUTHKEY=tskey-auth-... bash -s -- --mode tailscale --non-interactive

# Own domain with Let's Encrypt
sudo bash install.sh --mode domain --domain calendar.example.com --email you@example.com

# Behind your own reverse proxy
sudo bash install.sh --mode local --non-interactive
```

| Option | Meaning |
|---|---|
| `--dir PATH` | Install directory (default `/opt/famalio-home`) |
| `--mode tailscale\|domain\|local` | How phones reach the server over HTTPS |
| `--domain NAME`, `--email ADDRESS` | Domain and Let's Encrypt e-mail for `--mode domain` |
| `--ts-authkey KEY` | Tailscale auth key (`tskey-...`); or set `FAMALIO_TS_AUTHKEY` |
| `--ts-hostname NAME` | Tailscale device name (default `famalio-home`) |
| `--no-backup` | Do not install the daily backup |
| `--non-interactive` | Never ask; fail if a required value is missing |
| `--update` | Download the new version and rebuild; keeps data, secrets and settings |
| `--uninstall` | Remove the containers; asks before deleting any data |
| `--purge` | With `--uninstall`: also delete database, secrets and backups |
| `--ref REF` | Install a specific branch or tag (default `main`) |
| `--source PATH` | Install from a local checkout instead of downloading (development/CI) |
| `--check-only` | Only show detected OS, CPU, package manager and Docker; change nothing |

Running the installer again is safe: it keeps the installed version, the passwords and the
database, and applies new options (for example switching from `local` to `domain`).

### What gets installed where

| Path | Content |
|---|---|
| `/opt/famalio-home/app/` | The Famalio Home files (replaced on `--update`) |
| `/opt/famalio-home/app/standalone/` | The Docker Compose project; run `docker compose` commands here |
| `/opt/famalio-home/secrets/` | Random database passwords and the Tailscale key (root only, never printed) |
| `/opt/famalio-home/famalio.env` | Your installer settings (mode, domain, ...) |
| `/opt/famalio-home/backups/` | Daily database backups, 14 days kept |
| Docker volume `famalio-home_pgdata` | The PostgreSQL database |

Containers: `postgres`, `famalio-migrate` (runs once per start), `famalio-server`, and
depending on the mode `tailscale` or `caddy`. The API is published on
`127.0.0.1:8787` only; PostgreSQL is not published at all.

### Manual installation (without the script)

If you already run Docker and prefer to do it by hand:

```sh
git clone https://github.com/fisch192/famalio-home.git
cd famalio-home/standalone
./make-secrets.sh                  # three random database passwords in secrets/
docker compose up -d --build       # postgres -> migrate -> server (first build takes minutes)
docker compose logs famalio-server # shows the one-time owner setup code (30 minutes)
curl http://127.0.0.1:8787/health/live
```

Then add HTTPS: `docker compose --profile tailscale up -d` after saving an auth key as
`secrets/ts_authkey`, or `FAMALIO_DOMAIN=calendar.example.com FAMALIO_ACME_EMAIL=you@example.com
docker compose --profile domain up -d`, or your own reverse proxy to `http://127.0.0.1:8787`.

## HTTPS options explained

The app only connects to an `https://` address with a certificate that phones trust. Pick one:

**Tailscale (recommended, easiest, nothing opened to the internet).**
[Tailscale](https://tailscale.com) is a free private network between your devices. The server
joins your tailnet as a device called `famalio-home` and gets an address like
`https://famalio-home.<your-tailnet>.ts.net` with a real certificate. Only devices logged in to
your tailnet can reach it.
1. Create a free Tailscale account.
2. In the [admin console](https://login.tailscale.com/admin/dns) enable **MagicDNS** and
   **HTTPS Certificates** (DNS page).
3. Create an **auth key** ([Settings → Keys](https://login.tailscale.com/admin/settings/keys) →
   Generate auth key) and give it to the installer.
4. Install the Tailscale app on every phone that uses Famalio and log in to the same account.

No port forwarding, no Funnel, no subnet routes are used.

**Own domain (public HTTPS with Let's Encrypt).**
For a server with a public IP (VPS, or a home server with port forwarding). The installer adds
[Caddy](https://caddyserver.com), which gets and renews a free Let's Encrypt certificate.
1. Create a DNS record (A and/or AAAA) such as `calendar.example.com` pointing to the server's
   public IP.
2. Make sure TCP ports **80 and 443** reach the server from the internet (router port
   forwarding and firewall; e.g. `sudo ufw allow 80,443/tcp` or
   `sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload`).
   Port 80 is needed for the certificate check.
3. Run the installer with `--mode domain`. Your server address is `https://calendar.example.com`.

The server is then reachable from the whole internet; every request still needs a paired device.

**Local (your own reverse proxy).**
For people who already run nginx, Traefik, Caddy, a NAS reverse proxy or Cloudflare Tunnel. The
API listens on `http://127.0.0.1:8787` only. Point your proxy there and use the proxy's
`https://` address in the app. The certificate must be publicly trusted.

## Connect the Famalio app

You need the **server address** and the **owner setup code** from the installer output (on
Home Assistant: from the add-on **Log**, see step 5 above). The code works once and is valid for
30 minutes. If it expired, restart the server to get a new one (only while no owner exists):

```sh
cd /opt/famalio-home/app/standalone
sudo docker compose restart famalio-server
sudo docker compose logs famalio-server | grep -A1 "owner setup code"
```

1. On your phone open the Famalio app: **Settings → Famalio Home → Home server connection**
   (appears once your Home purchase is activated).
2. Enter the **HTTPS server address** and tap **Check connection**.
3. Expand **Set up a new Home family**, enter **Your display name**, **Family name** and the
   **Server setup code**, then tap **Create Home family**.
4. The app now shows a **recovery code exactly once**. Write it down and keep it safe.
   Without a paired device it is the only way to regain owner access.

## Pair more phones

On the owner's phone: **Settings → Famalio Home → Home server connection →
Create device pairing code** (works once) and share it. On the second phone (with
Tailscale running, if you use it) open the same screen, enter the server address, tap
**Check connection**, then under **Join an existing Home family** enter a display name and
the **Device pairing code** and tap **Request connection**. On the owner's phone approve the
device request with **Allow editing**, then tap **Check approval** on the second phone.

## Backups, restore, updates, uninstall (Linux)

All `docker compose` commands run in `/opt/famalio-home/app/standalone`.

**Backups.** If you said yes to backups, a systemd timer (or cron) runs
`/opt/famalio-home/backup.sh` every night. It writes a consistent PostgreSQL dump to
`/opt/famalio-home/backups/famalio-YYYYMMDD-HHMMSS.dump` and deletes dumps older than 14 days.
Run it by hand any time:

```sh
sudo /opt/famalio-home/backup.sh
```

Or without the script:

```sh
cd /opt/famalio-home/app/standalone
sudo docker compose exec -T -u postgres postgres pg_dump -Fc -d famalio > famalio-$(date +%F).dump
```

Copy backups to another machine regularly (the backups folder is root-only). Never copy the
Docker volume while PostgreSQL is running.

**Restore** a dump (replaces the current calendar data):

```sh
cd /opt/famalio-home/app/standalone
sudo docker compose stop famalio-server
sudo sh -c 'docker compose exec -T -u postgres postgres \
  pg_restore --clean --if-exists --single-transaction --exit-on-error -d famalio \
  < /opt/famalio-home/backups/famalio-YYYYMMDD-HHMMSS.dump'
sudo docker compose start famalio-server
```

To move to a new server: install Famalio Home there with the installer, then restore the dump
as above. The restore command is tested automatically on a freshly installed database;
restoring real family data onto another machine has not been tested yet, so try it on a spare
machine first and keep the old server until everything works.

**Updates.**

```sh
sudo bash /opt/famalio-home/install.sh --update
```

This takes a backup, downloads the newest version, rebuilds and restarts. Database changes
run automatically and are additive; your data, passwords and settings stay. A newer database
is never downgraded, so installing an older version over newer data is not a rollback;
restore a backup instead.

**Uninstall.**

```sh
sudo bash /opt/famalio-home/install.sh --uninstall           # removes containers, keeps data
sudo bash /opt/famalio-home/install.sh --uninstall --purge   # deletes everything, cannot be undone
```

With Tailscale, also remove the device in the Tailscale admin console.

## Troubleshooting (Linux)

| Problem | What to do |
|---|---|
| `unsupported CPU architecture` / `32-bit system` | Famalio Home needs a 64-bit OS (amd64 or arm64). On a Raspberry Pi install Raspberry Pi OS (64-bit). |
| Docker installation fails | Install Docker Engine and the Compose plugin by hand ([docs.docker.com](https://docs.docker.com/engine/install/)), check `docker compose version`, then re-run the installer. |
| `the API did not become healthy` | The installer prints the last log lines. Common causes: not enough RAM or disk, or a failed first build (no internet). Re-run the installer. |
| No setup code shown | An owner already exists, or the code is older than 30 minutes. Restart `famalio-server` (see [Connect the Famalio app](#connect-the-famalio-app)). If an owner exists, pair with a pairing code instead. |
| Tailscale: no server address | `sudo docker compose logs tailscale`. The auth key may be expired or already used; re-run with a new key: `sudo bash /opt/famalio-home/install.sh --mode tailscale --ts-authkey tskey-...`. Enable **HTTPS Certificates** in the admin console. |
| Domain: certificate not issued | `sudo docker compose logs caddy`. Check the DNS record (`dig +short calendar.example.com`), that ports 80 and 443 are open and forwarded, and that no other web server uses them. |
| `port 80 is already used` | Another web server runs on this host. Stop it, or use `--mode local` and add Famalio to that server as a reverse proxy. |
| App says it cannot connect | The address must start with `https://` and be reachable from the phone (is Tailscale on the phone connected?). Self-signed certificates are refused. |
| "Too many requests" while pairing | Behind a proxy all phones share one source address; wait one minute and retry. |
| Everything else | `sudo docker compose ps` and `sudo docker compose logs --tail 100`. Remove private addresses before sharing logs in an issue. |

## Security

- Your calendar data stays on your machine. There is no Famalio cloud endpoint in this path.
- Every API call needs a device that the owner paired and approved. The server setup code works
  once, for 30 minutes, and only while no owner exists.
- Linux: every container runs read-only, with all Linux capabilities dropped (Caddy keeps only
  the right to bind ports 80/443) and `no-new-privileges`. PostgreSQL runs on an internal
  network without internet access and is never published. The API is published on
  `127.0.0.1` only. Database passwords are random (256 bit), stored root-only and never printed.
- Tailscale mode uses Tailscale Serve only (no Funnel, no subnet routes, no exit node).
- Home Assistant gets only the scoped grant the owner approved and can be revoked any time.
- Base images are referenced by tag, not by digest; SBOM and signing are not set up yet.
- Found a security problem? Please do not open a public issue; contact the maintainer
  ([@fisch192](https://github.com/fisch192)) privately.

## FAQ

**Do I need Home Assistant?** No. Use the Linux installer. Home Assistant only adds the
optional calendar integration and automations.

**Does it work on a Raspberry Pi?** Yes on a Raspberry Pi 4 or 5 with a 64-bit OS
(`aarch64`). 32-bit systems are not supported. The first build takes longer.

**Can I run it on a NAS (Synology, QNAP, Unraid)?** If the NAS runs Docker with Compose v2,
use the [manual installation](#manual-installation-without-the-script); the installer script
targets regular Linux distributions.

**Which HTTPS option should I choose?** Tailscale, unless you already have a domain and a server
with a public IP (then `domain`), or you already run a reverse proxy (then `local`).

**Is my data sent anywhere?** No. The server does not contact Famalio's cloud. Tailscale and
Let's Encrypt only handle the connection and certificate.

**How do I see the logs?** `cd /opt/famalio-home/app/standalone && sudo docker compose logs -f famalio-server`.

**Where are my passwords?** In `/opt/famalio-home/secrets/` (root only). You never need them in
the app; keep them with your backups if you want to move the whole folder to another machine.

---

## Contributing and development

CI checks the YAML/JSON, runs the wizard tests (`node --test tests/wizard/*.test.mjs`) and the
standard-library integration tests, builds both images, runs `shellcheck` on the installer,
runs the installer end-to-end on Ubuntu (install, re-run, backup/restore, domain mode with a
local certificate, update, uninstall) and checks OS detection in containers of all supported
distributions. This repository is generated from the Famalio source tree; please open an issue
before larger changes.

## License

All rights reserved unless stated otherwise. No open-source license has been granted yet.
