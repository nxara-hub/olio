import { resolvers } from "@nxara/olio";

import { orders } from "../../store.js";

const confirmed = () =>
  [...orders.values()].filter((o) => o.status === "confirmed");

// Fields orders adds to other types: Product belongs to the inventory module,
// Customer to the customers feature. Each module and feature resolves only
// the fields it declares.
export const Product = resolvers.sales.orders.Product({
  unitsSold: (row) =>
    confirmed()
      .flatMap((o) => o.lines)
      .filter((l) => l.sku === row.sku)
      .reduce((sum, l) => sum + l.quantity, 0)
});

export const Customer = resolvers.sales.orders.Customer({
  orders: (row) => [...orders.values()].filter((o) => o.customerId === row.id)
});
