---
title: "@nxara/olio-tools"
description: "Load modules and features, and a module's type definitions, resolvers and enum values, from files."
sidebar:
  label: "olio-tools"
  order: 3
---

Load modules and features, and a module's type definitions, resolvers and enum values, from files.

## Install

```sh
bun add @nxara/olio-tools graphql@16
```

`graphql` 16 is a peer dependency.

Instead of importing every file by hand, a module's `index.ts` points at its folders, and the app's at its modules. The package is optional: olio takes plain imports just as well.

## Usage

Every function takes one or more patterns: globs, or `file:` URLs, so paths can be relative to the calling module. String globs resolve from the working directory, so prefer `new URL(..., import.meta.url)` inside modules:

```ts
import { loadResolvers, loadTypeDefs } from "@nxara/olio-tools";

const typeDefs = await loadTypeDefs(
  new URL("**/typedefs/*.{gql,ts,js}", import.meta.url)
);

const resolvers = await loadResolvers(
  new URL("**/{query,mutation,subscription}.{js,ts}", import.meta.url),
  new URL("**/resolvers/*.{js,ts}", import.meta.url)
);
```

Every pattern must match at least one file. A pattern that matches nothing throws `No files match "<pattern>"`, so a typo can't quietly load an empty module.

### loadModules

`loadModules(...patterns)` imports each file (usually a module's `index.ts`) and collects every exported olio module, in file order. A file that exports no module throws.

```ts
export const app = olio({
  modules: await loadModules(
    new URL("modules/*/index.{js,ts}", import.meta.url)
  )
});
```

### loadFeatures

`loadFeatures(...patterns)` does the same for a module's `features` (`feature.sales.orders({...})`), usually with `new URL("*/index.{js,ts}", import.meta.url)` from the module's `index.ts`. The module's own patterns must then stay out of its feature folders (`typedefs/*.gql`, not `**/typedefs/*.gql`), or the feature's SDL loads twice and fails as duplicate types.

### loadTypeDefs

`loadTypeDefs(...patterns)` returns parsed documents from `.graphql` / `.gql` files and from `.ts` / `.js` modules (their default export: SDL or a `DocumentNode`). Each file is parsed with its path, so syntax, directive and schema errors point at `file:line:column`. Files that hold only comments, and `.ts` / `.js` files without a default export, are skipped. Any other extension throws.

### loadResolvers

`loadResolvers(...patterns)` imports `.ts` / `.js` modules and treats every named object export as a type: `export const Query = …`, `export const User = …`. Exports for the same type from different files are merged, and a field defined twice throws, naming both files. A non-plain export, such as a `GraphQLScalarType`, is used as it is. When `olio()` rejects a loaded resolver (an unknown type, another module's field), its error ends with `(exported by <file>)`.

### loadEnums

`loadEnums(...patterns)` loads [enum internal values](/reference/codegen/#enums-with-internal-values) for a module's `enums` the same way: every named export is one enum's map, written with olio's builder (`export const OrderStatus = resolvers.sales.OrderStatus({ ... })`). The result satisfies a required `enums` unchecked, as `loadResolvers` does for `resolvers`. So an enum missing from the files isn't a compile error: it fails per query, with an error naming the enum.

## Cost

Loading files at startup has a cost. This table compares the example server loaded with these functions against the same app wired by hand: the same resolver, middleware and SDL files, imported directly with the SDL inlined (`apps/example-server/bench`, rerun with `bun run --cwd apps/example-server bench`). Measured with Bun 1.4.4 on an Apple Silicon Mac, as medians of 20 fresh processes:

|                             | Loaded         | Wired by hand             |
| --------------------------- | -------------- | ------------------------- |
| Import + schema, at startup | 90 ms          | 64 ms                     |
| Heap / RSS after GC         | 4.1 MB / 30 MB | 3.0 MB / 24 MB            |
| Type-check (tsc 7)          | 0.11 s         | 0.11 s                    |
| Single-file bundle for Node | doesn't run    | runs (581 KB, 91 KB gzip) |

- **About 25 ms, once, at startup.** Globbing and reading files are synchronous, so most of it is finding files at runtime. Modules with top-level `await` evaluate asynchronously, and a module's files are imported only once its `index.ts` has run, so the runtime can't load the whole graph up front. The package itself adds about 3 ms. Requests aren't affected: the schema is the same either way.
- **Type-checking costs nothing extra.** Loaded maps aren't checked as a whole (`LoadedResolvers`), but each file is still typed where it's written.
- **Bundles need the files.** The patterns resolve against `import.meta.url` when the app starts, so a bundled app looks for `modules/*/index.{js,ts}` next to the bundle and throws `No files match`. Deploy the sources (or the build output) as files, or wire the modules by hand to ship one bundle.
