import {
  isAbstractType,
  isEnumType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  Kind,
  print,
  typeFromAST,
  validate,
  visit,
  type DefinitionNode,
  type DirectiveNode,
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type GraphQLCompositeType,
  type GraphQLEnumType,
  type GraphQLError,
  type GraphQLInputObjectType,
  type GraphQLInputType,
  type GraphQLObjectType,
  type GraphQLOutputType,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type SelectionSetNode
} from "graphql";

import { BUILTIN_SCALARS, HEADER } from "./types.js";

type TransportKind = "ws" | "sse";

interface Context {
  schema: GraphQLSchema;
  /** Each subscription's transport, from `@ws` (the default) or `@sse`. */
  transports: ReadonlyMap<OperationDefinitionNode, TransportKind>;
  fragments: ReadonlyMap<string, FragmentDefinitionNode>;
  enums: Set<GraphQLEnumType>;
  inputs: Set<GraphQLInputObjectType>;
}

interface Selected {
  set: SelectionSetNode;
  /** Under @include or @skip, so it may be missing. */
  optional: boolean;
}

interface CollectedField {
  node: FieldNode;
  optional: boolean;
}

const location = (error: GraphQLError): string => {
  const at = error.locations?.[0];
  const file = error.source?.name;
  return at ? `${file ? `${file}:` : ""}${at.line}:${at.column}: ` : "";
};

const at = (node: {
  loc?: {
    source: { name: string };
    startToken: { line: number; column: number };
  };
}): string => {
  const token = node.loc?.startToken;
  return token
    ? `${node.loc?.source.name}:${token.line}:${token.column}: `
    : "";
};

// `@ws` and `@sse` choose a subscription's transport. They're for the client
// only: read here and removed, so neither validation nor the server sees them.
function takeTransports(definitions: readonly DefinitionNode[]): {
  definitions: DefinitionNode[];
  transports: Map<OperationDefinitionNode, TransportKind>;
} {
  const transports = new Map<OperationDefinitionNode, TransportKind>();
  const stripped = definitions.map((definition) => {
    if (definition.kind !== Kind.OPERATION_DEFINITION) return definition;
    const chosen = (definition.directives ?? []).filter(
      (d) => d.name.value === "ws" || d.name.value === "sse"
    );
    for (const directive of chosen) {
      if (definition.operation !== "subscription") {
        throw new Error(
          `${at(directive)}@${directive.name.value} only applies to subscriptions: queries and mutations go over HTTP`
        );
      }
      if (directive.arguments?.length) {
        throw new Error(
          `${at(directive)}@${directive.name.value} takes no arguments`
        );
      }
    }
    if (chosen.length > 1) {
      throw new Error(
        `${at(chosen[1] as DirectiveNode)}A subscription takes one of @ws or @sse`
      );
    }
    const operation: OperationDefinitionNode = {
      ...definition,
      directives: definition.directives?.filter((d) => !chosen.includes(d))
    };
    if (operation.operation === "subscription") {
      transports.set(
        operation,
        (chosen[0]?.name.value ?? "ws") as TransportKind
      );
    }
    return operation;
  });
  return { definitions: stripped, transports };
}

const conditional = (directives: readonly DirectiveNode[] = []): boolean =>
  directives.some((d) => d.name.value === "include" || d.name.value === "skip");

const lowerFirst = (word: string): string =>
  `${word[0]?.toLowerCase() ?? ""}${word.slice(1)}`;

