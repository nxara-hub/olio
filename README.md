# Nxara

Modular, type-safe GraphQL for TypeScript, in the spirit of `graphql-modules`. Each module owns its SDL, resolvers and middleware. Codegen turns the SDL into types, so every resolver, argument and middleware target is checked at compile time.

## Packages

| Package | Description |
| --- | --- |
| [`@nxlab/olio`](./packages/olio) | Runtime: modules, typed resolvers, layered middleware → schema |
| [`@nxlab/codegen`](./packages/codegen) | SDL → TypeScript: schema types, per-module contracts, `Application` |
| [`@nxlab/schema`](./packages/schema) | Compose module SDL into one validated schema; `@implements` / `@copy` directives |
| [`@nxlab/tools`](./packages/tools) | Load SDL and resolver files for a module |

```
modules/*/typedefs/*.gql ─→ @nxlab/schema ─→ @nxlab/codegen ─→ generated.ts (Application)
                                    │                                      │ declare module "@nxlab/olio"
                                    └──────────→ @nxlab/olio ←─────────────┘
                                                     │
                                               GraphQLSchema
```

## At a glance

```ts
// modules/users/query.ts — typed from the generated Application
export const Query = query.users({
  user: (root, { id }, ctx, info) => store.get(id) ?? null
});

// modules/users/index.ts
export const usersModule = module.users({
  typeDefs: await loadTypeDefs(new URL("**/typedefs/*.gql", import.meta.url)),
  resolvers: await loadResolvers(new URL("**/query.ts", import.meta.url)),
  middleware: mw.users({ Query: { user: [audit()] } })
});

// index.ts
export const app = olio({
  middleware: mw({ "*": { "*": [requestLogger()] } }),
  modules: [usersModule, authModule]
});
// app.schema → any GraphQL server
```

[`apps/example`](./apps/example) is a runnable app with modules split into features, middleware layering and opt-outs, and compile-time checks.

## Development

[Bun](https://bun.com) workspaces with [Turborepo](https://turborepo.dev).

```sh
bun install
bun run build         # build all packages
bun run test
bun run check-types
bun run check         # lint + format (ultracite); `bun run fix` to apply

bun run --cwd apps/example codegen   # regenerate src/generated.ts
bun run --cwd apps/example start     # run the example
```

## License

MIT
