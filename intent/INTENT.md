# Intent: AI coding tutor that gives hints, not answers

Author: Amit. Status: draft for approval. Working product name: "Unstuck" (placeholder).
Sources: Discovery Brief, Product Definition (approved), Design Handoff and lo-fi prototype (design gate not passed, no user tests yet).

## Problem

Adults switching careers into tech learn to code alone, in the evenings, and pay out of pocket. When they get stuck on an exercise they have two bad options: copy the answer from a general chatbot and learn nothing, or stay stuck and quit. Existing tutors either hand over the solution or give vague encouragement.

## Proposed outcome

A web app where a learner works an exercise in the browser and, when stuck, asks for help on a five-level ladder: Nudge, Concept, Locate, Scaffold, Reveal. Early levels cannot leak the solution because the model never sees it. Higher levels cost monthly credits, so learners are nudged to try again before spending them. Two paid plans (Basic, Advanced) differ only by monthly credits.

The belief being tested: career switchers will pay for a tutor that teaches instead of tells. This is a belief. Nobody has interviewed a user yet.

## Affected users and systems

- Learners: adult career switchers (primary).
- Amit: owner, operator, sole approver. Contributors may join since the repo is open source.
- Systems: Vercel (hosting), Razorpay (payments, activation and KYC pending), an LLM API for hints and exercise generation, a database for accounts, credits and saved code.

## Constraints

- Launch target is very soon (about 2 days from 2026-11-05). Scope stays small. Anything in the "Out of first release" list of SPEC.md stays out.
- The solution never enters the model's context at Nudge, Concept or Locate. Enforced in code, not in the prompt.
- Every AI-generated exercise must pass its own tests against its own reference solution before it is shown to a learner.
- Learner code is stored so learners can return to it (Amit confirmed). Store the minimum, say what is stored, and let learners delete it.
- Credits are counted and enforced by the app, never by the model.
- Open source from day one. No secrets, keys or learner data in the repo.
- Production on Vercel with live Razorpay keys. Money, secrets and production deploys need Amit's explicit approval.

## Success

- Paying subscribers on Basic or Advanced (baseline 0, target for Amit to set).
- Stuck exercises finished without a Reveal (article's 70% is a guess, treat it as a hypothesis).
- Hints that leak the solution under 1% on a pre-launch audit of the exercise set.
- AI cost per active learner per month stays under plan price.
- Conversations with real career switchers (baseline 0, target for Amit to set).

## Open questions

Tracked in `intent/PLAN.md` under "Decisions needed from Amit". The blocking ones: exercise language, plan prices and credit amounts, how learner code runs, who reviews the legal text of the policy pages.
