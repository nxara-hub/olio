export interface Scalars {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  Boolean: { input: boolean; output: boolean };
}

/** Augment (`declare module`) to register custom scalars: `{ DateTime: Date }`, or `{ input; output }`. */
export interface CustomScalars {}

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

export type ResolveEnum<
  Name extends keyof CustomEnums | (string & {}),
  Names
> = Name extends keyof CustomEnums ? CustomEnums[Name] : Names;
