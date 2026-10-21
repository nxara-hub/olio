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
