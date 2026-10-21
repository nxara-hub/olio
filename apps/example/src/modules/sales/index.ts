import { module, mw, type MiddlewareFn } from "@nxlab/olio";
import { loadFeatures } from "@nxlab/tools";

/** Every change in sales lands in the sales journal, whichever feature made it. */
const journal =
  (): MiddlewareFn =>
  ({ ctx, info }, next) => {
    console.log(`  [${ctx.requestId}] sales journal → ${info.fieldName}`);
    return next();
  };

/**
 * One module, split into features: customers/ and orders/ each own their SDL,
 * resolvers and middleware (see their index.ts). Middleware here is
 * module-wide: it runs on every feature's fields, between the app's layers
 * and the feature's own.
 */
export const salesModule = module.sales({
  middleware: mw.sales({ Mutation: { "*": [journal()] } }),
  features: await loadFeatures(new URL("*/index.{js,ts}", import.meta.url))
});
