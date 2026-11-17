import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse } from "yaml";

// Validates real responses against specs/*/contracts/*.openapi.yaml (task T035).

const contractsDir = (feature: string) =>
  join(import.meta.dirname, "..", "..", "..", "specs", feature, "contracts");

type Json = Record<string, unknown>;

export class Contract {
  private readonly doc: Json;
  private readonly ajv: Ajv2020;

  constructor(file: string, feature = "001-project-foundation") {
    this.doc = parse(readFileSync(join(contractsDir(feature), file), "utf8")) as Json;
    this.doc["$id"] = `contract:${file}`;
    this.ajv = new Ajv2020({ strict: false, allErrors: true });
    (addFormats as unknown as (a: Ajv2020) => void)(this.ajv);
    this.ajv.addSchema(this.doc);
  }

  private resolve(node: Json, pointer: string): { node: Json; pointer: string } {
    let current = node;
    let at = pointer;
    while (typeof current["$ref"] === "string") {
      at = (current["$ref"] as string).slice(1); // "#/components/..." -> "/components/..."
      current = this.lookup(at);
    }
    return { node: current, pointer: at };
  }

  private lookup(pointer: string): Json {
    let node: unknown = this.doc;
    for (const part of pointer.split("/").slice(1)) {
      node = (node as Json)[part.replace(/~1/g, "/").replace(/~0/g, "~")];
    }
    return node as Json;
  }

  /** Returns validation errors (empty when the body matches the documented response schema). */
  check(
    path: string,
    method: string,
    status: number,
    contentType: string,
    body: unknown,
  ): string[] {
    const escaped = path.replace(/~/g, "~0").replace(/\//g, "~1");
    const responsePointer = `/paths/${escaped}/${method.toLowerCase()}/responses/${status}`;
    const response = this.lookup(responsePointer) as Json | undefined;
    if (!response) return [`no ${status} response documented for ${method} ${path}`];
    const resolved = this.resolve(response, responsePointer);
    const mediaType = contentType.split(";")[0]!.trim().replace(/\//g, "~1");
    const content = (resolved.node["content"] as Json | undefined)?.[mediaType.replace(/~1/g, "/")];
    if (!content) return [`${status} for ${method} ${path} does not document ${contentType}`];
    const schemaPointer = `${resolved.pointer}/content/${mediaType}/schema`;
    const schemaNode = this.lookup(schemaPointer);
    const validate = this.ajv.compile({ $ref: `${this.doc["$id"] as string}#${schemaPointer}` });
    void schemaNode;
    return validate(body)
      ? []
      : (validate.errors ?? []).map((e) => `${e.instancePath || "(root)"} ${e.message ?? ""}`);
  }
}
