import type { IncomingMessage, ServerResponse } from "node:http";

import { createHandler } from "graphql-http/lib/use/http";
import { createHandler as createSseHandler } from "graphql-sse/lib/use/http";

import {
  contextFailure,
  errorMasker,
  guardContext,
  isSse,
  maskOperation,
  operationEnd,
  sseFailure,
  type HttpOptions,
  type Servable
} from "./core.js";

/**
 * Koa: pass `ctx.req`/`ctx.res`; Fastify: `request.raw`/`reply.raw`. The same
 * URL also serves subscriptions as server-sent events (`Accept: text/event-stream`).
 */
export function nodeHandler(
  app: Servable,
  options: HttpOptions<IncomingMessage> = {}
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const mask = errorMasker(options);
  const { context } = options;
  const end = operationEnd(mask, options.onOperationEnd);
  // Kept per request, so `onOperationEnd` can run after the response.
  const contexts = new WeakMap<IncomingMessage, unknown>();
  const subscriptionContext = guardContext(
    mask,
    options.subscriptionContext ?? context
  );
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
  const sse = createSseHandler({
    schema: app.schema,
    context: subscriptionContext
      ? (req) => subscriptionContext(req.raw) as never
      : undefined,
    onOperation: (_ctx, _req, _args, result) => maskOperation(mask, result),
    onNext: (_ctx, _req, result) => mask.result(result as never) as never,
    onComplete: (ctx) => end(ctx as never)
  });
  return async (req, res) => {
    const header = req.headers["x-graphql-event-stream-token"];
    const signals = {
      method: req.method ?? "GET",
      accept: req.headers.accept,
      token: Array.isArray(header) ? header[0] : header
    };
    if (!isSse(signals)) {
      await http(req, res);
      await end(contexts.get(req) as never);
      return;
    }
    try {
      await sse(req, res);
    } catch (error) {
      if (res.headersSent) throw error;
      const failure = sseFailure(
        mask,
        error,
        !signals.token && signals.method !== "PUT"
      );
      res.writeHead(failure.status, failure.headers).end(failure.body);
    }
  };
}
