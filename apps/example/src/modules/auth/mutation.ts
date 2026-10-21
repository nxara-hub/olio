import { mutation } from "@nxlab/olio";

import { signIn, signOut } from "./store.js";

export const Mutation = mutation.auth({
  // A wrong password is a result, not an exception: the client gets a typed
  // InvalidCredentials it can show.
  login: (_root, { email, password }) =>
    signIn(email, password) ?? {
      __typename: "InvalidCredentials",
      message: "Wrong email or password"
    },
  logout: (_root, _args, ctx) =>
    ctx.viewer ? signOut(ctx.viewer.token) : false
});
