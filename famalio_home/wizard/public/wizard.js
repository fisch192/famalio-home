import { currentStep, needsRestart, integrationLoaded, restartHomeAssistant, visibleSetupCode, pendingConnectCode } from "./setup-helpers.js";

(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ui = {
    global: $("global-status"), globalText: $("global-status-text"), db: $("database-status"), network: $("network-status"),
    app: $("app-status"), appGuide: $("app-guide-note"), ha: $("ha-status"), login: $("tailscale-login"),
    haForm: $("ha-form"), haIntro: $("ha-intro"), haHint: $("ha-hint"),
    haHeading: $("step-ha-title"), requestHA: $("request-ha"), codeBox: $("ha-code-box"), code: $("ha-code"), steps3: $("ha-steps"),
    retry: $("retry-network"), actions: $("network-actions"), origin: $("app-origin"),
    copy: $("copy-origin"), token: $("integration-token"),
    tailscaleChoice: $("choose-tailscale"), proxyChoice: $("choose-proxy"),
    proxyOrigin: $("proxy-origin"), proxyCard: $("choice-proxy"), haSubmit: $("discover-ha"), refresh: $("refresh"),
    upstream: $("proxy-upstream"), upstreamRow: $("proxy-upstream-row"),
    upstreamUnavailable: $("proxy-upstream-unavailable"), copyUpstream: $("copy-upstream"),
    addonManagement: $("addon-management"), integrationManagement: $("integration-management"),
    progress: $("progress-label"), title: $("page-title"), next: $("next-action"), restartCard: $("restart-card"), restartBtn: $("restart-ha"), restartSkip: $("restart-skip"), restartStatus: $("restart-status"),
    appData: $("app-setup-data"), setupCode: $("setup-code"), copyCode: $("copy-code"), codeField: $("setup-code-field"), codeExpired: $("code-expired"), qrBox: $("qr-box"),
    sums: [$("sum-1"), $("sum-2"), $("sum-3")], techIntegration: $("tech-integration"), tailscaleHint: $("tailscale-hint"),
    steps: [document.querySelector('[aria-labelledby="step-network-title"]'), document.querySelector('[aria-labelledby="step-app-title"]'), document.querySelector('[aria-labelledby="step-ha-title"]')],
  };

  const state = { csrf: null, status: null, busy: false, checking: false, timer: null, controller: null, lastActionError: null, integration: null, fast: false, restartNeeded: false, restarting: false, restartSkipped: false, restartChecking: false, restartTimer: null };
  const endpoint = (path) => new URL(`./api/${path}`, document.baseURI).toString();
  const show = (node, visible) => node.classList.toggle("hidden", !visible);
  const setText = (node, value) => { node.textContent = typeof value === "string" ? value : ""; };

  async function request(path, { method = "GET", body, signal } = {}) {
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (method !== "GET" && state.csrf) headers["X-Famalio-CSRF"] = state.csrf;
    const response = await fetch(endpoint(path), {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin", cache: "no-store", redirect: "error", signal,
    });
    let payload = null;
    try { payload = await response.json(); } catch { /* Never surface raw response bodies. */ }
    if (!response.ok) {
      const error = new Error(typeof payload?.message === "string" ? payload.message : `Anfrage fehlgeschlagen (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function safeTailscaleURL(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "login.tailscale.com" && !url.username && !url.password;
    } catch { return false; }
  }

  function safeTailscaleEnableURL(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "login.tailscale.com" && url.pathname === "/admin/dns" && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }

  function safeHTTPSOrigin(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !!url.hostname && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
    } catch { return false; }
  }

  function safeProxyUpstream(value) {
    try {
      const url = new URL(value);
      return url.protocol === "http:" && url.port === "8787" && /^[a-z0-9]+-famalio-home$/.test(url.hostname) && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.origin : "";
    } catch { return ""; }
  }

  function safeHAManagementPath(value, expression, expectedSearch) {
    if (typeof value !== "string") return "";
    try {
      const target = new URL(value, window.location.origin);
      if (target.origin !== window.location.origin || !expression.test(target.pathname) || target.search !== expectedSearch || target.hash) return "";
      return `${target.pathname}${target.search}`;
    } catch { return ""; }
  }

  function setStepState(element, state) {
    element.dataset.state = state;
    element.setAttribute("aria-current", state === "current" ? "step" : "false");
  }

  const haFrontend = () => { try { return parent.document.querySelector("home-assistant")?.hass || null; } catch { return null; } };

  /** Is the integration on disk but not yet known to the running Home Assistant? Re-renders on change. */
  async function checkRestart() {
    if (state.restartChecking) return;
    state.restartChecking = true;
    try {
      const loaded = await integrationLoaded(haFrontend());
      const needed = !state.restartSkipped && needsRestart(state.status?.integration, loaded);
      if (loaded === true && state.restarting) { state.restarting = false; window.clearInterval(state.restartTimer); state.restartTimer = null; }
      if (needed !== state.restartNeeded) { state.restartNeeded = needed; if (state.status) render(state.status, false); }
    } finally { state.restartChecking = false; }
  }

  function describeNext(step, ctx) {
    const { network, app, pending, haDiscovered, ready, restart } = ctx;
    if (restart) return state.restarting ? "Home Assistant startet gerade neu. Das dauert ein bis zwei Minuten. Diese Seite geht danach von selbst weiter." : "Tippe auf „Home Assistant neu starten“.";
    if (step === 1) {
      if (network.phase === "login") return "Tippe auf „Bei Tailscale anmelden“ und melde dich an. Danach geht es hier von selbst weiter.";
      if (network.phase === "enabling_https") return ui.login.classList.contains("hidden") ? "Bitte einen Moment warten. Der Zugang wird vorbereitet." : "Tippe auf „HTTPS in Tailscale aktivieren“. Danach geht es hier von selbst weiter.";
      if (network.phase === "error") return "Das hat nicht geklappt. Tippe auf „Erneut prüfen“.";
      if (network.phase === "ready" && !ready) return "Bitte einen Moment warten. Der Zugang wird geprüft.";
      return "Tippe auf „Zugang einrichten“.";
    }
    if (step === 2) return app.setup_code ? "Scanne den QR-Code mit der Famalio-App. Dieser Schritt wird von selbst grün." : app.setup_code_expired ? "Der Einrichtungscode ist abgelaufen. Starte das Add-on neu (Technische Details)." : "Einen Moment, der Einrichtungscode wird geladen.";
    if (step === 3) return pending ? "Tippe in der Famalio-App auf „Verbindung erlauben“." : "Tippe auf „Mit Famalio verbinden“.";
    return "Dein Familienkalender ist jetzt in Home Assistant. Tippe oben auf „Kalender“.";
  }

  function render(status, recheck = true) {
    state.status = status;
    if (typeof status.csrf_token === "string") state.csrf = status.csrf_token;
    const db = status.database || {};
    setText(ui.db, db.ready ? `Datenbank bereit${db.instance_id ? ` · Instanz ${db.instance_id}` : ""}` : "Datenbank noch nicht bereit");
    ui.db.classList.toggle("good", db.ready === true);
    ui.db.classList.toggle("bad", db.ready === false);

    const network = status.network || {};
    ui.proxyCard.classList.toggle("hidden", status.capabilities?.reverse_proxy === false);
    const ready = network.phase === "ready" && network.verified === true && safeHTTPSOrigin(network.https_url);
    const phaseText = {
      choose: "", login: "Tailscale wartet auf deine Anmeldung. Diese Seite prüft von selbst weiter.",
      enabling_https: "Der sichere Zugang (HTTPS) wird vorbereitet …", ready: ready ? "Der Zugang funktioniert." : "Der Zugang wird geprüft …",
      error: network.message || "Der Zugang hat nicht geklappt. Tippe auf „Erneut prüfen“.",
    };
    setText(ui.network, network.message || phaseText[network.phase] || "");
    ui.network.classList.toggle("good", ready);
    ui.network.classList.toggle("bad", network.phase === "error");
    const loginAction = network.mode === "tailscale" && network.phase === "login" && safeTailscaleURL(network.auth_url);
    const enableHTTPSAction = network.mode === "tailscale" && network.phase === "enabling_https" && safeTailscaleEnableURL(network.https_enable_url);
    show(ui.login, loginAction || enableHTTPSAction);
    if (loginAction) {
      ui.login.href = network.auth_url;
      ui.login.textContent = "Bei Tailscale anmelden";
    } else if (enableHTTPSAction) {
      ui.login.href = network.https_enable_url;
      ui.login.textContent = "HTTPS in Tailscale aktivieren";
    } else ui.login.removeAttribute("href");
    show(ui.retry, network.mode === "tailscale" && (network.phase === "login" || network.phase === "error"));
    const configuring = !!network.mode && !ready;
    show(ui.tailscaleChoice, !configuring);
    show(ui.tailscaleHint, !ready);

    const origin = ready ? new URL(network.https_url).origin : "";
    setText(ui.origin, origin || "–");
    ui.copy.disabled = !origin;
    ui.copy.dataset.origin = origin;
    ui.tailscaleChoice.disabled = state.busy || !db.ready;
    ui.proxyChoice.disabled = state.busy || !db.ready;

    // Step 2: server address, one-time setup code and QR code (only while the owner does not exist yet).
    const app = status.app || {};
    const code = visibleSetupCode(app);
    const showData = ready && app.setup_required === true;
    show(ui.appData, showData);
    setText(ui.setupCode, code || "–");
    ui.copyCode.disabled = !code;
    ui.copyCode.dataset.code = code;
    show(ui.codeField, !!code);
    show(ui.qrBox, !!code);
    show(ui.codeExpired, showData && app.setup_code_expired === true);
    if (!ready) setText(ui.appGuide, "Das geht gleich weiter, sobald Schritt 1 fertig ist.");
    else if (app.setup_required === true) setText(ui.appGuide, "Verbinde jetzt die Famalio-App mit deinem Zuhause. Die einfachste Möglichkeit ist der QR-Code. Dieser Schritt wird von selbst grün, sobald die App verbunden ist.");
    else if (app.setup_required === false) setText(ui.appGuide, "Die Famalio-App ist mit deinem Zuhause verbunden. Weitere Handys verbindest du in der App mit einem Gerätecode (Einstellungen → Famalio Home → Home-Server verbinden → Gerätecode erstellen).");
    else setText(ui.appGuide, "Der Server meldet seinen Einrichtungsstatus nicht. Warte einen Moment oder öffne „Technische Details“ und aktualisiere den Status.");
    setText(ui.app, "");
    ui.app.classList.toggle("good", app.setup_required === false);

    const ha = status.home_assistant || {};
    const req = ha.request || null;
    const haDiscovered = ha.phase === "discovered" || state.integration === "confirmed";
    const pending = req && req.state === "pending";
    const appReady = ready && app.setup_required === false;
    const restart = ready && state.restartNeeded;
    show(ui.haForm, !haDiscovered);
    show(ui.codeBox, !!pending);
    if (pending) setText(ui.code, req.code || "····-····");
    ui.requestHA.disabled = state.busy || !ready || app.setup_required !== false || !!pending || haDiscovered || restart;
    setText(ui.requestHA, pending ? "Warte auf Bestätigung …" : haDiscovered ? "Verbunden ✓" : req && ["denied", "expired", "error"].includes(req.state) ? "Neue Anfrage senden" : "Mit Famalio verbinden");
    show(ui.requestHA, !pending && !haDiscovered);
    const stepState = { request: req ? "done" : "active", approve: !req ? "" : pending ? "active" : req.state === "denied" || req.state === "expired" ? "" : "done",
      confirm: state.integration === "confirmed" ? "done" : haDiscovered || state.integration === "confirming" ? "active" : "" };
    for (const li of ui.steps3.querySelectorAll("li")) { li.classList.toggle("active", stepState[li.dataset.step] === "active"); li.classList.toggle("done", stepState[li.dataset.step] === "done"); }
    show(ui.steps3, !!req || haDiscovered);
    setText(ui.haHeading, haDiscovered ? "Schritt 3: Home Assistant ist verbunden" : "Schritt 3: Home Assistant verbinden");
    const proxyUpstream = network.mode === "reverse_proxy" ? safeProxyUpstream(network.proxy_upstream) : "";
    ui.upstream.textContent = proxyUpstream || "";
    ui.copyUpstream.disabled = !proxyUpstream;
    ui.copyUpstream.dataset.upstream = proxyUpstream || "";
    show(ui.upstreamRow, !!proxyUpstream);
    show(ui.upstreamUnavailable, network.mode === "reverse_proxy" && !proxyUpstream);
    ui.ha.classList.remove("bad", "good");
    if (state.integration === "confirmed") { setText(ui.ha, "Verbunden ✓ Der Kalender öffnet sich gleich."); ui.ha.classList.add("good"); }
    else if (state.integration === "confirming") setText(ui.ha, "Die Verbindung wird in Home Assistant eingerichtet …");
    else if (state.integration === "failed") { setText(ui.ha, "Home Assistant konnte die Verbindung nicht übernehmen. Öffne „Technische Details → Integration in Home Assistant verwalten“ und bestätige sie dort."); ui.ha.classList.add("bad"); }
    else if (haDiscovered) { setText(ui.ha, "Freigabe übernommen. Die Verbindung wird eingerichtet …"); ui.ha.classList.add("good"); }
    else if (pending) setText(ui.ha, "Warte auf Bestätigung in der App …");
    else if (ha.phase === "error") { setText(ui.ha, ha.message || "Die Verbindung hat nicht geklappt. Tippe auf „Neue Anfrage senden“."); ui.ha.classList.add("bad"); }
    else if (restart) setText(ui.ha, "Bitte starte zuerst Home Assistant neu (Knopf oben).");
    else if (!ready) setText(ui.ha, "");
    else if (app.setup_required !== false) setText(ui.ha, "");
    else setText(ui.ha, "");
    const wantFast = !!pending || (haDiscovered && state.integration !== "confirmed") || (ready && app.setup_required === true) || network.phase === "login" || network.phase === "enabling_https";
    if (wantFast !== state.fast) { state.fast = wantFast; if (state.timer) window.clearInterval(state.timer); state.timer = window.setInterval(refreshStatus, wantFast ? 3000 : 15000); }
    const canDiscover = ready && ha.phase !== "discovered";
    ui.haSubmit.disabled = state.busy || !canDiscover;

    // Which step is current: exactly one obvious next action at a time.
    const cur = restart ? 2 : currentStep({ ready, appReady, haDone: haDiscovered });
    const stateOf = (n) => (restart && n >= 2 ? "upcoming" : cur === 4 || n < cur ? "complete" : n === cur ? "current" : "upcoming");
    ui.steps.forEach((el, i) => setStepState(el, stateOf(i + 1)));
    const heading = { 1: "Zugang einrichten", 2: "Famalio-App verbinden", 3: "Home Assistant verbinden", 4: "Alles verbunden ✓" };
    if (restart) { setText(ui.progress, "NOCH EIN KLICK"); setText(ui.title, "Home Assistant neu starten"); }
    else { setText(ui.progress, cur === 4 ? "FERTIG" : `SCHRITT ${cur} VON 3`); setText(ui.title, heading[cur]); }
    setText(ui.next, describeNext(cur, { network, app: { ...app, setup_code: code }, pending, haDiscovered, ready, restart }));
    show(ui.restartCard, restart);
    ui.restartBtn.disabled = state.restarting;
    setText(ui.restartBtn, state.restarting ? "Home Assistant startet neu …" : "Home Assistant neu starten");
    setText(ui.restartStatus, state.restarting ? "Bitte warten. Dieses Fenster geht von selbst weiter, sobald Home Assistant wieder bereit ist." : "");
    show(ui.restartSkip, restart && !state.restarting);
    setText(ui.sums[0], ready ? `✓ Zugang eingerichtet: ${origin}` : "");
    setText(ui.sums[1], appReady ? "✓ Die Famalio-App ist verbunden. Weitere Handys verbindest du in der App mit einem Gerätecode." : "");
    setText(ui.sums[2], haDiscovered ? "✓ Home Assistant ist verbunden. Dein Kalender ist fertig." : "");
    ui.steps.forEach((el, i) => { el.querySelector(".step-number").textContent = stateOf(i + 1) === "complete" ? "✓" : String(i + 1); });
    document.querySelectorAll("[data-nav]").forEach((a) => { a.dataset.state = stateOf(Number(a.dataset.nav)); });

    const management = status.management || {};
    const addonPath = safeHAManagementPath(management.addon_url, /^\/config\/app\/[a-z0-9_]+\/info$/, "");
    show(ui.addonManagement, !!addonPath);
    if (addonPath) ui.addonManagement.href = addonPath;
    const integrationReady = safeHAManagementPath(management.integration_url, /^\/config\/integrations\/dashboard$/, "?domain=famalio");
    if (integrationReady) ui.integrationManagement.href = integrationReady;
    show(ui.integrationManagement, !!integrationReady);
    const integ = status.integration;
    setText(ui.techIntegration, integ ? `Home-Assistant-Integration: Zustand „${integ.state}“, mitgeliefert ${integ.bundled_version || "?"}, installiert ${integ.installed_version || "?"}.` : "Home-Assistant-Integration: Status unbekannt.");

    const complete = ready && db.ready === true && appReady && haDiscovered;
    setText(ui.globalText, state.lastActionError || (state.restarting ? "Home Assistant startet neu …" : complete ? "Alles verbunden." : db.ready ? "Alles in Ordnung. Folge den Schritten unten." : "Der Famalio-Server startet noch. Bitte einen Moment warten."));
    ui.global.classList.toggle("good", complete);
    ui.global.classList.toggle("bad", !!state.lastActionError || network.phase === "error" || db.ready === false);
    window.dispatchEvent(new CustomEvent("famalio-setup-status", { detail: status }));
    if (recheck) checkRestart();
  }

  async function refreshStatus() {
    if (document.visibilityState === "hidden" || state.busy || state.controller) return;
    if (document.getElementById("settings-workspace")?.hidden && state.status && !pendingConnectCode(state.status)) return;
    const controller = new AbortController();
    state.controller = controller;
    const timeout = window.setTimeout(() => controller.abort(), 60000);
    try {
      const status = await request("status", { signal: controller.signal });
      render(status);
      maybeVerifyNetwork(status);
    } catch (error) {
      if (error.name !== "AbortError" && state.restarting) { checkRestart(); }
      else if (error.name !== "AbortError") {
        setText(ui.globalText, error.message || "Status nicht erreichbar. Bitte prüfen Sie die Verbindung.");
        ui.global.classList.add("bad");
      }
    } finally {
      window.clearTimeout(timeout);
      if (state.controller === controller) state.controller = null;
    }
  }

  async function mutate(path, body, successMessage) {
    if (state.busy) return null;
    state.busy = true;
    state.controller?.abort();
    state.controller = null;
    ui.tailscaleChoice.disabled = true; ui.proxyChoice.disabled = true;
    ui.retry.disabled = true; ui.haSubmit.disabled = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 90000);
    try {
      const result = await request(path, { method: "POST", body, signal: controller.signal });
      if (successMessage) setText(ui.globalText, successMessage);
      if (result && typeof result === "object" && (result.network || result.database || result.home_assistant || result.app)) render({ ...(state.status || {}), ...result });
      await refreshStatusForced();
      state.lastActionError = null;
      return { ok: true, payload: result };
    } catch (error) {
      state.lastActionError = error.name === "AbortError" ? "Die Anfrage hat zu lange gedauert. Prüfen Sie den Status und versuchen Sie es erneut." : error.message || "Aktion fehlgeschlagen. Bitte versuchen Sie es erneut.";
      return { ok: false };
    } finally {
      window.clearTimeout(timeout);
      state.busy = false;
      ui.retry.disabled = false; ui.haSubmit.disabled = false;
      if (state.status) render(state.status);
    }
  }

  async function refreshStatusForced() {
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    const timeout = window.setTimeout(() => controller.abort(), 60000);
    try { render(await request("status", { signal: controller.signal })); }
    catch { /* The action result remains visible; the next poll retries status. */ }
    finally {
      window.clearTimeout(timeout);
      if (state.controller === controller) state.controller = null;
    }
  }

  function maybeVerifyNetwork(status) {
    const network = status.network || {};
    if (!state.busy && !state.checking && network.phase === "ready" && network.verified !== true && (network.mode === "tailscale" || network.mode === "reverse_proxy")) {
      state.checking = true;
      mutate("check", {}, "HTTPS und Serveridentität werden geprüft.").finally(() => { state.checking = false; });
    }
  }

  async function configureNetwork(body) {
    const configured = await mutate("network", body, "Netzwerkzugriff wird eingerichtet. Die HTTPS-Verbindung wird anschließend geprüft.");
    if (!configured?.ok) return;
    const network = state.status?.network || {};
    if (body.mode === "reverse_proxy" || (network.phase === "ready" && network.verified !== true)) {
      await mutate("check", {}, "HTTPS und Serveridentität werden geprüft.");
    }
  }

  ui.tailscaleChoice.addEventListener("click", () => configureNetwork({ mode: "tailscale" }));
  ui.proxyChoice.addEventListener("click", () => {
    const value = ui.proxyOrigin.value.trim();
    if (!safeHTTPSOrigin(value)) {
      setText(ui.network, "Geben Sie eine HTTPS-Origin ohne Pfad, Zugangsdaten oder Query ein, zum Beispiel https://home.example.net.");
      ui.network.classList.add("bad");
      return;
    }
    configureNetwork({ mode: "reverse_proxy", https_url: new URL(value).origin });
  });
  ui.retry.addEventListener("click", () => mutate("tailscale/retry", {}, "Tailscale-Status wird erneut geprüft."));
  ui.refresh.addEventListener("click", refreshStatus);
  ui.copy.addEventListener("click", async () => {
    const origin = ui.copy.dataset.origin;
    if (!origin) return;
    try {
      await navigator.clipboard.writeText(origin);
      setText(ui.app, "Adresse kopiert.");
    } catch {
      setText(ui.app, "Kopieren ist hier nicht möglich. Tippe die Adresse bitte von Hand in die App ein.");
    }
  });
  ui.copyUpstream.addEventListener("click", async () => {
    const upstream = ui.copyUpstream.dataset.upstream;
    if (!upstream) return;
    try {
      await navigator.clipboard.writeText(upstream);
      setText(ui.network, "Interner API-Upstream kopiert. Veröffentlichen Sie diesen Dienst nicht direkt im LAN oder Internet.");
    } catch {
      setText(ui.network, "Kopieren nicht möglich. Verwenden Sie den angezeigten internen Upstream nur innerhalb des Home-Assistant-Netzes.");
    }
  });
  ui.restartBtn.addEventListener("click", async () => {
    const hass = haFrontend();
    if (!hass || state.restarting) return;
    state.restarting = true;
    try { await restartHomeAssistant(hass); } catch { /* The connection drops while Home Assistant stops; that is expected. */ }
    if (!state.restartTimer) state.restartTimer = window.setInterval(() => { checkRestart(); }, 3000);
    if (state.status) render(state.status, false);
  });
  ui.restartSkip.addEventListener("click", () => { state.restartSkipped = true; state.restartNeeded = false; if (state.status) render(state.status, false); });
  ui.copyCode.addEventListener("click", async () => {
    const value = ui.copyCode.dataset.code;
    if (!value) return;
    try { await navigator.clipboard.writeText(value); setText(ui.app, "Einrichtungscode kopiert."); }
    catch { setText(ui.app, "Kopieren ist hier nicht möglich. Tippe den Code bitte von Hand in die App ein."); }
  });
  ui.requestHA.addEventListener("click", () => mutate("home-assistant/request", {}, "Verbindungsanfrage gesendet. Bestätigen Sie den Code in der Famalio App."));
  window.addEventListener("famalio-integration", (event) => {
    state.integration = event.detail?.phase || null;
    if (state.status) render(state.status);
  });
  $("ha-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = ui.token.value.trim();
    if (!/^fhi_[A-Za-z0-9_-]{32,}$/.test(token)) {
      setText(ui.ha, "Der Integrationstoken hat nicht das erwartete Format. Kopieren Sie den fhi_-Token aus der ausdrücklich bestätigten App-Freigabe.");
      ui.ha.classList.add("bad");
      return;
    }
    ui.token.value = "";
    ui.haSubmit.disabled = true;
    await mutate("home-assistant", { integration_token: token }, "Home Assistant wird gebeten, die Integration zu entdecken.");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      if (state.timer) window.clearInterval(state.timer);
      state.timer = null;
      state.controller?.abort();
    } else {
      refreshStatus();
      if (!state.timer) state.timer = window.setInterval(refreshStatus, 15000);
    }
  });
  window.addEventListener("pagehide", () => { state.controller?.abort(); if (state.timer) window.clearInterval(state.timer); });
  window.addEventListener("famalio-view", (event) => { if (event.detail === "settings") refreshStatus(); });

  refreshStatus().then(() => { if (document.visibilityState === "visible" && !state.timer) state.timer = window.setInterval(refreshStatus, 15000); });
})();
