---
title: Apollo Server
description: Serve an olio app with Apollo Server instead of @nxara/olio-http.
sidebar:
  order: 1
---

`app.schema` is a plain `GraphQLSchema`, so Apollo Server runs it without any adapter. This page starts from the app in the [quick start](/getting-started/quick-start/).

```sh
bun add @apollo/server
```

```ts title="src/server.ts"
import { ApolloServer } from "@apollo/server";
import { unwrapResolverError } from "@apollo/server/errors";
import { startStandaloneServer } from "@apollo/server/standalone";
import type { Context } from "@nxara/olio";
import { GraphQLError } from "graphql";

import { app } from "./app.js";

const server = new ApolloServer<Context>({
  schema: app.schema,
  includeStacktraceInErrorResponses: false,
  formatError: (formatted, error) => {
    if (unwrapResolverError(error) instanceof GraphQLError) return formatted;
    console.error(error);
    return { message: "Unexpected error." };
  }
});

await startStandaloneServer(server, {
  listen: { port: 4000 },
  context: async ({ req }) => ({
    userId: req.headers["x-user-id"]?.toString()
  })
});
```

```sh
curl localhost:4000/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ user(id: \"1\") { name } }"}'
```

```json
{ "data": { "user": { "name": "Ada" } } }
```

Don't skip `includeStacktraceInErrorResponses` and `formatError`. Apollo Server sends thrown errors to the client as they are, so without them a failing database's message reaches your users.

## Hiding the schema

Apollo Server has its own options, and they replace `introspection` and `suggestions` from `@nxara/olio-http`:

```ts
new ApolloServer<Context>({
  schema: app.schema,
  introspection: false,
  hideSchemaDetailsFromClientErrors: true
});
```

One hint still gets through: a wrong enum value sent as a variable answers `Did you mean the enum value "ADMIN"?`. Remove it in `formatError` if your enum values are private.

## Cleanup and validation rules

`onOperationEnd` and `validationRules` belong to `@nxara/olio-http`, so with Apollo Server they're a plugin. You only need this if your app uses them. `createContext` and `validationRules` are your own, as on the [olio-http page](/reference/http/#validation-rules).

```sh
bun add @nxara/olio-http
```

```ts title="src/plugin.ts"
import type { ApolloServerPlugin } from "@apollo/server";
import type { Context } from "@nxara/olio";
import { validateOperation } from "@nxara/olio-http";

import { app } from "./app.js";
import { validationRules } from "./limits.js";

export const plugin: ApolloServerPlugin<Context> = {
  requestDidStart: async () => ({
    // Not Apollo's `validationRules`: it's one list per server, and a rule like
    // a cost limit depends on each request's variables.
    async didResolveOperation({ request }) {
      const { query, variables, operationName } = request;
      if (!query) return;
      const [error] = validateOperation(
        app.schema,
        { query, variables, operationName },
        validationRules
      );
      if (error) throw error;
    },
    willSendResponse: ({ contextValue }) => contextValue.di.dispose()
  })
};
```

Pass it as `plugins: [plugin]` to `new ApolloServer`.

## Subscriptions

Apollo Server doesn't serve subscriptions, so run graphql-ws next to it on the same port. That needs an HTTP server you create yourself, which is what the Express integration gives you. `wsOptions` is on the [olio-http page](/reference/http/#subscriptions).

```sh
bun add @as-integrations/express5 express graphql-ws ws
```

```ts title="src/server.ts"
import { createServer } from "node:http";

import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@as-integrations/express5";
import type { Context } from "@nxara/olio";
import express from "express";
import { useServer } from "graphql-ws/use/ws";
import { WebSocketServer } from "ws";

import { app } from "./app.js";
import { createContext } from "./context.js";
import { wsOptions } from "./subscriptions.js";

const apollo = new ApolloServer<Context>({ schema: app.schema });
await apollo.start();

const web = express();
web.use(
  "/graphql",
  express.json(),
  expressMiddleware(apollo, {
    context: async ({ req }) => createContext(req.headers.authorization)
  })
);

const server = createServer(web);
useServer(wsOptions, new WebSocketServer({ server, path: "/graphql" }));
server.listen(4000);
```

Add the error options from the first sample here too.

## A running version

[`apps/example-server/src/server-apollo.ts`](https://github.com/nxara-hub/olio/blob/main/apps/example-server/src/server-apollo.ts) is the example app on Apollo Server, with subscriptions over WebSocket and server-sent events. Start it with `bun run --cwd apps/example-server serve:apollo`.
