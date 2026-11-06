import { describe, expect, it, vi } from "vitest";
import type { Authenticate } from "../auth/types";
import { SAVED_CODE } from "../config";
import type { RpcClient } from "../db/rpc";
import { createSavedCodeHandlers } from "./handler";
import { InMemorySavedCode, createSupabaseSavedCode, type SavedCodePort } from "./service";

const auth: Authenticate = async (req) => {
  const id = req.headers.get("x-test-user");
  return id ? { id, email: `${id}@example.com` } : null;
};

function setup(savedCode: SavedCodePort = new InMemorySavedCode()) {
  return { h: createSavedCodeHandlers({ authenticate: auth, savedCode }), savedCode };
}
const call = (method: string, query = "", body?: unknown, user: string | null = "u1") =>
  new Request(`http://x/api/saved-code${query}`, {
    method,
    headers: user ? { "x-test-user": user } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("A2: saved code API", () => {
  it("A2: every method requires a signed-in user", async () => {
    const { h } = setup();
    expect((await h.GET(call("GET", "", undefined, null))).status).toBe(401);
    expect(
      (await h.PUT(call("PUT", "", { exerciseId: "sum-array", code: "x" }, null))).status,
    ).toBe(401);
    expect((await h.DELETE(call("DELETE", "?all=true", undefined, null))).status).toBe(401);
  });

  it("A2: save on run keeps only the latest code per exercise, and the list returns it", async () => {
    const { h } = setup();
    await h.PUT(call("PUT", "", { exerciseId: "sum-array", code: "v1" }));
    await h.PUT(call("PUT", "", { exerciseId: "sum-array", code: "v2" }));
    await h.PUT(call("PUT", "", { exerciseId: "is-palindrome", code: "p" }));
    const body = await (await h.GET(call("GET"))).json();
    expect(body.items).toHaveLength(2);
    expect(body.items.find((i: { exerciseId: string }) => i.exerciseId === "sum-array").code).toBe(
      "v2",
    );
  });

  it("A2: users only see and delete their own code", async () => {
    const { h } = setup();
    await h.PUT(call("PUT", "", { exerciseId: "sum-array", code: "mine" }));
    await h.PUT(call("PUT", "", { exerciseId: "sum-array", code: "theirs" }, "u2"));
    expect((await (await h.GET(call("GET"))).json()).items[0].code).toBe("mine");
    await h.DELETE(call("DELETE", "?all=true"));
    expect((await (await h.GET(call("GET"))).json()).items).toEqual([]);
    expect((await (await h.GET(call("GET", "", undefined, "u2"))).json()).items[0].code).toBe(
      "theirs",
    );
  });

  it("A2: delete one removes only that exercise", async () => {
    const { h } = setup();
    await h.PUT(call("PUT", "", { exerciseId: "sum-array", code: "a" }));
    await h.PUT(call("PUT", "", { exerciseId: "is-palindrome", code: "b" }));
    const res = await h.DELETE(call("DELETE", "?exerciseId=sum-array"));
    expect(await res.json()).toEqual({ deleted: 1 });
    const items = (await (await h.GET(call("GET"))).json()).items;
    expect(items.map((i: { exerciseId: string }) => i.exerciseId)).toEqual(["is-palindrome"]);
    expect(await (await h.DELETE(call("DELETE", "?exerciseId=sum-array"))).json()).toEqual({
      deleted: 0,
    });
  });

  it("A2: delete all removes everything and reports the count", async () => {
    const { h } = setup();
    await h.PUT(call("PUT", "", { exerciseId: "a", code: "1" }));
    await h.PUT(call("PUT", "", { exerciseId: "b", code: "2" }));
    expect(await (await h.DELETE(call("DELETE", "?all=true"))).json()).toEqual({ deleted: 2 });
    expect((await (await h.GET(call("GET"))).json()).items).toEqual([]);
  });

  it("A2: input is validated by Zod: unknown fields, bad ids and oversize code are 400", async () => {
    const { h } = setup();
    const put = (b: unknown) => h.PUT(call("PUT", "", b));
    expect((await put({ exerciseId: "a", code: "x", extra: 1 })).status).toBe(400);
    expect((await put({ exerciseId: "../etc", code: "x" })).status).toBe(400);
    expect((await put({ exerciseId: "A B", code: "x" })).status).toBe(400);
    expect((await put({ exerciseId: "a" })).status).toBe(400);
    expect((await put({ exerciseId: "a", code: "x".repeat(SAVED_CODE.maxChars + 1) })).status).toBe(
      400,
    );
    expect((await put({ exerciseId: "a", code: "x".repeat(SAVED_CODE.maxChars) })).status).toBe(
      200,
    );
    expect(
      (
        await h.PUT(
          new Request("http://x/api/saved-code", {
            method: "PUT",
            headers: { "x-test-user": "u1" },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
  });

  it("A2: delete needs exactly one of exerciseId or all=true, so a bare DELETE never wipes data", async () => {
    const { h, savedCode } = setup();
    await h.PUT(call("PUT", "", { exerciseId: "a", code: "1" }));
    expect((await h.DELETE(call("DELETE"))).status).toBe(400);
    expect((await h.DELETE(call("DELETE", "?all=false"))).status).toBe(400);
    expect((await h.DELETE(call("DELETE", "?all=true&exerciseId=a"))).status).toBe(400);
    expect((await h.DELETE(call("DELETE", "?foo=1"))).status).toBe(400);
    expect(await savedCode.list("u1")).toHaveLength(1);
  });

  it("N3: errors are generic and never echo or log the learner's code", async () => {
    const logs = [
      vi.spyOn(console, "error"),
      vi.spyOn(console, "info"),
      vi.spyOn(console, "warn"),
      vi.spyOn(console, "log"),
    ];
    const failing: SavedCodePort = {
      save: async () => {
        throw new Error("insert failed for code: SECRET_LEARNER_CODE");
      },
      list: async () => [],
      deleteOne: async () => false,
      deleteAll: async () => 0,
    };
    const { h } = setup(failing);
    const res = await h.PUT(call("PUT", "", { exerciseId: "a", code: "SECRET_LEARNER_CODE" }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("SECRET_LEARNER_CODE");
    const logged = logs.flatMap((s) => s.mock.calls.flat().map(String)).join("\n");
    logs.forEach((s) => s.mockRestore());
    expect(logged).not.toContain("SECRET_LEARNER_CODE");
  });
});

describe("A2: saved code (Supabase adapter)", () => {
  it("A2: maps to the SQL functions and converts row names", async () => {
    const calls: { fn: string; args?: Record<string, unknown> }[] = [];
    const client: RpcClient = {
      async rpc(fn, args) {
        calls.push({ fn, args });
        const data: Record<string, unknown> = {
          saved_code_upsert: "2026-01-01T00:00:00Z",
          saved_code_list: [{ exercise_id: "a", code: "c", updated_at: "2026-01-01T00:00:00Z" }],
          saved_code_delete: true,
          saved_code_delete_all: 3,
        };
        return { data: data[fn], error: null };
      },
    };
    const s = createSupabaseSavedCode(client);
    await s.save("u1", "a", "c");
    expect(await s.list("u1")).toEqual([
      { exerciseId: "a", code: "c", updatedAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(await s.deleteOne("u1", "a")).toBe(true);
    expect(await s.deleteAll("u1")).toBe(3);
    expect(calls.map((c) => c.fn)).toEqual([
      "saved_code_upsert",
      "saved_code_list",
      "saved_code_delete",
      "saved_code_delete_all",
    ]);
    expect(calls[0].args).toEqual({ p_user: "u1", p_exercise: "a", p_code: "c" });
  });
});
