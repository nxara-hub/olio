import type { ExecutionResult } from "graphql";
import { makeHandler } from "graphql-ws/use/bun";

import {
  errorMasker,
  guardContext,
  operationEnd,
  type Servable,
  type SubscriptionOptions
} from "./core.js";

/** The part of Bun's `Server` this needs; any `Bun.serve()` result fits. */
interface BunServer {
  upgrade(request: Request, options?: object): boolean;
}

export function bunWebSocket(
  app: Servable,
  options: SubscriptionOptions<Request> = {}
): {
  /** Upgrades a graphql-ws request to a socket; false for anything else. */
  upgrade: (request: Request, server: BunServer) => boolean;
  websocket: ReturnType<typeof makeHandler>;
} {
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
  return {
    upgrade: (request, server) =>
      request.headers.get("upgrade")?.toLowerCase() === "websocket" &&
      server.upgrade(request, { data: { request } }),
    websocket: makeHandler({
      schema: app.schema,
      context: context
        ? async (ctx, id) => {
            const value = await context({
              // Bun keeps what upgrade() stored as the socket's data.
              request: (
                ctx.extra.socket.data as unknown as { request: Request }
              ).request,
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
    })
  };
}
