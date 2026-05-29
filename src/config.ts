/**
 * Central configuration, loaded entirely from environment variables so the
 * server can be configured for any deployment (Docker, Dokploy, local) without
 * code changes.
 */

export type ModelType = "chat" | "image";

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
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim().replace(/\/+$/, "");
  const keyPrefix = process.env.R2_KEY_PREFIX?.trim().replace(/^\/+|\/+$/g, "");

  const anySet = Boolean(
    bucket || accessKeyId || secretAccessKey || accountId || endpoint || publicBaseUrl,
  );
  if (!anySet) return undefined;

  const resolvedEndpoint =
    endpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

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
  };
}
