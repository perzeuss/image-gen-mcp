import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import request from "supertest";

import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";

const ENV_KEYS = [
  "OPENROUTER_API_KEY",
  "IMAGE_MODEL",
  "IMAGE_MODEL_TYPE",
  "IMAGE_STORAGE_DIR",
  "PUBLIC_BASE_URL",
  "MCP_AUTH_TOKEN",
  "RATE_LIMIT_MAX",
  "RATE_LIMIT_WINDOW_MS",
  "ALLOWED_ORIGINS",
  "TRUST_PROXY",
  "OAUTH_PASSWORD",
  "OAUTH_ISSUER_URL",
  "OAUTH_SIGNING_SECRET",
  "OAUTH_ACCESS_TOKEN_TTL",
  "OAUTH_REFRESH_TOKEN_TTL",
  "UPLOAD_SIGNING_SECRET",
  "UPLOAD_URL_TTL_SECONDS",
  "MAX_UPLOAD_SIZE",
];

/** Build an app with a clean, controlled environment. */
async function buildApp(overrides: Record<string, string> = {}) {
  const saved = { ...process.env };
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.OPENROUTER_API_KEY = "sk-test";
  Object.assign(process.env, overrides);
  try {
    return await createApp(loadConfig());
  } finally {
    process.env = saved;
  }
}

async function tmpStorage(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "imggen-app-"));
}

const MCP_ACCEPT = "application/json, text/event-stream";

/** Extract the JSON-RPC payload from a Streamable-HTTP SSE response body. */
function parseSse(body: string): any {
  const line = body.split("\n").find((l) => l.startsWith("data:"));
  if (!line) throw new Error(`no data line in SSE response: ${body}`);
  return JSON.parse(line.slice("data:".length).trim());
}

function pkce(): { verifier: string; challenge: string } {
  const verifier =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

describe("app: open mode", () => {
  it("reports health with the active configuration", async () => {
    const { app } = await buildApp({ RATE_LIMIT_MAX: "0" });
    const res = await request(app).get("/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
    assert.equal(res.body.auth, "open");
    assert.equal(res.body.storage, "local");
  });

  it("serves a stored image and rejects traversal", async () => {
    const dir = await tmpStorage();
    await writeFile(path.join(dir, "1700000000000-abcd1234.png"), "PNGBYTES");
    const { app } = await buildApp({
      RATE_LIMIT_MAX: "0",
      IMAGE_STORAGE_DIR: dir,
    });

    const ok = await request(app)
      .get("/images/1700000000000-abcd1234.png")
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    assert.equal(ok.status, 200);
    assert.match(ok.headers["content-type"], /image\/png/);
    assert.equal((ok.body as Buffer).toString(), "PNGBYTES");

    const bad = await request(app).get("/images/not-allowed!.txt");
    assert.equal(bad.status, 400);

    const missing = await request(app).get(
      "/images/1111111111111-deadbeef.png",
    );
    assert.equal(missing.status, 404);
  });

  it("lists tools without auth", async () => {
    const { app } = await buildApp({ RATE_LIMIT_MAX: "0" });
    const res = await request(app)
      .post("/mcp")
      .set("Accept", MCP_ACCEPT)
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    assert.equal(res.status, 200);
    const tools = parseSse(res.text).result.tools.map((t: any) => t.name);
    assert.ok(tools.includes("generate_image"));
    assert.ok(tools.includes("get_image_model_info"));
    assert.ok(tools.includes("create_upload_url"));
  });

  it("generates an image, stores it and returns a public link", async () => {
    const dir = await tmpStorage();
    const { app } = await buildApp({
      RATE_LIMIT_MAX: "0",
      IMAGE_STORAGE_DIR: dir,
    });

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init: any) => {
      if (String(url).includes("openrouter.ai")) {
        const dataUrl = `data:image/png;base64,${Buffer.from("IMG").toString("base64")}`;
        const payload = {
          choices: [
            {
              message: {
                content: "a generated image",
                images: [{ image_url: { url: dataUrl } }],
              },
            },
          ],
        };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return realFetch(url, init);
    }) as typeof fetch;

    try {
      const res = await request(app)
        .post("/mcp")
        .set("Accept", MCP_ACCEPT)
        .send({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "generate_image",
            arguments: { prompt: "a red fox", aspect_ratio: "16:9" },
          },
        });
      assert.equal(res.status, 200);
      const result = parseSse(res.text).result;
      const types = result.content.map((c: any) => c.type);
      assert.ok(types.includes("image"));
      const text = result.content.find((c: any) => c.type === "text").text;
      assert.match(text, /\/images\//);
    } finally {
      globalThis.fetch = realFetch;
    }

    const files = await readdir(dir);
    assert.equal(files.length, 1);
    assert.match(files[0], /\.png$/);
  });

  it("forwards reference images to OpenRouter for image-to-image", async () => {
    const dir = await tmpStorage();
    const { app } = await buildApp({
      RATE_LIMIT_MAX: "0",
      IMAGE_STORAGE_DIR: dir,
    });

    let sentBody: any;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: any, init: any) => {
      if (String(url).includes("openrouter.ai")) {
        sentBody = JSON.parse(init.body);
        const dataUrl = `data:image/png;base64,${Buffer.from("EDITED").toString("base64")}`;
        const payload = {
          choices: [{ message: { images: [{ image_url: { url: dataUrl } }] } }],
        };
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return realFetch(url, init);
    }) as typeof fetch;

    const refs = [
      "https://example.com/subject.png",
      `data:image/png;base64,${Buffer.from("REF").toString("base64")}`,
    ];

    try {
      const res = await request(app)
        .post("/mcp")
        .set("Accept", MCP_ACCEPT)
        .send({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "generate_image",
            arguments: {
              prompt: "turn the subject into a watercolor painting",
              negative_prompt: "text, watermarks",
              reference_images: refs,
            },
          },
        });
      assert.equal(res.status, 200);
      const result = parseSse(res.text).result;
      assert.notEqual(result.isError, true);
      assert.ok(result.content.some((c: any) => c.type === "image"));

      // The prompt and both reference images share one multimodal message.
      const content = sentBody.messages[0].content;
      assert.equal(content[0].type, "text");
      assert.deepEqual(
        content.slice(1).map((p: any) => p.image_url.url),
        refs,
      );
      // The negative prompt is not dropped in img2img mode.
      assert.match(JSON.stringify(sentBody.messages[1]), /negative prompt/i);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("rejects disallowed reference image schemes", async () => {
    const { app } = await buildApp({ RATE_LIMIT_MAX: "0" });
    const res = await request(app)
      .post("/mcp")
      .set("Accept", MCP_ACCEPT)
      .send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "generate_image",
          arguments: {
            prompt: "a fox",
            reference_images: ["file:///etc/passwd"],
          },
        },
      });
    assert.equal(res.status, 200);
    const result = parseSse(res.text).result;
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /http\(s\) URL or a data: image URL/);
  });
});

