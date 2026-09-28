import { describe, expect, it } from "vitest";
import {
  containerRuntimeLabel,
  isContainerRunningState,
  parsePublishedPortBindings,
  resolveBoundHostPort,
  serviceDirectoryStatusLabel,
} from "@/lib/container-runtime";

describe("isContainerRunningState", () => {
  it("treats docker running state as up", () => {
    expect(isContainerRunningState("running")).toBe(true);
    expect(isContainerRunningState("Running")).toBe(true);
  });

  it("treats docker/podman Up status as running even when state is odd", () => {
    expect(isContainerRunningState("unknown", "Up 41 hours")).toBe(true);
    expect(isContainerRunningState("up", "")).toBe(true);
  });

  it("treats exited and created as down", () => {
    expect(isContainerRunningState("exited", "Exited (1) 3 seconds ago")).toBe(
      false,
    );
    expect(isContainerRunningState("created", "Created")).toBe(false);
    expect(isContainerRunningState("dead")).toBe(false);
  });
});

describe("labels", () => {
  it("labels running containers Up", () => {
    expect(containerRuntimeLabel("running", "Up 2 hours")).toBe("Up");
    expect(serviceDirectoryStatusLabel("up")).toBe("Up");
  });

  it("labels stopped containers Down", () => {
    expect(containerRuntimeLabel("exited", "Exited (0)")).toBe("Down");
    expect(serviceDirectoryStatusLabel("down")).toBe("Down");
  });
});

describe("parsePublishedPortBindings", () => {
  it("parses host:container/proto lists", () => {
    expect(parsePublishedPortBindings("3456:3000/tcp, 9090:9090/tcp")).toEqual([
      { host: 3456, container: 3000 },
      { host: 9090, container: 9090 },
    ]);
  });

  it("parses Publisher URL style ip:host as host-only binding", () => {
    expect(parsePublishedPortBindings("0.0.0.0:8080")).toEqual([
      { host: 8080, container: 8080 },
    ]);
  });

  it("parses docker ps arrow syntax", () => {
    expect(
      parsePublishedPortBindings("0.0.0.0:8080->3000/tcp, :::9091->9091/tcp"),
    ).toEqual([
      { host: 8080, container: 3000 },
      { host: 9091, container: 9091 },
    ]);
  });

  it("returns empty for blank or unparsable ports", () => {
    expect(parsePublishedPortBindings("")).toEqual([]);
    expect(parsePublishedPortBindings("n/a")).toEqual([]);
  });
});

describe("resolveBoundHostPort", () => {
  const bindings = [
    { host: 3456, container: 3000 },
    { host: 9091, container: 9091 },
  ];

  it("matches declared host port", () => {
    expect(resolveBoundHostPort(3456, bindings)).toBe(3456);
  });

  it("matches declared container port to the published host port", () => {
    expect(resolveBoundHostPort(3000, bindings)).toBe(3456);
  });

  it("returns null when neither side matches", () => {
    expect(resolveBoundHostPort(80, bindings)).toBeNull();
  });
});
