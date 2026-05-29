import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isAllowedImageRef,
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
