---
name: olio
description: Builds and changes GraphQL APIs with olio (@nxara/olio), modular, type-safe, schema-first GraphQL for TypeScript. Use when a project depends on @nxara/olio or another @nxara/olio-* package, or when the user wants to add a module, feature, resolver, middleware, @bypass, codegen, an HTTP handler or a typed client to an olio app.
license: MIT
metadata:
  docs: https://olio.nxara.dev/llms-full.txt
---

# olio

olio splits a GraphQL API into **modules**. Each module owns its SDL, resolvers and middleware, and `olio()` composes them into one `graphql` 16 `GraphQLSchema`. Codegen turns the SDL into types, so resolvers, arguments and middleware keys are checked at compile time.

The full documentation, as one file: https://olio.nxara.dev/llms-full.txt. Read it when something here isn't enough.

## Packages

| Package | For |
| --- | --- |
| `@nxara/olio` | `olio()` and the builders (`module`, `feature`, `query`, `mutation`, `subscription`, `resolvers`, `mw`) |
| `@nxara/olio-codegen` | `codegen()` (dev dependency): SDL to `generated.ts` |
| `@nxara/olio-tools` | `loaders(import.meta.dirname)`: load SDL, resolvers, modules and features from files |
| `@nxara/olio-http` | `fetchHandler` / `nodeHandler`: GraphQL over HTTP |
| `@nxara/olio-client` | A typed client from `.graphql` operations |
| `@nxara/olio-di` | Typed dependency injection, `ctx.di` |
| `@nxara/olio-schema` | `@copy` / `@implements` schema directives |

ESM only. `graphql` must be version **16**, never 17. Bun, or Node 24+.

## Layout

```
codegen.ts
src/
  olio.d.ts              # registers the generated types
  generated.ts           # written by codegen, never edit by hand
  app.ts                 # olio({ modules })
  server.ts
  modules/
    users/               # module id = folder name
      index.ts           # module.users({...})
      query.ts           # query.users({...})
      resolvers/*.ts     # resolvers.users.User({...})
      typedefs/*.gql
      admin/             # a feature: a subfolder with SDL of its own
        index.ts         # feature.users.admin({...})
        typedefs/*.gql
```

## Setting up

```ts
// codegen.ts: run with `bun codegen.ts` (or `node codegen.ts`) after every SDL change
import { codegen } from "@nxara/olio-codegen";

await codegen({
  root: import.meta.dirname,
  modules: "src/modules",
  typeDefs: "**/typedefs/**/*.gql",
  output: "src/generated.ts"
});
```

```ts
// src/olio.d.ts
import type { Application } from "./generated.js";

declare module "@nxara/olio" {
  interface Olio {
    application: Application;
    ctx: { userId?: string }; // what your server's `context` hook returns
  }
}
```

Declare the context with `type` or inline, not `interface`: graphql-sse's `createHandler<SubscriptionContext>` rejects interfaces.

```graphql
# src/modules/users/typedefs/users.gql: modules extend the root types
type User {
  id: ID!
  name: String!
}

extend type Query {
  user(id: ID!): User
}
```

```ts
// src/modules/users/query.ts
import { query } from "@nxara/olio";

const users = new Map([["1", { id: "1", name: "Ada" }]]);

export const Query = query.users({
  user: (_root, { id }) => users.get(id) ?? null // id is typed from the SDL
});
```

```ts
// src/modules/users/index.ts
import { module } from "@nxara/olio";
import { loaders } from "@nxara/olio-tools";

const load = loaders(import.meta.dirname);

export const usersModule = module.users({
  typeDefs: await load.typeDefs("typedefs/*.gql"),
  // .js too, so the same pattern finds the files once compiled. Add
  // "resolvers/*.{js,ts}" once that folder has files: a pattern matching
  // nothing throws.
  resolvers: await load.resolvers("query.{js,ts}")
});
```

```ts
// src/app.ts
import { olio } from "@nxara/olio";
import { loaders } from "@nxara/olio-tools";

const load = loaders(import.meta.dirname);

export const app = olio({
  modules: await load.modules("modules/*/index.{js,ts}")
});
```

```ts
// src/server.ts: once `ctx` is registered, `context` is required
import { fetchHandler } from "@nxara/olio-http/fetch";

import { app } from "./app.js";
import { verifyToken } from "./auth.js";

const graphql = fetchHandler(app, {
  context: (request) => ({
    userId: verifyToken(request.headers.get("authorization"))
  })
});

Bun.serve({ port: 4000, fetch: graphql });
```

`verifyToken` is the app's own: it returns the user id for a valid, signed token and `undefined` otherwise. Never take the user from a header the client sets, such as `x-user-id`. Middleware like `requireAuth` below trusts whatever `ctx.userId` holds. An invalid token gives `undefined`, not an error, so public fields still work.

