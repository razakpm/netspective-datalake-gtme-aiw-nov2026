// Which artifacts a workshop can record (feature 007, spec FR-014 and FR-017, research R-10). Pure. Only
// text content can be kept, because nothing else can be checked; a binary file is recorded as a reference.
// The PHI boundary check is made separately by the shared guard.

export const DEFAULT_ARTIFACT_KINDS = [
  "specification",
  "timeline",
  "scrubbed_rejection_log",
  "interface_description",
  "field_list",
  "other_non_phi",
] as const;

export type ArtifactState = "received" | "held" | "released" | "discarded";

const TEXT_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(txt|md|csv|json|log)$/;
// Control characters other than tab, line feed and carriage return, and the mark left by bad encoding.
// eslint-disable-next-line no-control-regex
const NOT_TEXT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F�]/;

export type ArtifactRefusal =
  | "artifact_kind_not_allowed"
  | "reference_or_content_required"
  | "binary_not_accepted"
  | "content_too_large";

export type ArtifactCheck =
  | { ok: true; sizeBytes: number | null; extension: string | null }
  | { ok: false; code: ArtifactRefusal };

export function checkArtifact(
  input: {
    kind: string;
    reference?: string | undefined;
    content?: string | undefined;
    fileName?: string | undefined;
  },
  rules: { kinds: readonly string[]; maxBytes: number },
): ArtifactCheck {
  const refuse = (code: ArtifactRefusal): ArtifactCheck => ({ ok: false, code });
  if (!rules.kinds.includes(input.kind)) return refuse("artifact_kind_not_allowed");
  const content = input.content || undefined;
  if (content === undefined && !input.reference?.trim()) {
    return refuse("reference_or_content_required");
  }
  const match = input.fileName === undefined ? null : TEXT_FILE.exec(input.fileName);
  if (input.fileName !== undefined && !match) return refuse("binary_not_accepted");
  if (content === undefined) return { ok: true, sizeBytes: null, extension: null };
  const sizeBytes = new TextEncoder().encode(content).length;
  if (sizeBytes > rules.maxBytes) return refuse("content_too_large");
  if (NOT_TEXT.test(content)) return refuse("binary_not_accepted");
  return { ok: true, sizeBytes, extension: match?.[1] ?? "txt" };
}

export interface ChecklistItem {
  kind: string;
  label: string;
  status: "received" | "held" | "not_received";
}

export function artifactKindLabel(kind: string): string {
  const words = kind.replace(/_non_phi$/, "_non-PHI").split("_");
  return words.map((w, i) => (i === 0 ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");
}

/** A missing artifact never blocks anything: this only says what has arrived. */
export function artifactChecklist(
  kinds: readonly string[],
  artifacts: readonly { kind: string; state: ArtifactState }[],
): ChecklistItem[] {
  return kinds.map((kind) => {
    const states = artifacts.filter((a) => a.kind === kind).map((a) => a.state);
    const received = states.includes("received") || states.includes("released");
    return {
      kind,
      label: artifactKindLabel(kind),
      status: received ? "received" : states.includes("held") ? "held" : "not_received",
    };
  });
}
