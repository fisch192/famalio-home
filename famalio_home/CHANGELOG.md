# Changelog

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
