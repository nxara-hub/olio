---
title: Project structure
description: How olio finds modules and features on disk, and what goes in each folder.
sidebar:
  order: 1
---

Codegen finds modules by folder, so the layout is the configuration. A typical app:

```
src/
├── app.ts                 # olio({ modules, middleware, directives })
├── olio.d.ts              # registers Application, ctx, mappers
├── generated.ts           # written by codegen; never edit by hand
└── modules/
    ├── users/             # module "users"
    │   ├── index.ts       # module.users({ typeDefs, resolvers, middleware })
    │   ├── typedefs/
    │   │   └── users.gql
    │   ├── query.ts       # export const Query = query.users({ ... })
    │   ├── mutation.ts
    │   └── resolvers/
    │       └── user.ts    # export const User = resolvers.users.User({ ... })
    └── sales/             # a module split into features
        ├── index.ts       # module-wide middleware; loads its features
        ├── typedefs/      # SDL the module itself owns (optional)
        ├── customers/     # feature "customers"
        │   ├── index.ts
        │   ├── typedefs/customers.gql
        │   └── query.ts
        └── orders/        # feature "orders"
            ├── index.ts
            ├── typedefs/orders.gql
            └── query.ts  mutation.ts
```

## Modules

Every **direct child folder** of the `modules` directory you give codegen is a module, named after the folder. Its SDL is whatever the `typeDefs` glob matches inside it, for example `**/typedefs/**/*.gql`.

Resolver files export one object per type, named after the type, built with a typed helper: `export const Query = query.users({...})`. `loadResolvers` collects them by export name.

## Features

A **direct subfolder** of a module becomes a feature when the `typeDefs` glob finds SDL files of its own there. With `**/typedefs/**/*.gql`, `sales/orders/typedefs/` makes `orders` a feature, while `sales/typedefs/` stays the module's own SDL. Features don't nest: deeper folders belong to their feature.

A feature owns the fields its SDL declares, exactly like a module, and has its own builders: `query.sales.orders`, `mw.sales.orders`. Middleware nests app, then module, then feature. Feature folders can't share a name with a type the module declares.

## Testing a module

Because root types come for free, a module that only extends `Query` or `Mutation` composes on its own:

```ts
const app = olio({ modules: [usersModule] });
```

A module that uses another module's types takes that module too: `olio({ modules: [catalog, reviews] })`.

The repo's [example server](https://github.com/nxara-hub/olio/tree/main/apps/example-server), a small ERP with auth, inventory and sales split into features, shows every part of this layout.
