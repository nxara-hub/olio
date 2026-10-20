import type { MiddlewareFn } from "@nxlab/olio";

export const requestLogger =
  (): MiddlewareFn =>
  async ({ ctx, info }, next) => {
    const started = performance.now();
    try {
      return await next();
    } finally {
      const ms = (performance.now() - started).toFixed(1);
      console.log(
        `[${ctx.req_id}] ${info.parentType.name}.${info.fieldName} ${ms}ms`
      );
    }
  };

export const requireAuth =
  (): MiddlewareFn =>
  ({ ctx, info }, next) => {
    if (!ctx.userId) throw new Error(`Unauthorized: ${info.fieldName}`);
    return next();
  };

export const auditLog =
  (): MiddlewareFn =>
  ({ ctx, info }, next) => {
    console.log(`[${ctx.req_id}] audit ${ctx.userId} → ${info.fieldName}`);
    return next();
  };
