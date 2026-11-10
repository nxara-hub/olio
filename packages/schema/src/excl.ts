import {
  Kind,
  visit,
  type ASTNode,
  type DirectiveNode,
  type DocumentNode
} from "graphql";

import { fail } from "./directives/shared.js";

/** For editor tooling; `@excl` works without it being declared. */
export const exclDefinition = "directive @excl on FIELD_DEFINITION";

/**
 * Reads and removes every `@excl`, keyed `"Type.field"`. Whether the
 * type is a root is only known once the schema is built (`checkExcl`).
 */
export function extractExcl(document: DocumentNode): {
  document: DocumentNode;
  marked: Map<string, DirectiveNode>;
} {
  const marked = new Map<string, DirectiveNode>();
  const stripped = visit(document, {
    DirectiveDefinition: (node) =>
      node.name.value === "excl" ? null : undefined,
    Directive(node, _key, _parent, _path, ancestors) {
      if (node.name.value !== "excl") return undefined;
      const field = ancestors.at(-1) as ASTNode | undefined;
      const type = ancestors.at(-3) as ASTNode | undefined;
      if (
        field?.kind !== Kind.FIELD_DEFINITION ||
        (type?.kind !== Kind.OBJECT_TYPE_DEFINITION &&
          type?.kind !== Kind.OBJECT_TYPE_EXTENSION)
      ) {
        return fail(node, "@excl applies to query and mutation fields only");
      }
      const key = `${type.name.value}.${field.name.value}`;
      if (node.arguments?.length) {
        fail(node, `@excl on "${key}" takes no arguments`);
      }
      marked.set(key, node);
      return null;
    }
  });
  return { document: stripped, marked };
}

// A subscription already selects exactly one field, so only query and
// mutation fields can be @excl.
export function checkExcl(
  marked: ReadonlyMap<string, DirectiveNode>,
  roots: readonly (string | undefined)[]
): ReadonlySet<string> {
  for (const [key, node] of marked) {
    if (!roots.includes(key.slice(0, key.indexOf(".")))) {
      fail(
        node,
        `@excl on "${key}": only query and mutation fields can be @excl`
      );
    }
  }
  return new Set(marked.keys());
}
