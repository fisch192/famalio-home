# Changelog

## Unreleased

- Bundled dashboard calendar card with visual editor, independent calendar selections,
  month/week/day/agenda views, and family, wall-display and school presets.
- Configure text filters, weekdays, text size, clock, colors and details on any dashboard.
  Dashboard cards use native Home Assistant calendar access and timezone-aware date ranges.

- Calendar automation rules now support editable shift/day-off title lists,
  note/location text comparisons, all-day or timed events, weekdays, start-time
  windows, title exclusions, and entity-state conditions, with a matching-event preview.
- Add a daily whole-day empty-calendar rule, distinct from named day-off events.
- Choose existing automations directly from an event, with their conditions respected
  by default. Added covers, media, fans, helpers and switch-off action shortcuts.
- Typed targets are included when saving. Switching action presets clears stale
  targets/data, and saving distinguishes stored rules from confirmed active rules.

## 0.5.6

- Reuse verified HTTPS certificate contexts while certificate files are unchanged.
  Certificate failures back off for one minute; a still-valid certificate remains
  usable during renewal failures. Cached certificates within the renewal window
  are checked for renewal at most once per hour.
- Bound Tailscale status calls so an unresponsive daemon cannot stall its controller.
- Reduced idle CPU usage in the Home Assistant add-on: setup configuration is
  validated only when the file changes, instead of starting Node every two seconds.
- Healthy Tailscale checks run once per minute and validate Serve only once per
  cycle. Login and HTTPS failures still retry every ten seconds.
- The container health probe uses curl instead of starting another Node runtime.

## 0.5.3

- **Open in the Famalio app.** On your phone, step 2 of the setup panel now has an **Open in the Famalio app**
  button. The app opens with the server address and setup code filled in, so there is nothing to scan or type.
  You still confirm with **Create Home family**.
- **Smaller text.** The setup panel uses smaller type, so more of each step fits on screen.

## 0.5.2

- **Fixed: Home Assistant never connected.** After approving the code in the Famalio app, the server's
  `/v1/ha/calendars` answer lacked `recovery_epoch`. The setup panel rejected it and silently stopped before
  telling Home Assistant, so no "Famalio" entry was ever offered. The answer now carries the full identity.
- The setup panel error now names the missing field instead of a generic message.
- The app is no longer marked experimental.

## 0.5.1

- **Readable server log.** The add-on log now shows labelled, plain lines and folds routine polling into one
  summary line per minute. `FAMALIO_LOG_FORMAT=json` keeps the raw lines.
- **English panel.** The setup panel is available in English and German, with a language toggle.
- Fixed the harmless "write EPIPE" noise in the log when the add-on restarts.
- The default rate limit for unauthenticated requests rose from 20 to 120 per minute; the panel's own polling
  could hit the old limit (429).

## 0.5.0

- **HACS now installs everything.** Adding the Famalio integration (installed from HACS) offers
  **Install the Famalio server on this Home Assistant**. It adds this repository to the app store,
  installs and starts the Famalio app, and switches on its sidebar entry. The first install builds the
  app on your Home Assistant and takes 10 to 20 minutes; the dialog shows progress. Choose
  **I already have a Famalio server** to enter an address and token as before.
- Added `translations/en.json` so the integration's setup dialogs show English text.

## 0.4.0

- **Self-setup.** The add-on bundles the Home Assistant integration and copies it into
  `/homeassistant/custom_components/famalio` on every start if it is missing or older. A copy with the
  same or a newer version (HACS, manual) is never overwritten. HACS is now optional.
  New permission (least privilege): `map: homeassistant_config` read-write, used only for this copy.
- **Restart prompt.** When the integration is installed but Home Assistant has not loaded it, the panel
  shows one button, **Home Assistant neu starten**, and continues by itself after the restart.
- **Setup code in the panel.** The one-time owner setup code is shown in the panel together with the server
  address, copy buttons and a QR code (`famalio://home-setup?url=...&code=...`) for the app's **Scan setup
  code**; no more reading the add-on log. The code stays valid for 24 hours in the add-on and is only
  handed over through a private file, never through the API or the relay.
- Redesigned guided panel: three steps with one obvious action at a time, large type, plain language;
  technical details are collapsed. The connection code is also shown on the calendar page while it waits
  for approval in the app.
- Linux installer: prints a QR code for the app when `qrencode` is installed.
- README rewritten as a step-by-step guide, including moving from an old local add-on install.

## 0.3.0

- First public release of the Famalio Home add-on repository.
- One-click connection: **Mit Famalio verbinden** in the Famalio panel requests
  a code, the owner approves it in the Famalio app, and the panel completes the
  Home Assistant integration itself. No token is copied by hand.
- Optional edit access: the owner can allow Home Assistant to create, change and
  delete single events (**Allow Home Assistant to edit** in the app).
- Calendar workspace with month, week, day and agenda views, event editor and
  an automation builder.
- Guided setup wizard (Tailscale Serve or an existing HTTPS reverse proxy),
  Supervisor discovery for the `famalio` integration, cold backups.
- Sources for the server (`server/`) and the wizard (`wizard/`) are included so
  that Supervisor can build the add-on directly from this repository.

## 0.2.0

- Guided setup wizard, TLS relay for Home Assistant calendar reads (internal).

## 0.1.0

- Development build (PostgreSQL 16, Famalio API, embedded Tailscale node).
