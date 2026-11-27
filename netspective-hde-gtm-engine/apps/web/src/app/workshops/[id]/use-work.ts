import { useCallback, useState } from "react";
import { describeCatalogueError } from "../../../lib/catalogue-http.js";

// One way for every workspace panel to run a call: busy while it runs, a plain message when it is refused.
export function useWork() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (work: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(describeCatalogueError(e));
    } finally {
      setBusy(false);
    }
  }, []);
  return { error, busy, run };
}

export const lines = (value: string): string[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
