<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Agent workflow (mandatory)

- **Run `./test.sh` before finishing any task** that touches code or config. Do not end the turn with failing or unrun tests.
- If tests fail, **fix them** (or revert the breaking change) and re-run `./test.sh` until all pass.
- Use `./build.sh` → `./test.sh` → `./deploy.sh` for deploy-related work; a failing test blocks deploy.
- Self-update runs `./test.sh` inside the updater sidecar; tests use `FORGE_DB_PATH=:memory:` so they never lock `/data/forge.db`.
