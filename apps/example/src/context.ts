import type { Context, SubscriptionContext } from "@nxlab/olio";

import { container } from "./di.js";
import { viewerFor } from "./modules/auth/store.js";
import { pubsub } from "./pubsub.js";

let requests = 0;

/**
 * A request's context, from its bearer token, with a DI scope for this
 * operation. This is what an HTTP adapter does per request; `main.ts` calls
 * it directly. Dispose `ctx.di` when the operation ends (`onOperationEnd`).
 */
export function createContext(token?: string): Context {
  requests += 1;
  const request = {
    requestId: `req-${requests}`,
    viewer: token ? viewerFor(token) : undefined,
    pubsub
  };
  return { ...request, di: container.scope(request) };
}

export function createSubscriptionContext(
  connectionId: string,
  token?: string
): SubscriptionContext {
  return { ...createContext(token), connectionId };
}
