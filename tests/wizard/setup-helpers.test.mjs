import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSetupLink, qrPath, visibleSetupCode, needsRestart, integrationLoaded, pendingConnectCode, currentStep, isHttpsOrigin, restartHomeAssistant } from '../../famalio_home/wizard/public/setup-helpers.js';

const CODE = 'fhs_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';

test('setup link is URL-encoded and only built from a valid HTTPS origin and setup code', () => {
  const link = buildSetupLink('https://famalio-home.tail1234.ts.net', CODE);
  assert.equal(link, `famalio://home-setup?url=${encodeURIComponent('https://famalio-home.tail1234.ts.net')}&code=${CODE}`);
  const parsed = new URL(link);
  assert.equal(parsed.searchParams.get('url'), 'https://famalio-home.tail1234.ts.net');
  assert.equal(parsed.searchParams.get('code'), CODE);
  assert.equal(buildSetupLink('http://insecure.example', CODE), null);
  assert.equal(buildSetupLink('https://x.ts.net/path', CODE), null);
  assert.equal(buildSetupLink('https://x.ts.net', 'wrong-prefix-wrong-prefix'), null);
  assert.equal(buildSetupLink('https://user:pw@x.ts.net', CODE), null);
  assert.equal(isHttpsOrigin('https://x.ts.net:8443'), true);
});

test('QR path is a square module grid with a quiet zone and fits a setup link', () => {
  const qr = qrPath(buildSetupLink('https://famalio-home.tail1234.ts.net', CODE));
  assert.ok(qr);
  assert.ok(qr.size >= 41 && qr.size <= 81, `size ${qr.size}`);
  assert.match(qr.d, /^M\d+ \d+h\d+v1h-\d+z/);
  assert.equal(qrPath(''), null);
  assert.equal(qrPath('x'.repeat(5000)), null);
  // Finder pattern: top-left module of the code sits right after the 4-module quiet zone.
  assert.ok(qr.d.startsWith('M4 4h7v1h-7z'));
});

test('setup code is only visible while owner setup is required', () => {
  assert.equal(visibleSetupCode({ setup_required: true, setup_code: CODE }), CODE);
  assert.equal(visibleSetupCode({ setup_required: false, setup_code: CODE }), '');
  assert.equal(visibleSetupCode({ setup_required: null, setup_code: CODE }), '');
  assert.equal(visibleSetupCode({ setup_required: true, setup_code: 'not-a-code' }), '');
  assert.equal(visibleSetupCode({ setup_required: true }), '');
  assert.equal(visibleSetupCode(null), '');
});

test('restart is offered only when files exist on disk and Home Assistant has not loaded the integration', () => {
  assert.equal(needsRestart({ state: 'installed' }, false), true);
  assert.equal(needsRestart({ state: 'updated' }, false), true);
  assert.equal(needsRestart({ state: 'current' }, false), true);
  assert.equal(needsRestart({ state: 'installed' }, true), false);
  assert.equal(needsRestart({ state: 'installed' }, null), false);
  assert.equal(needsRestart({ state: 'unavailable' }, false), false);
  assert.equal(needsRestart(null, false), false);
});

test('integrationLoaded uses the components list, then manifest/get', async () => {
  assert.equal(await integrationLoaded(null), null);
  assert.equal(await integrationLoaded({ config: { components: ['light', 'famalio'] } }), true);
  assert.equal(await integrationLoaded({ config: { components: [] }, callWS: async (m) => { assert.deepEqual(m, { type: 'manifest/get', integration: 'famalio' }); return {}; } }), true);
  assert.equal(await integrationLoaded({ config: { components: [] }, callWS: async () => { throw { code: 'not_found' }; } }), false);
  assert.equal(await integrationLoaded({ config: { components: [] }, callWS: async () => { throw new Error('Connection lost'); } }), null);
});

test('restart calls homeassistant.restart', async () => {
  const calls = [];
  await restartHomeAssistant({ callService: async (...a) => { calls.push(a); } });
  assert.deepEqual(calls, [['homeassistant', 'restart']]);
});

test('pending connect code and current step', () => {
  assert.equal(pendingConnectCode({ home_assistant: { request: { state: 'pending', code: 'ABCD-EFGH' } } }), 'ABCD-EFGH');
  assert.equal(pendingConnectCode({ home_assistant: { request: { state: 'connected', code: 'ABCD-EFGH' } } }), '');
  assert.equal(pendingConnectCode({}), '');
  assert.equal(currentStep({ ready: false, appReady: false, haDone: false }), 1);
  assert.equal(currentStep({ ready: true, appReady: false, haDone: false }), 2);
  assert.equal(currentStep({ ready: true, appReady: true, haDone: false }), 3);
  assert.equal(currentStep({ ready: true, appReady: true, haDone: true }), 4);
});
