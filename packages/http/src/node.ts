import type { IncomingMessage, ServerResponse } from "node:http";

import { createHandler } from "graphql-http/lib/use/http";

import {
  contextFailure,
  errorMasker,
  operationEnd,
  type HttpOptions,
  type Servable
} from "./core.js";

/** GraphQL over HTTP for Node. Koa: pass `ctx.req`/`ctx.res`; Fastify: `request.raw`/`reply.raw`. */
export function nodeHandler(
  app: Servable,
  options: HttpOptions<IncomingMessage> = {}
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const mask = errorMasker(options);
  const { context } = options;
  const end = operationEnd(mask, options.onOperationEnd);
  // Kept per request, so `onOperationEnd` can run after the response.
  const contexts = new WeakMap<IncomingMessage, unknown>();
  const http = createHandler({
    schema: app.schema,
    context: context
      ? async (req) => {
          try {
            const ctx = await context(req.raw);
            contexts.set(req.raw, ctx);
            return ctx as never;
          } catch (error) {
            return contextFailure(mask, error);
          }
        }
      : undefined,
    onOperation: (_req, _args, result) => mask.result(result)
  });
  return async (req, res) => {
    await http(req, res);
    await end(contexts.get(req) as never);
  };
}
