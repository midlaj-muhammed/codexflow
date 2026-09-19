# CodexFlow Threat Model

## Assets

- source code
- Git credentials/tokens
- repository metadata
- environment secrets
- agent context
- generated code
- Pull Requests
- task history
- evaluation data

## Threats

### 1. Secret exposure

Risk: agents receive `.env`, keys, certificates, or credential files.

Mitigation:

- `.codexignore`
- runtime file filtering
- never include secrets in context by default
- provider secret isolation

### 2. Destructive commands

Risk: an agent deletes or resets repository data.

Mitigation:

- command policy
- restricted execution
- worktree isolation
- approval requirements

### 3. Protected branch modification

Risk: agent changes main/default branch directly.

Mitigation:

- task-specific branches
- worktrees
- provider branch protections
- approval gate

### 4. Malicious repository content

Risk: repository instructions attempt prompt injection or unsafe command execution.

Mitigation:

- treat repository text as untrusted input
- enforce runtime policy outside the model
- never let repository instructions override system policy

### 5. Dependency/network risk

Risk: agent installs malicious or unexpected dependencies.

Mitigation:

- restricted package installation
- record dependency changes
- require approval when policy marks the operation high-risk

### 6. Credential misuse

Risk: agent attempts to access Git credentials or unrelated secrets.

Mitigation:

- least privilege
- filtered filesystem access
- command restrictions
- audit events

## Security principle

Git provides version control. Worktrees provide isolation. Runtime policy provides permission control. These responsibilities must remain separate.
