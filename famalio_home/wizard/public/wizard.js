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
    steps: [document.querySelector('[aria-labelledby="step-network-title"]'), document.querySelector('[aria-labelledby="step-app-title"]'), document.querySelector('[aria-labelledby="step-ha-title"]')],
  };

  const state = { csrf: null, status: null, busy: false, checking: false, timer: null, controller: null, lastActionError: null, integration: null, fast: false };
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

  function render(status) {
    state.status = status;
    if (typeof status.csrf_token === "string") state.csrf = status.csrf_token;
    const db = status.database || {};
    setText(ui.db, db.ready ? `Datenbank bereit${db.instance_id ? ` · Instanz ${db.instance_id}` : ""}` : "Datenbank noch nicht bereit");
    ui.db.classList.toggle("good", db.ready === true);
    ui.db.classList.toggle("bad", db.ready === false);

    const network = status.network || {};
    show(ui.proxyCard, status.capabilities?.reverse_proxy !== false);
    const ready = network.phase === "ready" && network.verified === true && safeHTTPSOrigin(network.https_url);
    const phaseText = {
      choose: "Wählen Sie einen Zugriffsweg.", login: "Tailscale wartet auf Ihre Anmeldung. Diese Seite prüft den Status automatisch.",
      enabling_https: "HTTPS wird vorbereitet oder geprüft …", ready: ready ? "HTTPS und Serveridentität wurden bestätigt." : "Server noch nicht verifiziert. Bitte erneut prüfen.",
      error: network.message || "Netzwerkverbindung fehlgeschlagen. Prüfen Sie die Angaben und versuchen Sie es erneut.",
    };
    setText(ui.network, network.message || phaseText[network.phase] || "Netzwerkstatus wird geprüft …");
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
    show(ui.actions, !ui.login.classList.contains("hidden") || !ui.retry.classList.contains("hidden"));

    const origin = ready ? new URL(network.https_url).origin : "";
    setText(ui.origin, origin || "Wird nach der Netzwerkprüfung angezeigt");
    ui.copy.disabled = !origin;
    ui.copy.dataset.origin = origin;
    ui.tailscaleChoice.disabled = state.busy || !db.ready;
    ui.proxyChoice.disabled = state.busy || !db.ready;

    const app = status.app || {};
    if (app.setup_required === true) {
      setText(ui.app, ready ? "Server erreichbar. Owner-Setup und Geräte-Paarung in Famalio bestätigen." : "Nach bestätigter Netzwerkverbindung Owner-Setup und Geräte-Paarung in Famalio bestätigen.");
      setText(ui.appGuide, "Den einmaligen Einrichtungscode finden Sie im Protokoll dieses Add-ons. Geben Sie ihn in Famalio ein.");
    } else if (app.setup_required === false) {
      setText(ui.app, "Home-Server ist eingerichtet.");
      setText(ui.appGuide, "Weitere Geräte verbinden Sie mit einem Geräte-Paarungscode aus Famalio.");
    } else {
      setText(ui.app, "Der Server meldet seinen Einrichtungsstatus nicht.");
      setText(ui.appGuide, "Prüfen Sie Owner-Setup und Geräte-Paarung in Famalio.");
    }
    ui.app.classList.toggle("good", app.setup_required === false);

    const ha = status.home_assistant || {};
    const req = ha.request || null;
    const haDiscovered = ha.phase === "discovered" || state.integration === "confirmed";
    const pending = req && req.state === "pending";
    show(ui.haForm, !haDiscovered);
    show(ui.codeBox, !!pending);
    if (pending) setText(ui.code, req.code || "····-····");
    ui.requestHA.disabled = state.busy || !ready || app.setup_required !== false || !!pending || haDiscovered;
    setText(ui.requestHA, pending ? "Warte auf Bestätigung …" : haDiscovered ? "Verbunden" : req && ["denied", "expired", "error"].includes(req.state) ? "Neue Anfrage senden" : "Mit Famalio verbinden");
    const stepState = { request: req ? "done" : "active", approve: !req ? "" : pending ? "active" : req.state === "denied" || req.state === "expired" ? "" : "done",
      confirm: state.integration === "confirmed" ? "done" : haDiscovered || state.integration === "confirming" ? "active" : "" };
    for (const li of ui.steps3.querySelectorAll("li")) { li.classList.toggle("active", stepState[li.dataset.step] === "active"); li.classList.toggle("done", stepState[li.dataset.step] === "done"); }
    setText(ui.haHeading, haDiscovered ? "Home Assistant ist verbunden" : "Home Assistant verbinden");
    const proxyUpstream = network.mode === "reverse_proxy" ? safeProxyUpstream(network.proxy_upstream) : "";
    ui.upstream.textContent = proxyUpstream || "";
    ui.copyUpstream.disabled = !proxyUpstream;
    ui.copyUpstream.dataset.upstream = proxyUpstream || "";
    show(ui.upstreamRow, !!proxyUpstream);
    show(ui.upstreamUnavailable, network.mode === "reverse_proxy" && !proxyUpstream);
    ui.ha.classList.remove("bad", "good");
    if (state.integration === "confirmed") { setText(ui.ha, "Fertig. Der Kalender öffnet sich gleich."); ui.ha.classList.add("good"); }
    else if (state.integration === "confirming") setText(ui.ha, "Integration wird in Home Assistant eingerichtet …");
    else if (state.integration === "failed") { setText(ui.ha, "Home Assistant konnte die Integration nicht übernehmen. Öffnen Sie die Integration in Home Assistant und bestätigen Sie sie dort."); ui.ha.classList.add("bad"); }
    else if (haDiscovered) { setText(ui.ha, "Freigabe übernommen. Die Integration wird eingerichtet …"); ui.ha.classList.add("good"); }
    else if (pending) setText(ui.ha, "Bestätigen Sie den Code in der Famalio App. Diese Seite wartet automatisch.");
    else if (ha.phase === "error") { setText(ui.ha, ha.message || "Die Verbindung ist fehlgeschlagen. Bitte erneut versuchen."); ui.ha.classList.add("bad"); }
    else if (!ready) setText(ui.ha, "Schließen Sie zuerst Schritt 1 ab.");
    else if (app.setup_required !== false) setText(ui.ha, "Richten Sie zuerst Famalio Home in der App ein (Schritt 2).");
    else setText(ui.ha, "");
    window.dispatchEvent(new CustomEvent("famalio-setup-status", { detail: status }));
    const wantFast = !!pending || (haDiscovered && state.integration !== "confirmed");
    if (wantFast !== state.fast) { state.fast = wantFast; if (state.timer) window.clearInterval(state.timer); state.timer = window.setInterval(refreshStatus, wantFast ? 3000 : 15000); }
    const canDiscover = ready && ha.phase !== "discovered";
    ui.haSubmit.disabled = state.busy || !canDiscover;

    const appReady = ready && app.setup_required === false;
    setStepState(ui.steps[0], ready ? "complete" : "current");
    setStepState(ui.steps[1], appReady ? "complete" : (ready ? "current" : "upcoming"));
    setStepState(ui.steps[2], ready && appReady ? "current" : "upcoming");

    const management = status.management || {};
    const addonPath = safeHAManagementPath(management.addon_url, /^\/config\/app\/[a-z0-9_]+\/info$/, "");
    show(ui.addonManagement, !!addonPath);
    if (addonPath) ui.addonManagement.href = addonPath;
    const integrationReady = safeHAManagementPath(management.integration_url, /^\/config\/integrations\/dashboard$/, "?domain=famalio");
    if (integrationReady) ui.integrationManagement.href = integrationReady;
    show(ui.integrationManagement, !!integrationReady);

    const complete = ready && db.ready === true && app.setup_required === false && haDiscovered;
    setText(ui.globalText, state.lastActionError || (complete ? "Alles verbunden." : db.ready ? "Lokaler Serverstatus wird überwacht." : "Warte auf die lokale Datenbank …"));
    ui.global.classList.toggle("good", complete);
    ui.global.classList.toggle("bad", !!state.lastActionError || network.phase === "error" || db.ready === false);
  }

  async function refreshStatus() {
    if (document.visibilityState === "hidden" || state.busy || state.controller) return;
    if (document.getElementById("settings-workspace")?.hidden && state.status) return;
    const controller = new AbortController();
    state.controller = controller;
    const timeout = window.setTimeout(() => controller.abort(), 60000);
    try {
      const status = await request("status", { signal: controller.signal });
      render(status);
      maybeVerifyNetwork(status);
    } catch (error) {
      if (error.name !== "AbortError") {
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
      setText(ui.app, "HTTPS-Adresse in die Zwischenablage kopiert. Öffnen Sie nun die Home-Einrichtung in der Famalio-App.");
    } catch {
      setText(ui.app, "Kopieren nicht möglich. Sie können die angezeigte HTTPS-Adresse manuell in der Famalio-App eingeben.");
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
