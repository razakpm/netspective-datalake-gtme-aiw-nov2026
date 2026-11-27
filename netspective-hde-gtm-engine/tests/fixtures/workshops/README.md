# Workshop fixtures (feature 007)

All data is synthetic.

- `findings-cases.json`: Offer 1 and Offer 6 findings with the shortfalls each must produce. These cases are the
  acceptance test for the finalisation rules in `packages/domain/src/workshops/findings.ts`; the file only grows.
  The boundary sentence and the disclaimer are hypotheses (open question #53) and must equal the domain constants.
- `notes/`: synthetic pasted session notes. They support some items and say nothing about others, so a suggestion
  that invents something can be detected. `injection.txt` asks for state changes that must never happen.
