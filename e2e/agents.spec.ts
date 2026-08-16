import { expect, test } from "@playwright/test";
import { loginAsAdmin, openFirstProject, openProjectMode } from "./helpers";

test.describe("agents mode", () => {
  test("loads the branch workspace without starting a session", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const id = await openFirstProject(page);
    await openProjectMode(page, id, "agents");

    await expect(
      page.getByText("Queue agents on different branches"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New" })).toBeVisible();
  });

  test("new-branch form is available and can be dismissed", async ({ page }) => {
    await loginAsAdmin(page);
    const id = await openFirstProject(page);
    await openProjectMode(page, id, "agents");
    await page.getByRole("button", { name: "+ New" }).click();
    await expect(page.getByPlaceholder("agent/my-feature")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  });
});
