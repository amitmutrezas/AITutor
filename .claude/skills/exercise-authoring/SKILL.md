---
name: exercise-authoring
description: How to generate and verify exercises. Use when creating, editing or publishing anything in content/exercises or the generate and verify scripts.
---
# Exercise authoring

An exercise JSON has: id, title, statement, starterCode, tests, referenceSolution, fallbackHints (one string per level 1-5), status.

1. Generate with `pnpm exercises:generate`. This is offline and run by a person, never by a learner request.
2. Run `pnpm exercises:verify`. Tests must pass against `referenceSolution` and fail against `starterCode`. Failure means the exercise stays `draft`.
3. Fallback hints must be written the same way as live hints: a level 1-3 fallback contains no solution code.
4. A person reads each exercise end to end before `status: live`: statement is unambiguous, tests check behavior not implementation, difficulty fits an adult beginner.
5. Beginner JavaScript topics first: variables and functions, conditionals, loops, arrays, objects, string handling, simple recursion. Keep each exercise solvable in under 15 minutes.
6. Never change a live exercise's tests without re-running verify and noting it in the PR.
