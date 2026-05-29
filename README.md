# image-gen-mcp

A remote **MCP server** for the [OpenRouter](https://openrouter.ai) image
generation API. Use it as a **Claude custom connector** to generate images
directly from a chat. Every generated image is **stored on the server** and
served back as a **public link** (in addition to being shown inline).

- Works with **chat-style image models** (e.g. *NanoBanana* / Google
  Gemini Flash Image, GPT image models) — these are chat models that emit
  images, driven with `modalities: ["image", "text"]`.
- Works with **pure image-generation models** (e.g. *Flux*) — driven with
  `modalities: ["image"]`.
- Fully configured through **environment variables** — ready to deploy with
  **Docker Compose / Dokploy**.

---

## How it works

```
Claude  ──POST /mcp──▶  image-gen-mcp  ──▶  OpenRouter chat/completions
                              │
                              ├─ stores image:
                              │     • Cloudflare R2  (if R2_* configured)  ──▶ served by Cloudflare
                              │     • local disk      (otherwise)          ──▶ GET /images/<file>
                              └─ returns inline image + public link
```

The server exposes a single Streamable-HTTP MCP endpoint at `POST /mcp`. With
local storage it also serves images at `GET /images/<file>`; with R2 the links
point at Cloudflare directly.

The image-serving route validates filenames against a strict allow-list (it
never passes user input to the filesystem unchecked), so path-traversal
attempts — `..` segments, encoded separators, absolute paths, null bytes —
cannot escape the storage directory.

### Tools

| Tool | Description |
|------|-------------|
| `generate_image` | Generate an image from a prompt. Params: `prompt` (required), `aspect_ratio`, `image_size`, `negative_prompt`, `seed`, `reference_image` (image-to-image). Returns the inline image **and** its public URL. |
| `get_image_model_info` | Report the configured model and how it is driven (chat vs. image). |

---

## Configuration (environment variables)

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

### Cloudflare R2 storage (optional, preferred when configured)

If the `R2_*` variables are set, images are uploaded to **Cloudflare R2** and
served directly by Cloudflare instead of from local disk. Setting any `R2_`
variable enables R2 and requires the full set below.

| Variable | Required | Description |
|----------|:--------:|-------------|
| `R2_BUCKET` | ✅ | R2 bucket name. |
| `R2_ACCESS_KEY_ID` | ✅ | R2 access key id. |
| `R2_SECRET_ACCESS_KEY` | ✅ | R2 secret access key. |
| `R2_ACCOUNT_ID` | ✅* | Cloudflare account id (endpoint derived as `https://<id>.r2.cloudflarestorage.com`). |
| `R2_ENDPOINT` | ✅* | Full S3 endpoint — alternative to `R2_ACCOUNT_ID`. |
| `R2_PUBLIC_BASE_URL` | ✅ | Public bucket/custom-domain URL used to build links, e.g. `https://images.example.com` or `https://pub-xxxx.r2.dev`. |
| `R2_KEY_PREFIX` | | Optional object key prefix (folder). |

> \* Provide either `R2_ACCOUNT_ID` **or** `R2_ENDPOINT`.

> **Chat vs. image model:** if you point `IMAGE_MODEL` at a pure image model
> such as `black-forest-labs/flux.2-pro`, `auto` detection selects
> `modalities: ["image"]`. For chat-image models such as
> `google/gemini-2.5-flash-image` it selects `["image", "text"]`. Override with
> `IMAGE_MODEL_TYPE` if your model isn't recognised.

---

## Run locally

```bash
npm install
npm run build

export OPENROUTER_API_KEY=sk-or-v1-...
export IMAGE_MODEL=google/gemini-2.5-flash-image
npm start
# → POST http://localhost:3000/mcp
```

Quick check:

```bash
curl http://localhost:3000/health
```

## Tests

Unit tests (config/model detection, data-URL parsing, modality selection,
storage backends, path-traversal protection) run with the Node test runner:

```bash
npm test
npm run typecheck
```

---

## Deploy with Docker Compose / Dokploy

1. Push this repository to GitHub.
2. In **Dokploy**, create a **Compose** application pointing at the repo
   (the included `docker-compose.yml` builds from the `Dockerfile`).
3. Set the environment variables in Dokploy's **Environment** tab — at minimum
   `OPENROUTER_API_KEY`, `IMAGE_MODEL`, and (recommended) `MCP_AUTH_TOKEN`.
4. Attach a **domain** to the `image-gen-mcp` service in the Dokploy UI.
   Dokploy provisions TLS and routes the domain to port `3000` via Traefik.
5. Set `PUBLIC_BASE_URL` to that domain (e.g. `https://images.example.com`) so
   the shared image links are stable across redeploys.

Generated images persist in the `image-data` Docker volume.

Local Compose run:

```bash
cp .env.example .env   # fill in OPENROUTER_API_KEY etc.
docker compose up --build
```

---

## Add as a Claude custom connector

In Claude, go to **Settings → Connectors → Add custom connector** and enter:

- **Remote MCP server URL:** `https://<your-domain>/mcp`
- If you set `MCP_AUTH_TOKEN`, configure the connector to send it as a
  bearer token.

See Anthropic's guide:
[Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

Then ask Claude to *"generate an image of …"* — it will call `generate_image`,
show the image inline, and include the public link.

---

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/mcp` | Streamable-HTTP MCP endpoint (connector URL). |
| `GET` | `/images/<file>` | Public, persisted images (local storage only). |
| `GET` | `/health` | Health check (reports model + active storage backend). |

## License

MIT
