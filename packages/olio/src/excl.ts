import {
  GraphQLError,
  Kind,
  type GraphQLSchema,
  type SelectionSetNode,
  type ValidationContext,
  type ValidationRule
} from "graphql";

// On the schema rather than in the SDL (compose strips the directive), so
// the rule works on any server the schema is served by.
export function markExcl(
  schema: GraphQLSchema,
  excl: ReadonlySet<string>
): void {
  for (const key of excl) {
    const [typeName = "", fieldName = ""] = key.split(".");
    const type = schema.getType(typeName);
    const field =
      type && "getFields" in type ? type.getFields()[fieldName] : undefined;
    if (field) {
      (field as { extensions: Record<string, unknown> }).extensions = {
        ...field.extensions,
        excl: true
      };
    }
  }
}

/**
 * Rejects an operation that runs an `@excl` field next to any other field,
 * aliases and fragments included (`__typename` doesn't count). Not applied
 * by default: pass it with your other validation rules.
 */
export const exclRule: ValidationRule = (context) => ({
  OperationDefinition(operation) {
    const root = context.getSchema().getRootType(operation.operation);
    const fields = rootFields(context, operation.selectionSet, new Set());
    // graphql runs fields that share a response key once, so `{ logout logout }`
    // runs one field and `{ a: logout b: logout }` runs two.
    if (!root || new Set(fields.map((f) => f.key)).size < 2) return;
    for (const name of new Set(fields.map((f) => f.name))) {
      if (root.getFields()[name]?.extensions.excl === true) {
        context.reportError(
          new GraphQLError(
            `"${name}" must be the only field in its ${operation.operation} (@excl)`,
            { nodes: operation }
          )
        );
      }
    }
  }
});

interface RootField {
  key: string;
  name: string;
}

function rootFields(
  context: ValidationContext,
  set: SelectionSetNode,
  spread: Set<string>
): RootField[] {
  return set.selections.flatMap((s): RootField[] => {
    if (s.kind === Kind.FIELD) {
      const name = s.name.value;
      return name === "__typename"
        ? []
        : [{ key: s.alias?.value ?? name, name }];
    }
    if (s.kind === Kind.INLINE_FRAGMENT) {
      return rootFields(context, s.selectionSet, spread);
    }
    // graphql reports a fragment that spreads itself, but runs this rule
    // anyway, so each fragment is walked once.
    if (spread.has(s.name.value)) return [];
    spread.add(s.name.value);
    const fragment = context.getFragment(s.name.value);
    return fragment ? rootFields(context, fragment.selectionSet, spread) : [];
  });
}
