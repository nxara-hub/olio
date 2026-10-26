import { compose, type Ownership } from "@nxlab/schema";
import {
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isScalarType,
  isUnionType,
  parse,
  Source,
  type DocumentNode,
  type GraphQLSchema
} from "graphql";

import { emitApplication } from "./emit-application.js";
import {
  emitEnum,
  emitInput,
  emitInterface,
  emitObject,
  emitUnion,
  region
} from "./emit-type.js";
import {
  BUILTIN_SCALARS,
  HEADER,
  RESERVED_NAMES,
  type CodegenModule,
  type GenerateOptions,
  type TypeSource
} from "./types.js";

const IMPORTS =
  'import type { ResolveEnum, ResolveScalar } from "@nxlab/codegen";';
const UTILS = "type Maybe<T> = T | null;";

function toDocument(typeDef: TypeSource, name: string): DocumentNode {
  return typeof typeDef === "string"
    ? parse(new Source(typeDef, name))
    : typeDef;
}

export interface Compiled {
  /** After directives. */
  document: DocumentNode;
  code: string;
  schema: GraphQLSchema;
}

/** Names a function already has: `query.sales` is one, so features can't use them. */
const FUNCTION_PROPS = new Set([
  "apply",
  "arguments",
  "bind",
  "call",
  "caller",
  "length",
  "name",
  "prototype",
  "toString"
]);

/**
 * Feature names sit next to type names in the builders
 * (`resolvers.sales.orders` / `resolvers.sales.Customer`), so they can't clash.
 */
function assertFeatureNames(ownership: Ownership): void {
  for (const id of ownership.keys()) {
    const [module = "", feature] = id.split("/");
    if (feature === undefined) continue;
    const clash = FUNCTION_PROPS.has(feature)
      ? "a reserved name"
      : ownership.get(module)?.has(feature)
        ? `type "${feature}" in module "${module}"`
        : undefined;
    if (clash) {
      throw new Error(
        `Feature folder "${id}" clashes with ${clash}; rename the folder`
      );
    }
  }
}

function assertSupported(schema: GraphQLSchema): void {
  for (const name of Object.keys(schema.getTypeMap())) {
    if (RESERVED_NAMES.has(name)) {
      throw new Error(
        `Type name "${name}" is reserved by the generated file; rename it`
      );
    }
  }
}

export function compile(
  modules: readonly CodegenModule[],
  options: GenerateOptions = {}
): Compiled {
  // Same-named modules merge, so a module can be passed in pieces.
  const { document, schema, ownership, roots, bypass } = compose(
    modules.map((m) => ({
      id: m.id,
      typeDefs: (Array.isArray(m.typeDefs) ? m.typeDefs : [m.typeDefs]).map(
        (d) => toDocument(d, m.id)
      )
    })),
    options.directives
  );
  assertSupported(schema);
  assertFeatureNames(ownership);

  const types = Object.values(schema.getTypeMap())
    .filter((t) => !t.name.startsWith("__") && !BUILTIN_SCALARS.has(t.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const scalars = Object.values(schema.getTypeMap())
    .filter(isScalarType)
    .map((t) => `  ${t.name}: ResolveScalar<"${t.name}">;`)
    .sort();
  const parts = [
    HEADER,
    IMPORTS,
    UTILS,
    `/** Every scalar's TypeScript types. Remap one through \`CustomScalars\`. */\nexport type Scalars = {\n${scalars.join("\n")}\n};`,
    region("Enums", types.filter(isEnumType).map(emitEnum)),
    region("Types", types.filter(isObjectType).map(emitObject)),
    region("Inputs", types.filter(isInputObjectType).map(emitInput)),
    region("Unions", types.filter(isUnionType).map(emitUnion)),
    region("Interfaces", types.filter(isInterfaceType).map(emitInterface)),
    emitApplication(schema, ownership, roots, bypass)
  ];
  return { document, code: `${parts.join("\n\n")}\n`, schema };
}

export function generate(
  modules: readonly CodegenModule[],
  options: GenerateOptions = {}
): string {
  return compile(modules, options).code;
}
