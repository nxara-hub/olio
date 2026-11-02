import type { Context } from "@nxara/olio-core";
import {
  GraphQLError,
  NoSchemaIntrospectionCustomRule,
  parse,
  specifiedRules,
  validate,
  type GraphQLSchema,
  type ValidationRule
} from "graphql";
import type { Response as HttpResponse } from "graphql-http";

type MaybePromise<T> = T | Promise<T>;

/** An olio app, or anything with a schema. */
export interface Servable {
  readonly schema: GraphQLSchema;
}

/** What a hidden error happened in, for tying it to a request in your logs. */
export interface ErrorInfo<Request = undefined, Ctx = Context> {
  /** The operation's context; `undefined` when the `context` hook itself failed. */
  readonly ctx: Ctx | undefined;
  /** The HTTP request; `undefined` in your own subscription servers. */
  readonly request: Request;
}

export interface ErrorOptions<Request = undefined, Ctx = Context> {
  /**
   * Hide errors that aren't `GraphQLError`s (a failing database, a bug)
   * behind "Unexpected error.". Throw a `GraphQLError` for anything clients
   * should see. Default: true.
   */
  maskErrors?: boolean;
  /**
   * Where hidden errors go, so they aren't lost, with what they happened in.
   * Default: `console.error` of the error.
   */
  onUnexpectedError?: (error: unknown, info: ErrorInfo<Request, Ctx>) => void;
  /**
   * Keep graphql's "Did you mean" hints in errors, which name fields,
   * arguments and enum values a client hasn't been told about. Default: true.
   */
  suggestions?: boolean;
}

/** What `validateOperation` should keep clients from learning about the schema. */
export interface SchemaHiding {
  /** Allow `__schema` and `__type`; `__typename` always works. Default: true. */
  introspection?: boolean;
  /** Keep graphql's "Did you mean" hints. Default: true. */
  suggestions?: boolean;
}

type ContextHook<Request> = (request: Request) => MaybePromise<Context>;

// Without a hook graphql-http passes no context at all, so once the app
// registers a `ctx` type, every resolver reading it would fail at runtime.
type ContextOption<Request> = undefined extends Context
  ? { context?: ContextHook<Request> }
  : { context: ContextHook<Request> };

/** What a rule set can depend on, e.g. a complexity rule pricing the variables. */
export interface OperationInfo {
  readonly variables: Readonly<Record<string, unknown>>;
  readonly operationName: string | null | undefined;
}

export type ValidationRules =
  | readonly ValidationRule[]
  | ((operation: OperationInfo) => readonly ValidationRule[]);

/**
 * graphql-http's own options that the handlers don't build on, passed as
 * they are: `execute`, `parse`, `validate`, `getOperationAST`, `rootValue`,
 * `formatError`, `parseRequestParams` (persisted queries: map an id to its
 * query). Not `onSubscribe`: operation args returned from it would skip
 * `context` and every validation rule.
 */
export type GraphQLHttpOptions<Options> = Omit<
  Options,
  "schema" | "context" | "validationRules" | "onOperation" | "onSubscribe"
>;

export type HttpOptions<Request, Passed = unknown> = ErrorOptions<Request> &
  ContextOption<Request> &
  Passed & {
    /**
     * Rules run with graphql's own before any resolver, such as a complexity
     * or depth limit. Added to graphql's rules, never in place of them.
     */
    validationRules?: ValidationRules;
    /**
     * Allow `__schema` and `__type`; `__typename` always works. Tools that
     * read the schema over HTTP, such as `codegenClient` with a URL, need it.
     * Default: true.
     */
    introspection?: boolean;
    /**
     * Called once an operation has finished, after the response is built.
     * Dispose per-operation resources here, such as `ctx.di.dispose()`.
     */
    onOperationEnd?: (ctx: Context) => MaybePromise<void>;
  };

