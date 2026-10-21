import { subscription } from "@nxlab/olio";

export const Subscription = subscription.inventory({
  // Yields Product values (ProductRow, via mappers); filter right here.
  async *stockChanged(_root, { sku }, ctx) {
    for await (const row of ctx.pubsub.subscribe("stock:changed")) {
      if (!sku || row.sku === sku) yield row;
    }
  }
});
