import type { AppConfig, Env, SatisfiedByteRange } from "./types";

/**
 * Map an R2 object key to the stable public streaming URL.
 * Database should store only the object key, never this URL.
 */
export function buildStreamUrl(
  objectKey: string,
  baseUrl: string,
): string {
  const normalizedKey = objectKey.replace(/^\/+/, "");
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/${normalizedKey}`;
}

/**
 * Resolve the public base URL from config, falling back to the request origin
 * (works for both custom domains and *.workers.dev during development).
 */
export function resolveMediaBaseUrl(request: Request, config: AppConfig): string {
  if (config.mediaBaseUrl) return config.mediaBaseUrl;
  return new URL(request.url).origin;
}

/**
 * Convert a request pathname into a safe R2 object key.
 * Rejects empty keys, path traversal, and encoded `..` segments.
 * Applies optional KEY_PREFIX from config.
 */
export function requestPathToObjectKey(
  pathname: string,
  config: AppConfig,
): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const withoutLeading = decoded.replace(/^\/+/, "");
  if (!withoutLeading) {
    return null;
  }

  if (
    withoutLeading.includes("\0") ||
    /^[a-zA-Z]:[\\/]/.test(withoutLeading) ||
    withoutLeading.startsWith("\\")
  ) {
    return null;
  }

  const segments = withoutLeading.split("/");
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      return null;
    }
  }

  return `${config.keyPrefix}${segments.join("/")}`;
}

/**
 * Parse a single `bytes=` Range header against object size.
 * Multipart ranges are rejected (unsatisfiable for this media worker).
 */
export function parseByteRange(
  rangeHeader: string,
  size: number,
):
  | { ok: true; range: SatisfiedByteRange }
  | { ok: false; reason: "invalid" | "unsatisfiable" } {
  const trimmed = rangeHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bytes=")) {
    return { ok: false, reason: "invalid" };
  }

  const spec = trimmed.slice("bytes=".length).trim();
  if (!spec || spec.includes(",")) {
    return { ok: false, reason: "unsatisfiable" };
  }

  const dash = spec.indexOf("-");
  if (dash < 0) {
    return { ok: false, reason: "invalid" };
  }

  const startRaw = spec.slice(0, dash);
  const endRaw = spec.slice(dash + 1);

  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isInteger(suffix) || suffix <= 0) {
      return { ok: false, reason: "invalid" };
    }
    if (size === 0) {
      return { ok: false, reason: "unsatisfiable" };
    }
    const length = Math.min(suffix, size);
    const start = size - length;
    const end = size - 1;
    return {
      ok: true,
      range: { offset: start, length, start, end },
    };
  }

  const start = Number(startRaw);
  if (!Number.isInteger(start) || start < 0) {
    return { ok: false, reason: "invalid" };
  }

  if (start >= size) {
    return { ok: false, reason: "unsatisfiable" };
  }

  if (endRaw === "") {
    const end = size - 1;
    const length = end - start + 1;
    return {
      ok: true,
      range: { offset: start, length, start, end },
    };
  }

  const end = Number(endRaw);
  if (!Number.isInteger(end) || end < start) {
    return { ok: false, reason: "invalid" };
  }

  const clampedEnd = Math.min(end, size - 1);
  const length = clampedEnd - start + 1;
  return {
    ok: true,
    range: { offset: start, length, start, end: clampedEnd },
  };
}

function resolveAllowOrigin(
  request: Request,
  config: AppConfig,
): string | null {
  const requestOrigin = request.headers.get("Origin");

  if (config.corsOrigins === "*") {
    return "*";
  }

  if (!requestOrigin) {
    return config.corsOrigins[0] ?? null;
  }

  const normalized = requestOrigin.replace(/\/+$/, "");
  if (config.corsOrigins.includes(normalized)) {
    return requestOrigin;
  }

  return null;
}

export function corsHeaders(request: Request, config: AppConfig): Headers {
  const headers = new Headers();
  const allowOrigin = resolveAllowOrigin(request, config);

  if (allowOrigin) {
    headers.set("Access-Control-Allow-Origin", allowOrigin);
  }

  headers.set("Access-Control-Allow-Methods", config.corsAllowMethods);
  headers.set("Access-Control-Allow-Headers", config.corsAllowHeaders);
  headers.set("Access-Control-Expose-Headers", config.corsExposeHeaders);
  headers.set("Access-Control-Max-Age", config.corsMaxAge);
  headers.set("Vary", "Origin");

  if (config.corsAllowCredentials && allowOrigin && allowOrigin !== "*") {
    headers.set("Access-Control-Allow-Credentials", "true");
  }

  return headers;
}

export function applyCors(
  response: Response,
  request: Request,
  config: AppConfig,
): Response {
  const headers = new Headers(response.headers);
  const cors = corsHeaders(request, config);
  cors.forEach((value, key) => {
    headers.set(key, value);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function buildObjectHeaders(
  object: R2Object,
  config: AppConfig,
  options?: {
    range?: SatisfiedByteRange;
  },
): Headers {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");

  if (config.cacheControlOverride || !headers.has("Cache-Control")) {
    headers.set("Cache-Control", config.cacheControl);
  }

  if (options?.range) {
    const { start, end, length } = options.range;
    headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
    headers.set("Content-Length", String(length));
  } else {
    headers.set("Content-Length", String(object.size));
  }

  return headers;
}

export function rangeNotSatisfiable(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: {
      "Content-Range": `bytes */${size}`,
      "Accept-Ranges": "bytes",
    },
  });
}

/**
 * Stream (or HEAD) an R2 object, including validated Range support for seeking.
 */
export async function handleMediaRequest(
  request: Request,
  env: Env,
  objectKey: string,
  config: AppConfig,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const rangeHeader =
    config.enableRange ? request.headers.get("Range") : null;

  if (method === "HEAD") {
    const object = await env.MEDIA_BUCKET.head(objectKey);
    if (object === null) {
      return new Response(config.notFoundBody, { status: 404 });
    }

    if (rangeHeader) {
      const parsed = parseByteRange(rangeHeader, object.size);
      if (!parsed.ok) {
        if (parsed.reason === "unsatisfiable") {
          return rangeNotSatisfiable(object.size);
        }
      } else {
        return new Response(null, {
          status: 206,
          headers: buildObjectHeaders(object, config, {
            range: parsed.range,
          }),
        });
      }
    }

    return new Response(null, {
      status: 200,
      headers: buildObjectHeaders(object, config),
    });
  }

  let satisfied: SatisfiedByteRange | undefined;

  if (rangeHeader) {
    const meta = await env.MEDIA_BUCKET.head(objectKey);
    if (meta === null) {
      return new Response(config.notFoundBody, { status: 404 });
    }

    const parsed = parseByteRange(rangeHeader, meta.size);
    if (!parsed.ok) {
      if (parsed.reason === "unsatisfiable") {
        return rangeNotSatisfiable(meta.size);
      }
      satisfied = undefined;
    } else {
      satisfied = parsed.range;
    }
  }

  const object = await env.MEDIA_BUCKET.get(
    objectKey,
    satisfied
      ? {
          range: { offset: satisfied.offset, length: satisfied.length },
          onlyIf: request.headers,
        }
      : {
          onlyIf: request.headers,
        },
  );

  if (object === null) {
    return new Response(config.notFoundBody, { status: 404 });
  }

  if (!("body" in object) || object.body === undefined) {
    const headers = buildObjectHeaders(object, config);
    return new Response(null, { status: 304, headers });
  }

  const headers = buildObjectHeaders(object, config, { range: satisfied });
  const status = satisfied ? 206 : 200;

  return new Response(object.body, { status, headers });
}
