# Nxara

Modular, type-safe GraphQL for TypeScript, a successor in spirit to `graphql-modules`. Bun workspaces + Turborepo, TypeScript 7, ESM only, `graphql` 16 (16.13+) as a peer dependency. Not 17: 17.0.2 creates and aborts an `AbortController` per execution, which makes small queries about 4× slower.

## Layout

- `packages/core`: the contracts the packages share, so no package depends on olio: the `Olio` registration interface and `Context`, `OlioModule` / `OlioFeature` / `ResolverMap` / `StoredMiddleware`, the `LoadedResolvers` / `LoadedEnums` brands, `TypeSource`, `Pattern`. olio re-exports them (apps still augment `"@nxara/olio"`; it merges into core's interface). `@nxara/olio-core/files` (Node only) holds `matchFiles` and `loadGraphQLFile`, the one GraphQL file loader (SDL and operations). Apps never import core.
- `packages/olio`: runtime. `olio({ modules, middleware, directives })` builds a `GraphQLSchema`. Builders: `module.<id>`, `feature.<id>.<name>`, `mw()` / `mw.<id>` / `mw.<id>.<name>`, `query.<id>[.<name>]`, `mutation…`, `subscription…`, `resolvers.<id>[.<name>].<Type>`.
- `packages/codegen`: SDL → one `generated.ts` (schema types plus `Application`). It reads files through `@nxara/olio-core/files`, like tools (`.gql` or `.ts` default exports).
- `packages/schema`: `compose()` (module SDL → validated schema + field ownership; adds root types that are only extended) and the `@implements` / `@copy` directives via `applyDirectives`. Codegen and olio both compose through it, so they can't disagree on ownership. Both use one field-copy engine (`src/directives/shared.ts`) that runs in passes, so chains work in any order. `@copy` overrides (later source, then local, wins); `@implements` throws on any redeclaration that changes a field.
- `packages/tools`: `loadModules(...patterns)` / `loadFeatures(...patterns)` / `loadTypeDefs(...patterns)` / `loadResolvers(...patterns)` / `loadEnums(...patterns)` (branded `LoadedEnums`, satisfies a required `enums` unchecked) (globs or `new URL(..., import.meta.url)`). SDL is parsed with its file name so errors carry `file:line:col`; a pattern matching nothing throws.
- `packages/di`: typed DI on Awilix (PROXY injection, `strict`). `createContainer({ productLoader: ProductLoader })` names the services resolvers reach as `ctx.di.productLoader` (typed via `ScopeOf<typeof container>`); factories use typed tokens (`get(ProductStore)`), since name-based deps would make the types circular, and unlisted providers register on first use. Operation scopes travel in `ctx.di` and are disposed through `@nxara/olio-http`'s `onOperationEnd`. Awilix stays an implementation detail.
- `packages/http`: GraphQL over HTTP only, on graphql-http (its only dependency): `fetch` and `node` adapters under subpath exports, with `context` (required by the types once the app registers `ctx`: `ContextOption` / `OptionsArgs` in `core.ts`), error masking, `validationRules` (added to graphql's own, never replacing them; `validateOperation` applies the same in subscription servers' `onSubscribe`) and `onOperationEnd`. graphql-http's other options pass through as they are (`GraphQLHttpOptions` in `core.ts`), except `onSubscribe`, whose returned args would skip `context` and validation. Only `GraphQLError`s reach clients; everything else becomes "Unexpected error." and goes to `onUnexpectedError`, including errors thrown by `context` hooks (`contextFailure` in `core.ts`). No subscriptions, by design (like Apollo Server): apps run graphql-ws / graphql-sse themselves, with `errorMasker` for the same masking (`apps/example-server/src/subscriptions.ts`).
- `packages/client`: `createClient(operations, { url, headers, fetch })` / `testClient` (`@nxara/olio-client/test`): one call per operation, `client.mutation.login(variables, { headers, signal })`, named after the operation (first letter lowercased). Operations are `.graphql` files the client writes; codegen's `codegenClient({ schema, documents, output })` (`emit-client.ts`) validates them against a schema file or a URL (introspection) and emits, graphql-codegen style, `LoginMutation` / `LoginMutationVariables` / `LoginDocument` plus the `operations` map. Results are typed from the selection: abstract types become a union per possible type, `@include`/`@skip` fields optional. Scalars go through `ClientScalars` (one type, or `{ input; output }`, like the server's `CustomScalars`). `fetch` is anything fetch-shaped (ky); libraries that aren't (axios) need an adapter in the app. `fetch` also gets the request before JSON (`RequestParams`, its third argument), so an app can send files as multipart itself; the server side is graphql-http's `parseRequestParams`, passed through by olio-http (client README, Uploading files). Subscriptions go through the app's own graphql-ws client (`ws`) unless the operation says `@sse` (its graphql-sse client, `sse`): the client never creates or configures them (connecting, retries, `connectionParams`, `terminate()` to reconnect are the app's), it calls their `iterate`, types the results, and turns what graphql-ws throws for a 4xxx close or an operation's errors into an error result (`errorResult` in `src/transport.ts`). Codegen strips the directive, records `transport` in the document and lists the transports used (`operations.transports`), which makes `ws` / `sse` required in `createClient`'s options exactly when used. `url`/`headers`/`fetch` are for queries and mutations. `testClient` lives in `@nxara/olio-client/test` (never in app bundles): it runs the app's own servers, `{ http, ws, sse }` (its fetch handler, the graphql-ws options it passes to `useServer`, run over an in-memory socket, and its graphql-sse handler; `ws` / `sse` required exactly when used), through clients of its own that never retry. `TypedDocument` carries its types under the string key `"~types"`, not a symbol, so they match across copies of the package.
- `apps/example-server`: the reference app (a small ERP) and the integration test for the whole pipeline. Its tests live in `test/`, outside `src`: `api.test.ts` drives it through `testClient` with the server's own `graphqlHandler`, `wsOptions` and `sseHandler`, `type-checks.ts` holds compile-time checks.
- `apps/example-client`: a separate client app on `@nxara/olio-client`, talking to the running server over HTTP. Its operations are `src/operations/*.graphql`; its types come from the server's `src/schema.gql` (or `SCHEMA_URL`) through `codegenClient`, never from server code.
- `TODO.md`: open work. Check it before starting something new.

