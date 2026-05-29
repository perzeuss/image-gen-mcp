#!/usr/bin/env node
/**
 * Remote MCP server for OpenRouter image generation.
 *
 * Exposes:
 *   - POST /mcp        Streamable HTTP MCP endpoint (use this URL as the
 *                      Claude custom connector URL).
 *   - GET  /images/*   Static hosting of generated images (public links).
 *   - GET  /health     Health check.
 */

import express, {
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";

import { loadConfig } from "./config.js";
import { OpenRouterClient } from "./openrouter.js";
import { ImageStore } from "./storage.js";
import { createStorage } from "./r2.js";
import { buildMcpServer } from "./mcp.js";
import { StatelessOAuthProvider } from "./oauth.js";
import { isOriginAllowed, safeStrEqual } from "./security.js";

async function main() {
  const config = loadConfig();
  const client = new OpenRouterClient(config);
  const store = createStorage(config, () => new ImageStore(config));
  await store.init();

  const app = express();
  // Don't advertise the framework.
  app.disable("x-powered-by");
  // Honour X-Forwarded-* from the reverse proxy (needed for correct client IPs
  // in rate limiting and for building public links behind TLS termination).
  app.set("trust proxy", config.trustProxy);

  // Security headers. This is a JSON/image API (no HTML), so CSP is disabled,
  // but images must remain embeddable cross-origin (Claude, docs, mockups).
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    }),
  );

  app.use(express.json({ limit: config.maxBodySize }));

  // Per-IP rate limiting to contain abuse / runaway cost (0 = disabled).
  if (config.rateLimitMax > 0) {
    app.use(
      rateLimit({
        windowMs: config.rateLimitWindowMs,
        max: config.rateLimitMax,
        standardHeaders: true,
        legacyHeaders: false,
        // Don't rate-limit health checks from orchestrators / uptime monitors.
        skip: (req) => req.path === "/health",
        message: {
          jsonrpc: "2.0",
          error: { code: -32029, message: "Too many requests" },
          id: null,
        },
      }),
    );
  }

  // Log OAuth-related requests so connector setup issues are diagnosable.
  // Registered before the auth router so it observes those requests.
  app.use((req, res, next) => {
    const path = req.path; // capture now; nested routers rewrite req.url later
    if (
      path === "/register" ||
      path === "/authorize" ||
      path === "/token" ||
      path.startsWith("/.well-known/")
    ) {
      const method = req.method;
      res.on("finish", () =>
        console.log(`[oauth] ${method} ${path} -> ${res.statusCode}`),
      );
    }
    next();
  });

  // Resolve the externally reachable origin for a request, honouring reverse
  // proxies (Traefik, nginx, ... set x-forwarded-* headers).
  const requestOrigin = (req: Request): string => {
    const proto =
      (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol;
    const host =
      (req.headers["x-forwarded-host"] as string)?.split(",")[0] ||
      req.headers.host;
    return host ? `${proto}://${host}` : "";
  };

  // Origin allow-list guard (applies regardless of the auth scheme).
  const originGuard: RequestHandler = (req, res, next) => {
    const origin = req.headers.origin as string | undefined;
    if (!isOriginAllowed(origin, config.allowedOrigins ?? [])) {
      res.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32003, message: "Forbidden origin" },
        id: null,
      });
      return;
    }
    next();
  };

  // Legacy static bearer-token guard (used only when OAuth is disabled).
  const staticTokenGuard: RequestHandler = (req, res, next) => {
    if (!config.authToken) return next();
    const header = req.headers.authorization || "";
    const token = header.replace(/^Bearer\s+/i, "").trim();
    if (!token || !safeStrEqual(token, config.authToken)) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized" },
        id: null,
      });
      return;
    }
    next();
  };

  // Choose the auth scheme: full OAuth 2.1 (for Claude connectors) when
  // OAUTH_PASSWORD is set, otherwise the optional static token / open access.
  let authMode: "oauth" | "token" | "open";
  let mcpGuards: RequestHandler[];
  if (config.oauth) {
    const provider = new StatelessOAuthProvider(config.oauth);
    const issuerUrl = new URL(config.oauth.issuerUrl);
    const isLocal =
      issuerUrl.hostname === "localhost" || issuerUrl.hostname === "127.0.0.1";
    if (issuerUrl.protocol !== "https:" && !isLocal) {
      throw new Error(
        `OAuth issuer URL must be https (got "${config.oauth.issuerUrl}"). ` +
          "Set OAUTH_ISSUER_URL / PUBLIC_BASE_URL to your public https URL.",
      );
    }
    const resourceServerUrl = new URL("/mcp", issuerUrl);
    // Mount discovery, dynamic client registration, /authorize and /token.
    // resourceServerUrl makes the protected-resource metadata served at
    // /.well-known/oauth-protected-resource/mcp, matching the WWW-Authenticate
    // header below.
    app.use(
      mcpAuthRouter({
        provider,
        issuerUrl,
        resourceServerUrl,
        scopesSupported: [],
        resourceName: "Image Gen MCP",
      }),
    );
    const resourceMetadataUrl =
      getOAuthProtectedResourceMetadataUrl(resourceServerUrl);
    mcpGuards = [
      originGuard,
      requireBearerAuth({ verifier: provider, resourceMetadataUrl }),
    ];
    authMode = "oauth";
  } else {
    mcpGuards = [originGuard, staticTokenGuard];
    authMode = config.authToken ? "token" : "open";
  }

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      model: config.imageModel,
      modelType: config.modelType,
      storage: store.kind,
      auth: authMode,
      oauthIssuer: config.oauth?.issuerUrl,
    });
  });

  // Local storage is served by this server. R2-backed images are served
  // directly by Cloudflare, so the route is only registered for local disk.
  if (store instanceof ImageStore) {
    const localStore = store;
    // We resolve the filename through a strict allow-list
    // (ImageStore.resolveSafe) instead of express.static so that
    // path-traversal attempts (".." segments, encoded separators, absolute
    // paths, null bytes) can never escape the storage directory.
    app.get("/images/:filename", (req, res) => {
      const absolutePath = localStore.resolveSafe(req.params.filename);
      if (!absolutePath) {
        res.status(400).json({ error: "Invalid image name" });
        return;
      }
      res.sendFile(absolutePath, { maxAge: "7d", dotfiles: "deny" }, (err) => {
        if (err && !res.headersSent) {
          res.status(404).json({ error: "Image not found" });
        }
      });
    });
  }

  // Stateless Streamable HTTP MCP endpoint.
  app.post("/mcp", ...mcpGuards, async (req: Request, res: Response) => {
    try {
      const server = buildMcpServer({
        config,
        client,
        store,
        requestOrigin: requestOrigin(req),
      });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[mcp] request failed:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Stateless mode does not support server-initiated streams / sessions.
  const methodNotAllowed = (_req: Request, res: Response) => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  const server = app.listen(config.port, config.host, () => {
    console.log(
      `image-gen-mcp listening on http://${config.host}:${config.port}`,
    );
    console.log(`  MCP endpoint:   POST /mcp`);
    console.log(`  Model:          ${config.imageModel} (${config.modelType})`);
    if (store.kind === "r2") {
      console.log(`  Storage:        Cloudflare R2 (${config.r2!.bucket})`);
      console.log(`  Public base:    ${config.r2!.publicBaseUrl}`);
    } else {
      console.log(`  Storage:        local disk (${config.storageDir})`);
      console.log(`  Images served:  GET  /images/<file>`);
      if (config.publicBaseUrl) {
        console.log(`  Public base:    ${config.publicBaseUrl}`);
      } else {
        console.log(
          "  Public base:    (derived from request host — set PUBLIC_BASE_URL for stable links)",
        );
      }
    }
    const authLabel = {
      oauth: `OAuth 2.1 (issuer ${config.oauth?.issuerUrl})`,
      token: "static bearer token",
      open: "open (no auth)",
    }[authMode];
    console.log(`  Auth:           ${authLabel}`);
    console.log(
      `  Rate limit:     ${config.rateLimitMax > 0 ? `${config.rateLimitMax}/${config.rateLimitWindowMs}ms per IP` : "disabled"}`,
    );
  });

  // Graceful shutdown so in-flight requests can finish on redeploys.
  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
