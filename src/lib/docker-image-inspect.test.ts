import { describe, expect, it } from "vitest";
import { inspectImageContainerPort } from "./docker-image-inspect";

describe("inspectImageContainerPort", () => {
  it("returns null for an image that is not present locally", async () => {
    const port = await inspectImageContainerPort(
      "forge.invalid/missing-image:not-real",
    );
    expect(port).toBeNull();
  });
});
