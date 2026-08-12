import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import {
  addGitSshKey,
  listGitSshKeys,
  removeGitSshKey,
  authorizedKeysPath,
} from "@/lib/git-ssh";
import type { GitSshKeyScope } from "@/lib/db/schema";

async function requireLogin() {
  const session = await getSession();
  if (!session.isLoggedIn) return null;
  return session;
}

export async function GET() {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    keys: listGitSshKeys().map((k) => ({
      id: k.id,
      name: k.name,
      fingerprint: k.fingerprint,
      scope: k.scope,
      publicKey: k.publicKey,
      createdAt: k.createdAt,
    })),
    authorizedKeysPath: authorizedKeysPath(),
  });
}

export async function POST(request: Request) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    name?: string;
    publicKey?: string;
    scope?: GitSshKeyScope;
  };

  try {
    const key = addGitSshKey({
      name: body.name ?? "",
      publicKey: body.publicKey ?? "",
      scope: body.scope,
    });
    return NextResponse.json(
      {
        id: key.id,
        name: key.name,
        fingerprint: key.fingerprint,
        scope: key.scope,
        publicKey: key.publicKey,
        createdAt: key.createdAt,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add key";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireLogin();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const removed = removeGitSshKey(id);
  if (!removed) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
