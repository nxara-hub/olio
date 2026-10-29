import { module } from "@nxara/olio";
import { loadResolvers, loadTypeDefs } from "@nxara/olio-tools";

export const coreModule = module.core({
  typeDefs: await loadTypeDefs(new URL("typedefs/*.gql", import.meta.url)),
  resolvers: await loadResolvers(
    new URL("resolvers/*.{js,ts}", import.meta.url)
  )
});
