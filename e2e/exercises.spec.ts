import { test, expect } from "@playwright/test";

test("R2: open an exercise, run failing tests, see per-test results", async ({ page }) => {
  await page.goto("/exercises");
  await page.getByRole("link", { name: "Sum an array" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sum an array" })).toBeVisible();

  await page.getByRole("button", { name: "Run tests" }).click();
  const results = page.getByTestId("results");
  await expect(results).toContainText("tests failing");
  await expect(results).toContainText("sum([1, 2, 3]) should be 6");
});

test("R1: passing code shows the complete state and marks the exercise solved", async ({ page }) => {
  await page.goto("/exercises/sum-array");
  await page.getByLabel("Your code (JavaScript)").fill(
    "function sum(n) { return n.reduce((a, b) => a + b, 0); }",
  );
  await page.getByRole("button", { name: "Run tests" }).click();
  await expect(page.getByRole("heading", { name: "Exercise complete" })).toBeVisible();
  await page.goto("/exercises");
  await expect(page.getByText("Solved", { exact: true })).toBeVisible();
});

test("R1: an infinite loop times out instead of hanging the page", async ({ page }) => {
  await page.goto("/exercises/sum-array");
  await page.getByLabel("Your code (JavaScript)").fill("function sum() { while (true) {} }");
  await page.getByRole("button", { name: "Run tests" }).click();
  await expect(page.getByTestId("results")).toContainText("Timed out", { timeout: 6000 });
});

test("N4: hint ladder stub lists five levels and has no enabled hint buttons", async ({ page }) => {
  await page.goto("/exercises/sum-array");
  const ladder = page.getByRole("region", { name: "Hint ladder" });
  await expect(ladder.getByRole("listitem")).toHaveCount(5);
  await expect(ladder.getByRole("button").first()).toBeDisabled();
});
