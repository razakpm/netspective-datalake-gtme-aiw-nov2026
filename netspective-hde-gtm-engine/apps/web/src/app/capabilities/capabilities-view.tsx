"use client";
import { useCallback, useEffect, useState } from "react";
import { PhiWarning } from "../../components/phi-warning.js";
import { describeCatalogueError, newKey } from "../../lib/catalogue-http.js";
import {
  browserCapabilitiesApi,
  type Capability,
  type CapabilitiesApi,
  type CapabilitySummary,
} from "../../lib/capabilities-api.js";

// Capability catalogue (feature 005, task T073): the 19 capabilities with placeholders marked, linked offers
// and public-claim status. Internal delivery examples appear only for holders of capabilities.examples.read
// and are always labelled internal. The API enforces every permission regardless.

const list = (v: string[] | null) => (v && v.length > 0 ? v.join(", ") : "To be provided");
const text = (v: string | null) => v ?? "To be provided";

export function CapabilitiesView({
  permissions,
  api = browserCapabilitiesApi,
}: {
  permissions: readonly string[];
  api?: CapabilitiesApi;
}) {
  const can = (p: string) => permissions.includes(p);
  const [items, setItems] = useState<CapabilitySummary[]>([]);
  const [detail, setDetail] = useState<Capability | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimId, setClaimId] = useState("");

  const run = useCallback(async (work: () => Promise<void>) => {
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(describeCatalogueError(e));
    }
  }, []);
  const load = useCallback(() => run(async () => setItems((await api.list()).items)), [api, run]);
  const open = useCallback(
    (id: string) => run(async () => setDetail(await api.get(id))),
    [api, run],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = (status: "approved" | "not_approved") => {
    if (!detail) return;
    void run(async () => {
      await api.setPublicStatus(
        detail.id,
        { status, ...(status === "approved" ? { claimId } : {}) },
        newKey(),
      );
      setClaimId("");
      await load();
      await open(detail.id);
    });
  };

  return (
    <main>
      <h1>Service capabilities</h1>
      {error ? <p role="alert">{error}</p> : null}
      <ul aria-label="Capabilities">
        {items.map((c) => (
          <li key={c.id}>
            <strong>
              Capability {c.slot}: {c.name ?? "To be provided"}
            </strong>
            <span>
              {" "}
              {c.publicClaimStatus === "approved"
                ? "Approved for public claims."
                : "Not approved for public claims."}
            </span>
            {c.placeholderAttributes.length > 0 ? (
              <span> {c.placeholderAttributes.length} details to be provided.</span>
            ) : null}
            {c.publicClaimNeedsReview ? (
              <p role="note">Its public claim needs review: the evidence has lapsed.</p>
            ) : null}
            <button type="button" onClick={() => void open(c.id)}>
              Open capability {c.slot}
            </button>
          </li>
        ))}
      </ul>

      {detail ? (
        <section aria-label={`Capability ${detail.slot}`}>
          <h2>
            Capability {detail.slot}: {detail.name ?? "To be provided"}
          </h2>
          <dl>
            <dt>Description</dt>
            <dd>{text(detail.attributes.description)}</dd>
            <dt>Input types</dt>
            <dd>{list(detail.attributes.inputTypes)}</dd>
            <dt>Output types</dt>
            <dd>{list(detail.attributes.outputTypes)}</dd>
            <dt>Buyer problems addressed</dt>
            <dd>{list(detail.attributes.buyerProblems)}</dd>
            <dt>Limitations</dt>
            <dd>{list(detail.attributes.limitations)}</dd>
            <dt>Required expertise</dt>
            <dd>{text(detail.attributes.requiredExpertise)}</dd>
            <dt>Potential paid engagement</dt>
            <dd>{text(detail.attributes.potentialPaidTypeKey)}</dd>
          </dl>

          <h3>Evidence basis</h3>
          {detail.evidence.length === 0 ? <p>No evidence basis recorded.</p> : null}
          <ul aria-label="Evidence">
            {detail.evidence.map((e) => (
              <li key={e.id}>
                {e.basisKind.replace(/_/g, " ")}: {e.reference}
              </li>
            ))}
          </ul>

          <h3>Related offers</h3>
          {detail.offers.length === 0 ? <p>No offers linked.</p> : null}
          <ul aria-label="Related offers">
            {detail.offers.map((o) => (
              <li key={o.offerId}>{o.name ?? o.offerId}</li>
            ))}
          </ul>

          {can("capabilities.examples.read") && detail.deliveryExamples ? (
            <>
              <h3>Internal delivery examples (internal only)</h3>
              {detail.deliveryExamples.length === 0 ? <p>No examples recorded.</p> : null}
              <ul aria-label="Delivery examples">
                {detail.deliveryExamples.map((x) => (
                  <li key={x.id}>{x.text}</li>
                ))}
              </ul>
            </>
          ) : null}

          <h3>Public claims</h3>
          <p>
            {detail.publicClaimStatus === "approved"
              ? "Approved for public claims."
              : "Not approved for public claims."}
          </p>
          {detail.publicClaimNeedsReview ? (
            <p role="note">Its public claim needs review: the evidence has lapsed.</p>
          ) : null}
          {can("claims.approve") ? (
            <div>
              {detail.publicClaimStatus === "approved" ? (
                <button type="button" onClick={() => setStatus("not_approved")}>
                  Withdraw public approval
                </button>
              ) : (
                <>
                  <label>
                    Approved claim id
                    <input
                      value={claimId}
                      onChange={(e) => setClaimId(e.target.value)}
                      maxLength={100}
                    />
                  </label>
                  <PhiWarning value={claimId} />
                  <button
                    type="button"
                    onClick={() => setStatus("approved")}
                    disabled={claimId.trim() === ""}
                  >
                    Approve for public claims
                  </button>
                </>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
