# Test fixtures

All data here is synthetic: organisations, people, pages, hosts (`.example`) and strings.

- `synthetic-orgs/`: the ten organisation and contact fixtures, signals (feature 003) and expected outcomes.
- `phi-samples/`: synthetic PHI-like and benign strings for the boundary guard.
- `prompt-injection/*.json`: synthetic prompt-injection strings (feature 004). Each file has the `payload`, the
  rule ids the scanner must report (`expectRuleIds`) and a `benignPageTemplate` the test fills in. `benign-prose.json`
  must not be flagged. No real model is called; the fake model is scripted to obey injected text if it ever reaches
  its instruction channel, to prove it cannot.
- `research/pages/*.json`: fixture pages served by the fake research source (`address`, `status`, `text`, or
  `textRepeat` for an oversize page, or `redirectTo` for a redirect).
- `research/llm/*.json`: scripted fake-model responses by scenario. A rule matches a `task` and strings that must
  appear in the data blocks; `"$BLOCK:n"` stands for the id of the n-th data block. `respondRaw` returns text that
  is not valid JSON, `sequence` returns responses in order, `error` returns a provider error, `repeat` keeps the
  last response, `obeyInjection` makes the fake follow injected instructions.
