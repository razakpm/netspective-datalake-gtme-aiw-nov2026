"use client";
import { PhiWarning } from "../../../components/phi-warning.js";
import type {
  Confirmation,
  DelaySource,
  DelayUnit,
  Offer1Content,
  OwnerClass,
} from "../../../lib/workshops-api.js";
import { FindingsFrame, type Editor, type FindingsProps } from "./findings-frame.js";
import { lines } from "./use-work.js";

// Offer 1 findings (feature 007, spec FR-018 to FR-021): the flow, the three biggest delay sources with who
// can act on each, the unknowns, the next step and the boundary between free diagnosis and paid work.

interface SourceForm {
  description: string;
  ownerClass: OwnerClass | "";
  delayKind: "" | "quantified" | "not_quantified";
  amount: string;
  unit: DelayUnit | "";
  confirmation: Confirmation;
}
interface Form {
  flowSummary: string;
  sources: SourceForm[];
  unknowns: string;
  suggestedNextStep: string;
  boundaryNote: string;
}

const blank = (): SourceForm => ({
  description: "",
  ownerClass: "",
  delayKind: "",
  amount: "",
  unit: "",
  confirmation: "unknown",
});
const toSourceForm = (s: DelaySource): SourceForm => ({
  description: s.description,
  ownerClass: s.ownerClass ?? "",
  delayKind: s.delay?.kind ?? "",
  amount: s.delay?.kind === "quantified" ? String(s.delay.amount) : "",
  unit: s.delay?.kind === "quantified" ? s.delay.unit : "",
  confirmation: s.confirmation,
});
/** A quantified delay needs both an amount and a unit; neither is ever assumed. */
const delayOf = (s: SourceForm): DelaySource["delay"] => {
  if (s.delayKind === "not_quantified") return { kind: "not_quantified" };
  const amount = Number(s.amount);
  return s.delayKind === "quantified" && amount > 0 && s.unit
    ? { kind: "quantified", amount, unit: s.unit }
    : null;
};
const toSource = (s: SourceForm): DelaySource => ({
  description: s.description,
  ownerClass: s.ownerClass || null,
  delay: delayOf(s),
  confirmation: s.confirmation,
});
const used = (s: SourceForm) =>
  s.description.trim() !== "" || s.ownerClass !== "" || s.delayKind !== "";

const editor: Editor<Form> = {
  toForm: (content) => {
    const c = content as Offer1Content;
    const sources = c.delaySources.map(toSourceForm);
    while (sources.length < 3) sources.push(blank());
    return {
      flowSummary: c.flowSummary,
      sources,
      unknowns: c.unknowns.join("\n"),
      suggestedNextStep: c.suggestedNextStep,
      boundaryNote: c.boundaryNote,
    };
  },
  toContent: (f) => ({
    flowSummary: f.flowSummary,
    delaySources: f.sources.filter(used).map(toSource),
    unknowns: lines(f.unknowns),
    suggestedNextStep: f.suggestedNextStep,
    boundaryNote: f.boundaryNote,
  }),
  apply: (form, item) => {
    const value = String(item.value);
    if (item.path === "flowSummary") return { ...form, flowSummary: value };
    if (item.path === "suggestedNextStep") return { ...form, suggestedNextStep: value };
    if (item.path.startsWith("unknowns.")) {
      const list = lines(form.unknowns);
      return list.includes(value) ? form : { ...form, unknowns: [...list, value].join("\n") };
    }
    const match = /^delaySources\.([0-2])\.(.+)$/.exec(item.path);
    if (!match) return form;
    const [, index, leaf] = match;
    const patch: Partial<SourceForm> =
      leaf === "description"
        ? { description: value }
        : leaf === "ownerClass"
          ? { ownerClass: value as OwnerClass }
          : leaf === "delay.amount"
            ? { delayKind: "quantified", amount: value }
            : leaf === "delay.unit"
              ? { delayKind: "quantified", unit: value as DelayUnit }
              : {};
    return {
      ...form,
      sources: form.sources.map((s, i) => (i === Number(index) ? { ...s, ...patch } : s)),
    };
  },
  describe: (_form, path) => {
    const match = /^delaySources\.([0-2])\.(.+)$/.exec(path);
    if (!match)
      return path
        .replace(/\.\d+$/, "")
        .replace(/([A-Z])/g, " $1")
        .toLowerCase();
    const leaf: Record<string, string> = {
      description: "description",
      ownerClass: "who can act",
      "delay.amount": "delay amount",
      "delay.unit": "delay unit",
    };
    return `delay source ${Number(match[1]) + 1} ${leaf[match[2]!] ?? match[2]}`;
  },
};

