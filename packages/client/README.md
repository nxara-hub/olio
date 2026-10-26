# @nxlab/client

A typed GraphQL client for Nxara apps. You write operations in `.graphql` files; codegen turns them into typed documents, the way graphql-codegen does; the client gives you one call per operation:

```ts
const { data } = await client.mutation.login({ email, password }, { headers });
```

```sh
bun add @nxlab/client
```

`graphql` 16 is a peer dependency (graphql-sse, used for SSE subscriptions, declares it).

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
- Headers, shared, per section or per call, are an object, a `Headers`, or entries; in an object, `undefined` values are left out (`token ? { authorization } : {}` works too). Later sources win: shared, then the section, then the call.

## Custom fetch

`fetch` takes anything fetch-shaped, such as a ky instance; axios goes through `fromAxios`:

```ts
import ky from "ky";

createClient(operations, { url, fetch: ky.create({ throwHttpErrors: false }) });

import { fromAxios } from "@nxlab/client";
import axios from "axios";

createClient(operations, { url, fetch: fromAxios(axios) });
```

GraphQL errors can come with 4xx/5xx statuses, so ky needs `throwHttpErrors: false` (`fromAxios` does the same for axios). SSE subscriptions need a fetch that streams the response (fetch, ky); axios can't. `fetch` doesn't apply to WebSocket subscriptions; `ws.webSocket` sets the WebSocket constructor (default: the global one).

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

Breaking out of the loop, or aborting `signal`, ends the subscription.

- **WebSocket:** one socket per client, opened on the first subscription, closed after the last, reconnected with backoff. Browsers can't set headers on a WebSocket, so the client sends its headers as `connectionParams: { headers }`; `ws.connectionParams` replaces that. They're sent when the socket connects: after the token changes (sign-in), `client.reconnect()` makes live subscriptions resume on a new connection with the new one. A server that refuses the connection (a context hook that throws) gives a result with an error, as over SSE. The socket URL is `url` with `http(s)` read as `ws(s)`, unless `ws.url` says otherwise.
- **Server-sent events:** one request per subscription, with the client's headers; the server needs no WebSocket support (fine for serverless and edge runtimes). SSE needs a `fetch` that streams (fetch, ky; not axios).
- `client.close()` ends every subscription and closes the connections.

## Transport settings

Shared settings first, then a section per transport, each overriding them:

```ts
createClient(operations, {
  url: "https://erp.example/graphql",
  headers: () => ({ authorization: token && `Bearer ${token}` }),
  http: { fetch: fromAxios(axios) }, // queries and mutations
  ws: {
    url: "wss://ws.erp.example/graphql",
    connectionParams: () => ({ token: getToken() })
  },
  sse: { headers: { "x-client": "web" } }
});
```

`ws` and `sse` exist only when some operation uses that transport: a section for a transport nothing uses is a compile error.

## Bundle size

Codegen imports a transport only if an operation uses it: an app without subscriptions bundles neither graphql-ws nor graphql-sse; one whose subscriptions all use the default bundles only graphql-ws. The client's own code is about 0.5 KB gzipped, each transport about 3.3 KB.

## Tests

`testClient` from `@nxlab/client/test` is the same client, answered in-process like Hono's `testClient`. Queries and mutations go through the app's fetch handler, so its context, error masking and `onOperationEnd` run. Subscriptions, over WebSocket and SSE alike, run against an in-memory graphql-ws / graphql-sse server for the schema. No server is started:

```ts
import { testClient } from "@nxlab/client/test";
import { fetchHandler } from "@nxlab/http/fetch";

const client = testClient(
  operations,
  {
    http: fetchHandler(app, { context }),
    schema: app.schema, // for subscriptions
    context: (headers) =>
      createSubscriptionContext(headers.get("authorization"))
  },
  { headers: { authorization: `Bearer ${token}` } }
);
expect((await client.query.me()).data).toEqual({ me: { name: "Mia" } });
```

The subscription `context` gets the client's headers (over WebSocket, the `connectionParams.headers` the client sends); `onOperationEnd` runs when a subscription ends. Without subscriptions, the fetch handler alone is enough: `testClient(operations, fetchHandler(app))`. It's a separate import, so it never ends up in an app's bundle.

## API

|  |  |
| --- | --- |
| `createClient(operations, { url, headers?, fetch?, http?, ws?, sse? })` | `headers`: an object, or a function for values that change. `fetch`: default the global one. Sections override per transport |
| `client.reconnect()` / `client.close()` | A new WebSocket connection (fresh `connectionParams`) / end everything |
| `testClient(operations, handler \| { http, schema?, context?, onOperationEnd? }, { headers?, url? })` | From `@nxlab/client/test`: the same client, answered in-process |
| `fromAxios(axios)` | An axios instance as `fetch` |
| `ClientScalars` | Augment it with how custom scalars arrive and are sent |
| `TypedDocument`, `Result`, `Client`, `ClientOptions`, `Operations`, `Transport` | The types behind the calls |
