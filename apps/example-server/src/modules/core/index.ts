import { module } from "@nxara/olio";
import { loaders } from "@nxara/olio-tools";

import typeDefs from "./typedefs.generated.js";

const load = loaders(import.meta.dirname);

export const coreModule = module.core({
  typeDefs,
  resolvers: await load.resolvers("resolvers/*.{js,ts}")
});
