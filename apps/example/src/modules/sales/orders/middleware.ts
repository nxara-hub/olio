import { mw } from "@nxlab/olio";

import { requireRole } from "../../../middleware.js";

export const middleware = mw.sales.orders({
  Mutation: { cancelOrder: [requireRole("MANAGER", "ADMIN")] }
});
