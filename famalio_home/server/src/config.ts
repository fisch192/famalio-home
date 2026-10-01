export interface Config {
  databaseUrl: string;
  host: string;
  port: number;
  tlsCertFile: string | undefined;
  tlsKeyFile: string | undefined;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  pairingTtlSeconds: number;
  setupTtlSeconds: number;
  maxBodyBytes: number;
  unauthenticatedRatePerMinute: number;
  confirmationTtlSeconds: number;
  tombstoneRetentionDays: number;
  transferTtlSeconds: number;
  migrationMaxChunkBytes: number;
  migrationMaxChunkRecords: number;
  migrationMaxChunks: number;
  migrationMaxTotalBytes: number;
}

function int(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

/**
 * Tombstone retention (decision 2026-09-25, docs/famalio-home/ADR-002 §6): 400 days by
 * default so a device used only seasonally (e.g. a holiday iPad) still receives
 * deletions as a delta; at least 90 days so an operator cannot silently shrink it to
 * a window in which normal offline phones fall out. Beyond it a device gets 410
 * CURSOR_EXPIRED and reloads a snapshot without losing its outbox.
 */
export const MIN_TOMBSTONE_RETENTION_DAYS = 90;
export const DEFAULT_TOMBSTONE_RETENTION_DAYS = 400;

function retentionDays(env: NodeJS.ProcessEnv): number {
  const days = int('FAMALIO_TOMBSTONE_RETENTION_DAYS', DEFAULT_TOMBSTONE_RETENTION_DAYS, env);
  if (days < MIN_TOMBSTONE_RETENTION_DAYS) {
    throw new Error(`FAMALIO_TOMBSTONE_RETENTION_DAYS must be at least ${MIN_TOMBSTONE_RETENTION_DAYS}`);
  }
  return days;
}

/** The server binds to loopback by default; exposing it is an explicit operator choice. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.FAMALIO_DATABASE_URL;
  if (!databaseUrl) throw new Error('FAMALIO_DATABASE_URL is required');
  return {
    databaseUrl,
    host: env.FAMALIO_HOST || '127.0.0.1',
    port: int('FAMALIO_PORT', 8787, env),
    tlsCertFile: env.FAMALIO_TLS_CERT_FILE || undefined,
    tlsKeyFile: env.FAMALIO_TLS_KEY_FILE || undefined,
    accessTtlSeconds: int('FAMALIO_ACCESS_TTL_SECONDS', 3600, env),
    refreshTtlSeconds: int('FAMALIO_REFRESH_TTL_SECONDS', 90 * 24 * 3600, env),
    pairingTtlSeconds: int('FAMALIO_PAIRING_TTL_SECONDS', 300, env),
    setupTtlSeconds: int('FAMALIO_SETUP_TTL_SECONDS', 1800, env),
    maxBodyBytes: int('FAMALIO_MAX_BODY_BYTES', 8 * 1024 * 1024, env),
    unauthenticatedRatePerMinute: int('FAMALIO_UNAUTHENTICATED_RATE_PER_MINUTE', 20, env),
    confirmationTtlSeconds: int('FAMALIO_CONFIRMATION_TTL_SECONDS', 300, env),
    // Deletion tombstones are kept this long; older delta cursors get 410 CURSOR_EXPIRED.
    tombstoneRetentionDays: retentionDays(env),
    transferTtlSeconds: int('FAMALIO_MIGRATION_TRANSFER_TTL_SECONDS', 24 * 3600, env),
    // A single cloud record may hold up to 24 MiB (inline avatar); chunks must fit one.
    migrationMaxChunkBytes: int('FAMALIO_MIGRATION_MAX_CHUNK_BYTES', 32 * 1024 * 1024, env),
    migrationMaxChunkRecords: int('FAMALIO_MIGRATION_MAX_CHUNK_RECORDS', 500, env),
    migrationMaxChunks: int('FAMALIO_MIGRATION_MAX_CHUNKS', 10_000, env),
    migrationMaxTotalBytes: int('FAMALIO_MIGRATION_MAX_TOTAL_BYTES', 1024 * 1024 * 1024, env),
  };
}
