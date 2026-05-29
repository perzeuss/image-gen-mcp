import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { Config } from "../src/config.js";
import { ImageStore, isSafeFilename } from "../src/storage.js";

function makeConfig(storageDir: string, overrides: Partial<Config> = {}): Config {
  return {
    openRouterApiKey: "sk-test",
    imageModel: "google/gemini-2.5-flash-image",
    modelType: "chat",
    port: 3000,
    host: "0.0.0.0",
    storageDir,
    requestTimeoutMs: 120000,
    ...overrides,
  };
}

describe("isSafeFilename", () => {
  it("accepts the names produced by the store", () => {
    assert.equal(isSafeFilename("1700000000000-abcd1234.png"), true);
    assert.equal(isSafeFilename("file_name-1.webp"), true);
  });

  it("rejects traversal and unexpected names", () => {
    for (const bad of [
      "../secret.png",
      "..%2fsecret.png",
      "foo/bar.png",
      "foo\\bar.png",
      "/etc/passwd",
      "image.png\0.txt",
      "image.txt",
      "image",
      "",
      ".env",
    ]) {
      assert.equal(isSafeFilename(bad), false, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });

  it("rejects overly long names", () => {
    assert.equal(isSafeFilename("a".repeat(300) + ".png"), false);
  });
});

describe("ImageStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "imgstore-"));
  });

  afterEach(() => {
    process.env = { ...process.env };
  });

  it("saves an image with the correct extension and round-trips the bytes", async () => {
    const store = new ImageStore(makeConfig(dir));
    await store.init();
    const stored = await store.save({ base64: Buffer.from("PNG").toString("base64"), mimeType: "image/png" });
    assert.match(stored.filename, /\.png$/);
    assert.equal(stored.urlPath, `/images/${stored.filename}`);
    const bytes = await readFile(stored.absolutePath);
    assert.equal(bytes.toString(), "PNG");
  });

  it("maps mime types to extensions and falls back to png", async () => {
    const store = new ImageStore(makeConfig(dir));
    await store.init();
    assert.match((await store.save({ base64: "AA==", mimeType: "image/jpeg" })).filename, /\.jpg$/);
    assert.match((await store.save({ base64: "AA==", mimeType: "image/webp" })).filename, /\.webp$/);
    assert.match((await store.save({ base64: "AA==", mimeType: "image/unknown" })).filename, /\.png$/);
  });

  describe("publicUrl", () => {
    const stored = { filename: "x.png", absolutePath: "/tmp/x.png", urlPath: "/images/x.png" };

    it("prefers the configured public base URL", () => {
      const store = new ImageStore(makeConfig(dir, { publicBaseUrl: "https://img.example.com" }));
      assert.equal(store.publicUrl(stored, "http://localhost:3000"), "https://img.example.com/images/x.png");
    });

    it("falls back to the request origin", () => {
      const store = new ImageStore(makeConfig(dir));
      assert.equal(store.publicUrl(stored, "http://localhost:3000"), "http://localhost:3000/images/x.png");
    });

    it("falls back to the bare path when nothing is known", () => {
      const store = new ImageStore(makeConfig(dir));
      assert.equal(store.publicUrl(stored), "/images/x.png");
    });
  });

  describe("resolveSafe", () => {
    it("resolves a valid filename inside the storage dir", () => {
      const store = new ImageStore(makeConfig(dir));
      const resolved = store.resolveSafe("1700000000000-abcd1234.png");
      assert.equal(resolved, path.join(path.resolve(dir), "1700000000000-abcd1234.png"));
    });

    it("rejects traversal attempts", () => {
      const store = new ImageStore(makeConfig(dir));
      assert.equal(store.resolveSafe("../../etc/passwd"), null);
      assert.equal(store.resolveSafe("foo/bar.png"), null);
      assert.equal(store.resolveSafe("..%2f..%2fpasswd"), null);
      assert.equal(store.resolveSafe(""), null);
    });
  });
});
