import { parseForgefileYaml } from "@/lib/forgefile-parse";

export type ImageProjectSeedOpts = {
  projectName: string;
  image: string;
  containerPort: number;
  hostPort: number;
};

export type ImageProjectSeed = {
  files: Record<string, string>;
  executable: string[];
};

function yamlDoubleQuoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function buildImageForgefile(
  projectName: string,
  hostPort: number,
): string {
  const safeName = projectName.trim() || "image-app";
  return `version: 1

project:
  name: ${yamlDoubleQuoted(safeName)}

scripts:
  build:
    run: ./build.sh
    description: Pull the registry image
  test:
    run: ./test.sh
    description: Validate compose
  deploy:
    run: ./deploy.sh
    description: Start compose
  teardown:
    run: ./teardown.sh
    description: Stop compose

deployments:
  web:
    description: Public web app
    auto_deploy: false
    scripts:
      build: build
      test: test
      deploy: deploy
      teardown: teardown
    ports:
      - name: http
        port: ${hostPort}
        public: true

agent:
  packages: []
`;
}

const COMMON_SH = `#!/usr/bin/env bash
# Shared flags for image-seeded Forge projects.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

COMPOSE_PROJECT_NAME="\${COMPOSE_PROJECT_NAME:-app}"
PROJECT_NAME="\${PROJECT_NAME:-$COMPOSE_PROJECT_NAME}"
HOST_PORT="\${HOST_PORT:-8080}"
COMPOSE_FILE="\${COMPOSE_FILE:-}"

compose_file_path() {
  if [[ -n "\${COMPOSE_FILE}" && -f "\${COMPOSE_FILE}" ]]; then
    echo "\${COMPOSE_FILE}"
    return
  fi
  for candidate in docker-compose.yml docker-compose.yaml compose.yml; do
    if [[ -f "\$candidate" ]]; then
      echo "\$candidate"
      return
    fi
  done
  echo "docker-compose.yml"
}

compose_cmd() {
  docker compose -f "$(compose_file_path)" -p "\$COMPOSE_PROJECT_NAME" "\$@"
}

common_usage() {
  cat <<EOF
  --project-name NAME   Compose project name
  --host-port PORT      Published host port
  -h, --help            Show help
EOF
}

parse_common_args() {
  REMAINING_ARGS=()
  while [[ \$# -gt 0 ]]; do
    case "\$1" in
      --project-name)
        COMPOSE_PROJECT_NAME="\$2"
        PROJECT_NAME="\$2"
        export COMPOSE_PROJECT_NAME PROJECT_NAME
        shift 2
        ;;
      --host-port|--port)
        HOST_PORT="\$2"
        export HOST_PORT
        shift 2
        ;;
      -h|--help)
        return 1
        ;;
      *)
        REMAINING_ARGS+=("\$1")
        shift
        ;;
    esac
  done
  return 0
}
`;

const BUILD_SH = `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=scripts/lib/common.sh
source ./scripts/lib/common.sh
if ! parse_common_args "$@"; then
  echo "Usage: ./build.sh [--project-name NAME] [--host-port PORT]"
  exit 0
fi
: "\${IMAGE:?IMAGE is required}"
docker pull "\$IMAGE"
`;

const TEST_SH = `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=scripts/lib/common.sh
source ./scripts/lib/common.sh
if ! parse_common_args "$@"; then
  echo "Usage: ./test.sh [--project-name NAME] [--host-port PORT]"
  exit 0
fi
compose_cmd config >/dev/null
`;

const DEPLOY_SH = `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=scripts/lib/common.sh
source ./scripts/lib/common.sh
if ! parse_common_args "$@"; then
  echo "Usage: ./deploy.sh [--project-name NAME] [--host-port PORT]"
  exit 0
fi
compose_cmd up -d --remove-orphans
`;

const TEARDOWN_SH = `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# shellcheck source=scripts/lib/common.sh
source ./scripts/lib/common.sh
if ! parse_common_args "$@"; then
  echo "Usage: ./teardown.sh [--project-name NAME] [--host-port PORT]"
  exit 0
fi
compose_cmd down --remove-orphans
`;

export function buildImageProjectSeed(
  opts: ImageProjectSeedOpts,
): ImageProjectSeed {
  const projectName = opts.projectName.trim() || "image-app";
  const image = opts.image.trim();
  const containerPort = opts.containerPort;
  const hostPort = opts.hostPort;
  const forgefile = buildImageForgefile(projectName, hostPort);
  const parsed = parseForgefileYaml(forgefile);
  if (!parsed.ok) {
    const msg = parsed.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    throw new Error(`Image seed Forgefile is invalid: ${msg}`);
  }

  const envBody = `IMAGE=${image}\nCONTAINER_PORT=${containerPort}\n`;
  const compose = `services:
  app:
    image: \${IMAGE}
    ports:
      - "\${HOST_PORT}:\${CONTAINER_PORT}"
    restart: unless-stopped
    env_file: .env
`;

  return {
    files: {
      Forgefile: forgefile,
      "docker-compose.yml": compose,
      ".env": envBody,
      ".env.example": envBody,
      "build.sh": BUILD_SH,
      "test.sh": TEST_SH,
      "deploy.sh": DEPLOY_SH,
      "teardown.sh": TEARDOWN_SH,
      "scripts/lib/common.sh": COMMON_SH,
      "README.md": `# ${projectName}\n\nRegistry image \`${image}\` hosted by Forge.\n`,
    },
    executable: [
      "build.sh",
      "test.sh",
      "deploy.sh",
      "teardown.sh",
      "scripts/lib/common.sh",
    ],
  };
}

export const IMAGE_STARTER_COMPOSE = `services:
  app:
    image: \${IMAGE}
    ports:
      - "\${HOST_PORT}:\${CONTAINER_PORT}"
    restart: unless-stopped
    env_file: .env
`;
