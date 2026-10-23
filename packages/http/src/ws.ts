import type { IncomingMessage } from "node:http";

import type { ExecutionResult } from "graphql";
import { useServer } from "graphql-ws/use/ws";
import type { WebSocketServer } from "ws";

import {
  errorMasker,
  guardContext,
  operationEnd,
  type Servable,
  type SubscriptionOptions
} from "./core.js";

/** Returns a function that shuts the server down. */
export function wsServer(
  app: Servable,
  server: WebSocketServer,
  options: SubscriptionOptions<IncomingMessage> = {}
): () => Promise<void> {
  const mask = errorMasker(options);
  const context = guardContext(mask, options.context);
  const end = operationEnd(mask, options.onOperationEnd);
  const contextsByOperation = new WeakMap<object, Map<string, unknown>>();
  const finish = async (connection: object, id: string): Promise<void> => {
    const operations = contextsByOperation.get(connection);
    const ctx = operations?.get(id);
    operations?.delete(id);
    await end(ctx as never);
  };
  const { dispose } = useServer(
    {
      schema: app.schema,
      context: context
        ? async (ctx, id) => {
            const value = await context({
              request: ctx.extra.request,
              connectionParams: ctx.connectionParams
            });
            const operations =
              contextsByOperation.get(ctx) ?? new Map<string, unknown>();
            operations.set(id, value);
            contextsByOperation.set(ctx, operations);
            return value as never;
          }
        : undefined,
      onComplete: (ctx, id) => finish(ctx, id),
      // A socket that closes mid-operation never completes it.
      onClose: async (ctx) => {
        const ids = [...(contextsByOperation.get(ctx)?.keys() ?? [])];
        await Promise.all(ids.map((id) => finish(ctx, id)));
      },
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
