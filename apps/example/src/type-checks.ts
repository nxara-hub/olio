// Compile-time only: each @ts-expect-error proves the generated types close
// that door. Checked by `bun run check-types`.
import { mw, query, resolvers, subscription, type Fields } from "@nxlab/olio";

// ---- Middleware targets ------------------------------------------------

// The application targets "*" and root types, not module types.
// @ts-expect-error
mw({ Product: { name: [] } });

// placeOrder belongs to sales, not inventory.
// @ts-expect-error
mw.inventory({ Mutation: { placeOrder: [] } });

// The "-" form exists only for real fields.
// @ts-expect-error
mw.auth({ Mutation: { "-nope": [] } });

// A module targets fields it declares: unitsSold is sales', not inventory's.
// @ts-expect-error
mw.inventory({ Product: { unitsSold: [] } });
mw.sales({ Product: { unitsSold: [] } });

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
resolvers.sales.PlaceOrderResult({ __resolveType: () => "Customer" });

// ---- Mappers -----------------------------------------------------------

// Product is mapped to ProductRow: resolvers return rows and read rows.
resolvers.sales.Product({ unitsSold: (row) => row.priceCents });
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
// @ts-expect-error internal values are "confirmed" | "cancelled"
resolvers.sales.OrderStatus({ CONFIRMED: "CONFIRMED", CANCELLED: "cancelled" });
// Arguments arrive converted: status is "confirmed" | "cancelled".
query.sales({
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

// ---- Field types outside resolvers --------------------------------------

type Lines = Fields["Mutation"]["placeOrder"]["args"]["lines"];
export const lines: Lines = [{ sku: "CHAIR-01", quantity: 2 }];
const badLine = { sku: "X", quantity: "2" };
// @ts-expect-error quantity is an Int
export const badLines: Lines = [badLine];
// @ts-expect-error not a Query field
export type NoField = Fields["Query"]["nope"];
