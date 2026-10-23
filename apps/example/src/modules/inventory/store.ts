import type { Currency, Warehouse } from "../../generated.js";

/** How products are stored. `Product` is mapped to this (see types.d.ts). */
export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  priceCents: number;
  currency: Currency;
  createdAt: Date;
  updatedAt: Date;
}

const opened = new Date("2026-01-05T09:00:00Z");

export const warehouses: readonly Warehouse[] = [
  { id: "w1", code: "AMS", name: "Amsterdam" },
  { id: "w2", code: "BER", name: "Berlin" }
];

const product = (
  id: string,
  sku: string,
  name: string,
  priceCents: number
): ProductRow => ({
  id,
  sku,
  name,
  priceCents,
  currency: "EUR",
  createdAt: opened,
  updatedAt: opened
});

type Sku = string;
type WarehouseCode = string;

export const products = new Map<Sku, ProductRow>(
  [
    product("p1", "CHAIR-01", "Office chair", 14_900),
    product("p2", "DESK-01", "Standing desk", 49_900),
    product("p3", "LAMP-01", "Desk lamp", 3_900)
  ].map((p) => [p.sku, p])
);

export const stock = new Map<Sku, Map<WarehouseCode, number>>([
  [
    "CHAIR-01",
    new Map([
      ["AMS", 12],
      ["BER", 3]
    ])
  ],
  ["DESK-01", new Map([["AMS", 2]])],
  [
    "LAMP-01",
    new Map([
      ["AMS", 40],
      ["BER", 25]
    ])
  ]
]);
