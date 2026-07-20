/**
 * Image storage abstraction. Two backends are available:
 *   - LocalImageStore: persists to disk, served by this server at /images/<file>.
 *   - R2ImageStore:    uploads to Cloudflare R2 (see ./r2.ts), preferred when
 *                      the R2_* environment variables are configured.
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Config } from "./config.js";
import type { GeneratedImage } from "./openrouter.js";

export const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Generate a unique, traversal-safe object name for a generated image. */
export function generateFilename(mimeType: string): string {
  const ext = MIME_EXTENSIONS[mimeType.toLowerCase()] ?? "png";
  return `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
}

export interface SaveResult {
  /** Absolute, shareable public URL for the stored image. */
  publicUrl: string;
}

/** Common interface implemented by every storage backend. */
export interface ImageStorage {
  readonly kind: "local" | "r2";
  init(): Promise<void>;
  /** Persist one image and return its public link. */
  store(image: GeneratedImage, requestOrigin?: string): Promise<SaveResult>;
}

export interface StoredImage {
  filename: string;
  absolutePath: string;
  /** Path component served by the HTTP layer, e.g. "/images/<file>". */
  urlPath: string;
}

/**
 * Strict allow-list for filenames we are willing to serve. This matches the
 * names produced by {@link generateFilename} and rejects anything containing
 * path separators, "..", null bytes or other traversal attempts.
 */
const SAFE_FILENAME = /^[A-Za-z0-9_-]+\.(png|jpg|jpeg|webp|gif)$/;

export function isSafeFilename(name: string): boolean {
  if (!name || name.length > 255) return false;
  if (name.includes("\0")) return false;
  return SAFE_FILENAME.test(name);
}

/**
 * Identify an image's real format from its magic bytes. Used to verify
 * uploaded content instead of trusting a client-supplied Content-Type header,
 * which is easy to spoof. Returns null for anything that isn't a recognised
 * PNG, JPEG, GIF or WEBP payload.
 */
export function sniffImageMime(buf: Buffer): string | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buf.length >= 6 &&
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Local-disk storage backend. Images are served by this server at /images. */
export class ImageStore implements ImageStorage {
  readonly kind = "local" as const;

  constructor(private readonly config: Config) {}

  async init(): Promise<void> {
    await mkdir(this.config.storageDir, { recursive: true });
  }

  async store(
    image: GeneratedImage,
    requestOrigin?: string,
  ): Promise<SaveResult> {
    const stored = await this.save(image);
    return { publicUrl: this.publicUrl(stored, requestOrigin) };
  }

  /** Write one generated image to disk and return its location. */
  async save(image: GeneratedImage): Promise<StoredImage> {
    const filename = generateFilename(image.mimeType);
    const absolutePath = path.join(this.config.storageDir, filename);
    await writeFile(absolutePath, Buffer.from(image.base64, "base64"));
    return { filename, absolutePath, urlPath: `/images/${filename}` };
  }

  /**
   * Resolve a client-requested filename to an absolute path, but only if it is
   * a safe filename that stays strictly inside the storage directory. Returns
   * null for any traversal attempt or unexpected name.
   */
  resolveSafe(requested: string): string | null {
    if (!isSafeFilename(requested)) return null;
    const root = path.resolve(this.config.storageDir);
    const resolved = path.resolve(root, requested);
    // Defence in depth: ensure the resolved path is contained in the root.
    if (resolved !== path.join(root, requested)) return null;
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
    return resolved;
  }

  /**
   * Build the absolute, shareable public URL for a stored image. Prefers the
   * configured PUBLIC_BASE_URL; otherwise falls back to the requesting host.
   */
  publicUrl(stored: StoredImage, requestOrigin?: string): string {
    const base = this.config.publicBaseUrl || requestOrigin;
    if (!base) return stored.urlPath;
    return `${base.replace(/\/+$/, "")}${stored.urlPath}`;
  }
}
