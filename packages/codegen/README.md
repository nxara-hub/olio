# @nxlab/codegen

Generate TypeScript types from GraphQL SDL.

`@nxlab/codegen` discovers modules from a directory layout, reads each module's GraphQL SDL, and emits a single strongly typed TypeScript file: schema types, per-module operation contracts, and the application type.

It is deliberately small - SDL in, types out. Schema composition belongs to `@nxlab/schema`, the runtime to `@nxlab/olio`.

## Install

```sh
bun add @nxlab/codegen
```

`graphql` 16 is a peer dependency.

## Usage

There is no bundled CLI; drive codegen from a short script:

```ts
import { codegen } from "@nxlab/codegen";

await codegen({
  modules: "src/modules",
  typeDefs: "**/typedefs/**/*.gql",
  output: "src/generated.ts"
});
```

`modules` points to a directory whose **direct child directories** are modules. `typeDefs` is resolved relative to each module directory. `codegen` discovers modules, loads and parses their SDL, generates TypeScript, and writes the output (creating parent directories as needed).

### Directives

Pass `directives` to apply `@nxlab/schema` transformations before generation:

```ts
import { codegen } from "@nxlab/codegen";
import { copyDirective, implementsDirective } from "@nxlab/schema";

await codegen({
  modules: "src/modules",
  typeDefs: "**/typedefs/**/*.gql",
  output: "src/generated.ts",
  schema: "src/schema.graphql",
  directives: [implementsDirective(), copyDirective()]
});
```

Their names land in `Application` as `"~directives"`, and olio's types then require the same `directives` in `olio()`.

Set `schema` to write the final schema to a file, printed from the built schema: each type once with its extensions merged in, the directives applied, ready for schema registries, linters and diff tools. Omit it to generate only TypeScript. The schema is validated before anything is written, so an invalid one fails codegen rather than the server.

## Client types

`codegenClient({ schema, documents, output })` generates the types for [`@nxlab/client`](../client), the way graphql-codegen does: `schema` is an SDL file (typically the `schema` output above) or the running server's URL, introspected (`headers` for one that needs a token); `documents` are the client's `.graphql` operations. The operations are checked against the schema first, with `file:line:column` errors.

Subscriptions go over WebSocket unless marked `@sse` (`subscription Feed @sse { … }`); `@ws` says the default explicitly. The directive is the client's: codegen records it in the document and removes it from the query the server receives, and imports only the transports the operations use. `@ws` / `@sse` on a query or mutation, both on one subscription, or with arguments, is an error.

Per operation it emits the result type, the variables type and a typed document (`LoginMutation`, `LoginMutationVariables`, `LoginDocument`), plus `operations` for `createClient`. Types are what a client sees on the wire: enums by name, scalars through `ClientScalars`.

```ts
import { codegenClient } from "@nxlab/codegen";

await codegenClient({
  schema: "../server/src/schema.gql", // or "http://localhost:4000/graphql"
  documents: "src/operations/*.graphql",
  output: "src/generated.ts"
});
```

## Modules

Every direct child directory of `modules` is one module. The directory name is the module ID, and there are no nested modules:

```
src/modules/
├── auth/
│   ├── typedefs/auth.gql
│   └── query.ts
├── user/
│   └── typedefs/user.gql
└── sales/
    ├── typedefs/sales.gql
    └── orders/
        └── typedefs/orders.gql
```

This yields modules `auth`, `user`, and `sales`. `typeDefs` resolves inside each module (`src/modules/auth/**/typedefs/**/*.gql`, and so on), so each module's files belong exclusively to that module.

A direct subfolder of a module in which `typeDefs` finds files of its own is a **feature** of that module: here `sales/orders`, with its own entry in `Application` (`"sales/orders"`). Features don't nest.

