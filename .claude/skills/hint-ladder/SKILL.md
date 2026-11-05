---
name: hint-ladder
description: Rules for the five-level hint ladder. Use whenever creating or changing hint prompts, the leak check, fallbacks, credit costs per level, or the hint API route.
---
# Hint ladder

Levels: 1 Nudge, 2 Concept, 3 Locate, 4 Scaffold, 5 Reveal. Costs: 0, 0, 1, 2, 3 credits (config in `lib/config`).

When you touch hint code:
1. The prompt builder takes a typed input that has no `referenceSolution` field for levels 1-3. Make the type system enforce it, then add or update the H2 test.
2. Load the exercise with an explicit column list. Never `select *` in hint code.
3. Every hint at levels 1-4 goes through the leak check. A thrown error, timeout or trip returns the stored fallback for that exercise and level, logs the event, and does not charge credits.
4. Level behavior:
   - Nudge: one question or observation that points at where to look. No code.
   - Concept: name the idea the learner needs. No code from the solution.
   - Locate: point to the line or block that is wrong and why. No replacement code.
   - Scaffold: a partial structure with gaps for the learner to fill. Must not contain the full solution.
   - Reveal: the solution with an explanation. Leak check skipped for this level only.
5. Hints never exceed 120 words except Reveal.
6. Run `pnpm evals:product`. Leak recall on the known-leaky set must stay at or above 95%.
7. Never log learner code. Log the hash.
