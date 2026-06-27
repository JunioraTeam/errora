import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("creates an MCP personal access token shown once", async ({ page }) => {
  await login(page);
  await page.goto("/en/settings");

  // Open the MCP tab.
  await page.getByText("MCP", { exact: true }).first().click();

  await expect(page.locator("#token-name")).toBeVisible({ timeout: 15_000 });
  await page.locator("#token-name").fill("Playwright token");
  await page.getByRole("button", { name: "Create token" }).click();

  // The raw token is revealed exactly once and uses the errora_pat_ prefix.
  await expect(page.getByText(/errora_pat_[A-Za-z0-9_-]+/).first()).toBeVisible({
    timeout: 15_000,
  });
});
