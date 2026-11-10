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
 * Rejects an operation that selects an `@excl` field next to any other
 * field, aliases and fragments included (`__typename` doesn't count). Not
 * applied by default: pass it with your other validation rules.
 */
export const exclRule: ValidationRule = (context) => ({
  OperationDefinition(operation) {
    const root = context.getSchema().getRootType(operation.operation);
    const names = rootFields(context, operation.selectionSet);
    if (!root || names.length < 2) return;
    for (const name of new Set(names)) {
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

function rootFields(
  context: ValidationContext,
  set: SelectionSetNode
): string[] {
  return set.selections.flatMap((s) => {
    if (s.kind === Kind.FIELD) {
      return s.name.value === "__typename" ? [] : [s.name.value];
    }
    const fragment =
      s.kind === Kind.INLINE_FRAGMENT ? s : context.getFragment(s.name.value);
    return fragment ? rootFields(context, fragment.selectionSet) : [];
  });
}
