import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Purpose prefixes prevent accidental mix-ups; authorization never relies on them (ADR-002 §2).
 * fha access · fhr refresh · fhp pairing · fhc pairing claim · fhs setup · fhi HA integration ·
 * fhk owner recovery · fho owner confirmation · fht migration transfer ·
 * fhq HA connection request claim.
 */
export type SecretPurpose = 'fha' | 'fhr' | 'fhp' | 'fhc' | 'fhs' | 'fhk' | 'fho' | 'fht' | 'fhi' | 'fhq';

/** 256 bits from the OS CSPRNG, base64url, with a purpose prefix. */
export function newSecret(purpose: SecretPurpose): string {
  return `${purpose}_${randomBytes(32).toString('base64url')}`;
}

/** Only this hash is stored. High-entropy secrets need no password hashing (SEC-04). */
export function hashSecret(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** Returns the secret if it is well-formed for the purpose, otherwise null. */
export function parseSecret(value: unknown, purpose: SecretPurpose): string | null {
  if (typeof value !== 'string') return null;
  if (!new RegExp(`^${purpose}_[A-Za-z0-9_-]{43}$`).test(value)) return null;
  return value;
}

export function sameHash(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
