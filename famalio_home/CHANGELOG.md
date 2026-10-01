# Changelog

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
