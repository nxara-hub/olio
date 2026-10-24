import type { Fetch, HeadersSource, Transport } from "./transport.js";

/**
 * Scalar types, the way the server's `CustomScalars` works: one type, or
 * `{ input; output }` when variables and results differ. Unregistered custom
 * scalars are `unknown`.
 *
 * ```ts
 * declare module "@nxlab/client" {
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

export interface CallOptions {
  signal?: AbortSignal;
  headers?: HeadersInit;
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
 * the subscription transports they use (imported only if used, so an app
 * bundles no transport it doesn't need).
 */
export interface Operations {
  readonly query?: Readonly<Record<string, AnyDocument<"query">>>;
  readonly mutation?: Readonly<Record<string, AnyDocument<"mutation">>>;
  readonly subscription?: Readonly<Record<string, AnyDocument<"subscription">>>;
  readonly transports?: {
    readonly ws?: Transport<unknown>;
    readonly sse?: Transport<unknown>;
  };
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
} & {
  /**
   * Reconnects the WebSocket, so it sends fresh `connectionParams` (after
   * sign-in, say). Live subscriptions resume on the new connection.
   */
  reconnect(): void;
  /** Ends every subscription and closes the connections. */
  close(): Promise<void>;
};

interface Endpoint {
  /** Default: the client's `url`. */
  url?: string | URL;
  headers?: HeadersSource;
  fetch?: Fetch;
}

type TransportOptions<O extends Operations> = O extends {
  transports: infer T;
}
  ? {
      [K in keyof T]?: T[K] extends Transport<infer Options> ? Options : never;
    }
  : unknown;

/**
 * The client's settings, plus overrides per transport: `http` for queries and
 * mutations, `ws` and `sse` for subscriptions. `ws` and `sse` exist only when
 * the operations use them.
 */
export type ClientOptions<O extends Operations> = {
  url: string | URL;
  headers?: HeadersSource;
  /**
   * Default: the global `fetch`. Anything fetch-shaped works, such as a ky
   * instance; `fromAxios(axios)` adapts axios. SSE needs one that streams
   * the response (fetch, ky), which axios can't.
   */
  fetch?: Fetch;
  http?: Endpoint;
} & TransportOptions<O>;
