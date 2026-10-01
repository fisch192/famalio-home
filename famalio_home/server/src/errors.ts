/** Typed API error (docs/famalio-home/10_API_CONTRACT.md "Fehlercodes"). Messages never carry secrets or content. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | undefined;
  constructor(status: number, code: string, message = code, retryAfterSeconds?: number) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export const invalidInput = (message = 'INVALID_INPUT') => new ApiError(400, 'INVALID_INPUT', message);
export const authRequired = () => new ApiError(401, 'AUTH_REQUIRED', 'Authentication required');
export const tokenRevoked = () => new ApiError(401, 'TOKEN_REVOKED', 'Credential revoked');
export const accessDenied = () => new ApiError(403, 'ACCESS_DENIED', 'Access denied');
export const notFound = () => new ApiError(404, 'NOT_FOUND', 'Not found');
export const versionConflict = () => new ApiError(409, 'VERSION_CONFLICT', 'Record changed on the server');
export const placementChanged = () => new ApiError(409, 'PLACEMENT_CHANGED', 'Family placement changed');
export const idempotencyMismatch = () => new ApiError(409, 'IDEMPOTENCY_MISMATCH', 'Operation id reused with different content');
export const cursorExpired = () => new ApiError(410, 'CURSOR_EXPIRED', 'Cursor no longer valid; fetch a new snapshot');
export const payloadTooLarge = () => new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Payload too large');
export const rateLimited = (seconds: number) => new ApiError(429, 'RATE_LIMITED', 'Too many attempts', seconds);
export const recoveryRequired = () => new ApiError(503, 'RECOVERY_REQUIRED', 'Server was restored; re-pair or resync');
