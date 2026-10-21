import { createHandler } from "graphql-http/lib/use/fetch";
import { createHandler as createSseHandler } from "graphql-sse/lib/use/fetch";

import {
  errorMasker,
  isSse,
  maskOperation,
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
  const { context, subscriptionContext = context } = options;
  const http = createHandler({
    schema: app.schema,
    context: context ? (req) => context(req.raw) as never : undefined,
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
  return (request) =>
    isSse({
      method: request.method,
      accept: request.headers.get("accept"),
      token: request.headers.get("x-graphql-event-stream-token")
    })
      ? sse(request)
      : http(request);
}
