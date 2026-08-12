import { NextResponse } from "next/server";
import {
  processPostReceiveNotify,
  verifyGitHookSecret,
  type PostReceivePayload,
} from "@/lib/git-hook-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (
    !verifyGitHookSecret(request.headers.get("x-forge-git-hook-secret"))
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PostReceivePayload;
  try {
    body = (await request.json()) as PostReceivePayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await processPostReceiveNotify(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /Unknown|No project/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
