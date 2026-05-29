/**
 * Thin client around the OpenRouter chat/completions endpoint, specialised for
 * image generation. Handles both chat-style image models (NanoBanana / Gemini
 * Flash Image, GPT image models) and pure image models (Flux) via the
 * `modalities` parameter.
 *
 * See https://openrouter.ai/docs/guides/overview/multimodal/image-generation
 */

import type { Config, ModelType } from "./config.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Map the configured model type to the OpenRouter `modalities` value.
 * Pure image models accept only ["image"]; chat-image models want both.
 */
export function modalitiesForModelType(type: ModelType): string[] {
  return type === "image" ? ["image"] : ["image", "text"];
}

export interface GenerateOptions {
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  negativePrompt?: string;
  seed?: number;
  /** Optional reference image as a data URL or http(s) URL for image-to-image. */
  referenceImage?: string;
}

export interface GeneratedImage {
  /** Raw base64 payload (no data: prefix). */
  base64: string;
  mimeType: string;
}

export interface GenerateResult {
  images: GeneratedImage[];
  /** Any accompanying text the model returned (chat models often add a caption). */
  text?: string;
}

interface OpenRouterMessageContentText {
  type: "text";
  text: string;
}

interface OpenRouterImagePart {
  type: "image_url";
  image_url: { url: string };
}

type OpenRouterContent =
  | string
  | (OpenRouterMessageContentText | OpenRouterImagePart)[];

interface OpenRouterResponse {
  error?: { message?: string; code?: number | string };
  choices?: Array<{
    message?: {
      content?: string;
      images?: Array<{ image_url?: { url?: string } }>;
    };
  }>;
}

/**
 * Only allow http(s) URLs and data: image URLs as reference images. Rejects
 * schemes like file:, ftp: or gopher: that could be abused as request vectors.
 */
export function isAllowedImageRef(ref: string): boolean {
  const value = ref.trim();
  if (/^data:image\//i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Parse a data URL ("data:image/png;base64,....") into payload + mime type. */
export function parseDataUrl(url: string): GeneratedImage | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!match) return null;
  const mimeType = match[1] || "image/png";
  const isBase64 = Boolean(match[2]);
  const data = match[3];
  if (isBase64) {
    return { base64: data, mimeType };
  }
  // Non-base64 data URL (rare for images) -> encode it.
  return {
    base64: Buffer.from(decodeURIComponent(data)).toString("base64"),
    mimeType,
  };
}

export class OpenRouterClient {
  constructor(private readonly config: Config) {}

  async generateImage(opts: GenerateOptions): Promise<GenerateResult> {
    const prompt = opts.prompt?.trim();
    if (!prompt) {
      throw new Error("Prompt must not be empty.");
    }

    if (opts.referenceImage && !isAllowedImageRef(opts.referenceImage)) {
      throw new Error(
        "reference_image must be an http(s) URL or a data: image URL.",
      );
    }

    const content: OpenRouterContent = opts.referenceImage
      ? [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: opts.referenceImage } },
        ]
      : prompt;

    const messages: Array<{ role: string; content: OpenRouterContent }> = [
      { role: "user", content },
    ];

    if (opts.negativePrompt && !opts.referenceImage) {
      messages.push({
        role: "user",
        content: `Avoid the following (negative prompt): ${opts.negativePrompt}`,
      });
    }

    const modalities = modalitiesForModelType(this.config.modelType);

    const body: Record<string, unknown> = {
      model: this.config.imageModel,
      messages,
      modalities,
    };

    const imageConfig: Record<string, unknown> = {};
    const aspectRatio = opts.aspectRatio ?? this.config.defaultAspectRatio;
    const imageSize = opts.imageSize ?? this.config.defaultImageSize;
    if (aspectRatio) imageConfig.aspect_ratio = aspectRatio;
    if (imageSize) imageConfig.image_size = imageSize;
    if (Object.keys(imageConfig).length > 0) body.image_config = imageConfig;

    if (typeof opts.seed === "number") body.seed = opts.seed;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs,
    );

    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.openRouterApiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/perzeuss/image-gen-mcp",
          "X-Title": "Image Gen MCP",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `OpenRouter request timed out after ${this.config.requestTimeoutMs}ms.`,
        );
      }
      throw new Error(
        `Failed to reach OpenRouter: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    const rawText = await response.text();
    let data: OpenRouterResponse;
    try {
      data = JSON.parse(rawText) as OpenRouterResponse;
    } catch {
      throw new Error(
        `OpenRouter returned a non-JSON response (HTTP ${response.status}): ${rawText.slice(0, 500)}`,
      );
    }

    if (!response.ok || data.error) {
      const message = data.error?.message || `HTTP ${response.status}`;
      throw new Error(`OpenRouter error: ${message}`);
    }

    const message = data.choices?.[0]?.message;
    const rawImages = message?.images ?? [];
    const images: GeneratedImage[] = [];
    for (const img of rawImages) {
      const url = img.image_url?.url;
      if (!url) continue;
      const parsed = parseDataUrl(url);
      if (parsed) images.push(parsed);
    }

    if (images.length === 0) {
      throw new Error(
        "The model did not return any image. Check that the configured model supports image output and that IMAGE_MODEL_TYPE is correct.",
      );
    }

    return { images, text: message?.content?.trim() || undefined };
  }
}
