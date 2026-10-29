# @nxara/olio-core

The contracts the Nxara packages share, so none of them has to depend on `@nxara/olio`. Apps don't import it: `@nxara/olio` re-exports the types, and `@nxara/olio-tools` the loaders.

- **`Olio`**: the registration interface. Apps still augment it through olio (`declare module "@nxara/olio" { interface Olio { ... } }`), which reaches it here; `@nxara/olio-http` reads the registered `ctx` as `Context`.
- **Module shapes**: `OlioModule`, `OlioFeature`, `ResolverMap`, `StoredMiddleware` (olio's `MiddlewareMap` is the typed view), and the `LoadedResolvers` / `LoadedEnums` brands that `@nxara/olio-tools` returns.
- **`TypeSource`, `Pattern`**.
- **`@nxara/olio-core/files`** (Node only, so `node:fs` stays out of olio's imports): `matchFiles(patterns)` (sorted; a pattern matching nothing throws) and `loadGraphQLFile(file)` (`.graphql` / `.gql`, or a `.ts` / `.js` default export of GraphQL source or a `DocumentNode`; errors carry `file:line:col`). `@nxara/olio-tools` and `@nxara/olio-codegen` load SDL and operations through it, so they read the same files the same way.
