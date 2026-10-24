import type { GraphQLErrorJSON, HeadersInit, Result } from "./types.js";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type MaybePromise<T> = T | Promise<T>;
/** Headers, or a function for values that change, such as a token. */
export type HeadersSource = HeadersInit | (() => MaybePromise<HeadersInit>);

/** Where a transport sends: the client's settings with its own section applied. */
export interface Endpoint {
  url: string;
  fetch: Fetch;
  /** The client's headers, the transport's, then `extra`, later ones winning. */
  headers(extra?: HeadersInit): Promise<Headers>;
}

export interface SubscriptionDocument {
  readonly name: string;
  readonly query: string;
}

export interface Subscriber {
  subscribe(
    document: SubscriptionDocument,
    variables: unknown,
    signal: AbortSignal | undefined
  ): AsyncGenerator<Result<never>>;
  /** Reconnects with fresh credentials, where a connection outlives them. */
  reconnect(): void;
  close(): Promise<void>;
}

/** What `@nxlab/client/ws` and `/sse` export, and codegen imports as needed. */
export interface Transport<Options> {
  readonly kind: "ws" | "sse";
  // Method syntax, so a Transport<WsOptions> passes as a Transport<unknown>.
  connect(endpoint: Endpoint, options: Options | undefined): Subscriber;
  /** Carries `Options` for `createClient`'s types, never set. */
  readonly "~options"?: Options;
}

export const asResult = (body: {
  data?: unknown;
  errors?: readonly GraphQLErrorJSON[];
}): Result<never> => ({
  data: (body.data ?? null) as never,
  ...(body.errors ? { errors: body.errors } : {})
});

export async function resolveHeaders(
  ...sources: (HeadersSource | undefined)[]
): Promise<Headers> {
  const resolved = await Promise.all(
    sources.map((source) => (typeof source === "function" ? source() : source))
  );
  const merged = new Headers();
  for (const headers of resolved) {
    for (const [key, value] of new Headers(headers)) merged.set(key, value);
  }
  return merged;
}

// `break` and an aborted `signal` both end the stream.
export async function* stream<T>(
  events: AsyncIterableIterator<T>,
  signal: AbortSignal | undefined
): AsyncGenerator<T> {
  const stop = (): void => void events.return?.();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    yield* events;
  } finally {
    signal?.removeEventListener("abort", stop);
  }
}
