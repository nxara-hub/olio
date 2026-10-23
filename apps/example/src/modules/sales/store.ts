import type { OrderStatus } from "../../generated.js";

/** How customers are stored. `Customer` is mapped to this. */
export interface CustomerRow {
  id: string;
  name: string;
  email: string;
  creditLimitCents: number;
  createdAt: Date;
  updatedAt: Date;
}

/** An order line as stored: the price at the time of sale. */
export interface OrderLineRow {
  sku: string;
  quantity: number;
  unitPriceCents: number;
}

export interface OrderRow {
  id: string;
  number: string;
  customerId: string;
  status: OrderStatus;
  lines: OrderLineRow[];
  createdAt: Date;
  updatedAt: Date;
}

const since = new Date("2026-02-01T09:00:00Z");

export const customers = new Map<string, CustomerRow>([
  [
    "c1",
    {
      id: "c1",
      name: "Acme BV",
      email: "buying@acme.test",
      creditLimitCents: 500_000,
      createdAt: since,
      updatedAt: since
    }
  ],
  [
    "c2",
    {
      id: "c2",
      name: "Globex GmbH",
      email: "orders@globex.test",
      creditLimitCents: 150_000,
      createdAt: since,
      updatedAt: since
    }
  ]
]);

export const orders = new Map<string, OrderRow>();

export const nextOrderNumber = (): string =>
  `SO-${String(orders.size + 1).padStart(4, "0")}`;

export const orderTotal = (order: OrderRow): number =>
  order.lines.reduce((sum, l) => sum + l.quantity * l.unitPriceCents, 0);
