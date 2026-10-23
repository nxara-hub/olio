import { fetchHandler } from "@nxlab/http/fetch";

import { createContext, createSubscriptionContext } from "./context.js";
import { app } from "./index.js";

const bearer = (header: string | null): string | undefined =>
  header?.match(/^Bearer (.+)$/)?.[1];

let streams = 0;

// Apart from server.ts, so tests can call it in-process (testClient).
export const graphqlHandler = fetchHandler(app, {
  context: (request) =>
    createContext(bearer(request.headers.get("authorization"))),
  subscriptionContext: (request) => {
    streams += 1;
    return createSubscriptionContext(
      `sse-${streams}`,
      bearer(request.headers.get("authorization"))
    );
  },
  // Each operation's DI scope (DataLoaders, …) is disposed once it's done.
  onOperationEnd: (ctx) => ctx.di.dispose()
});
