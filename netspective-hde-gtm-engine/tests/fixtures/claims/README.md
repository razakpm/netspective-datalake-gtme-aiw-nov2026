# Claim checker corpus

`corpus.json` is the acceptance test for the claim checker (feature 005, spec SC-001). Each entry has the input
`text` and the `expected` matches (`class`, `rule`, matched `text`, `start`, `end`). Positions are UTF-16 offsets into
the original text, so a text with a non-breaking hyphen still reports positions in the text as written.

- Entries starting `p-` must produce exactly the listed matches, in order of position.
- Entries starting `n-` are clean or look-alike text and must produce no match.
- The corpus is synthetic. It may only grow: add a case whenever a missed phrase or a false hit is found, never remove one.
- The `rule` ids are the ids in the default restricted phrase list (`packages/domain/src/claims/phrases.ts`).
- Customer identity cannot be detected by naming a customer. The checker flags only the fixed wording set from FR-005
  (case study, customer story, success story, our client, named customer).
- The class of "guarantee" (quantified outcome) and the outcome-word list behind the percentage rule are
  hypotheses (open question 48).
