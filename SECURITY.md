# Security Policy

## Reporting a vulnerability

Please report security issues **privately** rather than via public issues.

- Use GitHub's [private vulnerability reporting](https://github.com/perzeuss/image-gen-mcp/security/advisories/new)
  ("Report a vulnerability" under the repository's **Security** tab), or
- contact the maintainer directly.

Please include steps to reproduce and the affected version/commit. You'll get
an acknowledgement as soon as possible.

## Scope & hardening

This server can hold your OpenRouter API key and acts as an OAuth authorization
server, so deploy it with care:

- Serve it only over **HTTPS** behind a trusted reverse proxy.
- Enable OAuth (`OAUTH_PASSWORD`) — or a static `MCP_AUTH_TOKEN` for direct
  access — and set a strong, random `OAUTH_SIGNING_SECRET`.
- Keep the per-IP rate limiting enabled (`RATE_LIMIT_MAX`).
- Optionally restrict access to Anthropic's published egress ranges at the
  network layer.

Built-in protections include path-traversal-safe image serving, Helmet
security headers, constant-time token comparison, OAuth 2.1 with PKCE, and
bounded request inputs. See the README's Security section for details.

## Verifying release artifacts

Released container images carry an SBOM and SLSA provenance and are signed with
[cosign](https://github.com/sigstore/cosign) (keyless). Verify before deploying:

```bash
cosign verify ghcr.io/perzeuss/image-gen-mcp:latest \
  --certificate-identity-regexp 'https://github.com/perzeuss/image-gen-mcp/.+' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

Automated scanning in CI: CodeQL (code), Dependency Review (PRs), Trivy
(images) and OpenSSF Scorecard.
