import { PROMPTS, SCHEMA_REGISTRY, promptHash } from "@gtm/ai-contracts";
import type { Tx } from "../sqlite/database.js";

// Feature 004 reference data (task T013): hypothesis categories, the provisional capability list and the
// prompt versions, all labelled hypothesis (open question #46). Idempotent. A changed prompt file gets a
// new `prompt_version` row (its hash differs), never an update of the old one.

export const HYPOTHESIS_CATEGORIES: readonly [string, string][] = [
  ["onboarding_friction", "Sender onboarding friction"],
  ["ig_change_management", "Implementation-guide change management"],
  ["pilot_input_quality", "Pilot input quality and traceability"],
  ["data_quality", "Data quality"],
  ["platform_architecture", "Platform and architecture"],
  ["capability_gap", "Capability gap"],
  ["other", "Other"],
];

export const PROVISIONAL_CAPABILITIES: readonly [string, string][] = [
  ["multi_format_intake", "Multi-format intake"],
  ["ccda_to_fhir_mapping", "C-CDA to FHIR mapping"],
  ["hl7v2_integration", "HL7 v2 integration"],
  ["data_quality_monitoring", "Data quality monitoring"],
  ["field_lineage_traceability", "Field lineage and traceability"],
  ["record_matching", "Record matching"],
  ["terminology_mapping", "Terminology mapping"],
  ["ig_change_management", "Implementation-guide change management"],
  ["sender_onboarding_automation", "Sender onboarding automation"],
  ["data_lake_foundation", "Data lake foundation"],
];

export function seedFeature004(tx: Tx): void {
  const category = tx.prepare(
    "INSERT OR IGNORE INTO hypothesis_category (key, label, active, status_label) VALUES (?,?,1,'hypothesis')",
  );
  for (const [key, label] of HYPOTHESIS_CATEGORIES) category.run(key, label);
  const capability = tx.prepare(
    "INSERT OR IGNORE INTO service_capability_provisional (key, label, active, status_label) VALUES (?,?,1,'hypothesis')",
  );
  for (const [key, label] of PROVISIONAL_CAPABILITIES) capability.run(key, label);

  const insert = tx.prepare(
    `INSERT OR IGNORE INTO prompt_version (id, name, version, template_hash, output_schema_id,
       output_schema_version, status, approved_by, approved_at)
     VALUES (?,?,?,?,?,?,'approved',NULL,?)`,
  );
  const now = new Date().toISOString();
  for (const prompt of PROMPTS) {
    const hash = promptHash(prompt.name);
    const schema = SCHEMA_REGISTRY[prompt.outputSchemaId];
    if (!schema) throw new Error(`unknown schema ${prompt.outputSchemaId}`);
    // One row per (name, version); a changed template under the same version is a release error.
    const existing = tx
      .prepare("SELECT template_hash FROM prompt_version WHERE name = ? AND version = ?")
      .get(prompt.name, prompt.version) as { template_hash: string } | undefined;
    if (existing && existing.template_hash !== hash) {
      throw new Error(
        `prompt ${prompt.name}@${prompt.version} changed without a new version (bump the version in the registry)`,
      );
    }
    insert.run(
      `prompt-${prompt.name}-${prompt.version}`,
      prompt.name,
      prompt.version,
      hash,
      prompt.outputSchemaId,
      schema.version,
      now,
    );
  }
}
