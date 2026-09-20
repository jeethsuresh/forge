# Sticky per-branch checkout holder — git only, no docker.sock, no Cursor agent.
FROM alpine:3.20

RUN apk add --no-cache git ca-certificates

WORKDIR /workspace/repo
CMD ["sleep", "infinity"]
