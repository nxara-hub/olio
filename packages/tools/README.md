# @nxlab/tools

Load a module's type definitions and resolvers from files.

## Install

```sh
bun add @nxlab/tools
```

`graphql` is a peer dependency.

## Usage

Patterns are globs, or `file:` URLs, so paths can be relative to the calling module:

```ts
import { loadResolvers, loadTypeDefs } from "@nxlab/tools";

const typeDefs = await loadTypeDefs(
  new URL("**/typedefs/*.{gql,ts,js}", import.meta.url)
);

const resolvers = await loadResolvers(
  new URL("**/{query,mutation,subscription}.{js,ts}", import.meta.url),
  new URL("**/resolvers/*.{js,ts}", import.meta.url)
);
```

**`loadTypeDefs(...patterns)`** returns parsed documents from `.graphql`/`.gql` files and from `.ts`/`.js` modules (their default export: SDL or a `DocumentNode`). Each file is parsed with its path, so syntax, directive and schema errors point at `file:line:column`. Files that hold only comments are skipped.

**`loadResolvers(...patterns)`** imports `.ts`/`.js` modules and treats every named object export as a type: `export const Query = …`, `export const User = …`. Exports for the same type from different files are merged, and a field defined twice throws, naming both files. A non-plain export, such as a `GraphQLScalarType`, is used as it is.

Every pattern must match at least one file; a pattern that matches nothing throws, so a typo can't quietly load an empty module. String globs resolve from the working directory, so prefer `new URL(..., import.meta.url)` inside modules.
