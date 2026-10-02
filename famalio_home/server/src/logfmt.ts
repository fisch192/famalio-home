/**
 * Readable, labelled console log for the add-on and Docker logs.
 *
 *   09:07:12  INFO   [Home Assistant]  Waiting for approval in the app  (POST 202, 5 ms, req 8f65a6cc)
 *
 * Only what the JSON line already carried is shown: method, route template,
 * status, duration and request id. Never bodies, tokens or record content (SEC-08).
 * Routine success lines (health checks, polling) are folded into one summary
 * line per minute so real problems stay visible. Set FAMALIO_LOG_FORMAT=json
 * for the raw machine-readable lines.
 */

export type Level = 'INFO' | 'WARN' | 'ERROR';

interface RequestLine { request_id?: string; method?: string; route?: string; status?: number; ms?: number; code?: string }
type AnyLine = RequestLine & { event?: string; [key: string]: unknown };

const AREAS: Array<[RegExp, string]> = [
  [/^\/health\//, 'Health'],
  [/^\/v1\/info$/, 'Health'],
  [/^\/v1\/ha\//, 'Home Assistant'],
  [/^\/v1\/owner\/ha-/, 'Home Assistant'],
  [/^\/v1\/owner\//, 'Owner'],
  [/^\/v1\/setup\//, 'Setup'],
  [/^\/v1\/pairing\//, 'Pairing'],
  [/^\/v1\/devices/, 'Devices'],
  [/^\/v1\/auth\//, 'Login'],
  [/^\/v1\/families\//, 'Sync'],
  [/^\/v1\/migrations/, 'Migration'],
  [/^\/v1\/me$/, 'Account'],
  [/^\/v1\/subjects\//, 'Members'],
];

const ACTIONS: Array<[string, RegExp, string]> = [
  ['POST', /^\/v1\/setup\/owner$/, 'Owner and family created'],
  ['POST', /^\/v1\/pairing\/offers$/, 'Device code created'],
  ['POST', /^\/v1\/pairing\/requests$/, 'Device asks to join'],
  ['POST', /^\/v1\/pairing\/requests\/\{pairing_id\}\/approve$/, 'Device approved'],
  ['POST', /^\/v1\/pairing\/requests\/\{pairing_id\}\/claim$/, 'Device picked up its access'],
  ['GET', /^\/v1\/pairing\/requests\/\{pairing_id\}\/status$/, 'Checking device approval'],
  ['POST', /^\/v1\/auth\/refresh$/, 'Session renewed'],
  ['POST', /^\/v1\/auth\/logout$/, 'Signed out'],
  ['GET', /^\/v1\/families\/\{family_id\}\/changes$/, 'Device synced (download)'],
  ['POST', /^\/v1\/families\/\{family_id\}\/mutations$/, 'Device synced (upload)'],
  ['POST', /^\/v1\/ha\/connection-requests$/, 'Home Assistant asks to connect'],
  ['POST', /^\/v1\/ha\/connection-requests\/\{request_id\}\/claim$/, 'Home Assistant picks up its approval'],
  ['POST', /^\/v1\/owner\/ha-connection-requests\/\{request_id\}\/approve$/, 'Home Assistant connection approved in the app'],
  ['POST', /^\/v1\/owner\/ha-connection-requests\/\{request_id\}\/deny$/, 'Home Assistant connection declined in the app'],
  ['GET', /^\/v1\/ha\/calendars$/, 'Home Assistant read the calendar list'],
  ['GET', /^\/v1\/ha\/calendars\/\{calendar_id\}\/events$/, 'Home Assistant read events'],
  ['POST', /^\/v1\/ha\/calendars\/\{calendar_id\}\/events$/, 'Home Assistant created an event'],
  ['PATCH', /^\/v1\/ha\/calendars\/\{calendar_id\}\/events\/\{uid\}$/, 'Home Assistant changed an event'],
  ['DELETE', /^\/v1\/ha\/calendars\/\{calendar_id\}\/events\/\{uid\}$/, 'Home Assistant deleted an event'],
  ['POST', /^\/v1\/migrations$/, 'Migration started'],
  ['POST', /^\/v1\/migrations\/\{migration_id\}\/verify$/, 'Migration checked'],
  ['POST', /^\/v1\/migrations\/\{migration_id\}\/abort$/, 'Migration cancelled'],
  ['POST', /^\/v1\/owner\/recover$/, 'Owner access recovered'],
  ['POST', /^\/v1\/owner\/transfer$/, 'Owner role handed over'],
];

const STATUS_TEXT: Record<number, string> = {
  202: 'waiting', 400: 'invalid request', 401: 'not signed in', 403: 'not allowed', 404: 'not found',
  409: 'conflict', 410: 'cursor too old, full reload needed', 413: 'request too large',
  429: 'too many requests, slowing down', 503: 'temporarily unavailable',
};

export function areaOf(route: string): string {
  return AREAS.find(([re]) => re.test(route))?.[1] ?? 'Server';
}

export function describe(line: RequestLine): string {
  const method = line.method ?? '?';
  const route = line.route ?? 'unmatched';
  const known = ACTIONS.find(([m, re]) => m === method && re.test(route))?.[2];
  return known ?? (route === 'unmatched' ? 'Unknown address requested' : `${method} ${route}`);
}

export function levelOf(status: number): Level {
  return status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
}

/** Lines that repeat all day and say nothing: health checks and idle polling. */
export function isRoutine(line: RequestLine): boolean {
  const status = line.status ?? 0;
  const route = line.route ?? '';
  if (status >= 400) return false;
  return route.startsWith('/health/') || route === '/v1/info'
    || (status === 202 && /\/claim$|\/status$/.test(route))
    || (route.endsWith('/changes') && status === 200);
}

function clock(now: Date): string {
  return now.toTimeString().slice(0, 8);
}

export function formatRequest(line: RequestLine, now: Date): string {
  const status = line.status ?? 0;
  const note = STATUS_TEXT[status];
  const detail = [`${line.method ?? '?'} ${status}${note ? ` ${note}` : ''}`, `${line.ms ?? 0} ms`,
    ...(line.request_id ? [`req ${line.request_id.slice(0, 8)}`] : [])].join(', ');
  const area = `[${areaOf(line.route ?? '')}]`;
  return `${clock(now)}  ${levelOf(status).padEnd(5)}  ${area.padEnd(18)} ${describe(line)}  (${detail})`;
}

const EVENTS: Record<string, (line: AnyLine) => string> = {
  listening: (l) => `Famalio server is listening on ${l.host}:${l.port}`,
  journal_compacted: () => 'Old deleted entries were cleaned up',
  journal_compaction_failed: () => 'Cleaning up old deleted entries failed; it will retry',
  setup_code_file_failed: () => 'The setup code could not be written for the setup page',
};

export function formatEvent(line: AnyLine, now: Date): string {
  const name = String(line.event ?? 'event');
  const text = EVENTS[name]?.(line) ?? `${name}`;
  const level: Level = /failed/.test(name) ? 'WARN' : 'INFO';
  return `${clock(now)}  ${level.padEnd(5)}  ${'[Server]'.padEnd(18)} ${text}`;
}

/**
 * Stateful console logger. Routine lines are counted and summarised once a minute;
 * everything else prints immediately.
 */
export function createConsoleLog(write: (text: string) => void, now: () => Date = () => new Date(), summaryMs = 60_000) {
  let folded = 0;
  let since = now().getTime();
  const flush = (at: Date) => {
    if (folded > 0) {
      write(`${clock(at)}  INFO   ${'[Health]'.padEnd(18)} ${folded} routine checks and polls in the last minute (not shown)`);
      folded = 0;
    }
    since = at.getTime();
  };
  return (line: object): void => {
    const at = now();
    if (at.getTime() - since >= summaryMs) flush(at);
    const l = line as AnyLine;
    if (typeof l.event === 'string') { write(formatEvent(l, at)); return; }
    if (typeof l.status === 'number') {
      if (isRoutine(l)) { folded += 1; return; }
      write(formatRequest(l, at));
      return;
    }
    write(`${clock(at)}  INFO   ${'[Server]'.padEnd(18)} ${JSON.stringify(line)}`);
  };
}