/** A handler's options, required once `context` is. */
export type OptionsArgs<Request, Passed = unknown> = undefined extends Context
  ? [options?: HttpOptions<Request, Passed>]
  : [options: HttpOptions<Request, Passed>];

export interface ErrorMasker<Ctx = Context> {
  /**
   * One error, or any caught value: a `GraphQLError` passes unless it wraps
   * an unexpected error; anything else becomes "Unexpected error." and is
   * reported, with `ctx` if given.
   */
  error: (error: unknown, ctx?: Ctx) => GraphQLError;
  /** A result's errors, masked: graphql's, or what graphql-sse / graphql-ws hand `onNext`. */
  result: <R extends { readonly errors?: readonly GraphQLError[] }>(
    result: R,
    ctx?: Ctx
  ) => R;
  /** Sends an error to `onUnexpectedError`. */
  report: (error: unknown, ctx?: Ctx) => void;
}

/** The masking itself, reporting each hidden error with `info`. */
export interface Masking<Info> {
  error: (error: unknown, info: Info) => GraphQLError;
  result: <R extends { readonly errors?: readonly GraphQLError[] }>(
    result: R,
    info: Info
  ) => R;
  report: (error: unknown, info: Info) => void;
}

// A hint always ends the message. Errors with a path were thrown while
// resolving, so their words are the app's own, not graphql's.
function withoutSuggestion(error: GraphQLError): GraphQLError {
  if (error.path) return error;
  const message = error.message.replace(/ ?Did you mean [^?]*\?$/, "");
  if (message === error.message) return error;
  return new GraphQLError(message, {
    nodes: error.nodes,
    source: error.source,
    positions: error.positions,
    extensions: error.extensions
  });
}

export function masking<Info>(options: {
  maskErrors?: boolean;
  onUnexpectedError?: (error: unknown, info: Info) => void;
  suggestions?: boolean;
}): Masking<Info> {
  const {
    maskErrors = true,
    // Just the error: the info holds whole contexts (DI scopes and all).
    onUnexpectedError = (error: unknown): void => console.error(error),
    suggestions = true
  } = options;
  const masked = (thrown: unknown, info: Info): GraphQLError => {
    if (!(thrown instanceof GraphQLError)) {
      onUnexpectedError(thrown, info);
      return new GraphQLError(
        maskErrors || !(thrown instanceof Error)
          ? "Unexpected error."
          : thrown.message
      );
    }
    const cause = thrown.originalError;
    if (!cause || cause instanceof GraphQLError) return thrown;
    onUnexpectedError(cause, info);
    return maskErrors
      ? new GraphQLError("Unexpected error.", {
          nodes: thrown.nodes,
          path: thrown.path
        })
      : thrown;
  };
  const error = (thrown: unknown, info: Info): GraphQLError => {
    const result = masked(thrown, info);
    return suggestions ? result : withoutSuggestion(result);
  };
  return {
    error,
    result: (result, info) =>
      result.errors
        ? { ...result, errors: result.errors.map((e) => error(e, info)) }
        : result,
    report: onUnexpectedError
  };
}

/**
 * The handlers' masking, for your own subscription servers. Pass each call
 * the operation's context so `onUnexpectedError` gets it:
 * `errorMasker<SubscriptionContext>()`.
 */
export function errorMasker<Ctx = Context>(
  options: ErrorOptions<undefined, Ctx> = {}
): ErrorMasker<Ctx> {
  const mask = masking(options);
  const info = (ctx?: Ctx): ErrorInfo<undefined, Ctx> => ({
    ctx,
    request: undefined
  });
  return {
    error: (error, ctx) => mask.error(error, info(ctx)),
    result: (result, ctx) => mask.result(result, info(ctx)),
    report: (error, ctx) => mask.report(error, info(ctx))
  };
}

/**
 * graphql-http's response for a context hook that failed: a GraphQL error
 * body. 200 for a deliberate GraphQLError (e.g. UNAUTHENTICATED), so clients
 * read it like any error; 500 for an unexpected one.
 */
