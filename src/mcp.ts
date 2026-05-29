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
import type { OpenRouterClient } from "./openrouter.js";
import type { ImageStore } from "./storage.js";

export interface ServerContext {
  config: Config;
  client: OpenRouterClient;
  store: ImageStore;
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
        "image size, negative prompt, seed and a reference image for image-to-image.",
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .describe("Text description of the image to generate."),
        aspect_ratio: z
          .string()
          .optional()
          .describe('Aspect ratio such as "1:1", "16:9", "9:16", "4:3", "3:2".'),
        image_size: z
          .string()
          .optional()
          .describe('Output resolution such as "1K", "2K", "4K" (model dependent).'),
        negative_prompt: z
          .string()
          .optional()
          .describe("Things to avoid in the image (ignored when a reference image is given)."),
        seed: z
          .number()
          .int()
          .optional()
          .describe("Seed for reproducible results (model dependent)."),
        reference_image: z
          .string()
          .optional()
          .describe(
            "Optional reference image for image-to-image, as an http(s) URL or a data URL " +
              '("data:image/png;base64,...").',
          ),
      },
    },
    async (args) => {
      try {
        const result = await client.generateImage({
          prompt: args.prompt,
          aspectRatio: args.aspect_ratio,
          imageSize: args.image_size,
          negativePrompt: args.negative_prompt,
          seed: args.seed,
          referenceImage: args.reference_image,
        });

        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [];

        const links: string[] = [];
        for (const image of result.images) {
          const stored = await store.save(image);
          links.push(store.publicUrl(stored, ctx.requestOrigin));
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
          content: [{ type: "text", text: `Image generation failed: ${message}` }],
        };
      }
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
