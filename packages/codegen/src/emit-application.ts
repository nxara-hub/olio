import type { Ownership, RootTypes } from "@nxlab/schema";
import {
  isAbstractType,
  isEnumType,
  isObjectType,
  isScalarType,
  type GraphQLSchema
} from "graphql";

import { inputMember } from "./type-map.js";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Quote a module key when it is not a valid TypeScript identifier. */
const moduleKey = (id: string): string =>
  IDENTIFIER.test(id) ? id : JSON.stringify(id);

const union = (names: readonly string[]): string =>
  names.length ? names.map((n) => `"${n}"`).join(" | ") : "never";

/**
 * One type's entry: its TypeScript type, the fields the module owns, and
 * arguments for the fields that take any. Olio derives resolver signatures and
 * middleware targets from this.
 */
function emitEntry(
  schema: GraphQLSchema,
  operations: ReadonlyMap<string, string>,
  name: string,
  owned: ReadonlySet<string>
): string {
  const type = schema.getType(name);
  const fields = [...owned].sort();
  // An enum's entry lists the values the module declares; olio types their
  // internal values from it.
  if (isEnumType(type)) {
    return `    ${name}: { type: ${name}; fields: never; enum: ${union(fields)} };`;
  }
  // A scalar's entry marks the module that implements it.
  if (isScalarType(type)) {
    return `    ${name}: { type: Scalars["${name}"]["output"]; fields: never; scalar: true };`;
  }
  const members = [`type: ${name}`, `fields: ${union(fields)}`];
  // Root types are found by operation, so their names can be anything.
  const operation = operations.get(name);
  if (operation) members.push(`root: "${operation}"`);
  if (isAbstractType(type)) {
    members.push(
      `resolveType: ${union(
        schema
          .getPossibleTypes(type)
          .map((t) => t.name)
          .sort()
      )}`
    );
  }

  const objectFields = isObjectType(type) ? type.getFields() : {};
  const args = fields.flatMap((f) => {
    const field = objectFields[f];
    return field?.args.length
      ? [`        ${f}: { ${field.args.map(inputMember).join("; ")} };`]
      : [];
  });

  if (args.length === 0) return `    ${name}: { ${members.join("; ")} };`;
  return [
    `    ${name}: {`,
    ...members.map((m) => `      ${m};`),
    "      args: {",
    ...args,
    "      };",
    "    };"
  ].join("\n");
}

/** `Application`: every module and the types it declares fields on. */
export function emitApplication(
  schema: GraphQLSchema,
  ownership: Ownership,
  roots: RootTypes
): string {
  /** Root type name -> its operation. */
  const operations = new Map(
    Object.entries(roots).map(([operation, name]) => [name, operation])
  );
  const modules = [...ownership]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, types]) => {
      const entries = [...types]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, owned]) => emitEntry(schema, operations, name, owned));
      return entries.length
        ? `  ${moduleKey(id)}: {\n${entries.join("\n")}\n  };`
        : `  ${moduleKey(id)}: {};`;
    });
  return `export type Application = {\n${modules.join("\n")}\n};`;
}
