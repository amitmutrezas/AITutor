import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

describe("A1: sign-in return path", () => {
  it("A1: keeps a same-site path with its query", () => {
    expect(safeNextPath("/checkout?plan=basic")).toBe("/checkout?plan=basic");
    expect(safeNextPath("/exercises/sum-of-array")).toBe("/exercises/sum-of-array");
  });
  it("A1: falls back to the account page for anything that could leave the site", () => {
    for (const bad of [
      undefined,
      "",
      "https://evil.example/x",
      "//evil.example/x",
      "/\\evil.example",
      "javascript:alert(1)",
      "checkout",
      "/ok\n/evil",
      "/" + "a".repeat(300),
    ]) {
      expect(safeNextPath(bad), String(bad)).toBe("/account");
    }
  });
  it("A1: takes the first value when the parameter is repeated", () => {
    expect(safeNextPath(["/plans", "https://evil.example"])).toBe("/plans");
  });
});
