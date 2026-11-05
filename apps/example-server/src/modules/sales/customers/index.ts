import { feature } from "@nxara/olio";
import { loaders } from "@nxara/olio-tools";

import { middleware } from "./middleware.js";
import typeDefs from "./typedefs.generated.js";

const load = loaders(import.meta.dirname);

export const customers = feature.sales.customers({
  typeDefs,
  resolvers: await load.resolvers(
    "{query,mutation,subscription}.{js,ts}",
    "resolvers/*.{js,ts}"
  ),
  middleware
});
