import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createUploadToken, verifyUploadToken } from "../src/uploads.js";
import { signToken } from "../src/security.js";

describe("createUploadToken / verifyUploadToken", () => {
  const secret = "test-upload-secret";

  it("round-trips a freshly created token", () => {
    const token = createUploadToken(secret, 600);
    assert.equal(verifyUploadToken(token, secret), true);
  });

  it("produces a different token on each call", () => {
    const a = createUploadToken(secret, 600);
    const b = createUploadToken(secret, 600);
    assert.notEqual(a, b);
  });

  it("rejects a token signed with a different secret", () => {
    const token = createUploadToken(secret, 600);
    assert.equal(verifyUploadToken(token, "other-secret"), false);
  });

  it("rejects an expired token", () => {
    const token = createUploadToken(secret, -1);
    assert.equal(verifyUploadToken(token, secret), false);
  });

  it("rejects a garbage token", () => {
    assert.equal(verifyUploadToken("not-a-token", secret), false);
  });

  it("rejects a validly signed token that wasn't minted for uploads", () => {
    const token = signToken({ t: "access", cid: "abc" }, secret, 600);
    assert.equal(verifyUploadToken(token, secret), false);
  });
});
