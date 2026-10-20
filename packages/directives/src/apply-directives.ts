import { Kind, type DocumentNode } from "graphql";

import { directiveUsages } from "./directives/shared.js";

export interface DirectiveContext {
  /**
   * True while a type still carries a schema directive. A directive copying
   * from that type should leave its target for a later pass.
   */
  isPending(typeName: string): boolean;
}

/**
 * A schema-design directive: validates its usages, then consumes them. The
 * output is plain GraphQL without the directive.
 */
export interface SchemaDirective {
  name: string;
  /** The directive's SDL definition, e.g. for editor tooling. */
  definition: string;
  /** Throw if any usage is invalid. Runs before any transform. */
  validate?(document: DocumentNode): void;
  transform(document: DocumentNode, context: DirectiveContext): DocumentNode;
}

/**
 * Apply schema-design directives. Every directive validates first, then
 * transforms run in passes until no usage is left, so a type can copy from a
 * type that uses directives itself, whatever order the directives are in.
 * Their definitions, if the SDL declares them, are removed from the output.
 */
export function applyDirectives(
  document: DocumentNode,
  directives: readonly SchemaDirective[]
): DocumentNode {
  if (directives.length === 0) return document;
  const names = new Set(directives.map((d) => d.name));

  for (const directive of directives) directive.validate?.(document);

  let current = document;
  let pending = directiveUsages(current, names);
  while (pending.size > 0) {
    for (const directive of directives) {
      const types = directiveUsages(current, names);
      current = directive.transform(current, {
        isPending: (type) => types.has(type)
      });
    }
    const left = directiveUsages(current, names);
    if (left.size === pending.size) {
      throw new Error(
        `Schema directives reference each other in a cycle: ${[...left].map((t) => `"${t}"`).join(", ")}`
      );
    }
    pending = left;
  }

  return {
    ...current,
    definitions: current.definitions.filter(
      (def) =>
        def.kind !== Kind.DIRECTIVE_DEFINITION || !names.has(def.name.value)
    )
  };
}
