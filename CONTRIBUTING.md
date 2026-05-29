# Contributing

Thanks for your interest in improving **image-gen-mcp**! 🎨

## Development setup

```bash
nvm use            # Node 24 (see .nvmrc)
npm install
cp .env.example .env   # set OPENROUTER_API_KEY etc.
npm run dev            # tsc --watch
```

Useful scripts:

| Script                                    | Purpose                                |
| ----------------------------------------- | -------------------------------------- |
| `npm run build`                           | Compile TypeScript to `dist/`.         |
| `npm test`                                | Run the unit tests (Node test runner). |
| `npm run typecheck`                       | Type-only check.                       |
| `npm run lint`                            | ESLint.                                |
| `npm run format` / `npm run format:check` | Prettier write / check.                |

Please make sure `npm run format:check`, `npm run lint`, `npm run typecheck`,
`npm run build` and `npm test` all pass before opening a PR (CI runs the same).

## Commit messages — Conventional Commits

This repository uses [Conventional Commits](https://www.conventionalcommits.org/).
PRs are squash-merged, so the **PR title** becomes the commit message — it is
validated against Conventional Commits in CI. Please title your commits the
same way.

Format:

```
<type>[optional scope]: <description>
```

Common types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`,
`build`, `perf`, `style`.

Examples:

```
feat(oauth): add refresh token rotation
fix(storage): reject filenames containing null bytes
docs(readme): clarify R2 public URL setup
```

Breaking changes: add a `!` after the type/scope (`feat!: ...`) or a
`BREAKING CHANGE:` footer.

## Pull requests

- Keep PRs focused and reasonably small.
- Add or update tests for behaviour changes.
- Update the README / `.env.example` when you add or change configuration.

## Reporting security issues

Please do **not** open public issues for security vulnerabilities — see
[SECURITY.md](./SECURITY.md).
