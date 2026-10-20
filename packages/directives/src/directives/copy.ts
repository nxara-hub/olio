import type { SchemaDirective } from "../apply-directives.js";
import { fieldCopyDirective } from "./shared.js";

/**
 * `@copy(from: ["Node", "CommonPagination"])` copies fields from the
 * referenced types onto a type or input, without adding an `implements`
 * clause.
 */
export function copyDirective(): SchemaDirective {
  return fieldCopyDirective({
    name: "copy",
    definition: "directive @copy(from: [String!]!) on OBJECT | INPUT_OBJECT",
    sources: { object: ["object", "interface"], input: ["input"] },
    overrides: true
  });
}
