// Test projects and coverage gate (tasks T008; constitution Quality gates).
// unit: fast, no containers. integration: Testcontainers Postgres. contracts: API and provider contracts.
// Coverage must stay at or above 80% on packages/domain and packages/ai-contracts.
import { defineConfig } from "vitest/config";

const common = { exclude: ["**/node_modules/**", "**/dist/**", "tools/lint-fixtures/**"] };
const roots = "{apps,packages,tools}";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: [`${roots}/**/*.test.{ts,tsx}`],
          exclude: [...common.exclude, "**/*.int.test.ts", "**/*.contract.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: [`${roots}/**/*.int.test.{ts,tsx}`],
          exclude: common.exclude,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
      {
        test: {
          name: "contracts",
          include: [
            `${roots}/**/*.contract.test.ts`,
            "packages/providers/test/contract/**/*.test.ts",
          ],
          exclude: common.exclude,
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/domain/src/**/*.ts", "packages/ai-contracts/src/**/*.ts"],
      exclude: ["**/index.ts", "**/*.test.ts", "**/test-support/**"],
      reporter: ["text-summary", "lcov"],
      thresholds: {
        "packages/domain/src/**": { lines: 80, functions: 80, branches: 80, statements: 80 },
        "packages/ai-contracts/src/**": { lines: 80, functions: 80, branches: 80, statements: 80 },
      },
    },
  },
});
