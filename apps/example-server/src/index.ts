import { mw, olio } from "@nxara/olio";
import { loaders } from "@nxara/olio-tools";

import { directives } from "./directives.js";
import { auditLog, requestLogger, requireAuth } from "./middleware.js";

// Application-wide layers. Modules add their own below these. A field opts out
// of requireAuth or auditLog with @bypass in its SDL (see modules/auth).
const load = loaders(import.meta.dirname);

const middleware = mw({
  "*": { "*": [requestLogger()] },
  Query: { "*": [requireAuth()] },
  Mutation: { "*": [requireAuth(), auditLog()] },
  Subscription: { "*": [requireAuth()] }
});

export const app = olio({
  middleware,
  // Every modules/<id>/index.ts: the same folders codegen reads.
  modules: await load.modules("modules/*/index.{js,ts}"),
  directives
});
