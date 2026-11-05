import { module, mw } from "@nxara/olio";
import { loaders } from "@nxara/olio-tools";

import { requireRole } from "../../middleware.js";
import typeDefs from "./typedefs.generated.js";

const load = loaders(import.meta.dirname);

export const inventoryModule = module.inventory({
  typeDefs,
  resolvers: await load.resolvers(
    "{query,mutation,subscription}.{js,ts}",
    "resolvers/*.{js,ts}"
  ),
  // Runs after the app's requireAuth and auditLog.
  middleware: mw.inventory({
    Mutation: { adjustStock: [requireRole("MANAGER", "ADMIN")] }
  })
});