So the glob decides what is a feature, because codegen runs it inside each subfolder. `**/typedefs/**/*.gql` finds nothing inside `users/typedefs/` itself (there's no `typedefs/` in it), so that folder stays the module's own SDL. `**/*.gql` does find its files, so it makes `typedefs` a feature of every module (`"users/typedefs"`), and `users` ends up with no fields. Keep SDL in `typedefs/` folders and use `**/typedefs/**/*.gql`. The ID is used as-is as the module's key in `Application` (quoted when it is not a valid identifier).

## Application

`Application` lists, per module, the types it declares fields on. Register it with `@nxlab/olio`, which derives resolver signatures and middleware targets from it:

```ts
export type Application = {
  users: {
    Query: {
      type: Query;
      fields: "user" | "users";
      args: {
        user: { id: string };
      };
    };
    User: { type: User; fields: "__isTypeOf" | "id" | "name" };
  };
  posts: {
    Post: { type: Post; fields: "__isTypeOf" | "id" };
    User: { type: User; fields: "posts" }; // from `extend type User { posts: [Post!]! }`
  };
};
```

- **`type`** is the parent type. Resolvers receive it as `root` and return `type[field]`.
- **`fields`** are the fields the module owns. A module owns every field it declares, whether in a definition or an `extend`, on root and non-root types alike. The defining module also owns `__isTypeOf` (objects) or `__resolveType` (interfaces and unions, which also list their possible types as `resolveType`).
- **`args`** appears only for fields that take arguments.
- **Enums** appear as `{ type; fields: never; enum: "A" | "B" }`, listing the values the module declares (an `extend enum` belongs to the extending module).
- **Scalars** appear as `{ type; fields: never; scalar: true }` under the module that defines them, which supplies the implementation.
- **`bypass`** lists, per owned field, the keys its `@bypass` gives it (`bypass: { login: "audit" | "auth" }`). olio types middleware's `bypass` set from every key listed here.
- **`root`** marks a root type with its operation (`root: "query"`), so olio finds the roots whatever they're named. A hand-written `Application` needs it too.

Middleware targets aren't emitted: a module's targets are its owned fields, and the application's are the root fields.

## Supported SDL

- Object types, interfaces, unions, enums, inputs, and scalars
- Lists and nullability (`String`, `[String!]!`, …), mapped exactly
- Type extensions (`extend type User { … }`)
- Root operation types, under the default names or your own (`schema { query: RootQuery }`)

A schema type can't be named `Application`, `Maybe`, `ResolveEnum`, `ResolveScalar` or `Scalars`, since the generated file declares those names itself.

## Custom scalars

Every scalar goes through one exported table, `Scalars`, so fields read `Scalars["DateTime"]["output"]`. Built-in scalars default to their usual TypeScript types (`ID`/`String` → `string`, `Int`/`Float` → `number`, `Boolean` → `boolean`), and custom scalars default to `unknown`. Register or remap any of them by augmenting `CustomScalars`:

```ts
declare module "@nxlab/codegen" {
  interface CustomScalars {
    DateTime: Date;
    JSON: { input: string; output: unknown };
    ID: string | ObjectId; // built-ins can be remapped too
  }
}
```

Use the table directly when you need a scalar's type: `Scalars["DateTime"]["input"]`.

## Enums with internal values

Enums are their GraphQL names by default (`"ADMIN" | "GUEST"`). To store something else, such as a number or a lowercase string, register the internal type by augmenting `CustomEnums`:

```ts
declare module "@nxlab/codegen" {
  interface CustomEnums {
    OrderStatus: "confirmed" | "cancelled";
  }
}
```

Every generated position then uses it: object fields, arguments, and inputs, since graphql converts enum inputs to internal values too. Supply the values at runtime through the owning module's `enums` option. Once `CustomEnums` registers an enum, olio's types require it there, with a value for every value the module declares:

```ts
export const sales = module.sales({
  typeDefs,
  resolvers,
  enums: { OrderStatus: { CONFIRMED: "confirmed", CANCELLED: "cancelled" } }
});
```

To keep a map in its own file, write it with the typed builder: `export const OrderStatus = resolvers.sales.OrderStatus({ ... })`, then `enums: { OrderStatus }`, or load such files with `enums: await loadEnums(...)` from `@nxlab/tools` (unchecked, like `loadResolvers`).

## Output

`codegen` writes a single TypeScript file to `output`. For:

```graphql
type Query {
  user: User
}
type User {
  id: ID!
  name: String
}
```

the emitted `User` type is:

```ts
export type User = {
  __typename?: "User";
  id: Scalars["ID"]["output"];
  name: Maybe<Scalars["String"]["output"]>;
};
```

The full output contains:

- the `Scalars` table
- enums as `const` objects plus union types
- object types (root types included), interfaces, inputs, and unions. Nullable inputs without a default are optional keys.
- the `Application` type

The header marks the file as generated:

```ts
// Generated by @nxlab/codegen - do not edit.
```

## Relationship to @nxlab/schema

`@nxlab/schema` composes a schema into ordinary GraphQL; `@nxlab/codegen` then turns that GraphQL into TypeScript:

```
SDL → @nxlab/schema → DocumentNode → @nxlab/codegen → TypeScript
```

Codegen has no knowledge of `@implements` or `@copy` - it accepts `SchemaDirective[]` and passes the parsed document through the transformation pipeline.
