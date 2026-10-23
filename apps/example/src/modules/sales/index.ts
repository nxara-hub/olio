import { module, mw, type MiddlewareFn } from "@nxlab/olio";
import { loadFeatures } from "@nxlab/tools";

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
  features: await loadFeatures(new URL("*/index.{js,ts}", import.meta.url))
});
