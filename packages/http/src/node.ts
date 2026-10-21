import type { IncomingMessage, ServerResponse } from "node:http";

import { createHandler } from "graphql-http/lib/use/http";

import { errorMasker, type HttpOptions, type Servable } from "./core.js";

/**
 * GraphQL over HTTP for Node's request/response pair: `node:http`, Express,
 * Connect, Koa's `ctx.req`/`ctx.res`, Fastify's `request.raw`/`reply.raw`.
 *
 * ```ts
 * createServer(nodeHandler(app, { context: (req) => createContext(req) }));
 * ```
 */
export function nodeHandler(
  app: Servable,
  options: HttpOptions<IncomingMessage> = {}
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const mask = errorMasker(options);
  const { context } = options;
  return createHandler({
    schema: app.schema,
    context: context ? (req) => context(req.raw) as never : undefined,
    onOperation: (_req, _args, result) => mask.result(result)
  });
}
