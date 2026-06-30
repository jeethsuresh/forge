import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { join } from "path";

const execFileAsync = promisify(execFile);

export interface ContainerInfo {
  name: string;
  service: string;
  state: string;
  status: string;
  ports: string;
}

export async function getComposeContainerStatus(
  repoPath: string,
): Promise<ContainerInfo[]> {
  if (!existsSync(repoPath)) return [];

  const composeFiles = ["docker-compose.yml", "docker-compose.yaml", "compose.yml"];
  const composeFile = composeFiles.find((f) => existsSync(join(repoPath, f)));
  if (!composeFile) return [];

  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["compose", "-f", composeFile, "ps", "--format", "json"],
      { cwd: repoPath, maxBuffer: 5 * 1024 * 1024 },
    );

    const lines = stdout
      .trim()
      .split("\n")
      .filter(Boolean);

    const containers: ContainerInfo[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as {
          Name?: string;
          Service?: string;
          State?: string;
          Status?: string;
          Publishers?: Array<{ URL?: string }>;
        };
        const ports =
          parsed.Publishers?.map((p) => p.URL).filter(Boolean).join(", ") ?? "";
        containers.push({
          name: parsed.Name ?? "unknown",
          service: parsed.Service ?? "unknown",
          state: parsed.State ?? "unknown",
          status: parsed.Status ?? "",
          ports,
        });
      } catch {
        // skip malformed lines
      }
    }
    return containers;
  } catch {
    return [];
  }
}
