import { loadConfig } from './config.ts';
import { createPool } from './db.ts';
import { compactJournal } from './records.ts';

/** Operator entry point: `node src/retention.ts` purges expired tombstones once. Logs counts only. */
const config = loadConfig();
const db = createPool(config.databaseUrl);
try {
  const result = await compactJournal(db, config.tombstoneRetentionDays * 86_400);
  console.log(JSON.stringify({ event: 'journal_compacted', ...result, retention_days: config.tombstoneRetentionDays }));
} finally {
  await db.end();
}
