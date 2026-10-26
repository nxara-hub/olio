import {
  Kind,
  visit,
  type ASTNode,
  type DirectiveNode,
  type DocumentNode,
  type ObjectTypeDefinitionNode,
  type ObjectTypeExtensionNode
} from "graphql";

import { fail } from "./directives/shared.js";

/** `"Type.field"` -> the keys `@bypass` tells that field's middleware. */
export type Bypass = Map<string, Set<string>>;

/** For editor tooling; `@bypass` works without it being declared. */
export const bypassDefinition =
  "directive @bypass(keys: [String!]!) on OBJECT | FIELD_DEFINITION";

type ObjectNode = ObjectTypeDefinitionNode | ObjectTypeExtensionNode;

const isObject = (node: ASTNode | undefined): node is ObjectNode =>
  node?.kind === Kind.OBJECT_TYPE_DEFINITION ||
  node?.kind === Kind.OBJECT_TYPE_EXTENSION;

function keysOf(directive: DirectiveNode, target: string): string[] {
  const args = directive.arguments ?? [];
  const other = args.find((arg) => arg.name.value !== "keys");
  if (other) {
    fail(
      other,
      `@bypass on ${target} takes only keys, not "${other.name.value}"`
    );
  }
  const keys = args[0];
  if (!keys) {
    fail(
      directive,
      `@bypass on ${target} needs keys, e.g. @bypass(keys: ["tokenCheck"])`
    );
  }
  // GraphQL reads a single value as a one-item list.
  const values =
    keys.value.kind === Kind.LIST ? keys.value.values : [keys.value];
  if (values.length === 0)
    fail(keys, `@bypass on ${target} needs at least one key`);
  return values.map((value) => {
    if (value.kind !== Kind.STRING || value.value === "") {
      fail(value, `@bypass on ${target}: keys are non-empty strings`);
    }
    return value.value;
  });
}

/**
 * Reads and removes every `@bypass`: on an object type (or an `extend`
 * block) it covers the fields declared in that block, on a field just that
 * field. It never reaches the served schema.
 */
export function extractBypass(document: DocumentNode): {
  document: DocumentNode;
  bypass: Bypass;
} {
  const bypass: Bypass = new Map();
  const add = (field: string, keys: readonly string[]): void => {
    const set = bypass.get(field) ?? new Set<string>();
    for (const key of keys) set.add(key);
    bypass.set(field, set);
  };
  const stripped = visit(document, {
    DirectiveDefinition: (node) =>
      node.name.value === "bypass" ? null : undefined,
    Directive(node, _key, _parent, _path, ancestors) {
      if (node.name.value !== "bypass") return undefined;
      const owner = ancestors.at(-1) as ASTNode | undefined;
      const type = ancestors.at(-3) as ASTNode | undefined;
      if (isObject(owner)) {
        const keys = keysOf(node, `"${owner.name.value}"`);
        for (const field of owner.fields ?? []) {
          add(`${owner.name.value}.${field.name.value}`, keys);
        }
        return null;
      }
      if (owner?.kind === Kind.FIELD_DEFINITION && isObject(type)) {
        const field = `${type.name.value}.${owner.name.value}`;
        add(field, keysOf(node, `"${field}"`));
        return null;
      }
      return fail(
        node,
        "@bypass applies to object types and their fields only"
      );
    }
  });
  return { document: stripped, bypass };
}
