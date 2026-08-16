import { expect, test } from "@playwright/test";
import { loginAsAdmin, openFirstProject, openProjectMode, primaryDeployCta } from "./helpers";

test.describe("deploy mode", () => {
  test("exposes branch selector and primary CTA without firing it", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const id = await openFirstProject(page);
    await openProjectMode(page, id, "deploy");

    await expect(
      page.getByText(/^(Redeploy branch|Deploy branch)$/),
    ).toBeVisible();
    await expect(page.locator("select").first()).toBeEnabled();

    const cta = primaryDeployCta(page);
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
  });

  test("shows deploy target ports, watch branch, and git tree", async ({ page }) => {
    await loginAsAdmin(page);
    const id = await openFirstProject(page);
    await openProjectMode(page, id, "deploy");

    await expect(page.getByText("Deploy target ports")).toBeVisible();
    await expect(page.getByText("Watch branch")).toBeVisible();
    await expect(page.getByRole("button", { name: /Git tree/ })).toBeVisible();
  });
});
