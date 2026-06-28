import { expect, type Page } from "@playwright/test";

/** Credentials seeded by `python manage.py seed_e2e` (apps/issues). */
export const USER = { email: "e2e@errora.dev", password: "Password123!" };
export const SEED = {
  projectName: "E2E Project",
  primaryIssueType: "ValueError",
};

/** Log in through the real UI (English locale) and land on the dashboard. */
export async function login(page: Page) {
  await page.goto("/en/login");
  await page.locator("#identifier").fill(USER.email);
  await page.locator("#password").fill(USER.password);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

/** Open the issues list and wait for the seeded rows to render. */
export async function gotoIssues(page: Page) {
  await page.goto("/en/issues");
  await expect(page.getByText(SEED.primaryIssueType).first()).toBeVisible({ timeout: 20_000 });
}
