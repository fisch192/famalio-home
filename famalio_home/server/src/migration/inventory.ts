/**
 * Runtime copy of docs/famalio-home/data-inventory.json semantics that the importer
 * needs. test/migration.test.ts fails when this drifts from the inventory file, so
 * a new cloud record type can never be silently dropped or silently accepted.
 */

/** Record types classified `shared_record`: exported and imported. */
export const SHARED_RECORD_TYPES = ['FC_Family', 'FC_Member', 'FC_Event', 'FC_Group', 'FC_Calendar'] as const;
export type SharedRecordType = typeof SHARED_RECORD_TYPES[number];

/**
 * Data that must never appear in a family snapshot: cloud auth/commerce/operational
 * tables and client-local-only categories. Named here only to produce a concrete
 * blocker message instead of a generic one.
 */
export const NEVER_EXPORTED = new Set([
  'invite_attempts', 'push_queue', 'push_tokens', 'apple_revocations', 'store_entitlements', 'store_subscription_owners',
  'store_test_accounts', 'store_rollout', 'google_play_entitlements', 'invites', 'audience_groups',
  'CapturedDocument', 'ChangeLog', 'EventRequest', 'NotificationRecord', 'ScheduleConflict', 'SharedChildLink', 'ShiftTemplate',
]);

export function isSharedRecordType(type: unknown): type is SharedRecordType {
  return typeof type === 'string' && (SHARED_RECORD_TYPES as readonly string[]).includes(type);
}

/** Concrete, content-free reason for an unsupported type (T029). */
export function unsupportedReason(type: string): string {
  const safe = /^[A-Za-z0-9_]{1,64}$/.test(type) ? type : 'invalid-type-name';
  return NEVER_EXPORTED.has(safe) ? `UNSUPPORTED_RECORD:${safe}:never_exported` : `UNSUPPORTED_RECORD:${safe}:unclassified`;
}
