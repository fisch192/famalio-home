import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'famalio-wizard-'));
process.env.NODE_ENV = 'test';
process.env.FAMALIO_SETUP_DIR = dir;
const codeFile = path.join(dir, 'owner-setup.json');
process.env.FAMALIO_SETUP_CODE_FILE = codeFile;
const wizard = await import(pathToFileURL(path.resolve('famalio_home/wizard/server.mjs')).href + `?test=${Date.now()}`);

test('ingress is restricted to the Supervisor proxy peer; forwarding metadata grants nothing', () => {
  assert.equal(wizard.ingress({ socket: { remoteAddress: '172.30.32.2' } }), true);
  assert.equal(wizard.ingress({ socket: { remoteAddress: '::ffff:172.30.32.2' } }), true);
  assert.equal(wizard.ingress({ socket: { remoteAddress: '172.30.32.3' } }), false);
  assert.equal(wizard.ingress({ socket: { remoteAddress: '127.0.0.1' } }), false);
  assert.equal(wizard.originOK({ method: 'POST', headers: { host: 'ha.local', origin: 'https://ha.local', 'x-forwarded-for': 'attacker' } }), true);
  assert.equal(wizard.originOK({ method: 'POST', headers: { host: 'ha.local', origin: 'https://evil.example' } }), false);
});

test('Tailscale links and public origins reject unsafe schemes, hosts and URL parts', () => {
  assert.equal(wizard.safeAuthURL('https://login.tailscale.com/a/abc'), 'https://login.tailscale.com/a/abc');
  assert.equal(wizard.safeAuthURL('https://evil.example/a/abc'), null);
  assert.equal(wizard.safeAuthURL('https://login.tailscale.com.evil.example/a/abc'), null);
  assert.equal(wizard.safeAuthURL('https://user@login.tailscale.com/a/abc'), null);
  assert.equal(wizard.validPublicOrigin('https://calendar.example.net'), true);
  assert.equal(wizard.validPublicOrigin('http://calendar.example.net'), false);
  assert.equal(wizard.validPublicOrigin('https://calendar.example.net/path'), false);
  assert.equal(wizard.validPublicOrigin('https://user:pass@calendar.example.net'), false);
  assert.equal(wizard.validPublicOrigin('https://calendar.example.net/?to=evil'), false);
});

test('network choice is atomically persisted with a fresh versioned generation and private mode', async () => {
  const saved = await wizard.configureNetwork({ mode: 'reverse_proxy', https_url: 'https://calendar.example.net' });
  const file = path.join(dir, 'config.json');
  const stat = fs.statSync(file);
  assert.deepEqual(Object.keys(saved).sort(), ['generation', 'https_url', 'mode', 'version']);
  assert.match(saved.generation, /^[0-9a-f-]{36}$/i);
  assert.equal(saved.version, 1);
  assert.equal(stat.mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), saved);
  await assert.rejects(() => wizard.configureNetwork({ mode: 'reverse_proxy', https_url: 'http://calendar.example.net' }));
  const replacement = await wizard.configureNetwork({ mode: 'tailscale' });
  assert.notEqual(replacement.generation, saved.generation);
  assert.equal(replacement.https_url, undefined);
});

test('integration credentials must use the app-issued fhi_ shape and are never persisted as setup config', () => {
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  assert.equal(state.mode, 'tailscale');
  assert.equal(JSON.stringify(state).includes('fhi_'), false);
  assert.equal(wizard.MAX_JSON, 16 * 1024);
});

