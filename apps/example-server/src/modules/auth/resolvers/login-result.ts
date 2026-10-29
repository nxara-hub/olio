import { resolvers } from "@nxara/olio";

export const LoginResult = resolvers.auth.LoginResult({
  __resolveType: (result) =>
    "token" in result ? "Session" : "InvalidCredentials"
});
