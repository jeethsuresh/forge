import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword } from "./password";

let seeded = false;

export async function seedAdminUser(): Promise<void> {
  if (seeded) return;

  const username = process.env.FORGE_ADMIN_USERNAME ?? "admin";
  const password = process.env.FORGE_ADMIN_PASSWORD ?? "admin";

  const existing = db.select().from(users).where(eq(users.username, username)).get();

  if (!existing) {
    const passwordHash = await hashPassword(password);
    db.insert(users)
      .values({
        id: randomUUID(),
        username,
        passwordHash,
        createdAt: new Date(),
      })
      .run();
  }

  seeded = true;
}
