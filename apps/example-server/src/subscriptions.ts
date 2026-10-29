import { errorMasker, validateOperation } from "@nxlab/http";
import type { SubscriptionContext } from "@nxlab/olio";
import { createHandler } from "graphql-sse/lib/use/fetch";
import type { ServerOptions } from "graphql-ws";
import { useServer } from "graphql-ws/use/ws";
import type { WebSocketServer } from "ws";

import { createSubscriptionContext } from "./context.js";
import { bearer } from "./http.js";
import { app } from "./index.js";
import { validationRules } from "./limits.js";

// @nxlab/http serves GraphQL over HTTP only; subscriptions are the app's own,
// on the reference libraries. Both transports hide unexpected errors the way
// the HTTP handler does, and dispose each operation's DI scope once it ends.
const mask = errorMasker<SubscriptionContext>();
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
  onNext: (ctx, _req, result) =>
    mask.result(result, ctx as unknown as SubscriptionContext),
  onComplete: (ctx) => (ctx as unknown as SubscriptionContext).di.dispose()
});

const live = new WeakMap<object, Map<string, SubscriptionContext>>();
const end = async (connection: object, id: string): Promise<void> => {
  const contexts = live.get(connection);
  const ctx = contexts?.get(id);
  contexts?.delete(id);
  await ctx?.di.dispose();
};

/** Subscriptions over WebSocket (graphql-ws); tests run the same through `testClient`. */
export const wsOptions: ServerOptions<Record<string, unknown> | undefined> = {
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
    const contexts = live.get(ctx) ?? new Map<string, SubscriptionContext>();
    contexts.set(id, value);
    live.set(ctx, contexts);
    return value as never;
  },
  onSubscribe: (_ctx, _id, payload) => {
    const errors = validateOperation(app.schema, payload, validationRules);
    return errors.length ? errors : undefined;
  },
  onNext: (ctx, id, _payload, _args, result) =>
    mask.result(result, live.get(ctx)?.get(id)),
  // A subscription that fails while starting is reported here instead.
  onError: (ctx, id, _payload, errors) =>
    errors.map((e) => mask.error(e, live.get(ctx)?.get(id)).toJSON()),
  // Also when the socket closes mid-subscription: graphql-ws ends each one
  // first (as long as its source can end right away, see src/pubsub.ts).
  onComplete: (ctx, id) => end(ctx, id)
};

/** `wsOptions` on a `ws` server. */
export function serveWebSockets(server: WebSocketServer): void {
  useServer(wsOptions, server);
}
