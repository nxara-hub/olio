import { mw, type MiddlewareFn } from "@nxlab/olio";

import { store } from "../store.js";

const requireAdmin =
  (): MiddlewareFn =>
  ({ ctx, info }, next) => {
    const role = ctx.userId ? store.get(ctx.userId)?.role : undefined;
    if (role !== "Admin") throw new Error(`Forbidden: ${info.fieldName}`);
    return next();
  };

// Middleware maps are module-wide: list the fields this feature owns.
export const middleware = mw.users({
  Query: {
    users: [requireAdmin()]
  },
  Mutation: {
    setRole: [requireAdmin()]
  }
});
