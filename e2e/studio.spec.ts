import { expect, test } from "@playwright/test";
import { loginAsAdmin, openFirstProject } from "./helpers";

test.describe("studio shell", () => {
  test("login rejects bad credentials then accepts admin", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password").fill("definitely-wrong");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Invalid credentials")).toBeVisible();

    await loginAsAdmin(page);
  });

  test("home shows fleet", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByText("Fleet", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add project" })).toBeVisible();
  });

  test("sidebar exposes studio modes for the first project", async ({ page }) => {
    await loginAsAdmin(page);
    const id = await openFirstProject(page);
    await expect(page.locator(`aside a[href="/projects/${id}/deploy"]`)).toBeVisible();
    await expect(page.locator(`aside a[href="/projects/${id}/agents"]`)).toBeVisible();
    await expect(page.locator(`aside a[href="/projects/${id}/changes"]`)).toBeVisible();
    await expect(page.locator(`aside a[href="/projects/${id}/settings"]`)).toBeVisible();
  });

  test("command palette opens from the keyboard", async ({ page }) => {
    await loginAsAdmin(page);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(
      page.getByPlaceholder("Projects, deploy, agents, settings… or help"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
