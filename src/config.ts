import type { AppConfig, AuthMode, Env } from "./types";

const DEFAULT_CACHE_CONTROL = "public, max-age=31536000, immutable";
const DEFAULT_CORS_ALLOW_HEADERS =
  "Range, If-Match, If-None-Match, If-Modified-Since, If-Unmodified-Since, Authorization";
const DEFAULT_CORS_EXPOSE_HEADERS =
  "Accept-Ranges, Content-Range, Content-Length, Content-Type, ETag, Content-Disposition, Cache-Control";
const DEFAULT_CORS_ALLOW_METHODS = "GET, HEAD, OPTIONS";

function envBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

function envList(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizePrefix(raw: string): string {
  return raw.replace(/^\/+/, "");
}

function parseAuthMode(raw: string | undefined): AuthMode {
  const mode = (raw ?? "none").trim().toLowerCase();
  if (mode === "bearer" || mode === "query" || mode === "hmac" || mode === "none") {
    return mode;
  }
  return "none";
}

function collectTokens(env: Env): Set<string> {
  const tokens = new Set<string>();
  if (env.AUTH_TOKEN?.trim()) tokens.add(env.AUTH_TOKEN.trim());
  for (const t of envList(env.AUTH_TOKENS)) tokens.add(t);
  return tokens;
}

function matchesPrefix(objectKey: string, prefixRaw: string): boolean {
  const prefix = normalizePrefix(prefixRaw);
  if (!prefix) return false;
  if (objectKey === prefix) return true;
  const withSlash = prefix.endsWith("/") ? prefix : `${prefix}/`;
  return objectKey.startsWith(withSlash);
}

/**
 * Resolve a typed config object from Worker env.
 * Cheap to call per request.
 */
export function loadConfig(env: Env): AppConfig {
  const corsOriginsRaw = env.CORS_ORIGINS?.trim() || "*";
  const corsOrigins: string[] | "*" =
    corsOriginsRaw === "*"
      ? "*"
      : envList(corsOriginsRaw).map((o) => o.replace(/\/+$/, ""));

  const healthPaths = envList(env.HEALTHCHECK_PATHS);
  const healthcheckPaths = new Set(
    (healthPaths.length > 0 ? healthPaths : ["/health", "/healthz"]).map((p) =>
      p.startsWith("/") ? p : `/${p}`,
    ),
  );

  let keyPrefix = (env.KEY_PREFIX ?? "").replace(/^\/+|\/+$/g, "");
  if (keyPrefix) keyPrefix = `${keyPrefix}/`;

  return {
    authMode: parseAuthMode(env.AUTH_MODE),
    authTokens: collectTokens(env),
    authHmacSecret: env.AUTH_HMAC_SECRET?.trim() || null,
    authTokenQueryParam: env.AUTH_TOKEN_QUERY_PARAM?.trim() || "token",
    authHmacExpParam: env.AUTH_HMAC_EXP_PARAM?.trim() || "exp",
    authHmacSigParam: env.AUTH_HMAC_SIG_PARAM?.trim() || "sig",
    authHmacMaxTtlSeconds: Math.max(
      0,
      Number(env.AUTH_HMAC_MAX_TTL_SECONDS ?? "86400") || 0,
    ),
    authHeaderName: env.AUTH_HEADER_NAME?.trim() || "Authorization",
    corsOrigins,
    corsAllowCredentials: envBool(env.CORS_ALLOW_CREDENTIALS, false),
    corsAllowHeaders:
      env.CORS_ALLOW_HEADERS?.trim() || DEFAULT_CORS_ALLOW_HEADERS,
    corsExposeHeaders:
      env.CORS_EXPOSE_HEADERS?.trim() || DEFAULT_CORS_EXPOSE_HEADERS,
    corsAllowMethods:
      env.CORS_ALLOW_METHODS?.trim() || DEFAULT_CORS_ALLOW_METHODS,
    corsMaxAge: String(
      Math.max(0, Number(env.CORS_MAX_AGE ?? "86400") || 86400),
    ),
    cacheControl: env.CACHE_CONTROL?.trim() || DEFAULT_CACHE_CONTROL,
    cacheControlOverride: envBool(env.CACHE_CONTROL_OVERRIDE, false),
    allowedPrefixes: envList(env.ALLOWED_PREFIXES).map(normalizePrefix),
    deniedPrefixes: envList(env.DENIED_PREFIXES).map(normalizePrefix),
    keyPrefix,
    enableHealthcheck: envBool(env.ENABLE_HEALTHCHECK, true),
    healthcheckPaths,
    enableRange: envBool(env.ENABLE_RANGE, true),
    notFoundBody: env.NOT_FOUND_BODY ?? "Not Found",
    forbiddenBody: env.FORBIDDEN_BODY ?? "Forbidden",
  };
}

/** Whether an object key is permitted by ALLOWED_PREFIXES / DENIED_PREFIXES. */
export function isKeyAllowed(objectKey: string, config: AppConfig): boolean {
  if (config.deniedPrefixes.some((p) => matchesPrefix(objectKey, p))) {
    return false;
  }
  if (config.allowedPrefixes.length === 0) return true;
  return config.allowedPrefixes.some((p) => matchesPrefix(objectKey, p));
}
