import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("health route", () => {
  it("N1: accepts a request with no query and rejects unexpected parameters", async () => {
    expect((await GET(new Request("http://localhost/api/health"))).status).toBe(200);
    expect((await GET(new Request("http://localhost/api/health?x=1"))).status).toBe(400);
  });
});
