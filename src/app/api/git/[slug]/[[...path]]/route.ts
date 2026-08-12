import { NextRequest } from "next/server";
import { handleGitSmartHttp } from "@/lib/git-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ slug: string; path?: string[] }> };

async function dispatch(request: NextRequest, ctx: RouteParams) {
  const { slug, path } = await ctx.params;
  return handleGitSmartHttp(request, slug, path ?? []);
}

export async function GET(request: NextRequest, ctx: RouteParams) {
  return dispatch(request, ctx);
}

export async function POST(request: NextRequest, ctx: RouteParams) {
  return dispatch(request, ctx);
}
