import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, invalidInput, notFound, payloadTooLarge } from './errors.ts';

export interface Request {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: unknown;
  requestId: string;
  remoteAddress: string;
}

export type Handler = (request: Request) => Promise<{ status?: number; body: unknown }>;

interface Route { method: string; pattern: RegExp; keys: string[]; template: string; handler: Handler; options: RouteOptions }

/**
 * Byte routes (migration chunks) receive the exact request bytes so they can be
 * hashed before parsing. beforeBody authenticates from headers before any byte of a
 * large body is read, so unauthenticated clients cannot make the server buffer it.
 */
export interface RouteOptions { rawMaxBytes?: number; beforeBody?: (request: Request) => Promise<void> }

export const MAX_JSON_DEPTH = 32;

/** Explicit routes only; anything else is 404 (deny by default). */
export class Router {
  private routes: Route[] = [];

  add(method: string, template: string, handler: Handler, options: RouteOptions = {}): void {
    const keys: string[] = [];
    const pattern = new RegExp('^' + template.replace(/\{([a-z_]+)\}/g, (_, key: string) => {
      keys.push(key);
      return '([A-Za-z0-9_-]{1,128})';
    }) + '$');
    this.routes.push({ method, pattern, keys, template, handler, options });
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | undefined {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const found = route.pattern.exec(path);
      if (!found) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((key, index) => { params[key] = found[index + 1] ?? ''; });
      return { route, params };
    }
    return undefined;
  }
}

export function depth(value: unknown, level = 0): number {
  if (level > MAX_JSON_DEPTH) return level;
  if (Array.isArray(value)) return Math.max(level, ...value.map((item) => depth(item, level + 1)));
  if (value && typeof value === 'object') return Math.max(level, ...Object.values(value).map((item) => depth(item, level + 1)));
  return level;
}

/** Reads at most maxBytes; compressed transfer is refused (no decompression bombs). */
async function readBytes(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(request.headers['content-length'] ?? '0');
  if (declared > maxBytes) throw payloadTooLarge();
  const encoding = request.headers['content-encoding'];
  if (encoding && encoding !== 'identity') throw invalidInput('Compressed bodies are not accepted');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw payloadTooLarge();
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readRaw(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const type = (request.headers['content-type'] ?? '').toLowerCase();
  if (!type.startsWith('application/octet-stream')) throw invalidInput('application/octet-stream body required');
  const bytes = await readBytes(request, maxBytes);
  if (bytes.length === 0) throw invalidInput('Empty body');
  return bytes;
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const bytes = await readBytes(request, maxBytes);
  if (bytes.length === 0) return undefined;
  const type = request.headers['content-type'] ?? '';
  if (!type.toLowerCase().startsWith('application/json')) throw invalidInput('JSON body required');
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw invalidInput('Malformed JSON');
  }
  if (depth(parsed) > MAX_JSON_DEPTH) throw invalidInput('JSON nested too deeply');
  return parsed;
}

export interface LogLine { request_id: string; method: string; route: string; status: number; ms: number; code?: string }

/**
 * Node request listener. Logs contain only method, route template, status and a
 * request id: never bodies, tokens, query strings or record content (SEC-08).
 */
export function listener(router: Router, maxBodyBytes: number, log: (line: LogLine) => void) {
  return async (incoming: IncomingMessage, response: ServerResponse) => {
    const started = Date.now();
    const requestId = randomUUID();
    const url = new URL(incoming.url ?? '/', 'http://famalio.invalid');
    const method = incoming.method ?? 'GET';
    let status = 500;
    let code: string | undefined;
    let template = 'unmatched';
    let payload: unknown;
    try {
      const matched = router.match(method, url.pathname);
      if (!matched) throw notFound();
      template = matched.route.template;
      const request: Request = {
        method, path: url.pathname, params: matched.params, query: url.searchParams,
        headers: incoming.headers, body: undefined, requestId,
        remoteAddress: incoming.socket.remoteAddress ?? '',
      };
      const { rawMaxBytes, beforeBody } = matched.route.options;
      if (beforeBody) await beforeBody(request);
      request.body = method === 'GET' ? undefined
        : rawMaxBytes !== undefined ? await readRaw(incoming, rawMaxBytes)
        : await readBody(incoming, maxBodyBytes);
      const result = await matched.route.handler(request);
      status = result.status ?? 200;
      payload = result.body;
    } catch (error) {
      if (error instanceof ApiError) {
        status = error.status;
        code = error.code;
        payload = { code: error.code, message: error.message, request_id: requestId,
          ...(error.retryAfterSeconds !== undefined ? { retry_after_seconds: error.retryAfterSeconds } : {}) };
      } else {
        status = 503;
        code = 'UNAVAILABLE';
        payload = { code: 'UNAVAILABLE', message: 'Temporarily unavailable', request_id: requestId };
      }
    }
    // 204/304 must not carry a body (RFC 9110 §15.3.5); strict clients reject one.
    const text = status === 204 || status === 304 ? '' : JSON.stringify(payload ?? {});
    response.writeHead(status, {
      ...(text ? { 'content-type': 'application/json; charset=utf-8' } : {}),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-request-id': requestId,
      'content-length': Buffer.byteLength(text),
    });
    response.end(text);
    log({ request_id: requestId, method, route: template, status, ms: Date.now() - started, ...(code ? { code } : {}) });
  };
}
