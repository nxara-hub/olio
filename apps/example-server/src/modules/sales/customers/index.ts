import { feature } from "@nxara/olio";
import { loadResolvers, loadTypeDefs } from "@nxara/olio-tools";

import { middleware } from "./middleware.js";

export const customers = feature.sales.customers({
  typeDefs: await loadTypeDefs(new URL("typedefs/*.gql", import.meta.url)),
  resolvers: await loadResolvers(
    new URL("{query,mutation,subscription}.{js,ts}", import.meta.url),
    new URL("resolvers/*.{js,ts}", import.meta.url)
  ),
  middleware
});
