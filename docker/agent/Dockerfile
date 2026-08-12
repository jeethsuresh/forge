# Forge agent session container — no Docker/Podman socket; git + Ops only.
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl git python3 \
  && rm -rf /var/lib/apt/lists/*

# Optional: bind-mount Cursor agent binary to /usr/local/bin/agent at runtime.
ENV FORGE_AGENT_BIN=/usr/local/bin/agent
ENV HOME=/home/agent
WORKDIR /workspace

COPY entrypoint.sh /usr/local/bin/forge-agent-entrypoint.sh
RUN chmod +x /usr/local/bin/forge-agent-entrypoint.sh \
  && useradd --create-home --home-dir /home/agent --shell /bin/bash agent \
  && chown -R agent:agent /workspace /home/agent

USER agent
ENTRYPOINT ["/usr/local/bin/forge-agent-entrypoint.sh"]
