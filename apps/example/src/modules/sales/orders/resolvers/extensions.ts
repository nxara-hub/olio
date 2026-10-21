import { resolvers } from "@nxlab/olio";

import { orders } from "../../store.js";

const confirmed = () =>
  [...orders.values()].filter((o) => o.status === "CONFIRMED");

// Fields sales adds to other types: Product belongs to inventory, Customer to
// the customers feature. Each module resolves only the fields it declares.
export const Product = resolvers.sales.Product({
  unitsSold: (row) =>
    confirmed()
      .flatMap((o) => o.lines)
      .filter((l) => l.sku === row.sku)
      .reduce((sum, l) => sum + l.quantity, 0)
});

export const Customer = resolvers.sales.Customer({
  orders: (row) => [...orders.values()].filter((o) => o.customerId === row.id)
});
