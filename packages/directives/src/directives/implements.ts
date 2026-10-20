import type { SchemaDirective } from "../apply-directives.js";
import { fieldCopyDirective } from "./shared.js";

/**
 * `@implements(from: ["Node", "Timestamped"])` adds the referenced interfaces
 * to an object type's `implements` list and copies their fields onto it.
 */
export function implementsDirective(): SchemaDirective {
  return fieldCopyDirective({
    name: "implements",
    definition: "directive @implements(from: [String!]!) on OBJECT",
    sources: { object: ["interface"] },
    addInterfaces: true,
    overrides: false
  });
}
