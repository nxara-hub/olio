# Example client

A separate app that uses [the example server](../example-server) over HTTP with [`@nxlab/client`](../../packages/client), the way a frontend or another service would. It knows the server only by its URL and by the schema it publishes.

```sh
bun run --cwd apps/example-server serve    # in one terminal
bun run --cwd apps/example-client start    # in another
```

`src/main.ts` signs in, searches products, watches stock over a WebSocket while it books stock in and places an order, and signs out. Set `GRAPHQL_URL` to point it elsewhere (default `http://localhost:4000/graphql`).

| What | Where |
| --- | --- |
| Operations, in GraphQL | [`src/operations/`](src/operations) |
| Their types, from the server's SDL (or its URL), not its code | [`codegen.ts`](codegen.ts) → [`src/generated.ts`](src/generated.ts) |
| How custom scalars arrive (`DateTime` as a string) | [`src/scalars.d.ts`](src/scalars.d.ts) |
| A token that changes after sign-in, through a `headers` function | [`src/main.ts`](src/main.ts) |
| `client.mutation.login(...)`: one call per operation; unions narrowed on `__typename` | [`src/main.ts`](src/main.ts) |
| A subscription over WebSocket (the default; `@sse` for server-sent events), read with `for await`, ended with `break` | [`src/operations/inventory.graphql`](src/operations/inventory.graphql), [`src/main.ts`](src/main.ts) |

After changing an operation or the server's SDL, run `bun run --cwd apps/example-client codegen` to refresh the types; `SCHEMA_URL=http://localhost:4000/graphql` takes the schema from the running server instead.
