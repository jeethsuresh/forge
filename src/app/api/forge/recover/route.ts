import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { forgeUpdates } from "@/lib/db/schema";
import { attemptForgeSelfUpdateRecovery } from "@/lib/deploy-recovery";
import { APP_DISPLAY_NAME } from "@/lib/app-name";

export const dynamic = "force-dynamic";
export const maxDuration = 1800;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    updateId?: string;
    errorMessage?: string;
  } | null;

  const updateId = body?.updateId?.trim();
  if (!updateId) {
    return NextResponse.json({ error: "updateId is required" }, { status: 400 });
  }

  const update = db
    .select()
    .from(forgeUpdates)
    .where(eq(forgeUpdates.id, updateId))
    .get();

  if (!update) {
    return NextResponse.json({ error: "Update not found" }, { status: 404 });
  }

  const branch = process.env.FORGE_SELF_BRANCH?.trim() || "main";
  const recovered = await attemptForgeSelfUpdateRecovery({
    updateId,
    errorMessage: body?.errorMessage ?? update.errorMessage ?? `${APP_DISPLAY_NAME} update failed`,
    logs: update.logs,
    branch,
  });

  return NextResponse.json({ recovered });
}
