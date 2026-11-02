import { module } from "@nxara/olio";
import { loaders } from "@nxara/olio-tools";

const load = loaders(import.meta.dirname);

export const coreModule = module.core({
  typeDefs: await load.typeDefs("typedefs/*.gql"),
  resolvers: await load.resolvers("resolvers/*.{js,ts}")
});
