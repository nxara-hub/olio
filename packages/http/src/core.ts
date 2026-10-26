import type { Context } from "@nxlab/olio";
import { GraphQLError, type GraphQLSchema } from "graphql";
import type { Response as HttpResponse } from "graphql-http";

type MaybePromise<T> = T | Promise<T>;

/** An olio app, or anything with a schema. */
export interface Servable {
  readonly schema: GraphQLSchema;
}

export interface ErrorOptions {
  /**
   * Hide errors that aren't `GraphQLError`s (a failing database, a bug)
   * behind "Unexpected error.". Throw a `GraphQLError` for anything clients
   * should see. Default: true.
   */
  maskErrors?: boolean;
  /** Where hidden errors go, so they aren't lost. Default: `console.error`. */
  onUnexpectedError?: (error: unknown) => void;
}

type ContextHook<Request> = (request: Request) => MaybePromise<Context>;

// Without a hook graphql-http passes no context at all, so once the app
// registers a `ctx` type, every resolver reading it would fail at runtime.
type ContextOption<Request> = undefined extends Context
  ? { context?: ContextHook<Request> }
  : { context: ContextHook<Request> };

export type HttpOptions<Request> = ErrorOptions &
  ContextOption<Request> & {
    /**
     * Called once an operation has finished, after the response is built.
     * Dispose per-operation resources here, such as `ctx.di.dispose()`.
     */
    onOperationEnd?: (ctx: Context) => MaybePromise<void>;
  };

/** A handler's options, required once `context` is. */
export type OptionsArgs<Request> = undefined extends Context
  ? [options?: HttpOptions<Request>]
  : [options: HttpOptions<Request>];

export interface ErrorMasker {
  /**
   * One error, or any caught value: a `GraphQLError` passes unless it wraps
   * an unexpected error; anything else becomes "Unexpected error." and is
   * reported.
   */
  error: (error: unknown) => GraphQLError;
  /** A result's errors, masked: graphql's, or what graphql-sse / graphql-ws hand `onNext`. */
  result: <R extends { readonly errors?: readonly GraphQLError[] }>(
    result: R
  ) => R;
  /** Sends an error to `onUnexpectedError`. */
  report: (error: unknown) => void;
}

/** The handlers' masking, for your own subscription servers. */
export function errorMasker(options: ErrorOptions = {}): ErrorMasker {
  const { maskErrors = true, onUnexpectedError = console.error } = options;
  const error = (thrown: unknown): GraphQLError => {
    if (!(thrown instanceof GraphQLError)) {
      onUnexpectedError(thrown);
      return new GraphQLError(
        maskErrors || !(thrown instanceof Error)
          ? "Unexpected error."
          : thrown.message
      );
    }
    const cause = thrown.originalError;
    if (!cause || cause instanceof GraphQLError) return thrown;
    onUnexpectedError(cause);
    return maskErrors
      ? new GraphQLError("Unexpected error.", {
          nodes: thrown.nodes,
          path: thrown.path
        })
      : thrown;
  };
  return {
    error,
    result: (result) =>
      result.errors ? { ...result, errors: result.errors.map(error) } : result,
    report: onUnexpectedError
  };
}

/**
 * graphql-http's response for a context hook that failed: a GraphQL error
 * body. 200 for a deliberate GraphQLError (e.g. UNAUTHENTICATED), so clients
 * read it like any error; 500 for an unexpected one.
 */
export function contextFailure(
  mask: ErrorMasker,
  error: unknown
): HttpResponse {
  const deliberate = error instanceof GraphQLError;
  const graphqlError = mask.error(error);
  return [
    JSON.stringify({ errors: [graphqlError.toJSON()] }),
    {
      status: deliberate ? 200 : 500,
      statusText: deliberate ? "OK" : "Internal Server Error",
      headers: { "content-type": "application/json; charset=utf-8" }
    }
  ];
}

// Once per context, and a failure in it is reported rather than thrown.
export function operationEnd<C>(
  mask: ErrorMasker,
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
