// The example's app wired by hand: the same resolver, middleware and SDL
// files as src/, imported directly instead of through @nxara/olio-tools.
// The SDL is inlined at import (Bun's text imports), so it bundles too.
import { feature, module, mw, olio, type MiddlewareFn } from "@nxara/olio";

import { directives } from "../src/directives.js";
import { clientError } from "../src/errors.js";
import {
  auditLog,
  requestLogger,
  requireAuth,
  requireRole
} from "../src/middleware.js";
import { Mutation as AuthMutation } from "../src/modules/auth/mutation.js";
import { Query as AuthQuery } from "../src/modules/auth/query.js";
import { LoginResult } from "../src/modules/auth/resolvers/login-result.js";
import authSdl from "../src/modules/auth/typedefs/auth.gql" with { type: "text" };
import { DateTime } from "../src/modules/core/resolvers/scalars.js";
import coreSdl from "../src/modules/core/typedefs/core.gql" with { type: "text" };
import scalarsSdl from "../src/modules/core/typedefs/scalars.gql" with { type: "text" };
import { Mutation as InventoryMutation } from "../src/modules/inventory/mutation.js";
import { Query as InventoryQuery } from "../src/modules/inventory/query.js";
import { Product } from "../src/modules/inventory/resolvers/product.js";
import { Subscription as InventorySubscription } from "../src/modules/inventory/subscription.js";
import inventorySdl from "../src/modules/inventory/typedefs/inventory.gql" with { type: "text" };
import { middleware as customersMiddleware } from "../src/modules/sales/customers/middleware.js";
import { Mutation as CustomersMutation } from "../src/modules/sales/customers/mutation.js";
import { Query as CustomersQuery } from "../src/modules/sales/customers/query.js";
import { Customer } from "../src/modules/sales/customers/resolvers/customer.js";
import customersSdl from "../src/modules/sales/customers/typedefs/customers.gql" with { type: "text" };
import { OrderStatus } from "../src/modules/sales/orders/enums.js";
import { middleware as ordersMiddleware } from "../src/modules/sales/orders/middleware.js";
import { Mutation as OrdersMutation } from "../src/modules/sales/orders/mutation.js";
import { Query as OrdersQuery } from "../src/modules/sales/orders/query.js";
import {
  Customer as OrdersCustomer,
  Product as OrdersProduct
} from "../src/modules/sales/orders/resolvers/extensions.js";
import {
  OrderLine,
  PlaceOrderResult,
  SalesOrder
} from "../src/modules/sales/orders/resolvers/order.js";
import ordersSdl from "../src/modules/sales/orders/typedefs/orders.gql" with { type: "text" };

// Copied from src/modules/*/index.ts, which also run the load calls.
const rateLimit = (max: number): MiddlewareFn => {
  const attempts = new Map<string, number>();
  return ({ args }, next) => {
    const email = String(args.email);
    const count = (attempts.get(email) ?? 0) + 1;
    attempts.set(email, count);
    if (count > max) {
      throw clientError("TOO_MANY_REQUESTS", "Too many login attempts");
    }
    return next();
  };
};
const journal =
  (): MiddlewareFn =>
  ({ ctx, info }, next) => {
    console.log(`  [${ctx.requestId}] sales journal → ${info.fieldName}`);
    return next();
  };

export const app = olio({
  middleware: mw({
    "*": { "*": [requestLogger()] },
    Query: { "*": [requireAuth()] },
    Mutation: { "*": [requireAuth(), auditLog()] },
    Subscription: { "*": [requireAuth()] }
  }),
  modules: [
    module.auth({
      typeDefs: [authSdl],
      resolvers: { Query: AuthQuery, Mutation: AuthMutation, LoginResult },
      middleware: mw.auth({ Mutation: { login: [rateLimit(5)] } })
    }),
    module.core({ typeDefs: [coreSdl, scalarsSdl], resolvers: { DateTime } }),
    module.inventory({
      typeDefs: [inventorySdl],
      resolvers: {
        Query: InventoryQuery,
        Mutation: InventoryMutation,
        Subscription: InventorySubscription,
        Product
      },
      middleware: mw.inventory({
        Mutation: { adjustStock: [requireRole("MANAGER", "ADMIN")] }
      })
    }),
    module.sales({
      middleware: mw.sales({ Mutation: { "*": [journal()] } }),
      features: [
        feature.sales.customers({
          typeDefs: [customersSdl],
          resolvers: {
            Query: CustomersQuery,
            Mutation: CustomersMutation,
            Customer
          },
          middleware: customersMiddleware
        }),
        feature.sales.orders({
          typeDefs: [ordersSdl],
          resolvers: {
            Query: OrdersQuery,
            Mutation: OrdersMutation,
            Product: OrdersProduct,
            Customer: OrdersCustomer,
            SalesOrder,
            OrderLine,
            PlaceOrderResult
          },
          enums: { OrderStatus },
          middleware: ordersMiddleware
        })
      ]
    })
  ],
  directives
});
