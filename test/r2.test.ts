import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { Config } from "../src/config.js";
import { readR2Config } from "../src/config.js";
import { ImageStore } from "../src/storage.js";
import { createStorage, R2ImageStore } from "../src/r2.js";

const R2_KEYS = [
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_ACCOUNT_ID",
  "R2_ENDPOINT",
  "R2_PUBLIC_BASE_URL",
  "R2_KEY_PREFIX",
];

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    openRouterApiKey: "sk-test",
    imageModel: "google/gemini-2.5-flash-image",
    modelType: "chat",
    port: 3000,
    host: "0.0.0.0",
    storageDir: "./data/images",
    requestTimeoutMs: 120000,
    ...overrides,
  };
}

describe("readR2Config", () => {
  let saved: NodeJS.ProcessEnv;

  beforeEach(() => {
    saved = { ...process.env };
    for (const key of R2_KEYS) delete process.env[key];
  });
  afterEach(() => {
    process.env = saved;
  });

  it("returns undefined when no R2 variable is set", () => {
    assert.equal(readR2Config(), undefined);
  });

  it("derives the endpoint from the account id", () => {
    process.env.R2_BUCKET = "images";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_ACCOUNT_ID = "acc123";
    process.env.R2_PUBLIC_BASE_URL = "https://cdn.example.com/";
    const r2 = readR2Config();
    assert.ok(r2);
    assert.equal(r2.endpoint, "https://acc123.r2.cloudflarestorage.com");
    assert.equal(r2.publicBaseUrl, "https://cdn.example.com");
    assert.equal(r2.bucket, "images");
  });

  it("prefers an explicit endpoint and normalises the key prefix", () => {
    process.env.R2_BUCKET = "images";
    process.env.R2_ACCESS_KEY_ID = "key";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_ENDPOINT = "https://custom.endpoint.com/";
    process.env.R2_PUBLIC_BASE_URL = "https://cdn.example.com";
    process.env.R2_KEY_PREFIX = "/generated/";
    const r2 = readR2Config();
    assert.equal(r2?.endpoint, "https://custom.endpoint.com");
    assert.equal(r2?.keyPrefix, "generated");
  });

  it("throws when R2 is partially configured", () => {
    process.env.R2_BUCKET = "images";
    assert.throws(() => readR2Config(), /partially configured/i);
  });
});

describe("createStorage", () => {
  it("uses the local backend when R2 is not configured", () => {
    const store = createStorage(baseConfig(), () => new ImageStore(baseConfig()));
    assert.equal(store.kind, "local");
    assert.ok(store instanceof ImageStore);
  });

  it("prefers R2 when configured", () => {
    const config = baseConfig({
      r2: {
        endpoint: "https://acc.r2.cloudflarestorage.com",
        accessKeyId: "key",
        secretAccessKey: "secret",
        bucket: "images",
        publicBaseUrl: "https://cdn.example.com",
      },
    });
    const store = createStorage(config, () => new ImageStore(config));
    assert.equal(store.kind, "r2");
    assert.ok(store instanceof R2ImageStore);
  });
});
