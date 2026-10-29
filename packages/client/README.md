# @nxlab/client

A typed GraphQL client for Nxara apps. You write operations in `.graphql` files; codegen turns them into typed documents, the way graphql-codegen does; the client gives you one call per operation:

```ts
const { data } = await client.mutation.login({ email, password }, { headers });
```

```sh
bun add @nxlab/client
```

`graphql` 16 is a peer dependency. For subscriptions, add [graphql-ws](https://github.com/enisdenjo/graphql-ws) and/or [graphql-sse](https://github.com/enisdenjo/graphql-sse): the client takes your own clients of them.

## Operations

```graphql
# src/operations/auth.graphql
mutation Login($email: String!, $password: String!) {
  login(email: $email, password: $password) {
    __typename
    ... on Session {
      token
    }
    ... on UserError {
      message
    }
  }
}
```

## Codegen

`codegenClient` reads the schema (a file, or the running server's URL by introspection) and the operations, checks the operations against the schema (errors point at `file:line:column`), and writes the types:

```ts
import { codegenClient } from "@nxlab/codegen";

await codegenClient({
  schema: "../server/src/schema.gql", // or "http://localhost:4000/graphql"
  documents: "src/operations/*.graphql",
  output: "src/generated.ts",
  headers: { authorization: "Bearer …" } // only for a URL that needs it
});
```

Per operation, named the way graphql-codegen names them: `LoginMutation` (the result), `LoginMutationVariables` and `LoginDocument`. Plus `operations`, every document by root and name, which the client takes.

## Calls

```ts
import { createClient } from "@nxlab/client";

import { operations } from "./generated.js";

const client = createClient(operations, {
  url: "https://erp.example/graphql",
  // Nothing before sign-in: an `undefined` value is left out, not sent as text.
  headers: () => ({ authorization: token && `Bearer ${token}` })
});

const { data, errors } = await client.mutation.login({ email, password });
if (data?.login.__typename === "Session") data.login.token;
```

- `client.<query | mutation | subscription>.<operation>(variables?, options?)`. The operation's name with its first letter lowercased: `mutation Login` is `client.mutation.login`.
- Variables are typed from the operation; they may be left out when none are required.
- `data` is the operation's result, typed from its selection: fragments narrow on `__typename`, fields under `@include` / `@skip` are optional. `errors` are the GraphQL errors as the server sent them. A response that isn't GraphQL at all (a proxy's 502 page) rejects.
- `options` takes per-call `headers` and a `signal`.
- Headers, on the client or per call, are an object, a `Headers`, or entries; in an object, `undefined` values are left out (`token ? { authorization } : {}` works too). The call's win.

## Custom fetch

`fetch` takes anything fetch-shaped, such as a ky instance; axios goes through `fromAxios`:

```ts
import ky from "ky";

createClient(operations, { url, fetch: ky.create({ throwHttpErrors: false }) });

import { fromAxios } from "@nxlab/client";
import axios from "axios";

createClient(operations, { url, fetch: fromAxios(axios) });
```

GraphQL errors can come with 4xx/5xx statuses, so ky needs `throwHttpErrors: false` (`fromAxios` does the same for axios). `fetch` is for queries and mutations; subscriptions go through your own clients.

## Scalars

The way the server's `CustomScalars` works: one type, or `{ input; output }` when variables and results differ. Custom scalars are `unknown` until registered:

```ts
declare module "@nxlab/client" {
  interface ClientScalars {
    DateTime: { input: Date | string; output: string };
  }
}
```

Put it in a `.ts` file, or a `.d.ts` with an `import` or `export {}`.

Enums arrive by name (`"CONFIRMED"`), not as the server's internal values.

## Subscriptions

Over WebSocket by default ([graphql-ws](https://github.com/enisdenjo/graphql-ws)), or as server-sent events on the same URL ([graphql-sse](https://github.com/enisdenjo/graphql-sse)) for an operation marked `@sse`. The choice lives in the operation; the directive is the client's, and codegen removes it from the query the server receives:

```graphql
subscription StockChanged($sku: String) {
  # WebSocket
  stockChanged(sku: $sku) {
    sku
    onHand
  }
}

subscription Notifications @sse {
  # server-sent events
  notifications {
    message
  }
}
```

```ts
for await (const { data } of client.subscription.stockChanged({ sku: "CHAIR-01" })) {
  console.log(data?.stockChanged.onHand);
}
```

They go through your own [graphql-ws](https://github.com/enisdenjo/graphql-ws) and [graphql-sse](https://github.com/enisdenjo/graphql-sse) clients, which `createClient` requires as `ws` and `sse` once an operation uses that transport (and rejects when none does):

```ts
import { createClient as createSseClient } from "graphql-sse";
import { createClient as createWsClient } from "graphql-ws";

const headers = () => ({ authorization: token && `Bearer ${token}` });
const ws = createWsClient({
  url: "wss://erp.example/graphql",
  // Browsers can't set headers on a WebSocket: send them here.
  connectionParams: () => ({ headers: headers() })
});
const client = createClient(operations, {
  url: "https://erp.example/graphql",
  headers,
  ws,
  sse: createSseClient({ url: "https://erp.example/graphql", headers })
});
```

The client calls their `iterate` and types the results; the rest is theirs and yours to configure: connecting, retries, keep-alive. Breaking out of the loop, or aborting `signal`, ends the subscription.

- **New credentials:** graphql-ws sends `connectionParams` each time the socket connects. After the token changes, `ws.terminate()` reconnects, and graphql-ws resubscribes live subscriptions on the new socket. It waits out its retry backoff first (`retryWait`, about 1.3 to 4 s by default), and events sent in between are lost. An open SSE stream keeps its headers until you subscribe again.
- **Refusals:** by default both libraries retry a refused connection for about 40 s before reporting it (graphql-ws on a 4403 close, graphql-sse on any response that isn't 2xx); `retryAttempts: 0` or graphql-ws's `shouldRetry` reports it at once. Then a WebSocket closed with a 4xxx code is an error result (`extensions: { code: "WEBSOCKET_CLOSED", closeCode }`), and graphql-sse throws its `NetworkError` (its `response` holds the status).
- **Rejected operations** (the server's `onSubscribe` returning errors) are an error result on both, as over HTTP.

## Bundle size

The client imports neither library: an app bundles only the ones it creates clients with. The client's own code is about 1 KB gzipped.

## Tests

`testClient` from `@nxlab/client/test` is the same client, answered in-process like Hono's `testClient`, through the app's own servers: its fetch handler for queries and mutations, and for subscriptions the graphql-ws options it passes to `useServer` (run over an in-memory socket) and its graphql-sse handler. So tests run production's context, `onConnect`, `onSubscribe`, error masking and cleanup. No server is started:

```ts
import { testClient } from "@nxlab/client/test";

// The same objects the server uses.
import { graphqlHandler } from "../src/http.js";
import { sseHandler, wsOptions } from "../src/subscriptions.js";

const client = testClient(
  operations,
  { http: graphqlHandler, ws: wsOptions, sse: sseHandler },
  { headers: { authorization: `Bearer ${token}` } }
);
expect((await client.query.me()).data).toEqual({ me: { name: "Mia" } });
```

`ws` and `sse` are required exactly when an operation uses that transport; without subscriptions, the fetch handler alone is enough: `testClient(operations, graphqlHandler)`. Over WebSocket, the headers arrive as `connectionParams: { headers }`, and `ctx.extra` is empty (no socket or request in memory). Its clients never retry, since a failure in memory is final: a refusal over SSE throws at once. It's a separate import, so it never ends up in an app's bundle.

## API

|  |  |
| --- | --- |
| `createClient(operations, { url, headers?, fetch?, ws?, sse? })` | `headers`: an object, or a function for values that change. `fetch`: default the global one. `ws` / `sse`: your graphql-ws / graphql-sse client, required once an operation uses that transport |
| `testClient(operations, handler \| { http, ws?, sse? }, { headers?, url? })` | From `@nxlab/client/test`: the same client, answered in-process |
| `fromAxios(axios)` | An axios instance as `fetch` |
| `ClientScalars` | Augment it with how custom scalars arrive and are sent |
| `TypedDocument`, `Result`, `Client`, `ClientOptions`, `Operations`, `SubscriptionClient` | The types behind the calls |
