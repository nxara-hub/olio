import { operation, singleton } from "@nxlab/di";
import DataLoader from "dataloader";

import { clientError } from "../../errors.js";
import { products, type ProductRow } from "./store.js";

// ponytail: in-memory; a real app would hold a database pool here.
export const ProductStore = singleton(() => ({
  bySkus: (skus: readonly string[]) => skus.map((sku) => products.get(sku))
}));

// One loader per operation, so its cache never outlives the request, and an
// order's lines load their products in one call instead of one per line.
export const ProductLoader = operation(
  ({ get, ctx }) =>
    new DataLoader<string, ProductRow>(async (skus) => {
      console.log(
        `  [${ctx.requestId}] productLoader batch: ${skus.join(", ")}`
      );
      return get(ProductStore)
        .bySkus(skus)
        .map(
          (row, i) =>
            row ?? clientError("BAD_USER_INPUT", `Unknown product "${skus[i]}"`)
        );
    })
);
