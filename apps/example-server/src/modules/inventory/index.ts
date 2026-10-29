import { module, mw } from "@nxara/olio";
import { loadResolvers, loadTypeDefs } from "@nxara/olio-tools";

import { requireRole } from "../../middleware.js";

export const inventoryModule = module.inventory({
  typeDefs: await loadTypeDefs(new URL("typedefs/*.gql", import.meta.url)),
  resolvers: await loadResolvers(
    new URL("{query,mutation,subscription}.{js,ts}", import.meta.url),
    new URL("resolvers/*.{js,ts}", import.meta.url)
  ),
  // Runs after the app's requireAuth and auditLog.
  middleware: mw.inventory({
    Mutation: { adjustStock: [requireRole("MANAGER", "ADMIN")] }
  })
});
