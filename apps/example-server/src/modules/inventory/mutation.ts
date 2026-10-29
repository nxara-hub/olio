import { mutation } from "@nxara/olio";

import { adjustStock } from "./service.js";

export const Mutation = mutation.inventory({
  adjustStock: (_root, args, ctx) => adjustStock(args, ctx.pubsub)
});
