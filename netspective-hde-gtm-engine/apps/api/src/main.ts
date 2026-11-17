import { buildHttpApp, buildServices, openDatabase } from "./app.js";
import { loadConfig } from "./config/index.js";
import { createLogger, registerSecrets } from "./logging/logger.js";
import { Worker } from "./worker/bootstrap.js";
import { HandlerRegistry } from "./worker/registry.js";

// Entry point. One codebase runs the HTTP role, the worker role, or both: `--role http|worker|both`
// overrides APP_ROLE (spec FR-023, task T078). Persistence is SQLite for the first version (ADR-015);
// the file is GTM_SQLITE_PATH, default ./.data/gtm.db.

function roleFromArgs(fallback: "http" | "worker" | "both"): "http" | "worker" | "both" {
  const i = process.argv.indexOf("--role");
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (value === undefined) return fallback;
  if (value === "http" || value === "worker" || value === "both") return value;
  throw new Error("--role must be http, worker or both");
}

async function main(): Promise<void> {
  const config = loadConfig();
  registerSecrets(config.secretValues);
  const logger = createLogger({ level: config.logLevel });
  const role = roleFromArgs(config.role);

  const dbPath = process.env["GTM_SQLITE_PATH"] ?? "./.data/gtm.db";
  if (dbPath !== ":memory:") {
    const { mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = openDatabase(dbPath);
  const services = buildServices(config, db);

  let worker: Worker | undefined;
  if (role === "worker" || role === "both") {
    const registry = new HandlerRegistry();
    if (config.env !== "production") {
      const { registerSyntheticJobs } = await import("../test-support/jobs/index.js");
      registerSyntheticJobs(registry);
    }
    worker = new Worker({ service: services.jobs, registry, logger });
    worker.start();
    logger.info({ queues: registry.queues() }, "worker started");
  }

  let app: Awaited<ReturnType<typeof buildHttpApp>> | undefined;
  if (role === "http" || role === "both") {
    app = await buildHttpApp(config, logger, services);
    await app.listen({ port: config.port, host: "0.0.0.0" });
  }

  const shutdown = async () => {
    logger.info("shutting down");
    await worker?.stop();
    await app?.close();
    db.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}

main().catch((error: unknown) => {
  // loadConfig errors name settings only and never include values, so printing the message is safe.
  console.error(error instanceof Error ? error.message : "startup failed");
  process.exit(1);
});
