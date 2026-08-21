# StreamBoy

Stream private Cloudflare R2 media through a Worker with stable URLs and HTTP Range support (seekable video/audio).

```text
GET /videos/abc123.mp4  →  Worker  →  R2.get("videos/abc123.mp4")
```

Store only the object key in your DB. Do not store presigned URLs. Keep the R2 bucket private.

## Setup

```bash
npm install
# Edit wrangler.toml: worker name, bucket_name, [vars]
npx wrangler r2 bucket create your-media-bucket
npx wrangler r2 bucket create your-media-bucket-preview
cp .dev.vars.example .dev.vars   # optional secrets
npm run dev                      # http://127.0.0.1:8787
npm run deploy
```

Optional: attach a custom domain in the Worker dashboard. Clients use that host (or `*.workers.dev`) when building media URLs in your **backend**.

## Configure

All behavior is controlled by env vars in `wrangler.toml` `[vars]` or secrets (`wrangler secret put`).

| Variable | Default | Purpose |
|----------|---------|---------|
| `AUTH_MODE` | `none` | `none` \| `bearer` \| `query` \| `hmac` |
| `AUTH_TOKEN` / `AUTH_TOKENS` | — | Shared token(s) for bearer/query (**secret**) |
| `AUTH_HMAC_SECRET` | — | HMAC secret (**secret**) |
| `CORS_ORIGINS` | `*` | `*` or comma-separated origins |
| `CACHE_CONTROL` | long-lived immutable | Fallback when object has no Cache-Control |
| `ALLOWED_PREFIXES` | _(all)_ | e.g. `videos/,images/` |
| `DENIED_PREFIXES` | _(none)_ | e.g. `private/` |
| `KEY_PREFIX` | _(none)_ | Prepended to path → R2 key |
| `ENABLE_RANGE` | `true` | Honor Range requests |
| `ENABLE_HEALTHCHECK` | `true` | `/health`, `/healthz` |

See comments in `wrangler.toml` for the full list (`CORS_*`, `CACHE_CONTROL_OVERRIDE`, HMAC param names, etc.).

### Auth modes

- **`none`** — public via Worker; bucket still private
- **`bearer`** — `Authorization: Bearer <token>`
- **`query`** — `?token=<token>`
- **`hmac`** — `?exp=<unix>&sig=<hex>` where `sig = HMAC-SHA256(secret, "{key}\\n{exp}")`

```bash
npx wrangler secret put AUTH_TOKEN          # bearer / query
npx wrangler secret put AUTH_HMAC_SECRET    # hmac

npm run sign-url -- \
  --base https://streamboy.example.workers.dev \
  --key videos/abc123.mp4 \
  --secret "$AUTH_HMAC_SECRET" \
  --ttl 3600
```

## Use from your backend

Set the Worker URL in your **API** env (not in this Worker), then:

```ts
// DB stores: "videos/abc123.mp4"
const url = `${process.env.MEDIA_BASE_URL}/videos/abc123.mp4`;
// e.g. https://streamboy.xxx.workers.dev/videos/abc123.mp4
```

For `hmac`, append `exp` and `sig` (see `examples/sign-url.mjs`).

## Test

```bash
BASE=http://127.0.0.1:8787
curl -I "$BASE/videos/abc123.mp4"
curl -H "Range: bytes=0-1023" "$BASE/videos/abc123.mp4" -o partial.bin
curl -i "$BASE/videos/missing.mp4"   # 404
```

## Notes

- Bodies are streamed (safe for large files; do not buffer).
- Path traversal is rejected; optional prefix allow/deny lists apply after that.
- Extend `authorizeRequest` in `src/auth.ts` for custom auth.

MIT
