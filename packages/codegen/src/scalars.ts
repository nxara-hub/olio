/** Built-in GraphQL scalar -> TypeScript input/output types. */
export interface Scalars {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  Boolean: { input: boolean; output: boolean };
}

/** Augment this interface (via `declare module`) to register custom scalars. */
export interface CustomScalars {}

/** Resolve a scalar name to its input/output types, falling back to `unknown`. */
export type ResolveScalar<
  Name extends keyof CustomScalars | keyof Scalars | (string & {})
> = Name extends keyof CustomScalars
  ? CustomScalars[Name] extends { input: infer Input; output: infer Output }
    ? { input: Input; output: Output }
    : { input: CustomScalars[Name]; output: CustomScalars[Name] }
  : Name extends keyof Scalars
    ? Scalars[Name]
    : { input: unknown; output: unknown };

/**
 * Augment this interface to give an enum internal values, e.g.
 * `{ Role: 1 | 2 }`. Resolvers and arguments then use those values; supply
 * them at runtime with `resolvers.<module>.Role({ ADMIN: 1, GUEST: 2 })`.
 */
// oxlint-disable-next-line typescript/no-empty-interface -- augmented by apps
export interface CustomEnums {}

/** An enum's TypeScript type: its internal values if registered, else its names. */
export type ResolveEnum<
  Name extends keyof CustomEnums | (string & {}),
  Names
> = Name extends keyof CustomEnums ? CustomEnums[Name] : Names;
