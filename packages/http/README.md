# @nxlab/http

Serve an olio app over HTTP and WebSocket, on any framework.

A small core holds what shouldn't change between frameworks: running operations, building `ctx`, hiding unexpected errors. Thin adapters translate each framework's requests. The protocols come from the reference implementations, [graphql-http](https://github.com/graphql/graphql-http) (GraphQL over HTTP) and [graphql-ws](https://github.com/enisdenjo/graphql-ws) (subscriptions over WebSocket).

```sh
bun add @nxlab/http
```

`graphql` 17 and `@nxlab/olio` are peer dependencies. So is `ws`, but only if you use `@nxlab/http/ws`.

## Adapters

| Import | For |
| --- | --- |
| `@nxlab/http/fetch` | Anything that speaks the Fetch API: Hono, Elysia, Bun.serve, Deno, Cloudflare Workers, Next.js route handlers, SvelteKit, Remix |
| `@nxlab/http/node` | Node's `IncomingMessage` / `ServerResponse`: `node:http`, Express, Connect, Koa (`ctx.req`, `ctx.res`), Fastify (`request.raw`, `reply.raw`) |
| `@nxlab/http/ws` | Subscriptions on a [`ws`](https://github.com/websockets/ws) server, attached to any Node HTTP server |
| `@nxlab/http/bun` | Subscriptions on `Bun.serve` |

Each adapter decides what your `context` hook receives: a Fetch `Request`, a Node `IncomingMessage`, or the WebSocket upgrade request plus the client's `connectionParams`.

## Hono on Node

```ts
import { serve } from "@hono/node-server";
import { fetchHandler } from "@nxlab/http/fetch";
import { wsServer } from "@nxlab/http/ws";
import { Hono } from "hono";
import { WebSocketServer } from "ws";

const graphql = fetchHandler(app, {
  context: (request) => createContext(request.headers.get("authorization"))
});

const hono = new Hono();
hono.on(["GET", "POST"], "/graphql", (c) => graphql(c.req.raw));

const server = serve({ fetch: hono.fetch, port: 4000 });

wsServer(app, new WebSocketServer({ server, path: "/graphql" }), {
  // Browsers can't set headers on a WebSocket: clients send the token as
  // connectionParams, e.g. createClient({ url, connectionParams: { token } }).
  context: ({ connectionParams, request }) =>
    createSubscriptionContext(connectionParams?.token)
});
```

## Bun

```ts
import { bunWebSocket } from "@nxlab/http/bun";
import { fetchHandler } from "@nxlab/http/fetch";

const graphql = fetchHandler(app, {
  context: (request) => createContext(request)
});
const subscriptions = bunWebSocket(app, {
  context: ({ request }) => createSubscriptionContext(request)
});

Bun.serve({
  fetch: (request, server) =>
    subscriptions.upgrade(request, server) ? undefined : graphql(request),
  websocket: subscriptions.websocket
});
```

## Express, node:http

```ts
import { nodeHandler } from "@nxlab/http/node";

const graphql = nodeHandler(app, {
  context: (req) => createContext(req.headers.authorization)
});
expressApp.all("/graphql", (req, res) => graphql(req, res));
// or: createServer(graphql)
```

## Errors

Only `GraphQLError`s reach clients. Anything else that's thrown, such as a failing database or a bug, is replaced by `"Unexpected error."` and passed to `onUnexpectedError` (default: `console.error`), so it isn't lost. This applies to queries, mutations and subscriptions alike.

```ts
throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } }); // the client sees this
throw new Error("connection refused"); // the client sees "Unexpected error."
```

Options, on every adapter:

| Option | Default |  |
| --- | --- | --- |
| `context` | none | Builds `ctx`: from the request (`fetch`, `node`), or from `{ request, connectionParams }` (`ws`, `bun`) |
| `maskErrors` | `true` | Hide errors that aren't `GraphQLError`s. Turn off only while developing |
| `onUnexpectedError` | `console.error` | Receives each hidden error |
