/**
 * Central configuration, loaded entirely from environment variables so the
 * server can be configured for any deployment (Docker, local, managed hosts)
 * without code changes.
 */

import { randomBytes } from "node:crypto";

import { parseList } from "./security.js";

export type ModelType = "chat" | "image";

/**
 * OAuth 2.1 authorization-server configuration. Enabled by setting
 * OAUTH_PASSWORD; required for using the server as a Claude custom connector
 * (Claude authenticates connectors via OAuth + dynamic client registration).
 */
export interface OAuthConfig {
  /** Public HTTPS issuer/base URL of this server (also the resource id). */
  issuerUrl: string;
  /** Shared password the user enters on the consent screen. */
  password: string;
  /** HMAC secret used to sign stateless authorization codes and tokens. */
  signingSecret: string;
  /** Access-token lifetime in seconds. */
  accessTokenTtl: number;
  /** Refresh-token lifetime in seconds. */
  refreshTokenTtl: number;
}

/** Cloudflare R2 storage configuration (S3-compatible). */
export interface R2Config {
  /** S3-compatible endpoint, e.g. https://<account>.r2.cloudflarestorage.com */
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Public base URL for the bucket / custom domain used to build image links. */
  publicBaseUrl: string;
  /** Optional key prefix (folder) for stored objects. */
  keyPrefix?: string;
}

export interface Config {
  /** OpenRouter API key used for all upstream requests. */
  openRouterApiKey: string;
  /** Model id on OpenRouter, e.g. "google/gemini-2.5-flash-image" or "black-forest-labs/flux.2-pro". */
  imageModel: string;
  /**
   * How the configured model is driven:
   *  - "chat":  a chat model that also emits images (NanoBanana / Gemini Flash Image,
   *             GPT image models, ...) -> modalities ["image", "text"]
   *  - "image": a pure image-generation model (Flux, ...) -> modalities ["image"]
   */
  modelType: ModelType;
  /** HTTP port the server listens on. */
  port: number;
  /** Host/interface to bind to. */
  host: string;
  /** Directory where generated images are persisted. */
  storageDir: string;
  /**
   * Public base URL under which stored images are reachable, e.g.
   * "https://images.example.com". Used to build the shareable public link.
   * If unset, links fall back to the request's own host.
   */
  publicBaseUrl?: string;
  /** Optional bearer token. If set, every MCP request must send it. */
  authToken?: string;
  /** Optional default aspect ratio applied when a request omits one. */
  defaultAspectRatio?: string;
  /** Optional default image size (e.g. "1K", "2K", "4K"). */
  defaultImageSize?: string;
  /** Request timeout for OpenRouter calls, in milliseconds. */
  requestTimeoutMs: number;
  /**
   * When set, generated images are stored in Cloudflare R2 (preferred over the
   * local disk). Configured via the R2_* environment variables.
   */
  r2?: R2Config;

  // --- Security / hardening ---
  /**
   * Express "trust proxy" setting. A number of proxy hops to trust (default 1,
   * suitable for a single reverse proxy) is recommended over `true`, which is
   * permissive and lets clients spoof X-Forwarded-For to bypass rate limiting.
   */
  trustProxy: boolean | number;
  /** Max accepted JSON request body size (Express byte-size string). */
  maxBodySize: string;
  /** Rate-limit window in milliseconds. */
  rateLimitWindowMs: number;
  /** Max requests per window per client IP (0 disables rate limiting). */
  rateLimitMax: number;
  /** Optional allow-list of request Origin headers for the MCP endpoint. */
  allowedOrigins?: string[];
  /** OAuth authorization server, enabled when OAUTH_PASSWORD is set. */
  oauth?: OAuthConfig;

  // --- Reference-image uploads ---
  /**
   * HMAC secret used to sign short-lived reference-image upload URLs (see
   * PUT /uploads/:token). Auto-generated (ephemeral) if unset.
   */
  uploadSigningSecret: string;
  /** Lifetime of a reference-image upload URL, in seconds. */
  uploadUrlTtlSeconds: number;
  /** Max accepted size for a single reference-image upload (Express byte-size string). */
  maxUploadSize: string;
}

