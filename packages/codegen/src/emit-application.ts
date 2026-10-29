import type { Bypass, Ownership, RootTypes } from "@nxara/olio-schema";
import {
  isAbstractType,
  isEnumType,
  isObjectType,
  isScalarType,
  type GraphQLSchema
} from "graphql";

import { inputMember } from "./type-map.js";

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const moduleKey = (id: string): string =>
  IDENTIFIER.test(id) ? id : JSON.stringify(id);

const union = (names: readonly string[]): string =>
  names.length ? names.map((n) => `"${n}"`).join(" | ") : "never";

// Olio's `TypeShape` (packages/olio/src/types.ts) reads this; change both together.
function emitEntry(
  schema: GraphQLSchema,
  operations: ReadonlyMap<string, string>,
  bypass: Bypass,
  name: string,
  owned: ReadonlySet<string>
): string {
  const type = schema.getType(name);
  const fields = [...owned].sort();
  if (isEnumType(type)) {
    return `    ${name}: { type: ${name}; fields: never; enum: ${union(fields)} };`;
  }
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

  const bypassed = fields.flatMap((f) => {
    const keys = bypass.get(`${name}.${f}`);
    return keys ? [`        ${f}: ${union([...keys].sort())};`] : [];
  });

  const sections = [
    ...(args.length ? ["      args: {", ...args, "      };"] : []),
    ...(bypassed.length ? ["      bypass: {", ...bypassed, "      };"] : [])
  ];
  if (sections.length === 0) return `    ${name}: { ${members.join("; ")} };`;
  return [
    `    ${name}: {`,
    ...members.map((m) => `      ${m};`),
    ...sections,
    "    };"
  ].join("\n");
}

export function emitApplication(
  schema: GraphQLSchema,
  ownership: Ownership,
  roots: RootTypes,
  bypass: Bypass,
  directives: readonly string[]
): string {
  const operations = new Map(
    Object.entries(roots).map(([operation, name]) => [name, operation])
  );
  const modules = [...ownership]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, types]) => {
      const entries = [...types]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, owned]) =>
          emitEntry(schema, operations, bypass, name, owned)
        );
      return entries.length
        ? `  ${moduleKey(id)}: {\n${entries.join("\n")}\n  };`
        : `  ${moduleKey(id)}: {};`;
    });
  // "~" keeps it apart from owner ids; olio requires the same directives.
  const used = directives.length
    ? [`  "~directives": ${directives.map((d) => `"${d}"`).join(" | ")};`]
    : [];
  return `export type Application = {\n${[...used, ...modules].join("\n")}\n};`;
}
