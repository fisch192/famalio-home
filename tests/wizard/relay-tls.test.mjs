import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRelayTLSManager } from '../../famalio_home/wizard/relay-tls.mjs';

const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'famalio-cert-fixtures-'));
const DNS = 'famalio.example.ts.net';
function certificate(name, dns, days) {
  const cert = path.join(fixtures, `${name}.crt`), key = path.join(fixtures, `${name}.key`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt',
    'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert,
    '-days', String(days), '-subj', `/CN=${dns}`, '-addext', `subjectAltName=DNS:${dns}`], { stdio: 'ignore' });
  return { cert: fs.readFileSync(cert), key: fs.readFileSync(key) };
}
const healthy = certificate('healthy', DNS, 90);
const replacement = certificate('replacement', DNS, 90);
const nearRenewal = certificate('renewal', DNS, 5);
test.after(() => fs.rmSync(fixtures, { recursive: true, force: true }));

function harness(t, initial = healthy, request) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'famalio-relay-tls-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const certFile = path.join(dir, 'https.crt'), keyFile = path.join(dir, 'https.key');
  const state = { requests: 0, contexts: 0, time: Date.now() };
  const write = pair => {
    fs.writeFileSync(certFile, pair.cert, { mode: 0o600 });
    fs.writeFileSync(keyFile, pair.key, { mode: 0o600 });
  };
  if (initial) write(initial);
  const manager = createRelayTLSManager({ certFile, keyFile, now: () => state.time,
    createContext(options) { state.contexts++; return tls.createSecureContext(options); },
    async requestCertificate(dns) {
      state.requests++;
      if (request) return request({ dns, write, state });
      throw new Error('Simulated certificate service outage');
    },
  });
  return { manager, state, write, certFile, keyFile };
}

test('unchanged certificates reuse one verified TLS context across repeated checks', async t => {
  const { manager, state } = harness(t);
  const pair = await manager.ensure(DNS);
  for (let i = 0; i < 30; i++) assert.equal(await manager.ensure(DNS), pair);
  assert.equal(state.contexts, 1);
  assert.equal(state.requests, 0);
});

test('certificate and key replacement reloads the context even with preserved mtime', async t => {
  const { manager, state, write, certFile, keyFile } = harness(t);
  const first = await manager.ensure(DNS);
  const certTime = fs.statSync(certFile), keyTime = fs.statSync(keyFile);
  write(replacement);
  fs.utimesSync(certFile, certTime.atime, certTime.mtime);
  fs.utimesSync(keyFile, keyTime.atime, keyTime.mtime);
  const second = await manager.ensure(DNS);
  assert.notEqual(second, first);
  assert.deepEqual(second.cert, replacement.cert);
  assert.equal(await manager.ensure(DNS), second);
  assert.equal(state.contexts, 2);
  assert.equal(state.requests, 0);
});

test('concurrent certificate requests are coalesced and missing files recover', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { manager, state } = harness(t, null, async ({ write }) => { await gate; write(healthy); });
  const pending = Array.from({ length: 20 }, () => manager.ensure(DNS));
  release();
  const pairs = await Promise.all(pending);
  assert.ok(pairs.every(pair => pair === pairs[0]));
  assert.equal(state.requests, 1);
  assert.equal(state.contexts, 1);
});

test('failed issuance backs off, then a new local valid pair recovers immediately', async t => {
  const { manager, state, write } = harness(t, null);
  for (let i = 0; i < 30; i++) await assert.rejects(manager.ensure(DNS), /Simulated/);
  assert.equal(state.requests, 1);
  state.time += 60_001;
  await assert.rejects(manager.ensure(DNS), /Simulated/);
  assert.equal(state.requests, 2);
  write(healthy);
  await manager.ensure(DNS);
  assert.equal(state.requests, 2);
});

test('a valid pair remains usable while renewal fails without repeated TLS work', async t => {
  const { manager, state } = harness(t, nearRenewal);
  const pair = await manager.ensure(DNS);
  for (let i = 0; i < 30; i++) assert.equal(await manager.ensure(DNS), pair);
  assert.equal(state.requests, 1);
  assert.equal(state.contexts, 1);
  state.time += 60_001;
  assert.equal(await manager.ensure(DNS), pair);
  assert.equal(state.requests, 2);
});

test('Tailscale returning its cached certificate does not cause a renewal storm', async t => {
  const { manager, state } = harness(t, nearRenewal, ({ write }) => write(nearRenewal));
  const pair = await manager.ensure(DNS);
  for (let i = 0; i < 30; i++) assert.equal(await manager.ensure(DNS), pair);
  assert.equal(state.requests, 1);
  state.time += 3599_000;
  assert.equal(await manager.ensure(DNS), pair);
  assert.equal(state.requests, 1);
  state.time += 1001;
  await manager.ensure(DNS);
  assert.equal(state.requests, 2);
});

test('changed identity, permissive key mode, mismatched keys and expiry are rejected', async t => {
  const { manager, state, keyFile, write } = harness(t);
  await manager.ensure(DNS);
  await assert.rejects(manager.ensure('other.example.ts.net'), /Simulated/);
  await manager.ensure(DNS);
  fs.chmodSync(keyFile, 0o644);
  await assert.rejects(manager.ensure(DNS), /Simulated/);
  write(healthy); fs.chmodSync(keyFile, 0o600);
  await manager.ensure(DNS);
  write({ cert: healthy.cert, key: replacement.key });
  await assert.rejects(manager.ensure(DNS));
  write(healthy);
  await manager.ensure(DNS);
  state.time = Date.parse(new crypto.X509Certificate(healthy.cert).validTo) + 1;
  await assert.rejects(manager.ensure(DNS));
});

test('invalid DNS names never invoke the certificate CLI', async t => {
  const { manager, state } = harness(t);
  for (const dns of ['example.com', '--flag', null, 'host.ts.net/evil']) await assert.rejects(manager.ensure(dns), /invalid/);
  assert.equal(state.requests, 0);
});