/** Model id fragments that identify pure image-generation models. */
const PURE_IMAGE_HINTS = [
  "flux",
  "recraft",
  "sourceful",
  "seedream",
  "riverflow",
  "ideogram",
  "stable-diffusion",
  "sdxl",
];

/**
 * Best-effort detection of the model type from its id. Falls back to "chat"
 * because most image-capable models on OpenRouter are chat models, and the
 * ["image", "text"] modality is the most widely accepted.
 */
export function detectModelType(modelId: string): ModelType {
  const id = modelId.toLowerCase();
  if (PURE_IMAGE_HINTS.some((hint) => id.includes(hint))) {
    return "image";
  }
  return "chat";
}

function readModelType(modelId: string): ModelType {
  const raw = (process.env.IMAGE_MODEL_TYPE || "auto").trim().toLowerCase();
  if (raw === "chat" || raw === "image") {
    return raw;
  }
  if (raw !== "auto" && raw !== "") {
    console.warn(
      `[config] Unknown IMAGE_MODEL_TYPE="${raw}", falling back to auto-detection.`,
    );
  }
  return detectModelType(modelId);
}

/**
 * Build the R2 configuration if any R2_* variable is present. R2 is considered
 * "intended" as soon as one of its variables is set; in that case the full set
 * is validated so misconfiguration fails loudly instead of silently falling
 * back to local disk.
 */
export function readR2Config(): R2Config | undefined {
  const bucket = process.env.R2_BUCKET?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const endpoint = process.env.R2_ENDPOINT?.trim();
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim().replace(
    /\/+$/,
    "",
  );
  const keyPrefix = process.env.R2_KEY_PREFIX?.trim().replace(/^\/+|\/+$/g, "");

  const anySet = Boolean(
    bucket ||
    accessKeyId ||
    secretAccessKey ||
    accountId ||
    endpoint ||
    publicBaseUrl,
  );
  if (!anySet) return undefined;

  const resolvedEndpoint =
    endpoint ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

  const missing: string[] = [];
  if (!bucket) missing.push("R2_BUCKET");
  if (!accessKeyId) missing.push("R2_ACCESS_KEY_ID");
  if (!secretAccessKey) missing.push("R2_SECRET_ACCESS_KEY");
  if (!resolvedEndpoint) missing.push("R2_ENDPOINT or R2_ACCOUNT_ID");
  if (!publicBaseUrl) missing.push("R2_PUBLIC_BASE_URL");
  if (missing.length > 0) {
    throw new Error(
      `Cloudflare R2 is partially configured. Missing: ${missing.join(", ")}.`,
    );
  }

  return {
    endpoint: resolvedEndpoint!.replace(/\/+$/, ""),
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    bucket: bucket!,
    publicBaseUrl: publicBaseUrl!,
    keyPrefix: keyPrefix || undefined,
  };
}

/**
 * Build the OAuth config when OAUTH_PASSWORD is set. Requires a public HTTPS
 * issuer URL (OAUTH_ISSUER_URL or PUBLIC_BASE_URL). Fails loudly on
 * misconfiguration instead of silently leaving the connector unauthenticated.
 */
