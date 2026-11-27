import { call, newKey } from "./catalogue-http.js";

// Browser-side client for workshop operations (contracts/workshops.openapi.yaml). Nothing here sends a
// message or invites anyone.

export type WorkshopState =
  "requested" | "booked" | "held" | "findings_recorded" | "closed" | "cancelled" | "no_show";
export type WorkshopAction = "book" | "reschedule" | "hold" | "no_show" | "cancel" | "close";
export type FindingsKind = "offer_1" | "offer_6";

export interface WorkshopSummary {
  id: string;
  offerId: string;
  offerKey: string;
  state: WorkshopState;
  accountId: string;
  accountName: string;
  contactId: string;
  scheduledAt: string | null;
  durationMinutes: number;
  createdAt: string;
}
export interface Participant {
  id: string;
  side: "buyer" | "delivery";
  displayName: string;
  roleTitle: string | null;
  removedAt: string | null;
}
export interface Workshop extends WorkshopSummary {
  requestId: string;
  lockNo: number;
  bookingRoute: "manual" | "calendar" | null;
  intake: Record<string, unknown>;
  history: {
    fromState: string | null;
    toState: string;
    note: string | null;
    scheduledFrom: string | null;
    scheduledTo: string | null;
    changedBy: string;
    changedAt: string;
  }[];
  participants: Participant[];
  notices: string[];
  capacity: {
    state: "room" | "exhausted" | "no_limit_set";
    periodKind: "week" | "month" | null;
    limit: number | null;
    used: number;
  };
}
export interface TransitionBody {
  action: WorkshopAction;
  lockNo: number;
  scheduledAt?: string;
  via?: "manual" | "calendar";
  note?: string;
}

export interface Artifact {
  id: string;
  kind: string;
  title: string;
  reference: string | null;
  suppliedBy: string | null;
  hasContent: boolean;
  state: "received" | "held" | "released" | "discarded";
  holdRuleIds: string[];
  recordedAt: string;
}
export interface ArtifactList {
  checklist: { kind: string; label: string; status: "received" | "held" | "not_received" }[];
  items: Artifact[];
}
export interface ArtifactBody {
  kind: string;
  title: string;
  reference?: string;
  suppliedBy?: string;
  content?: string;
  fileName?: string;
}

export interface Brief {
  id: string;
  versionNo: number;
  source: "baseline" | "model";
  model: string | null;
  promptVersion: string | null;
  confidence: "low" | "medium" | "high" | null;
  rationale: string | null;
  reviewStatus: "unreviewed" | "reviewed";
  reviewedBy: string | null;
  notice: string | null;
  createdAt: string;
  content: {
    confirmedFacts: { evidenceId: string; text: string }[];
    inferences: {
      statement: string;
      evidenceIds: string[];
      contradictingEvidenceIds: string[];
      basis: string;
    }[];
    contradictions: { evidenceId: string; text: string }[];
    unknowns: string[];
    suggestedQuestions: string[];
    artifactChecklist: { kind: string; why: string }[];
  };
}

export type OwnerClass = "operator" | "sender" | "rule_owner";
export type DelayUnit = "hours" | "days" | "weeks";
export type Confirmation = "confirmed" | "not_confirmed" | "unknown";
export interface DelaySource {
  description: string;
  ownerClass: OwnerClass | null;
  delay:
    { kind: "quantified"; amount: number; unit: DelayUnit } | { kind: "not_quantified" } | null;
  confirmation: Confirmation;
  confirmedBy?: string;
  confirmedAt?: string;
}
export interface Offer1Content {
  flowSummary: string;
  delaySources: DelaySource[];
  unknowns: string[];
  suggestedNextStep: string;
  boundaryNote: string;
}
export const DIMENSIONS = ["quality", "completeness", "freshness", "provenance", "access"] as const;
export type Dimension = (typeof DIMENSIONS)[number];
export type ObservationStatus = "known_good" | "gap" | "unknown" | null;
export interface FieldTrace {
  intakeName: string;
  name: string;
  renameReason: string;
  sourceSystem: string;
  sourceInterface: string;
  observations: Record<Dimension, { status: ObservationStatus; note: string }>;
}
export interface Offer6Content {
  fields: FieldTrace[];
  overall: {
    view: "go" | "no_go" | "conditional" | null;
    dependsOnUnknowns: { field: string; dimension: Dimension }[];
    reason: string;
  };
  disclaimer: string;
  inputAuditScope: { useCase: string; sources: string[] };
}
export type FindingsContent = Offer1Content | Offer6Content;
export interface Finding {
  id: string;
  versionNo: number;
  kind: FindingsKind;
  state: "draft" | "finalised";
  content: FindingsContent;
  lockNo: number;
  waiverReason: string | null;
  correctionReason: string | null;
}
export interface FindingsView {
  current: Finding | null;
  versions: Finding[];
  shortfalls: { code: string; waivable: boolean; message: string }[];
  template?: FindingsContent;
  summary?: { knownGood: number; gap: number; unknown: number; notRecorded: number };
}
export interface SuggestedItem {
  path: string;
  value: string | number;
  supportingText: string;
  interpretation: boolean;
}
export interface Suggestion {
  items: SuggestedItem[];
  dropped: number;
  confidence: "low" | "medium" | "high";
  rationale: string;
  notice: string | null;
}

export interface OutputSections {
  title: string;
  organisation: string;
  offerName: string;
  date: string;
  summary: string;
  findings: string;
  unknowns: string;
  nextStep: string;
  inScope: string[];
  outOfScope: string[];
  boundaryNote?: string;
  disclaimer?: string;
}
export type EditableSections = Pick<
  OutputSections,
  "title" | "summary" | "nextStep" | "inScope" | "outOfScope"
