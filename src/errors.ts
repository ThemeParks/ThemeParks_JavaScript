/**
 * Error class hierarchy for the ThemeParks SDK.
 *
 * All SDK-thrown errors inherit from {@link ThemeParksError} so callers can
 * catch the SDK's errors with a single `instanceof` check.
 */

/** Maximum length of a body excerpt embedded in an error message. */
const BODY_EXCERPT_MAX_LEN = 200;

function truncateExcerpt(excerpt: string): string {
  if (excerpt.length <= BODY_EXCERPT_MAX_LEN) {
    return excerpt;
  }
  return `${excerpt.slice(0, BODY_EXCERPT_MAX_LEN)}... (truncated)`;
}

/** Base class for all errors thrown by the SDK. */
export class ThemeParksError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ThemeParksError';
  }
}

export interface ApiErrorInit {
  status: number;
  body: unknown;
  url: string;
  cause?: unknown;
  /**
   * Optional string excerpt of the response body to embed in `.message`.
   * Truncated to a reasonable length; the full body remains available on
   * the `body` field.
   */
  bodyExcerpt?: string;
}

/**
 * Raised when the ThemeParks API returns a non-2xx HTTP response.
 *
 * Carries the HTTP status, parsed body (if any), and request URL.
 */
export class ApiError extends ThemeParksError {
  readonly status: number;
  readonly body: unknown;
  readonly url: string;

  constructor(message: string, init: ApiErrorInit) {
    const fullMessage =
      init.bodyExcerpt !== undefined && init.bodyExcerpt.length > 0
        ? `${message}: ${truncateExcerpt(init.bodyExcerpt)}`
        : message;
    super(fullMessage, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'ApiError';
    this.status = init.status;
    this.body = init.body;
    this.url = init.url;
  }

  override toString(): string {
    return `${this.name}: status=${this.status} url=${JSON.stringify(this.url)} message=${JSON.stringify(this.message)}`;
  }
}

export interface RateLimitErrorInit extends ApiErrorInit {
  /**
   * Number of milliseconds the caller should wait before retrying, if the
   * server provided a `Retry-After` header. `null` when no hint was given.
   */
  retryAfterMs?: number | null;
}

/** Raised on HTTP 429 Too Many Requests. */
export class RateLimitError extends ApiError {
  readonly retryAfterMs: number | null;

  constructor(message: string, init: RateLimitErrorInit) {
    super(message, init);
    this.name = 'RateLimitError';
    this.retryAfterMs = init.retryAfterMs ?? null;
  }
}

/** Raised when the underlying HTTP transport fails (DNS, connection reset, etc.). */
export class NetworkError extends ThemeParksError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

/** Raised when a request exceeds the configured timeout. */
export class TimeoutError extends ThemeParksError {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}
