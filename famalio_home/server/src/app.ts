import { Auth } from './auth.ts';
import type { Config } from './config.ts';
import type { Db } from './db.ts';
import { Router } from './http.ts';
import { Migrations } from './migration/service.ts';
import { HomeAssistantCalendar } from './ha-calendar.ts';
import { Records } from './records.ts';

export const API_VERSION = '1';
export const CAPABILITIES = ['pairing_v1', 'records_v1', 'devices_v1', 'owner_recovery_v1', 'migration_import_v1', 'ha_connect_v1'];

/**
 * Route table. Every family route authenticates a mobile session first; setup and
 * pairing routes accept only their own single-purpose secrets (10_API_CONTRACT.md).
 * Proxy/identity headers (X-Forwarded-*, Tailscale-User-*, X-Remote-User, HA ingress)
 * are never read: network position grants nothing (SEC-07).
 */
export function buildRouter(db: Db, config: Config): { router: Router; auth: Auth; records: Records; migrations: Migrations } {
  const router = new Router();
  const auth = new Auth(db, config);
  const records = new Records(db);
  const migrations = new Migrations(db, config, auth);
  const haCalendar = new HomeAssistantCalendar(db, auth, records);

  router.add('GET', '/health/live', async () => ({ body: { status: 'ok' } }));
  router.add('GET', '/v1/info', async () => {
    const instance = await auth.instance();
    const { rows } = await db.query(
      "select not exists(select 1 from famalio.subjects where role='owner' and removed_at is null) as owner_setup_required");
    return { body: { instance_id: instance.instance_id, api_version: API_VERSION, min_protocol_version: '1', capabilities: CAPABILITIES,
      owner_setup_required: rows[0]?.owner_setup_required === true } };
  });

  router.add('POST', '/v1/setup/owner', async (request) => ({ status: 201, body: await auth.bootstrapOwner(request) }));

  router.add('POST', '/v1/auth/refresh', async (request) => ({ body: await auth.refresh(request) }));
  router.add('POST', '/v1/auth/logout', async (request) => {
    await auth.logout(await auth.authenticate(request));
    return { status: 204, body: {} };
  });
  router.add('GET', '/v1/me', async (request) => {
    const p = await auth.authenticate(request);
    const instance = await auth.instance();
    return { body: { ...instance, family_id: p.familyId, subject_id: p.subjectId, device_id: p.deviceId, role: p.role, member_record_name: p.memberRecordName } };
  });

  router.add('POST', '/v1/pairing/offers', async (request) =>
    ({ status: 201, body: await auth.createPairingOffer(await auth.authenticate(request), request.body) }));
  router.add('POST', '/v1/pairing/requests', async (request) => ({ status: 201, body: await auth.requestPairing(request) }));
  router.add('GET', '/v1/pairing/requests', async (request) => ({ body: { requests: await auth.pendingPairings(await auth.authenticate(request)) } }));
  router.add('POST', '/v1/pairing/requests/{pairing_id}/approve', async (request) =>
    ({ body: await auth.approvePairing(await auth.authenticate(request), request.params.pairing_id!, request.body) }));
  router.add('POST', '/v1/pairing/requests/{pairing_id}/status', async (request) =>
    ({ body: await auth.pairingStatus(request, request.params.pairing_id!) }));
  router.add('POST', '/v1/pairing/requests/{pairing_id}/claim', async (request) =>
    ({ status: 201, body: await auth.claimPairing(request, request.params.pairing_id!) }));

  router.add('GET', '/v1/devices', async (request) => ({ body: { devices: await auth.devices(await auth.authenticate(request)) } }));
  router.add('POST', '/v1/devices/{device_id}/revoke', async (request) => {
    await auth.revokeDevice(await auth.authenticate(request), request.params.device_id!);
    return { status: 204, body: {} };
  });
  router.add('POST', '/v1/subjects/{subject_id}/role', async (request) => {
    await auth.setRole(await auth.authenticate(request), request.params.subject_id!, request.body);
    return { status: 204, body: {} };
  });

  router.add('GET', '/v1/families/{family_id}/changes', async (request) =>
    ({ body: await records.changes(await auth.authenticate(request), request.params.family_id!, request.query.get('cursor'), request.query.get('limit')) }));
  router.add('POST', '/v1/families/{family_id}/mutations', async (request) =>
    ({ body: await records.mutate(await auth.authenticate(request), request.params.family_id!, request.body) }));

  // Owner-critical actions: fresh confirmation (current refresh credential), recovery, transfer.
  router.add('POST', '/v1/owner/confirmations', async (request) =>
    ({ status: 201, body: await auth.createConfirmation(await auth.authenticate(request), request.body) }));
  router.add('POST', '/v1/owner/recovery-code', async (request) =>
    ({ status: 201, body: await auth.rotateRecoveryCode(await auth.authenticate(request), request.body) }));
  router.add('POST', '/v1/owner/recover', async (request) => ({ status: 201, body: await auth.recoverOwner(request) }));
  router.add('POST', '/v1/owner/transfer', async (request) =>
    ({ body: await auth.transferOwnership(await auth.authenticate(request), request.body) }));

  // Dedicated HA calendar principal (read, or owner-approved event writes). It is
  // intentionally not a mobile session and cannot use the family snapshot/mutation routes.
  router.add('GET', '/v1/owner/ha-integrations', async (request) =>
    ({ body: await haCalendar.list(await auth.authenticate(request)) }));
  router.add('POST', '/v1/owner/ha-integrations', async (request) =>
    ({ status: 201, body: await haCalendar.create(await auth.authenticate(request), request.body) }));
  router.add('DELETE', '/v1/owner/ha-integrations/{integration_id}', async (request) => {
    await haCalendar.revoke(await auth.authenticate(request), request.params.integration_id!, request.body);
    return { status: 204, body: {} };
  });
  router.add('GET', '/v1/ha/calendars', async (request) => ({ body: await haCalendar.calendars(request) }));
  router.add('GET', '/v1/ha/calendars/{calendar_id}/events', async (request) =>
    ({ body: await haCalendar.events(request, request.params.calendar_id!) }));
  router.add('POST', '/v1/ha/calendars/{calendar_id}/events', async (request) =>
    ({ status: 201, body: await haCalendar.createEvent(request, request.params.calendar_id!) }));
  router.add('PATCH', '/v1/ha/calendars/{calendar_id}/events/{uid}', async (request) =>
    ({ body: await haCalendar.updateEvent(request, request.params.calendar_id!, request.params.uid!) }));
  router.add('DELETE', '/v1/ha/calendars/{calendar_id}/events/{uid}', async (request) => {
    await haCalendar.deleteEvent(request, request.params.calendar_id!, request.params.uid!);
    return { status: 204, body: {} };
  });

  // HA connection requests: the HA app asks, the owner approves in Famalio, and the
  // requester claims the integration token once. Nothing is granted by network position.
  router.add('POST', '/v1/ha/connection-requests', async (request) => ({ status: 201, body: await haCalendar.requestConnection(request) }));
  router.add('POST', '/v1/ha/connection-requests/{request_id}/claim', async (request) =>
    haCalendar.claimConnection(request, request.params.request_id!));
  router.add('GET', '/v1/owner/ha-connection-requests', async (request) =>
    ({ body: await haCalendar.pendingConnections(await auth.authenticate(request)) }));
  router.add('POST', '/v1/owner/ha-connection-requests/{request_id}/approve', async (request) =>
    ({ body: await haCalendar.approveConnection(await auth.authenticate(request), request.params.request_id!, request.body) }));
  router.add('POST', '/v1/owner/ha-connection-requests/{request_id}/deny', async (request) => {
    await haCalendar.denyConnection(await auth.authenticate(request), request.params.request_id!);
    return { status: 204, body: {} };
  });

  // Quarantined migration import (P03). Chunk upload accepts only the transfer credential.
  router.add('POST', '/v1/migrations', async (request) => migrations.prepare(await auth.authenticate(request), request.body));
  router.add('GET', '/v1/migrations/{migration_id}', async (request) => ({ body: await migrations.getStatus(request, request.params.migration_id!) }));
  router.add('PUT', '/v1/migrations/{migration_id}/chunks/{chunk_id}', async (request) =>
    ({ body: await migrations.uploadChunk(request, request.params.migration_id!, request.params.chunk_id!) }), { rawMaxBytes: config.migrationMaxChunkBytes, beforeBody: (request) => migrations.authorizeTransfer(request, request.params.migration_id!) });
  router.add('POST', '/v1/migrations/{migration_id}/snapshot', async (request) =>
    ({ body: await migrations.supersede(await auth.authenticate(request), request.params.migration_id!, request.body) }));
  router.add('POST', '/v1/migrations/{migration_id}/verify', async (request) =>
    ({ body: await migrations.verify(await auth.authenticate(request), request.params.migration_id!, request.body) }));
  router.add('POST', '/v1/migrations/{migration_id}/abort', async (request) =>
    ({ body: await migrations.abort(await auth.authenticate(request), request.params.migration_id!) }));

  return { router, auth, records, migrations };
}
