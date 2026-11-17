import type { FastifyInstance } from "fastify";
import { loadConfig, type AppConfig } from "../src/config/index.js";
import { buildServer, type ServerOptions } from "../src/http/server.js";
import { createLogger } from "../src/logging/logger.js";

export interface TestServer {
  app: FastifyInstance;
  config: AppConfig;
  /** Every log line written while the server ran. */
  logs: string[];
}

export async function buildTestServer(
  overrides: {
    env?: Record<string, string>;
    routes?: ServerOptions["routes"];
    phiGuardSink?: ServerOptions["phiGuardSink"];
    quarantine?: ServerOptions["quarantine"];
    guardPolicy?: ServerOptions["guardPolicy"];
  } = {},
): Promise<TestServer> {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://gtm:local-only@localhost:5432/gtm",
    ...overrides.env,
  });
  const logs: string[] = [];
  const logger = createLogger({
    level: "debug",
    destination: {
      write(line: string) {
        logs.push(line);
      },
    },
  });
  const app = await buildServer({
    config,
    logger,
    ...(overrides.routes ? { routes: overrides.routes } : {}),
    ...(overrides.phiGuardSink ? { phiGuardSink: overrides.phiGuardSink } : {}),
    ...(overrides.quarantine ? { quarantine: overrides.quarantine } : {}),
    ...(overrides.guardPolicy ? { guardPolicy: overrides.guardPolicy } : {}),
  });
  return { app, config, logs };
}
