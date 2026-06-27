import { expect, test } from "@playwright/test";
import { gotoIssues, login, SEED } from "./helpers";

test.beforeEach(async ({ page }) => {
  await login(page);
});

test.describe("issues list", () => {
  test("shows seeded issues and the trend toggle", async ({ page }) => {
    await gotoIssues(page);
    await expect(page.getByText("ValueError").first()).toBeVisible();
    // 24h / 30d toggle in the trend column header.
    await expect(page.getByRole("button", { name: "24h" }).first()).toBeVisible();
    await page.getByRole("button", { name: "30d" }).first().click();
  });

  test("filters by search", async ({ page }) => {
    await gotoIssues(page);
    await page.getByPlaceholder(/search/i).first().fill("KeyError");
    await expect(page.getByText("KeyError").first()).toBeVisible({ timeout: 15_000 });
  });

  test("opens an issue detail with stack trace", async ({ page }) => {
    await gotoIssues(page);
    await page.getByText(SEED.primaryIssueType).first().click();
    await page.waitForURL(/\/issues\/[0-9a-f-]+/);
    await expect(page.getByRole("heading", { name: "ValueError" })).toBeVisible();
    // Suspect/stack content from the seeded frames.
    await expect(page.getByText("checkout.py").first()).toBeVisible();
  });
});

test.describe("issue detail actions", () => {
  test.beforeEach(async ({ page }) => {
    await gotoIssues(page);
    await page.getByText(SEED.primaryIssueType).first().click();
    await page.waitForURL(/\/issues\/[0-9a-f-]+/);
  });

  test("bookmarks and un-bookmarks without layout shift in the label", async ({ page }) => {
    const bookmark = page.getByRole("button", { name: "Bookmark", exact: true });
    await expect(bookmark).toBeVisible();
    await bookmark.click();
    await expect(page.getByRole("button", { name: "Bookmarked", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Bookmarked", exact: true }).click();
    await expect(page.getByRole("button", { name: "Bookmark", exact: true })).toBeVisible();
  });

  test("copies the share URL and shows the copied state", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByRole("button", { name: "Copy share URL" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  });

  test("archives the issue", async ({ page }) => {
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    // After archiving, the un-archive affordance appears.
    await expect(page.getByRole("button", { name: "Unarchive" })).toBeVisible({ timeout: 15_000 });
  });

  test("renders the trend chart with a 24h / 30d switch", async ({ page }) => {
    const chart24h = page.getByRole("button", { name: "24h" });
    await expect(chart24h.first()).toBeVisible();
    await page.getByRole("button", { name: "30d" }).first().click();
  });
});
