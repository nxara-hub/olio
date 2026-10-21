import { createHandler } from "graphql-http/lib/use/fetch";

import { errorMasker, type HttpOptions, type Servable } from "./core.js";

/**
 * GraphQL over HTTP for anything that speaks the Fetch API: Bun.serve, Deno,
 * Cloudflare Workers, Hono, Elysia, Next.js route handlers, SvelteKit, Remix.
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
  return createHandler({
    schema: app.schema,
    context: context ? (req) => context(req.raw) as never : undefined,
    onOperation: (_req, _args, result) => mask.result(result)
  });
}
