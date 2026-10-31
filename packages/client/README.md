# @nxara/olio-client

A typed GraphQL client for olio apps. You write operations in `.graphql` files, codegen turns them into typed documents (the way graphql-codegen does), and the client gives you one typed call per operation.

```ts
const { data } = await client.mutation.login({ email, password }, { headers });
```

## Install

```sh
bun add @nxara/olio-client graphql@16
```

`graphql` 16 is a peer dependency. For subscriptions, add [graphql-ws](https://github.com/enisdenjo/graphql-ws), [graphql-sse](https://github.com/enisdenjo/graphql-sse), or both: the client uses your own clients of them.

## Operations

Operations are plain GraphQL documents, one or more per file:

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

`codegenClient` from [`@nxara/olio-codegen`](../codegen#client-types) reads the schema (a file, or the running server's URL by introspection) and the operations. It checks the operations against the schema (errors point at `file:line:column`) and writes the types:

```ts
import { codegenClient } from "@nxara/olio-codegen";

await codegenClient({
  schema: "../server/src/schema.gql", // or "http://localhost:4000/graphql"
  documents: "src/operations/*.graphql",
  output: "src/generated.ts",
  headers: { authorization: "Bearer …" } // only for a URL that needs it
});
```

For each operation it writes three types, named the way graphql-codegen names them: `LoginMutation` (the result), `LoginMutationVariables` and `LoginDocument`. It also writes `operations`, every document by root and name, which `createClient` takes.

## Calls

```ts
import { createClient } from "@nxara/olio-client";

import { operations } from "./generated.js";

const client = createClient(operations, {
  url: "https://erp.example/graphql",
  // Nothing before sign-in: an `undefined` value is left out, not sent as text.
  headers: () => ({ authorization: token && `Bearer ${token}` })
});

const { data, errors } = await client.mutation.login({ email, password });
if (data?.login.__typename === "Session") data.login.token;
```

- **Calls** are `client.<query | mutation | subscription>.<operation>(variables?, options?)`, named after the operation with its first letter lowercased: `mutation Login` is `client.mutation.login`.
- **Variables** are typed from the operation. They may be left out when none are required.
- **`data`** is the operation's result, typed from its selection: fragments narrow on `__typename`, and fields under `@include` / `@skip` are optional. **`errors`** are the GraphQL errors as the server sent them. A response that isn't GraphQL at all (a proxy's 502 page) rejects.
- **`options`** takes per-call `headers` and a `signal`. A subscription takes only `signal`, since its headers belong to its transport client.
- **Headers**, on the client or per call, are an object, a `Headers`, or entries. In an object, `undefined` values are left out (`token ? { authorization } : {}` works too). Per-call headers win over the client's.

## Custom fetch

`fetch` takes anything fetch-shaped, such as a ky instance:

```ts
import ky from "ky";

createClient(operations, { url, fetch: ky.create({ throwHttpErrors: false }) });
```

GraphQL errors can come with 4xx or 5xx statuses, so ky needs `throwHttpErrors: false`. A library that isn't fetch-shaped, such as axios, needs a few lines that return a `Response`:

```ts
import type { Fetch } from "@nxara/olio-client";
import axios from "axios";

const axiosFetch: Fetch = async (url, init) => {
  const res = await axios.request({
    url,
    method: init.method,
    headers: Object.fromEntries(new Headers(init.headers)),
    data: init.body,
    signal: init.signal ?? undefined,
    responseType: "text",
    validateStatus: () => true // GraphQL errors come with 4xx/5xx too
  });
  return new Response(res.data, {
    status: res.status,
    headers: res.headers as Record<string, string>
  });
};
```

`fetch` is for queries and mutations; subscriptions go through your own clients.

## Uploading files

The client sends JSON, and a `File` in JSON is `{}`. But `fetch` also receives the request before it's turned into JSON, with the variables as you passed them, so it can send them as a [multipart request](https://github.com/jaydenseric/graphql-multipart-request-spec) instead:

```ts
import type { Fetch } from "@nxara/olio-client";

const multipart: Fetch = (url, init, { query, variables, operationName }) => {
  const files = new Map<File, string[]>();
  // Files leave the variables (null in their place); `map` says where each goes back.
  const strip = (value: unknown, path: string): unknown => {
    if (value instanceof File) {
      files.set(value, [...(files.get(value) ?? []), path]);
      return null;
    }
    if (Array.isArray(value)) {
      return value.map((v, i) => strip(v, `${path}.${i}`));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, strip(v, `${path}.${k}`)])
      );
    }
    return value;
  };
  const stripped = strip(variables, "variables");
  if (files.size === 0) return fetch(url, init);

  const form = new FormData();
  form.set(
    "operations",
    JSON.stringify({ query, variables: stripped, operationName })
  );
  form.set(
    "map",
    JSON.stringify(Object.fromEntries([...files.values()].entries()))
  );
  for (const [i, file] of [...files.keys()].entries())
    form.set(String(i), file);

  const headers = new Headers(init.headers);
  headers.delete("content-type"); // fetch sets it, with the boundary
  headers.set("x-upload", "1"); // browsers can't add it cross-site, so the server can refuse CSRF
  return fetch(url, { ...init, headers, body: form });
};

const client = createClient(operations, { url, fetch: multipart });
await client.mutation.uploadAvatar({ file });
```

Register the scalar as `File` on the client (`interface ClientScalars { Upload: File }`). On the server, [`@nxara/olio-http`](../http) passes graphql-http's `parseRequestParams` through, and it puts the files back:

```ts
fetchHandler(app, {
  context,
  parseRequestParams: async (req) => {
    const request = req.raw as Request;
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
      return; // JSON, as usual
    // graphql-http's response, [body, init], not a Fetch Response.
    if (!request.headers.get("x-upload"))
      return [null, { status: 400, statusText: "Bad Request" }];
    const form = await request.formData();
    const params = JSON.parse(String(form.get("operations")));
    const map: Record<string, string[]> = JSON.parse(String(form.get("map")));
    for (const [key, paths] of Object.entries(map)) {
      for (const path of paths) setPath(params, path, form.get(key)); // e.g. lodash's set
    }
    return params;
  }
});
```

The server's SDL declares `scalar Upload`, typed `File` in its `CustomScalars`. Size limits are the server's (or its proxy's).

Many apps skip all this: a mutation returns a signed upload URL, and the browser sends the file straight to storage.

## Scalars

`ClientScalars` works like the server's `CustomScalars`: one type, or `{ input; output }` when variables and results differ. Custom scalars are `unknown` until registered:

```ts
declare module "@nxara/olio-client" {
  interface ClientScalars {
    DateTime: { input: Date | string; output: string };
  }
}
```

Put it in a `.ts` file, or in a `.d.ts` file with an `import` or `export {}`.

Enums arrive by name (`"CONFIRMED"`), not as the server's internal values.

## Subscriptions

Subscriptions run over WebSocket by default ([graphql-ws](https://github.com/enisdenjo/graphql-ws)), or as server-sent events on the same URL ([graphql-sse](https://github.com/enisdenjo/graphql-sse)) for an operation marked `@sse`. The choice lives in the operation. The directive is for the client only: codegen removes it from the query the server receives.

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

They go through your own graphql-ws and graphql-sse clients. `createClient` requires each one (as `ws` or `sse`) once an operation uses that transport, and doesn't accept one that no operation uses:

```ts
import { createClient as createSseClient } from "graphql-sse";
import { createClient as createWsClient } from "graphql-ws";

// graphql-sse sends an `undefined` value as the text "undefined": leave the key out.
const headers = (): Record<string, string> =>
  token ? { authorization: `Bearer ${token}` } : {};
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

The client calls their `iterate` and types the results. Everything else is theirs, and yours to configure: connecting, retries, keep-alive. Breaking out of the loop, or aborting `signal`, ends the subscription.

- **New credentials:** graphql-ws sends `connectionParams` each time the socket connects. After the token changes, `ws.terminate()` reconnects, and graphql-ws resubscribes live subscriptions on the new socket. It waits out its retry backoff first (`retryWait`, about 1.3 to 4 s by default), and events sent in between are lost. An open SSE stream keeps its headers until you subscribe again.
- **Refusals:** by default, both libraries retry a refused connection for about 40 s before reporting it (graphql-ws on a 4403 close, graphql-sse on any response that isn't 2xx). With `retryAttempts: 0` or graphql-ws's `shouldRetry`, they report it at once. Then a WebSocket closed with a 4xxx code is an error result (`extensions: { code: "WEBSOCKET_CLOSED", closeCode }`), and graphql-sse throws its `NetworkError` (its `response` holds the status).
- **Rejected operations** (the server's `onSubscribe` returning errors) are an error result on both, as over HTTP.

## Bundle size

The client imports neither library: an app bundles only the ones it creates clients with. The client's own code is about 1 KB gzipped.

## Tests

`testClient` from `@nxara/olio-client/test` is the same client, answered in-process like Hono's `testClient`. It goes through the app's own servers:

- **Queries and mutations** go through its fetch handler.
- **Subscriptions** go through the graphql-ws options it passes to `useServer` (run over an in-memory socket) and its graphql-sse handler.

So tests run production's context, `onConnect`, `onSubscribe`, error masking and cleanup, and no server is started:

```ts
import { expect } from "bun:test";

import { testClient } from "@nxara/olio-client/test";

// The same objects the server uses.
import { graphqlHandler } from "../src/http.js";
import { sseHandler, wsOptions } from "../src/subscriptions.js";
import { operations } from "./generated.js";

const client = testClient(
  operations,
  { http: graphqlHandler, ws: wsOptions, sse: sseHandler },
  { headers: { authorization: `Bearer ${token}` } }
);
expect((await client.query.me()).data).toEqual({ me: { name: "Mia" } });
```

- **`ws` and `sse`** are required exactly when an operation uses that transport. Without subscriptions, the fetch handler alone is enough: `testClient(operations, graphqlHandler)`.
- **Over WebSocket**, the headers arrive as `connectionParams: { headers }`, and `ctx.extra` is empty (there's no socket or request in memory).
- **No retries.** Its clients never retry, since a failure in memory is final: a refusal over SSE throws at once.
- **Not bundled.** It's a separate import, so it never ends up in an app's bundle.

## API

|  |  |
| --- | --- |
| `createClient(operations, { url, headers?, fetch?, ws?, sse? })` | `headers`: an object, or a function for values that change. `fetch`: defaults to the global one; called with `(url, init, params)`, `params` being the request before JSON (see [Uploading files](#uploading-files)). `ws` / `sse`: your graphql-ws / graphql-sse client, required once an operation uses that transport |
| `testClient(operations, handler \| { http, ws?, sse? }, { headers?, url? })` | From `@nxara/olio-client/test`: the same client, answered in-process |
| `ClientScalars` | Augment it with how custom scalars arrive and are sent |
| `TypedDocument`, `Result`, `Client`, `ClientOptions`, `Operations`, `SubscriptionClient` | The types behind the calls |
