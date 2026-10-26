import { subscription } from "@nxlab/olio";

export const Subscription = subscription.inventory({
  // The pubsub's own iterator, not an `async *` around it: one waiting for an
  // event can't be ended until the next one, and graphql-ws waits for that
  // before running onComplete and onClose (see src/pubsub.ts).
  stockChanged: (_root, { sku }, ctx) =>
    ctx.pubsub.subscribe("stock:changed", (row) => !sku || row.sku === sku)
});
