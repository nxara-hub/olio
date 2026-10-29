import { resolvers } from "@nxara/olio";

import { money } from "../../../core/money.js";

export const Customer = resolvers.sales.customers.Customer({
  creditLimit: (row) => money(row.creditLimitCents)
});
