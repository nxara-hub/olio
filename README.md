# Nxara

Modular, type-safe GraphQL for TypeScript, in the spirit of `graphql-modules`. Each module owns its SDL, resolvers and middleware. Codegen turns the SDL into types, so every resolver, argument and middleware target is checked at compile time.

**[Read the docs](https://olio.nxara.dev)**: [quick start](https://olio.nxara.dev/getting-started/quick-start/), [how it fits](https://olio.nxara.dev/concepts/how-it-fits/), and a page per package.

## Packages

| Package | Description |
| --- | --- |
| [`@nxara/olio`](https://olio.nxara.dev/reference/olio/) | Runtime: modules, typed resolvers, layered middleware → schema |
| [`@nxara/olio-codegen`](https://olio.nxara.dev/reference/codegen/) | SDL → TypeScript: schema types, per-module contracts, `Application` |
| [`@nxara/olio-schema`](https://olio.nxara.dev/reference/schema/) | Compose module SDL into one validated schema, with the `@implements` / `@copy` directives |
| [`@nxara/olio-di`](https://olio.nxara.dev/reference/di/) | Typed dependency injection on Awilix: singletons and per-operation instances |
| [`@nxara/olio-http`](https://olio.nxara.dev/reference/http/) | Serve an app over HTTP: Fetch and Node adapters with context, error masking and cleanup |
| [`@nxara/olio-client`](https://olio.nxara.dev/reference/client/) | A typed client: operations in `.graphql` files, codegen types them, one call per operation, and `testClient` for tests |
| [`@nxara/olio-tools`](https://olio.nxara.dev/reference/tools/) | Load modules, features, SDL, resolvers and enums from globs |

## Examples

[`apps/example-server`](./apps/example-server) is a small ERP: auth with roles, inventory with a stock subscription, and sales split into features. It shows the main features, with a map of where each one lives. [`apps/example-client`](./apps/example-client) is a separate app that uses it over HTTP with `@nxara/olio-client`.

## Development

[Bun](https://bun.com) workspaces with [Turborepo](https://turborepo.dev). Tool versions (bun, node, zizmor) are pinned in `mise.toml` and locked in `mise.lock`. CI installs them the same way (`mise install`).

```sh
bun install
bun run build         # build all packages
bun run test
bun run check-types
bun run check         # lint + format (ultracite); `bun run fix` to apply

bun run --cwd apps/example-server codegen   # regenerate src/generated.ts
bun run --cwd apps/example-server start     # run the example
bun run --cwd apps/example-server serve     # serve it, then:
bun run --cwd apps/example-client start     # the client walkthrough
bun run --cwd apps/website dev              # the site and docs on http://localhost:4321
```

## Releasing

All packages share one version. On a clean `main`:

```sh
bun run release 0.3.0         # bumps every package, commits and tags v0.3.0
git push origin main v0.3.0   # CI checks, publishes to npm, creates the GitHub release
```

A version with a suffix (`0.3.0-rc.1`) publishes under npm's `next` tag and as a GitHub prerelease. npm trusts the release workflow itself ([trusted publishing](https://docs.npmjs.com/trusted-publishers), with provenance), so there's no npm token to keep. A failed run can be rerun: versions already on npm are skipped.

A new package is the exception: npm sets up trusted publishing per existing package, so its first version is published by hand, with your own npm login. Pack it with bun (which rewrites `workspace:*`) and publish from outside the repo (the root's `devEngines` makes npm refuse to run inside):

```sh
bun run build
cp LICENSE packages/<dir>/ && (cd packages/<dir> && bun pm pack --filename /tmp/pkg.tgz) && rm packages/<dir>/LICENSE
cd /tmp && npm login && npm publish pkg.tgz --access public --tag next
```

Then, in the package's npm settings, set Trusted Publisher → GitHub Actions, `nxara-hub` / `olio` / `release.yml`, and Publishing access → "Require two-factor authentication and disallow tokens".

## License

MIT
