import type { IncomingMessage } from "node:http";

import type { ExecutionResult } from "graphql";
import { useServer } from "graphql-ws/use/ws";
import type { WebSocketServer } from "ws";

import {
  errorMasker,
  guardContext,
  type Servable,
  type SubscriptionOptions
} from "./core.js";

/**
 * Subscriptions over WebSocket (the graphql-ws protocol) on a `ws` server,
 * for any Node HTTP server: `node:http`, Hono's `@hono/node-server`, Express.
 * Returns a function that shuts the server down.
 *
 * ```ts
 * wsServer(app, new WebSocketServer({ server, path: "/graphql" }), {
 *   context: ({ request, connectionParams }) => createSubscriptionContext(...)
 * });
 * ```
 */
export function wsServer(
  app: Servable,
  server: WebSocketServer,
  options: SubscriptionOptions<IncomingMessage> = {}
): () => Promise<void> {
  const mask = errorMasker(options);
  const context = guardContext(mask, options.context);
  const { dispose } = useServer(
    {
      schema: app.schema,
      context: context
        ? (ctx) =>
            context({
              request: ctx.extra.request,
              connectionParams: ctx.connectionParams
            }) as never
        : undefined,
      onNext: (_ctx, _id, _payload, _args, result) =>
        mask.result(result as ExecutionResult) as never,
      // A subscription that fails while starting is reported here instead.
      onError: (_ctx, _id, _payload, errors) =>
        errors.map((e) => mask.error(e).toJSON())
    },
    server
  );
  return async () => {
    await dispose();
  };
}
