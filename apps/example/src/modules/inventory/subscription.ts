import { subscription } from "@nxlab/olio";

export const Subscription = subscription.inventory({
  async *stockChanged(_root, { sku }, ctx) {
    for await (const row of ctx.pubsub.subscribe("stock:changed")) {
      if (!sku || row.sku === sku) yield row;
    }
  }
});
