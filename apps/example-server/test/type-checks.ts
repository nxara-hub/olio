import {
  feature,
  mw,
  query,
  resolvers,
  subscription,
  type Fields
} from "@nxara/olio";
// Compile-time only: each @ts-expect-error proves the generated types close
// that door. Checked by `bun run check-types`.
import { fetchHandler } from "@nxara/olio-http/fetch";
import { nodeHandler } from "@nxara/olio-http/node";

import { createContext } from "../src/context.js";
import { app } from "../src/index.js";

// ---- HTTP handlers -----------------------------------------------------

// With a ctx registered, every resolver expects one: the handler must build it.
// @ts-expect-error context is required once Olio registers ctx
fetchHandler(app);
// @ts-expect-error and an options object without it isn't enough
nodeHandler(app, { maskErrors: false });
fetchHandler(app, { context: () => createContext() });

// ---- Middleware targets ------------------------------------------------

// The application targets "*" and root types, not module types.
// @ts-expect-error
mw({ Product: { name: [] } });

// placeOrder belongs to sales, not inventory.
// @ts-expect-error
mw.inventory({ Mutation: { placeOrder: [] } });

// A module targets fields it declares: unitsSold is sales', not inventory's.
// @ts-expect-error
mw.inventory({ Product: { unitsSold: [] } });
// Module middleware reaches every feature's fields...
mw.sales({ Product: { unitsSold: [] }, Customer: { email: [] } });
// ...a feature's only its own: unitsSold belongs to orders.
// @ts-expect-error
mw.sales.customers({ Product: { unitsSold: [] } });
mw.sales.orders({ Product: { unitsSold: [] } });

// Features are isolated: customers can't resolve orders' query.
// @ts-expect-error
query.sales.customers({ orders: () => [] });

// bypass knows the keys @bypass uses in the SDL.
mw({
  Query: {
    // @ts-expect-error no @bypass uses "auht"
    "*": [({ bypass }, next) => (bypass.has("auht") ? next() : next())]
  }
});
// Inline middleware still gets a typed ctx.
mw.auth({
  Mutation: { logout: [({ ctx }, next) => (ctx.viewer ? next() : null)] }
});

// ---- Resolvers ---------------------------------------------------------

// orders is a sales Query field.
// @ts-expect-error
query.inventory({ orders: () => [] });

// Wrong return type for Product.name.
// @ts-expect-error
resolvers.inventory.Product({ name: () => 42 });

// Inventory can't resolve the field sales added to its type.
// @ts-expect-error
resolvers.inventory.Product({ unitsSold: () => 0 });

// __resolveType returns one of the union's members.
// @ts-expect-error
resolvers.sales.orders.PlaceOrderResult({ __resolveType: () => "Customer" });

// ---- Mappers -----------------------------------------------------------

// Product is mapped to ProductRow: resolvers return rows and read rows.
resolvers.sales.orders.Product({ unitsSold: (row) => row.priceCents });
// @ts-expect-error a ProductRow needs priceCents, currency and timestamps
query.inventory({ product: () => ({ id: "p", sku: "X", name: "X" }) });

// The mapping reaches into unmapped types: StockLevel and pages hold rows.
type PageItems = Fields["Query"]["products"]["result"]["items"];
const productType = {
  id: "p",
  sku: "X",
  name: "X",
  price: { amount: 1, currency: "EUR" }
};
// @ts-expect-error a page holds ProductRows, not Product objects
export const items: PageItems = [productType];

// ---- Enums with internal values ------------------------------------------

// OrderStatus is stored lowercase (CustomEnums in types.d.ts).
const namesNotValues = {
  CONFIRMED: "CONFIRMED",
  CANCELLED: "cancelled"
} as const;
// @ts-expect-error internal values are "confirmed" | "cancelled"
resolvers.sales.orders.OrderStatus(namesNotValues);
// Arguments arrive converted: status is "confirmed" | "cancelled".
query.sales.orders({
  orders: (_root, { status }) => (status === "confirmed" ? [] : [])
});

// ---- Interfaces ------------------------------------------------------------

// Node has no mapper, so its __resolveType sees every implementer's row.
resolvers.core.Node({
  __resolveType: (node) => ("sku" in node ? "Product" : null)
});

// ---- Subscriptions -----------------------------------------------------

subscription.inventory({
  // @ts-expect-error yields must be ProductRows
  async *stockChanged() {
    yield { sku: "X" };
  }
});
subscription.inventory({
  // @ts-expect-error a subscription field is an iterable, not { subscribe }
  stockChanged: { subscribe: () => null }
});

// ---- Enum internal values ------------------------------------------------

// @ts-expect-error OrderStatus has internal values (CustomEnums): enums is required
feature.sales.orders({});
// @ts-expect-error CANCELLED needs an internal value too
feature.sales.orders({ enums: { OrderStatus: { CONFIRMED: "confirmed" } } });

// ---- Field types outside resolvers --------------------------------------

type Lines = Fields["Mutation"]["placeOrder"]["args"]["lines"];
export const lines: Lines = [{ sku: "CHAIR-01", quantity: 2 }];
const badLine = { sku: "X", quantity: "2" };
// @ts-expect-error quantity is an Int
export const badLines: Lines = [badLine];
// @ts-expect-error not a Query field
export type NoField = Fields["Query"]["nope"];

// ---- Dependency injection ------------------------------------------------

resolvers.sales.orders.OrderLine({
  // @ts-expect-error only the services listed in src/di.ts are on ctx.di
  product: (line, _args, ctx) => ctx.di.productStore.bySkus([line.sku])
});

// ---- Field extensions --------------------------------------------------

// @ts-expect-error not a registered extension (FieldExtensions in types.d.ts)
query.inventory({ products: { extensions: { complexty: 1 } } });
