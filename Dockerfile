# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run lint && npm run build

FROM base AS test
RUN apt-get update && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npm", "test"]

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    git bash curl gosu python3 sqlite3 \
  && curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-27.5.1.tgz \
    | tar xzf - --strip-components=1 -C /usr/local/bin docker/docker \
  && mkdir -p /usr/local/lib/docker/cli-plugins \
  && curl -fsSL "https://github.com/docker/compose/releases/download/v2.40.3/docker-compose-linux-x86_64" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose \
  && chmod +x /usr/local/lib/docker/cli-plugins/docker-compose \
  && rm -rf /var/lib/apt/lists/*
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY scripts/self-update.sh /usr/local/bin/forge-self-update.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /usr/local/bin/forge-self-update.sh
COPY --from=builder /app/public ./public
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY docker-compose.yml /opt/forge/docker-compose.yml
COPY scripts/lib/common.sh /opt/forge/scripts/lib/common.sh
USER root
ENTRYPOINT ["docker-entrypoint.sh"]
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV FORGE_AGENT_BIN=/usr/local/bin/agent
ENV HOME=/data/agent-home
CMD ["node", "server.js"]
