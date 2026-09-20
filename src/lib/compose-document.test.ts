import { describe, expect, it } from "vitest";
import {
  parseComposeYaml,
  stringifyCompose,
  viewOnlyServiceKeys,
} from "./compose-document";

describe("parseComposeYaml", () => {
  it("preserves unknown keys through stringify", () => {
    const yaml = `services:
  app:
    image: nginx:latest
    labels:
      com.example: keep-me
    x-custom: 1
`;
    const parsed = parseComposeYaml(yaml);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings).toEqual([]);
    expect(viewOnlyServiceKeys(parsed.services.app)).toEqual(
      expect.arrayContaining(["labels", "x-custom"]),
    );
    const round = stringifyCompose(parsed.doc);
    const again = parseComposeYaml(round);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.services.app.labels).toEqual({ "com.example": "keep-me" });
    expect(again.services.app["x-custom"]).toBe(1);
  });

  it("warns when app is missing", () => {
    const parsed = parseComposeYaml("services:\n  web:\n    image: nginx\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings.some((w) => w.includes('"app"'))).toBe(true);
  });

  it("rejects invalid YAML", () => {
    const parsed = parseComposeYaml("services: [");
    expect(parsed.ok).toBe(false);
  });
});
