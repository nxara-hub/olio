import { query } from "@nxlab/olio";

export const Query = query.auth({
  login: (_root, { input }) => ({
    __typename: "A",
    dataA: `token-for-${input.email}`
  })
});
