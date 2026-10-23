import type { Context, SubscriptionContext } from "@nxlab/olio";
import {
  GraphQLError,
  type ExecutionResult,
  type GraphQLSchema
} from "graphql";
import type { Response as HttpResponse } from "graphql-http";

type MaybePromise<T> = T | Promise<T>;

/** An olio app, or anything with a schema. */
export interface Servable {
  readonly schema: GraphQLSchema;
}

interface ErrorOptions {
  /**
   * Hide errors that aren't `GraphQLError`s (a failing database, a bug)
   * behind "Unexpected error.". Throw a `GraphQLError` for anything clients
   * should see. Default: true.
   */
  maskErrors?: boolean;
  /** Where hidden errors go, so they aren't lost. Default: `console.error`. */
  onUnexpectedError?: (error: unknown) => void;
}

export interface HttpOptions<Request> extends ErrorOptions {
  context?: (request: Request) => MaybePromise<Context>;
  /** For operations streamed over server-sent events. Defaults to `context`. */
  subscriptionContext?: (request: Request) => MaybePromise<SubscriptionContext>;
  /**
   * Called once an operation has finished: after the HTTP response is
   * built, or when a server-sent event stream completes. Dispose
   * per-operation resources here, such as `ctx.di.dispose()`.
   */
  onOperationEnd?: (ctx: Context | SubscriptionContext) => MaybePromise<void>;
}

export interface SseSignals {
  method: string;
  accept: string | null | undefined;
  token: string | null | undefined;
}

// graphql-sse's single-connection mode reserves a stream with `PUT`, then
// sends operations with its token header, without `Accept: text/event-stream`.
export const isSse = ({ method, accept, token }: SseSignals): boolean =>
  method === "PUT" ||
  Boolean(token) ||
  Boolean(accept?.includes("text/event-stream"));

// A source that throws mid-stream ends with one masked error result, instead
// of the raw error escaping the transport.
async function* endWithError(
  mask: ReturnType<typeof errorMasker>,
  stream: AsyncIterable<unknown>
): AsyncGenerator<unknown> {
  try {
    yield* stream;
  } catch (error) {
    const graphqlError =
      error instanceof GraphQLError
        ? error
        : new GraphQLError(
            error instanceof Error ? error.message : String(error),
            {
              originalError: error instanceof Error ? error : undefined
            }
          );
    yield mask.result({ errors: [graphqlError] });
  }
}

// A stream is masked event by event in `onNext`; only a single result (a
// subscription that failed to start) is masked here.
export async function maskOperation(
  mask: ReturnType<typeof errorMasker>,
  result: unknown
): Promise<never> {
  const settled = (await result) as ExecutionResult | AsyncIterable<unknown>;
  return (
    Symbol.asyncIterator in settled
      ? endWithError(mask, settled)
      : mask.result(settled)
  ) as never;
}

export interface Connection<Request> {
  /** The HTTP request that opened the socket. */
  request: Request;
  /** From `connection_init`. Browsers can't set WebSocket headers, so clients put tokens here. */
  connectionParams: Readonly<Record<string, unknown>> | undefined;
}

export interface SubscriptionOptions<Request> extends ErrorOptions {
  context?: (
    connection: Connection<Request>
  ) => MaybePromise<SubscriptionContext>;
  /** Called once an operation has completed, or its socket has closed (once per operation). */
  onOperationEnd?: (ctx: SubscriptionContext) => MaybePromise<void>;
}

export function errorMasker(options: ErrorOptions): {
  error: (error: GraphQLError) => GraphQLError;
  result: (result: ExecutionResult) => ExecutionResult;
  /** For failures before execution, such as a throwing `context` hook. */
  thrown: (error: unknown) => GraphQLError;
  report: (error: unknown) => void;
} {
  const { maskErrors = true, onUnexpectedError = console.error } = options;
  const mask = (error: GraphQLError): GraphQLError => {
    const cause = error.originalError;
    if (!cause || cause instanceof GraphQLError) return error;
    onUnexpectedError(cause);
    return maskErrors
      ? new GraphQLError("Unexpected error.", {
          nodes: error.nodes,
          path: error.path
        })
      : error;
  };
  return {
    error: mask,
    result: (result) =>
      result.errors ? { ...result, errors: result.errors.map(mask) } : result,
    report: onUnexpectedError,
    thrown: (error) => {
      if (error instanceof GraphQLError) return error;
      onUnexpectedError(error);
      return new GraphQLError(
        maskErrors || !(error instanceof Error)
          ? "Unexpected error."
          : error.message
      );
    }
  };
}

/**
 * Run a `context` hook so that a failure in it is handled like any other
 * error: GraphQLErrors pass through, anything else is hidden and reported.
 * Without this, the protocol libraries would send its raw message (SSE,
 * WebSocket in development) or an empty 500, and report nothing.
 */
export function guardContext<A, R>(
  mask: ReturnType<typeof errorMasker>,
  hook: ((arg: A) => MaybePromise<R>) | undefined
): ((arg: A) => Promise<R>) | undefined {
  if (!hook) return undefined;
  return async (arg) => {
    try {
      return await hook(arg);
    } catch (error) {
      throw mask.thrown(error);
    }
  };
}

/**
 * graphql-http's response for a context hook that failed: a GraphQL error
 * body. 200 for a deliberate GraphQLError (e.g. UNAUTHENTICATED), so clients
 * read it like any error; 500 for an unexpected one.
 */
export function contextFailure(
  mask: ReturnType<typeof errorMasker>,
  error: unknown
): HttpResponse {
  const deliberate = error instanceof GraphQLError;
  const graphqlError = mask.thrown(error);
  return [
    JSON.stringify({ errors: [graphqlError.toJSON()] }),
    {
      status: deliberate ? 200 : 500,
      statusText: deliberate ? "OK" : "Internal Server Error",
      headers: { "content-type": "application/json; charset=utf-8" }
    }
  ];
}

/**
 * graphql-sse lets an error from `context` escape its handler. This is the
 * response to send instead: for a stream, one `next` event with the error
 * and `complete`, which the client reads as an ordinary GraphQL error;
 * otherwise (single-connection mode's requests) a JSON error body.
 */
export function sseFailure(
  mask: ReturnType<typeof errorMasker>,
  error: unknown,
  streaming: boolean
): { status: number; headers: Record<string, string>; body: string } {
  if (!streaming) {
    const [body, init] = contextFailure(mask, error);
    return {
      status: init.status,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: body ?? ""
    };
  }
  const result = JSON.stringify({ errors: [mask.thrown(error).toJSON()] });
  return {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache"
    },
    body: `event: next\ndata: ${result}\n\nevent: complete\ndata:\n\n`
  };
}

// Once per context, whatever a transport signals; a failure in it is reported
// rather than thrown.
export function operationEnd<C>(
  mask: ReturnType<typeof errorMasker>,
  hook: ((ctx: C) => MaybePromise<void>) | undefined
): (ctx: C | undefined) => Promise<void> {
  const ended = new WeakSet<object>();
  return async (ctx) => {
    if (!hook || ctx === undefined) return;
    if (typeof ctx === "object" && ctx !== null) {
      if (ended.has(ctx)) return;
      ended.add(ctx);
    }
    try {
      await hook(ctx);
    } catch (error) {
      mask.report(error);
    }
  };
}
