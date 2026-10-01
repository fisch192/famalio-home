// Pure helpers for the guided setup panel (no DOM access; unit-tested in test/setup-helpers.test.mjs).
import qrcode from "./qrcode-vendor.js";

const SETUP_CODE = /^fhs_[A-Za-z0-9_-]{16,128}$/;

/** True for a plain https origin (no path, credentials, query or fragment). */
export function isHttpsOrigin(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
}

/** Deep link that the Famalio app understands: famalio://home-setup?url=<https-url>&code=<setup-code>. */
export function buildSetupLink(url, code) {
  if (!isHttpsOrigin(url) || typeof code !== "string" || !SETUP_CODE.test(code)) return null;
  return `famalio://home-setup?url=${encodeURIComponent(new URL(url).origin)}&code=${encodeURIComponent(code)}`;
}

/** SVG path (1 unit per module, 4-module quiet zone) for a QR code; null if the text does not fit. */
export function qrPath(text, quiet = 4) {
  if (typeof text !== "string" || !text) return null;
  let qr;
  try { qr = qrcode(0, "M"); qr.addData(text); qr.make(); } catch { return null; }
  const count = qr.getModuleCount();
  let d = "";
  for (let row = 0; row < count; row++) {
    let col = 0;
    while (col < count) {
      if (!qr.isDark(row, col)) { col++; continue; }
      let end = col;
      while (end < count && qr.isDark(row, end)) end++;
      d += `M${col + quiet} ${row + quiet}h${end - col}v1h-${end - col}z`;
      col = end;
    }
  }
  return { size: count + quiet * 2, d };
}

/** Owner setup code is shown only while it is still required, present and plausible. */
export function visibleSetupCode(app) {
  if (!app || app.setup_required !== true) return "";
  return typeof app.setup_code === "string" && SETUP_CODE.test(app.setup_code) ? app.setup_code : "";
}

/** Files are on disk (copied by the add-on, HACS or by hand) but Home Assistant has not loaded them yet. */
export function needsRestart(integration, loaded) {
  const onDisk = ["installed", "updated", "current", "newer"].includes(integration?.state);
  return onDisk && loaded === false;
}

/** true = Home Assistant knows the integration, false = it does not (restart needed), null = cannot tell. */
export async function integrationLoaded(hass) {
  if (!hass) return null;
  if (Array.isArray(hass.config?.components) && hass.config.components.includes("famalio")) return true;
  if (typeof hass.callWS !== "function") return null;
  try {
    await hass.callWS({ type: "manifest/get", integration: "famalio" });
    return true;
  } catch (error) {
    return error?.code === "not_found" ? false : null;
  }
}

export function restartHomeAssistant(hass) {
  return hass.callService("homeassistant", "restart");
}

/** The connection-request code to show next to the calendar while it waits for approval in the app. */
export function pendingConnectCode(status) {
  const request = status?.home_assistant?.request;
  return request && request.state === "pending" && typeof request.code === "string" ? request.code : "";
}

/** Which of the three steps is the current one: 1 access, 2 app, 3 Home Assistant, 4 all done. */
export function currentStep({ ready, appReady, haDone }) {
  if (!ready) return 1;
  if (!appReady) return 2;
  return haDone ? 4 : 3;
}
