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

import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { loadConfig } from "./config.js";
import { OpenRouterClient } from "./openrouter.js";
import { ImageStore } from "./storage.js";
import { buildMcpServer } from "./mcp.js";

async function main() {
  const config = loadConfig();
  const client = new OpenRouterClient(config);
  const store = new ImageStore(config);
  await store.init();

  const app = express();
  app.use(express.json({ limit: "25mb" }));

  // Resolve the externally reachable origin for a request, honouring reverse
  // proxies (Dokploy / Traefik set x-forwarded-* headers).
  const requestOrigin = (req: Request): string => {
    const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] || req.protocol;
    const host = (req.headers["x-forwarded-host"] as string)?.split(",")[0] || req.headers.host;
    return host ? `${proto}://${host}` : "";
  };

  // Optional bearer-token protection for the MCP endpoint.
  const checkAuth = (req: Request, res: Response): boolean => {
    if (!config.authToken) return true;
    const header = req.headers.authorization || "";
    const token = header.replace(/^Bearer\s+/i, "").trim();
    if (token === config.authToken) return true;
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
    return false;
  };

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", model: config.imageModel, modelType: config.modelType });
  });

  // Publicly served generated images.
  app.use(
    "/images",
    express.static(config.storageDir, {
      maxAge: "7d",
      index: false,
    }),
  );
  app.use("/images", (_req, res) => {
    res.status(404).json({ error: "Image not found" });
  });

  // Stateless Streamable HTTP MCP endpoint.
  app.post("/mcp", async (req: Request, res: Response) => {
    if (!checkAuth(req, res)) return;
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

  app.listen(config.port, config.host, () => {
    console.log(
      `image-gen-mcp listening on http://${config.host}:${config.port}`,
    );
    console.log(`  MCP endpoint:   POST /mcp`);
    console.log(`  Images served:  GET  /images/<file>`);
    console.log(`  Model:          ${config.imageModel} (${config.modelType})`);
    if (config.publicBaseUrl) {
      console.log(`  Public base:    ${config.publicBaseUrl}`);
    } else {
      console.log(
        "  Public base:    (derived from request host — set PUBLIC_BASE_URL for stable links)",
      );
    }
    if (config.authToken) {
      console.log("  Auth:           bearer token required");
    }
  });
}

main().catch((err) => {
  console.error("Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
