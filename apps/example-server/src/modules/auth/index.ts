import { module, mw, type MiddlewareFn } from "@nxlab/olio";
import { loadResolvers, loadTypeDefs } from "@nxlab/tools";

import { clientError } from "../../errors.js";

/** At most `max` login attempts per email per process; enough for a demo. */
const rateLimit = (max: number): MiddlewareFn => {
  const attempts = new Map<string, number>();
  return ({ args }, next) => {
    const email = String(args.email);
    const count = (attempts.get(email) ?? 0) + 1;
    attempts.set(email, count);
    if (count > max) {
      throw clientError("TOO_MANY_REQUESTS", "Too many login attempts");
    }
    return next();
  };
};

export const authModule = module.auth({
  typeDefs: await loadTypeDefs(new URL("typedefs/*.gql", import.meta.url)),
  resolvers: await loadResolvers(
    new URL("{query,mutation}.{js,ts}", import.meta.url),
    new URL("resolvers/*.{js,ts}", import.meta.url)
  ),
  // me and login are public through @bypass in auth.gql; login gets a limit.
  middleware: mw.auth({ Mutation: { login: [rateLimit(5)] } })
});
