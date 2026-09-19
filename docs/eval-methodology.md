# CodexFlow Evaluation Methodology

## Objective

Measure whether an agent actually completes software-engineering tasks reliably.

## Benchmark design

Each benchmark should have:

- a fixed repository snapshot
- a natural-language task
- expected behavior
- deterministic tests
- optional regression tests
- evaluation metadata

## Run procedure

1. Create isolated worktree.
2. Record baseline commit.
3. Execute task.
4. Run verification.
5. Record failures.
6. Allow configured repair attempts.
7. Run final verification.
8. Record diff statistics.
9. Store evaluation.

## Metrics

### Pass@1

Whether the first attempt passes the benchmark.

### Pass@3

Whether the task passes within three attempts.

### Regression rate

Percentage of tasks where existing functionality is broken.

### Repair rate

Percentage of failed first attempts that require repair.

### Average retries

Average number of repair attempts.

### Duration

Time from task execution start to final result.

### Change size

Files changed, lines added, and lines removed.

## Rules

- Tests must execute for real.
- Do not use an LLM to declare test success.
- Keep benchmark repositories deterministic.
- Separate technical success from human preference.
- Store enough execution data to reproduce failures.
