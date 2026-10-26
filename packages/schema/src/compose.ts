import {
  buildASTSchema,
  concatAST,
  Kind,
  validateSchema,
  type DefinitionNode,
  type DocumentNode,
  type GraphQLError,
  type GraphQLSchema,
  type ObjectTypeDefinitionNode
} from "graphql";
// ponytail: not exported from graphql's index (a deep import), but the public
// buildASTSchema throws one string without locations. Swap if graphql ever
// exports it.
import { validateSDL } from "graphql/validation/validate.js";

import { applyDirectives, type SchemaDirective } from "./apply-directives.js";
import { extractBypass, type Bypass } from "./bypass.js";
import { located, position } from "./directives/shared.js";

/** Modules sharing an id are merged. */
export interface ModuleSDL {
  id: string;
  typeDefs: readonly DocumentNode[];
}

/** Module id -> type name -> the fields (or enum values) that module declares on it. */
export type Ownership = Map<string, Map<string, Set<string>>>;

export type Operation = "query" | "mutation" | "subscription";

export type RootTypes = Partial<Record<Operation, string>>;

/** Ownership marker for a scalar: its defining module implements it. */
export const SCALAR = "__scalar";

export interface Composed {
  document: DocumentNode;
  schema: GraphQLSchema;
  ownership: Ownership;
  roots: RootTypes;
  bypass: Bypass;
}

function rootTypes(document: DocumentNode): RootTypes {
  const declared: RootTypes = {};
  let hasSchema = false;
  for (const def of document.definitions) {
    if (
      def.kind !== Kind.SCHEMA_DEFINITION &&
      def.kind !== Kind.SCHEMA_EXTENSION
    ) {
      continue;
    }
    hasSchema = true;
    for (const { operation, type } of def.operationTypes ?? []) {
      declared[operation as Operation] = type.name.value;
    }
  }
  return hasSchema
    ? declared
    : { query: "Query", mutation: "Mutation", subscription: "Subscription" };
}

// Roots that modules only extend get defined here, so no module has to own a
// placeholder field.
function withRootTypes(document: DocumentNode, roots: RootTypes): DocumentNode {
  const defined = new Set<string>();
  const extended = new Set<string>();
  for (const def of document.definitions) {
    if (def.kind === Kind.OBJECT_TYPE_DEFINITION) defined.add(def.name.value);
    if (def.kind === Kind.OBJECT_TYPE_EXTENSION) extended.add(def.name.value);
  }
  const missing = Object.values(roots).filter(
    (t) => extended.has(t) && !defined.has(t)
  );
  return {
    ...document,
    definitions: [
      ...missing.map((name): ObjectTypeDefinitionNode => ({
        kind: Kind.OBJECT_TYPE_DEFINITION,
        name: { kind: Kind.NAME, value: name },
        fields: []
      })),
      ...document.definitions
    ]
  };
}

// Directive transforms spread the nodes they rewrite, so a definition keeps
// its `loc.source`; that still finds the module.
function moduleTracker(
  modules: readonly ModuleSDL[]
): (definition: DefinitionNode) => string {
  const origin = new Map<object, string>();
  for (const { id, typeDefs } of modules) {
    for (const doc of typeDefs) {
      for (const def of doc.definitions) {
        origin.set(def, id);
        if (def.loc) origin.set(def.loc.source, id);
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

// A module owns the fields it declares, in a definition or an `extend`; the
// defining module also owns the type hooks. Enum values work like fields, and
// a scalar belongs to the module that defines it.
function collectOwnership(
  document: DocumentNode,
  moduleOf: (definition: DefinitionNode) => string,
  ids: readonly string[],
  roots: RootTypes
): Ownership {
  const rootNames = new Set(Object.values(roots));
  const ownership: Ownership = new Map(ids.map((id) => [id, new Map()]));
  const own = (
    definition: DefinitionNode,
    type: string,
    names: readonly string[]
  ): void => {
    if (names.length === 0) return;
    const id = moduleOf(definition);
    const types = ownership.get(id) ?? new Map<string, Set<string>>();
    const fields = types.get(type) ?? new Set<string>();
    for (const name of names) fields.add(name);
    types.set(type, fields);
    ownership.set(id, types);
  };

  for (const def of document.definitions) {
    if (
      def.kind === Kind.OBJECT_TYPE_DEFINITION ||
      def.kind === Kind.OBJECT_TYPE_EXTENSION
    ) {
      const type = def.name.value;
      const fields = (def.fields ?? []).map((f) => f.name.value);
      const definesObject =
        def.kind === Kind.OBJECT_TYPE_DEFINITION && !rootNames.has(type);
      own(def, type, definesObject ? ["__isTypeOf", ...fields] : fields);
    } else if (
      def.kind === Kind.INTERFACE_TYPE_DEFINITION ||
      def.kind === Kind.UNION_TYPE_DEFINITION
    ) {
      own(def, def.name.value, ["__resolveType"]);
    } else if (def.kind === Kind.SCALAR_TYPE_DEFINITION) {
      own(def, def.name.value, [SCALAR]);
    } else if (
      def.kind === Kind.ENUM_TYPE_DEFINITION ||
      def.kind === Kind.ENUM_TYPE_EXTENSION
    ) {
      own(
        def,
        def.name.value,
        (def.values ?? []).map((v) => v.name.value)
      );
    }
  }
  return ownership;
}

function assertNoErrors(errors: readonly GraphQLError[], title: string): void {
  if (errors.length === 0) return;
  // A duplicate's error holds every place it's declared; the first alone
  // would point away from the module that added it.
  const lines = errors.map(({ nodes = [], message }) =>
    [
      `  ${located(nodes[0], message)}`,
      ...nodes.slice(1).map((node) => `    also at ${position(node)}`)
    ].join("\n")
  );
  throw new Error(`${title}:\n${lines.join("\n")}`);
}

/**
 * Codegen and olio both compose through here, so they agree on the schema and
 * on which module owns which field. Errors point at `file:line:column`.
 */
export function compose(
  modules: readonly ModuleSDL[],
  directives: readonly SchemaDirective[] = []
): Composed {
  const merged = new Map<string, DocumentNode[]>();
  for (const { id, typeDefs } of modules) {
    merged.set(id, [...(merged.get(id) ?? []), ...typeDefs]);
  }
  const grouped = [...merged].map(([id, typeDefs]) => ({ id, typeDefs }));

  // Before the other directives, so a bypass stays where it's written:
  // @copy doesn't carry it to the fields it copies.
  const { document: sdl, bypass } = extractBypass(
    concatAST(grouped.flatMap((m) => m.typeDefs))
  );
  const roots = rootTypes(sdl);
  const document = applyDirectives(withRootTypes(sdl, roots), directives);
  assertNoErrors(validateSDL(document), "Invalid SDL");
  const schema = buildASTSchema(document, { assumeValidSDL: true });
  assertNoErrors(validateSchema(schema), "Invalid schema");

  return {
    document,
    schema,
    ownership: collectOwnership(
      document,
      moduleTracker(grouped),
      grouped.map((m) => m.id),
      roots
    ),
    roots,
    bypass
  };
}
