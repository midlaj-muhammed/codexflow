# The complete CodexFlow runtime needs Node's built-in SQLite support and Git
# for managed clones and isolated worktrees.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install --no-install-recommends -y git tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . ./

RUN corepack enable \
  && pnpm install --frozen-lockfile \
  && pnpm --filter @codexflow/web build

ENV NODE_ENV=production
ENV CODEXFLOW_DATABASE_PATH=/data/codexflow.sqlite
ENV CODEXFLOW_PROJECT_ROOT=/data/projects
ENV CODEXFLOW_WORKSPACE_ROOT=/data/workspaces

EXPOSE 10000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "pnpm --filter @codexflow/web start --hostname 0.0.0.0 --port ${PORT:-10000}"]
