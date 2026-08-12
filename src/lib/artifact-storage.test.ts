import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  createDiskArtifactStorage,
  verifyArtifactDownloadToken,
} from "@/lib/artifact-storage";

describe("createDiskArtifactStorage", () => {
  let rootDir: string;
  let sourceDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), "artifact-store-"));
    sourceDir = mkdtempSync(join(tmpdir(), "artifact-src-"));
    process.env.FORGE_ARTIFACT_DOWNLOAD_SECRET = "test-artifact-download-secret";
  });

  afterEach(() => {
    rmSync(rootDir, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
    delete process.env.FORGE_ARTIFACT_DOWNLOAD_SECRET;
  });

  it("puts, gets, and deletes files by key", async () => {
    const storage = createDiskArtifactStorage(rootDir);
    const localPath = join(sourceDir, "payload.bin");
    writeFileSync(localPath, Buffer.from("hello-artifact"));

    const put = await storage.put("proj/cli/build-1/payload.bin", localPath);
    expect(put.sizeBytes).toBe(14);

    const got = await storage.get("proj/cli/build-1/payload.bin");
    expect(got).not.toBeNull();
    expect(readFileSync(got!.absolutePath, "utf8")).toBe("hello-artifact");

    await storage.delete("proj/cli/build-1/payload.bin");
    expect(await storage.get("proj/cli/build-1/payload.bin")).toBeNull();
  });

  it("signedDownload returns a verifiable token", async () => {
    const storage = createDiskArtifactStorage(rootDir);
    const localPath = join(sourceDir, "a.txt");
    writeFileSync(localPath, "x");
    await storage.put("k/a.txt", localPath);

    const signed = await storage.signedDownload("k/a.txt", 60);
    expect(signed.urlPath).toContain("token=");
    expect(signed.token).toBeTruthy();
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());

    expect(
      verifyArtifactDownloadToken(signed.token, "k/a.txt", signed.expiresAt),
    ).toBe(true);
    expect(
      verifyArtifactDownloadToken(signed.token, "other/key", signed.expiresAt),
    ).toBe(false);
  });

  it("rejects path traversal keys", async () => {
    const storage = createDiskArtifactStorage(rootDir);
    const localPath = join(sourceDir, "x.bin");
    writeFileSync(localPath, "x");
    await expect(storage.put("../escape.bin", localPath)).rejects.toThrow(
      /invalid/i,
    );
  });
});
