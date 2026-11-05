import { test, expect } from "@playwright/test";

test("N6: landing page renders a heading", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
