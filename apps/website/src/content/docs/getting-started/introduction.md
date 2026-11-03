---
title: Introduction
description: What olio is, why you'd use it, and which packages it's made of.
sidebar:
  order: 0
---

olio is modular, type-safe GraphQL for TypeScript. This page explains what it does and which packages you need.

You write the schema first, in SDL, and split the API into **modules**. Each module owns its SDL, its resolvers and its middleware. olio composes the modules into one `GraphQLSchema` that any GraphQL server can run.

Codegen turns the SDL into TypeScript types, so resolvers, arguments and middleware targets are checked at compile time, down to which module may resolve which field. Resolvers are checked when written with the builders (`query.users(...)`) or inline in a module. A plain object in a file `loadResolvers` picks up isn't type-checked.

## Why modules

One schema file works on day one. A few months later, it's the file everyone edits and nobody owns. olio gives each part of the API a home from the start:

- **A module owns what it declares.** It resolves the fields in its own definitions and `extend`s, and only those. Resolving another module's field is an error: at compile time with codegen, and at runtime when `olio()` builds the schema, with or without codegen.
- **Root types come for free.** Modules `extend type Query`, so nobody writes a placeholder `type Query { _empty: String }`. That also means a module that uses only its own types can be tested on its own.
- **Middleware is layered.** The app, a module and a feature each add middleware, and the chain for a field runs from the outside in. A field can ask middleware to skip it with `@bypass(keys: ...)` in its SDL, and each middleware checks the keys and decides.
- **Large modules split into features.** A feature is a subfolder that owns part of the module's schema, with its own typed builders.
- **Errors point at files.** SDL and schema errors are reported as `file:line:column: message`.

## The packages

Start with `@nxara/olio`, the runtime. Every other package is optional.

| Package | What it does |
| --- | --- |
| [`@nxara/olio`](/reference/olio/) | The runtime: modules, typed resolvers and layered middleware, composed into a schema |
| [`@nxara/olio-codegen`](/reference/codegen/) | SDL to TypeScript: schema types, per-module contracts and the `Application` type |
| [`@nxara/olio-schema`](/reference/schema/) | Composes module SDL into one validated schema, with the `@implements` and `@copy` directives |
| [`@nxara/olio-tools`](/reference/tools/) | Loads modules, features, SDL, resolvers and enums from globs |
| [`@nxara/olio-http`](/reference/http/) | Serves an app over HTTP, with Fetch and Node adapters, context, error masking and cleanup |
| [`@nxara/olio-client`](/reference/client/) | A typed client: operations in `.graphql` files, one call per operation |
| [`@nxara/olio-di`](/reference/di/) | Typed dependency injection, with singletons and per-operation instances |

## Next

The [quick start](/getting-started/quick-start/) builds a small API end to end: one module, generated types, a composed app and an HTTP server. [How the pieces fit](/concepts/how-it-fits/) explains what each step does.
