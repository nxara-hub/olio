import { feature } from "@nxlab/olio";
import { loadResolvers, loadTypeDefs } from "@nxlab/tools";

import { OrderStatus } from "./enums.js";
import { middleware } from "./middleware.js";

export const orders = feature.sales.orders({
  typeDefs: await loadTypeDefs(new URL("typedefs/*.gql", import.meta.url)),
  resolvers: await loadResolvers(
    new URL("{query,mutation,subscription}.{js,ts}", import.meta.url),
    new URL("resolvers/*.{js,ts}", import.meta.url)
  ),
  enums: { OrderStatus },
  middleware
});
