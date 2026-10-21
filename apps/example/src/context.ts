import type { Context, SubscriptionContext } from "@nxlab/olio";

import { viewerFor } from "./modules/auth/store.js";
import { pubsub } from "./pubsub.js";

let requests = 0;

/**
 * A request's context, from its bearer token. This is what an HTTP adapter
 * does per request; `main.ts` calls it directly.
 */
export function createContext(token?: string): Context {
  requests += 1;
  return {
    requestId: `req-${requests}`,
    viewer: token ? viewerFor(token) : undefined,
    pubsub
  };
}

export function createSubscriptionContext(
  connectionId: string,
  token?: string
): SubscriptionContext {
  return { ...createContext(token), connectionId };
}
