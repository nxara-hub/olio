import type { IncomingMessage, ServerResponse } from "node:http";

import { createHandler } from "graphql-http/lib/use/http";
import { createHandler as createSseHandler } from "graphql-sse/lib/use/http";

import {
  errorMasker,
  isSse,
  maskOperation,
  type HttpOptions,
  type Servable
} from "./core.js";

/**
 * GraphQL over HTTP for Node's request/response pair: `node:http`, Express,
 * Connect, Koa's `ctx.req`/`ctx.res`, Fastify's `request.raw`/`reply.raw`.
 * The same URL also serves subscriptions as server-sent events.
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
  return (req, res) => {
    const token = req.headers["x-graphql-event-stream-token"];
    return isSse({
      method: req.method ?? "GET",
      accept: req.headers.accept,
      token: Array.isArray(token) ? token[0] : token
    })
      ? sse(req, res)
      : http(req, res);
  };
}
