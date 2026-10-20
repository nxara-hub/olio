import { query } from "@nxlab/olio";

import { store } from "../store.js";

export const Query = query.users({
  users: () => {
    const data = [...store.values()];
    return {
      data,
      totalDocs: data.length,
      limit: data.length,
      page: 1,
      totalPages: 1,
      nextPage: null,
      prevPage: null,
      pagingCounter: 1,
      hasPrevPage: false,
      hasNextPage: false,
      abd: null
    };
  }
});
