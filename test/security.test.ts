import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  escapeHtml,
  isOriginAllowed,
  parseBool,
  parseList,
  safeStrEqual,
  signToken,
  verifyToken,
} from "../src/security.js";

describe("safeStrEqual", () => {
  it("returns true for equal strings", () => {
    assert.equal(safeStrEqual("s3cret-token", "s3cret-token"), true);
  });

  it("returns false for different strings (incl. different lengths)", () => {
    assert.equal(safeStrEqual("s3cret-token", "s3cret-tokeX"), false);
    assert.equal(safeStrEqual("short", "a-much-longer-value"), false);
    assert.equal(safeStrEqual("", "x"), false);
  });
});

describe("parseList", () => {
  it("splits on commas and whitespace and trims", () => {
    assert.deepEqual(parseList("a, b,c"), ["a", "b", "c"]);
    assert.deepEqual(parseList("a  b\tc"), ["a", "b", "c"]);
  });

  it("returns an empty array for empty/undefined input", () => {
    assert.deepEqual(parseList(undefined), []);
    assert.deepEqual(parseList("   "), []);
  });
});

describe("parseBool", () => {
  it("recognises truthy values", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      assert.equal(parseBool(v, false), true, v);
    }
  });

  it("recognises falsy values", () => {
    for (const v of ["0", "false", "no", "off", "nonsense"]) {
      assert.equal(parseBool(v, true), false, v);
    }
  });

  it("falls back when unset", () => {
    assert.equal(parseBool(undefined, true), true);
    assert.equal(parseBool("", false), false);
  });
});

describe("isOriginAllowed", () => {
  it("allows everything when the allow-list is empty", () => {
    assert.equal(isOriginAllowed("https://evil.example", []), true);
    assert.equal(isOriginAllowed(undefined, []), true);
  });

  it("allows requests without an Origin header", () => {
    assert.equal(isOriginAllowed(undefined, ["https://claude.ai"]), true);
  });

  it("enforces the allow-list when an Origin is present", () => {
    const allowed = ["https://claude.ai"];
    assert.equal(isOriginAllowed("https://claude.ai", allowed), true);
    assert.equal(isOriginAllowed("https://evil.example", allowed), false);
  });
});

describe("signToken / verifyToken", () => {
  const secret = "test-signing-secret";

  it("round-trips a payload", () => {
    const token = signToken({ t: "access", cid: "abc", sc: ["x"] }, secret);
    const claims = verifyToken(token, secret);
    assert.equal(claims?.t, "access");
    assert.equal(claims?.cid, "abc");
    assert.deepEqual(claims?.sc, ["x"]);
    assert.equal(typeof claims?.iat, "number");
  });

  it("rejects a token signed with a different secret", () => {
    const token = signToken({ t: "access" }, secret);
    assert.equal(verifyToken(token, "other-secret"), null);
  });

  it("rejects a tampered token", () => {
    const token = signToken({ t: "access", cid: "abc" }, secret);
    const [body] = token.split(".");
    assert.equal(verifyToken(`${body}.deadbeef`, secret), null);
    assert.equal(verifyToken("not-a-token", secret), null);
  });

  it("honours expiry", () => {
    const expired = signToken({ t: "code" }, secret, -1);
    assert.equal(verifyToken(expired, secret), null);
    const valid = signToken({ t: "code" }, secret, 60);
    assert.ok(verifyToken(valid, secret));
  });
});

describe("escapeHtml", () => {
  it("escapes HTML-significant characters", () => {
    assert.equal(
      escapeHtml(`<script>"x"&'y'`),
      "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;",
    );
  });
});
