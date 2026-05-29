<div align="center">

# 🎨 Image Gen MCP

**A remote MCP server that lets Claude generate real images — right inside your chat.**

Connect it to Claude as a [custom connector](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
and ask Claude to create images for you. Every image is stored and returned as a
**public link**, so it drops straight into mockups, design artifacts, slides and docs.

Powered by [OpenRouter](https://openrouter.ai) — use **NanoBanana / Gemini Flash Image**,
**Flux**, **GPT Image**, **Seedream** and more, all behind one connector.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
![Node](https://img.shields.io/badge/node-22%20%7C%2024%20LTS-339933?logo=node.js&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-remote%20connector-6E56CF)

</div>

---

## ✨ Why

Claude is great at *designing* mockups, landing pages and UI concepts — but it
can only describe images, not produce them. This connector closes that gap:

- 🖼️ **Real images for mockups** — ask Claude to design a layout and have it fill
  in real hero images, icons, textures and product shots instead of grey
  placeholders.
- 🔗 **Public links, not just inline previews** — each generated image gets a
  stable URL you can paste into an artifact, a Figma frame, a slide or a PR.
- 🔌 **One connector, many models** — swap between chat-style image models
  (NanoBanana / Gemini Flash Image) and dedicated image models (Flux) with a
  single environment variable.
- ☁️ **Bring your own storage** — local disk by default, or **Cloudflare R2**
  for durable, CDN-served links.

## 🧠 Supported models

| Kind | Examples | How it's driven |
|------|----------|-----------------|
| **Chat-style image models** | `google/gemini-2.5-flash-image` (NanoBanana), `openai/gpt-5-image` | Chat models that *also* emit images → `modalities: ["image", "text"]` |
| **Dedicated image models** | `black-forest-labs/flux.2-pro`, `bytedance/seedream-4.5` | Pure image generators → `modalities: ["image"]` |

The model type is auto-detected from the model id and can be overridden — see
[Configuration](#%EF%B8%8F-configuration).

---

## 🚀 Quick start (self-hosting with Docker Compose)

```bash
git clone https://github.com/perzeuss/image-gen-mcp.git
cd image-gen-mcp
cp .env.example .env          # set OPENROUTER_API_KEY (and a MCP_AUTH_TOKEN)
docker compose up -d --build
```

The MCP endpoint is now at `http://localhost:3000/mcp`. Put it behind a reverse
proxy that terminates TLS (Caddy, nginx, Traefik, …) and set `PUBLIC_BASE_URL`
to your public `https://` URL so image links are stable.

Health check:

```bash
curl http://localhost:3000/health
# {"status":"ok","model":"google/gemini-2.5-flash-image","modelType":"chat","storage":"local"}
```

## ☁️ One-click deploy

Deploy the server to a managed host in a couple of clicks:

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new?referralCode=3vmRew)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/perzeuss/image-gen-mcp)
[![Deploy to DigitalOcean](https://www.deploytodo.com/do-btn-blue.svg)](https://cloud.digitalocean.com/apps/new?repo=https://github.com/perzeuss/image-gen-mcp/tree/main&refcode=d70dfee04695)

After the first deploy, set at least `OPENROUTER_API_KEY` (and ideally
`MCP_AUTH_TOKEN`) in the provider's environment settings, then point your Claude
connector at `https://<your-deployment-url>/mcp`.

---

## 🔌 Connect to Claude

1. In Claude, open **Settings → Connectors → Add custom connector**.
2. **Remote MCP server URL:** `https://<your-domain>/mcp`
3. If you set `MCP_AUTH_TOKEN`, configure the connector to send it as a bearer
   token.
4. Save, then start a chat and ask Claude to *“generate an image of …”*.

Anthropic's guide:
[Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

### Using it for mockups

> *“Design a landing page for a coffee subscription. Use the connector to
> generate a warm, photographic hero image (16:9) and three product shots, and
> embed the links in the mockup.”*

Claude calls `generate_image`, gets back public URLs, and drops the real images
straight into the artifact it's building.

---

## 🛠️ Tools

| Tool | Description |
|------|-------------|
| `generate_image` | Generate an image from a prompt. Params: `prompt` (required), `aspect_ratio`, `image_size`, `negative_prompt`, `seed`, `reference_image` (image-to-image). Returns the inline image **and** its public URL. |
| `get_image_model_info` | Report the configured model and how it's driven (chat vs. image). |

## ⚙️ Configuration

All configuration is via environment variables.

| Variable | Required | Default | Description |
|----------|:--------:|---------|-------------|
| `OPENROUTER_API_KEY` | ✅ | — | OpenRouter API key. |
| `IMAGE_MODEL` | | `google/gemini-2.5-flash-image` | OpenRouter model id. |
| `IMAGE_MODEL_TYPE` | | `auto` | `auto` \| `chat` \| `image`. `auto` detects from the model id (Flux/Recraft/Seedream/Riverflow/Ideogram/… ⇒ `image`, otherwise `chat`). |
| `PUBLIC_BASE_URL` | | _(request host)_ | Public base URL for **local** image links, e.g. `https://images.example.com`. Set this in production. |
| `PORT` | | `3000` | Listen port. |
| `HOST` | | `0.0.0.0` | Bind address. |
| `IMAGE_STORAGE_DIR` | | `./data/images` | Local storage directory (ignored when R2 is used). |
| `MCP_AUTH_TOKEN` | | _(none)_ | If set, `POST /mcp` requires `Authorization: Bearer <token>`. |
| `DEFAULT_ASPECT_RATIO` | | _(none)_ | Default aspect ratio when a request omits one. |
| `DEFAULT_IMAGE_SIZE` | | _(none)_ | Default image size (`1K`/`2K`/`4K`). |
| `REQUEST_TIMEOUT_MS` | | `120000` | OpenRouter request timeout. |
| `TRUST_PROXY` | | `true` | Trust `X-Forwarded-*` headers (keep on behind a proxy). |
| `MAX_BODY_SIZE` | | `25mb` | Max accepted request body size. |
| `RATE_LIMIT_MAX` | | `60` | Per-IP requests per window (`0` disables). |
| `RATE_LIMIT_WINDOW_MS` | | `60000` | Rate-limit window in ms. |
| `ALLOWED_ORIGINS` | | _(all)_ | Comma-separated `Origin` allow-list for `/mcp`. |

### Cloudflare R2 storage (optional, preferred when configured)

Set the `R2_*` variables to store images in **Cloudflare R2** and serve them
directly from Cloudflare instead of local disk. Setting any `R2_` variable
enables R2 and requires the full set below.

| Variable | Required | Description |
|----------|:--------:|-------------|
| `R2_BUCKET` | ✅ | R2 bucket name. |
| `R2_ACCESS_KEY_ID` | ✅ | R2 access key id. |
| `R2_SECRET_ACCESS_KEY` | ✅ | R2 secret access key. |
| `R2_ACCOUNT_ID` | ✅* | Cloudflare account id (endpoint derived as `https://<id>.r2.cloudflarestorage.com`). |
| `R2_ENDPOINT` | ✅* | Full S3 endpoint — alternative to `R2_ACCOUNT_ID`. |
| `R2_PUBLIC_BASE_URL` | ✅ | Public bucket/custom-domain URL, e.g. `https://images.example.com` or `https://pub-xxxx.r2.dev`. |
| `R2_KEY_PREFIX` | | Optional object key prefix (folder). |

> \* Provide either `R2_ACCOUNT_ID` **or** `R2_ENDPOINT`.

---

## 🧩 How it works

```
Claude  ──POST /mcp──▶  image-gen-mcp  ──▶  OpenRouter chat/completions
                              │
                              ├─ stores image:
                              │     • Cloudflare R2  (if R2_* configured) ──▶ served by Cloudflare
                              │     • local disk      (otherwise)         ──▶ GET /images/<file>
                              └─ returns inline image + public link
```

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/mcp` | Streamable-HTTP MCP endpoint (the connector URL). |
| `GET` | `/images/<file>` | Public, persisted images (local storage only). |
| `GET` | `/health` | Health check (reports model + active storage backend). |

## 🔒 Security

- **Path-traversal safe image serving** — filenames are validated against a
  strict allow-list plus a containment check, so `..` segments, encoded
  separators, absolute paths and null bytes can never escape the storage dir.
- **Security headers** via [Helmet](https://helmetjs.github.io/) and no
  `X-Powered-By` leak.
- **Rate limiting** per client IP to contain abuse and runaway cost
  (`RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`), with `/health` exempt.
- **Constant-time bearer-token check** (`MCP_AUTH_TOKEN`) to avoid timing
  attacks, plus an optional `Origin` allow-list (`ALLOWED_ORIGINS`).
- **Input validation** — bounded prompt/seed/aspect-ratio inputs and a body-size
  limit; `reference_image` is restricted to `http(s)` and `data:` image URLs.
- **Runs as a non-root user** in the container, behind `tini` for clean
  shutdowns, with graceful `SIGTERM`/`SIGINT` handling.

> **Note on the Claude connector:** Claude's custom-connector flow authenticates
> via OAuth and cannot send a static bearer token. For the Claude connector,
> leave `MCP_AUTH_TOKEN` empty and protect the endpoint at the network layer
> (e.g. Cloudflare Access, or a WAF rule allowing only Anthropic's IP ranges).
> `MCP_AUTH_TOKEN` is still useful for locking down direct/`curl` access.

## 🧪 Development

```bash
npm install
npm run build      # compile TypeScript to dist/
npm start          # run the server
npm test           # unit tests (Node test runner)
npm run typecheck  # type-only check
```

## 📄 License

[MIT](./LICENSE) © Pascal Malbranche