export function contextFailure<Request>(
  mask: Masking<ErrorInfo<Request>>,
  error: unknown,
  request: Request
): HttpResponse {
  const deliberate = error instanceof GraphQLError;
  const graphqlError = mask.error(error, { ctx: undefined, request });
  return [
    JSON.stringify({ errors: [graphqlError.toJSON()] }),
    {
      status: deliberate ? 200 : 500,
      statusText: deliberate ? "OK" : "Internal Server Error",
      headers: { "content-type": "application/json; charset=utf-8" }
    }
  ];
}

interface Operation {
  readonly variables?: Readonly<Record<string, unknown>> | null;
  readonly operationName?: string | null;
}

// Always after graphql's own rules: graphql-http's hook could replace them,
// and a rule set shouldn't be able to drop them by accident.
function ruleSet(
  rules: ValidationRules,
  operation: Operation,
  introspection: boolean
): readonly ValidationRule[] {
  const custom =
    typeof rules === "function"
      ? rules({
          variables: operation.variables ?? {},
          operationName: operation.operationName
        })
      : rules;
  return [
    ...specifiedRules,
    ...custom,
    ...(introspection ? [] : [NoSchemaIntrospectionCustomRule])
  ];
}

/**
 * Runs graphql's rules and `rules` on an operation, as the handlers do: for
 * your own subscription servers' `onSubscribe`. Empty when it's valid.
 */
export function validateOperation(
  schema: GraphQLSchema,
  operation: Operation & { readonly query: string },
  rules: ValidationRules,
  { introspection = true, suggestions = true }: SchemaHiding = {}
): readonly GraphQLError[] {
  let document: ReturnType<typeof parse>;
  try {
    document = parse(operation.query);
  } catch (error) {
    return [error as GraphQLError];
  }
  const errors = validate(
    schema,
    document,
    ruleSet(rules, operation, introspection)
  );
  return suggestions ? errors : errors.map(withoutSuggestion);
}

/** `validationRules` for graphql-http. */
export const handlerRules = (
  rules: ValidationRules | undefined,
  introspection = true
):
  | ((
      req: unknown,
      args: {
        readonly variableValues?: Readonly<Record<string, unknown>> | null;
        readonly operationName?: string | null;
      }
    ) => readonly ValidationRule[])
  | undefined =>
  rules || !introspection
    ? (_req, args) =>
        ruleSet(
          rules ?? [],
          {
            variables: args.variableValues,
            operationName: args.operationName
          },
          introspection
        )
    : undefined;

/**
 * `formatError` for graphql-http: validation errors never reach `onOperation`,
 * so this is the only hook that sees them. The app's own runs last.
 */
export const handlerFormatError =
  (
    suggestions: boolean | undefined,
    formatError:
      | ((error: Readonly<GraphQLError | Error>) => GraphQLError | Error)
      | undefined
  ) =>
  (error: Readonly<GraphQLError | Error>): GraphQLError | Error => {
    const hidden =
      suggestions === false && error instanceof GraphQLError
        ? withoutSuggestion(error)
        : (error as GraphQLError | Error);
    return formatError ? formatError(hidden) : hidden;
  };

// Once per context, and a failure in it is reported rather than thrown.
export function operationEnd<Request>(
  mask: Masking<ErrorInfo<Request>>,
  hook: ((ctx: Context) => MaybePromise<void>) | undefined
): (ctx: Context | undefined, request: Request) => Promise<void> {
  const ended = new WeakSet<object>();
  return async (ctx, request) => {
    if (!hook || ctx === undefined) return;
    if (typeof ctx === "object" && ctx !== null) {
      if (ended.has(ctx)) return;
      ended.add(ctx);
    }
    try {
      await hook(ctx);
    } catch (error) {
      mask.report(error, { ctx, request });
    }
  };
}
