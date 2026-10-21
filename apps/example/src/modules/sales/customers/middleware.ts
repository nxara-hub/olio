import { mw } from "@nxlab/olio";

import { requireRole } from "../../../middleware.js";

// Customer.email has no resolver: naming it here wraps the default one, so
// clerks get null plus an error, without writing a resolver just for that.
export const middleware = mw.sales.customers({
  Customer: { email: [requireRole("MANAGER", "ADMIN")] }
});
