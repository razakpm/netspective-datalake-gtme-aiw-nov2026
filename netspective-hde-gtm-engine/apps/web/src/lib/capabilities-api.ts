import { call } from "./catalogue-http.js";

// Browser-side client for the capabilities API (contracts/capabilities.openapi.yaml). Delivery examples are
// internal only: the API returns them just to a holder of capabilities.examples.read.

export interface CapabilitySummary {
  id: string;
  slot: number;
  lockNo: number;
  name: string | null;
  publicClaimStatus: "not_approved" | "approved";
  publicClaimNeedsReview: boolean;
  placeholderAttributes: string[];
}
export interface Capability extends CapabilitySummary {
  attributes: {
    name: string | null;
    description: string | null;
    inputTypes: string[] | null;
    outputTypes: string[] | null;
    buyerProblems: string[] | null;
    limitations: string[] | null;
    requiredExpertise: string | null;
    potentialPaidTypeKey: string | null;
  };
  evidence: { id: string; basisKind: string; reference: string; note: string | null }[];
  offers: { offerId: string; name: string | null }[];
  publicClaimId: string | null;
  deliveryExamples?: { id: string; text: string; addedAt: string }[];
}

export interface CapabilitiesApi {
  list(): Promise<{ items: CapabilitySummary[] }>;
  get(id: string): Promise<Capability>;
  setPublicStatus(
    id: string,
    body: { status: "approved" | "not_approved"; claimId?: string },
    key: string,
  ): Promise<Capability>;
}

const enc = encodeURIComponent;
export const browserCapabilitiesApi: CapabilitiesApi = {
  list: () => call("GET", "/service-capabilities"),
  get: (id) => call("GET", `/service-capabilities/${enc(id)}`),
  setPublicStatus: (id, body, key) =>
    call("PUT", `/service-capabilities/${enc(id)}/public-claim-status`, key, body),
};
