# @nxlab/directives

Schema-design directives for GraphQL SDL.

`@nxlab/directives` rewrites a parsed `DocumentNode` before it reaches codegen or a schema. It provides `@implements` and `@copy`, which save repeating fields across types. The output is ordinary GraphQL: the directives, and their definitions if you declared them, are removed.

## Install

```sh
bun add @nxlab/directives
```

`graphql` is a peer dependency.

## Usage

Pass the same list to codegen and to olio, so both see the same schema:

```ts
// directives.ts
import { copyDirective, implementsDirective } from "@nxlab/directives";

export const directives = [implementsDirective(), copyDirective()];

// codegen.ts
await codegen({
  modules: "src/modules",
  typeDefs: "**/*.gql",
  output: "src/generated.ts",
  directives
});

// index.ts
export const app = olio({ modules, directives });
```

Or apply them yourself:

```ts
import { applyDirectives } from "@nxlab/directives";

const document = applyDirectives(parse(sdl), directives);
```

Only the directives you pass are enabled. Their order doesn't matter: `applyDirectives` runs in passes, and a type waits until the types it copies from are done. So chains work (`C` copies `B`, which copies `A`, which implements `Node`), and a cycle is an error.

## @implements

On object types and their extensions. It adds the interfaces to the type's `implements` list and copies their fields.

```graphql
interface Node {
  id: ID!
}
interface Timestamped {
  createdAt: DateTime!
}

type User @implements(from: ["Node", "Timestamped"]) {
  name: String!
}
```

becomes:

```graphql
type User implements Node & Timestamped {
  id: ID!
  createdAt: DateTime!
  name: String!
}
```

Interface fields can't be overridden. Redeclaring one with a different type, arguments or directives, whether locally or from a second interface, is an error, so the mismatch shows up when the SDL loads. Repeating a field exactly, for example to add a description, is fine.

## @copy

On object types, input types, and their extensions. It copies fields without adding an `implements` clause. Objects copy from objects and interfaces, inputs from inputs.

```graphql
input CommonPagination {
  cursor: String
  limit: Int
}

input UserPagination @copy(from: ["CommonPagination"]) {
  cursor: ID
}
```

becomes:

```graphql
input UserPagination {
  cursor: ID
  limit: Int
}
```

Overriding is allowed, with spread semantics (`{ ...A, ...B, ...local }`): a later source overrides an earlier one, local fields override every source, and each field keeps the position where it first appeared.

## Both directives

- `from` takes a list of type names, or one name: `@copy(from: "Base")`.
- On an extension, fields the type already declares elsewhere are skipped, so a module can `extend type User @implements(from: ["Timestamped"])`.
- Errors carry the file, line and column, and name the target type:

  ```
  users/user.gql:4:11: @copy on "User" references unknown type "Nope"
  ```

## Writing a directive

A directive is a `SchemaDirective`: a `name`, its SDL `definition`, an optional `validate(document)` that runs before any transform, and `transform(document, context)`. A transform that reads from other types should skip a target while `context.isPending(source)` is true. `applyDirectives` will call it again on the next pass.
