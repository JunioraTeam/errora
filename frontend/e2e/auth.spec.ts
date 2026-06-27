import { expect, test } from "@playwright/test";
import { login, USER } from "./helpers";

test.describe("authentication", () => {
  test("logs in with phone + password and reaches the dashboard", async ({ page }) => {
    await login(page);
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("rejects a wrong password", async ({ page }) => {
    await page.goto("/en/login");
    await page.locator("#identifier").fill(USER.phone);
    await page.locator("#password").fill("totally-wrong");
    await page.getByRole("button", { name: "Continue" }).click();
    // Stays on the login page and surfaces an error.
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByText(/invalid|incorrect|wrong/i).first()).toBeVisible();
  });

  test("validates the phone format before submitting", async ({ page }) => {
    await page.goto("/en/login");
    await page.locator("#identifier").fill("12345");
    await page.locator("#password").fill(USER.password);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
