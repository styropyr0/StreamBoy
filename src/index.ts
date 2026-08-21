import { authorizeRequest } from "./auth";
import { isKeyAllowed, loadConfig } from "./config";
import {
  applyCors,
  corsHeaders,
  handleMediaRequest,
  requestPathToObjectKey,
} from "./streaming";
import type { Env } from "./types";

export { loadConfig };
export { signMediaUrlParts, hmacPayload } from "./auth";
export type { Env, AppConfig } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const config = loadConfig(env);
    const response = await handleRequest(request, env, config);
    return applyCors(response, request, config);
  },
};

async function handleRequest(
  request: Request,
  env: Env,
  config: ReturnType<typeof loadConfig>,
): Promise<Response> {
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request, config),
    });
  }

  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: config.corsAllowMethods },
    });
  }

  const url = new URL(request.url);

  if (config.enableHealthcheck && config.healthcheckPaths.has(url.pathname)) {
    return new Response("ok", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const objectKey = requestPathToObjectKey(url.pathname, config);
  if (objectKey === null) {
    return new Response("Bad Request", { status: 400 });
  }

  if (!isKeyAllowed(objectKey, config)) {
    return new Response(config.forbiddenBody, { status: 403 });
  }

  const auth = await authorizeRequest(request, objectKey, config);
  if (!auth.allowed) {
    return new Response(auth.message ?? config.forbiddenBody, {
      status: auth.status ?? 403,
    });
  }

  return handleMediaRequest(request, env, objectKey, config);
}
