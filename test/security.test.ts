import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isOriginAllowed,
  parseBool,
  parseList,
  safeStrEqual,
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
