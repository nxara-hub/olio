# Nxara

Modular, type-safe GraphQL for TypeScript, a successor in spirit to `graphql-modules`. Bun workspaces + Turborepo, TypeScript 7, ESM only, `graphql` 16 or 17 as a peer dependency (dev runs on 17; keep both working, e.g. scalars copy both coercion method names, defaults are read from the SDL node).

## Layout

- `packages/olio`: runtime. `olio({ modules, middleware, directives })` builds a `GraphQLSchema`. Builders: `module.<id>`, `mw()` / `mw.<id>`, `query.<id>`, `mutation.<id>`, `subscription.<id>`, `resolvers.<id>.<Type>`.
- `packages/codegen`: SDL → one `generated.ts` (schema types plus `Application`).
- `packages/schema`: `compose()` (module SDL → validated schema + field ownership; adds root types that are only extended) and the `@implements` / `@copy` directives via `applyDirectives`. Codegen and olio both compose through it, so they can't disagree on ownership. Both use one field-copy engine (`src/directives/shared.ts`) that runs in passes, so chains work in any order. `@copy` overrides (later source, then local, wins); `@implements` throws on any redeclaration that changes a field.
- `packages/tools`: `loadModules(...patterns)` / `loadTypeDefs(...patterns)` / `loadResolvers(...patterns)` (globs or `new URL(..., import.meta.url)`). SDL is parsed with its file name so errors carry `file:line:col`; a pattern matching nothing throws.
- `apps/example`: the reference app and the integration test for the whole pipeline.
- `TODO.md`: open work. Check it before starting something new.

## How the pieces connect

1. Codegen discovers modules as the **direct child directories** of `modules/` and emits `Application`: `{ [id]: { [Type]: { type; fields; args?; resolveType? } } }`. A module owns the fields it declares, in a definition or an `extend`, on any type. The defining module also owns `__isTypeOf` / `__resolveType`. `args` lists only fields that take arguments. Root types carry `root: "query" | "mutation" | "subscription"`; olio finds roots by that marker, never by name, so custom root names (`schema { query: RootQuery }`) work end to end.
2. The app registers it: `declare module "@nxlab/olio" { interface Olio { application; ctx; sub_ctx; mappers? } }` (see `apps/example/src/types.d.ts`). `mappers` swaps object types for what resolvers return, deeply (`Mapped<>` in olio's `types.ts`).
3. `packages/olio/src/types.ts` derives everything from that: resolver signatures (parent and return types come from `type`), middleware targets (owned fields plus `*` and the `-` forms), module ids. Builders are identity functions behind a Proxy; the safety is in the types.

**Codegen's output shape is olio's input contract.** Change `packages/codegen/src/*` and `packages/olio/src/types.ts` together, then regenerate and type-check the example.

## Middleware semantics

- Nested only: `{ Type: { field | "*": MiddlewareFn[] } }`. `mw()` (app) accepts `"*"` and the root types. `mw.<id>()` accepts the fields the module declares, per type.
- The chain for a resolver runs top-down: app `*.*` → app `Type.*` → app `Type.field` → module `Type.*` → module `Type.field`.
- A `-` key (`"-user"`, `"-*"`) drops every layer above it; lower layers still apply. `x` together with `-x` throws.
- Middleware wraps the resolvers modules define, plus any field named explicitly (its default resolver gets wrapped). `"*"` only reaches fields with a resolver. A subscription field is a function returning `AsyncIterable<field value>` (only form); olio sets an identity `resolve`, and middleware wraps `subscribe` (runs once per subscription). `Subscription` middleware gets `sub_ctx`; `"*"` gets `ctx | sub_ctx`.
- `olio()` checks every middleware key at runtime and enforces ownership: a module resolves only fields it declares (`compose` ownership), the same rule codegen types.
- A module's `middleware` can be a list (one map per feature folder). The maps merge in order and apply module-wide.

## Commands

```sh
bun install
bun run build                        # all packages (tsc → dist)
bun run test                         # bun:test in every package
bun run check-types                  # builds dependencies first
bun run check                        # ultracite: oxlint + oxfmt; `bun run fix` to apply
bun test                             # inside one package
bun run --cwd apps/example codegen   # regenerate src/generated.ts + src/schema.gql
bun run --cwd apps/example start     # run the example end to end
```

## Gotchas

- Workspace packages resolve to `dist/`. After changing a package, run `bun run build` before type-checking or running the example.
- `generated.ts` is generated (and lint/format ignored). Never hand-edit it; rerun codegen. `.gql` files are not formatted by oxfmt.
- Relative imports use `.js` specifiers (`nodenext`). `noUncheckedIndexedAccess` is on.
- Olio must work with and without codegen. `packages/olio/test` registers nothing, so its type-check covers the untyped mode (`createModule` and inline resolver maps, no implicit `any`).
- `apps/example/src/type-checks.ts` holds `@ts-expect-error` lines that must keep failing. A passing type-check is what proves the type contract.
- A Claude Code hook runs `bun run fix` after every edit.

## Code standards

Enforced by Ultracite (oxlint + oxfmt). Run `bun run check` before finishing.

- Explicit types on exported functions; `unknown` over `any`; narrow instead of casting where possible (the builders' Proxy casts are the deliberate exception).
- Throw `Error`/`TypeError` with messages that name the module and target, e.g. `Module "users": unknown field "Query.nope"`.
- `for...of`, `const`, early returns, small focused functions. No stray `console.log` in packages. Codegen's `logs` option is the one intended output.
- Tests live in `<package>/test/*.test.ts` using `bun:test`. Keep them flat. Runtime behaviour gets a test; type contracts get an `@ts-expect-error` line.
- Keep it small: no speculative options or abstractions; the TODO list is where "later" goes.