export function FindingsOffer1(props: FindingsProps) {
  return (
    <FindingsFrame {...props} editor={editor}>
      {(form, set) => {
        const source = (index: number, patch: Partial<SourceForm>) =>
          set({
            ...form,
            sources: form.sources.map((s, i) => (i === index ? { ...s, ...patch } : s)),
          });
        return (
          <>
            <label>
              Onboarding flow summary
              <textarea
                value={form.flowSummary}
                maxLength={1000}
                onChange={(e) => set({ ...form, flowSummary: e.target.value })}
              />
            </label>
            {form.sources.map((s, i) => (
              <fieldset key={i}>
                <legend>Delay source {i + 1}</legend>
                <label>
                  Description
                  <textarea
                    value={s.description}
                    maxLength={300}
                    onChange={(e) => source(i, { description: e.target.value })}
                  />
                </label>
                <label>
                  Who can act on it
                  <select
                    value={s.ownerClass}
                    onChange={(e) => source(i, { ownerClass: e.target.value as OwnerClass })}
                  >
                    <option value="">Not chosen</option>
                    <option value="operator">Operator</option>
                    <option value="sender">Sender</option>
                    <option value="rule_owner">Rule owner</option>
                  </select>
                </label>
                <label>
                  Delay
                  <select
                    value={s.delayKind}
                    onChange={(e) =>
                      source(i, { delayKind: e.target.value as SourceForm["delayKind"] })
                    }
                  >
                    <option value="">Not chosen</option>
                    <option value="quantified">Quantified</option>
                    <option value="not_quantified">Not quantified</option>
                  </select>
                </label>
                {s.delayKind === "quantified" ? (
                  <>
                    <label>
                      Amount
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={s.amount}
                        onChange={(e) => source(i, { amount: e.target.value })}
                      />
                    </label>
                    <label>
                      Unit
                      <select
                        value={s.unit}
                        onChange={(e) => source(i, { unit: e.target.value as DelayUnit })}
                      >
                        <option value="">Not chosen</option>
                        <option value="hours">Hours</option>
                        <option value="days">Days</option>
                        <option value="weeks">Weeks</option>
                      </select>
                    </label>
                  </>
                ) : null}
                <label>
                  Buyer&apos;s confirmation of the delay and its owner
                  <select
                    value={s.confirmation}
                    onChange={(e) => source(i, { confirmation: e.target.value as Confirmation })}
                  >
                    <option value="unknown">Unknown</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="not_confirmed">Not confirmed</option>
                  </select>
                </label>
              </fieldset>
            ))}
            <label>
              Unknowns, one per line
              <textarea
                value={form.unknowns}
                onChange={(e) => set({ ...form, unknowns: e.target.value })}
              />
            </label>
            <label>
              Suggested next step
              <textarea
                value={form.suggestedNextStep}
                maxLength={500}
                onChange={(e) => set({ ...form, suggestedNextStep: e.target.value })}
              />
            </label>
            <label>
              Boundary note (keep the first sentence)
              <textarea
                value={form.boundaryNote}
                maxLength={600}
                onChange={(e) => set({ ...form, boundaryNote: e.target.value })}
              />
            </label>
            <p>The economic buyer and funding path are left for the qualification step.</p>
            <PhiWarning
              value={[
                form.flowSummary,
                ...form.sources.map((s) => s.description),
                form.unknowns,
                form.suggestedNextStep,
              ].join(" ")}
            />
          </>
        );
      }}
    </FindingsFrame>
  );
}
