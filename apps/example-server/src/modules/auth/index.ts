import { module, mw, type MiddlewareFn } from "@nxara/olio";
import { loaders } from "@nxara/olio-tools";

import { clientError } from "../../errors.js";
import typeDefs from "./typedefs.generated.js";

const load = loaders(import.meta.dirname);

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
  typeDefs,
  resolvers: await load.resolvers(
    "{query,mutation}.{js,ts}",
    "resolvers/*.{js,ts}"
  ),
  // me and login are public through @bypass in auth.gql; login gets a limit.
  middleware: mw.auth({ Mutation: { login: [rateLimit(5)] } })
});
