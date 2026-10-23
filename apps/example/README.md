# Example: a small ERP

A warehouse-and-sales backend built with olio. It's the reference app for the repo and the integration test for the whole pipeline, from SDL through codegen to a running schema.

```sh
bun run --cwd apps/example codegen   # SDL → src/generated.ts, src/schema.gql
bun run --cwd apps/example start     # a day at the warehouse, end to end
bun run --cwd apps/example check-types
bun run --cwd apps/example serve     # the same app over HTTP + WebSocket: Hono on Node
```

`serve` starts the ERP on `http://localhost:4000/graphql`, with subscriptions on the same URL as server-sent events (`Accept: text/event-stream`) or over WebSocket. Sign in with `mutation { login(email: "mia@erp.test", password: "demo") { ... on Session { token } } }`, then send `authorization: Bearer <token>`, or `connectionParams: { token }` on a WebSocket.

`src/main.ts` walks through a day: sign in, search products, book stock, place orders (one too big), watch stock move, cancel an order and sign out. It prints each result and the middleware logs.

## Modules

| Module | Owns |
| --- | --- |
| [`core`](src/modules/core) | `Node`, `Timestamped` and `UserError` interfaces, `Money`, `PageInfo`, `PageArgs`, the `DateTime` scalar |
| [`auth`](src/modules/auth) | Employees with roles, sessions, `login` / `logout` / `me` |
| [`inventory`](src/modules/inventory) | Products, warehouses, stock levels, `adjustStock`, the `stockChanged` subscription |
| [`sales`](src/modules/sales) | Two features, `customers/` and `orders/`: customers, sales orders, `placeOrder`, `cancelOrder` |

Each module is a folder under `src/modules`. Codegen and `loadModules` both find modules there.

## Where each feature lives

| Feature | Where |
| --- | --- |
| Registering types, context and mappers | [`src/types.d.ts`](src/types.d.ts) |
| Context from a bearer token, as an HTTP adapter would build it | [`src/context.ts`](src/context.ts) |
| App middleware layers: logging, auth, audit | [`src/index.ts`](src/index.ts), [`src/middleware.ts`](src/middleware.ts) |
| `-` keys: public `login` / `me`, with the logger re-added | [`auth/index.ts`](src/modules/auth/index.ts) |
| Role checks as module middleware | [`inventory/index.ts`](src/modules/inventory/index.ts), [`sales/orders/middleware.ts`](src/modules/sales/orders/middleware.ts) |
| Middleware on a field with no resolver (`Customer.email`) | [`sales/customers/middleware.ts`](src/modules/sales/customers/middleware.ts) |
| `@implements`, including a field-less error type | [`auth.gql`](src/modules/auth/typedefs/auth.gql), [`orders.gql`](src/modules/sales/orders/typedefs/orders.gql) |
| `@copy` of shared paging args into a filter input | [`inventory.gql`](src/modules/inventory/typedefs/inventory.gql) |
| Result unions and `__resolveType` | [`login-result.ts`](src/modules/auth/resolvers/login-result.ts), [`order.ts`](src/modules/sales/orders/resolvers/order.ts) |
| Mappers: resolvers return rows, field resolvers derive the rest | [`inventory/resolvers/product.ts`](src/modules/inventory/resolvers/product.ts) |
| Extending another module's type (`Product.unitsSold`) | [`orders.gql`](src/modules/sales/orders/typedefs/orders.gql), [`extensions.ts`](src/modules/sales/orders/resolvers/extensions.ts) |
| A module split into features, with module-wide middleware | [`sales/index.ts`](src/modules/sales/index.ts), [`sales/orders/index.ts`](src/modules/sales/orders/index.ts) |
| Dependency injection: a per-operation DataLoader batching order-line products (one lookup per request, not per line), disposed with `onOperationEnd` | [`inventory/providers.ts`](src/modules/inventory/providers.ts), [`order.ts`](src/modules/sales/orders/resolvers/order.ts), [`src/di.ts`](src/di.ts), [`src/context.ts`](src/context.ts) |
| Modules calling each other through plain imports | [`inventory/service.ts`](src/modules/inventory/service.ts), used by [`sales/orders/mutation.ts`](src/modules/sales/orders/mutation.ts) |
| A subscription and a typed pubsub | [`inventory/subscription.ts`](src/modules/inventory/subscription.ts), [`src/pubsub.ts`](src/pubsub.ts) |
| `Fields[...]` types outside resolvers | [`inventory/service.ts`](src/modules/inventory/service.ts) |
| A custom scalar from graphql-scalars | [`core/resolvers/scalars.ts`](src/modules/core/resolvers/scalars.ts) |
| Compile-time contract checks | [`src/type-checks.ts`](src/type-checks.ts) |
| Serving it: Hono on Node, subscriptions as server-sent events and over WebSocket | [`src/server.ts`](src/server.ts) |
| Errors clients may see (`GraphQLError` with a code) vs. hidden ones | [`src/errors.ts`](src/errors.ts) |

The data lives in memory (`store.ts` per module), so the example runs with no setup. Passwords are plain text for the same reason; that's marked in [`auth/store.ts`](src/modules/auth/store.ts).
