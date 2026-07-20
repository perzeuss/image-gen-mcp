/**
 * Builds the MCP server instance and registers the image-generation tools.
 *
 * A fresh server is created per request (stateless Streamable HTTP), so the
 * public link can be derived from the calling request's origin when no
 * PUBLIC_BASE_URL is configured.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Config } from "./config.js";
import { MAX_REFERENCE_IMAGES, type OpenRouterClient } from "./openrouter.js";
import type { ImageStorage } from "./storage.js";
import { createUploadToken } from "./uploads.js";

/** Build an absolute URL from a path, preferring PUBLIC_BASE_URL over the request origin. */
function absoluteUrl(
  config: Config,
  urlPath: string,
  requestOrigin?: string,
): string {
  const base = config.publicBaseUrl || requestOrigin;
  return base ? `${base.replace(/\/+$/, "")}${urlPath}` : urlPath;
}

export interface ServerContext {
  config: Config;
  client: OpenRouterClient;
  store: ImageStorage;
  /** Origin of the incoming request, used as a fallback for public links. */
  requestOrigin?: string;
}

export function buildMcpServer(ctx: ServerContext): McpServer {
  const { config, client, store } = ctx;

  const server = new McpServer({
    name: "image-gen-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "generate_image",
    {
      title: "Generate Image",
      description:
        "Generate an image from a text prompt using the configured OpenRouter image model " +
        `(currently "${config.imageModel}"). The image is stored on the server and a public ` +
        "link is returned in addition to the inline image. Supports optional aspect ratio, " +
        "image size, negative prompt, seed and image-to-image: pass one or more reference " +
        "images (e.g. the public URL of a previously generated image) to edit, restyle, " +
        "combine or otherwise transform them according to the prompt. For a reference image " +
        "that only exists as a local file, don't inline it as base64 — call create_upload_url " +
        "first, PUT the file's bytes to the returned URL, and use the resulting public url here.",
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .max(8000)
          .describe("Text description of the image to generate."),
        aspect_ratio: z
          .string()
          .regex(/^\d{1,2}:\d{1,2}$/)
          .optional()
          .describe(
            'Aspect ratio such as "1:1", "16:9", "9:16", "4:3", "3:2".',
          ),
        image_size: z
          .string()
          .max(8)
          .optional()
          .describe(
            'Output resolution such as "1K", "2K", "4K" (model dependent).',
          ),
        negative_prompt: z
          .string()
          .max(4000)
          .optional()
          .describe("Things to avoid in the image."),
        seed: z
          .number()
          .int()
          .min(0)
          .max(4294967295)
          .optional()
          .describe("Seed for reproducible results (model dependent)."),
        reference_image: z
          .string()
          .max(15_000_000)
          .optional()
          .describe(
            "Single reference image for image-to-image, as an http(s) URL or a data URL " +
              '("data:image/png;base64,..."). Prefer reference_images for new integrations.',
          ),
        reference_images: z
          .array(z.string().min(1).max(15_000_000))
          .max(MAX_REFERENCE_IMAGES)
          .optional()
          .describe(
            "Reference images for image-to-image, each an http(s) URL or a data URL " +
              '("data:image/png;base64,..."). Use one image to edit or restyle it, or ' +
              "several to combine subjects / transfer style (model dependent, up to " +
              `${MAX_REFERENCE_IMAGES}). Public URLs of previously generated images work too.`,
          ),
      },
    },
    async (args) => {
      try {
        const referenceImages = [
          ...(args.reference_image ? [args.reference_image] : []),
          ...(args.reference_images ?? []),
        ];

        const result = await client.generateImage({
          prompt: args.prompt,
          aspectRatio: args.aspect_ratio,
          imageSize: args.image_size,
          negativePrompt: args.negative_prompt,
          seed: args.seed,
          referenceImages,
        });

        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [];

        const links: string[] = [];
        for (const image of result.images) {
          const { publicUrl } = await store.store(image, ctx.requestOrigin);
          links.push(publicUrl);
          content.push({
            type: "image",
            data: image.base64,
            mimeType: image.mimeType,
          });
        }

        const summaryLines = [
          `Generated ${result.images.length} image(s) with "${config.imageModel}".`,
          ...links.map((url, i) => `Image ${i + 1}: ${url}`),
        ];
        if (result.text) {
          summaryLines.push("", `Model note: ${result.text}`);
        }

        content.unshift({ type: "text", text: summaryLines.join("\n") });

        return { content };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [
            { type: "text", text: `Image generation failed: ${message}` },
          ],
        };
      }
    },
  );

  server.registerTool(
    "create_upload_url",
    {
      title: "Create Reference Image Upload URL",
      description:
        "Get one or more short-lived upload URLs for sending reference images as raw bytes " +
        "over plain HTTP PUT, instead of embedding them as base64 inside a tool call (which is " +
        "unreliable for large images and doesn't work at all for local files this server can't " +
        "read). PUT the image bytes to a returned upload_url (Content-Type: image/png, " +
        "image/jpeg, image/webp or image/gif) before it expires; the response is " +
        '{"url": "<public url>"} — pass that url as an entry in generate_image\'s ' +
        "reference_images. Request one upload URL per reference image you plan to send, up to " +
        `${MAX_REFERENCE_IMAGES}.`,
      inputSchema: {
        count: z
          .number()
          .int()
          .min(1)
          .max(MAX_REFERENCE_IMAGES)
          .optional()
          .describe(
            `Number of upload URLs to create (default 1, max ${MAX_REFERENCE_IMAGES}).`,
          ),
      },
    },
    async (args) => {
      const count = args.count ?? 1;
      const uploads = Array.from({ length: count }, () => ({
        upload_url: absoluteUrl(
          config,
          `/uploads/${createUploadToken(config.uploadSigningSecret, config.uploadUrlTtlSeconds)}`,
          ctx.requestOrigin,
        ),
        expires_in_seconds: config.uploadUrlTtlSeconds,
      }));

      const summary = {
        uploads,
        instructions:
          "For each upload_url: PUT the raw image bytes with Content-Type set to image/png, " +
          'image/jpeg, image/webp or image/gif. The response is {"url": "<public url>"}; use ' +
          "that url as a reference_images entry in generate_image. Each upload_url expires after " +
          "expires_in_seconds.",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    },
  );

  server.registerTool(
    "get_image_model_info",
    {
      title: "Get Image Model Info",
      description:
        "Return the currently configured image model and how it is driven " +
        "(chat-style image model vs. pure image model).",
      inputSchema: {},
    },
    async () => {
      const info = {
        model: config.imageModel,
        model_type: config.modelType,
        modalities:
          config.modelType === "image" ? ["image"] : ["image", "text"],
        default_aspect_ratio: config.defaultAspectRatio ?? null,
        default_image_size: config.defaultImageSize ?? null,
        public_base_url: config.publicBaseUrl ?? null,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    },
  );

  return server;
}
