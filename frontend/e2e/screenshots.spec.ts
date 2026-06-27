/**
 * Capture README screenshots from the seeded app. Not an assertion suite — it
 * just drives the real UI and writes PNGs to `docs/images/`. Runs as part of the
 * e2e suite (harmless) or on its own: `pnpm exec playwright test screenshots`.
 */
import { test } from "@playwright/test";
import { gotoIssues, login, SEED } from "./helpers";

const DIR = "../docs/images";

// Capture is opt-in (`pnpm e2e:shots`) so the normal assertion suite stays fast
// and doesn't rewrite committed images.
const capture = process.env.CAPTURE ? test : test.skip;

test.use({ viewport: { width: 1440, height: 900 } });

capture("capture README screenshots", async ({ page }) => {
  await login(page);

  // Issues list (hero).
  await gotoIssues(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/issues.png` });

  // Issue detail — stack trace + trend chart.
  await page.getByText(SEED.primaryIssueType).first().click();
  await page.waitForURL(/\/issues\/[0-9a-f-]+/);
  await page.getByRole("heading", { name: "ValueError" }).waitFor();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${DIR}/issue-detail.png`, fullPage: true });

  // Projects — cards with errors/transactions trend charts.
  await page.goto("/en/projects");
  await page.getByText(SEED.projectName).first().waitFor();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${DIR}/projects.png` });

  // Performance — transactions.
  await page.goto("/en/performance");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${DIR}/performance.png` });

  // Logs.
  await page.goto("/en/logs");
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${DIR}/logs.png` });
});
