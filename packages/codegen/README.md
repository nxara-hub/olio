# @nxlab/codegen

Generate TypeScript types from GraphQL SDL.

`@nxlab/codegen` discovers modules from a directory layout, reads each module's GraphQL SDL, and emits a single strongly typed TypeScript file: schema types, per-module operation contracts, and the application type.

It is deliberately small — SDL in, types out. Schema composition belongs to `@nxlab/schema`, the runtime to `@nxlab/olio`.

## Install

```sh
bun add @nxlab/codegen
```

`graphql` is a peer dependency.

## Usage

There is no bundled CLI; drive codegen from a short script:

```ts
import { codegen } from "@nxlab/codegen";

await codegen({
  modules: "src/modules",
  typeDefs: "**/*.gql",
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
  typeDefs: "**/*.gql",
  output: "src/generated.ts",
  schema: "src/schema.graphql",
  directives: [implementsDirective(), copyDirective()]
});
```

Set `schema` to write the final (transformed) GraphQL SDL to a file. Omit it to generate only TypeScript. The schema is validated before anything is written, so an invalid one fails codegen rather than the server.

## Modules

Every direct child directory of `modules` is one module. The directory name is the module ID, and there are no nested modules:

```
src/modules/
├── auth/
│   ├── auth.gql
│   └── resolvers.ts
├── user/
│   └── user.gql
└── app/
    └── app.gql
```

This yields modules `auth`, `user`, and `app`. `typeDefs: "**/*.gql"` resolves to `src/modules/auth/**/*.gql`, `src/modules/user/**/*.gql`, and so on — each module's files belong exclusively to that module. The ID is used as-is as the module's key in `Application` (quoted when it is not a valid identifier).

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

Middleware targets aren't emitted: a module's targets are its owned fields, and the application's are the root fields.

## Supported SDL

- Object types, interfaces, unions, enums, inputs, and scalars
- Lists and nullability (`String`, `[String!]!`, …), mapped exactly
- Type extensions (`extend type User { … }`)
- Root operation types, which must be named `Query`, `Mutation` and `Subscription`

A schema type can't be named `Application`, `Maybe`, `ResolveScalar` or `Scalars`, since the generated file declares those names itself.

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
// Generated by @nxlab/codegen — do not edit.
```

## Relationship to @nxlab/schema

`@nxlab/schema` composes a schema into ordinary GraphQL; `@nxlab/codegen` then turns that GraphQL into TypeScript:

```
SDL → @nxlab/schema → DocumentNode → @nxlab/codegen → TypeScript
```

Codegen has no knowledge of `@implements` or `@copy` — it accepts `SchemaDirective[]` and passes the parsed document through the transformation pipeline.
