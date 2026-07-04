import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMessages,
  isAllowedImageRef,
  MAX_REFERENCE_IMAGES,
  modalitiesForModelType,
  parseDataUrl,
} from "../src/openrouter.js";

describe("modalitiesForModelType", () => {
  it("returns image-only for pure image models", () => {
    assert.deepEqual(modalitiesForModelType("image"), ["image"]);
  });

  it("returns image+text for chat-style image models", () => {
    assert.deepEqual(modalitiesForModelType("chat"), ["image", "text"]);
  });
});

describe("parseDataUrl", () => {
  it("parses a base64 PNG data URL", () => {
    const png = Buffer.from("hello").toString("base64");
    const parsed = parseDataUrl(`data:image/png;base64,${png}`);
    assert.ok(parsed);
    assert.equal(parsed.mimeType, "image/png");
    assert.equal(parsed.base64, png);
    assert.equal(Buffer.from(parsed.base64, "base64").toString(), "hello");
  });

  it("parses a base64 JPEG data URL", () => {
    const jpg = Buffer.from("img").toString("base64");
    const parsed = parseDataUrl(`data:image/jpeg;base64,${jpg}`);
    assert.equal(parsed?.mimeType, "image/jpeg");
  });

  it("defaults the mime type when omitted", () => {
    const data = Buffer.from("x").toString("base64");
    const parsed = parseDataUrl(`data:;base64,${data}`);
    assert.equal(parsed?.mimeType, "image/png");
  });

  it("encodes a non-base64 data URL payload", () => {
    const parsed = parseDataUrl("data:text/plain,hello%20world");
    assert.ok(parsed);
    assert.equal(
      Buffer.from(parsed.base64, "base64").toString(),
      "hello world",
    );
  });

  it("returns null for non data URLs", () => {
    assert.equal(parseDataUrl("https://example.com/x.png"), null);
    assert.equal(parseDataUrl("not a url"), null);
  });
});

describe("buildMessages", () => {
  it("uses a plain string content for text-to-image", () => {
    const messages = buildMessages({ prompt: "a red fox" });
    assert.deepEqual(messages, [{ role: "user", content: "a red fox" }]);
  });

  it("builds multimodal content for a single reference image (img2img)", () => {
    const messages = buildMessages({
      prompt: "make it a watercolor painting",
      referenceImages: ["https://example.com/fox.png"],
    });
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].content, [
      { type: "text", text: "make it a watercolor painting" },
      {
        type: "image_url",
        image_url: { url: "https://example.com/fox.png" },
      },
    ]);
  });

  it("includes every reference image as its own content part", () => {
    const refs = [
      "https://example.com/subject.png",
      "https://example.com/style.png",
      "data:image/png;base64,AAAA",
    ];
    const messages = buildMessages({
      prompt: "combine the subject with the style",
      referenceImages: refs,
    });
    const content = messages[0].content;
    assert.ok(Array.isArray(content));
    assert.deepEqual(
      content.slice(1).map((part) => (part as any).image_url.url),
      refs,
    );
  });

  it("keeps the negative prompt when reference images are given", () => {
    const messages = buildMessages({
      prompt: "restyle the photo",
      negativePrompt: "text, watermarks",
      referenceImages: ["https://example.com/photo.png"],
    });
    assert.equal(messages.length, 2);
    assert.match(String(messages[1].content), /negative prompt.*watermarks/i);
  });

  it("ignores empty/whitespace reference entries", () => {
    const messages = buildMessages({
      prompt: "a fox",
      referenceImages: ["  ", ""],
    });
    assert.deepEqual(messages, [{ role: "user", content: "a fox" }]);
  });

  it("rejects disallowed reference image schemes", () => {
    assert.throws(
      () =>
        buildMessages({
          prompt: "a fox",
          referenceImages: ["file:///etc/passwd"],
        }),
      /http\(s\) URL or a data: image URL/,
    );
  });

  it("rejects more than the maximum number of reference images", () => {
    const refs = Array.from(
      { length: MAX_REFERENCE_IMAGES + 1 },
      (_, i) => `https://example.com/${i}.png`,
    );
    assert.throws(
      () => buildMessages({ prompt: "a fox", referenceImages: refs }),
      /Too many reference images/,
    );
  });

  it("rejects an empty prompt", () => {
    assert.throws(() => buildMessages({ prompt: "   " }), /must not be empty/);
  });
});

describe("isAllowedImageRef", () => {
  it("allows http(s) URLs and data image URLs", () => {
    assert.equal(isAllowedImageRef("https://example.com/a.png"), true);
    assert.equal(isAllowedImageRef("http://example.com/a.png"), true);
    assert.equal(isAllowedImageRef("data:image/png;base64,AAAA"), true);
  });

  it("rejects other schemes and non-image data URLs", () => {
    assert.equal(isAllowedImageRef("file:///etc/passwd"), false);
    assert.equal(isAllowedImageRef("ftp://example.com/a.png"), false);
    assert.equal(isAllowedImageRef("gopher://example.com"), false);
    assert.equal(isAllowedImageRef("data:text/html,<script>"), false);
    assert.equal(isAllowedImageRef("not a url"), false);
  });
});
