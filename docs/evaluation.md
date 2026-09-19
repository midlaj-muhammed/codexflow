# CodexFlow Evaluation

Evaluation runs controlled benchmark tasks through the real `RuntimeExecutor`.
Each persisted result identifies the benchmark task, repository commit, task,
provider/model when available, lifecycle outcome, verification, repair count,
diff statistics, and Phase 15 strategy/stage provenance.

Metrics are derived from persisted records: Pass@1, Pass@N where meaningful,
technical-success rate, repair and repair-success rates, blocked and
verification-failure rates, duration, and diff statistics. Token and cost data
are `unknown` when a provider does not return them; CodexFlow never substitutes
zero or estimated values.

Technical success and human approval are intentionally separate signals.
