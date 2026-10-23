import {
  getLocation,
  Kind,
  print,
  type ASTNode,
  type DefinitionNode,
  type DirectiveNode,
  type DocumentNode,
  type FieldDefinitionNode,
  type InputValueDefinitionNode,
  type NamedTypeNode
} from "graphql";

import type { SchemaDirective } from "../apply-directives.js";

type Field = FieldDefinitionNode | InputValueDefinitionNode;
type TargetKind = "object" | "input";

const KINDS: Partial<Record<Kind, string>> = {
  [Kind.OBJECT_TYPE_DEFINITION]: "object",
  [Kind.OBJECT_TYPE_EXTENSION]: "object",
  [Kind.INTERFACE_TYPE_DEFINITION]: "interface",
  [Kind.INTERFACE_TYPE_EXTENSION]: "interface",
  [Kind.INPUT_OBJECT_TYPE_DEFINITION]: "input",
  [Kind.INPUT_OBJECT_TYPE_EXTENSION]: "input",
  [Kind.UNION_TYPE_DEFINITION]: "union",
  [Kind.UNION_TYPE_EXTENSION]: "union",
  [Kind.ENUM_TYPE_DEFINITION]: "enum",
  [Kind.ENUM_TYPE_EXTENSION]: "enum",
  [Kind.SCALAR_TYPE_DEFINITION]: "scalar",
  [Kind.SCALAR_TYPE_EXTENSION]: "scalar"
};

