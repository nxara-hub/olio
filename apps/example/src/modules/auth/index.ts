import { module, mw, type MiddlewareFn } from "@nxlab/olio";
import { loadResolvers, loadTypeDefs } from "@nxlab/tools";

import { requestLogger } from "../../middleware.js";

/** At most `max` login attempts per email per process; enough for a demo. */
const rateLimit = (max: number): MiddlewareFn => {
  const attempts = new Map<string, number>();
  return ({ args }, next) => {
    const email = String(args.email);
    const count = (attempts.get(email) ?? 0) + 1;
    attempts.set(email, count);
    if (count > max) throw new Error("Too many login attempts");
    return next();
  };
};

export const authModule = module.auth({
  typeDefs: await loadTypeDefs(new URL("typedefs/*.gql", import.meta.url)),
  resolvers: await loadResolvers(
    new URL("{query,mutation}.{js,ts}", import.meta.url),
    new URL("resolvers/*.{js,ts}", import.meta.url)
  ),
  // "-" drops every layer above (the app's requireAuth, and its logger too),
  // so these two fields are public. Re-add what they should keep.
  middleware: mw.auth({
    Query: { "-me": [requestLogger()] },
    Mutation: { "-login": [requestLogger(), rateLimit(5)] }
  })
});
