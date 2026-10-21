import type { Context, SubscriptionContext } from "@nxlab/olio";
import {
  GraphQLError,
  type ExecutionResult,
  type GraphQLSchema
} from "graphql";

type MaybePromise<T> = T | Promise<T>;

/** What the adapters serve: an olio app, or anything with a schema. */
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
  /** Builds `ctx` for each operation, from the framework's request. */
  context?: (request: Request) => MaybePromise<Context>;
  /**
   * Builds `ctx` for operations streamed over server-sent events
   * (`Accept: text/event-stream`), typically subscriptions. Defaults to
   * `context`.
   */
  subscriptionContext?: (request: Request) => MaybePromise<SubscriptionContext>;
}

/** Headers a server-sent events request carries, as graphql-sse sends them. */
export interface SseSignals {
  method: string;
  accept: string | null | undefined;
  token: string | null | undefined;
}

/**
 * Whether a request is for graphql-sse: a stream (`Accept:
 * text/event-stream`), or single-connection mode's reservation (`PUT`) and
 * its token header. Everything else is plain GraphQL over HTTP.
 */
export const isSse = ({ method, accept, token }: SseSignals): boolean =>
  method === "PUT" ||
  Boolean(token) ||
  Boolean(accept?.includes("text/event-stream"));

/**
 * A stream whose source throws mid-iteration ends with one last result
 * carrying that (masked) error, instead of the error escaping the transport.
 * @yields {unknown} Each result from `stream`, then the error result if it throws.
 */
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

/**
 * graphql-sse's operation result: one result (e.g. a subscription that failed
 * to start) is masked here; a stream is masked event by event in `onNext`,
 * and made to end cleanly if its source throws.
 */
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

/** A WebSocket client, as subscription context sees it. */
export interface Connection<Request> {
  /** The HTTP request that opened the socket: headers, cookies, URL. */
  request: Request;
  /** What the client sent in `connection_init`, where clients usually put a token. */
  connectionParams: Readonly<Record<string, unknown>> | undefined;
}

export interface SubscriptionOptions<Request> extends ErrorOptions {
  /** Builds `ctx` for each subscription, from its connection. */
  context?: (
    connection: Connection<Request>
  ) => MaybePromise<SubscriptionContext>;
}

/** Hides unexpected errors, per the options: one error, or a whole result. */
export function errorMasker(options: ErrorOptions): {
  error: (error: GraphQLError) => GraphQLError;
  result: (result: ExecutionResult) => ExecutionResult;
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
      result.errors ? { ...result, errors: result.errors.map(mask) } : result
  };
}
