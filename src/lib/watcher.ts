import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { checkProjectForChanges } from "@/lib/deployer";
import { seedAdminUser } from "@/lib/auth/seed";

const POLL_INTERVAL_MS = 60_000;

declare global {
  var __forgeWatcherStarted: boolean | undefined;
}

async function pollAllProjects(): Promise<void> {
  const allProjects = db.select().from(projects).all();
  for (const project of allProjects) {
    if (project.enabled) {
      await checkProjectForChanges(project.id);
    }
  }
}

export async function startWatcher(): Promise<void> {
  if (globalThis.__forgeWatcherStarted) return;
  globalThis.__forgeWatcherStarted = true;

  await seedAdminUser();

  console.log("[forge] Starting deployment watcher (poll every 60s)");

  const tick = async () => {
    try {
      await pollAllProjects();
    } catch (err) {
      console.error("[forge] Watcher tick failed:", err);
    }
  };

  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}
