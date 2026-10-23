import { module } from "@nxlab/olio";
import { loadResolvers, loadTypeDefs } from "@nxlab/tools";

export const coreModule = module.core({
  typeDefs: await loadTypeDefs(new URL("typedefs/*.gql", import.meta.url)),
  resolvers: await loadResolvers(
    new URL("resolvers/*.{js,ts}", import.meta.url)
  )
});
