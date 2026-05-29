/**
 * Small, dependency-free security helpers, kept pure so they can be unit
 * tested in isolation.
 */

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison. Hashing both inputs first means we compare
 * equal-length buffers regardless of input length, so neither the result nor
 * the timing leaks the length or content of the secret.
 */
export function safeStrEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb);
}

/** Parse a comma/whitespace separated environment list into trimmed entries. */
export function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Parse a boolean-ish environment value, falling back to `fallback`. */
export function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

/**
 * Decide whether a request Origin is acceptable. An empty allow-list means
 * "no Origin restriction" (server-to-server clients such as Claude do not send
 * a browser Origin). A request without an Origin header is always allowed; the
 * check only rejects Origins that are present but not allow-listed.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowed: string[],
): boolean {
  if (allowed.length === 0) return true;
  if (!origin) return true;
  return allowed.includes(origin);
}
