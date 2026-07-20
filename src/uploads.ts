/**
 * Stateless, signed tokens for the "upload a reference image via plain HTTP
 * PUT" flow (see PUT /uploads/:token in app.ts). Signing means no
 * server-side token store is needed: it works across restarts and multiple
 * instances behind a load balancer, consistent with the rest of this
 * stateless server.
 *
 * This exists so large reference images never have to be inlined as base64
 * inside an MCP tool call: the model asks for an upload URL (a cheap, small
 * tool call), the actual client with the image bytes PUTs them directly to
 * that URL, and the resulting public link is passed to generate_image's
 * reference_images as a normal http(s) URL.
 */

import { randomUUID } from "node:crypto";

import { signToken, verifyToken } from "./security.js";

const UPLOAD_TOKEN_PURPOSE = "img-upload";

/** Create a short-lived, single-purpose signed token for one image upload. */
export function createUploadToken(secret: string, ttlSeconds: number): string {
  return signToken(
    { purpose: UPLOAD_TOKEN_PURPOSE, jti: randomUUID() },
    secret,
    ttlSeconds,
  );
}

/**
 * Verify an upload token: valid signature, not expired, and minted for this
 * purpose (so an OAuth access token or other signed token can't be reused
 * here by accident).
 */
export function verifyUploadToken(token: string, secret: string): boolean {
  const claims = verifyToken(token, secret);
  return claims?.purpose === UPLOAD_TOKEN_PURPOSE;
}
