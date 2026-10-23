import {
  isListType,
  isNonNullType,
  isScalarType,
  type GraphQLArgument,
  type GraphQLInputField,
  type GraphQLType
} from "graphql";

export type ScalarDirection = "input" | "output";

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

// Nullable inputs may be omitted by the client, unless a default value
// guarantees the resolver receives one.
export function inputMember(
  input: GraphQLArgument | GraphQLInputField
): string {
  const optional = !isNonNullType(input.type) && input.default === undefined;
  return `${input.name}${optional ? "?" : ""}: ${typeToTS(input.type, "input")}`;
}
