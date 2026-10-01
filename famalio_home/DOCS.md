# Famalio Home

Famalio Home stores your family's calendar on your own Home Assistant machine.
The add-on runs PostgreSQL 16 and the Famalio API in one container, plus a
guided setup page and a calendar workspace in the Home Assistant sidebar. You
never create database users or passwords.

> **Status: experimental (0.4.0).** The amd64 build has been run on Home
> Assistant OS. The `aarch64` build, restore from backup and long-term load are
> not verified yet. Keep your Famalio cloud data; do not treat this as your only
> copy of the calendar.

Full step-by-step guide: <https://github.com/fisch192/famalio-home>

## First start (three steps in the Famalio panel)

Open **Famalio** in the Home Assistant sidebar (or **Open Web UI**). The page is
only available to Home Assistant administrators and guides you through three
steps, one at a time:

1. **Zugang einrichten** (access). Click the button, sign in to Tailscale and,
   if asked, enable HTTPS certificates for your tailnet. The add-on joins your
   tailnet as its own device; every phone needs the Tailscale app on the same
   tailnet. Advanced: **Erweitert: eigene HTTPS-Adresse verwenden** for a
   reverse proxy you already run (publicly trusted certificate; point its
   upstream to the host name and port under *Technische Details*).
2. **Home Assistant neu starten.** The add-on copies the bundled Famalio
   integration into `custom_components/famalio` of your Home Assistant
   configuration (see Permissions). Home Assistant must restart once to load
   it; the panel shows one button and continues by itself afterwards.
3. **Famalio-App verbinden.** The panel shows the server address, the
   one-time owner setup code (valid 24 hours, single use, only while no owner
   exists) and a QR code. In the Famalio app open **Settings → Famalio Home →
   Home server connection**, tap **Scan setup code** and scan it (or enter the
   address and the code by hand), then **Create Home family**. The app shows a
   **recovery code once**. Write it down; it restores owner access if every
   device is lost.

## Connect Home Assistant (one click)

1. In the Famalio panel, step 3 **Home Assistant verbinden**, click **Mit
   Famalio verbinden**. The panel shows a short code (also shown at the top of
   the calendar page while it waits).
2. In the Famalio app open **Settings → Famalio Home → Home server connection →
   Connection requests** and approve the request with that code. Choose the
   calendars, the detail level (full details or busy times only), the time
   range and optionally **Allow Home Assistant to edit**.
3. The add-on collects the approved grant once, hands it to Home Assistant
   through Supervisor discovery and the panel confirms the integration itself.
   No token is copied by hand. Manual token entry remains available under
   **Erweitert** for advanced cases.

HACS is optional: a copy installed by HACS or by hand with the same or a newer
version is never overwritten by the add-on.

Discovery alone does not count as completed setup: the panel switches to the
calendar only after Home Assistant has registered a Famalio calendar entity.

## Calendar

Month, week, day and agenda views with a mini month, per-calendar colours and
visibility toggles. If the owner allowed editing, **Neuer Termin**, a
double-click on a day or time slot, **Bearbeiten** and **Löschen** create,
change and delete single events. Repeating and imported events can only be
changed in the Famalio app. Without edit permission the calendar is read-only.

## Automations

Select an event and choose **＋ Automation**. Scope: this occurrence, the exact
title, a title keyword (case-insensitive) or the whole calendar. Timing: event
start or end with an optional offset. Action: any Home Assistant service
(`domain.service`) with optional target entities and data (JSON or
`key: value` lines), several actions per rule; presets exist for scenes,
scripts, lights, switches, climate and notifications. Rules run through Home
Assistant's own scheduler and appear in its automation editor; events matched
by a rule show a lightning badge. Saving a rule never runs its action
immediately.

## Permissions

One host folder: Home Assistant's configuration folder (`homeassistant_config`,
read-write), used only to copy this add-on's own integration into
`custom_components/famalio` when missing or older (a newer copy is never
overwritten; nothing else in that folder is read or changed). No Docker API,
host networking, host ports, hardware access, Home Assistant Core API or general Supervisor API. AppArmor stays on. Ingress
serves only the administrator setup page and calendar workspace. Supervisor
discovery is allowed for the `famalio` service only. PostgreSQL uses a Unix
socket without TCP listener or password. The internal TLS relay used by Home
Assistant in Tailscale mode accepts only read and calendar routes with the
scoped integration credential.

## Options

| Option | Default | Meaning |
|---|---:|---|
| `unauthenticated_rate_per_minute` | 20 | Rate limit for setup and pairing endpoints. |
| `max_body_megabytes` | 8 | Maximum accepted request size. |
| `tailscale_hostname` | `famalio-home` | Device name proposed for the Tailscale node. |

`remote_access` exists only so installations upgraded from 0.1.x keep working.
New installs choose the network option in the wizard.

## Backups

All data lives under `/data` (PostgreSQL and the Tailscale identity). The add-on
uses `backup: cold`: Home Assistant stops it during the backup so the database
files are consistent. A backup on the same disk does not protect against disk
loss; keep a copy elsewhere. A cold backup has been verified, an isolated
restore has not. Test restores on a separate Home Assistant instance, never
over the running one.

## Updates

Schema changes run automatically at start and are additive. A newer database is
never downgraded: installing an older add-on version over newer data is not a
rollback; restore a backup instead. A PostgreSQL major-version change needs a
separate, documented upgrade.
