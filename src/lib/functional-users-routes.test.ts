import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getSession: async () => ({ isLoggedIn: false }),
}));

import { GET, POST } from "@/app/api/settings/functional-users/route";
import { DELETE } from "@/app/api/settings/functional-users/[id]/route";
import { POST as regenerate } from "@/app/api/settings/functional-users/[id]/regenerate/route";

describe("functional user settings routes", () => {
  it("requires a dashboard login for list, register, rotate, and revoke", async () => {
    const list = await GET();
    expect(list.status).toBe(401);

    const create = await POST(
      new Request("http://localhost/api/settings/functional-users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "should-fail" }),
      }),
    );
    expect(create.status).toBe(401);

    const rotate = await regenerate(
      new Request("http://localhost/api/settings/functional-users/x/regenerate", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(rotate.status).toBe(401);

    const revoke = await DELETE(
      new Request("http://localhost/api/settings/functional-users/x", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "x" }) },
    );
    expect(revoke.status).toBe(401);
  });
});
