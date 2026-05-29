/**
 * Cloudflare R2 storage backend (S3-compatible) using SigV4-signed fetch.
 *
 * R2 is preferred over local disk whenever the R2_* environment variables are
 * configured. Uploaded objects are served directly by R2 / the configured
 * public base URL, so this server does not proxy them.
 */

import { AwsClient } from "aws4fetch";

import type { Config, R2Config } from "./config.js";
import type { GeneratedImage } from "./openrouter.js";
import {
  generateFilename,
  type ImageStorage,
  type SaveResult,
} from "./storage.js";

export class R2ImageStore implements ImageStorage {
  readonly kind = "r2" as const;
  private readonly client: AwsClient;

  constructor(private readonly r2: R2Config) {
    this.client = new AwsClient({
      accessKeyId: r2.accessKeyId,
      secretAccessKey: r2.secretAccessKey,
      service: "s3",
      region: "auto",
    });
  }

  async init(): Promise<void> {
    // Nothing to provision; the bucket is expected to exist.
  }

  async store(image: GeneratedImage, _requestOrigin?: string): Promise<SaveResult> {
    const filename = generateFilename(image.mimeType);
    const key = this.r2.keyPrefix ? `${this.r2.keyPrefix}/${filename}` : filename;
    const objectUrl = `${this.r2.endpoint}/${encodeURIComponent(this.r2.bucket)}/${encodeURI(key)}`;

    const response = await this.client.fetch(objectUrl, {
      method: "PUT",
      headers: { "Content-Type": image.mimeType },
      body: Buffer.from(image.base64, "base64"),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Failed to upload image to R2 (HTTP ${response.status}): ${detail.slice(0, 300)}`,
      );
    }

    return { publicUrl: `${this.r2.publicBaseUrl}/${encodeURI(key)}` };
  }
}

/**
 * Pick the storage backend: Cloudflare R2 when configured, otherwise local
 * disk. Returns the chosen ImageStorage instance.
 */
export function createStorage(
  config: Config,
  localFactory: () => ImageStorage,
): ImageStorage {
  if (config.r2) {
    return new R2ImageStore(config.r2);
  }
  return localFactory();
}
