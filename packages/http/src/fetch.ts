import { createHandler } from "graphql-http/lib/use/fetch";
import { createHandler as createSseHandler } from "graphql-sse/lib/use/fetch";

import {
  contextFailure,
  errorMasker,
  guardContext,
  isSse,
  maskOperation,
  sseFailure,
  type HttpOptions,
  type Servable
} from "./core.js";

/**
 * GraphQL over HTTP for anything that speaks the Fetch API: Bun.serve, Deno,
 * Cloudflare Workers, Hono, Elysia, Next.js route handlers, SvelteKit, Remix.
 * The same URL also serves subscriptions as server-sent events.
 *
 * ```ts
 * const graphql = fetchHandler(app, { context: (request) => createContext(request) });
 * hono.all("/graphql", (c) => graphql(c.req.raw));
 * ```
 */
export function fetchHandler(
  app: Servable,
  options: HttpOptions<Request> = {}
): (request: Request) => Promise<Response> {
  const mask = errorMasker(options);
  const { context } = options;
  const subscriptionContext = guardContext(
    mask,
    options.subscriptionContext ?? context
  );
  const http = createHandler({
    schema: app.schema,
    context: context
      ? async (req) => {
          try {
            return (await context(req.raw)) as never;
          } catch (error) {
            return contextFailure(mask, error);
          }
        }
      : undefined,
    onOperation: (_req, _args, result) => mask.result(result)
  });
  const sse = createSseHandler({
    schema: app.schema,
    context: subscriptionContext
      ? (req) => subscriptionContext(req.raw) as never
      : undefined,
    onOperation: (_ctx, _req, _args, result) => maskOperation(mask, result),
    onNext: (_ctx, _req, result) => mask.result(result as never) as never
  });
  return async (request) => {
    const signals = {
      method: request.method,
      accept: request.headers.get("accept"),
      token: request.headers.get("x-graphql-event-stream-token")
    };
    if (!isSse(signals)) return http(request);
    try {
      return await sse(request);
    } catch (error) {
      const failure = sseFailure(
        mask,
        error,
        !signals.token && signals.method !== "PUT"
      );
      return new Response(failure.body, failure);
    }
  };
}
