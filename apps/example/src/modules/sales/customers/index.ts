import { feature } from "@nxlab/olio";
import { loadResolvers, loadTypeDefs } from "@nxlab/tools";

import { middleware } from "./middleware.js";

/** A feature of sales: owns the fields its own SDL declares. */
export const customers = feature.sales.customers({
  typeDefs: await loadTypeDefs(new URL("typedefs/*.gql", import.meta.url)),
  resolvers: await loadResolvers(
    new URL("{query,mutation,subscription}.{js,ts}", import.meta.url),
    new URL("resolvers/*.{js,ts}", import.meta.url)
  ),
  middleware
});
