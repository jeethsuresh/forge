#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "local-loop.ts");
const child = spawn(
  process.execPath,
  ["--experimental-strip-types", script, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
child.on("exit", (code) => {
  process.exit(code ?? 1);
});
