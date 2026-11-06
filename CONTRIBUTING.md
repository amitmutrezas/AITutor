# Contributing

Thanks for wanting to help. This is a small project, so the process is short.

## Before you start

- Read `intent/SPEC.md` (what the product must do) and `POLICY.md` (rules that always hold). Changes are checked against both.
- For anything bigger than a small fix, open an issue first so we can agree on the approach before you spend the time.
- Some things are deliberately out of the first release (the list is in `intent/SPEC.md`). PRs that add them will be asked to wait.

## Setup

```bash
pnpm install
pnpm dev
```

See the README for environment variables. You can work on exercises, the runner and the UI without any keys. Use test mode only for payments and the model; never commit real keys or any secret.

## Making a change

1. Branch from `main`. Name it `<your-handle>/<short-slug>`.
2. Keep the change focused. One concern per pull request.
3. Name tests after the requirement id they cover, for example `H2: levels 1-3 prompt never contains solution`. For a bug fix, write the failing test first.
4. Run these and make sure they pass before you open the PR:
   ```bash
   pnpm typecheck
   pnpm lint        # zero warnings
   pnpm test
   pnpm build
   ```
   If you touched exercises, also run `pnpm exercises:verify`. If you touched hint code, run `pnpm evals:product`.
5. Open a pull request using the template. Cite the requirement ids from `intent/SPEC.md` and paste real test output.

## Code rules that matter here

- TypeScript strict. No `any` without a comment saying why.
- Validate every route input with Zod.
- Credits are integers, changed only in `lib/credits`, inside a database transaction. The model never decides a balance.
- Config such as thresholds, credit costs and model names lives in `lib/config`, not inline.
- Never load `referenceSolution` in any code path that serves hint levels 1 to 3. Select columns explicitly.
- Never log learner code. Log a hash.
- Learner code runs in the browser sandbox only, never on the server.
- Don't add a dependency without saying why in the PR description.

## Adding or editing exercises

Exercises are JSON files in `content/exercises/`. A new exercise starts as `draft`, has to pass its own tests (`pnpm exercises:verify` moves it to `verified`), and a maintainer reads it before it goes `live`. JavaScript only for now.

## Review

Pull requests are reviewed against `REVIEW.md` (bugs, security, compliance with the spec and policy). Fix findings on the same branch, or reply with your reason if you disagree. A maintainer merges once CI is green and review is done.

## Files you can't change without a maintainer's say

`POLICY.md`, `REVIEW.md`, `intent/INTENT.md`, `intent/SPEC.md`, `.claude/`, `.github/workflows/` and `CODEOWNERS` are protected. Open an issue to propose a change to them.

## Security

Please don't file public issues for security problems. Email the maintainer (see the repository owner's profile) and give them time to fix it first.

## License

By contributing you agree your work is released under the [MIT license](LICENSE).