const article = (kind: string): string =>
  /^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`;

export function located(node: ASTNode | undefined, message: string): string {
  if (!node?.loc) return message;
  const { line, column } = getLocation(node.loc.source, node.loc.start);
  const file = node.loc.source.name;
  return `${file === "GraphQL request" ? "" : `${file}:`}${line}:${column}: ${message}`;
}

export function fail(node: ASTNode, message: string): never {
  throw new Error(located(node, message));
}

interface TypeNode {
  kind: Kind;
  name: { value: string };
  directives?: readonly DirectiveNode[];
  fields?: readonly Field[];
  interfaces?: readonly NamedTypeNode[];
}

const asType = (def: DefinitionNode): TypeNode | undefined =>
  KINDS[def.kind] ? (def as unknown as TypeNode) : undefined;

export function directiveUsages(
  document: DocumentNode,
  names: ReadonlySet<string>
): Set<string> {
  const types = new Set<string>();
  for (const def of document.definitions) {
    const type = asType(def);
    if (type?.directives?.some((d) => names.has(d.name.value))) {
      types.add(type.name.value);
    }
  }
  return types;
}

interface Analysis {
  kinds: Map<string, string>;
  fields: Map<string, Field[]>;
  interfaces: Map<string, Set<string>>;
}

function analyze(document: DocumentNode): Analysis {
  const analysis: Analysis = {
    kinds: new Map(),
    fields: new Map(),
    interfaces: new Map()
  };
  for (const def of document.definitions) {
    const type = asType(def);
    const kind = KINDS[def.kind];
    if (!type || !kind) continue;
    const name = type.name.value;
    analysis.kinds.set(name, kind);
    analysis.fields.set(name, [
      ...(analysis.fields.get(name) ?? []),
      ...(type.fields ?? [])
    ]);
    const interfaces = analysis.interfaces.get(name) ?? new Set();
    for (const i of type.interfaces ?? []) interfaces.add(i.name.value);
    analysis.interfaces.set(name, interfaces);
  }
  return analysis;
}

function sourceNames(directive: DirectiveNode, name: string): string[] {
  const arg = directive.arguments?.find((a) => a.name.value === "from");
  if (!arg) {
    fail(
      directive,
      `@${name} needs a "from" argument, e.g. @${name}(from: ["Node"])`
    );
  }
  const values = arg.value.kind === Kind.LIST ? arg.value.values : [arg.value];
  return values.map((value) =>
    value.kind === Kind.STRING
      ? value.value
      : fail(
          value,
          `@${name} "from" takes type names as strings, e.g. @${name}(from: ["Node"])`
        )
  );
}

const shape = (field: Field): string =>
  print({ ...field, description: undefined });

interface Merge {
  directive: DirectiveNode;
  target: string;
  sources: readonly (readonly [string, readonly Field[]])[];
  local: readonly Field[];
  declaredElsewhere: ReadonlySet<string>;
  overrides: boolean;
}

// Like `{ ...A, ...B, ...local }`: a field keeps the position where it first
// appeared. Without `overrides`, a redeclaration must have the same shape.
function mergeFields(merge: Merge): Field[] {
  const merged = new Map<string, readonly [string, Field]>();
  const entries = [
    ...merge.sources.flatMap(([from, fields]) =>
      fields.map((f) => [from, f] as const)
    ),
    ...merge.local.map((f) => [merge.target, f] as const)
  ];
  for (const [from, field] of entries) {
    const name = field.name.value;
    if (merge.declaredElsewhere.has(name)) continue;
    const previous = merged.get(name);
    if (previous && !merge.overrides && shape(previous[1]) !== shape(field)) {
      fail(
        merge.directive,
        `@${merge.directive.name.value} on "${merge.target}": "${from}" redeclares field "${name}" from "${previous[0]}" (${shape(previous[1])} vs ${shape(field)}). Remove one, or use @copy to override.`
      );
    }
    merged.set(name, [from, field]);
  }
  return [...merged.values()].map(([, field]) => field);
}

export interface FieldCopySpec {
  name: string;
  definition: string;
  sourceKinds: Partial<Record<TargetKind, readonly string[]>>;
  addInterfaces?: boolean;
  overrides: boolean;
}

export function fieldCopyDirective(spec: FieldCopySpec): SchemaDirective {
  const { name } = spec;
  const targets = Object.keys(spec.sourceKinds).map((k) => `${k} types`);

  const usage = (type: TypeNode): DirectiveNode | undefined =>
    type.directives?.find((d) => d.name.value === name);

  const resolve = (
    type: TypeNode,
    directive: DirectiveNode,
    analysis: Analysis
  ): string[] => {
    const kind = KINDS[type.kind] ?? "";
    const allowed = spec.sourceKinds[kind as TargetKind];
    const target = type.name.value;
    if (!allowed) {
      fail(
        directive,
        `@${name} can only be used on ${targets.join(" and ")}, but "${target}" is ${article(kind)}`
      );
    }
    return sourceNames(directive, name).map((source) => {
      const sourceKind = analysis.kinds.get(source);
      if (!sourceKind) {
        fail(
          directive,
          `@${name} on "${target}" references unknown type "${source}"`
        );
      }
      if (!allowed.includes(sourceKind)) {
        fail(
          directive,
          `@${name} on "${target}" can copy from ${allowed.map((k) => `${k} types`).join(" and ")}, but "${source}" is ${article(sourceKind)}`
        );
      }
      return source;
    });
  };

  return {
    name,
    definition: spec.definition,

    validate(document) {
      const analysis = analyze(document);
      for (const def of document.definitions) {
        const type = asType(def);
        const directive = type && usage(type);
        if (type && directive) resolve(type, directive, analysis);
      }
    },

    transform(document, context) {
      const analysis = analyze(document);
      const definitions = document.definitions.map((def) => {
        const type = asType(def);
        const directive = type && usage(type);
        if (!type || !directive) return def;
        const sources = resolve(type, directive, analysis);
        if (sources.some((s) => context.isPending(s))) return def;

        const target = type.name.value;
        const local = type.fields ?? [];
        const elsewhere = new Set(
          (analysis.fields.get(target) ?? [])
            .filter((f) => !local.includes(f))
            .map((f) => f.name.value)
        );
        const next: TypeNode = {
          ...type,
          fields: mergeFields({
            directive,
            target,
            sources: sources.map((s) => [s, analysis.fields.get(s) ?? []]),
            local,
            declaredElsewhere: elsewhere,
            overrides: spec.overrides
          }),
          directives: type.directives?.filter((d) => d !== directive)
        };
        if (spec.addInterfaces) {
          const declared = analysis.interfaces.get(target) ?? new Set();
          const added = sources
            .filter((s) => !declared.has(s))
            .map((s): NamedTypeNode => ({
              kind: Kind.NAMED_TYPE,
              name: { kind: Kind.NAME, value: s }
            }));
          next.interfaces = [...(type.interfaces ?? []), ...added];
        }
        return next as unknown as DefinitionNode;
      });
      return { ...document, definitions };
    }
  };
}
