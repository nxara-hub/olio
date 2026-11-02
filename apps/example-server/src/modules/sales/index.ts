import { module, mw, type MiddlewareFn } from "@nxara/olio";
import { loaders } from "@nxara/olio-tools";

const load = loaders(import.meta.dirname);

const journal =
  (): MiddlewareFn =>
  ({ ctx, info }, next) => {
    console.log(`  [${ctx.requestId}] sales journal → ${info.fieldName}`);
    return next();
  };

// Module-wide: runs on every feature's fields, between the app's layers and
// the feature's own.
export const salesModule = module.sales({
  middleware: mw.sales({ Mutation: { "*": [journal()] } }),
  features: await load.features("*/index.{js,ts}")
});
