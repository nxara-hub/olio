import { resolvers } from "@nxlab/olio";

export const Data = resolvers.auth.Data({
  __resolveType: (data) => data.__typename ?? null
});
