import { expect, test } from "@playwright/test";
import { loginAsAdmin, openFirstProject, openProjectMode } from "./helpers";

test.describe("settings", () => {
  test("project settings show the Project section", async ({ page }) => {
    await loginAsAdmin(page);
    const id = await openFirstProject(page);
    await openProjectMode(page, id, "settings");
    await expect(
      page.getByRole("heading", { name: "Project", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /^(Update history|Deployment history)$/ }),
    ).toBeVisible();
  });

  test("global appearance toggles light and dark without leaving system restore", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Global settings" })).toBeVisible();
    await page.getByRole("button", { name: "Appearance" }).click();
    await expect(page.getByRole("heading", { name: "Appearance" })).toBeVisible();

    await page.getByRole("button", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "System" }).click();
  });

  test("global routing and git ssh tabs load", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Project routing" }).click();
    await expect(
      page.getByText("Associate one or more live Caddy routes").or(
        page.getByText("Loading project routing settings…"),
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Git SSH" }).click();
    await expect(page.getByRole("heading", { name: "Git SSH keys" })).toBeVisible();
  });
});