>;
export interface Output {
  id: string;
  revisionNo: number;
  state: "draft" | "approved";
  sections: OutputSections;
  findingVersionNo: number;
  approvedBy: string | null;
  outOfDate: boolean;
  problems: { code: string; message: string }[];
}
export interface OutputView {
  latest: Output | null;
  revisions: Output[];
  shares: { id: string; how: string; sharedBy: string; sharedAt: string }[];
}

export interface EffortEntry {
  id: string;
  prepHours: number;
  sessionHours: number;
  people: number;
  recordedAt: string;
}

export interface OfferEffortSummary {
  offerId: string;
  offerKey: string;
  workshops: number;
  withEffort: number;
  missing: number;
  totalPrepHours: number;
  totalSessionHours: number;
  averagePrepHours: number | null;
  averageSessionHours: number | null;
  averagePeople: number | null;
  estimate: string | null;
}

export interface WorkshopsApi {
  list(filter: { state?: string; offerId?: string }): Promise<{ items: WorkshopSummary[] }>;
  convert(requestId: string): Promise<Workshop>;
  get(id: string): Promise<Workshop>;
  transition(id: string, body: TransitionBody): Promise<Workshop>;
  addParticipant(
    id: string,
    body: { side: "buyer" | "delivery"; displayName: string; roleTitle?: string },
  ): Promise<Participant>;
  removeParticipant(id: string, participantId: string): Promise<Participant>;
  artifacts(id: string): Promise<ArtifactList>;
  recordArtifact(id: string, body: ArtifactBody): Promise<Artifact>;
  decideArtifact(
    artifactId: string,
    body: { decision: "release" | "discard"; reason: string },
  ): Promise<Artifact>;
  brief(id: string): Promise<{ latest: Brief | null; earlier: Brief[] }>;
  generateBrief(id: string): Promise<Brief>;
  reviewBrief(id: string, briefId: string): Promise<Brief>;
  findings(id: string): Promise<FindingsView>;
  saveFindings(
    id: string,
    body: { content: FindingsContent; lockNo?: number; correctionReason?: string },
  ): Promise<Finding>;
  finalise(id: string, body: { waiverReason?: string }): Promise<Finding>;
  suggest(id: string, notes: string): Promise<Suggestion>;
  output(id: string): Promise<OutputView>;
  generateOutput(id: string): Promise<Output>;
  editOutput(
    id: string,
    body: { baseRevisionNo: number; sections: EditableSections },
  ): Promise<Output>;
  approveOutput(id: string): Promise<Output>;
  shareOutput(
    id: string,
    body: { how: "handed_over" | "copied_link" | "other"; note?: string },
  ): Promise<unknown>;
  effortSummary(): Promise<{ items: OfferEffortSummary[] }>;
  effort(id: string): Promise<{ current: EffortEntry | null; history: EffortEntry[] }>;
  recordEffort(
    id: string,
    body: { prepHours: number; sessionHours: number; people: number },
  ): Promise<EffortEntry>;
}

const at = (id: string, rest = "") => `/workshops/${encodeURIComponent(id)}${rest}`;
const post = <T>(path: string, body?: unknown) => call<T>("POST", path, newKey(), body ?? {});

export const browserWorkshopsApi: WorkshopsApi = {
  list: (filter) => {
    const query = new URLSearchParams(
      Object.entries(filter).filter((entry): entry is [string, string] => Boolean(entry[1])),
    ).toString();
    return call("GET", `/workshops${query ? `?${query}` : ""}`);
  },
  convert: (requestId) => post("/workshops", { requestId }),
  get: (id) => call("GET", at(id)),
  transition: (id, body) => post(at(id, "/transition"), body),
  addParticipant: (id, body) => post(at(id, "/participants"), body),
  removeParticipant: (id, participantId) =>
    call("DELETE", at(id, `/participants/${encodeURIComponent(participantId)}`), newKey()),
  artifacts: (id) => call("GET", at(id, "/artifacts")),
  recordArtifact: (id, body) => post(at(id, "/artifacts"), body),
  decideArtifact: (artifactId, body) =>
    post(`/workshop-artifacts/${encodeURIComponent(artifactId)}/decision`, body),
  brief: (id) => call("GET", at(id, "/brief")),
  generateBrief: (id) => post(at(id, "/brief")),
  reviewBrief: (id, briefId) => post(at(id, `/brief/${encodeURIComponent(briefId)}/review`)),
  findings: (id) => call("GET", at(id, "/findings")),
  saveFindings: (id, body) => call("PUT", at(id, "/findings"), newKey(), body),
  finalise: (id, body) => post(at(id, "/findings/finalise"), body),
  suggest: (id, notes) => post(at(id, "/findings/suggest"), { notes }),
  output: (id) => call("GET", at(id, "/output")),
  generateOutput: (id) => post(at(id, "/output")),
  editOutput: (id, body) => call("PUT", at(id, "/output"), newKey(), body),
  approveOutput: (id) => post(at(id, "/output/approve")),
  shareOutput: (id, body) => post(at(id, "/output/share"), body),
  effortSummary: () => call("GET", "/workshop-effort-summary"),
  effort: (id) => call("GET", at(id, "/effort")),
  recordEffort: (id, body) => post(at(id, "/effort"), body),
};

export const STATE_TEXT: Record<WorkshopState, string> = {
  requested: "Requested",
  booked: "Booked",
  held: "Held",
  findings_recorded: "Findings recorded",
  closed: "Closed",
  cancelled: "Cancelled",
  no_show: "No-show",
};
export const OFFER_TEXT: Record<string, string> = {
  "sender-onboarding-friction-map": "Offer 1, Sender Onboarding Friction Map",
  "pilot-input-trace-workshop": "Offer 6, Pilot Input Trace Workshop",
};
