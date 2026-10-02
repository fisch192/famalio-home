import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.FAMALIO_SETUP_DIR || '/data/setup';
const CONFIG = path.join(DATA, 'config.json');
const TS_STATUS = path.join(DATA, 'tailscale-status.json');
const CERT = path.join(DATA, 'https.crt');
const KEY = path.join(DATA, 'https.key');
const INTEGRATION_STATUS = path.join(DATA, 'integration.json');
// Written by the API process (famalio_app) into a directory only this process's group can read.
// It is shown in this admin-only panel and never sent through the relay or the public API.
const SETUP_CODE_FILE = process.env.FAMALIO_SETUP_CODE_FILE || '/data/setup-code/owner-setup.json';
const setupCodeRe = /^fhs_[A-Za-z0-9_-]{16,128}$/;
const APP_INFO = 'http://127.0.0.1:8787/v1/info';
const MAX_JSON = 16 * 1024;
const COOKIE = 'famalio_wizard';
const sessions = new Map();
const supervisor = process.env.SUPERVISOR_TOKEN || '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tokenRe = /^fhi_[A-Za-z0-9_-]{32,512}$/;

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
/** The one-time owner setup code, or null when absent, malformed or expired. */
function readSetupCode() {
  const c = readJson(SETUP_CODE_FILE);
  if (!c || typeof c.code !== 'string' || !setupCodeRe.test(c.code)) return null;
  const expires = Date.parse(c.expires_at);
  if (!Number.isFinite(expires)) return null;
  return { code: c.code, expired: expires <= Date.now(), expires_at: new Date(expires).toISOString() };
}
/** Result of the add-on's integration auto-install (famalio-integration.sh). */
function readIntegrationStatus() {
  const s = readJson(INTEGRATION_STATUS);
  const states = ['installed', 'updated', 'current', 'newer', 'unavailable'];
  if (!s || !states.includes(s.state)) return null;
  const v = (x) => (typeof x === 'string' && x.length <= 40 ? x : null);
  return { state: s.state, bundled_version: v(s.bundled_version), installed_version: v(s.installed_version) };
}
function safeDNS(value) { return typeof value === 'string' && value.length < 254 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.ts\.net$/.test(value); }
function safeAuthURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'login.tailscale.com' && !u.username && !u.password && u.pathname.startsWith('/a/') && !u.search && !u.hash ? u.href : null; } catch { return null; }
}
function normalizedPeer(value) { return value?.startsWith('::ffff:') ? value.slice(7) : value; }
function ingress(req) { return normalizedPeer(req.socket.remoteAddress) === '172.30.32.2'; }
function validHost(value) { return typeof value === 'string' && value.length < 256 && /^[a-zA-Z0-9.:[\]-]+$/.test(value) && !value.includes('@'); }
function originOK(req) {
  const host = req.headers.host;
  if (!validHost(host)) return false; // Forwarded headers are deliberately ignored; the peer must be Supervisor ingress.
  const origin = req.headers.origin;
  if (!origin) return req.method === 'GET' || req.method === 'HEAD';
  try { const u = new URL(origin); return (u.protocol === 'http:' || u.protocol === 'https:') && u.host === host && u.username === '' && u.password === '' && u.pathname === '/' && !u.search && !u.hash; } catch { return false; }
}
function send(res, status, body, headers = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length,
    'cache-control': 'no-store, max-age=0', pragma: 'no-cache', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'", ...headers });
  res.end(bytes);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''; let size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > MAX_JSON) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } else data += chunk; });
    req.on('end', () => { if (!size) return resolve({}); try { const value = JSON.parse(data); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); resolve(value); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}
async function responseBytes(response, maxBytes = 1024 * 1024) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('Upstream response too large');
  const chunks = []; let total = 0;
  if (!response.body) return Buffer.alloc(0);
  for await (const chunk of response.body) { total += chunk.length; if (total > maxBytes) throw new Error('Upstream response too large'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks, total);
}
async function fetchJSON(url, options = {}, timeoutMs = 5000) {
  const response = await fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  if (response.status >= 300 && response.status < 400) throw new Error('Redirect rejected');
  if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
  return JSON.parse((await responseBytes(response)).toString('utf8'));
}
async function localInfo() { return fetchJSON(APP_INFO); }
function readConfig() {
  const c = readJson(CONFIG);
  if (!c || c.version !== 1 || !['tailscale', 'reverse_proxy'].includes(c.mode) || !UUID.test(c.generation)) return null;
  if (c.mode === 'reverse_proxy' && !validPublicOrigin(c.https_url)) return null;
  return c;
}
function validPublicOrigin(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password && !u.search && !u.hash && u.pathname === '/' && (!u.port || (Number(u.port) >= 1 && Number(u.port) <= 65535)); } catch { return false; }
}
function atomicJSON(file, obj, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', mode);
  try { fs.writeFileSync(fd, `${JSON.stringify(obj)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.chmodSync(temp, mode); fs.renameSync(temp, file);
  try { const dir = fs.openSync(path.dirname(file), 'r'); fs.fsyncSync(dir); fs.closeSync(dir); } catch {}
}
function statusState() {
  return { startedAt: Date.now(), verified: null, ha: { phase: 'not_configured' }, lastNetworkError: null, request: null };
}
const runtime = statusState();
function aliasFromSlug(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9]+_famalio_home$/.test(slug)) return null;
  return slug.replaceAll('_', '-');
}
function proxyUpstream(alias) { return alias && /^[a-z0-9]+-famalio-home$/.test(alias) ? `http://${alias}:8787` : null; }
function managementURLs(alias) {
  const slug = alias && /^[a-z0-9]+-famalio-home$/.test(alias) ? alias.replaceAll('-', '_') : null;
  return { integration_url: '/config/integrations/dashboard?domain=famalio',
    addon_url: slug ? `/config/app/${slug}/info` : null };
}
let addonAliasCache = { value: null, expires: 0 };
async function addonAlias() {
  if (!supervisor) return null;
  if (addonAliasCache.expires > Date.now()) return addonAliasCache.value;
  try {
    const payload = await fetchJSON('http://supervisor/addons/self/info', { headers: { authorization: `Bearer ${supervisor}` } });
    const slug = payload?.data?.slug;
    const alias = aliasFromSlug(slug);
    if (!alias) throw new Error('Unexpected add-on identity.');
    addonAliasCache = { value: alias, expires: Date.now() + 60_000 };
    return addonAliasCache.value;
  } catch { addonAliasCache = { value: null, expires: Date.now() + 10_000 }; return null; }
}
async function verifyURL(url, instanceId, token = null) {
  if (!validPublicOrigin(url)) throw new Error('Enter an HTTPS origin without a path, query, or fragment.');
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const info = await fetchJSON(new URL('/v1/info', url), { headers }, 8000);
  if (!info || info.instance_id !== instanceId) throw new Error('The HTTPS address points to a different Famalio instance.');
  return info;
}
async function invokeCert(dns) {
  if (!safeDNS(dns)) throw new Error('Tailscale DNS name is invalid.');
  const spawnOnce = (args) => new Promise((resolve, reject) => {
    const socket = process.env.TS_SOCKET || '/run/tailscale/tailscaled.sock';
    const child = spawn(process.env.TAILSCALE_BIN || 'tailscale', ['--socket', socket, ...args], { shell: false, stdio: ['ignore', 'ignore', 'ignore'],
      env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || '/home/famalio_ts' } });
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Tailscale certificate request timed out.')); }, 30000);
    timeout.unref();
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('Tailscale HTTPS certificate could not be issued.')); });
  });
  const ctmp = `${CERT}.${crypto.randomUUID()}.tmp`, ktmp = `${KEY}.${crypto.randomUUID()}.tmp`;
  try {
    await spawnOnce(['cert', '--cert-file', ctmp, '--key-file', ktmp, dns]);
    const cert = fs.readFileSync(ctmp); const key = fs.readFileSync(ktmp);
    const parsed = new crypto.X509Certificate(cert);
    if (!parsed.checkHost(dns) || Date.parse(parsed.validTo) <= Date.now() + 24 * 3600_000) throw new Error('Tailscale certificate identity or validity is invalid.');
    fs.chmodSync(ctmp, 0o600); fs.chmodSync(ktmp, 0o600); fs.renameSync(ctmp, CERT); fs.renameSync(ktmp, KEY);
    return true;
  } finally { for (const f of [ctmp, ktmp]) try { fs.unlinkSync(f); } catch {} }
}
let relayCertPromise = null;
let activeRelayContext = null;
async function ensureRelayCert(ts) {
  if (!ts || ts.backend_state !== 'Running' || !safeDNS(ts.self_dns_name)) return false;
  if (relayCertPromise) return relayCertPromise;
  relayCertPromise = (async () => {
    try {
      const cert = new crypto.X509Certificate(fs.readFileSync(CERT));
      const stat = fs.statSync(KEY);
      if (cert.checkHost(ts.self_dns_name) && Date.parse(cert.validTo) > Date.now() + 30 * 86400_000 && (stat.mode & 0o077) === 0) {
        const key = fs.readFileSync(KEY), certBytes = fs.readFileSync(CERT);
        tls.createSecureContext({ key, cert: certBytes }); // Detect mismatched files left by an interrupted pair replacement.
        return true;
      }
    } catch {}
    await invokeCert(ts.self_dns_name); return true;
  })();
  try { return await relayCertPromise; } finally { relayCertPromise = null; }
}
async function tlsCheck(hostname, port, pathName, token) {
  const alias = await addonAlias();
  if (!alias) throw new Error('Home Assistant add-on identity could not be verified.');
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: '127.0.0.1', port, path: pathName, method: 'GET', servername: hostname, checkServerIdentity: (_unused, cert) => tls.checkServerIdentity(hostname, cert),
      rejectUnauthorized: true, headers: { host: `${alias}:${port}`, ...(token ? { authorization: `Bearer ${token}` } : {}) } }, res => {
      let data = ''; res.setEncoding('utf8'); res.on('data', x => { data += x; if (data.length > 1024 * 1024) req.destroy(new Error('Response too large')); });
      res.on('end', () => { if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTPS verification returned ${res.statusCode}`)); try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid HTTPS verification response')); } });
    });
    req.setTimeout(7000, () => req.destroy(new Error('HTTPS verification timed out'))); req.on('error', reject); req.end();
  });
}
async function getStatus() {
  const config = readConfig(), ts = readJson(TS_STATUS);
  let db = { ready: false, instance_id: null }, ownerSetup = null;
  try { const info = await localInfo(); db = { ready: true, instance_id: info.instance_id || null }; ownerSetup = typeof info.owner_setup_required === 'boolean' ? info.owner_setup_required : null; } catch {}
  let network = { mode: config?.mode || null, phase: config ? 'error' : 'choose', https_url: null, verified: false };
  if (config?.mode === 'tailscale') {
    const dns = safeDNS(ts?.self_dns_name) ? ts.self_dns_name : null;
    const url = dns ? `https://${dns}` : null;
    if (ts?.backend_state === 'NeedsLogin' || ts?.backend_state === 'NeedsMachineAuth') network = { ...network, phase: 'login', auth_url: safeAuthURL(ts.auth_url), message: 'Sign in to Tailscale to continue.' };
    else if (ts?.backend_state === 'Running' && ts.serve_state !== 'active') network = { ...network, phase: 'enabling_https', https_enable_url: 'https://login.tailscale.com/admin/dns', message: 'Tailscale is connected; enable HTTPS for this tailnet, then check again.' };
    else if (ts?.backend_state === 'Running' && ts.serve_state === 'active' && ts.https_ready === true && url) {
      try {
        await ensureRelayCert(ts);
        const info = await tlsCheck(dns, 9443, '/v1/info');
        if (info.instance_id !== db.instance_id) throw new Error('The HTTPS endpoint identifies a different server.');
        network = { mode: 'tailscale', phase: 'ready', https_url: url, verified: runtime.verified === true, https_enable_url: null };
      } catch (e) { network = { ...network, phase: 'enabling_https', https_url: url, verified: false, https_enable_url: 'https://login.tailscale.com/admin/dns', message: 'Waiting for a valid HTTPS certificate and verified internal endpoint.' }; }
    } else network = { ...network, phase: ts?.serve_state === 'error' ? 'error' : 'enabling_https', message: 'Waiting for Tailscale HTTPS.' };
  } else if (config?.mode === 'reverse_proxy') {
    network = { mode: 'reverse_proxy', phase: 'ready', https_url: config.https_url, verified: runtime.verified === true,
      message: runtime.lastNetworkError || undefined };
  }
  const alias = await addonAlias();
  if (network.mode === 'reverse_proxy') network.proxy_upstream = proxyUpstream(alias);
  return { csrf_token: null, database: db, network,
    home_assistant: { ...runtime.ha, internal_url: network.mode === 'tailscale' && alias ? `https://${alias}:9443` : null,
      tls_server_name: network.mode === 'tailscale' ? (ts?.self_dns_name || null) : null, request: publicRequest() }, app: appSetup(ownerSetup, network), integration: readIntegrationStatus(), management: managementURLs(alias), capabilities: { reverse_proxy: true } };
}
function appSetup(ownerSetup, network) {
  const app = { setup_required: ownerSetup, setup_code: null, setup_code_expired: false };
  // Only while the owner does not exist yet, and only once the HTTPS address is verified.
  if (ownerSetup === true && network.phase === 'ready' && network.verified === true) {
    const c = readSetupCode();
    if (c && !c.expired) app.setup_code = c.code;
    else if (c) app.setup_code_expired = true;
  }
  return app;
}
function setSession(req, res) {
  const match = (req.headers.cookie || '').match(/(?:^|;\s*)famalio_wizard=([a-f0-9]{64})/);
  let id = match?.[1];
  if (!id || !sessions.has(id)) { id = crypto.randomBytes(32).toString('hex'); sessions.set(id, crypto.randomBytes(32).toString('hex')); res.setHeader('set-cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600`); }
  return { id, csrf: sessions.get(id) };
}
function requireCSRF(req) {
  const id = (req.headers.cookie || '').match(/(?:^|;\s*)famalio_wizard=([a-f0-9]{64})/)?.[1];
  const csrf = id && sessions.get(id);
  const supplied = req.headers['x-famalio-csrf'];
  return !!csrf && typeof supplied === 'string' && supplied.length === csrf.length && crypto.timingSafeEqual(Buffer.from(csrf), Buffer.from(supplied));
}
async function configureNetwork(body) {
  if (!['tailscale', 'reverse_proxy'].includes(body.mode)) throw Object.assign(new Error('Choose a supported network mode.'), { status: 400 });
  const config = { version: 1, mode: body.mode, generation: crypto.randomUUID() };
  if (body.mode === 'reverse_proxy') {
    if (typeof body.https_url !== 'string' || !validPublicOrigin(body.https_url)) throw Object.assign(new Error('Enter an HTTPS origin without path, query, or fragment.'), { status: 400 });
    config.https_url = new URL(body.https_url).origin;
  }
  atomicJSON(CONFIG, config); runtime.verified = false; runtime.lastNetworkError = null;
  return config;
}
async function doCheck() {
  const config = readConfig(); if (!config) throw new Error('Choose a valid network option first.');
  const local = await localInfo(); if (typeof local.instance_id !== 'string') throw new Error('Local server identity is unavailable.');
  let info;
  if (config.mode === 'tailscale') {
    const ts = readJson(TS_STATUS); if (!ts || ts.backend_state !== 'Running' || ts.serve_state !== 'active' || ts.https_ready !== true || !safeDNS(ts.self_dns_name)) throw new Error('Tailscale HTTPS is not ready.');
    await ensureRelayCert(ts); info = await tlsCheck(ts.self_dns_name, 9443, '/v1/info');
  } else info = await verifyURL(config.https_url, local.instance_id);
  if (info.instance_id !== local.instance_id) throw new Error('The HTTPS endpoint points to a different Famalio server.');
  runtime.verified = true; runtime.lastNetworkError = null;
  return { network: { mode: config.mode, phase: 'ready', https_url: config.mode === 'tailscale' ? `https://${readJson(TS_STATUS).self_dns_name}` : config.https_url, verified: true } };
}
function validateGrant(grant, instanceId) {
  if (!grant || grant.instance_id !== instanceId || !UUID.test(grant.family_id || '') || !UUID.test(grant.integration_id || '')
      || typeof grant.recovery_epoch !== 'string' || !grant.recovery_epoch || grant.recovery_epoch.length > 128
      || !['full', 'busy'].includes(grant.projection) || !Number.isInteger(grant.max_days) || grant.max_days < 1 || grant.max_days > 90
      || !Array.isArray(grant.calendars) || grant.calendars.length < 1 || grant.calendars.length > 30) return false;
  const seen = new Set();
  return grant.calendars.every(calendar => {
    if (!calendar || typeof calendar.calendar_id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(calendar.calendar_id)
        || seen.has(calendar.calendar_id) || typeof calendar.name !== 'string' || !calendar.name.trim() || calendar.name.length > 120
        || (calendar.color !== null && calendar.color !== undefined && (typeof calendar.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(calendar.color)))) return false;
    seen.add(calendar.calendar_id); return true;
  });
}
async function discoverHA(body) {
  if (typeof body.integration_token !== 'string' || !tokenRe.test(body.integration_token)) throw Object.assign(new Error('Provide an app-created fhi_ integration grant.'), { status: 400 });
  if (!supervisor) throw new Error('Home Assistant discovery is unavailable in this add-on runtime.');
  const s = await getStatus(); if (!s.database.ready || s.network.phase !== 'ready' || !runtime.verified) throw new Error('Verify the HTTPS server identity before discovery.');
  const local = await localInfo();
  const url = s.network.https_url; const cfg = readConfig();
  let grant;
  if (cfg.mode === 'tailscale') {
    const ts = readJson(TS_STATUS);
    grant = await tlsCheck(ts.self_dns_name, 9443, '/v1/ha/calendars', body.integration_token);
  } else {
    // First establish the public endpoint identity without sending the grant.
    await verifyURL(url, local.instance_id);
    grant = await fetchJSON(new URL('/v1/ha/calendars', url), { headers: { authorization: `Bearer ${body.integration_token}` } }, 8000);
  }
  if (!validateGrant(grant, local.instance_id)) throw new Error('The scoped grant returned incomplete or mismatched instance metadata.');
  const discoveryConfig = { url, api_key: body.integration_token, instance_id: local.instance_id };
  if (cfg.mode === 'tailscale') {
    const ts = readJson(TS_STATUS); if (!safeDNS(ts?.self_dns_name)) throw new Error('Tailscale HTTPS identity is unavailable.');
    const alias = await addonAlias(); if (!alias) throw new Error('Home Assistant add-on identity could not be verified.');
    discoveryConfig.internal_url = `https://${alias}:9443`;
    discoveryConfig.tls_server_name = ts.self_dns_name;
  }
  const response = await fetch('http://supervisor/discovery', { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(7000),
    headers: { authorization: `Bearer ${supervisor}`, 'content-type': 'application/json' },
    body: JSON.stringify({ service: 'famalio', config: discoveryConfig }) });
  if (response.status >= 300 && response.status < 400) throw new Error('Home Assistant discovery redirect rejected.');
  if (!response.ok) throw new Error(`Home Assistant discovery returned ${response.status}.`);
  runtime.ha = { phase: 'discovered', message: 'Home Assistant discovery request accepted.' };
  return { home_assistant: runtime.ha };
}
const APP_API = 'http://127.0.0.1:8787';
/** Starts an owner-approved connection: the owner confirms the displayed code in Famalio. */
async function requestConnection() {
  if (!supervisor) throw new Error('Home Assistant discovery is unavailable in this add-on runtime.');
  const s = await getStatus();
  if (!s.database.ready || s.network.phase !== 'ready' || !runtime.verified) throw Object.assign(new Error('Finish the network step first.'), { status: 409 });
  if (s.app.setup_required) throw Object.assign(new Error('Create your Famalio Home family in the app first.'), { status: 409 });
  const response = await fetch(`${APP_API}/v1/ha/connection-requests`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'Home Assistant' }) });
  const payload = JSON.parse((await responseBytes(response)).toString('utf8') || '{}');
  if (response.status !== 201 || typeof payload.claim_secret !== 'string' || !UUID.test(payload.request_id || '')) throw new Error(payload?.error?.message || payload?.message || 'The connection request could not be created.');
  runtime.request = { id: payload.request_id, code: payload.code, claim: payload.claim_secret, expires_at: payload.expires_at, state: 'pending' };
  runtime.ha = { phase: 'awaiting_approval', message: 'Approve this code in the Famalio app.' };
  return publicRequest();
}
function publicRequest() {
  const r = runtime.request;
  return r ? { code: r.code, state: r.state, expires_at: r.expires_at } : null;
}
let claiming = false;
/** Polls the pending request; once approved, the token goes straight into Supervisor discovery. */
async function pollConnection() {
  const r = runtime.request;
  if (!r || r.state !== 'pending' || claiming) return;
  if (Date.parse(r.expires_at) < Date.now()) { r.state = 'expired'; runtime.ha = { phase: 'error', message: 'The request expired. Start a new one.' }; return; }
  claiming = true;
  const { claim } = r;
  try {
    const response = await fetch(`${APP_API}/v1/ha/connection-requests/${r.id}/claim`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000),
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claim_secret: claim }) });
    const payload = JSON.parse((await responseBytes(response)).toString('utf8') || '{}');
    if (response.status === 202) { if (payload.state === 'expired') r.state = 'expired'; return; }
    if (response.status !== 200 || !tokenRe.test(payload.integration_token || '')) {
      r.state = payload.state === 'denied' ? 'denied' : 'error';
      runtime.ha = { phase: 'error', message: r.state === 'denied' ? 'The request was declined in the app.' : 'The approved connection could not be picked up.' };
      return;
    }
    r.state = 'approved'; r.claim = null;
    await discoverHA({ integration_token: payload.integration_token });
    runtime.request = { ...r, state: 'connected' };
  } catch (error) {
    runtime.ha = { phase: 'error', message: error.message || 'Home Assistant could not be connected.' };
  } finally { claiming = false; }
}
function staticFile(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const allowed = new Set(['index.html', 'wizard.js', 'wizard.css', 'workspace.js', 'calendar.js', 'calendar.css', 'calendar-helpers.js', 'setup-helpers.js', 'setup-panel.js', 'qrcode-vendor.js', 'i18n.js']);
  if (!allowed.has(rel)) return send(res, 404, { message: 'Not found.' });
  const file = path.join(ROOT, 'public', rel);
  try { const data = fs.readFileSync(file); const type = rel.endsWith('.js') ? 'text/javascript; charset=utf-8' : rel.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8'; res.writeHead(200, { 'content-type': type, 'content-length': data.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self'", 'referrer-policy': 'no-referrer' }); res.end(data); } catch { send(res, 404, { message: 'Not found.' }); }
}
async function handle(req, res) {
  if (!ingress(req)) return send(res, 403, { message: 'Supervisor ingress only.' });
  if (!originOK(req)) return send(res, 403, { message: 'Invalid request origin.' });
  const url = new URL(req.url, 'http://wizard.invalid');
  if (req.method === 'GET' && url.pathname === '/api/status') {
    await pollConnection();
    const session = setSession(req, res); const status = await getStatus(); status.csrf_token = session.csrf; return send(res, 200, status);
  }
  if (req.method === 'GET' && !url.pathname.startsWith('/api/')) return staticFile(req, res, url.pathname);
  if (req.method !== 'POST' || !url.pathname.startsWith('/api/')) return send(res, 404, { message: 'Not found.' });
  if (!requireCSRF(req)) return send(res, 403, { message: 'CSRF validation failed.' });
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return send(res, 415, { message: 'JSON content type required.' });
  let body; try { body = await readBody(req); } catch (e) { return send(res, e.status || 400, { message: e.message || 'Invalid request.' }); }
  try {
    if (url.pathname === '/api/network') { await configureNetwork(body); return send(res, 200, await getStatus()); }
    if (url.pathname === '/api/check') { const result = await doCheck(); return send(res, 200, { ...await getStatus(), ...result }); }
    if (url.pathname === '/api/tailscale/retry') {
      const c = readConfig(); if (!c || c.mode !== 'tailscale') throw Object.assign(new Error('Select Tailscale first.'), { status: 400 });
      atomicJSON(CONFIG, { ...c, generation: crypto.randomUUID() }); runtime.verified = false; return send(res, 200, await getStatus());
    }
    if (url.pathname === '/api/home-assistant') { const ha = await discoverHA(body); return send(res, 200, { ...await getStatus(), ...ha }); }
    if (url.pathname === '/api/home-assistant/request') { await requestConnection(); return send(res, 200, await getStatus()); }
    return send(res, 404, { message: 'Not found.' });
  } catch (e) {
    if (url.pathname === '/api/check') runtime.lastNetworkError = e.message;
    if (url.pathname === '/api/home-assistant') runtime.ha = { phase: 'error', message: e.message };
    return send(res, e.status || 502, { message: e.message || 'Setup action failed.' });
  }
}
function startRelay() {
  const initialKey = fs.readFileSync(KEY), initialCert = fs.readFileSync(CERT);
  activeRelayContext = tls.createSecureContext({ key: initialKey, cert: initialCert });
  const server = https.createServer({ key: initialKey, cert: initialCert, minVersion: 'TLSv1.2', requestCert: false,
    SNICallback: (servername, callback) => { const name = readJson(TS_STATUS)?.self_dns_name; if (!safeDNS(name) || servername !== name || !activeRelayContext) return callback(new Error('Unexpected TLS server name.')); callback(null, activeRelayContext); } }, (req, res) => {
    relayRequest(req, res).catch(() => { if (!res.headersSent) relayError(res, 502, 'Famalio API unavailable.'); else res.destroy(); });
  });
  server.listen(9443, '0.0.0.0'); return server;
}
async function relayRequest(req, res) {
    res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff');
    const ts = readJson(TS_STATUS), expectedName = ts?.self_dns_name;
    const hostname = String(req.headers.host || '').toLowerCase();
    const alias = await addonAlias();
    if (!safeDNS(expectedName) || req.socket.servername !== expectedName || !alias || hostname !== `${alias}:9443`) return relayError(res, 421, 'Misdirected request.');
    if (req.headers.origin || req.headers['access-control-request-method']) return relayError(res, 403, 'Browser requests are not accepted.');
    const parsed = new URL(req.url, 'https://relay.invalid');
    const route = relayRoute(req.method, parsed.pathname);
    if (!route) return relayError(res, 404, 'Not found.');
    if (parsed.search.length > 512 || [...parsed.searchParams.keys()].some(k => !['start', 'end', 'tz'].includes(k)) || parsed.searchParams.get('start')?.length > 40 || parsed.searchParams.get('end')?.length > 40 || parsed.searchParams.get('tz')?.length > 80) return relayError(res, 400, 'Invalid query.');
    const auth = req.headers.authorization || '';
    if (parsed.pathname !== '/v1/info' && !/^Bearer fhi_[A-Za-z0-9_-]{32,512}$/.test(auth)) return relayError(res, 401, 'Scoped integration grant required.');
    let body;
    if (route === 'write') {
      if (req.method !== 'DELETE' && !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return relayError(res, 415, 'JSON content type required.');
      try { body = req.method === 'DELETE' ? undefined : JSON.stringify(await readBody(req)); } catch (e) { return relayError(res, e.status || 400, 'Invalid request body.'); }
    }
    try {
      const target = new URL(parsed.pathname + parsed.search, 'http://127.0.0.1:8787');
      const headers = auth ? { authorization: auth } : {};
      if (body !== undefined) headers['content-type'] = 'application/json';
      const upstream = await fetch(target, { method: req.method, redirect: 'manual', signal: AbortSignal.timeout(8000), headers, body });
      if (upstream.status >= 300 && upstream.status < 400) return relayError(res, 502, 'Redirect rejected.');
      const data = await responseBytes(upstream);
      res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'application/json', 'content-length': data.length }); res.end(data);
    } catch { relayError(res, 502, 'Famalio API unavailable.'); }
}
/** Only the scoped HA calendar surface is relayed; the server enforces read/write grants. */
function relayRoute(method, pathname) {
  if (method === 'GET' && (pathname === '/v1/info' || pathname === '/v1/ha/calendars' || /^\/v1\/ha\/calendars\/[A-Za-z0-9_-]{1,80}\/events$/.test(pathname))) return 'read';
  if (method === 'POST' && /^\/v1\/ha\/calendars\/[A-Za-z0-9_-]{1,80}\/events$/.test(pathname)) return 'write';
  if ((method === 'PATCH' || method === 'DELETE') && /^\/v1\/ha\/calendars\/[A-Za-z0-9_-]{1,80}\/events\/event-[0-9a-f-]{36}$/.test(pathname)) return 'write';
  return null;
}
function relayError(res, code, message) { const body = Buffer.from(JSON.stringify({ message })); res.writeHead(code, { 'content-type': 'application/json', 'content-length': body.length, 'cache-control': 'no-store' }); res.end(body); }

