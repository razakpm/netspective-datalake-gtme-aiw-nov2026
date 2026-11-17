import { isOrgType, type OrgType } from "./org-types.js";
import { normaliseDomain } from "./normalise.js";

// Organisation CSV row validation (spec FR-001, FR-002, FR-010). Reasons are codes, never row content.

export interface RawAccountRow {
  name?: string;
  aliases?: string;
  domains?: string;
  type?: string;
  geography?: string;
  notes?: string;
  staffed_beds?: string;
}

export interface AccountRow {
  name: string;
  aliases: string[];
  domains: string[];
  orgType: OrgType;
  geography: string | null;
  notes: string | null;
  staffedBedCount: number | null | undefined; // undefined: column absent or empty (leave unchanged)
}

export type AccountRowResult = { ok: true; value: AccountRow } | { ok: false; reasons: string[] };

const split = (value: string | undefined) =>
  (value ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean);

export function validateAccountRow(raw: RawAccountRow): AccountRowResult {
  const reasons: string[] = [];
  const name = (raw.name ?? "").trim();
  if (name === "") reasons.push("missing_name");
  else if (name.length > 200) reasons.push("name_too_long");

  const typeText = (raw.type ?? "").trim().toLowerCase();
  let orgType: OrgType = "unknown";
  if (typeText !== "") {
    if (isOrgType(typeText)) orgType = typeText;
    else reasons.push("invalid_type");
  }

  const domains: string[] = [];
  for (const d of split(raw.domains)) {
    const normalised = normaliseDomain(d);
    if (normalised === null) reasons.push("invalid_domain");
    else if (!domains.includes(normalised)) domains.push(normalised);
  }

  const aliases = split(raw.aliases);
  if (aliases.some((a) => a.length > 200)) reasons.push("alias_too_long");

  const geography = (raw.geography ?? "").trim();
  if (geography.length > 200) reasons.push("geography_too_long");
  const notes = (raw.notes ?? "").trim();
  if (notes.length > 2000) reasons.push("notes_too_long");

  let staffedBedCount: number | null | undefined;
  const beds = (raw.staffed_beds ?? "").trim();
  if (beds !== "") {
    if (/^\d{1,7}$/.test(beds)) staffedBedCount = Number(beds);
    else reasons.push("invalid_staffed_beds");
  }

  if (reasons.length > 0) return { ok: false, reasons: [...new Set(reasons)] };
  return {
    ok: true,
    value: {
      name,
      aliases,
      domains,
      orgType,
      geography: geography === "" ? null : geography,
      notes: notes === "" ? null : notes,
      staffedBedCount,
    },
  };
}
