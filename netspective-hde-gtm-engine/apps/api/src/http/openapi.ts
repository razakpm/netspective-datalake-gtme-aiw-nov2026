import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { ProblemSchema } from "@gtm/domain";
import { z } from "zod";

// OpenAPI 3.1 is generated from the same Zod schemas that validate requests (research R-03). Routes
// register their schemas here as features land; the drift check (task T123) compares the generated
// document with specs/*/contracts/*.openapi.yaml.

extendZodWithOpenApi(z);

export const openApiRegistry = new OpenAPIRegistry();
// Zod 4 only adds `.openapi()` to schemas created AFTER extendZodWithOpenApi() runs, and shared
// schemas in @gtm/domain are created when that package is imported, before this module runs. Register
// a derived copy (`.extend({})` builds a new schema after the extension) instead of the original.
openApiRegistry.register("Problem", ProblemSchema.extend({}));

export type OpenApiDocument = ReturnType<OpenApiGeneratorV31["generateDocument"]>;

export function buildOpenApiDocument(): OpenApiDocument {
  const generator = new OpenApiGeneratorV31(openApiRegistry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: { title: "GTM Engine API", version: "0.1.0" },
    servers: [{ url: "/api/v1" }],
  });
}