test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('HTTP routes require the exact ingress peer, matching Origin and session CSRF token', async () => {
  const { PassThrough } = await import('node:stream');
  async function request({ method = 'GET', url = '/api/status', peer = '172.30.32.2', headers = {}, body = '' } = {}) {
    const req = new PassThrough(); req.method = method; req.url = url; req.headers = headers; req.socket = { remoteAddress: peer };
    const result = { headers: {}, status: 0, body: '' };
    const res = { setHeader(k, v) { result.headers[k.toLowerCase()] = v; }, writeHead(status, headers = {}) { result.status = status; Object.assign(result.headers, Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]))); }, end(data = '') { result.body += data; } };
    const done = wizard.handle(req, res);
    req.end(body);
    await done;
    result.json = result.body ? JSON.parse(result.body) : null;
    return result;
  }
  const blocked = await request({ peer: '172.30.32.3' });
  assert.equal(blocked.status, 403);
  const mismatch = await request({ headers: { host: 'ha.local', origin: 'https://evil.example' } });
  assert.equal(mismatch.status, 403);
  const status = await request({ headers: { host: 'ha.local', origin: 'https://ha.local', 'x-forwarded-for': 'spoofed' } });
  assert.equal(status.status, 200);
  assert.equal(status.headers['cache-control'], 'no-store, max-age=0');
  const cookie = status.headers['set-cookie'].split(';', 1)[0];
  const csrf = status.json.csrf_token;
  const noCsrf = await request({ method: 'POST', url: '/api/network', headers: { host: 'ha.local', origin: 'https://ha.local', cookie, 'content-type': 'application/json' }, body: '{"mode":"tailscale"}' });
  assert.equal(noCsrf.status, 403);
  const wrongCsrf = await request({ method: 'POST', url: '/api/network', headers: { host: 'ha.local', origin: 'https://ha.local', cookie, 'x-famalio-csrf': csrf + 'x', 'content-type': 'application/json' }, body: '{"mode":"tailscale"}' });
  assert.equal(wrongCsrf.status, 403);
  const accepted = await request({ method: 'POST', url: '/api/network', headers: { host: 'ha.local', origin: 'https://ha.local', cookie, 'x-famalio-csrf': csrf, 'content-type': 'application/json' }, body: '{"mode":"tailscale"}' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.network.mode, 'tailscale');
  assert.equal(fs.statSync(path.join(dir, 'config.json')).mode & 0o777, 0o600);
});

test('HTTPS verification rejects redirects and mismatched instance identity', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.redirect, 'manual');
      return new Response(JSON.stringify({ instance_id: '11111111-1111-4111-8111-111111111111' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    await assert.rejects(() => wizard.verifyURL('https://home.example.net', '22222222-2222-4222-8222-222222222222'), /different Famalio instance/);
    globalThis.fetch = async () => ({ status: 302, ok: false, headers: new Headers({ location: 'https://elsewhere.example' }) });
    await assert.rejects(() => wizard.verifyURL('https://home.example.net', '22222222-2222-4222-8222-222222222222'), /Redirect rejected/);
  } finally { globalThis.fetch = originalFetch; }
});

test('HA grant validation requires matching identity and bounded calendar metadata', () => {
  const instance = '11111111-1111-4111-8111-111111111111';
  const grant = { instance_id: instance, family_id: '22222222-2222-4222-8222-222222222222', integration_id: '33333333-3333-4333-8333-333333333333',
    recovery_epoch: 'epoch-1', projection: 'busy', max_days: 30, calendars: [{ calendar_id: 'family', name: 'Family', color: '#336699' }] };
  assert.equal(wizard.validateGrant(grant, instance), true);
  assert.equal(wizard.validateGrant(grant, '44444444-4444-4444-8444-444444444444'), false);
  assert.equal(wizard.validateGrant({ ...grant, calendars: [{ ...grant.calendars[0], calendar_id: '../other' }] }, instance), false);
  assert.equal(wizard.validateGrant({ ...grant, projection: 'owner' }, instance), false);
});

test('reverse-proxy app upstream uses the authenticated real add-on slug alias', () => {
  assert.equal(wizard.aliasFromSlug('local_famalio_home'), 'local-famalio-home');
  assert.equal(wizard.aliasFromSlug('abc123_famalio_home'), 'abc123-famalio-home');
  assert.equal(wizard.aliasFromSlug('other_addon'), null);
  assert.equal(wizard.aliasFromSlug('../famalio_home'), null);
  assert.equal(wizard.proxyUpstream('local-famalio-home'), 'http://local-famalio-home:8787');
  assert.equal(wizard.proxyUpstream('local-famalio-home.evil'), null);
});

