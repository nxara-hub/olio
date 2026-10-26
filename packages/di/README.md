# @nxlab/di

Typed dependency injection for olio apps, on [Awilix](https://github.com/jeffijoe/awilix).

Modules already share code through plain imports. DI adds what imports can't:

- **Per-operation instances:** a DataLoader, a transaction or a "current user" repository, one per request and shared by every resolver in it.
- **Swapping implementations in tests,** without rewiring imports.
- **Lifecycle:** lazy creation, and cleanup when an operation or the app ends.

Awilix does the work underneath: lifetimes, lazy proxy injection, catching a singleton that holds a per-operation instance, cycle detection, disposal. This package puts typed providers on top: resolvers reach services by name, with autocomplete, and a typo is a compile error.

```sh
bun add @nxlab/di
```

## Providers

Providers are plain values, declared next to the code that uses them. A factory asks for what it needs with `get(Provider)`.

```ts
import { operation, singleton } from "@nxlab/di";

export const Db = singleton(() => new Pool(env.DATABASE_URL), {
  dispose: (pool) => pool.end()
});

export const ProductLoader = operation(
  ({ get }) =>
    new DataLoader((skus: readonly string[]) => get(Db).products.bySkus(skus))
);

export const Orders = operation(
  ({ get, ctx }) => new OrderRepo(get(Db), ctx.viewer)
);
```

|  | Lives | Its factory gets |
| --- | --- | --- |
| `singleton(factory, { dispose? })` | As long as the container | `{ get }`, for other singletons only |
| `operation(factory, { dispose? })` | One operation (one scope) | `{ get, ctx }`, for any provider, plus the operation's context |

A singleton that asks for an operation provider is a type error, and Awilix rejects it at runtime too. So do cycles (`Cyclic dependencies detected`).

## With olio

Tell DI what an operation's context looks like, the same way you register olio's:

```ts
declare module "@nxlab/di" {
  interface Register {
    ctx: RequestInfo; // what your context has, apart from `di` itself
  }
}
```

Create one container, naming the services resolvers use. Give every operation a scope in its context, and dispose the scope when the operation ends:

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
  onOperationEnd: (ctx) => ctx.di.dispose() // @nxlab/http
});

// in a resolver
product: (line, _args, ctx) => ctx.di.productLoader.load(line.sku); // typed, autocompletes, created on first access
```

Subscriptions work the same way: give each one a scope in its context and dispose it when it ends. With graphql-ws that's its `context(ctx, id)` hook, which runs once per subscription, and `onComplete`; with graphql-sse, `context` and `onComplete`. `@nxlab/http`'s README shows both.

## Tests

```ts
const container = createContainer(services, { override: [override(Db, fakeDb)] }); // fakeDb must fit Db
await using scope = container.scope(testInfo); // disposed at the end of the block
expect(await scope.orders.list()).toEqual([...]);
```

`dispose` and `ctx` are reserved and can't be service names. Factories use tokens (`get(Db)`) rather than names: typing a factory's dependencies from the list it's part of is circular, and TypeScript can't resolve it.

Each container is independent, so tests don't share singletons.

## API

|  |  |
| --- | --- |
| `createContainer(services, { override? })` | The root: `scope(ctx)`, `dispose()`, `Symbol.asyncDispose` |
| `scope.<name>` | An instance for this operation: its own for `operation` providers, the shared one for singletons |
| `ScopeOf<typeof container>` | The scope's type, for `ctx.di` |
| `scope.dispose()` | Disposes this operation's instances, newest first. Also `Symbol.asyncDispose` |
| `override(provider, value)` | A typed replacement for tests |
