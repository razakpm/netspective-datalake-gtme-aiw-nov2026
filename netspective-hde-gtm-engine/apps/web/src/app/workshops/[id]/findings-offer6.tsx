"use client";
import { PhiWarning } from "../../../components/phi-warning.js";
import {
  DIMENSIONS,
  type Dimension,
  type FieldTrace,
  type ObservationStatus,
  type Offer6Content,
} from "../../../lib/workshops-api.js";
import { FindingsFrame, type Editor, type FindingsProps } from "./findings-frame.js";

// Offer 6 findings (feature 007, spec FR-022 to FR-026): the intake's ten fields traced, each observation
// known good, gap or unknown, chosen by a person. "Not recorded" is its own state, and unknown is never
// counted or shown as a gap.

const STATUS_OPTIONS: [value: string, text: string][] = [
  ["", "Not recorded"],
  ["known_good", "Known good"],
  ["gap", "Gap"],
  ["unknown", "Unknown"],
];

const editor: Editor<Offer6Content> = {
  toForm: (content) => structuredClone(content as Offer6Content),
  toContent: (form) => ({
    ...form,
    overall: {
      ...form.overall,
      // Only observations that are still unknown or unrecorded can be listed.
      dependsOnUnknowns: form.overall.dependsOnUnknowns.filter((u) => {
        const status = form.fields.find((f) => f.intakeName === u.field)?.observations[u.dimension]
          .status;
        return status === "unknown" || status === null;
      }),
    },
    inputAuditScope: {
      useCase: form.inputAuditScope.useCase,
      sources: form.inputAuditScope.sources.filter((s) => s.trim() !== ""),
    },
  }),
  apply: (form, item) => {
    const match = /^fields\.(\d)\.(.+)$/.exec(item.path);
    if (!match) return form;
    const [, index, leaf] = match;
    const value = String(item.value);
    const patch = (field: FieldTrace): FieldTrace => {
      if (leaf === "sourceSystem") return { ...field, sourceSystem: value };
      if (leaf === "sourceInterface") return { ...field, sourceInterface: value };
      const dimension = /^observations\.(\w+)\.status$/.exec(leaf!)?.[1] as Dimension | undefined;
      if (!dimension) return field;
      return {
        ...field,
        observations: {
          ...field.observations,
          [dimension]: { ...field.observations[dimension], status: value as ObservationStatus },
        },
      };
    };
    return { ...form, fields: form.fields.map((f, i) => (i === Number(index) ? patch(f) : f)) };
  },
  describe: (form, path) => {
    const match = /^fields\.(\d)\.(.+)$/.exec(path);
    if (!match) return path;
    const leaf = match[2]!
      .replace(/^observations\.(\w+)\.status$/, "$1")
      .replace("sourceSystem", "source system")
      .replace("sourceInterface", "message or interface");
    return `${form.fields[Number(match[1])]?.name ?? "field"} ${leaf}`;
  },
};

