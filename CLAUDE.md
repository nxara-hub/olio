# Nxara

Modular, type-safe GraphQL for TypeScript, a successor in spirit to `graphql-modules`. Bun workspaces + Turborepo, TypeScript 7, ESM only, `graphql` 17 as a peer dependency (no graphql 16 support).

## Layout

- `packages/olio`: runtime. `olio({ modules, middleware, directives })` builds a `GraphQLSchema`. Builders: `module.<id>`, `feature.<id>.<name>`, `mw()` / `mw.<id>` / `mw.<id>.<name>`, `query.<id>[.<name>]`, `mutation…`, `subscription…`, `resolvers.<id>[.<name>].<Type>`.
- `packages/codegen`: SDL → one `generated.ts` (schema types plus `Application`).
- `packages/schema`: `compose()` (module SDL → validated schema + field ownership; adds root types that are only extended) and the `@implements` / `@copy` directives via `applyDirectives`. Codegen and olio both compose through it, so they can't disagree on ownership. Both use one field-copy engine (`src/directives/shared.ts`) that runs in passes, so chains work in any order. `@copy` overrides (later source, then local, wins); `@implements` throws on any redeclaration that changes a field.
- `packages/tools`: `loadModules(...patterns)` / `loadFeatures(...patterns)` / `loadTypeDefs(...patterns)` / `loadResolvers(...patterns)` (globs or `new URL(..., import.meta.url)`). SDL is parsed with its file name so errors carry `file:line:col`; a pattern matching nothing throws.
- `packages/di`: typed DI on Awilix (PROXY injection, `strict`). `createContainer({ productLoader: ProductLoader })` names the services resolvers reach as `ctx.di.productLoader` (typed via `ScopeOf<typeof container>`); factories use typed tokens (`get(ProductStore)`), since name-based deps would make the types circular, and unlisted providers register on first use. Operation scopes travel in `ctx.di` and are disposed through `@nxlab/http`'s `onOperationEnd`. Awilix stays an implementation detail.
- `packages/http`: serving. A core (`core.ts`: context hooks, `errorMasker`) on graphql-http / graphql-sse / graphql-ws, and adapters under subpath exports: `fetch`, `node` (HTTP, plus SSE on the same URL when `Accept: text/event-stream`), `ws`, `bun` (WebSocket). Only `GraphQLError`s reach clients; everything else becomes "Unexpected error." and goes to `onUnexpectedError`. That includes errors thrown by `context` hooks, which the protocol libraries don't handle themselves (`guardContext`, `contextFailure`, `sseFailure` in `core.ts`).
- `apps/example`: the reference app (a small ERP) and the integration test for the whole pipeline.
- `TODO.md`: open work. Check it before starting something new.

## How the pieces connect

