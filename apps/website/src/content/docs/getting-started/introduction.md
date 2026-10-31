---
title: Introduction
description: What olio is, what it's for, and the packages it's made of.
sidebar:
  order: 0
---

olio is modular, type-safe GraphQL for TypeScript, in the spirit of `graphql-modules`. You split an API into **modules**. Each one owns its SDL, its resolvers and its middleware, and olio composes them into one `GraphQLSchema` that any GraphQL server can run.

Codegen turns the SDL into types, so every resolver, argument and middleware target is checked at compile time, down to which module is allowed to resolve which field.

## Why modules

One schema file works on day one. A few months later it's the file everyone edits and nobody owns. olio gives each part of the API a home from the start:

- **A module owns what it declares.** It resolves the fields in its own definitions and `extend`s, and only those. Resolving another module's field is an error: at compile time with codegen, and when the schema is built without it.
- **Root types come for free.** Modules `extend type Query`; nobody writes a placeholder `type Query { _empty: String }`. That also means a module can be tested on its own.
- **Middleware is layered.** The app, a module and a feature each add middleware, and the chain for a field runs from the outside in. A field can opt out of a middleware with `@bypass` in its SDL.
- **Large modules split into features**: subfolders that each own part of the module's schema, with their own typed builders.
- **Errors point at files.** SDL and schema errors are reported as `file:line:column: message`.

## The packages

Start with `@nxara/olio`. Everything else is optional.

| Package | What it does |
| --- | --- |
| [`@nxara/olio`](/reference/olio/) | The runtime: modules, typed resolvers and layered middleware, composed into a schema |
| [`@nxara/olio-codegen`](/reference/codegen/) | SDL to TypeScript: schema types, per-module contracts and the `Application` type |
| [`@nxara/olio-schema`](/reference/schema/) | Composes module SDL into one validated schema; the `@implements` and `@copy` directives |
| [`@nxara/olio-tools`](/reference/tools/) | Loads modules, SDL and resolver files from globs |
| [`@nxara/olio-http`](/reference/http/) | Serves an app over HTTP, with Fetch and Node adapters, context, error masking and cleanup |
| [`@nxara/olio-client`](/reference/client/) | A typed client: operations in `.graphql` files, one call per operation |
| [`@nxara/olio-di`](/reference/di/) | Typed dependency injection, with singletons and per-operation instances |

## Next

The [quick start](/getting-started/quick-start/) builds a small API end to end: one module, generated types, a composed app and an HTTP server. [How the pieces fit](/concepts/how-it-fits/) explains what each step does.
