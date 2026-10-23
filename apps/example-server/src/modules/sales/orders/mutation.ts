import { mutation } from "@nxlab/olio";

import { clientError } from "../../../errors.js";
import { onHand, productBySku, takeStock } from "../../inventory/service.js";
import { customers, nextOrderNumber, orders } from "../store.js";

export const Mutation = mutation.sales.orders({
  placeOrder: (_root, { customerId, lines }, ctx) => {
    if (!customers.has(customerId)) {
      throw clientError("BAD_USER_INPUT", `Unknown customer "${customerId}"`);
    }
    // Check every line before touching stock, so an order is all or nothing.
    for (const { sku, quantity } of lines) {
      const available = onHand(sku);
      if (quantity > available) {
        return {
          __typename: "InsufficientStock",
          message: `Only ${available} × ${sku} in stock`,
          sku,
          requested: quantity,
          available
        };
      }
    }
    for (const { sku, quantity } of lines) takeStock(sku, quantity, ctx.pubsub);

    const now = new Date();
    const order = {
      id: `o${orders.size + 1}`,
      number: nextOrderNumber(),
      customerId,
      status: "confirmed" as const,
      lines: lines.map(({ sku, quantity }) => ({
        sku,
        quantity,
        unitPriceCents: productBySku(sku).priceCents
      })),
      createdAt: now,
      updatedAt: now
    };
    orders.set(order.id, order);
    return order;
  },

  cancelOrder: (_root, { id }) => {
    const order = orders.get(id);
    if (!order) return null;
    order.status = "cancelled";
    order.updatedAt = new Date();
    return order;
  }
});
