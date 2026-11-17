# Project guidance for Claude Code

- Read `.specify/memory/constitution.md` and `docs/context/01-guardrails.md` before any task.
- `docs/context/00-source-prompt.md` is the business source of truth. Do not invent facts beyond it;
  record gaps in `docs/context/05-open-questions.md`.
- Use synthetic data only (`docs/context/04-acceptance-scenarios.md`).
- Never write PHI, real patient data, real credentials, or real prospect data into code, tests,
  fixtures, logs, or prompts.
- Deterministic rules (eligibility, suppression, permissions, capacity, PHI checks, SQL rules) are
  plain code with unit tests — never LLM calls.
- Every AI output is validated against a Zod schema in `packages/ai-contracts`; no hidden
  chain-of-thought is persisted, only concise rationale + evidence refs.
- Prefer small vertical slices; keep tests green; update the feature's spec when behaviour changes.