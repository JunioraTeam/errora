import { expect, test } from "@playwright/test";
import { login, SEED } from "./helpers";

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("project card shows the name and the errors/transactions trend chart", async ({ page }) => {
  await page.goto("/en/projects");
  await expect(page.getByText(SEED.projectName).first()).toBeVisible({ timeout: 20_000 });
  // Chart legend on the card.
  await expect(page.getByText("Errors").first()).toBeVisible();
  await expect(page.getByText("Transactions").first()).toBeVisible();
});
