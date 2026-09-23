import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { gitRepositories } from "@/lib/db/schema";
import { getSession } from "@/lib/auth/session";
import { bareRepoHasCommits } from "@/lib/git-repo";
import { barePathForSlug } from "@/lib/git-paths";
import { createRepositoryBundle } from "@/lib/migration/git-transfer";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const session = await getSession();
  if (!session.isLoggedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { slug: raw } = await params;
  const slug = decodeURIComponent(raw).replace(/\.bundle$/i, "").trim();
  try {
    barePathForSlug(slug);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid repository slug";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const repo = db
    .select()
    .from(gitRepositories)
    .where(eq(gitRepositories.slug, slug))
    .get();
  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }
  if (!bareRepoHasCommits(repo.barePath)) {
    return NextResponse.json(
      { error: "Repository has no commits" },
      { status: 409 },
    );
  }

  try {
    const bundle = await createRepositoryBundle(repo.barePath);
    return new NextResponse(new Uint8Array(bundle), {
      headers: {
        "content-type": "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to bundle repository";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
