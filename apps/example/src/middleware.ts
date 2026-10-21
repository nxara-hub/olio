import type { Context, MiddlewareFn, SubscriptionContext } from "@nxlab/olio";

import { clientError } from "./errors.js";
import type { Role } from "./generated.js";

/** Runs on queries, mutations and subscriptions alike. */
type AnyFn = MiddlewareFn<Context | SubscriptionContext>;

/** One line per operation field: who called what, and how long it took. */
export const requestLogger =
  (): AnyFn =>
  async ({ ctx, info }, next) => {
    // ponytail: root fields only; nested fields would drown the log.
    if (info.path.prev) return next();
    const started = performance.now();
    try {
      return await next();
    } finally {
      const ms = (performance.now() - started).toFixed(1);
      const who = ctx.viewer?.id ?? "anonymous";
      console.log(
        `  [${ctx.requestId}] ${who} ${info.parentType.name}.${info.fieldName} ${ms}ms`
      );
    }
  };

export const requireAuth =
  (): AnyFn =>
  ({ ctx, info }, next) => {
    if (!ctx.viewer) {
      throw clientError("UNAUTHENTICATED", `Unauthorized: ${info.fieldName}`);
    }
    return next();
  };

export const requireRole =
  (...roles: Role[]): MiddlewareFn =>
  ({ ctx, info }, next) => {
    if (!ctx.viewer || !roles.includes(ctx.viewer.role)) {
      throw clientError(
        "FORBIDDEN",
        `Forbidden: ${info.fieldName} needs ${roles.join(" or ")}`
      );
    }
    return next();
  };

export const auditLog =
  (): MiddlewareFn =>
  ({ ctx, info }, next) => {
    console.log(
      `  [${ctx.requestId}] audit ${ctx.viewer?.id} → ${info.fieldName}`
    );
    return next();
  };
