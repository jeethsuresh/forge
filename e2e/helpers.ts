import { expect, type Locator, type Page } from "@playwright/test";

export async function loginAsAdmin(page: Page): Promise<void> {
  const username = process.env.FORGE_ADMIN_USERNAME?.trim() || "admin";
  const password = process.env.FORGE_ADMIN_PASSWORD?.trim() || "admin";
  await page.goto("/login");
  await expect(page.getByLabel("Username")).toBeVisible();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Command center" })).toBeVisible();
}

export async function openFirstProject(page: Page): Promise<string> {
  const projectLink = page.locator('aside a[href^="/projects/"]').first();
  await expect(projectLink).toBeVisible();
  const href = (await projectLink.getAttribute("href")) ?? "";
  const id = href.split("/projects/")[1]?.split("/")[0] ?? "";
  if (!id) throw new Error("Could not parse project id from sidebar");
  await projectLink.click();
  await expect(page.locator("h1").first()).toBeVisible();
  return id;
}

export async function openProjectMode(
  page: Page,
  projectId: string,
  mode: "overview" | "deploy" | "agents" | "changes" | "settings",
): Promise<void> {
  const path =
    mode === "overview" ? `/projects/${projectId}` : `/projects/${projectId}/${mode}`;
  await page.goto(path);
  await expect(page.locator("h1").first()).toBeVisible();
}

export function primaryDeployCta(page: Page): Locator {
  return page.getByRole("button", {
    name: /^(Deploy now|Redeploy|Update)$/,
  });
}