describe("app: reference image uploads", () => {
  /** Minimal but byte-signature-valid PNG payload (not a decodable image, just correct magic bytes). */
  function pngBytes(): Buffer {
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("not a real png but has the right signature"),
    ]);
  }

  async function createUploadUrl(app: any): Promise<string> {
    const res = await request(app)
      .post("/mcp")
      .set("Accept", MCP_ACCEPT)
      .send({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "create_upload_url", arguments: {} },
      });
    assert.equal(res.status, 200);
    const result = parseSse(res.text).result;
    assert.notEqual(result.isError, true);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.uploads.length, 1);
    return payload.uploads[0].upload_url as string;
  }

  it("creates upload URLs and accepts a real image upload", async () => {
    const dir = await tmpStorage();
    const { app } = await buildApp({
      RATE_LIMIT_MAX: "0",
      IMAGE_STORAGE_DIR: dir,
    });

    const uploadUrl = await createUploadUrl(app);
    const uploadPath = new URL(uploadUrl, "http://localhost").pathname;

    const res = await request(app)
      .put(uploadPath)
      .set("Content-Type", "image/png")
      .send(pngBytes());
    assert.equal(res.status, 200);
    assert.match(res.body.url, /\/images\/.+\.png$/);

    const files = await readdir(dir);
    assert.equal(files.length, 1);
    assert.match(files[0], /\.png$/);
  });

  it("supports creating several upload URLs at once", async () => {
    const { app } = await buildApp({ RATE_LIMIT_MAX: "0" });
    const res = await request(app)
      .post("/mcp")
      .set("Accept", MCP_ACCEPT)
      .send({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "create_upload_url", arguments: { count: 3 } },
      });
    const result = parseSse(res.text).result;
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.uploads.length, 3);
    const urls = payload.uploads.map((u: any) => u.upload_url);
    assert.equal(new Set(urls).size, 3);
  });

  it("rejects an invalid or unsigned token", async () => {
    const { app } = await buildApp({ RATE_LIMIT_MAX: "0" });
    const res = await request(app)
      .put("/uploads/not-a-real-token")
      .set("Content-Type", "image/png")
      .send(pngBytes());
    assert.equal(res.status, 401);
  });

  it("rejects an expired upload URL", async () => {
    const { app } = await buildApp({
      RATE_LIMIT_MAX: "0",
      UPLOAD_URL_TTL_SECONDS: "-5",
    });
    const uploadUrl = await createUploadUrl(app);
    const uploadPath = new URL(uploadUrl, "http://localhost").pathname;
    const res = await request(app)
      .put(uploadPath)
      .set("Content-Type", "image/png")
      .send(pngBytes());
    assert.equal(res.status, 401);
  });

  it("rejects a disallowed content type", async () => {
    const { app } = await buildApp({ RATE_LIMIT_MAX: "0" });
    const uploadUrl = await createUploadUrl(app);
    const uploadPath = new URL(uploadUrl, "http://localhost").pathname;
    const res = await request(app)
      .put(uploadPath)
      .set("Content-Type", "text/plain")
      .send(Buffer.from("hello"));
    assert.equal(res.status, 415);
  });

  it("rejects bytes that don't match the declared image type (spoofed Content-Type)", async () => {
    const { app } = await buildApp({ RATE_LIMIT_MAX: "0" });
    const uploadUrl = await createUploadUrl(app);
    const uploadPath = new URL(uploadUrl, "http://localhost").pathname;
    const res = await request(app)
      .put(uploadPath)
      .set("Content-Type", "image/png")
      .send(Buffer.from("this is definitely not a png"));
    assert.equal(res.status, 415);
  });

  it("rejects an empty upload body", async () => {
    const { app } = await buildApp({ RATE_LIMIT_MAX: "0" });
    const uploadUrl = await createUploadUrl(app);
    const uploadPath = new URL(uploadUrl, "http://localhost").pathname;
    const res = await request(app)
      .put(uploadPath)
      .set("Content-Type", "image/png")
      .send(Buffer.alloc(0));
    assert.equal(res.status, 400);
  });
});

