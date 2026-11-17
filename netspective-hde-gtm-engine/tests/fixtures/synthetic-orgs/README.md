# Synthetic organisations and contacts

Every organisation, person, domain and email in this folder is fictional. Domains use the reserved
`.example` suffix, and the one unsubscribed contact uses `example.org`. Nothing here is real prospect data.

- `organisations.csv`: the nine organisation fixtures (eight assessable organisations plus `granite-health`,
  whose notes hold a synthetic PHI-like pattern and must be rejected at import).
- `organisations-invalid.csv`, `organisations-duplicates.csv`: validation, duplicate and shared-domain cases.
- `contacts.csv`, `contacts-invalid.csv`: valid contacts including `pat.unsubscribed@example.org` (fixture 9),
  and rejection and conflict cases.
- `evidence.json`: evidence references used by the ICP assessments.
- `expected.json`: expected outcomes. Only the four in spec FR-026 are fixed; the rest are `pending-gtm-lead`.
