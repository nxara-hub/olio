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