On Node, use `nodeHandler` from `@nxara/olio-http/node` with `createServer`. `app.schema` also runs on GraphQL Yoga, Apollo Server or any server that takes a `GraphQLSchema`.

## Rules

- **A module resolves only what its SDL declares**, in a definition or an `extend`. Writing another module's field fails at compile time and at startup with `'User.name' is not declared by posts module`. To add a field to another module's type, `extend type User { posts: [Post!]! }` in your own module's SDL, then resolve it in your module.
- **Always write resolvers with the builders** (`query.<id>`, `resolvers.<id>.<Type>`, ...) or inline in `module.<id>({ resolvers })`. A plain object loaded from a file isn't type-checked.
- **Rerun codegen after changing SDL**, then type-check. Never edit `generated.ts`.
- **Features** (`feature.<id>.<name>`) are isolated like modules: each resolves only its own SDL. Load them with `load.features("*/index.{js,ts}")` in the module's `index.ts`, and keep the module's own patterns out of the feature folders (`typedefs/*.gql`, not `**/typedefs/*.gql`).
- **Mappers**: register `mappers: { User: UserRow }` in `Olio` when resolvers return database rows instead of the GraphQL shape.

## Middleware

Middleware maps are nested, `{ Type: { field | "*": [fns] } }`:

```ts
import { mw, type MiddlewareFn } from "@nxara/olio";
import { GraphQLError } from "graphql";

const requireAuth =
  (): MiddlewareFn =>
  ({ ctx, bypass }, next) => {
    if (!ctx.userId && !bypass.has("auth")) {
      throw new GraphQLError("Unauthorized", {
        extensions: { code: "UNAUTHENTICATED" }
      });
    }
    return next();
  };

export const middleware = mw({ Query: { "*": [requireAuth()] } }); // pass to olio({ middleware })
```

- `mw({...})` is for the application (`"*"` and root types). `mw.<id>({...})`, or a module's `middleware` option, covers that module and its features. `mw.<id>.<feature>({...})`, or a feature's `middleware` option, covers only that feature.
- The chain runs app `*.*`, app `Type.*`, app `Type.field`, then the module's, then the feature's.
- `"*"` covers every field of that type, including fields with no resolver of their own. A module's or feature's `"*"` covers only the fields it declares, not ones another module adds to the type. `"*": { "*": [...] }` covers every field of every type, so a logger there should skip nested fields: `if (info.path.prev) return next()`.
- Always `return next()`. Calling it twice doesn't run the resolver twice: later calls get the first result, with a warning.
- Changing `params.ctx` reaches only that field's resolver, not nested fields. Pass values down by returning them from the parent (`root`), or set them in the server's `context` hook.
- Throw a `GraphQLError` for errors clients should see. With `@nxara/olio-http`, anything else reaches them as "Unexpected error." and goes to `onUnexpectedError`. Other servers differ: Apollo Server sends the real message unless its `formatError` hides it.

## Skipping middleware: `@bypass`

```graphql
extend type Mutation {
  login(email: String!, password: String!): Session @bypass(keys: "auth")
}

type Session @bypass(keys: "auth") {
  token: String!
}
```

The middleware decides (`bypass.has("auth")`). `@bypass` applies only to the fields it marks: with auth on `"*": { "*": ... }`, the type a public field returns needs it too, as `Session` does here. It never reaches the served schema.

## Errors and what they mean

| Error | Meaning |
| --- | --- |
| `'User.name' is not declared by posts module` | That field belongs to another module. At compile time it also means a typo or a field the SDL doesn't have |
| `Module "users": unknown field "Query.usr". Did you mean "user"?` | At startup: no type in the SDL has that field. Fix the name, or add the field to the module's SDL and rerun codegen |
| `No files match "<path>"` | A loader pattern found nothing: check the path, relative to the `loaders` root |
| `Unknown directive "@copy"` | Pass `directives: [copyDirective(), implementsDirective()]` from `@nxara/olio-schema` to both `codegen()` and `olio()` |
| `Field "User.x" can only be defined once` | Two modules declare the same field: only one may |
| `Unauthorized` / `UNAUTHENTICATED` on a field you expected to be public | Add `@bypass` on that field, and on the types it returns if auth is on `*.*` |

## HTTP options

`fetchHandler(app, { context, validationRules, onOperationEnd, introspection, suggestions, maskErrors, onUnexpectedError })`. Set `introspection: false` and `suggestions: false` in production to hide the schema. Subscriptions aren't included: run graphql-ws or graphql-sse with `app.schema`, as https://olio.nxara.dev/reference/http/ shows.
