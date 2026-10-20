import { mutation } from "@nxlab/olio";

import { store } from "../store.js";

export const Mutation = mutation.users({
  setRole: (_root, { id, role }) => {
    const user = store.get(id);
    if (!user) return null;
    user.role = role;
    return user;
  }
});
