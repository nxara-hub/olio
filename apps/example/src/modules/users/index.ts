import { module } from "@nxlab/olio";
import { loadResolvers, loadTypeDefs } from "@nxlab/tools";

import { middleware as admin } from "./admin/middleware.js";
import { middleware as profile } from "./profile/middleware.js";

/**
 * One module, split by feature. `typedefs/` and `resolvers/` at the root hold
 * the shared core; each feature folder (profile/, admin/) adds its own SDL,
 * resolvers and middleware. To add a feature, add a folder and register its
 * middleware below. Globs pick up everything else.
 */
export const usersModule = module.users({
  typeDefs: await loadTypeDefs(
    new URL("**/typedefs/*.{gql,ts,js}", import.meta.url)
  ),
  resolvers: await loadResolvers(
    new URL("**/{query,mutation,subscription}.{js,ts}", import.meta.url),
    new URL("**/resolvers/*.{js,ts}", import.meta.url)
  ),
  middleware: [profile, admin]
});
