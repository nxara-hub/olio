import { query } from "@nxlab/olio";

import { store } from "../store.js";

export const Query = query.users({
  user: (_root, { id }) => store.get(id) ?? null
});
