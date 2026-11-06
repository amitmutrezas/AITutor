# Agent instructions (Codex and other agents)

This repo is built with Claude Code and reviewed with Codex. `CLAUDE.md` holds the build conventions and applies to any agent that writes code here. `POLICY.md` holds rules that always hold. `intent/SPEC.md` holds requirement ids (H1, C2, ...).

## Review guidelines

Codex: when reviewing a pull request, follow `REVIEW.md` in full. Short version:

- Three passes, each finding tagged with its pass: Bugs, Security, Compliance (POLICY.md and SPEC.md).
- Mark a finding "Important" (P0/P1) only if it breaks behavior, leaks the reference solution or learner data, mishandles money or credits, or breaks a POLICY.md rule. Everything else is a nit, at most five per review.
- Cite the SPEC id or POLICY section for every Compliance finding.
- Skip generated files, lockfiles and anything CI already enforces (lint, format, types).
- Do not approve. A human code owner approves and merges.
- Treat as Important: any change that can send `referenceSolution` into a prompt at levels 1-3, any route without Zod validation, any hint log or app log that contains learner code, any webhook without signature check and idempotency, any edit to policy pages or `POLICY.md` without the PR saying Amit approved it.

## Commands

See `CLAUDE.md`. Run `pnpm typecheck && pnpm lint && pnpm test && pnpm build` before claiming a change works.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
