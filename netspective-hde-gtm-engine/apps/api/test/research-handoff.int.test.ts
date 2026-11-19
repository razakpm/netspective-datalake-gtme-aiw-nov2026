import { describe, expect, it } from "vitest";
import type { VerifiedFinding } from "@gtm/domain";
import { handOffSignals } from "../src/modules/research/handoff.js";
import type { SignalService } from "../src/modules/signals/index.js";

// Task T033: the hand-off maps kept findings to feature 003 ingest submissions and records refusals as codes.
const finding = (over: Partial<VerifiedFinding> = {}): VerifiedFinding => ({
  key: "k1",
  kind: "fact",
  topic: "other",
  statement: "A fact.",
  supportingText: "q",
  supportingTextSha256: "h",
  sourceFetchId: "f1",
  secondSourceFetchId: null,
  basisKeys: [],
  typeKey: "org_profile_fact",
  confidence: "medium",
  verified: true,
  ...over,
});
const ctx = (signals: SignalService) => ({
  signals,
  ctx: {
    accountId: "a1",
    model: "m",
    promptVersion: "p@1",
    correlationId: "c",
    now: () => new Date("2026-11-19T10:00:00.000Z"),
    sourceFor: (id: string) =>
      id === "f1"
        ? {
            address: "https://x.example/p",
            host: "x.example",
            signalSourceKind: "official_publication",
          }
        : undefined,
    firstFetchOf: (f: VerifiedFinding, byKey: Map<string, VerifiedFinding>) =>
      f.sourceFetchId ??
      [...f.basisKeys].map((b) => byKey.get(b)?.sourceFetchId).find(Boolean) ??
      null,
  },
});

describe("handOffSignals", () => {
  it("submits facts as derived_interpretation and inferences as ai_hypothesis through the ingest path with an AI actor", () => {
    const sent: { actor: { actorType: string }; submission: Record<string, unknown> }[] = [];
    const stub = {
      ingestSubmission: (actor: { actorType: string }, submission: Record<string, unknown>) => {
        sent.push({ actor, submission });
        return { outcome: "created", signal: { id: `s${sent.length}` } };
      },
    } as unknown as SignalService;
    const { signals, ctx: c } = ctx(stub);
    const out = handOffSignals(signals, c, [
      finding(),
      finding({ key: "k2", kind: "inference", sourceFetchId: null, basisKeys: ["k1"] }),
    ]);
    expect(out.map((o) => [o.key, o.signalId, o.created])).toEqual([
      ["k1", "s1", true],
      ["k2", "s2", true],
    ]);
    expect(sent.map((s) => s.submission["evidenceStatus"])).toEqual([
      "derived_interpretation",
      "ai_hypothesis",
    ]);
    expect(sent.every((s) => s.actor.actorType === "ai")).toBe(true);
    expect(sent[0]!.submission).toMatchObject({
      extractionMethod: "ai_extracted",
      aiModel: "m",
      aiPromptVersion: "p@1",
      source: {
        name: "Research: x.example",
        kind: "official_publication",
        ref: "https://x.example/p",
      },
    });
    expect(sent[0]!.submission["itemKey"]).toBeUndefined();
  });
  it("skips findings without a signal type, unknowns and contradictions, and findings without a source", () => {
    const stub = {
      ingestSubmission: () => {
        throw new Error("must not be called");
      },
    } as unknown as SignalService;
    const { signals, ctx: c } = ctx(stub);
    expect(
      handOffSignals(signals, c, [
        finding({ typeKey: null }),
        finding({ key: "u", kind: "unknown" }),
        finding({ key: "c", kind: "contradiction" }),
        finding({ key: "n", sourceFetchId: "missing" }),
      ]),
    ).toEqual([]);
  });
  it("records a feature 003 refusal as codes and carries on", () => {
    let n = 0;
    const stub = {
      ingestSubmission: () => {
        n += 1;
        if (n === 1)
          throw new Error("Refused: source_required:source, observation_too_long:observation");
        return { outcome: "merged", signal: { id: "s2" } };
      },
    } as unknown as SignalService;
    const { signals, ctx: c } = ctx(stub);
    const out = handOffSignals(signals, c, [finding(), finding({ key: "k2" })]);
    expect(out[0]).toEqual({
      key: "k1",
      signalId: null,
      created: false,
      refusalCodes: ["source_required:source", "observation_too_long:observation"],
    });
    expect(out[1]).toEqual({ key: "k2", signalId: "s2", created: false, refusalCodes: [] });
  });
});
