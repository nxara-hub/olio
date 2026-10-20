import type {
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInterfaceType,
  GraphQLObjectType,
  GraphQLUnionType
} from "graphql";

import { inputMember, typeToTS } from "./type-map.js";

/** Wrap declarations in a generated region (empty regions collapse cleanly). */
export function region(name: string, declarations: readonly string[]): string {
  const body = declarations.length
    ? `\n\n${declarations.join("\n\n")}\n\n`
    : "\n\n";
  return `/* #region ${name} */${body}/* #endregion ${name} */`;
}

export function emitEnum(type: GraphQLEnumType): string {
  const values = type
    .getValues()
    .map((v) => `  ${v.name}: "${v.name}"`)
    .join(",\n");
  return (
    `export const ${type.name} = {\n${values}\n} as const;\n` +
    `export type ${type.name} = (typeof ${type.name})[keyof typeof ${type.name}];`
  );
}

/** Interface fields are redeclared on every implementer, so no intersection is needed. */
export function emitObject(type: GraphQLObjectType): string {
  const lines = [
    `  __typename?: "${type.name}";`,
    ...Object.values(type.getFields()).map(
      (f) => `  ${f.name}: ${typeToTS(f.type, "output")};`
    )
  ];
  return `export type ${type.name} = {\n${lines.join("\n")}\n};`;
}

export function emitInterface(type: GraphQLInterfaceType): string {
  const lines = Object.values(type.getFields()).map(
    (f) => `  ${f.name}: ${typeToTS(f.type, "output")};`
  );
  return `export type ${type.name} = {\n${lines.join("\n")}\n};`;
}

export function emitInput(type: GraphQLInputObjectType): string {
  const lines = Object.values(type.getFields()).map(
    (f) => `  ${inputMember(f)};`
  );
  return `export type ${type.name} = {\n${lines.join("\n")}\n};`;
}

export function emitUnion(type: GraphQLUnionType): string {
  const members = type
    .getTypes()
    .map((t) => t.name)
    .join(" | ");
  return `export type ${type.name} = ${members};`;
}
