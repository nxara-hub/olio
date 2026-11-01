---
title: How the pieces fit
description: How module SDL becomes a typed, served schema, and which package does each step.
sidebar:
  order: 0
---

This page follows an olio app from SDL files to a running schema, and shows which package does each step. There are three steps: compose, generate and build the schema. Codegen runs the first two at build time. At runtime, olio composes the SDL again and builds the schema.

```
modules/*/typedefs/*.gql ─→ @nxara/olio-schema ─→ @nxara/olio-codegen ─→ generated.ts (Application)
                                    │                                      │ declare module "@nxara/olio"
                                    └──────────→ @nxara/olio ←─────────────┘
                                                     │
                                               GraphQLSchema
```

## 1. Compose

[`@nxara/olio-schema`](/reference/schema/) merges every module's SDL into one validated schema and records **ownership**: which module declared which field. A module owns the fields in its own definitions and `extend`s, on any type. The module that defines a type also owns its `__isTypeOf` / `__resolveType`.

Codegen and the runtime both compose through this package, so they never disagree about who owns what.

## 2. Generate

[`@nxara/olio-codegen`](/reference/codegen/) reads the same SDL and writes one `generated.ts`. It holds the schema's types and an `Application` type, keyed by module (and `"module/feature"`), that lists each module's types, fields and arguments.

You register it once, in any `.d.ts` or `.ts` file of the app:

```ts
// src/olio.d.ts
import type { Application } from "./generated.js";

declare module "@nxara/olio" {
  interface Olio {
    application: Application;
    ctx: { userId?: string }; // what your server passes as context
  }
}
```

The `import` matters: it makes the file a module, so `declare module` adds to olio's types instead of replacing them.

From then on, every builder is typed from it:

- `query.users({...})` accepts exactly the fields `users` declares on `Query`, with their arguments and return types.
- `mw.users({...})` accepts exactly the fields it may wrap: its own and its features', plus `*`.
- Resolving another module's field is a compile error at that field.

## 3. Build the schema

At runtime, [`@nxara/olio`](/reference/olio/) takes the modules and builds the executable `GraphQLSchema`. It composes the SDL again, attaches the resolvers, wraps them in their middleware layers and checks every key. So the rules codegen enforces in types also hold without codegen.

`app.schema` is a plain `GraphQLSchema`. [`@nxara/olio-http`](/reference/http/) serves it over HTTP, but any server that takes a schema works: graphql-http, Yoga, Apollo.

## With or without codegen

Codegen is optional. Without it, you build modules with `createModule` / `createFeature`, and write SDL as strings and resolvers as plain maps keyed by type. Everything behaves the same at runtime (middleware layers, features, enum values, subscriptions). Only the types are looser. See [Without codegen or tools](/reference/olio/#without-codegen-or-tools).

[`@nxara/olio-tools`](/reference/tools/) is optional too. It loads modules, SDL and resolver files from globs, so `index.ts` files stay short. You can always list modules yourself: `olio({ modules: [usersModule, authModule] })`.
