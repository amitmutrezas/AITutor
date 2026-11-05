import { defineConfig } from "vitest/config";

// Separate config so `*.eval.ts` files run only under `pnpm evals:product`, not `pnpm test`.
export default defineConfig({
  test: { include: ["evals/product/**/*.eval.ts"] },
});
