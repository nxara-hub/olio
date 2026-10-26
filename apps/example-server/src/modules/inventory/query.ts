import { query } from "@nxlab/olio";

import { products } from "./store.js";

export const Query = query.inventory({
  product: (_root, { sku }) => products.get(sku) ?? null,
  products: {
    // A page costs its size times what each item selects (src/limits.ts).
    extensions: {
      complexity: ({ args, childComplexity }) =>
        (args.filter?.pageSize ?? 20) * childComplexity
    },
    resolve: (_root, { filter }) => {
      const page = filter?.page ?? 1;
      const pageSize = filter?.pageSize ?? 20;
      const search = filter?.search?.toLowerCase();
      const matching = [...products.values()].filter(
        (p) =>
          !search ||
          p.sku.toLowerCase().includes(search) ||
          p.name.toLowerCase().includes(search)
      );
      const start = (page - 1) * pageSize;
      return {
        pageInfo: {
          page,
          pageSize,
          total: matching.length,
          hasNextPage: start + pageSize < matching.length
        },
        items: matching.slice(start, start + pageSize)
      };
    }
  }
});
