import { resolvers } from "@nxara/olio";

import { money } from "../../../core/money.js";
import { customers, orderTotal } from "../../store.js";

export const SalesOrder = resolvers.sales.orders.SalesOrder({
  customer: (order) => {
    const customer = customers.get(order.customerId);
    if (!customer) throw new Error(`Order ${order.number} has no customer`);
    return customer;
  },
  lines: (order) => order.lines,
  total: (order) => money(orderTotal(order))
});

// OrderLine is mapped to the stored row; its product comes through the
// operation's DataLoader, so all lines of all orders share one batch.
export const OrderLine = resolvers.sales.orders.OrderLine({
  product: (line, _args, ctx) => ctx.di.productLoader.load(line.sku),
  unitPrice: (line) => money(line.unitPriceCents),
  lineTotal: (line) => money(line.quantity * line.unitPriceCents)
});

export const PlaceOrderResult = resolvers.sales.orders.PlaceOrderResult({
  __resolveType: (result) =>
    "number" in result ? "SalesOrder" : "InsufficientStock"
});
