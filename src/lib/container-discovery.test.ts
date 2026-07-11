import { describe, expect, it } from "vitest";
import {
  getDiscoveredComposeContainers,
  groupComposeContainersByProject,
  normalizeDockerPsRecord,
  parseDockerPsJson,
  setDiscoveredComposeContainers,
} from "@/lib/container-discovery";

const SAMPLE_CONTAINER = {
  Names: ["my-app_app_1"],
  State: "running",
  Status: "Up 2 hours",
  Labels: {
    "com.docker.compose.project": "my-app",
    "com.docker.compose.service": "app",
  },
  Ports: [
    {
      host_port: 3456,
      container_port: 3000,
      protocol: "tcp",
    },
  ],
};

describe("parseDockerPsJson", () => {
  it("parses a JSON array from docker ps", () => {
    const records = parseDockerPsJson(JSON.stringify([SAMPLE_CONTAINER]));
    expect(records).toHaveLength(1);
    expect(records[0]?.Names).toEqual(["my-app_app_1"]);
  });

  it("parses NDJSON output", () => {
    const records = parseDockerPsJson(
      `${JSON.stringify(SAMPLE_CONTAINER)}\n${JSON.stringify({
        ...SAMPLE_CONTAINER,
        Names: ["my-app_db_1"],
        Labels: {
          "com.docker.compose.project": "my-app",
          "com.docker.compose.service": "db",
        },
      })}`,
    );
    expect(records).toHaveLength(2);
  });
});

describe("groupComposeContainersByProject", () => {
  it("groups compose-labeled containers by project slug", () => {
    const grouped = groupComposeContainersByProject([
      SAMPLE_CONTAINER,
      {
        Names: ["my-app_db_1"],
        State: "running",
        Status: "Up 2 hours",
        Labels: {
          "com.docker.compose.project": "my-app",
          "com.docker.compose.service": "db",
        },
        Ports: [],
      },
      {
        Names: ["other_app_1"],
        State: "running",
        Status: "Up 1 hour",
        Labels: {
          "io.podman.compose.project": "other",
          "io.podman.compose.service": "app",
        },
        Ports: [],
      },
    ]);

    expect(grouped.get("my-app")).toHaveLength(2);
    expect(grouped.get("other")).toHaveLength(1);
    expect(normalizeDockerPsRecord(SAMPLE_CONTAINER)).toEqual({
      name: "my-app_app_1",
      service: "app",
      state: "running",
      status: "Up 2 hours",
      ports: "3456:3000/tcp",
    });
  });

  it("ignores containers without compose labels", () => {
    const grouped = groupComposeContainersByProject([
      {
        Names: ["standalone"],
        State: "running",
        Status: "Up",
        Labels: {},
      },
    ]);
    expect(grouped.size).toBe(0);
  });
});

describe("setDiscoveredComposeContainers", () => {
  it("exposes discovered containers by compose slug", () => {
    const grouped = groupComposeContainersByProject([SAMPLE_CONTAINER]);
    setDiscoveredComposeContainers(grouped);

    expect(getDiscoveredComposeContainers("my-app")).toHaveLength(1);
    expect(getDiscoveredComposeContainers("missing")).toEqual([]);
  });
});
