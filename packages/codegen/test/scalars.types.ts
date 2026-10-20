/**
 * Type-level checks for `ResolveScalar`. Deliberately has no runtime tests —
 * `bun test` cannot evaluate types. These assertions are verified by
 * `bun run check-types`, which typechecks `test/` via tsconfig.test.json.
 */

import type { ResolveScalar } from "../src/index.js";

declare module "../src/scalars.js" {
  interface CustomScalars {
    /** Different input/output types. */
    JSON: { input: string; output: unknown };
    /** Shorthand for `{ input: Date; output: Date }`. */
    DateTime: Date;
    ObjectID: string;
    /** Built-ins can be remapped too. */
    Float: { input: string; output: number };
  }
}

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

type Expect<T extends true> = T;

// Built-in scalars resolve through the `Scalars` interface.
type _ID = Expect<
  Equal<ResolveScalar<"ID">, { input: string; output: string }>
>;
type _String = Expect<
  Equal<ResolveScalar<"String">, { input: string; output: string }>
>;
type _Int = Expect<
  Equal<ResolveScalar<"Int">, { input: number; output: number }>
>;
// Remapped through CustomScalars.
type _Float = Expect<
  Equal<ResolveScalar<"Float">, { input: string; output: number }>
>;
type _Boolean = Expect<
  Equal<ResolveScalar<"Boolean">, { input: boolean; output: boolean }>
>;

// Custom scalar with separate input/output types.
type _JSON = Expect<
  Equal<ResolveScalar<"JSON">, { input: string; output: unknown }>
>;

// Custom scalar shorthand normalizes to the same input and output type.
type _DateTime = Expect<
  Equal<ResolveScalar<"DateTime">, { input: Date; output: Date }>
>;
type _ObjectID = Expect<
  Equal<ResolveScalar<"ObjectID">, { input: string; output: string }>
>;

// Unknown scalar falls back to `unknown` in both directions.
type _Unknown = Expect<
  Equal<ResolveScalar<"Unknown">, { input: unknown; output: unknown }>
>;

/** Referenced so a failed assertion surfaces as a compile error. */
export type ScalarTypeChecks = [
  _ID,
  _String,
  _Int,
  _Float,
  _Boolean,
  _JSON,
  _DateTime,
  _ObjectID,
  _Unknown
];
