import type { Fields } from "@nxlab/olio";

import { clientError } from "../../errors.js";
import type { PubSub } from "../../pubsub.js";
import { products, stock, warehouses, type ProductRow } from "./store.js";

// Inventory's API for other modules. Sales imports these directly: modules
// share code through plain imports, no container needed.

export function productBySku(sku: string): ProductRow {
  const found = products.get(sku);
  if (!found) throw clientError("BAD_USER_INPUT", `Unknown product "${sku}"`);
  return found;
}

export const onHand = (sku: string): number =>
  [...(stock.get(sku)?.values() ?? [])].reduce((sum, n) => sum + n, 0);

/** Book stock in or out of one warehouse, and tell subscribers. */
export function adjustStock(
  { sku, warehouse, delta }: Fields["Mutation"]["adjustStock"]["args"],
  pubsub: PubSub
): ProductRow {
  const row = productBySku(sku);
  if (!warehouses.some((w) => w.code === warehouse)) {
    throw clientError("BAD_USER_INPUT", `Unknown warehouse "${warehouse}"`);
  }
  const levels = stock.get(sku) ?? new Map<string, number>();
  const next = (levels.get(warehouse) ?? 0) + delta;
  if (next < 0)
    throw clientError(
      "BAD_USER_INPUT",
      `Only ${levels.get(warehouse) ?? 0} ${sku} in ${warehouse}`
    );
  levels.set(warehouse, next);
  stock.set(sku, levels);
  row.updatedAt = new Date();
  pubsub.publish("stock:changed", row);
  return row;
}

/** Take units for an order, from the fullest warehouse first. */
export function takeStock(sku: string, quantity: number, pubsub: PubSub): void {
  let remaining = quantity;
  const levels = [...(stock.get(sku) ?? [])].sort(([, a], [, b]) => b - a);
  for (const [warehouse, units] of levels) {
    const taken = Math.min(units, remaining);
    if (taken > 0) adjustStock({ sku, warehouse, delta: -taken }, pubsub);
    remaining -= taken;
  }
}