## How the pieces connect

1. Codegen discovers modules as the **direct child directories** of `modules/`, and a module's **features** as its direct subfolders in which the `typeDefs` glob finds files of their own (one level, no deeper). It emits `Application`, keyed by owner (`sales`, `"sales/orders"`): `{ [id]: { [Type]: { type; fields; args?; resolveType?; bypass? } } }`, plus `"~directives"` (the names of the schema directives it composed with; olio's `OlioConfig` then requires `directives`, typed `SchemaDirective<DirectiveName>`). A module owns the fields it declares, in a definition or an `extend`, on any type. The defining module also owns `__isTypeOf` / `__resolveType`. `args` lists only fields that take arguments. Root types carry `root: "query" | "mutation" | "subscription"`; olio finds roots by that marker, never by name, so custom root names (`schema { query: RootQuery }`) work end to end.
2. The app registers it: `declare module "@nxara/olio" { interface Olio { application; ctx; sub_ctx; mappers? } }` (see `apps/example-server/src/types.d.ts`). `mappers` swaps object types for what resolvers return, deeply (`Mapped<>` in olio's `types.ts`).
3. `packages/olio/src/types.ts` derives everything from that: resolver signatures (parent and return types come from `type`), middleware targets (owned fields plus `*`), module ids. Builders are identity functions behind a Proxy; the safety is in the types.

**Codegen's output shape is olio's input contract.** Change `packages/codegen/src/*` and `packages/olio/src/types.ts` together, then regenerate and type-check the example.

## Middleware semantics

- Nested only: `{ Type: { field | "*": MiddlewareFn[] } }`. `mw()` (app) accepts `"*"` and the root types. `mw.<id>()` accepts the fields the module declares, per type.
- The chain for a resolver runs top-down: app `*.*` → app `Type.*` → app `Type.field` → module `Type.*` → module `Type.field` → (for a feature's field) feature `Type.*` → feature `Type.field`. `mw.<id>` reaches the module's and all its features' fields; `mw.<id>.<feature>` only that feature's.
- Skipping is per field, through SDL: `@bypass(keys: "auth")` on a field, or on an object type / `extend` block (its own fields). `compose()` reads and strips it (`bypass: Map<"Type.field", Set<key>>`, `src/bypass.ts` in schema); codegen emits each owner's keys per field in `Application` (`bypass: { login: "auth" }`); olio hands each field's set to its middleware as `params.bypass`, typed `ReadonlySet<BypassKey>`. Middleware decides (`if (bypass.has("auth")) return next()`); olio drops nothing itself.
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
bun run --cwd apps/example-server codegen   # regenerate src/generated.ts + src/schema.gql
bun run --cwd apps/example-server start     # run the example end to end
bun run --cwd apps/example-server serve     # the example over HTTP, SSE and WebSocket (Hono on Node, via tsx)
bun run --cwd apps/example-server bench     # olio-tools' load functions vs the same app wired by hand (bench/wired.ts)
bun run --cwd apps/example-client codegen   # client types from the server's schema.gql
bun run --cwd apps/example-client start     # the client walkthrough, against a running `serve`
bun run release 0.3.0                       # every package to 0.3.0, committed and tagged; pushing the tag publishes (.github/workflows/release.yml)
```

## Gotchas

- Workspace packages resolve to `dist/`. After changing a package, run `bun run build` before type-checking or running the example.
- Publish only through a pushed tag (`bun run release`, then `.github/workflows/release.yml`). bun packs, since it rewrites `workspace:*`; npm publishes, since only npm signs in with trusted publishing (OIDC, no token). npm runs outside the repo: the root's `devEngines` makes it refuse to run inside.
- Tool versions live in `mise.toml` / `mise.lock` (bun, node, zizmor); change them with `mise use`, then `mise lock --platform linux-x64,linux-arm64,macos-arm64`. Workflows pin actions to commit SHAs and pass zizmor (`zizmor .github/workflows`).
- `generated.ts` is generated (and lint/format ignored). Never hand-edit it; rerun codegen. `.gql` files are not formatted by oxfmt.
- Relative imports use `.js` specifiers (`nodenext`). `noUncheckedIndexedAccess` is on.
- `@nxara/olio-http`'s `onOperationEnd(ctx)` runs once per operation, after the HTTP response. Subscription servers are the app's, so ending their contexts is too (see `apps/example-server/src/subscriptions.ts`).
- Olio must work with and without codegen. `packages/olio/test` registers nothing, so its type-check covers the untyped mode (`createModule` and inline resolver maps, no implicit `any`).
- `packages/olio/test/typed/` is olio's typed contract test: `check-types` regenerates `generated.ts` from its fixture SDL with codegen, then type-checks `contract.ts` against `src/` (it augments `src/types.ts`, not the build). Add an `@ts-expect-error` there for any new type behaviour.
- A field resolver is a function or `{ resolve?, extensions? }` (`FieldResolver`; subscriptions too, with the generator as `resolve`). `extensions` land on the schema field (`applyField` / `fieldParts` in `olio.ts`) and are typed by the strict, augmentable `FieldExtensions<Source, Args>` plus the named keys of graphql's `GraphQLFieldExtensions` (its index signature stripped, so typos fail).
- Inline resolver maps in `module.<id>({ resolvers })` / `feature…({ resolvers })` are typed (`OwnerResolvers`). `loadResolvers` returns the branded `LoadedResolvers`, which passes through unchecked; the brand is what keeps inline maps from matching the loose type.
- Enum internal values: types via codegen's `CustomEnums` (they affect args and inputs too), values via the owner's `enums` option (`EnumsOption` in olio's `types.ts`: required once `CustomEnums` gives one of its enums internal values, detected as `type` differing from the `enum` names in `Application`; `resolvers.<id>.<Enum>({...})` types a map in its own file). An enum key in `resolvers` throws; an enum nobody supplied values for explains the per-query serialize error (`explainMissingValues`). At runtime olio sets each `GraphQLEnumValue.value` before the schema is used (graphql builds its value lookup lazily), then re-coerces every argument and input default from its SDL literal (`coerceDefaults`), since graphql 16 coerced them when the schema was built.
- `apps/example-server/test/type-checks.ts` holds `@ts-expect-error` lines that must keep failing. A passing type-check is what proves the type contract.
- A Claude Code hook runs `bun run fix` after every edit.

## Code standards

Enforced by Ultracite (oxlint + oxfmt). Run `bun run check` before finishing.

- Explicit types on exported functions; `unknown` over `any`; narrow instead of casting where possible (the builders' Proxy casts are the deliberate exception).
- Throw `Error`/`TypeError` with messages that name the module and target, e.g. `Module "users": unknown field "Query.nope"`.
- `for...of`, `const`, early returns, small focused functions. No stray `console.log` in packages. Codegen's `logs` option is the one intended output.
- Tests live in `<package>/test/*.test.ts` using `bun:test`. Keep them flat. Runtime behaviour gets a test; type contracts get an `@ts-expect-error` line.
- Keep it small: no speculative options or abstractions; the TODO list is where "later" goes.
- Never use em dashes (U+2014) anywhere in the repo: code, comments, docs, generated output. Use a hyphen, a colon, or rewrite the sentence.
- Comments are need-to-know only: **why**, never **what**. A comment may explain a constraint, a workaround, a trap, or a decision the code can't show. A comment that explains what the code does means the code is unclear: rename, extract or simplify until the comment is unnecessary, then delete it. JSDoc on a public export stays only when it tells users something the signature can't (a default, when it runs, what it rejects). An `@ts-expect-error` carries the reason it must fail.
