import type { Fetch, HeadersSource } from "./transport.js";

/**
 * Scalar types, the way the server's `CustomScalars` works: one type, or
 * `{ input; output }` when variables and results differ. Unregistered custom
 * scalars are `unknown`.
 *
 * ```ts
 * declare module "@nxara/olio-client" {
 *   interface ClientScalars {
 *     DateTime: { input: Date | string; output: string };
 *     JSON: unknown;
 *   }
 * }
 * ```
 */
// oxlint-disable-next-line typescript/no-empty-interface -- augmented by apps
export interface ClientScalars {}

interface DefaultScalars {
  ID: string;
  String: string;
  Int: number;
  Float: number;
  Boolean: boolean;
}

export type Scalar<
  N extends string,
  D extends "input" | "output" = "output"
> = N extends keyof ClientScalars
  ? ClientScalars[N] extends { input: infer I; output: infer O }
    ? D extends "input"
      ? I
      : O
    : ClientScalars[N]
  : N extends keyof DefaultScalars
    ? DefaultScalars[N]
    : unknown;

export type Operation = "query" | "mutation" | "subscription";

/** One operation, as codegen emits it from a `.graphql` file. */
export interface TypedDocument<
  Result,
  Variables,
  Op extends Operation = Operation
> {
  readonly operation: Op;
  readonly name: string;
  readonly query: string;
  /** Subscriptions only: `@ws` (the default) or `@sse` in the operation. */
  readonly transport?: "ws" | "sse";
  /**
   * Carries the types, never set. A string key rather than a symbol, so the
   * type still matches across copies of the package (built and source).
   */
  readonly "~types"?: { result: Result; variables: Variables };
}

export interface GraphQLErrorJSON {
  message: string;
  locations?: readonly { line: number; column: number }[];
  path?: readonly (string | number)[];
  extensions?: Record<string, unknown>;
}

export interface Result<T> {
  data: T | null;
  errors?: readonly GraphQLErrorJSON[];
}

// Spelled out, so the package needs neither the DOM lib nor @types/node.
export type HeadersInit = ConstructorParameters<typeof Headers>[0];

/**
 * `undefined` values are left out, so `token ? { authorization } : {}` and
 * `{ authorization: token && \`Bearer ${token}\` }` both send nothing before
 * sign-in.
 */
export type HeadersValue =
  | HeadersInit
  | Readonly<Record<string, string | undefined>>;

export interface CallOptions {
  signal?: AbortSignal;
  headers?: HeadersValue;
}

type RequiredKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? never : K;
}[keyof T];

/** Variables may be left out when none are required. */
export type VariablesArgs<V, O> = [RequiredKeys<V>] extends [never]
  ? [variables?: V, options?: O]
  : [variables: V, options?: O];

interface AnyDocument<Op extends Operation> {
  readonly operation: Op;
  readonly name: string;
  readonly query: string;
  readonly transport?: "ws" | "sse";
}

/**
 * What codegen emits as `operations`: each operation by root and name, and
 * the subscription transports they use, whose clients `createClient` needs.
 */
export interface Operations {
  readonly query?: Readonly<Record<string, AnyDocument<"query">>>;
  readonly mutation?: Readonly<Record<string, AnyDocument<"mutation">>>;
  readonly subscription?: Readonly<Record<string, AnyDocument<"subscription">>>;
  readonly transports?: readonly ("ws" | "sse")[];
}

/**
 * What `ws` and `sse` take: a graphql-ws or graphql-sse client, created and
 * configured by the app (retries, `connectionParams`, `terminate()` to
 * reconnect with new credentials).
 */
export interface SubscriptionClient {
  iterate(request: {
    query: string;
    variables?: Record<string, unknown>;
    operationName?: string;
  }): AsyncIterableIterator<{
    data?: unknown;
    errors?: readonly GraphQLErrorJSON[];
  }>;
}

type Call<D> =
  D extends TypedDocument<infer R, infer V, infer Op>
    ? Op extends "subscription"
      ? (
          ...args: VariablesArgs<V, Pick<CallOptions, "signal">>
        ) => AsyncIterableIterator<Result<R>>
      : (...args: VariablesArgs<V, CallOptions>) => Promise<Result<R>>
    : never;

/** `client.mutation.login(variables, options)`, one call per operation. */
export type Client<O extends Operations> = {
  readonly [Op in keyof O & Operation]: {
    readonly [K in keyof O[Op]]: Call<O[Op][K]>;
  };
};

/** The subscription transports the operations use. */
export type Transports<O extends Operations> = O extends {
  transports: readonly (infer K)[];
}
  ? K & ("ws" | "sse")
  : never;

/**
 * Queries and mutations go to `url` with `headers`, through `fetch`.
 * Subscriptions go through the app's own clients: `ws` (graphql-ws) and
 * `sse` (graphql-sse), each required once an operation uses it.
 */
export type ClientOptions<O extends Operations> = {
  url: string | URL;
  headers?: HeadersSource;
  /**
   * Default: the global `fetch`. Anything fetch-shaped works, such as a ky
   * instance.
   */
  fetch?: Fetch;
} & { readonly [K in Transports<O>]: SubscriptionClient };
