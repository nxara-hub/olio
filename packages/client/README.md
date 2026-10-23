# @nxlab/client

A typed GraphQL client for Nxara apps. You write operations in `.graphql` files; codegen turns them into typed documents, the way graphql-codegen does; the client gives you one call per operation:

```ts
const { data } = await client.mutation.login({ email, password }, { headers });
```

```sh
bun add @nxlab/client
```

`graphql` 16 is a peer dependency (graphql-sse, used for subscriptions, needs it).

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
  headers: () => ({ authorization: `Bearer ${getToken()}` })
});

const { data, errors } = await client.mutation.login({ email, password });
if (data?.login.__typename === "Session") data.login.token;
```

- `client.<query | mutation | subscription>.<operation>(variables?, options?)`. The operation's name with its first letter lowercased: `mutation Login` is `client.mutation.login`.
- Variables are typed from the operation; they may be left out when none are required.
- `data` is the operation's result, typed from its selection: fragments narrow on `__typename`, fields under `@include` / `@skip` are optional. `errors` are the GraphQL errors as the server sent them. A response that isn't GraphQL at all (a proxy's 502 page) rejects.
- `options` takes per-call `headers` and a `signal`.

## Custom fetch

`fetch` takes anything fetch-shaped, such as a ky instance; axios goes through `fromAxios`:

```ts
import ky from "ky";

createClient(operations, { url, fetch: ky.create({ throwHttpErrors: false }) });

import { fromAxios } from "@nxlab/client";
import axios from "axios";

createClient(operations, { url, fetch: fromAxios(axios) });
```

GraphQL errors can come with 4xx/5xx statuses, so ky needs `throwHttpErrors: false` (`fromAxios` does the same for axios). Subscriptions need a fetch that streams the response (fetch, ky); axios can't.

## Scalars

The way the server's `CustomScalars` works: one type, or `{ input; output }` when variables and results differ. Custom scalars are `unknown` until registered:

```ts
declare module "@nxlab/client" {
  interface ClientScalars {
    DateTime: { input: Date | string; output: string };
  }
}
```

Enums arrive by name (`"CONFIRMED"`), not as the server's internal values.

## Subscriptions

Server-sent events on the same URL, through [graphql-sse](https://github.com/enisdenjo/graphql-sse):

```ts
for await (const { data } of client.subscription.stockChanged({ sku: "CHAIR-01" })) {
  console.log(data?.stockChanged.onHand);
}
```

Breaking out of the loop, or aborting `signal`, ends the subscription.

## Tests

`testClient` is the same client, answered in-process by a fetch handler, like Hono's `testClient`. Context, error masking and `onOperationEnd` all run; no server is started:

```ts
import { testClient } from "@nxlab/client";
import { fetchHandler } from "@nxlab/http/fetch";

const client = testClient(operations, fetchHandler(app, { context }), {
  headers: { authorization: `Bearer ${token}` }
});
expect((await client.query.me()).data).toEqual({ me: { name: "Mia" } });
```

## API

|  |  |
| --- | --- |
| `createClient(operations, { url, headers?, fetch? })` | `headers`: an object, or a function for values that change. `fetch`: default the global one |
| `testClient(operations, handler, { headers?, url? })` | The same client, with `fetch` going to `handler(request)` |
| `fromAxios(axios)` | An axios instance as `fetch` |
| `ClientScalars` | Augment it with how custom scalars arrive and are sent |
| `TypedDocument`, `Result`, `Client`, `Operations` | The types behind the calls |
