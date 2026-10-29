import type { GraphQLErrorJSON, HeadersValue, Result } from "./types.js";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type MaybePromise<T> = T | Promise<T>;
/** Headers, or a function for values that change, such as a token. */
export type HeadersSource = HeadersValue | (() => MaybePromise<HeadersValue>);

export const asResult = (body: {
  data?: unknown;
  errors?: readonly GraphQLErrorJSON[];
}): Result<never> => ({
  data: (body.data ?? null) as never,
  ...(body.errors ? { errors: body.errors } : {})
});

// `new Headers()` would send an `undefined` value as the string "undefined".
function entries(
  headers: HeadersValue | undefined
): Iterable<[string, string]> {
  if (
    headers === undefined ||
    Array.isArray(headers) ||
    headers instanceof Headers
  ) {
    return new Headers(headers);
  }
  return Object.entries(headers).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  );
}

export async function resolveHeaders(
  ...sources: (HeadersSource | undefined)[]
): Promise<Headers> {
  const resolved = await Promise.all(
    sources.map((source) => (typeof source === "function" ? source() : source))
  );
  const merged = new Headers();
  for (const headers of resolved) {
    for (const [key, value] of entries(headers)) merged.set(key, value);
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

interface CloseEvent {
  code: number;
  reason: string;
}

const isClose = (error: unknown): error is CloseEvent =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  "reason" in error;

/**
 * What graphql-ws throws that is a result over HTTP and SSE: an operation's
 * errors (a bare array), or the close event (not an Error, so its code
 * wouldn't even show in a log) of a server refusing with a 4xxx code.
 */
export function errorResult(error: unknown): Result<never> | undefined {
  if (Array.isArray(error)) {
    return asResult({ errors: error as GraphQLErrorJSON[] });
  }
  if (!isClose(error) || error.code < 4000 || error.code > 4999) return;
  return {
    data: null,
    errors: [
      {
        message: error.reason || `WebSocket closed (${error.code})`,
        extensions: { code: "WEBSOCKET_CLOSED", closeCode: error.code }
      }
    ]
  };
}
