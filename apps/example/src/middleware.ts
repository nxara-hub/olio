import type { Context, MiddlewareFn, SubscriptionContext } from "@nxlab/olio";

import { clientError } from "./errors.js";
import type { Role } from "./generated.js";

type AnyOperationFn = MiddlewareFn<Context | SubscriptionContext>;

export const requestLogger =
  (): AnyOperationFn =>
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
  (): AnyOperationFn =>
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
