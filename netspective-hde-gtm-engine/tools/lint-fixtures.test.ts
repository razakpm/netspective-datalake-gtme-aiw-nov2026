import { mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Proves the architecture lint rules (eslint.config.js) actually fail on violations (task T032).
// Each fixture is copied to a real project path for the duration of one lint run and then removed,
// because the rules depend on where a file lives. Fixtures are excluded from normal lint and build.

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = join(root, "tools", "lint-fixtures");

interface Case {
  name: string;
  fixture: string;
  target: string;
  /** Extra fixture files that must exist beside the target while linting. */
  support?: { fixture: string; target: string }[];
  expectRule: string | null;
}

const cases: Case[] = [
  {
    name: "a module deep-importing another module fails the entry-point rule",
    fixture: "deep-import.ts.fixture",
    target: "apps/api/src/modules/identity/__lint_fixture_deep.ts",
    support: [
      {
        fixture: "deep-import-target.ts.fixture",
        target: "apps/api/src/modules/accounts/__lint_fixture_internal.ts",
      },
    ],
    expectRule: "boundaries/entry-point",
  },
  {
    name: "a module importing another module's index.ts is allowed",
    fixture: "public-import-ok.ts.fixture",
    target: "apps/api/src/modules/identity/__lint_fixture_public.ts",
    expectRule: null,
  },
  {
    name: "packages/domain importing providers fails",
    fixture: "domain-imports-providers.ts.fixture",
    target: "packages/domain/src/__lint_fixture_providers.ts",
    expectRule: "no-restricted-imports",
  },
  {
    name: "packages/domain importing ai-contracts fails",
    fixture: "domain-imports-ai-contracts.ts.fixture",
    target: "packages/domain/src/__lint_fixture_ai.ts",
    expectRule: "no-restricted-imports",
  },
  {
    name: "a vendor SDK outside provider adapters fails",
    fixture: "vendor-sdk.ts.fixture",
    target: "packages/db/src/__lint_fixture_vendor.ts",
    expectRule: "no-restricted-imports",
  },
  {
    name: "a vendor SDK inside provider adapters is allowed",
    fixture: "adapter-vendor-ok.ts.fixture",
    target: "packages/providers/src/adapters/__lint_fixture_adapter.ts",
    expectRule: null,
  },
];

function place(fixture: string, target: string): string {
  const path = join(root, target);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, readFileSync(join(fixtures, fixture)));
  return path;
}

describe("architecture lint rules", () => {
  it.each(cases.map((c) => [c.name, c] as const))(
    "%s",
    async (_name, c) => {
      const placed: string[] = [];
      try {
        for (const s of c.support ?? []) placed.push(place(s.fixture, s.target));
        const target = place(c.fixture, c.target);
        placed.push(target);

        const eslint = new ESLint({ cwd: root });
        const [result] = await eslint.lintFiles([target]);
        const errors = (result?.messages ?? []).filter((m) => m.severity === 2);

        if (c.expectRule === null) {
          expect(errors.map((m) => `${m.ruleId}: ${m.message}`)).toEqual([]);
        } else {
          expect(errors.map((m) => m.ruleId)).toContain(c.expectRule);
        }
      } finally {
        for (const path of placed) rmSync(path, { force: true });
        // Remove the adapters directory this test may have created. rmdir only succeeds when it is
        // empty, so real adapter files can never be deleted by this cleanup.
        try {
          rmdirSync(join(root, "packages/providers/src/adapters"));
        } catch {
          // Not empty or already gone: nothing to clean up.
        }
      }
    },
    60_000,
  );
});
