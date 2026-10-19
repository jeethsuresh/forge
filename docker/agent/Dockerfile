# Forge agent session container — git + Ops + optional local Node runtime.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl git python3 \
  && rm -rf /var/lib/apt/lists/*

ENV FORGE_AGENT_BIN=/usr/local/bin/agent
ENV HOME=/home/agent
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
WORKDIR /workspace

COPY docker/agent/entrypoint.sh /usr/local/bin/forge-agent-entrypoint.sh
COPY docker/agent/run.mjs /usr/local/lib/forge-local-agent/run.mjs
COPY src/lib/agent-backends/local-loop.ts /usr/local/lib/forge-local-agent/local-loop.ts

RUN chmod +x /usr/local/bin/forge-agent-entrypoint.sh \
    /usr/local/lib/forge-local-agent/run.mjs \
  && useradd --create-home --home-dir /home/agent --shell /bin/bash agent \
  && chown -R agent:agent /workspace /home/agent /usr/local/lib/forge-local-agent \
  && npm install --omit=dev --prefix /usr/local/lib/forge-local-agent playwright \
  && npx --yes --prefix /usr/local/lib/forge-local-agent playwright install --with-deps chromium \
  || true

USER agent
ENTRYPOINT ["/usr/local/bin/forge-agent-entrypoint.sh"]
