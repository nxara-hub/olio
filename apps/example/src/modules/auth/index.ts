import { module, mw } from "@nxlab/olio";
import { loadResolvers, loadTypeDefs } from "@nxlab/tools";

import { requestLogger } from "../../middleware.js";

// Login is public: "-login" drops the inherited app layers (requireAuth), so
// only what is listed here runs.
const middleware = mw.auth({
  Query: {
    "-login": [requestLogger()]
  }
});

export const authModule = module.auth({
  typeDefs: await loadTypeDefs(new URL("typedefs/*.gql", import.meta.url)),
  resolvers: await loadResolvers(
    new URL("{query,mutation,subscription}.{js,ts}", import.meta.url),
    new URL("resolvers/*.{js,ts}", import.meta.url)
  ),
  middleware
});