export function FindingsOffer6(props: FindingsProps) {
  return (
    <FindingsFrame {...props} editor={editor}>
      {(form, set) => {
        const field = (index: number, patch: Partial<FieldTrace>) =>
          set({
            ...form,
            fields: form.fields.map((f, i) => (i === index ? { ...f, ...patch } : f)),
          });
        const all = form.fields.flatMap((f) =>
          DIMENSIONS.map((d) => ({ field: f, dimension: d, status: f.observations[d].status })),
        );
        const count = (status: ObservationStatus) => all.filter((o) => o.status === status).length;
        const open = all.filter((o) => o.status === "unknown" || o.status === null);
        const listed = (name: string, d: Dimension) =>
          form.overall.dependsOnUnknowns.some((u) => u.field === name && u.dimension === d);
        const source = (index: number, value: string) => {
          const sources = [...form.inputAuditScope.sources];
          while (sources.length < 2) sources.push("");
          sources[index] = value;
          set({ ...form, inputAuditScope: { ...form.inputAuditScope, sources } });
        };
        return (
          <>
            <p aria-label="Observation summary">
              Known good: {count("known_good")} · Gap: {count("gap")} · Unknown: {count("unknown")}{" "}
              · Not recorded: {count(null)}
            </p>
            {form.fields.map((f, i) => (
              <fieldset key={f.intakeName}>
                <legend>
                  {f.intakeName}
                  {f.name !== f.intakeName ? ` (changed to ${f.name})` : ""}
                </legend>
                <label>
                  Name for {f.intakeName}
                  <input
                    value={f.name}
                    maxLength={60}
                    onChange={(e) => field(i, { name: e.target.value })}
                  />
                </label>
                {f.name !== f.intakeName ? (
                  <label>
                    Why the name of {f.intakeName} changed
                    <input
                      value={f.renameReason}
                      maxLength={300}
                      onChange={(e) => field(i, { renameReason: e.target.value })}
                    />
                  </label>
                ) : null}
                <label>
                  Source system of {f.intakeName}
                  <input
                    value={f.sourceSystem}
                    maxLength={120}
                    onChange={(e) => field(i, { sourceSystem: e.target.value })}
                  />
                </label>
                <label>
                  Message or interface of {f.intakeName}
                  <input
                    value={f.sourceInterface}
                    maxLength={120}
                    onChange={(e) => field(i, { sourceInterface: e.target.value })}
                  />
                </label>
                {DIMENSIONS.map((d) => (
                  <span key={d}>
                    <label>
                      {f.intakeName} {d}
                      <select
                        value={f.observations[d].status ?? ""}
                        onChange={(e) =>
                          field(i, {
                            observations: {
                              ...f.observations,
                              [d]: {
                                ...f.observations[d],
                                status: (e.target.value || null) as ObservationStatus,
                              },
                            },
                          })
                        }
                      >
                        {STATUS_OPTIONS.map(([value, text]) => (
                          <option key={value} value={value}>
                            {text}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Note on {f.intakeName} {d} (no values)
                      <input
                        value={f.observations[d].note}
                        maxLength={300}
                        onChange={(e) =>
                          field(i, {
                            observations: {
                              ...f.observations,
                              [d]: { ...f.observations[d], note: e.target.value },
                            },
                          })
                        }
                      />
                    </label>
                  </span>
                ))}
              </fieldset>
            ))}
            <fieldset>
              <legend>Overall view</legend>
              <label>
                View
                <select
                  value={form.overall.view ?? ""}
                  onChange={(e) =>
                    set({
                      ...form,
                      overall: {
                        ...form.overall,
                        view: (e.target.value || null) as Offer6Content["overall"]["view"],
                      },
                    })
                  }
                >
                  <option value="">Not chosen</option>
                  <option value="go">Go</option>
                  <option value="no_go">No-go</option>
                  <option value="conditional">Conditional</option>
                </select>
              </label>
              <label>
                Reason (needed for a go view with anything unknown or not recorded)
                <textarea
                  value={form.overall.reason}
                  maxLength={500}
                  onChange={(e) =>
                    set({ ...form, overall: { ...form.overall, reason: e.target.value } })
                  }
                />
              </label>
              <p>Unknowns the view depends on (up to 20):</p>
              {open.length === 0 ? <p>Nothing is unknown or unrecorded.</p> : null}
              {open.map(({ field: f, dimension, status }) => (
                <label key={`${f.intakeName}-${dimension}`}>
                  <input
                    type="checkbox"
                    checked={listed(f.intakeName, dimension)}
                    disabled={
                      !listed(f.intakeName, dimension) &&
                      form.overall.dependsOnUnknowns.length >= 20
                    }
                    onChange={(e) =>
                      set({
                        ...form,
                        overall: {
                          ...form.overall,
                          dependsOnUnknowns: e.target.checked
                            ? [
                                ...form.overall.dependsOnUnknowns,
                                { field: f.intakeName, dimension },
                              ]
                            : form.overall.dependsOnUnknowns.filter(
                                (u) => !(u.field === f.intakeName && u.dimension === dimension),
                              ),
                        },
                      })
                    }
                  />
                  Depends on {f.intakeName} {dimension} (
                  {status === "unknown" ? "unknown" : "not recorded"})
                </label>
              ))}
              <p>{form.disclaimer}</p>
            </fieldset>
            <fieldset>
              <legend>Draft Input Audit scope</legend>
              <label>
                One use case
                <input
                  value={form.inputAuditScope.useCase}
                  maxLength={200}
                  onChange={(e) =>
                    set({
                      ...form,
                      inputAuditScope: { ...form.inputAuditScope, useCase: e.target.value },
                    })
                  }
                />
              </label>
              {[0, 1].map((n) => (
                <label key={n}>
                  Source {n + 1}
                  {n === 1 ? " (optional)" : ""}
                  <input
                    value={form.inputAuditScope.sources[n] ?? ""}
                    maxLength={120}
                    onChange={(e) => source(n, e.target.value)}
                  />
                </label>
              ))}
            </fieldset>
            <PhiWarning
              value={[
                form.overall.reason,
                ...form.fields.flatMap((f) => DIMENSIONS.map((d) => f.observations[d].note)),
              ].join(" ")}
            />
          </>
        );
      }}
    </FindingsFrame>
  );
}