1. Codegen discovers modules as the **direct child directories** of `modules/`, and a module's **features** as its direct subfolders in which the `typeDefs` glob finds files of their own (one level, no deeper). It emits `Application`, keyed by owner (`sales`, `"sales/orders"`): `{ [id]: { [Type]: { type; fields; args?; resolveType? } } }`. A module owns the fields it declares, in a definition or an `extend`, on any type. The defining module also owns `__isTypeOf` / `__resolveType`. `args` lists only fields that take arguments. Root types carry `root: "query" | "mutation" | "subscription"`; olio finds roots by that marker, never by name, so custom root names (`schema { query: RootQuery }`) work end to end.
2. The app registers it: `declare module "@nxlab/olio" { interface Olio { application; ctx; sub_ctx; mappers? } }` (see `apps/example/src/types.d.ts`). `mappers` swaps object types for what resolvers return, deeply (`Mapped<>` in olio's `types.ts`).
3. `packages/olio/src/types.ts` derives everything from that: resolver signatures (parent and return types come from `type`), middleware targets (owned fields plus `*` and the `-` forms), module ids. Builders are identity functions behind a Proxy; the safety is in the types.

**Codegen's output shape is olio's input contract.** Change `packages/codegen/src/*` and `packages/olio/src/types.ts` together, then regenerate and type-check the example.

## Middleware semantics

- Nested only: `{ Type: { field | "*": MiddlewareFn[] } }`. `mw()` (app) accepts `"*"` and the root types. `mw.<id>()` accepts the fields the module declares, per type.
- The chain for a resolver runs top-down: app `*.*` → app `Type.*` → app `Type.field` → module `Type.*` → module `Type.field` → (for a feature's field) feature `Type.*` → feature `Type.field`. `mw.<id>` reaches the module's and all its features' fields; `mw.<id>.<feature>` only that feature's.
- A `-` key (`"-user"`, `"-*"`) drops every layer above it; lower layers still apply. `x` together with `-x` in one map is a compile error (`CheckedMiddleware`, via generic middleware builders and module/feature configs) and throws at runtime.
- Middleware wraps the resolvers modules define, plus any field named explicitly (its default resolver gets wrapped). `"*"` only reaches fields with a resolver. A subscription field is a function returning `AsyncIterable<field value>` (only form); olio sets an identity `resolve`, and middleware wraps `subscribe` (runs once per subscription). `Subscription` middleware gets `sub_ctx`; `"*"` gets `ctx | sub_ctx`.
- `olio()` checks every middleware key at runtime and enforces ownership: a module resolves only fields it declares (`compose` ownership), the same rule codegen types.
- Features (`feature.<id>.<name>`, loaded with `loadFeatures`) are isolated owners like modules: each resolves only what its SDL declares. In olio's runtime, modules and features flatten into `Owner`s (`olio.ts`), each with the middleware layers above it.

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
bun run --cwd apps/example serve     # the example over HTTP + WebSocket (Hono on Node, via tsx)
```

## Gotchas

- Workspace packages resolve to `dist/`. After changing a package, run `bun run build` before type-checking or running the example.
- `generated.ts` is generated (and lint/format ignored). Never hand-edit it; rerun codegen. `.gql` files are not formatted by oxfmt.
- Relative imports use `.js` specifiers (`nodenext`). `noUncheckedIndexedAccess` is on.
- Olio must work with and without codegen. `packages/olio/test` registers nothing, so its type-check covers the untyped mode (`createModule` and inline resolver maps, no implicit `any`).
- `packages/olio/test/typed/` is olio's typed contract test: `check-types` regenerates `generated.ts` from its fixture SDL with codegen, then type-checks `contract.ts` against `src/` (it augments `src/types.ts`, not the build). Add an `@ts-expect-error` there for any new type behaviour.
- Inline resolver maps in `module.<id>({ resolvers })` / `feature…({ resolvers })` are typed (`OwnerResolvers`). `loadResolvers` returns the branded `LoadedResolvers`, which passes through unchecked; the brand is what keeps inline maps from matching the loose type.
- Enum internal values: types via codegen's `CustomEnums` (they affect args and inputs too), values via `resolvers.<id>.<Enum>({...})`. At runtime olio sets each `GraphQLEnumValue.value` before the schema is used; graphql 17 builds its value lookup lazily and coerces defaults per operation.
- `apps/example/src/type-checks.ts` holds `@ts-expect-error` lines that must keep failing. A passing type-check is what proves the type contract.
- A Claude Code hook runs `bun run fix` after every edit.

## Code standards

Enforced by Ultracite (oxlint + oxfmt). Run `bun run check` before finishing.

- Explicit types on exported functions; `unknown` over `any`; narrow instead of casting where possible (the builders' Proxy casts are the deliberate exception).
- Throw `Error`/`TypeError` with messages that name the module and target, e.g. `Module "users": unknown field "Query.nope"`.
- `for...of`, `const`, early returns, small focused functions. No stray `console.log` in packages. Codegen's `logs` option is the one intended output.
- Tests live in `<package>/test/*.test.ts` using `bun:test`. Keep them flat. Runtime behaviour gets a test; type contracts get an `@ts-expect-error` line.
- Keep it small: no speculative options or abstractions; the TODO list is where "later" goes.