const capitalize = (word: string): string =>
  `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;

function applies(
  schema: GraphQLSchema,
  condition: string | undefined,
  type: GraphQLObjectType
): boolean {
  if (condition === undefined || condition === type.name) return true;
  const target = schema.getType(condition);
  return isAbstractType(target) && schema.isSubType(target, type);
}

// Fields one concrete type receives from a selection: its own, and those of
// every fragment whose type condition it matches, keyed by response name.
function collect(
  ctx: Context,
  type: GraphQLObjectType,
  { set, optional }: Selected,
  fields: Map<string, CollectedField[]>
): void {
  for (const selection of set.selections) {
    const maybe = optional || conditional(selection.directives);
    if (selection.kind === Kind.FIELD) {
      const key = selection.alias?.value ?? selection.name.value;
      fields.set(key, [
        ...(fields.get(key) ?? []),
        { node: selection, optional: maybe }
      ]);
      continue;
    }
    const fragment =
      selection.kind === Kind.INLINE_FRAGMENT
        ? selection
        : ctx.fragments.get(selection.name.value);
    if (
      fragment &&
      applies(ctx.schema, fragment.typeCondition?.name.value, type)
    ) {
      collect(
        ctx,
        type,
        { set: fragment.selectionSet, optional: maybe },
        fields
      );
    }
  }
}

function objectShape(
  ctx: Context,
  type: GraphQLObjectType,
  sets: readonly Selected[],
  indent: string
): string {
  const fields = new Map<string, CollectedField[]>();
  for (const set of sets) collect(ctx, type, set, fields);
  const lines: string[] = [];
  for (const [key, nodes] of fields) {
    const name = nodes[0]?.node.name.value ?? key;
    const optional = nodes.every((n) => n.optional) ? "?" : "";
    if (name === "__typename") {
      lines.push(`${key}${optional}: "${type.name}";`);
      continue;
    }
    const field = type.getFields()[name];
    if (!field) continue;
    const children = nodes.flatMap((n) =>
      n.node.selectionSet ? [{ set: n.node.selectionSet, optional: false }] : []
    );
    lines.push(
      `${key}${optional}: ${outputType(ctx, field.type, children, `${indent}  `)};`
    );
  }
  return lines.length
    ? `{\n${lines.map((l) => `${indent}  ${l}`).join("\n")}\n${indent}}`
    : "{}";
}

// An abstract type is the union of what each possible type receives, so the
// result narrows on `__typename` the way the response does.
function compositeType(
  ctx: Context,
  type: GraphQLCompositeType,
  sets: readonly Selected[],
  indent: string
): string {
  const members = isObjectType(type)
    ? [type]
    : [...ctx.schema.getPossibleTypes(type)].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
  const shapes = [
    ...new Set(members.map((m) => objectShape(ctx, m, sets, indent)))
  ];
  return shapes.length > 1 ? `(${shapes.join(" | ")})` : (shapes[0] ?? "never");
}

function outputType(
  ctx: Context,
  type: GraphQLOutputType,
  sets: readonly Selected[],
  indent: string,
  nullable = true
): string {
  if (isNonNullType(type)) {
    return outputType(ctx, type.ofType, sets, indent, false);
  }
  let base: string;
  if (isListType(type)) {
    base = `${outputType(ctx, type.ofType, sets, indent)}[]`;
  } else if (isScalarType(type)) {
    base = `Scalar<"${type.name}">`;
  } else if (isEnumType(type)) {
    ctx.enums.add(type);
    base = type.name;
  } else {
    base = compositeType(ctx, type, sets, indent);
  }
  return nullable ? `Maybe<${base}>` : base;
}

function inputType(
  ctx: Context,
  type: GraphQLInputType,
  nullable = true
): string {
  if (isNonNullType(type)) return inputType(ctx, type.ofType, false);
  let base: string;
  if (isListType(type)) {
    base = `${inputType(ctx, type.ofType)}[]`;
  } else if (isScalarType(type)) {
    base = `Scalar<"${type.name}", "input">`;
  } else {
    if (isEnumType(type)) ctx.enums.add(type);
    else ctx.inputs.add(type);
    base = type.name;
  }
  return nullable ? `Maybe<${base}>` : base;
}

function usedFragments(
  ctx: Context,
  node: OperationDefinitionNode | FragmentDefinitionNode,
  seen = new Set<string>()
): Set<string> {
  visit(node, {
    FragmentSpread(spread) {
      const name = spread.name.value;
      const fragment = ctx.fragments.get(name);
      if (seen.has(name) || !fragment) return;
      seen.add(name);
      usedFragments(ctx, fragment, seen);
    }
  });
  return seen;
}

// graphql-codegen's naming: `Login` → `LoginMutation`, kept as is when the
// name already ends that way.
function typeName(operation: OperationDefinitionNode): string {
  const name = operation.name?.value ?? "";
  const suffix = capitalize(operation.operation);
  return name.endsWith(suffix) ? name : `${name}${suffix}`;
}

function emitOperation(
  ctx: Context,
  operation: OperationDefinitionNode
): string {
  const name = operation.name?.value;
  if (!name) {
    throw new Error(
      `${at(operation)}An operation needs a name: its types are named after it`
    );
  }
  const base = typeName(operation);
  const transport = ctx.transports.get(operation);
  const root = ctx.schema.getRootType(operation.operation) as GraphQLObjectType;
  const result = objectShape(
    ctx,
    root,
    [{ set: operation.selectionSet, optional: false }],
    ""
  );
  const variables = (operation.variableDefinitions ?? []).map((v) => {
    const type = typeFromAST(ctx.schema, v.type) as GraphQLInputType;
    const optional = !isNonNullType(type) || v.defaultValue !== undefined;
    return `  ${v.variable.name.value}${optional ? "?" : ""}: ${inputType(ctx, type)};`;
  });
  const fragments = [...usedFragments(ctx, operation)]
    .sort()
    .map((f) => print(ctx.fragments.get(f) as FragmentDefinitionNode));
  const query = [print(operation), ...fragments].join("\n\n");
  return [
    `export type ${base} = ${result};`,
    `export type ${base}Variables = ${variables.length ? `{\n${variables.join("\n")}\n}` : "{}"};`,
    `export const ${name}Document: TypedDocument<${base}, ${base}Variables, "${operation.operation}"> = {\n  operation: "${operation.operation}",\n  name: "${name}",\n  query: ${JSON.stringify(query)}${transport ? `,\n  transport: "${transport}"` : ""}\n};`
  ].join("\n\n");
}

function emitInputs(ctx: Context): string[] {
  const emitted = new Map<string, string>();
  // An input can refer to more inputs, so this loops until none are new.
  for (let pending = [...ctx.inputs]; pending.length;) {
    for (const type of pending) {
      const fields = Object.values(type.getFields()).map((f) => {
        const optional = !isNonNullType(f.type) || f.defaultValue !== undefined;
        return `  ${f.name}${optional ? "?" : ""}: ${inputType(ctx, f.type)};`;
      });
      emitted.set(
        type.name,
        `export type ${type.name} = {\n${fields.join("\n")}\n};`
      );
    }
    pending = [...ctx.inputs].filter((t) => !emitted.has(t.name));
  }
  return [...emitted]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, code]) => code);
}

/**
 * Per operation in `documents`, validated against `schema`: a result type, a
 * variables type and a typed document for `@nxlab/client`. Types are what a
 * client sees on the wire: enums by name, scalars through `ClientScalars`.
 */
export function emitClient(
  schema: GraphQLSchema,
  documents: readonly DocumentNode[]
): string {
  const { definitions, transports } = takeTransports(
    documents.flatMap((d) => d.definitions)
  );
  const document: DocumentNode = { kind: Kind.DOCUMENT, definitions };
  const errors = validate(schema, document);
  if (errors.length) {
    throw new Error(
      `Invalid operations:\n${errors.map((e) => `  ${location(e)}${e.message}`).join("\n")}`
    );
  }
  const fragments = new Map<string, FragmentDefinitionNode>();
  const operations: OperationDefinitionNode[] = [];
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    } else if (definition.kind === Kind.OPERATION_DEFINITION) {
      operations.push(definition);
    }
  }
  const ctx: Context = {
    schema,
    transports,
    fragments,
    enums: new Set(),
    inputs: new Set()
  };
  const typeNames = new Map<string, string>();
  const calls = new Map<string, string>();
  for (const operation of operations) {
    const name = operation.name?.value;
    if (!name) continue;
    const type = typeName(operation);
    const other = typeNames.get(type);
    if (other) {
      throw new Error(
        `Operations "${other}" and "${name}" both name their result type ${type}; rename one`
      );
    }
    typeNames.set(type, name);
    const call = `${operation.operation}.${lowerFirst(name)}`;
    const clash = calls.get(call);
    if (clash) {
      throw new Error(
        `Operations "${clash}" and "${name}" are both client.${call}; rename one`
      );
    }
    calls.set(call, name);
  }
  const emitted = operations.map((o) => emitOperation(ctx, o));
  const byRoot = new Map<string, string[]>();
  for (const operation of operations) {
    const name = operation.name?.value ?? "";
    const calls = byRoot.get(operation.operation) ?? [];
    calls.push(`    ${lowerFirst(name)}: ${name}Document`);
    byRoot.set(operation.operation, calls);
  }
  // The clients `createClient` then requires, one per transport used.
  const used = [...new Set(transports.values())].sort();
  const map = [
    ...[...byRoot].map(
      ([root, calls]) => `  ${root}: {\n${calls.join(",\n")}\n  }`
    ),
    ...(used.length
      ? [`  transports: [${used.map((kind) => `"${kind}"`).join(", ")}]`]
      : [])
  ].join(",\n");
  const inputs = emitInputs(ctx);
  const enums = [...ctx.enums]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (e) =>
        `export type ${e.name} = ${e
          .getValues()
          .map((v) => `"${v.name}"`)
          .join(" | ")};`
    );
  const custom = Object.values(schema.getTypeMap())
    .filter((t) => isScalarType(t) && !t.name.startsWith("__"))
    .map((t) => t.name)
    .filter((name) => !BUILTIN_SCALARS.has(name));
  return `${[
    HEADER,
    'import type { Scalar, TypedDocument } from "@nxlab/client";',
    "type Maybe<T> = T | null;",
    custom.length
      ? [
          `// Custom scalars (${custom.join(", ")}) are \`unknown\` unless registered in ClientScalars`,
          "// (in a .ts file, or a .d.ts with an import or `export {}`):",
          `// declare module "@nxlab/client" { interface ClientScalars { ${custom[0]}: string } }`
        ].join("\n")
      : "",
    ...enums,
    ...inputs,
    ...emitted,
    `/** For createClient(operations, { url }): \`client.mutation.login(variables)\`. */\nexport const operations = {\n${map}\n} as const;`
  ]
    .filter(Boolean)
    .join("\n\n")}\n`;
}
