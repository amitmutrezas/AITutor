import { describe, expect, it } from "vitest";
import { pickNewest } from "./code-store";

describe("A2: editor code survives a reload", () => {
  it("A2: uses whichever copy is newer", () => {
    expect(pickNewest({ code: "server", at: 10 }, { code: "local", at: 20 })).toBe("local");
    expect(pickNewest({ code: "server", at: 30 }, { code: "local", at: 20 })).toBe("server");
  });
  it("A2: falls back to the one copy that exists, or null", () => {
    expect(pickNewest(null, { code: "local", at: 1 })).toBe("local");
    expect(pickNewest({ code: "server", at: 1 }, null)).toBe("server");
    expect(pickNewest(null, null)).toBeNull();
  });
  it("A2: an empty saved string is still restored (the learner cleared the editor)", () => {
    expect(pickNewest({ code: "", at: 1 }, null)).toBe("");
  });
});
