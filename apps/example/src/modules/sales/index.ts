import { module } from "@nxlab/olio";
import { loadResolvers, loadTypeDefs } from "@nxlab/tools";

import { middleware as customers } from "./customers/middleware.js";
import { middleware as orders } from "./orders/middleware.js";

/**
 * One module, split by feature: customers/ and orders/ each bring their own
 * SDL, resolvers and middleware. The globs pick up every feature folder; to
 * add one, add a folder and list its middleware here.
 */
export const salesModule = module.sales({
  typeDefs: await loadTypeDefs(new URL("**/typedefs/*.gql", import.meta.url)),
  resolvers: await loadResolvers(
    new URL("**/{query,mutation,subscription}.{js,ts}", import.meta.url),
    new URL("**/resolvers/*.{js,ts}", import.meta.url)
  ),
  middleware: [customers, orders]
});
