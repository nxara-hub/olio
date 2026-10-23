import { mw, olio } from "@nxlab/olio";
import { loadModules } from "@nxlab/tools";

import { directives } from "./directives.js";
import { auditLog, requestLogger, requireAuth } from "./middleware.js";

// Application-wide layers. Modules add their own below these, and can opt a
// field out with a "-" key (see modules/auth).
const middleware = mw({
  "*": { "*": [requestLogger()] },
  Query: { "*": [requireAuth()] },
  Mutation: { "*": [requireAuth(), auditLog()] },
  Subscription: { "*": [requireAuth()] }
});

export const app = olio({
  middleware,
  // Every modules/<id>/index.ts: the same folders codegen reads.
  modules: await loadModules(
    new URL("modules/*/index.{js,ts}", import.meta.url)
  ),
  directives
});
