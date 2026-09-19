# CodexFlow Demo

1. Import a disposable GitHub clone and scan it.
2. Create one of four tasks: bug fix, refactor, security review, or test
   generation.
3. Start it from the dashboard and observe persisted strategy, Planner, Coder,
   specialist, Reviewer, Tester, and Repair results.
4. Inspect isolated workspace, actual test commands, review findings, diff, and
   risk. For a failing fixture, show the bounded Repair → Reviewer → Tester
   loop.
5. Approve only after `READY_FOR_APPROVAL`.
6. Show durable commit/push/PR checkpoints and refresh the PR. Confirm delivery
   SHA, remote branch SHA, and PR head SHA match.
7. Open Evaluation and Operations to distinguish persisted technical outcomes
   from delivery and operational health.

Use `pnpm test:e2e`, `pnpm test:openai-e2e`, and `pnpm test:github-e2e` as
explicit demonstration evidence; do not claim a skipped external run passed.
