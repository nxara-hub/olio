import { resolvers } from "@nxlab/olio";

// Internal values for OrderStatus (see CustomEnums in types.d.ts): resolvers
// read and write "confirmed", clients see CONFIRMED, and status arguments
// arrive already converted. CustomEnums makes `enums` required in index.ts, which loads this file.
export const OrderStatus = resolvers.sales.orders.OrderStatus({
  CONFIRMED: "confirmed",
  CANCELLED: "cancelled"
});