export function readOAuthConfig(): OAuthConfig | undefined {
  const password = process.env.OAUTH_PASSWORD?.trim();
  if (!password) return undefined;

  const issuerUrl = (
    process.env.OAUTH_ISSUER_URL ||
    process.env.PUBLIC_BASE_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (!issuerUrl) {
    throw new Error(
      "OAuth is enabled (OAUTH_PASSWORD set) but no issuer URL is configured. " +
        "Set OAUTH_ISSUER_URL (or PUBLIC_BASE_URL) to this server's public URL.",
    );
  }

  let signingSecret = process.env.OAUTH_SIGNING_SECRET?.trim();
  if (!signingSecret) {
    signingSecret = randomBytes(32).toString("hex");
    console.warn(
      "[config] OAUTH_SIGNING_SECRET not set — generated an ephemeral one. " +
        "Existing tokens are invalidated on restart and multiple instances " +
        "won't share tokens. Set OAUTH_SIGNING_SECRET for production.",
    );
  }

  return {
    issuerUrl,
    password,
    signingSecret,
    accessTokenTtl: Number.parseInt(
      process.env.OAUTH_ACCESS_TOKEN_TTL || "3600",
      10,
    ),
    refreshTokenTtl: Number.parseInt(
      process.env.OAUTH_REFRESH_TOKEN_TTL || "2592000",
      10,
    ),
  };
}

/**
 * Secret used to sign reference-image upload tokens. Falls back to an
 * ephemeral random value (with a warning) so the feature works out of the
 * box; set UPLOAD_SIGNING_SECRET in production so upload URLs survive
 * restarts and are honoured by every instance behind a load balancer.
 */
export function readUploadSigningSecret(): string {
  const configured = process.env.UPLOAD_SIGNING_SECRET?.trim();
  if (configured) return configured;
  console.warn(
    "[config] UPLOAD_SIGNING_SECRET not set — generated an ephemeral one. " +
      "Upload URLs are invalidated on restart and won't be honoured by other " +
      "instances. Set UPLOAD_SIGNING_SECRET for production.",
  );
  return randomBytes(32).toString("hex");
}

/**
 * Parse the TRUST_PROXY env var. Accepts a number of hops, or `true`/`false`.
 * Defaults to 1 (a single reverse proxy) — not `true`, which is permissive and
 * lets clients spoof X-Forwarded-For to bypass IP-based rate limiting.
 */
export function readTrustProxy(): boolean | number {
  const raw = process.env.TRUST_PROXY?.trim().toLowerCase();
  if (raw === undefined || raw === "") return 1;
  if (["false", "off", "no", "0"].includes(raw)) return false;
  if (["true", "on", "yes"].includes(raw)) return true;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? 1 : n;
}

export function loadConfig(): Config {
  const openRouterApiKey = (process.env.OPENROUTER_API_KEY || "").trim();
  if (!openRouterApiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is required. Set it as an environment variable.",
    );
  }

  const imageModel = (
    process.env.IMAGE_MODEL || "google/gemini-2.5-flash-image"
  ).trim();

  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");

  return {
    openRouterApiKey,
    imageModel,
    modelType: readModelType(imageModel),
    port: Number.parseInt(process.env.PORT || "3000", 10),
    host: (process.env.HOST || "0.0.0.0").trim(),
    storageDir: (process.env.IMAGE_STORAGE_DIR || "./data/images").trim(),
    publicBaseUrl: publicBaseUrl || undefined,
    authToken: process.env.MCP_AUTH_TOKEN?.trim() || undefined,
    defaultAspectRatio: process.env.DEFAULT_ASPECT_RATIO?.trim() || undefined,
    defaultImageSize: process.env.DEFAULT_IMAGE_SIZE?.trim() || undefined,
    requestTimeoutMs: Number.parseInt(
      process.env.REQUEST_TIMEOUT_MS || "120000",
      10,
    ),
    r2: readR2Config(),
    trustProxy: readTrustProxy(),
    maxBodySize: (process.env.MAX_BODY_SIZE || "25mb").trim(),
    rateLimitWindowMs: Number.parseInt(
      process.env.RATE_LIMIT_WINDOW_MS || "60000",
      10,
    ),
    rateLimitMax: Number.parseInt(process.env.RATE_LIMIT_MAX || "60", 10),
    allowedOrigins: (() => {
      const list = parseList(process.env.ALLOWED_ORIGINS);
      return list.length > 0 ? list : undefined;
    })(),
    oauth: readOAuthConfig(),
    uploadSigningSecret: readUploadSigningSecret(),
    uploadUrlTtlSeconds: Number.parseInt(
      process.env.UPLOAD_URL_TTL_SECONDS || "600",
      10,
    ),
    maxUploadSize: (process.env.MAX_UPLOAD_SIZE || "15mb").trim(),
  };
}
