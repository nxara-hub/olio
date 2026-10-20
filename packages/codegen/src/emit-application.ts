import {
  isAbstractType,
  isObjectType,
  Kind,
  type DefinitionNode,
  type DocumentNode,
  type GraphQLSchema
} from "graphql";

import { inputMember } from "./type-map.js";
import { ROOT_TYPES } from "./types.js";

/** Module id -> type name -> what that module declares on it. */
export type Ownership = Map<string, Map<string, Set<string>>>;

/**
 * A module owns the fields it declares, whether in a definition or an
 * `extend`. The defining module also owns `__isTypeOf` (objects) or
 * `__resolveType` (interfaces and unions).
 */
export function collectOwnership(
  document: DocumentNode,
  moduleOf: (definition: DefinitionNode) => string,
  moduleIds: readonly string[]
): Ownership {
  const ownership: Ownership = new Map(moduleIds.map((id) => [id, new Map()]));
  const own = (
    definition: DefinitionNode,
    type: string,
    names: readonly string[]
  ): void => {
    if (names.length === 0) return;
    const types = ownership.get(moduleOf(definition)) ?? new Map();
    const fields = types.get(type) ?? new Set<string>();
    for (const name of names) fields.add(name);
    types.set(type, fields);
  };

  for (const def of document.definitions) {
    if (
      def.kind === Kind.OBJECT_TYPE_DEFINITION ||
      def.kind === Kind.OBJECT_TYPE_EXTENSION
    ) {
      const type = def.name.value;
      const fields = (def.fields ?? []).map((f) => f.name.value);
      const definesObject =
        def.kind === Kind.OBJECT_TYPE_DEFINITION && !ROOT_TYPES.has(type);
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
  name: string,
  owned: ReadonlySet<string>
): string {
  const type = schema.getType(name);
  const fields = [...owned].sort();
  const members = [`type: ${name}`, `fields: ${union(fields)}`];
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
  ownership: Ownership
): string {
  const modules = [...ownership]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, types]) => {
      const entries = [...types]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, owned]) => emitEntry(schema, name, owned));
      return entries.length
        ? `  ${moduleKey(id)}: {\n${entries.join("\n")}\n  };`
        : `  ${moduleKey(id)}: {};`;
    });
  return `export type Application = {\n${modules.join("\n")}\n};`;
}
