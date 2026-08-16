import { readFileSync } from "fs";
import { defineConfig, devices } from "@playwright/test";

function loadForgeEnv(): void {
  for (const file of [".env", ".env.local"] as const) {
    try {
      const text = readFileSync(file, "utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
          continue;
        }
        const eq = trimmed.indexOf("=");
        const key = trimmed.slice(0, eq).trim();
        if (!key || process.env[key]) continue;
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    } catch {
      // missing env file is fine
    }
  }
}

loadForgeEnv();

const baseURL = (
  process.env.FORGE_OPS_API_BASE ?? "http://127.0.0.1:3000"
).replace(/\/$/, "");

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
