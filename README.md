# Famalio Home

**Famalio Home** is a small server that keeps your family's Famalio calendar **at home**, on a
machine you own, instead of in the Famalio cloud. You install it once; after that the Famalio
app on your family's phones syncs with it. If you use Home Assistant, your calendars also show up
there, and you can build automations ("when the school day starts, turn on the hallway light").

**What you need**

- The **Famalio app** (iPhone or Android) with the **Famalio Home** purchase. After the purchase
  the app shows **Settings → Famalio Home**.
- **A place to run the server**: a **Home Assistant OS** box (easiest), **or** any **Linux
  machine** (mini PC, Raspberry Pi 4/5 with a 64-bit system, NAS, or a rented server).
- About 20 minutes and a free [Tailscale](https://tailscale.com) account (a private, secure way
  for your phones to reach the server; the setup guides you through it).

## Choose your path

| You have… | Take this path | Time |
|---|---|---|
| Home Assistant OS (Raspberry Pi, mini PC, Home Assistant Green/Yellow, a VM) | [Installation on Home Assistant](#installation-on-home-assistant) | about 15 minutes |
| A Linux machine, no Home Assistant | [Installation without Home Assistant](#installation-without-home-assistant-docker-compose) (one command) | about 15 minutes |
| An older test install (local add-on 0.2.0) | [Moving from an older install](#moving-from-an-older-local-add-on-install) | about 10 minutes |

Deutsche Anleitung: [docs/INSTALL.de.md](docs/INSTALL.de.md)

> **Status: experimental, version 0.4.0.** Verified so far: the amd64 Home Assistant add-on builds
> and runs on Home Assistant OS (database, migrations, owner setup, pairing, calendar
> create/read/update/delete, scoped HA reads, restart persistence, cold backup). The Linux
> installer is tested automatically on every change. **Not yet verified on real hardware:** the
> new one-click integration install and the Home Assistant restart button of version 0.4.0, the
> `aarch64` build, restoring a Home Assistant backup, a real Tailscale login with the installer.
> Report problems in the [issue tracker](https://github.com/fisch192/famalio-home/issues). Keep
> using Famalio's normal sync as well; do not make this your only copy.

## Contents

- [How it fits together](#how-it-fits-together)
- [Installation on Home Assistant](#installation-on-home-assistant)
- [Moving from an older local add-on install](#moving-from-an-older-local-add-on-install)
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
  app: chosen calendars, a detail level and a time range.

| Folder / file | What it is |
|---|---|
| `famalio_home/` | Home Assistant **add-on**: the Famalio server, setup panel and calendar workspace. It also contains the Home Assistant integration and installs it for you. |
| `custom_components/famalio/` | The same integration for people who prefer [HACS](https://hacs.xyz) (optional, see below) |
| `install.sh` | **One-command installer** for Linux servers without Home Assistant |
| `standalone/` | The same server as **Docker Compose** project (used by `install.sh`) |

---

## Installation on Home Assistant

The add-on does the hard parts itself: it sets up the database, installs the Home Assistant
integration, and guides you through three steps in its own page, the **Famalio panel**. The panel
is shown in German. In newest Home Assistant versions add-ons are called *Apps*; the steps are the same.

You need: Home Assistant OS or Supervised with the add-on store (CPU `amd64` tested, `aarch64`
untested), about 1 GB free RAM, a few GB disk, and internet access (the add-on is built on your
Home Assistant the first time, which takes several minutes).

### Step 1. Add the repository

Click this button (it opens your Home Assistant):

[![Add repository to my Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Ffisch192%2Ffamalio-home)

Confirm with **Add**. Or do it by hand: **Settings → Add-ons → Add-on Store**, top right
**⋮ → Repositories**, paste `https://github.com/fisch192/famalio-home`, click **Add**, then **Close**.

*You should now see* a new section **Famalio Home** at the bottom of the add-on store (reload the
page if it is missing) with the add-on **Famalio**.

### Step 2. Install and start

1. Open **Famalio** and click **Install**. Wait until the build finishes (several minutes).
2. Switch on **Start on boot** and **Show in sidebar**, then click **Start**.

*You should now see* the add-on running (green **Stop** button) and **Famalio** in the left sidebar.

### Step 3. Open the Famalio panel and set up access

1. Click **Famalio** in the sidebar. The page shows **Schritt 1 von 3 – Zugang einrichten**.
2. Click the big button **Zugang einrichten**. A button **Bei Tailscale anmelden** appears.
3. Click it, log in to Tailscale (create a free account if you do not have one) and approve the
   new device. Come back to the Famalio page.
4. If the panel shows **HTTPS in Tailscale aktivieren**, click it. In the Tailscale admin page
   switch on **HTTPS Certificates** (DNS page), then come back.

*You should now see* a green box **Schritt 1: Zugang einrichten** with an address like
`https://famalio-home.<your-tailnet>.ts.net`. That is your **server address**; the panel continues by
itself. No router ports are opened.

Own domain or reverse proxy instead of Tailscale? Open **Erweitert: eigene HTTPS-Adresse verwenden**
in step 1 and see [HTTPS options explained](#https-options-explained).

### Step 4. Restart Home Assistant when asked

The add-on has copied the Famalio integration into Home Assistant's configuration folder (you do not
need HACS). Home Assistant has to restart once to load it. The panel shows **Home Assistant muss
einmal neu starten** with one button.

1. Click **Home Assistant neu starten**.
2. Wait one to two minutes. Do not close the page.

*You should now see* the panel come back by itself and continue with **Schritt 2 von 3 – Famalio-App
verbinden**. (If you already restarted Home Assistant by hand, click **Ich habe Home Assistant schon
neu gestartet**.)

### Step 5. Connect the Famalio app (scan the QR code)

Schritt 2 shows your **server address**, the one-time **Einrichtungscode** (setup code) with
**Kopieren** buttons, and a **QR code**. The code works once and stays valid for 24 hours; you do
not need the add-on log. On your phone, with Tailscale running on the phone:

1. Open the Famalio app and tap **Settings → Famalio Home → Home server connection**.
2. Tap **Scan setup code** and point the camera at the QR code in the Famalio panel. (Without
   scanning: enter the server address, tap **Check connection**, and type the code.)
3. Expand **Set up a new Home family**, enter **Your display name** and **Family name**, and tap
   **Create Home family**.
4. The app shows a **recovery code exactly once**. Write it down and keep it safe. Without a paired
   device it is the only way to regain owner access.

*You should now see* the app showing your new Home family, and in the Famalio panel the box
**Schritt 2: Famalio-App verbinden** turns green by itself (the code disappears).

### Step 6. Connect Home Assistant to Famalio

Schritt 3 shows the button **Mit Famalio verbinden**.

1. Click **Mit Famalio verbinden**. A big code like `ABCD-EFGH` appears.
2. In the app open **Settings → Famalio Home → Home server connection → Connection requests** and
   open the request that shows exactly that code.
3. Choose which calendars Home Assistant may see and whether it sees full details or busy times
   only. Optional: **Allow Home Assistant to edit** lets Home Assistant create, change and delete
   single events (needs full details).
4. Tap **Approve connection**.

*You should now see* the panel say **Verbunden ✓** and open the calendar. Your calendars also appear
in **Settings → Devices & services → Famalio Home**. While a request waits for approval, the code is
also shown at the top of the calendar page. No token has to be copied; the manual token option under
**Erweitert** in step 3 is only a fallback.

### Pair more phones

On the owner's phone: **Settings → Famalio Home → Home server connection → Create device pairing
code** (works once) and share it. On the second phone (Tailscale running) open the same screen,
enter the server address, tap **Check connection**, then under **Join an existing Home family** enter
a display name and the **Device pairing code** and tap **Request connection**. On the owner's phone
approve the device request with **Allow editing**, then tap **Check approval** on the second phone.

*You should now see* the same calendar on both phones.

### Everyday use

**Calendar.** The Famalio panel shows month, week, day and agenda views. With edit access you can
create events (**Neuer Termin** or double-click a slot), change (**Bearbeiten**) or delete
(**Löschen**) them. Repeating and imported events stay editable only in the app.

**Automations.** Select an event → **＋ Automation**. Pick the scope (this occurrence, exact title,
title contains a word, whole calendar), timing (start or end, with offset) and one or more Home
Assistant actions (scenes, scripts, lights, notify, ...). Rules run in Home Assistant's scheduler and
are listed in its automation editor. Saving never runs the action immediately.

### Backups and restore

The add-on uses cold backups: Home Assistant stops it briefly during a backup so the database is
consistent. Include **Famalio** in your Home Assistant backups and keep a copy off the machine.
Backing up works; restoring is **not yet verified**, so test a restore on a spare Home Assistant,
never over the running one.

### Updates

Update from the add-on page (**Update**; a new build runs). The add-on also updates its bundled
integration on the next start; restart Home Assistant when the panel asks. Database changes run
automatically and are additive; a newer database is never downgraded, so installing an older add-on
over newer data is not a rollback. A newer integration copy that you installed yourself (for example
through HACS) is never overwritten.

### Uninstall

Revoke the grant in the app (**Home Assistant** screen), remove the integration (**Settings →
Devices & services → Famalio Home → Delete**), then uninstall the add-on. Uninstalling the add-on
deletes its data including the database. Remove the device in the Tailscale admin console. The
folder `custom_components/famalio` in Home Assistant's configuration stays; delete it if you want it
gone.

### About HACS

HACS is **optional and not needed** any more. The add-on installs and updates the integration itself.
If you installed the integration through HACS earlier, do not rely on it: remove it in HACS (keep the
integration entry in Home Assistant) and let the add-on manage the files. Advanced users can still
install `custom_components/famalio` from this repository with HACS
([open in HACS](https://my.home-assistant.io/redirect/hacs_repository/?owner=fisch192&repository=famalio-home&category=integration)); the add-on never replaces a copy with the same or a higher version.

### Moving from an older local add-on install

If you tested an earlier version as a *local* add-on (`local_famalio_home`, version 0.2.0), switch to
the repository version like this. **A fresh install starts with an empty database**; family data of
the old install is not carried over, which is fine for a test install. Do not run both add-ons at once.

1. In the Famalio app: **Settings → Famalio Home → Home server connection → Disconnect**.
2. In Home Assistant remove the old integration entry: **Settings → Devices & services → Famalio Home
   → ⋮ → Delete**.
3. **Settings → Add-ons → Famalio (local) → Uninstall**. Also delete the folder `addons/famalio_home` if
   you created it for the local add-on.
4. In the Tailscale admin console remove the old `famalio-home` device (so the new one gets the same name).
5. Follow [Installation on Home Assistant](#installation-on-home-assistant) from Step 1. Set up a new
   Home family in the app (Step 5) and connect Home Assistant (Step 6).

If the integration was installed with HACS, see [About HACS](#about-hacs).

### Troubleshooting (Home Assistant)

| Problem | What to do |
|---|---|
| Add-on not shown in the store | Repositories dialog: check the URL, then reload the page or **⋮ → Check for updates**. |
| Installation fails during build | Home Assistant needs internet (Debian, Docker Hub, PostgreSQL apt repository, npm). Check the add-on **Log** and disk space, then retry. |
| Sidebar entry missing | Add-on page → enable **Show in sidebar**. The page is visible to Home Assistant administrators only. |
| Panel says the restart is needed but nothing happens | Click **Home Assistant neu starten** once and wait two minutes. If you already restarted, click **Ich habe Home Assistant schon neu gestartet**. Check the add-on **Log** for a line "Home Assistant integration installed". |
| No QR code or setup code in step 2 | The code is shown only while no owner exists and for 24 hours. If it says it expired, restart the add-on (add-on page → **Restart**). If an owner exists, pair with a pairing code instead. |
| Tailscale link expired or no green address | Reload the panel and click **Erneut prüfen**. Make sure **HTTPS Certificates** are enabled for the tailnet. |
| App cannot connect | The address must be `https://…` and reachable from the phone: is Tailscale running on the phone? Plain HTTP and self-signed certificates are refused. |
| "Mit Famalio verbinden" waits forever | Approve the code in the app within its lifetime. Make sure Home Assistant was restarted after step 4. Open **Settings → Devices & services** and confirm a discovered Famalio entry if shown. |
| Calendar stays on the setup page | The panel waits until Home Assistant has registered a Famalio calendar entity (checked every 15 s). |
| No edit buttons | Edit access must be allowed in the app and the grant must use full details (not busy times). Repeating events are app-only. |
| Integration asks to re-authenticate | The grant was revoked or expired; create a new one with **Mit Famalio verbinden**. |
| Rate limit / "too many requests" while pairing | Wait one minute and retry. |
| Update seems to roll back data | Never install an older add-on over newer data; restore a backup. |

### Security and privacy (Home Assistant add-on)

- Your calendar data stays on your machine. There is no Famalio cloud endpoint in this path.
- PostgreSQL has no network listener and no password: unix socket and peer authentication only.
- The add-on has no host ports, host network, Docker or Core API access or hardware access; AppArmor is on.
- **One folder mapping, on purpose:** the add-on may write to Home Assistant's configuration folder
  (`map: homeassistant_config`, read-write). It uses this only to copy its own integration into
  `custom_components/famalio` when missing or older, and never overwrites a newer copy. Nothing else
  in that folder is read, listed or changed. This is the price of not needing HACS or a manual copy.
- The one-time owner setup code is handed from the server to the panel through a private file; it is
  shown only to signed-in Home Assistant administrators and never sent through the API or relay.
- Access needs HTTPS with a publicly trusted certificate; nothing is exposed with Tailscale Funnel.
- Home Assistant gets only the scoped grant the owner approved and can be revoked at any time in the app.
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
 (QR code, if qrencode is installed)
```

If the tool `qrencode` is installed on the server (`sudo apt install qrencode`, or the
equivalent for your distribution), the box also contains a **QR code** that the app can scan.
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

You need the **server address** and the **owner setup code** from the installer output. The
code works once and is valid for 30 minutes. If it expired, restart the server to get a new one (only while no owner exists):

```sh
cd /opt/famalio-home/app/standalone
sudo docker compose restart famalio-server
sudo docker compose logs famalio-server | grep -A1 "owner setup code"
```

(The Linux installer prints the code in the terminal and the logs. The Home Assistant add-on
shows it in its panel instead.)

1. On your phone open the Famalio app: **Settings → Famalio Home → Home server connection**
   (appears once your Home purchase is activated).
2. If the installer showed a QR code, tap **Scan setup code** and point the camera at it. The
   address and the code are filled in for you. Otherwise enter the **HTTPS server address** by
   hand and tap **Check connection**.
3. Expand **Set up a new Home family**, enter **Your display name**, **Family name** and (if you
   did not scan) the **Server setup code**, then tap **Create Home family**.
4. The app now shows a **recovery code exactly once**. Write it down and keep it safe.
   Without a paired device it is the only way to regain owner access.

You should now see the Home family screen in the app, and **Settings → Famalio Home** says that
this device is connected to your Home server.

## Pair more phones

On the owner's phone: **Settings → Famalio Home → Home server connection →
Create device pairing code** (works once) and share it. On the second phone (with
Tailscale running, if you use it) open the same screen, enter the server address, tap
**Check connection**, then under **Join an existing Home family** enter a display name and
the **Device pairing code** and tap **Request connection**. On the owner's phone approve the
device request with **Allow editing**, then tap **Check approval** on the second phone.

You should now see the same calendar on both phones. Pairing codes work once; create a new
one for every phone.

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
- The Home Assistant add-on is the one piece with a host mapping: it may write to Home Assistant's
  configuration folder, only to copy its own integration into `custom_components/famalio`.
- Found a security problem? Please do not open a public issue; contact the maintainer
  ([@fisch192](https://github.com/fisch192)) privately.

## FAQ

**What does it cost?** The server software is free. You need the Famalio app and the
**Famalio Home** purchase inside it. Tailscale's free plan is enough for a family; a domain
(only for the `domain` mode) and the hardware are your own costs.

**Does it work offline?** Phones keep their calendar on the device and sync when they reach the
server again. Away from home they need the HTTPS connection (for example Tailscale on the phone).

**What if the Famalio cloud disappears?** Your Home server does not use it. Calendar data lives
in your own database and in the apps on your phones. Keep backups of the server (see above); the
Famalio app itself must still be installed on the phones.

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
