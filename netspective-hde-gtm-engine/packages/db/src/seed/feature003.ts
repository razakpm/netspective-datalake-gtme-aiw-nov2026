import { SEED_SIGNAL_TYPES, SOURCE_KIND_RELIABILITY, type SourceKind } from "@gtm/domain";
import type { Tx } from "../sqlite/database.js";

// Feature 003 reference data (task T012): taxonomy version 1 and one default signal source per kind.
// Idempotent; default sources have stable ids (like role ids) so the seed can be diffed. Everything is labelled hypothesis (open questions #35 to #37).

const DEFAULT_SOURCES: readonly [SourceKind, string, "excerpt" | "citation_only"][] = [
  ["official_publication", "Official publication (default)", "excerpt"],
  ["buyer_statement", "Buyer statement (default)", "excerpt"],
  ["third_party", "Third-party report (default)", "citation_only"],
  ["analyst_observation", "Analyst observation (default)", "excerpt"],
  ["provider", "Provider feed (default)", "citation_only"],
  ["first_party", "First-party Netspective channel (default)", "excerpt"],
  ["other", "Other source (default)", "citation_only"],
];

export function seedFeature003(tx: Tx): void {
  const now = new Date().toISOString();
  tx.prepare(
    "INSERT OR IGNORE INTO taxonomy_version (version, status, released_at, approved_by, note, status_label) VALUES (1, 'current', ?, NULL, 'Initial hypothesis taxonomy (open question #35)', 'hypothesis')",
  ).run(now);
  const insertType = tx.prepare(
    `INSERT OR IGNORE INTO signal_type (taxonomy_version, key, category, label, kind, default_freshness_days,
       default_reliability, context_only, status, status_label)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'active', 'hypothesis')`,
  );
  for (const type of SEED_SIGNAL_TYPES) {
    insertType.run(
      type.key,
      type.category,
      type.label,
      type.kind,
      type.defaultFreshnessDays,
      type.defaultReliability,
      type.contextOnly ? 1 : 0,
    );
  }
  const insertSource = tx.prepare(
    `INSERT OR IGNORE INTO signal_source (id, name, kind, default_reliability, storage_rule, excerpt_max_chars,
       availability, created_by, created_at, status_label)
     VALUES (?, ?, ?, ?, ?, NULL, 'available', NULL, ?, 'hypothesis')`,
  );
  for (const [kind, name, rule] of DEFAULT_SOURCES) {
    insertSource.run(
      `default-source-${kind}`,
      name,
      kind,
      SOURCE_KIND_RELIABILITY[kind],
      rule,
      now,
    );
  }
}
