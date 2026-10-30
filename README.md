# Nxara

Modular, type-safe GraphQL for TypeScript, in the spirit of `graphql-modules`. Each module owns its SDL, resolvers and middleware. Codegen turns the SDL into types, so every resolver, argument and middleware target is checked at compile time.

## Packages

| Package | Description |
| --- | --- |
| [`@nxara/olio`](./packages/olio) | Runtime: modules, typed resolvers, layered middleware → schema |
| [`@nxara/olio-codegen`](./packages/codegen) | SDL → TypeScript: schema types, per-module contracts, `Application` |
| [`@nxara/olio-schema`](./packages/schema) | Compose module SDL into one validated schema; `@implements` / `@copy` directives |
| [`@nxara/olio-di`](./packages/di) | Typed dependency injection on Awilix: singletons and per-operation instances |
| [`@nxara/olio-http`](./packages/http) | Serve an app over HTTP: Fetch and Node adapters with context, error masking and cleanup |
| [`@nxara/olio-client`](./packages/client) | A typed client: operations in `.graphql` files, codegen types them, one call per operation; `testClient` for tests |
| [`@nxara/olio-tools`](./packages/tools) | Load SDL and resolver files for a module |

```
modules/*/typedefs/*.gql ─→ @nxara/olio-schema ─→ @nxara/olio-codegen ─→ generated.ts (Application)
                                    │                                      │ declare module "@nxara/olio"
                                    └──────────→ @nxara/olio ←─────────────┘
                                                     │
                                               GraphQLSchema
```

## At a glance

```ts
// modules/inventory/query.ts: typed from the generated Application
export const Query = query.inventory({
  product: (root, { sku }, ctx, info) => products.get(sku) ?? null
});

// modules/inventory/index.ts
export const inventoryModule = module.inventory({
  typeDefs: await loadTypeDefs(new URL("typedefs/*.gql", import.meta.url)),
  resolvers: await loadResolvers(
    new URL("{query,mutation}.ts", import.meta.url)
  ),
  middleware: mw.inventory({
    Mutation: { adjustStock: [requireRole("MANAGER")] }
  })
});

// index.ts
export const app = olio({
  middleware: mw({
    "*": { "*": [requestLogger()] },
    Query: { "*": [requireAuth()] }
  }),
  modules: await loadModules(new URL("modules/*/index.ts", import.meta.url)),
  directives
});
// app.schema → any GraphQL server
```

[`apps/example-server`](./apps/example-server) is a small ERP: auth with roles, inventory with a stock subscription, and sales split into features. It shows every feature, with a map of where each one lives. [`apps/example-client`](./apps/example-client) is a separate app that uses it over HTTP with `@nxara/olio-client`.

## Development

[Bun](https://bun.com) workspaces with [Turborepo](https://turborepo.dev).

```sh
bun install
bun run build         # build all packages
bun run test
bun run check-types
bun run check         # lint + format (ultracite); `bun run fix` to apply

bun run --cwd apps/example-server codegen   # regenerate src/generated.ts
bun run --cwd apps/example-server start     # run the example
bun run --cwd apps/example-server serve     # serve it, then:
bun run --cwd apps/example-client start     # the client walkthrough
```

## Releasing

All packages share one version. On a clean `main`:

```sh
bun run release 0.3.0         # bumps every package, commits and tags v0.3.0
git push origin main v0.3.0   # CI checks, publishes to npm with provenance, creates the GitHub release
```

A version with a suffix (`0.3.0-rc.1`) publishes under npm's `next` tag and as a GitHub prerelease. Publishing needs an npm token with publish rights to `@nxara` in the repo's `NPM_TOKEN` secret. A failed run can be rerun: versions already on npm are skipped.

## License

MIT
