"use client";
import { useCallback, useEffect, useState } from "react";
import {
  browserQuarantineApi,
  type QuarantineApi,
  type QuarantineItemView,
} from "../../../lib/quarantine-api.js";

export function QuarantineReview({ api = browserQuarantineApi }: { api?: QuarantineApi }) {
  const [items, setItems] = useState<QuarantineItemView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .list()
      .then((r) => setItems(r.items))
      .catch(() => setError("Could not load quarantined items."));
  }, [api]);
  useEffect(refresh, [refresh]);

  async function view(id: string) {
    setError(null);
    try {
      setSelected(id);
      setContent((await api.viewContent(id, "reviewing a possible false positive")).content);
    } catch {
      setError("Could not open that item.");
    }
  }

  async function decide(id: string, action: "release" | "discard") {
    if (reason.trim().length < 3) {
      setError("Enter a reason for the decision.");
      return;
    }
    setError(null);
    try {
      await (action === "release" ? api.release(id, reason) : api.discard(id, reason));
      setContent(null);
      setSelected(null);
      setReason("");
      refresh();
    } catch {
      setError("The decision could not be saved. Please try again.");
    }
  }

  return (
    <section>
      <h1>Quarantine</h1>
      {error ? <p role="alert">{error}</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.entryPoint}</span> <span>{item.status}</span>{" "}
            <span>Rules: {item.ruleIds.join(", ")}</span>
            {item.status === "held" && !item.contentPurged ? (
              <button type="button" onClick={() => void view(item.id)}>
                View content
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {selected && content !== null ? (
        <div>
          <pre aria-label="Held content">{content}</pre>
          <label>
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button type="button" onClick={() => void decide(selected, "release")}>
            Release
          </button>
          <button type="button" onClick={() => void decide(selected, "discard")}>
            Discard
          </button>
        </div>
      ) : null}
    </section>
  );
}
