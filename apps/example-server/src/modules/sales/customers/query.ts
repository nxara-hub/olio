import { query } from "@nxlab/olio";

import { customers } from "../store.js";

export const Query = query.sales.customers({
  customer: (_root, { id }) => customers.get(id) ?? null,
  customers: () => [...customers.values()]
});
