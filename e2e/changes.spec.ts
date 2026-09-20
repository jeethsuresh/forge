import { expect, test } from "@playwright/test";
import { loginAsAdmin, openFirstProject, openProjectMode } from "./helpers";

test.describe("changes mode", () => {
  test("shows the per-branch editor", async ({ page }) => {
    await loginAsAdmin(page);
    const id = await openFirstProject(page);
    await openProjectMode(page, id, "changes");
    await expect(page.getByRole("heading", { name: "Changes" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Branch" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Uncommitted" })).toHaveCount(0);
  });

  test("keeps the branch editor on the changes route", async ({ page }) => {
    await loginAsAdmin(page);
    const id = await openFirstProject(page);
    await openProjectMode(page, id, "changes");
    await expect(page).toHaveURL(/\/changes/);
    await expect(page.getByRole("heading", { name: "Changes" })).toBeVisible();
  });
});
