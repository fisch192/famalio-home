import { readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const APP_ROLE = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Applies sql/NNN_*.sql in order as the schema owner and grants the runtime role
 * DML only. Run with the owner connection; the app never runs DDL (SEC-05).
 */
export async function migrate(ownerUrl: string, appRole: string): Promise<void> {
  if (!APP_ROLE.test(appRole)) throw new Error('invalid runtime role name');
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(4242001)');
    await client.query('create schema if not exists famalio');
    await client.query('create table if not exists famalio.schema_migrations(version int primary key, applied_at timestamptz not null default now())');
    const applied = new Set((await client.query('select version from famalio.schema_migrations')).rows.map((r) => r.version));
    const dir = new URL('../sql/', import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) {
      const version = Number(file.slice(0, 3));
      if (applied.has(version)) continue;
      const sql = (await readFile(new URL(file, dir), 'utf8'))
        .replace('create table famalio.schema_migrations(', 'create table if not exists famalio.schema_migrations(');
      await client.query(sql);
      await client.query('insert into famalio.schema_migrations(version) values($1)', [version]);
    }
    await client.query("insert into famalio.instance(instance_id, recovery_epoch) values($1,$2) on conflict do nothing", [randomUUID(), randomUUID()]);
    // Identifier is validated above; roles cannot be bound as parameters.
    await client.query(`grant usage on schema famalio to ${appRole}`);
    await client.query(`grant select, insert, update, delete on all tables in schema famalio to ${appRole}`);
    await client.query(`revoke insert, update, delete on famalio.schema_migrations, famalio.instance from ${appRole}`);
    // Placement is not runtime-writable: the app may create families only with the
    // default 'active' state and may only advance revision/journal_floor. Quarantined
    // 'importing' families exist only via famalio.begin_import (sql/002).
    await client.query(`revoke insert, update on famalio.families from ${appRole}`);
    await client.query(`grant insert (id) on famalio.families to ${appRole}`);
    await client.query(`grant update (revision, journal_floor) on famalio.families to ${appRole}`);
    await client.query(`grant usage on all sequences in schema famalio to ${appRole}`);
    await client.query(`grant execute on all functions in schema famalio to ${appRole}`);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ownerUrl = process.env.FAMALIO_OWNER_DATABASE_URL;
  if (!ownerUrl) throw new Error('FAMALIO_OWNER_DATABASE_URL is required');
  await migrate(ownerUrl, process.env.FAMALIO_APP_ROLE ?? 'famalio_app');
  console.log('famalio-home: schema up to date');
}
