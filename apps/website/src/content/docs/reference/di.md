---
title: "@nxara/olio-di"
description: "Typed dependency injection for olio apps, on Awilix."
sidebar:
  label: "olio-di"
  order: 6
---

Typed dependency injection for olio apps, on [Awilix](https://github.com/jeffijoe/awilix).

Modules already share code through plain imports. Dependency injection (DI) adds what imports can't:

- **Per-operation instances:** a DataLoader, a transaction or a "current user" repository, one per request and shared by every resolver in it.
- **Swapping implementations in tests,** without rewiring imports.
- **Lifecycle:** lazy creation, and cleanup when an operation or the app ends.

Awilix does the work underneath: lifetimes, lazy proxy injection, catching a singleton that holds a per-operation instance, cycle detection and disposal. This package puts typed providers on top: resolvers reach services by name, with autocomplete, and a typo is a compile error.

## Install

```sh
bun add @nxara/olio-di
```

## Providers

A provider says how to create a service and how long it lives. Providers are plain values, declared next to the code that uses them. A factory asks for what it needs with `get(Provider)`:

```ts
import { operation, singleton } from "@nxara/olio-di";
import DataLoader from "dataloader";
import pg from "pg";

export const Db = singleton(
  () => new pg.Pool({ connectionString: env.DATABASE_URL }),
  { dispose: (pool) => pool.end() }
);

export const ProductLoader = operation(
  ({ get }) =>
    new DataLoader(async (skus: readonly string[]) => {
      const { rows } = await get(Db).query(
        "select * from products where sku = any($1)",
        [skus]
      );
      // DataLoader wants one value per key, in the keys' order.
      return skus.map((sku) => rows.find((row) => row.sku === sku));
    })
);

export const Orders = operation(
  ({ get, ctx }) => new OrderRepo(get(Db), ctx.viewer)
);
```

|  | Lives | Its factory gets |
| --- | --- | --- |
| `singleton(factory, { dispose? })` | As long as the container | `{ get }`, for other singletons only |
| `operation(factory, { dispose? })` | One operation (one scope) | `{ get, ctx }`, for any provider, plus the operation's context |

A singleton that asks for an operation provider is a type error, and Awilix rejects it at runtime too. Cycles are rejected as well (`Cyclic dependencies detected`).

Factories use tokens (`get(Db)`) rather than names: typing a factory's dependencies from the list it's part of is circular, and TypeScript can't resolve it.

## With olio

Tell DI what an operation's context looks like, the same way you register olio's `ctx`:

```ts
import type { Viewer } from "./auth.js";

// Yours: what your context has, apart from `di` itself. `Orders` above reads its `viewer`.
interface RequestInfo {
  viewer?: Viewer;
}

declare module "@nxara/olio-di" {
  interface Register {
    ctx: RequestInfo;
  }
}
```

Create one container, naming the services resolvers use. Give every operation a scope in its context, and dispose of the scope when the operation ends:

```ts
// di.ts: the keys are the names. Providers these depend on (Db) needn't be listed.
export const container = createContainer({
  productLoader: ProductLoader,
  orders: Orders
});

// in your context type
di: ScopeOf<typeof container>;

fetchHandler(app, {
  context: (request) => {
    const info = requestInfo(request);
    return { ...info, di: container.scope(info) };
  },
  onOperationEnd: (ctx) => ctx.di.dispose() // @nxara/olio-http
});

// in a resolver
product: (line, _args, ctx) => ctx.di.productLoader.load(line.sku); // typed, autocompletes, created on first access
```

`dispose` and `ctx` are reserved and can't be service names.

Subscriptions work the same way: give each one a scope in its context and dispose of it when the subscription ends. With graphql-ws, that's its `context(ctx, id)` hook, which runs once per subscription, and `onComplete`. With graphql-sse, it's `context` and `onComplete`. [`@nxara/olio-http`'s docs](/reference/http/#subscriptions) shows both.

## Tests

In tests, swap a provider for a fake with `override`:

```ts
const container = createContainer({ orders: Orders }, { override: [override(Db, fakeDb)] }); // fakeDb must fit Db
await using scope = container.scope(testInfo); // disposed at the end of the block
expect(await scope.orders.list()).toEqual([...]);
```

Each container is independent, so tests don't share singletons.

## API

|  |  |
| --- | --- |
| `createContainer(services, { override? })` | The root: `scope(ctx)`, `dispose()`, `Symbol.asyncDispose` |
| `scope.<name>` | An instance for this operation: its own for `operation` providers, the shared one for singletons |
| `ScopeOf<typeof container>` | The scope's type, for `ctx.di` |
| `scope.dispose()` | Runs `dispose` on the instances this operation created, all at once and in no set order (Awilix starts them together), and waits for them. Also `Symbol.asyncDispose` |
| `override(provider, value)` | A typed replacement for tests |