test('management links use only the validated local app identity', () => {
  assert.deepEqual(wizard.managementURLs('local-famalio-home'), {
    integration_url: '/config/integrations/dashboard?domain=famalio',
    addon_url: '/config/app/local_famalio_home/info',
  });
  assert.equal(wizard.managementURLs('../other').addon_url, null);
  assert.equal(wizard.managementURLs(null).addon_url, null);
});

test('relay exposes only scoped HA calendar reads and event writes', () => {
  const uid = 'event-0f3c2c7e-1b7d-4f0e-9a51-2b7c1d9e8f00';
  assert.equal(wizard.relayRoute('GET', '/v1/info'), 'read');
  assert.equal(wizard.relayRoute('GET', '/v1/ha/calendars/family/events'), 'read');
  assert.equal(wizard.relayRoute('POST', '/v1/ha/calendars/family/events'), 'write');
  assert.equal(wizard.relayRoute('PATCH', `/v1/ha/calendars/family/events/${uid}`), 'write');
  assert.equal(wizard.relayRoute('DELETE', `/v1/ha/calendars/family/events/${uid}`), 'write');
  for (const [method, pathname] of [['POST', '/v1/setup/owner'], ['GET', '/v1/me'], ['POST', '/v1/ha/connection-requests'],
    ['PATCH', '/v1/ha/calendars/family/events'], ['DELETE', '/v1/ha/calendars/family/events/event-../../x'], ['PUT', '/v1/ha/calendars/family/events'],
    ['GET', '/v1/owner/ha-integrations'], ['POST', '/v1/families/x/mutations']]) {
    assert.equal(wizard.relayRoute(method, pathname), null, `${method} ${pathname}`);
  }
});

test('connection requests need a verified network before contacting the server', async () => {
  await assert.rejects(() => wizard.requestConnection(), /network|discovery/i);
  assert.equal(wizard.runtime.request, null);
});

test('owner setup code is exposed to the panel only while setup is required, verified and unexpired', () => {
  const code = 'fhs_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';
  const ready = { phase: 'ready', verified: true };
  fs.writeFileSync(codeFile, JSON.stringify({ code, expires_at: new Date(Date.now() + 3600_000).toISOString() }));
  assert.equal(wizard.readSetupCode().code, code);
  assert.deepEqual(wizard.appSetup(true, ready), { setup_required: true, setup_code: code, setup_code_expired: false });
  assert.equal(wizard.appSetup(false, ready).setup_code, null, 'hidden once an owner exists');
  assert.equal(wizard.appSetup(null, ready).setup_code, null);
  assert.equal(wizard.appSetup(true, { phase: 'ready', verified: false }).setup_code, null, 'hidden until the address is verified');
  fs.writeFileSync(codeFile, JSON.stringify({ code, expires_at: new Date(Date.now() - 1000).toISOString() }));
  assert.deepEqual(wizard.appSetup(true, ready), { setup_required: true, setup_code: null, setup_code_expired: true });
  fs.writeFileSync(codeFile, JSON.stringify({ code: 'fhi_not-a-setup-code-at-all-0000', expires_at: new Date(Date.now() + 3600_000).toISOString() }));
  assert.equal(wizard.readSetupCode(), null);
  fs.rmSync(codeFile);
  assert.equal(wizard.readSetupCode(), null);
});

test('integration install status is validated before it reaches the panel', () => {
  const file = path.join(dir, 'integration.json');
  assert.equal(wizard.readIntegrationStatus(), null);
  fs.writeFileSync(file, JSON.stringify({ state: 'installed', bundled_version: '0.4.0', installed_version: '0.4.0' }));
  assert.deepEqual(wizard.readIntegrationStatus(), { state: 'installed', bundled_version: '0.4.0', installed_version: '0.4.0' });
  fs.writeFileSync(file, JSON.stringify({ state: 'rm -rf', bundled_version: '0.4.0' }));
  assert.equal(wizard.readIntegrationStatus(), null);
  fs.rmSync(file);
});
