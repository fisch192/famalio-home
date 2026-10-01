import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { buildRouter } from './app.ts';
import { loadConfig, type Config } from './config.ts';
import { createPool } from './db.ts';
import { listener } from './http.ts';
import { compactJournal } from './records.ts';

export async function start(config: Config, log: (line: object) => void = (l) => console.log(JSON.stringify(l))) {
  const db = createPool(config.databaseUrl);
  const { router, auth } = buildRouter(db, config);
  const handler = listener(router, config.maxBodyBytes, log);
  const server = config.tlsCertFile && config.tlsKeyFile
    ? https.createServer({ cert: readFileSync(config.tlsCertFile), key: readFileSync(config.tlsKeyFile), minVersion: 'TLSv1.2' }, handler)
    : http.createServer(handler);
  server.headersTimeout = 20_000;
  server.requestTimeout = 60_000;
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  const setupCode = await auth.createSetupCodeIfUnclaimed();
  const retentionSeconds = config.tombstoneRetentionDays * 86_400;
  const compact = async () => {
    try {
      log({ event: 'journal_compacted', ...(await compactJournal(db, retentionSeconds)) });
    } catch {
      log({ event: 'journal_compaction_failed' });
    }
  };
  await compact();
  const retention = setInterval(() => { void compact(); }, 24 * 3600 * 1000);
  retention.unref();
  return {
    port: (server.address() as AddressInfo).port,
    setupCode,
    async close() {
      clearInterval(retention);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.end();
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const running = await start(config);
  console.log(JSON.stringify({ event: 'listening', host: config.host, port: running.port }));
  if (running.setupCode) {
    // Local console only (HA add-on log / docker logs). Valid once, for a limited time.
    console.log(`\nFamalio Home owner setup code (valid ${Math.round(config.setupTtlSeconds / 60)} min, single use):\n${running.setupCode}\n`);
  }
  const stop = () => { void running.close().then(() => process.exit(0)); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
