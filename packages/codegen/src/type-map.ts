import {
  isListType,
  isNonNullType,
  isScalarType,
  type GraphQLArgument,
  type GraphQLInputField,
  type GraphQLType
} from "graphql";

export type ScalarDirection = "input" | "output";

/** Map a GraphQL type to its TypeScript representation, nullability included. */
export function typeToTS(
  type: GraphQLType,
  direction: ScalarDirection,
  nullable = true
): string {
  if (isNonNullType(type)) return typeToTS(type.ofType, direction, false);
  const base = isListType(type)
    ? `${typeToTS(type.ofType, direction)}[]`
    : isScalarType(type)
      ? `Scalars["${type.name}"]["${direction}"]`
      : type.name;
  return nullable ? `Maybe<${base}>` : base;
}

/**
 * `name: T` or `name?: T`. Nullable inputs may be omitted by the client, unless
 * a default value guarantees the resolver receives one.
 */
export function inputMember(
  input: GraphQLArgument | GraphQLInputField
): string {
  // The SDL node holds the default in both graphql 16 and 17 (17 moved the
  // field's own copy from `defaultValue` to `default`).
  const optional =
    !isNonNullType(input.type) && input.astNode?.defaultValue === undefined;
  return `${input.name}${optional ? "?" : ""}: ${typeToTS(input.type, "input")}`;
}
