import { query } from "@nxlab/olio";

import { employee } from "./store.js";

export const Query = query.auth({
  me: (_root, _args, ctx) => (ctx.viewer && employee(ctx.viewer.id)) ?? null
});
