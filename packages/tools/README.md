# @nxara/olio-tools

Load modules, and a module's type definitions and resolvers, from files.

## Install

```sh
bun add @nxara/olio-tools
```

`graphql` 16 and `@nxara/olio` are peer dependencies.

## Usage

Patterns are globs, or `file:` URLs, so paths can be relative to the calling module:

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

**`loadModules(...patterns)`** imports each file (usually a module's `index.ts`) and collects every exported olio module, in file order. A file that exports no module throws.

```ts
export const app = olio({
  modules: await loadModules(
    new URL("modules/*/index.{js,ts}", import.meta.url)
  )
});
```

**`loadFeatures(...patterns)`** does the same for a module's features (`feature.sales.orders({...})`), usually `new URL("*/index.{js,ts}", import.meta.url)` from the module's `index.ts`.

**`loadTypeDefs(...patterns)`** returns parsed documents from `.graphql`/`.gql` files and from `.ts`/`.js` modules (their default export: SDL or a `DocumentNode`). Each file is parsed with its path, so syntax, directive and schema errors point at `file:line:column`. Files that hold only comments are skipped.

**`loadResolvers(...patterns)`** imports `.ts`/`.js` modules and treats every named object export as a type: `export const Query = …`, `export const User = …`. Exports for the same type from different files are merged, and a field defined twice throws, naming both files. A non-plain export, such as a `GraphQLScalarType`, is used as it is. When `olio()` rejects a loaded resolver (an unknown type, another module's field), its error ends with `(exported by <file>)`.

**`loadEnums(...patterns)`** loads enum internal values for a module's `enums` the same way: every named export is one enum's map, written with olio's builder (`export const OrderStatus = resolvers.sales.orders.OrderStatus({ ... })`). The result satisfies a required `enums` unchecked, like `loadResolvers` does `resolvers`, so an enum missing from the files isn't a compile error; it fails per query, with an error naming the enum.

Every pattern must match at least one file; a pattern that matches nothing throws, so a typo can't quietly load an empty module. String globs resolve from the working directory, so prefer `new URL(..., import.meta.url)` inside modules.
