# ADR-018: Research gateway and untrusted content

Status: Accepted (feature 004) — assumption (hypothesis) pending project-owner confirmation (open question #46)

## Context

Feature 004 needs a model gateway, but feature 001's provider and AI-invocation tasks were not yet built.
Research reads external pages, which may contain instructions aimed at the model.

## Decision

1. **Minimal gateway slice built in 004.** `LLMProvider` and `ResearchSourceProvider` interfaces, fakes, the
   provider-call wrapper, the prompt registry (`prompt_version`), the `ai_invocation` ledger and `LlmGateway`.
   The rest of feature 001 US7/US8 stays open.
2. **Untrusted content is data.** Page text travels only in per-call delimited data blocks (delimiter text
   neutralised), never in the system prompt. The tool allow-list is empty. A deterministic scanner flags injection
   patterns (rule ids and offsets only, never the text). `buildModelInput` is a typed allow-list and throws on any
   other field. A PHI guard runs on pages, payloads and stored text.
3. **Verify, don't trust.** Code checks each finding: cited fetched source, quote present in the source, protected
   topics only as verified facts and always listed as unknowns, taxonomy keys, entity-match cap. The summary is
   assembled by code from verified findings. Quote text is stored only when the signal source allows excerpts;
   otherwise only a SHA-256 and `verified=1`.
4. **Budgets in integer micro-units.** A worst-case pre-check (input estimate chars/4 with a 2x safety factor plus
   max output tokens at the rate) runs before every call; billed cost is clamped to those bounds. Caps: per run
   2.00, per account per month 20.00 (from `ai_invocation.account_id`, all calls), interpretation 0.20.
5. **Hand-off through feature 003.** Findings enter as pending signals via `SignalService.ingestSubmission` (AI
   actor); nothing is auto-approved and no ICP value changes.

## Consequences

- A hostile page cannot change state; it only raises an injection flag.
- Limit: the web fetch adapter's SSRF guard checks addresses it resolves but cannot fully close DNS rebinding;
  the adapter is off by default and https/approved-host only.
- Provider choice is configuration (`LLM_PROVIDER`); production refuses the fake.
