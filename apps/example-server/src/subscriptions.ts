import { errorMasker, validateOperation } from "@nxlab/http";
import type { SubscriptionContext } from "@nxlab/olio";
import { createHandler } from "graphql-sse/lib/use/fetch";
import { useServer } from "graphql-ws/use/ws";
import type { WebSocketServer } from "ws";

import { createSubscriptionContext } from "./context.js";
import { bearer } from "./http.js";
import { app } from "./index.js";
import { validationRules } from "./limits.js";

// @nxlab/http serves GraphQL over HTTP only; subscriptions are the app's own,
// on the reference libraries. Both transports hide unexpected errors the way
// the HTTP handler does, and dispose each operation's DI scope once it ends.
const mask = errorMasker();
let connections = 0;
const connectionId = (kind: string): string => `${kind}-${++connections}`;

/** Server-sent events on the same URL: requests with `Accept: text/event-stream`. */
export const sseHandler = createHandler({
  schema: app.schema,
  context: (req) =>
    createSubscriptionContext(
      connectionId("sse"),
      bearer(req.raw.headers.get("authorization"))
    ) as never,
  // The HTTP handler's rules, so a subscription can't cost more than a query.
  onSubscribe: (_req, params) => {
    const errors = validateOperation(app.schema, params, validationRules);
    // graphql-sse reads it as a result only with `data`.
    return errors.length ? { data: null, errors: [...errors] } : undefined;
  },
  onNext: (_ctx, _req, result) => mask.result(result),
  onComplete: (ctx) => (ctx as unknown as SubscriptionContext).di.dispose()
});

/** Subscriptions over WebSocket (graphql-ws), on a `ws` server. */
export function serveWebSockets(server: WebSocketServer): void {
  const live = new WeakMap<object, Map<string, SubscriptionContext>>();
  const end = async (connection: object, id: string): Promise<void> => {
    const contexts = live.get(connection);
    const ctx = contexts?.get(id);
    contexts?.delete(id);
    await ctx?.di.dispose();
  };
  useServer(
    {
      schema: app.schema,
      // Browsers can't set headers on a WebSocket, so @nxlab/client sends its
      // headers as connectionParams: { headers: { authorization } }.
      context: (ctx, id) => {
        const headers = ctx.connectionParams?.headers as
          | Record<string, string>
          | undefined;
        const value = createSubscriptionContext(
          connectionId("ws"),
          bearer(headers?.authorization)
        );
        const contexts =
          live.get(ctx) ?? new Map<string, SubscriptionContext>();
        contexts.set(id, value);
        live.set(ctx, contexts);
        return value as never;
      },
      onSubscribe: (_ctx, _id, payload) => {
        const errors = validateOperation(app.schema, payload, validationRules);
        return errors.length ? errors : undefined;
      },
      onNext: (_ctx, _id, _payload, _args, result) => mask.result(result),
      // A subscription that fails while starting is reported here instead.
      onError: (_ctx, _id, _payload, errors) =>
        errors.map((e) => mask.error(e).toJSON()),
      onComplete: (ctx, id) => end(ctx, id),
      // A socket that closes mid-subscription never completes it.
      onClose: async (ctx) => {
        const ids = [...(live.get(ctx)?.keys() ?? [])];
        await Promise.all(ids.map((id) => end(ctx, id)));
      }
    },
    server
  );
}
