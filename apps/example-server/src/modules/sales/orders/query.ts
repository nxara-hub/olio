import { query } from "@nxara/olio";

import { orders } from "../store.js";

export const Query = query.sales.orders({
  orders: (_root, { status }) =>
    [...orders.values()].filter((o) => !status || o.status === status)
});
