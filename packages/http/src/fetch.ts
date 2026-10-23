import { createHandler } from "graphql-http/lib/use/fetch";
import { createHandler as createSseHandler } from "graphql-sse/lib/use/fetch";

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

/** The same URL also serves subscriptions as server-sent events (`Accept: text/event-stream`). */
export function fetchHandler(
  app: Servable,
  options: HttpOptions<Request> = {}
): (request: Request) => Promise<Response> {
  const mask = errorMasker(options);
  const { context } = options;
  const end = operationEnd(mask, options.onOperationEnd);
  // Kept per request, so `onOperationEnd` can run after the response.
  const contexts = new WeakMap<Request, unknown>();
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
  return async (request) => {
    const signals = {
      method: request.method,
      accept: request.headers.get("accept"),
      token: request.headers.get("x-graphql-event-stream-token")
    };
    if (!isSse(signals)) {
      const response = await http(request);
      await end(contexts.get(request) as never);
      return response;
    }
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
