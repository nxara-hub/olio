import { resolvers } from "@nxlab/olio";

export const LoginResult = resolvers.auth.LoginResult({
  __resolveType: (result) =>
    "token" in result ? "Session" : "InvalidCredentials"
});
