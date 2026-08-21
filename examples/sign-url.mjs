#!/usr/bin/env node
/**
 * Example: mint a time-limited HMAC media URL for AUTH_MODE=hmac.
 *
 * Usage:
 *   node examples/sign-url.mjs \
 *     --base https://media.example.com \
 *     --key videos/abc123.mp4 \
 *     --secret "$AUTH_HMAC_SECRET" \
 *     --ttl 3600
 *
 * Payload format (must match the Worker): `{objectKey}\n{exp}`
 * Signature: hex(HMAC-SHA256(secret, payload))
 */

import { createHmac } from "node:crypto";

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const base = (arg("base", "https://media.example.com") || "").replace(/\/+$/, "");
const key = (arg("key", "") || "").replace(/^\/+/, "");
const secret = arg("secret", process.env.AUTH_HMAC_SECRET || "");
const ttl = Number(arg("ttl", "3600"));
const expParam = arg("exp-param", "exp");
const sigParam = arg("sig-param", "sig");

if (!key || !secret) {
  console.error("Required: --key and --secret (or AUTH_HMAC_SECRET)");
  process.exit(1);
}

const exp = Math.floor(Date.now() / 1000) + ttl;
const payload = `${key}\n${exp}`;
const sig = createHmac("sha256", secret).update(payload).digest("hex");
const url = `${base}/${key}?${expParam}=${exp}&${sigParam}=${sig}`;

console.log(url);
