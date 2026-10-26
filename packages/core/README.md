# @nxlab/core

The contracts the Nxara packages share, so none of them has to depend on `@nxlab/olio`. Apps don't import it: `@nxlab/olio` re-exports the types, and `@nxlab/tools` the loaders.

- **`Olio`**: the registration interface. Apps still augment it through olio (`declare module "@nxlab/olio" { interface Olio { ... } }`), which reaches it here; `@nxlab/http` reads the registered `ctx` as `Context`.
- **Module shapes**: `OlioModule`, `OlioFeature`, `ResolverMap`, `StoredMiddleware` (olio's `MiddlewareMap` is the typed view), and the `LoadedResolvers` / `LoadedEnums` brands that `@nxlab/tools` returns.
- **`TypeSource`, `Pattern`**.
- **`@nxlab/core/files`** (Node only, so `node:fs` stays out of olio's imports): `matchFiles(patterns)` (sorted; a pattern matching nothing throws) and `loadSDLFile(file)` (`.graphql` / `.gql`, or a `.ts` / `.js` default export of SDL or a `DocumentNode`; errors carry `file:line:col`). `@nxlab/tools` and `@nxlab/codegen` both load SDL through it, so they read the same files the same way.
