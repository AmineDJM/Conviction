/** Convert a zod schema into an OpenAI strict structured-output JSON schema. */
import { z } from "zod";

type Json = Record<string, unknown>;

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (!node || typeof node !== "object") return node;
  const n = { ...(node as Json) };
  delete n.$schema;
  delete n.default;
  // Integer bounds emitted by zod for .int() are noise to the model.
  if (n.type === "integer") {
    if (n.minimum === -9007199254740991) delete n.minimum;
    if (n.maximum === 9007199254740991) delete n.maximum;
  }
  if (n.type === "object" || n.properties) {
    const props = (n.properties ?? {}) as Json;
    for (const k of Object.keys(props)) props[k] = strictify(props[k]);
    n.properties = props;
    n.required = Object.keys(props);
    n.additionalProperties = false;
  }
  for (const key of ["items", "anyOf", "oneOf", "allOf", "$defs", "definitions"]) {
    if (n[key] === undefined) continue;
    if (key === "$defs" || key === "definitions") {
      const defs = { ...(n[key] as Json) };
      for (const k of Object.keys(defs)) defs[k] = strictify(defs[k]);
      n[key] = defs;
    } else n[key] = strictify(n[key]);
  }
  return n;
}

export function toStrictJsonSchema(schema: z.ZodType): Json {
  const raw = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" }) as Json;
  return strictify(raw) as Json;
}
