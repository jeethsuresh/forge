import { expect, test } from "@playwright/test";
import { loginAsAdmin, openFirstProject, openProjectMode } from "./helpers";

test.describe("changes mode", () => {
  test("shows the uncommitted diff workspace", async ({ page }) => {
    await loginAsAdmin(page);
    const id = await openFirstProject(page);
    await openProjectMode(page, id, "changes");
    await expect(page.getByRole("heading", { name: "Changes" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Uncommitted" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
  });

  test("switches branch-vs-watch and commit-range modes", async ({ page }) => {
    await loginAsAdmin(page);
    const id = await openFirstProject(page);
    await openProjectMode(page, id, "changes");

    await page.getByRole("button", { name: "Branch vs watch" }).click();
    await expect(page.getByRole("heading", { name: "Changes" })).toBeVisible();
    await expect(page).toHaveURL(/mode=branch-vs-main/);

    await page.getByRole("button", { name: "Commit range" }).click();
    await expect(page).toHaveURL(/mode=range/);
    await expect(page.getByRole("heading", { name: "Changes" })).toBeVisible();
  });
});
