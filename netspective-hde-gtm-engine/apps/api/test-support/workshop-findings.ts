import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Offer1Findings, Offer6Findings } from "@gtm/domain";

// Complete findings from the acceptance corpus, for the integration and contract tests.
const corpus = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../../tests/fixtures/workshops/findings-cases.json"),
    "utf8",
  ),
) as { offer1: { id: string; content: unknown }[]; offer6: { id: string; content: unknown }[] };

export const offer1Findings = (): Offer1Findings =>
  structuredClone(corpus.offer1.find((c) => c.id === "offer1-complete")!.content) as Offer1Findings;
export const offer6Findings = (): Offer6Findings =>
  structuredClone(corpus.offer6.find((c) => c.id === "offer6-complete")!.content) as Offer6Findings;
export const notes = (name: "northvale-offer1" | "riverbend-offer6" | "injection"): string =>
  readFileSync(
    join(import.meta.dirname, `../../../tests/fixtures/workshops/notes/${name}.txt`),
    "utf8",
  );
