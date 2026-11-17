// Lint, format and architecture rules (constitution Principles IX, XV, XVI).
//  - Modules under apps/api/src/modules may be imported only through their public index.ts.
//  - Rule modules in packages/domain must not import packages/providers or packages/ai-contracts
//    (deterministic rules, never an LLM).
//  - Vendor SDKs are importable only inside packages/providers/src/adapters.
// tools/lint-fixtures/ holds deliberate violations used by the lint self-test (task T032).
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import boundaries from "eslint-plugin-boundaries";
import tseslint from "typescript-eslint";

// Vendor SDK package names that must stay inside provider adapters. Extend as adapters are added.
const vendorSdks = [
  "@aws-sdk/*",
  "@anthropic-ai/sdk",
  "openai",
  "postmark",
  "nodemailer",
  "googleapis",
  "@googleapis/*",
  "@microsoft/microsoft-graph-client",
  "@azure/*",
];

const vendorSdkPattern = {
  group: vendorSdks,
  message: "Vendor SDKs may only be imported inside packages/providers/src/adapters (ADR-006).",
};

const domainIsolationPattern = {
  group: ["@gtm/providers", "@gtm/providers/*", "@gtm/ai-contracts", "@gtm/ai-contracts/*"],
  message:
    "packages/domain rules must not import providers or AI contracts: deterministic rules are never LLM-backed (constitution IX).",
};

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.next/**",
      "tools/lint-fixtures/**",
      "specs/**",
      "docs/**",
      ".specify/**",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    ignores: ["packages/providers/src/adapters/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [vendorSdkPattern] }],
    },
  },
  {
    files: ["packages/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [vendorSdkPattern, domainIsolationPattern] }],
    },
  },
  {
    files: ["apps/api/src/modules/**/*.ts"],
    plugins: { boundaries },
    settings: {
      // Lets the plugin resolve NodeNext-style "./x.js" specifiers to the real .ts files.
      "import/resolver": { typescript: { project: "apps/api/tsconfig.json" } },
      "boundaries/elements": [
        { type: "module", pattern: "apps/api/src/modules/*", capture: ["name"] },
      ],
    },
    rules: {
      // Modules talk through another module's public index or through domain events only.
      "boundaries/entry-point": [
        "error",
        {
          default: "disallow",
          policies: [{ target: [{ element: { type: "module" } }], allow: ["index.ts"] }],
        },
      ],
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
  },
);
