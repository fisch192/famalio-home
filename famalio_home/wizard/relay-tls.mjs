import fs from 'node:fs';
import crypto from 'node:crypto';
import tls from 'node:tls';

const DAY = 86400_000;
const RENEW_WINDOW = 30 * DAY;

/** Reuse a verified certificate/key pair until its files, identity or validity change. */
export function createRelayTLSManager({ certFile, keyFile, requestCertificate,
  now = Date.now, createContext = tls.createSecureContext }) {
  let checkedDNS = null, checkedFiles = null, pair = null;
  let pending = null, pendingDNS = null;
  let retryDNS = null, nextAttempt = 0, lastError = null;

  function fingerprint() {
    return [certFile, keyFile].map(file => {
      const s = fs.statSync(file, { bigint: true });
      if (!s.isFile()) throw new Error('Certificate files must be regular files.');
      return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.mode].join(':');
    }).join('/');
  }

  function readPair(dns, force = false) {
    let files;
    try { files = fingerprint(); } catch { files = 'missing'; }
    if (!force && checkedDNS === dns && checkedFiles === files) return pair;
    checkedDNS = dns; checkedFiles = files; pair = null;
    try {
      const cert = fs.readFileSync(certFile), key = fs.readFileSync(keyFile);
      const parsed = new crypto.X509Certificate(cert);
      const validUntil = Date.parse(parsed.validTo);
      if (!parsed.checkHost(dns) || Date.parse(parsed.validFrom) > now() ||
          validUntil <= now() || (fs.statSync(keyFile).mode & 0o077) !== 0) return null;
      const context = createContext({ key, cert, minVersion: 'TLSv1.2' });
      if (fingerprint() !== files) return null; // Retry an interrupted pair replacement.
      pair = { key, cert, context, validUntil };
    } catch { /* Missing, malformed or mismatched files require a new certificate. */ }
    return pair;
  }

  async function ensure(dns) {
    if (typeof dns !== 'string' || dns.length >= 254 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.ts\.net$/.test(dns)) {
      throw new Error('Tailscale DNS name is invalid.');
    }
    if (pending) {
      if (pendingDNS === dns) return pending;
      await pending.catch(() => {});
      return ensure(dns);
    }
    const existing = readPair(dns), time = now();
    if (existing && existing.validUntil > time + DAY &&
        (existing.validUntil > time + RENEW_WINDOW || (retryDNS === dns && time < nextAttempt))) return existing;
    if (retryDNS === dns && time < nextAttempt) {
      throw lastError || new Error('Waiting to retry certificate renewal.');
    }
    pendingDNS = dns;
    pending = (async () => {
      try {
        await requestCertificate(dns);
        const replacement = readPair(dns, true);
        if (!replacement || replacement.validUntil <= now() + DAY) throw new Error('The HTTPS certificate is invalid or expires too soon.');
        // Tailscale may return its cached certificate within the renewal window.
        // Do not invoke the CLI again every five seconds when that happens.
        retryDNS = dns; nextAttempt = now() + 3600_000; lastError = null;
        return replacement;
      } catch (error) {
        retryDNS = dns; nextAttempt = now() + 60_000; lastError = error;
        // Keep serving the last valid pair while its renewal service is unavailable.
        if (existing && existing.validUntil > now() + DAY) return existing;
        throw error;
      }
    })();
    try { return await pending; } finally { pending = null; pendingDNS = null; }
  }

  return { ensure };
}