if (process.env.NODE_ENV !== 'test') {
  fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
  const server = http.createServer((req, res) => { handle(req, res).catch(() => send(res, 500, { message: 'Internal setup error.' })); });
  server.listen(Number(process.env.FAMALIO_WIZARD_PORT || 8099), '0.0.0.0');
  setInterval(() => { pollConnection().catch(() => {}); }, 4000).unref();
  setInterval(() => {
    const ts = readJson(TS_STATUS);
    if (ts?.backend_state === 'Running' && ts.serve_state === 'active' && ts.https_ready === true && !globalThis.relayCertPending) {
      globalThis.relayCertPending = true;
      ensureRelayCert(ts).then(() => {
        if (!globalThis.relayServer) globalThis.relayServer = startRelay();
        else {
          const replacement = tls.createSecureContext({ key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) });
          activeRelayContext = replacement;
          globalThis.relayServer.setSecureContext({ key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) });
        }
      }).catch(() => {}).finally(() => { globalThis.relayCertPending = false; });
    }
  }, 5000).unref();
}

export { readSetupCode, readIntegrationStatus, appSetup, handle, relayRoute, requestConnection, pollConnection, runtime, configureNetwork, doCheck, getStatus, validPublicOrigin, safeAuthURL, atomicJSON, verifyURL, validateGrant, aliasFromSlug, proxyUpstream, managementURLs, ingress, originOK, requireCSRF, MAX_JSON };
