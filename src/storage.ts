/**
 * Persists generated images to disk and builds the public link under which
 * they can be retrieved (served by the same HTTP server via /images/...).
 */

import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Config } from "./config.js";
import type { GeneratedImage } from "./openrouter.js";

const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export interface StoredImage {
  filename: string;
  absolutePath: string;
  /** Path component served by the HTTP layer, e.g. "/images/<file>". */
  urlPath: string;
}

export class ImageStore {
  constructor(private readonly config: Config) {}

  async init(): Promise<void> {
    await mkdir(this.config.storageDir, { recursive: true });
  }

  /** Write one generated image to disk and return its location. */
  async save(image: GeneratedImage): Promise<StoredImage> {
    const ext = MIME_EXTENSIONS[image.mimeType.toLowerCase()] ?? "png";
    const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
    const absolutePath = path.join(this.config.storageDir, filename);
    await writeFile(absolutePath, Buffer.from(image.base64, "base64"));
    return { filename, absolutePath, urlPath: `/images/${filename}` };
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
