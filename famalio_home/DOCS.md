# Famalio Home

Famalio Home stores your family's calendar on your own Home Assistant machine.
The add-on runs PostgreSQL 16 and the Famalio API in one container, plus a
guided setup page and a calendar workspace in the Home Assistant sidebar. You
never create database users or passwords.

> **Status: experimental (0.3.0).** The amd64 build has been run on Home
> Assistant OS. The `aarch64` build, restore from backup and long-term load are
> not verified yet. Keep your Famalio cloud data; do not treat this as your only
> copy of the calendar.

Full step-by-step guide: <https://github.com/fisch192/famalio-home>

## First start

1. Start the add-on and open **Famalio** in the Home Assistant sidebar (or
   **Open Web UI**). The page is only available to Home Assistant
   administrators.
2. Open the **Log** tab. On the first start the add-on prints a one-time
   **owner setup code** (valid 30 minutes, single use). In the Famalio app open
   **Settings → Famalio Home → Home server connection**, enter the server
   address shown by the wizard and the setup code. The app then shows a
   **recovery code once**. Write it down; it restores owner access if every
   device is lost.
3. In the wizard choose how phones reach the server over HTTPS:
   - **Tailscale (recommended):** the add-on joins your tailnet as its own
     device. Open the sign-in link shown in the wizard, approve the device and,
     if asked, enable HTTPS certificates for your tailnet. Every phone needs the
     Tailscale app on the same tailnet.
   - **Existing HTTPS reverse proxy (advanced):** use a proxy you already run
     on the Home Assistant app network with a publicly trusted certificate.
     Point its upstream to the internal host name and port shown in the wizard.
     Do not publish a port on the host or router.

## Connect Home Assistant (one click)

1. Install the **Famalio Home** integration (HACS or manual copy, see the
   guide) and restart Home Assistant.
2. In the Famalio panel choose **Einrichtung → Mit Famalio verbinden**. The
   panel shows a short code.
3. In the Famalio app open **Settings → Famalio Home → Home server connection →
   Home Assistant** and approve the code. Choose the calendars, the detail level
   (full details or *Busy* only), the time range and optionally **Allow Home
   Assistant to edit**.
4. The add-on collects the approved grant once, hands it to Home Assistant
   through Supervisor discovery and the panel confirms the integration itself.
   No token is copied by hand. Manual token entry remains available under a
   disclosure for advanced cases.

Discovery alone does not count as completed setup: the panel switches to the
calendar only after Home Assistant has registered a Famalio calendar entity.
**Einrichtung** stays available in the header.

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

No Docker API, host networking, host ports, hardware access, host folders,
Home Assistant Core API or general Supervisor API. AppArmor stays on. Ingress
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
