import { resolvers } from "@nxlab/olio";

import { money } from "../../core/money.js";
import { onHand } from "../service.js";
import { stock, warehouses } from "../store.js";

// `row` is a ProductRow: id, sku, name and the timestamps resolve by default.
export const Product = resolvers.inventory.Product({
  price: (row) => money(row.priceCents, row.currency),
  stock: (row) =>
    warehouses.map((warehouse) => ({
      warehouse,
      quantity: stock.get(row.sku)?.get(warehouse.code) ?? 0
    })),
  onHand: (row) => onHand(row.sku)
});