describe("app: rate limiting", () => {
  it("returns 429 once the per-IP limit is exceeded", async () => {
    const { app } = await buildApp({
      RATE_LIMIT_MAX: "2",
      RATE_LIMIT_WINDOW_MS: "60000",
    });
    const call = () =>
      request(app)
        .post("/mcp")
        .set("Accept", MCP_ACCEPT)
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    assert.equal((await call()).status, 200);
    assert.equal((await call()).status, 200);
    assert.equal((await call()).status, 429);
  });
});

describe("app: static token mode", () => {
  it("requires the bearer token", async () => {
    const { app, authMode } = await buildApp({
      RATE_LIMIT_MAX: "0",
      MCP_AUTH_TOKEN: "s3cret",
    });
    assert.equal(authMode, "token");

    const noAuth = await request(app)
      .post("/mcp")
      .set("Accept", MCP_ACCEPT)
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    assert.equal(noAuth.status, 401);

    const withAuth = await request(app)
      .post("/mcp")
      .set("Accept", MCP_ACCEPT)
      .set("Authorization", "Bearer s3cret")
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    assert.equal(withAuth.status, 200);
  });
});

describe("app: OAuth mode", () => {
  const oauthEnv = {
    RATE_LIMIT_MAX: "0",
    OAUTH_PASSWORD: "hunter2",
    OAUTH_ISSUER_URL: "http://localhost",
    OAUTH_SIGNING_SECRET: "test-secret",
  };

  it("advertises discovery metadata", async () => {
    const { app } = await buildApp(oauthEnv);
    const as = await request(app).get(
      "/.well-known/oauth-authorization-server",
    );
    assert.equal(as.status, 200);
    assert.deepEqual(as.body.code_challenge_methods_supported, ["S256"]);

    const prm = await request(app).get(
      "/.well-known/oauth-protected-resource/mcp",
    );
    assert.equal(prm.status, 200);
    assert.match(prm.body.resource, /\/mcp$/);
  });

  it("rejects unauthenticated /mcp with a WWW-Authenticate challenge", async () => {
    const { app } = await buildApp(oauthEnv);
    const res = await request(app)
      .post("/mcp")
      .set("Accept", MCP_ACCEPT)
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    assert.equal(res.status, 401);
    assert.match(res.headers["www-authenticate"], /resource_metadata=/);
  });

  it("completes the full authorization-code + PKCE flow", async () => {
    const { app } = await buildApp(oauthEnv);
    const { verifier, challenge } = pkce();
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";

    // 1. Dynamic client registration.
    const reg = await request(app)
      .post("/register")
      .send({
        client_name: "Test",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      });
    assert.equal(reg.status, 201);
    const clientId = reg.body.client_id;
    assert.ok(clientId);

    // 2. Authorize (consent screen) -> submit password -> redirect with code.
    const authRes = await request(app).post("/authorize").type("form").send({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
      password: "hunter2",
    });
    assert.equal(authRes.status, 302);
    const location = new URL(authRes.headers.location);
    const code = location.searchParams.get("code");
    assert.ok(code);
    assert.equal(location.searchParams.get("state"), "xyz");

    // 3. Exchange the code for tokens (with the PKCE verifier).
    const tokenRes = await request(app).post("/token").type("form").send({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    });
    assert.equal(tokenRes.status, 200);
    const accessToken = tokenRes.body.access_token;
    assert.ok(accessToken);

    // 4. Call /mcp with the access token.
    const mcp = await request(app)
      .post("/mcp")
      .set("Accept", MCP_ACCEPT)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    assert.equal(mcp.status, 200);
    assert.ok(parseSse(mcp.text).result.tools.length > 0);

    // Wrong password is rejected.
    const wrong = await request(app).post("/authorize").type("form").send({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      password: "nope",
    });
    assert.equal(wrong.status, 401);
  });
});
