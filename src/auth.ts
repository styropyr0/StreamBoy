import type { AppConfig, AuthorizeResult } from "./types";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function extractBearerToken(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(headerValue);
  return match?.[1] ?? null;
}

async function hmacSign(
  secret: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Build the canonical string signed for AUTH_MODE=hmac.
 * Format: `{objectKey}\n{exp}`
 */
export function hmacPayload(objectKey: string, exp: string | number): string {
  return `${objectKey}\n${exp}`;
}

/**
 * Create an HMAC signature for a time-limited media URL (for backends).
 */
export async function signMediaUrlParts(
  objectKey: string,
  expUnixSeconds: number,
  secret: string,
): Promise<string> {
  return hmacSign(secret, hmacPayload(objectKey, expUnixSeconds));
}

async function authorizeHmac(
  request: Request,
  objectKey: string,
  config: AppConfig,
): Promise<AuthorizeResult> {
  if (!config.authHmacSecret) {
    return {
      allowed: false,
      status: 500,
      message: "AUTH_HMAC_SECRET is not configured",
    };
  }

  const url = new URL(request.url);
  const exp = url.searchParams.get(config.authHmacExpParam);
  const sig = url.searchParams.get(config.authHmacSigParam);

  if (!exp || !sig) {
    return { allowed: false, status: 401, message: "Missing signature" };
  }

  if (!/^\d+$/.test(exp)) {
    return { allowed: false, status: 401, message: "Invalid expiry" };
  }

  const expNum = Number(exp);
  const now = Math.floor(Date.now() / 1000);

  if (expNum < now) {
    return { allowed: false, status: 401, message: "URL expired" };
  }

  if (
    config.authHmacMaxTtlSeconds > 0 &&
    expNum - now > config.authHmacMaxTtlSeconds
  ) {
    return { allowed: false, status: 401, message: "Expiry too far in future" };
  }

  const expected = await hmacSign(
    config.authHmacSecret,
    hmacPayload(objectKey, exp),
  );

  if (!timingSafeEqual(expected.toLowerCase(), sig.toLowerCase())) {
    return { allowed: false, status: 401, message: "Invalid signature" };
  }

  return { allowed: true };
}

function authorizeToken(
  presented: string | null,
  config: AppConfig,
): AuthorizeResult {
  if (config.authTokens.size === 0) {
    return {
      allowed: false,
      status: 500,
      message: "AUTH_TOKEN / AUTH_TOKENS is not configured",
    };
  }
  if (!presented) {
    return { allowed: false, status: 401, message: "Unauthorized" };
  }
  for (const token of config.authTokens) {
    if (timingSafeEqual(token, presented)) {
      return { allowed: true };
    }
  }
  return { allowed: false, status: 401, message: "Unauthorized" };
}

/**
 * Authorization based on AUTH_MODE and related env vars.
 *
 * Modes:
 * - none:   allow all (default; fine for public media)
 * - bearer: Authorization: Bearer <token>
 * - query:  ?token=<token>  (param name via AUTH_TOKEN_QUERY_PARAM)
 * - hmac:   ?exp=<unix>&sig=<hmac-sha256-hex>  (see signMediaUrlParts)
 *
 * Extend this function for JWT / session / ACL lookups without changing the Worker pipeline.
 */
export async function authorizeRequest(
  request: Request,
  objectKey: string,
  config: AppConfig,
): Promise<AuthorizeResult> {
  switch (config.authMode) {
    case "none":
      return { allowed: true };

    case "bearer": {
      const header = request.headers.get(config.authHeaderName);
      return authorizeToken(extractBearerToken(header), config);
    }

    case "query": {
      const url = new URL(request.url);
      return authorizeToken(
        url.searchParams.get(config.authTokenQueryParam),
        config,
      );
    }

    case "hmac":
      return authorizeHmac(request, objectKey, config);

    default:
      return { allowed: false, status: 500, message: "Unknown AUTH_MODE" };
  }
}
