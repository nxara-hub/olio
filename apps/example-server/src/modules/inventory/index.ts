import { module, mw } from "@nxara/olio";
import { loaders } from "@nxara/olio-tools";

import { requireRole } from "../../middleware.js";

const load = loaders(import.meta.dirname);

export const inventoryModule = module.inventory({
  typeDefs: await load.typeDefs("typedefs/*.gql"),
  resolvers: await load.resolvers(
    "{query,mutation,subscription}.{js,ts}",
    "resolvers/*.{js,ts}"
  ),
  // Runs after the app's requireAuth and auditLog.
  middleware: mw.inventory({
    Mutation: { adjustStock: [requireRole("MANAGER", "ADMIN")] }
  })
});
