/**
 * All runtime behavior is controlled via Worker env vars / secrets.
 * See README.md and `.dev.vars.example` for the full list.
 */

export interface Env {
  /** R2 bucket binding (configured in wrangler.toml, not a string env var). */
  MEDIA_BUCKET: R2Bucket;

  /** Canonical public base URL, e.g. https://media.example.com */
  MEDIA_BASE_URL?: string;

  /**
   * Auth mode: `none` | `bearer` | `query` | `hmac`
   * Default: none
   */
  AUTH_MODE?: string;

  /** Shared secret for bearer / query auth (use `wrangler secret`). */
  AUTH_TOKEN?: string;

  /** Comma-separated tokens accepted for bearer / query auth. */
  AUTH_TOKENS?: string;

  /** HMAC secret for signed URLs (use `wrangler secret`). */
  AUTH_HMAC_SECRET?: string;

  /** Query param for AUTH_MODE=query (default: token). */
  AUTH_TOKEN_QUERY_PARAM?: string;

  /** Query param for expiry in AUTH_MODE=hmac (default: exp). */
  AUTH_HMAC_EXP_PARAM?: string;

  /** Query param for signature in AUTH_MODE=hmac (default: sig). */
  AUTH_HMAC_SIG_PARAM?: string;

  /** Max accepted TTL seconds for hmac links; 0 = no max beyond exp (default: 86400). */
  AUTH_HMAC_MAX_TTL_SECONDS?: string;

  /** Header used for bearer auth (default: Authorization). */
  AUTH_HEADER_NAME?: string;

  /**
   * Comma-separated allowed CORS origins, or `*` (default: *).
   * Example: https://app.example.com,https://admin.example.com
   */
  CORS_ORIGINS?: string;

  /** Access-Control-Allow-Credentials (default: false). Ignored when origin is *. */
  CORS_ALLOW_CREDENTIALS?: string;

  /** Override Access-Control-Allow-Headers (comma-separated). */
  CORS_ALLOW_HEADERS?: string;

  /** Override Access-Control-Expose-Headers (comma-separated). */
  CORS_EXPOSE_HEADERS?: string;

  /** Override Access-Control-Allow-Methods (comma-separated). */
  CORS_ALLOW_METHODS?: string;

  /** Access-Control-Max-Age in seconds (default: 86400). */
  CORS_MAX_AGE?: string;

  /**
   * Default Cache-Control when the R2 object has none.
   * Default: public, max-age=31536000, immutable
   */
  CACHE_CONTROL?: string;

  /** If true, always set CACHE_CONTROL (overrides object metadata). Default: false */
  CACHE_CONTROL_OVERRIDE?: string;

  /**
   * Comma-separated object-key prefixes that are allowed (e.g. videos/,images/).
   * Empty = allow all safe keys.
   */
  ALLOWED_PREFIXES?: string;

  /** Comma-separated object-key prefixes that are denied. */
  DENIED_PREFIXES?: string;

  /**
   * Optional prefix prepended to the request path when forming the R2 key.
   * Example: KEY_PREFIX=media/ and GET /videos/a.mp4 → media/videos/a.mp4
   */
  KEY_PREFIX?: string;

  /** Enable /health endpoints (default: true). */
  ENABLE_HEALTHCHECK?: string;

  /** Comma-separated health paths (default: /health,/healthz). */
  HEALTHCHECK_PATHS?: string;

  /** Honor HTTP Range requests (default: true). */
  ENABLE_RANGE?: string;

  /** Body text for 404 responses (default: Not Found). */
  NOT_FOUND_BODY?: string;

  /** Body text for 403 responses (default: Forbidden). */
  FORBIDDEN_BODY?: string;
}

export type AuthMode = "none" | "bearer" | "query" | "hmac";

export interface AppConfig {
  mediaBaseUrl: string | null;
  authMode: AuthMode;
  authTokens: Set<string>;
  authHmacSecret: string | null;
  authTokenQueryParam: string;
  authHmacExpParam: string;
  authHmacSigParam: string;
  authHmacMaxTtlSeconds: number;
  authHeaderName: string;
  corsOrigins: string[] | "*";
  corsAllowCredentials: boolean;
  corsAllowHeaders: string;
  corsExposeHeaders: string;
  corsAllowMethods: string;
  corsMaxAge: string;
  cacheControl: string;
  cacheControlOverride: boolean;
  allowedPrefixes: string[];
  deniedPrefixes: string[];
  keyPrefix: string;
  enableHealthcheck: boolean;
  healthcheckPaths: Set<string>;
  enableRange: boolean;
  notFoundBody: string;
  forbiddenBody: string;
}

export type AuthorizeResult =
  | { allowed: true }
  | { allowed: false; status?: number; message?: string };

/** Parsed, validated byte range. `end` is inclusive (HTTP Range semantics). */
export interface SatisfiedByteRange {
  offset: number;
  length: number;
  start: number;
  end: number;
}
