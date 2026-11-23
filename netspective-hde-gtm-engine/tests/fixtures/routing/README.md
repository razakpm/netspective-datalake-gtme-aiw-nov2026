# Routing case corpus

The corpus lives with the code at `packages/domain/src/routing/corpus.json` so that rule set activation
can read it in a deployed container (research R-07). There is no copy here.

It is the acceptance test for the routing rules (spec FR-013, SC-008): every rule has a match, a
near-miss and a precedence case, and every eligibility code has a case. A rule set cannot be activated
unless every case holds. Synthetic data only. It must only grow: change a case only when a business
decision changes the expected outcome, in a reviewed pull request.
