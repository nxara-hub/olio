import { fetchHandler } from "@nxlab/http/fetch";

import { createContext } from "./context.js";
import { app } from "./index.js";
import { validationRules } from "./limits.js";

export const bearer = (header: string | null | undefined): string | undefined =>
  header?.match(/^Bearer (.+)$/)?.[1];

// Apart from server.ts, so tests can call it in-process (testClient).
export const graphqlHandler = fetchHandler(app, {
  context: (request) =>
    createContext(bearer(request.headers.get("authorization"))),
  validationRules,
  // Each operation's DI scope (DataLoaders, …) is disposed once it's done.
  onOperationEnd: (ctx) => ctx.di.dispose()
});
