// Draws the setup QR code and shows a pending connection code on the calendar page.
import { buildSetupLink, qrPath, visibleSetupCode, pendingConnectCode } from "./setup-helpers.js";

const $ = (id) => document.getElementById(id);
let status = null;
let view = $("settings-workspace")?.hidden === false ? "settings" : "calendar";

function drawQr(current) {
  const svg = $("qr-code"), path = $("qr-path");
  if (!svg || !path) return;
  const code = visibleSetupCode(current?.app);
  const link = code && current?.network?.verified === true ? buildSetupLink(current.network.https_url, code) : null;
  const qr = link ? qrPath(link) : null;
  if (!qr) { path.setAttribute("d", ""); $("qr-box")?.classList.add("hidden"); return; }
  svg.setAttribute("viewBox", `0 0 ${qr.size} ${qr.size}`);
  path.setAttribute("d", qr.d);
  $("qr-box")?.classList.remove("hidden");
}

function paintBanner() {
  const banner = $("pending-banner");
  if (!banner) return;
  const code = pendingConnectCode(status);
  $("pending-code").textContent = code;
  banner.hidden = !code || view === "settings";
}

window.addEventListener("famalio-setup-status", (event) => { status = event.detail; drawQr(status); paintBanner(); });
window.addEventListener("famalio-view", (event) => { view = event.detail; paintBanner(); });
