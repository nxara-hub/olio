---
title: "@nxara/olio-codegen"
description: "Generate TypeScript types from GraphQL SDL."
sidebar:
  label: "olio-codegen"
  order: 1
---

Generate TypeScript types from GraphQL SDL.

`@nxara/olio-codegen` finds modules by their folders, reads each module's SDL, and writes one TypeScript file: the schema's types, and the `Application` type that tells olio what each module owns. `codegenClient` does the same for a client's operations.

It's deliberately small: SDL in, types out. Schema composition belongs to [`@nxara/olio-schema`](/reference/schema/), the runtime to [`@nxara/olio`](/reference/olio/).

## Install

```sh
bun add -d @nxara/olio-codegen
bun add graphql@16
```

`graphql` 16 is a peer dependency. The generated file imports types from `@nxara/olio-codegen`, so keep it installed (a dev dependency is enough).

## Usage

There's no CLI. Drive codegen from a short script:

```ts
import { codegen } from "@nxara/olio-codegen";

await codegen({
  root: import.meta.dirname,
  modules: "src/modules",
  typeDefs: "**/typedefs/**/*.gql",
  output: "src/generated.ts"
});
```

- **`modules`**: a directory whose **direct child directories** are modules (see [Modules](#modules)).
- **`typeDefs`**: a glob for the SDL files, resolved inside each module directory.
- **`output`**: the TypeScript file to write. Parent directories are created as needed. A file whose content is unchanged isn't rewritten, so watchers and builds see no change.
- **`root`**: the directory that relative paths (`modules`, `output`, `schemaOutput`) resolve against. It defaults to the working directory; pass `import.meta.dirname` so the script runs the same from any folder. `codegenClient` takes `root` the same way, for `schema` (unless it's a URL), `documents` and `output`.
- **`watch`** (default `false`): after the first run, rerun whenever a file under `modules` changes. The promise never resolves, and an error in a rerun is printed while watching goes on.
- **`clear`** (default `false`): delete an output file before writing its new content.
- **`logs`** (default `true`): `false` prints nothing; errors still reject.

[`directives`](#directives) and [`schemaOutput`](#schema-file) have their own sections below.

### SDL files

SDL files are read exactly as `loadTypeDefs` in `@nxara/olio-tools` reads them (both go through `@nxara/olio-core/files`): `.graphql` / `.gql`, or `.ts` / `.js` files whose default export is SDL or a `DocumentNode`. So an app moving from untyped to typed keeps its SDL where it is (`typeDefs: "**/typedefs/**/*.{gql,ts}"`). A file holding only comments, or a `.ts` / `.js` file without a default export, is skipped. Codegen imports `.ts` files, so run it with something that executes TypeScript (bun, tsx, or Node 23.6+).

### Errors

`codegen` and `codegenClient` reject on invalid SDL or operations, with a message that names the file and position (`src/modules/users/typedefs/users.gql:2:6: Unknown type "Nope".`). Uncaught, the runtime prints it with a stack. To print just the message:

```ts
await codegen({
  root: import.meta.dirname,
  modules: "src/modules",
  typeDefs: "**/typedefs/**/*.gql",
  output: "src/generated.ts"
}).catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
```

### Directives

Pass `directives` to apply [`@nxara/olio-schema`](/reference/schema/#directives)'s directives, such as `@implements` and `@copy`, before generating:

```ts
import { codegen } from "@nxara/olio-codegen";
import { copyDirective, implementsDirective } from "@nxara/olio-schema";

await codegen({
  modules: "src/modules",
  typeDefs: "**/typedefs/**/*.gql",
  output: "src/generated.ts",
  schemaOutput: "src/schema.graphql",
  directives: [implementsDirective(), copyDirective()]
});
```

Their names land in `Application` as `"~directives"`, and olio's types then require the same `directives` in `olio()`.

### Schema file

Set `schemaOutput` to also write the final schema to a file, as in the example above. It's printed from the built schema: each type once with its extensions merged in and the directives applied, ready for schema registries, linters and diff tools. Omit it to generate only TypeScript. The schema is validated before anything is written, so an invalid one fails codegen rather than the server.

## Client types

`codegenClient({ schema, documents, output })` generates the types for [`@nxara/olio-client`](/reference/client/), the way graphql-codegen does:

```ts
import { codegenClient } from "@nxara/olio-codegen";

await codegenClient({
  root: import.meta.dirname,
  schema: "../server/src/schema.gql", // or "http://localhost:4000/graphql"
  documents: "src/operations/*.graphql",
  output: "src/generated.ts"
});
```

- **`schema`** is an SDL file (typically the [`schemaOutput`](#schema-file) file) or the running server's URL, which is introspected. Pass `headers` for a server that needs a token.
- **`documents`** are the client's `.graphql` operations. They're checked against the schema first, with `file:line:column` errors.
- **`watch: true`** reruns when an operation (including a new file) or the schema file changes. A server URL isn't watched.
- **`logs: false`** silences it, as for `codegen`.

Per operation, it emits the result type, the variables type and a typed document (`LoginMutation`, `LoginMutationVariables`, `LoginDocument`), plus `operations` for `createClient`. Every operation needs a name, since its types are named after it. Types are what a client sees on the wire: enums by name, scalars through `ClientScalars`.

Subscriptions go over WebSocket unless marked `@sse` (`subscription Feed @sse { … }`); `@ws` states the default explicitly. The directive is for the client only. Codegen records it in the document (`transport: "sse"`), removes it from the query the server receives, and lists the transports the operations use in `operations.transports`, which makes `createClient` require exactly those clients. `@ws` / `@sse` on a query or mutation, both on one subscription, or with arguments, is an error.

## Modules

Every direct child directory of `modules` is one module. The directory name is the module ID, used as-is as the module's key in `Application` (quoted when it isn't a valid identifier). Modules don't nest:

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

This yields the modules `auth`, `user` and `sales`. `typeDefs` resolves inside each module (`src/modules/auth/**/typedefs/**/*.gql`, and so on), so each module's files belong exclusively to that module. A module directory where `typeDefs` matches nothing is an error.

A direct subfolder of a module in which `typeDefs` finds files of its own is a **feature** of that module: here `sales/orders`, with its own entry in `Application` (`"sales/orders"`). Features don't nest. A feature folder can't share its name with a type its module declares fields on, or with a function property (`name`, `length`, `call`, …), because both appear on the same builders (`resolvers.sales.orders` next to `resolvers.sales.Customer`).

The glob decides what is a feature, because codegen runs it inside each subfolder:

- `**/typedefs/**/*.gql` finds nothing inside `user/typedefs/` itself (there's no `typedefs/` in it), so that folder stays the module's own SDL.
- `**/*.gql` does find its files, so it makes `typedefs` a feature of every module (`"user/typedefs"`), and `user` ends up with no fields.

Keep SDL in `typedefs/` folders and use `**/typedefs/**/*.gql`.

## Application

`Application` lists, per module, the types it declares fields on. Register it with [`@nxara/olio`](/reference/olio/#register-your-app), which derives resolver signatures and middleware targets from it:

```ts
export type Application = {
  users: {
    Query: {
      type: Query;
      fields: "user" | "users";
      root: "query";
      args: {
        user: { id: Scalars["ID"]["input"] };
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

- Object types, interfaces, unions, enums, inputs and scalars
- Lists and nullability (`String`, `[String!]!`, …), mapped exactly
- Type extensions (`extend type User { … }`)
- Root operation types, under the default names or your own (`schema { query: RootQuery }`)

A schema type can't be named `Application`, `Maybe`, `ResolveEnum`, `ResolveScalar` or `Scalars`, since the generated file declares those names itself.

## Custom scalars

Every scalar goes through one exported table, `Scalars`, so fields read `Scalars["DateTime"]["output"]`. Built-in scalars default to their usual TypeScript types (`ID` / `String` → `string`, `Int` / `Float` → `number`, `Boolean` → `boolean`), and custom scalars default to `unknown`. Register or remap any of them by augmenting `CustomScalars`:

```ts
import type { ObjectId } from "mongodb";

declare module "@nxara/olio-codegen" {
  interface CustomScalars {
    DateTime: Date;
    JSON: { input: string; output: unknown };
    ID: string | ObjectId; // built-ins can be remapped too
  }
}
```

Like every registration, it goes in a `.ts` file, or in a `.d.ts` file with an `import` or `export {}`.

Use the table directly when you need a scalar's type: `Scalars["DateTime"]["input"]`.

## Enums with internal values

By default, an enum's TypeScript type is its GraphQL names (`"ADMIN" | "GUEST"`). To store something else, such as a number or a lowercase string, register the internal type by augmenting `CustomEnums`:

```ts
declare module "@nxara/olio-codegen" {
  interface CustomEnums {
    OrderStatus: "confirmed" | "cancelled";
  }
}
```

Every generated position then uses it: object fields, arguments and inputs, since graphql converts enum inputs to internal values too. Supply the values at runtime through the owning module's `enums` option. Once `CustomEnums` registers an enum, olio's types require it there, with a value for every value the module declares (a module that adds values with `extend enum` supplies those):

```ts
export const sales = module.sales({
  typeDefs,
  resolvers,
  enums: { OrderStatus: { CONFIRMED: "confirmed", CANCELLED: "cancelled" } }
});
```

To keep a map in its own file, write it with the typed builder: `export const OrderStatus = resolvers.sales.OrderStatus({ ... })`, then `enums: { OrderStatus }`, or load such files with `enums: await loadEnums(...)` from `@nxara/olio-tools` (unchecked, like `loadResolvers`).

## Output

`codegen` writes a single TypeScript file to `output`. For this SDL:

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

- the `Scalars` table, one entry per scalar the schema uses
- enums as `const` objects plus union types
- object types (root types included), interfaces, inputs and unions. Nullable inputs without a default are optional keys.
- the `Application` type

The header marks the file as generated:

```ts
// Generated by @nxara/olio-codegen - do not edit.
// oxlint-disable no-redeclare
```

## Relationship to @nxara/olio-schema

`@nxara/olio-schema` composes a schema into ordinary GraphQL; `@nxara/olio-codegen` then turns that GraphQL into TypeScript:

```
SDL → @nxara/olio-schema → DocumentNode → @nxara/olio-codegen → TypeScript
```

Codegen knows nothing about `@implements` or `@copy`: it accepts `SchemaDirective[]` and passes the parsed document through the transformation pipeline.
