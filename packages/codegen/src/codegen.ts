import { withDirectives } from "@nxlab/directives";
import {
  buildASTSchema,
  concatAST,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isScalarType,
  isUnionType,
  parse,
  Source,
  type DefinitionNode,
  type DocumentNode,
  type GraphQLSchema
} from "graphql";

import { collectOwnership, emitApplication } from "./emit-application.js";
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

const IMPORTS = 'import type { ResolveScalar } from "@nxlab/codegen";';
const UTILS = "type Maybe<T> = T | null;";

function toDocument(typeDef: TypeSource, name: string): DocumentNode {
  return typeof typeDef === "string"
    ? parse(new Source(typeDef, name))
    : typeDef;
}

export interface Compiled {
  /** The merged document, after directives. */
  document: DocumentNode;
  /** The generated TypeScript. */
  code: string;
  schema: GraphQLSchema;
}

/**
 * Remember which module each definition came from. Directive transforms spread
 * the nodes they rewrite, so a definition keeps its `loc.source`.
 */
function moduleTracker(
  modules: readonly { name: string; docs: readonly DocumentNode[] }[]
): (definition: DefinitionNode) => string {
  const origin = new Map<object, string>();
  for (const { name, docs } of modules) {
    for (const doc of docs) {
      for (const def of doc.definitions) {
        origin.set(def, name);
        if (def.loc) origin.set(def.loc.source, name);
      }
    }
  }
  return (definition) => {
    const id =
      origin.get(definition) ??
      (definition.loc ? origin.get(definition.loc.source) : undefined);
    if (id === undefined) {
      const name = "name" in definition ? definition.name?.value : undefined;
      throw new Error(
        `Cannot tell which module declares "${name ?? definition.kind}"`
      );
    }
    return id;
  };
}

function assertSupported(schema: GraphQLSchema): void {
  const roots = {
    Query: schema.getQueryType(),
    Mutation: schema.getMutationType(),
    Subscription: schema.getSubscriptionType()
  };
  for (const [expected, type] of Object.entries(roots)) {
    if (type && type.name !== expected) {
      throw new Error(
        `Root type "${type.name}" must be named "${expected}" (custom root type names are not supported)`
      );
    }
  }
  for (const name of Object.keys(schema.getTypeMap())) {
    if (RESERVED_NAMES.has(name)) {
      throw new Error(
        `Type name "${name}" is reserved by the generated file; rename it`
      );
    }
  }
}

/** Merge modules, apply directives once, and generate TypeScript. */
export function compile(
  modules: readonly CodegenModule[],
  options: GenerateOptions = {}
): Compiled {
  // Same-named modules merge, so a module can be passed in pieces.
  const byModule = new Map<string, DocumentNode[]>();
  for (const m of modules) {
    const docs = (Array.isArray(m.typeDefs) ? m.typeDefs : [m.typeDefs]).map(
      (d) => toDocument(d, m.name)
    );
    byModule.set(m.name, [...(byModule.get(m.name) ?? []), ...docs]);
  }
  const grouped = [...byModule].map(([name, docs]) => ({ name, docs }));

  const merged = concatAST(grouped.flatMap((m) => m.docs));
  const directives = options.withDirectives ?? [];
  const document =
    directives.length > 0 ? withDirectives(merged, directives) : merged;
  const schema = buildASTSchema(document);
  assertSupported(schema);

  const types = Object.values(schema.getTypeMap())
    .filter((t) => !t.name.startsWith("__") && !BUILTIN_SCALARS.has(t.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const ownership = collectOwnership(
    document,
    moduleTracker(grouped),
    grouped.map((m) => m.name)
  );

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
    emitApplication(schema, ownership)
  ];
  return { document, code: `${parts.join("\n\n")}\n`, schema };
}

/** Generate the TypeScript for a set of modules. */
export function generate(
  modules: readonly CodegenModule[],
  options: GenerateOptions = {}
): string {
  return compile(modules, options).code;
}
