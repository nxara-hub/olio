---
title: GraphQL Yoga
description: Serve an olio app with GraphQL Yoga instead of @nxara/olio-http.
sidebar:
  order: 0
---

`app.schema` is a plain `GraphQLSchema`, so Yoga serves it without any adapter. This page starts from the app in the [quick start](/getting-started/quick-start/).

```sh
bun add graphql-yoga
```

```ts title="src/server.ts"
import { createServer } from "node:http";

import { createYoga } from "graphql-yoga";

import { app } from "./app.js";

const yoga = createYoga({
  schema: app.schema,
  context: ({ request }) => ({
    userId: request.headers.get("x-user-id") ?? undefined
  })
});

createServer(yoga).listen(4000);
```

```sh
curl localhost:4000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ user(id: \"1\") { name } }"}'
```

```json
{ "data": { "user": { "name": "Ada" } } }
```

Yoga hides unexpected errors by default: the client gets "Unexpected error." and Yoga logs the real one. Subscriptions work too, as server-sent events on the same URL.

Two things to watch for:

- **`context` isn't required by the types.** `@nxara/olio-http` makes it a compile error to forget it. Yoga only receives a schema, so a missing hook shows up at runtime.
- **Yoga reserves `log` on the context.** A `ctx.log` of your own replaces Yoga's logger, and requests crash with `.error is not a function`. Use another name.

## Cleanup and validation rules

`onOperationEnd` and `validationRules` belong to `@nxara/olio-http`, so with Yoga they're a plugin. You only need this if your app uses them. `createContext` and `validationRules` are your own, as on the [olio-http page](/reference/http/#validation-rules).

```sh
bun add @nxara/olio-http
```

```ts title="src/server.ts"
import { createServer } from "node:http";

import type { Context } from "@nxara/olio";
import { validateOperation } from "@nxara/olio-http";
import { createYoga, type Plugin } from "graphql-yoga";

import { app } from "./app.js";
import { createContext } from "./context.js";
import { validationRules } from "./limits.js";

const plugin: Plugin<Context> = {
  // Not onValidate: Yoga caches validation per document, and a rule like a cost
  // limit depends on each request's variables.
  onParams({ params: { query, variables, operationName }, setResult }) {
    if (!query) return;
    const errors = validateOperation(
      app.schema,
      { query, variables, operationName },
      validationRules
    );
    if (errors.length) setResult({ errors });
  },
  onExecute: ({ args }) => ({
    onExecuteDone: () => args.contextValue.di.dispose()
  })
};

const yoga = createYoga<object, Context>({
  schema: app.schema,
  context: ({ request }) => createContext(request),
  plugins: [plugin]
});

createServer(yoga).listen(4000);
```

## A separate `sub_ctx`

Yoga's server-sent events run subscriptions with what `context` returns. An app that registers a separate `sub_ctx` can send those requests to its own [graphql-sse handler](/reference/http/#subscriptions) instead, with this in the plugin:

```ts
async onRequest({ request, endResponse }) {
  if (request.headers.get("accept")?.includes("text/event-stream")) {
    endResponse(await sseHandler(request));
  }
},
```

For WebSocket, run graphql-ws next to it, the same way as with `@nxara/olio-http`.

## A running version

[`apps/example-server/src/server-yoga.ts`](https://github.com/nxara-hub/olio/blob/main/apps/example-server/src/server-yoga.ts) is the example app on Yoga, with subscriptions over both transports. Start it with `bun run --cwd apps/example-server serve:yoga`.
