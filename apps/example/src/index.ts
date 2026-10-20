import { mw, olio } from "@nxlab/olio";
import { loadModules } from "@nxlab/tools";

import { directives } from "./directives.js";
import { auditLog, requestLogger, requireAuth } from "./middleware.js";

const middleware = mw({
  "*": {
    "*": [requestLogger()]
  },
  Query: {
    "*": [requireAuth()]
  },
  Mutation: {
    "*": [requireAuth(), auditLog()]
  }
});

export const app = olio({
  middleware,
  // Every modules/<id>/index.ts, the same folders codegen reads.
  modules: await loadModules(
    new URL("modules/*/index.{js,ts}", import.meta.url)
  ),
  directives
});
