import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { detectModelType, loadConfig } from "../src/config.js";

describe("detectModelType", () => {
  it("treats Flux and other pure image models as 'image'", () => {
    assert.equal(detectModelType("black-forest-labs/flux.2-pro"), "image");
    assert.equal(detectModelType("recraft/recraft-v3"), "image");
    assert.equal(detectModelType("bytedance/seedream-4.5"), "image");
    assert.equal(detectModelType("sourceful/riverflow-v2-max"), "image");
    assert.equal(detectModelType("ideogram/ideogram-v2"), "image");
  });

  it("treats chat-style image models as 'chat'", () => {
    assert.equal(detectModelType("google/gemini-2.5-flash-image"), "chat");
    assert.equal(detectModelType("google/nano-banana"), "chat");
    assert.equal(detectModelType("openai/gpt-5-image"), "chat");
  });

  it("defaults unknown models to 'chat'", () => {
    assert.equal(detectModelType("some/unknown-model"), "chat");
  });
});

describe("loadConfig", () => {
  let saved: NodeJS.ProcessEnv;

  beforeEach(() => {
    saved = { ...process.env };
    // Clear all relevant keys for a clean slate.
    for (const key of [
      "OPENROUTER_API_KEY",
      "IMAGE_MODEL",
      "IMAGE_MODEL_TYPE",
      "PUBLIC_BASE_URL",
      "PORT",
      "HOST",
      "MCP_AUTH_TOKEN",
      "DEFAULT_ASPECT_RATIO",
      "DEFAULT_IMAGE_SIZE",
      "REQUEST_TIMEOUT_MS",
      "IMAGE_STORAGE_DIR",
    ]) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.env = saved;
  });

  it("throws when the API key is missing", () => {
    assert.throws(() => loadConfig(), /OPENROUTER_API_KEY is required/);
  });

  it("applies sensible defaults", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    const cfg = loadConfig();
    assert.equal(cfg.imageModel, "google/gemini-2.5-flash-image");
    assert.equal(cfg.modelType, "chat");
    assert.equal(cfg.port, 3000);
    assert.equal(cfg.host, "0.0.0.0");
    assert.equal(cfg.publicBaseUrl, undefined);
    assert.equal(cfg.authToken, undefined);
  });

  it("auto-detects the model type from the model id", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.IMAGE_MODEL = "black-forest-labs/flux.2-pro";
    assert.equal(loadConfig().modelType, "image");
  });

  it("honours an explicit IMAGE_MODEL_TYPE override", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.IMAGE_MODEL = "black-forest-labs/flux.2-pro";
    process.env.IMAGE_MODEL_TYPE = "chat";
    assert.equal(loadConfig().modelType, "chat");
  });

  it("strips a trailing slash from PUBLIC_BASE_URL", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.PUBLIC_BASE_URL = "https://images.example.com/";
    assert.equal(loadConfig().publicBaseUrl, "https://images.example.com");
  });

  it("reads optional overrides", () => {
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.PORT = "8080";
    process.env.MCP_AUTH_TOKEN = "secret";
    process.env.DEFAULT_ASPECT_RATIO = "16:9";
    process.env.REQUEST_TIMEOUT_MS = "60000";
    const cfg = loadConfig();
    assert.equal(cfg.port, 8080);
    assert.equal(cfg.authToken, "secret");
    assert.equal(cfg.defaultAspectRatio, "16:9");
    assert.equal(cfg.requestTimeoutMs, 60000);
  });
});
