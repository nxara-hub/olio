import { resolvers } from "@nxlab/olio";

import { money } from "../../../core/money.js";
import { productBySku } from "../../../inventory/service.js";
import { customers, orderTotal } from "../../store.js";

export const SalesOrder = resolvers.sales.orders.SalesOrder({
  customer: (order) => {
    const customer = customers.get(order.customerId);
    if (!customer) throw new Error(`Order ${order.number} has no customer`);
    return customer;
  },
  lines: (order) =>
    order.lines.map((line) => ({
      product: productBySku(line.sku),
      quantity: line.quantity,
      unitPrice: money(line.unitPriceCents),
      lineTotal: money(line.quantity * line.unitPriceCents)
    })),
  total: (order) => money(orderTotal(order))
});

export const PlaceOrderResult = resolvers.sales.orders.PlaceOrderResult({
  __resolveType: (result) =>
    "number" in result ? "SalesOrder" : "InsufficientStock"
});
