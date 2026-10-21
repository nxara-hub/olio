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
// ponytail: internal since graphql v15, but the public buildASTSchema throws
// one string without locations. Swap if graphql ever exports it.
import { validateSDL } from "graphql/validation/validate.js";

import { applyDirectives, type SchemaDirective } from "./apply-directives.js";
import { located } from "./directives/shared.js";

/** One module's SDL. Modules sharing an id are merged. */
export interface ModuleSDL {
  id: string;
  typeDefs: readonly DocumentNode[];
}

/** Module id -> type name -> the fields that module declares on it. */
export type Ownership = Map<string, Map<string, Set<string>>>;

export type Operation = "query" | "mutation" | "subscription";

/** Root type name per operation, e.g. `{ query: "Query" }`. */
export type RootTypes = Partial<Record<Operation, string>>;

export interface Composed {
  document: DocumentNode;
  schema: GraphQLSchema;
  ownership: Ownership;
  roots: RootTypes;
}

/**
 * The root types: from `schema { … }` and `extend schema { … }` when the SDL
 * has them, else GraphQL's default names.
 */
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

/**
 * Add the root types modules only extend (`type Query`, or your names), so no
 * module has to own a placeholder field.
 */
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

/**
 * Remember which module each definition came from. Directive transforms spread
 * the nodes they rewrite, so a definition keeps its `loc.source`.
 */
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

/**
 * A module owns the fields it declares, whether in a definition or an
 * `extend`. The defining module also owns `__isTypeOf` (objects) or
 * `__resolveType` (interfaces and unions).
 */
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
    }
  }
  return ownership;
}

function assertNoErrors(errors: readonly GraphQLError[], title: string): void {
  if (errors.length === 0) return;
  const lines = errors.map((e) => `  ${located(e.nodes?.[0], e.message)}`);
  throw new Error(`${title}:\n${lines.join("\n")}`);
}

/**
 * Compose module SDL into one validated schema: concatenate, add root types
 * that are only extended, apply directives, then validate. Errors point at
 * `file:line:column`. Codegen and olio both compose through here, so they
 * agree on the schema and on which module owns which field.
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

  const sdl = concatAST(grouped.flatMap((m) => m.typeDefs));
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
    roots
  };
}
