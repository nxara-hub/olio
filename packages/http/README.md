# @nxlab/http

Serve an olio app over HTTP and WebSocket, on any framework.

A small core holds what shouldn't change between frameworks: running operations, building `ctx`, hiding unexpected errors. Thin adapters translate each framework's requests. The protocols come from the reference implementations: [graphql-http](https://github.com/graphql/graphql-http) (GraphQL over HTTP), [graphql-sse](https://github.com/enisdenjo/graphql-sse) (subscriptions as server-sent events) and [graphql-ws](https://github.com/enisdenjo/graphql-ws) (subscriptions over WebSocket).

```sh
bun add @nxlab/http
```

`graphql` 17 and `@nxlab/olio` are peer dependencies. So is `ws`, but only if you use `@nxlab/http/ws`.

## Adapters

| Import | For |
| --- | --- |
| `@nxlab/http/fetch` | Anything that speaks the Fetch API: Hono, Elysia, Bun.serve, Deno, Cloudflare Workers, Next.js route handlers, SvelteKit, Remix. Also serves subscriptions as server-sent events |
| `@nxlab/http/node` | Node's `IncomingMessage` / `ServerResponse`: `node:http`, Express, Connect, Koa (`ctx.req`, `ctx.res`), Fastify (`request.raw`, `reply.raw`). Also serves subscriptions as server-sent events |
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

## Subscriptions: server-sent events or WebSocket

The `fetch` and `node` adapters serve subscriptions as server-sent events on the same URL as everything else. A request with `Accept: text/event-stream` (what [graphql-sse](https://github.com/enisdenjo/graphql-sse)'s client sends) is streamed; anything else is plain GraphQL over HTTP. That needs no extra server or route, and works where WebSockets don't (some proxies, serverless and edge runtimes). Use `subscriptionContext` to build `sub_ctx` for those requests; it defaults to `context`.

```ts
const graphql = fetchHandler(app, {
  context: (request) => createContext(request),
  subscriptionContext: (request) => createSubscriptionContext(request)
});
```

```sh
curl -N -H 'accept: text/event-stream' -H 'content-type: application/json' \
  -d '{"query":"subscription { stockChanged { sku onHand } }"}' http://localhost:4000/graphql
```

For WebSockets (the graphql-ws protocol, which Apollo Client, urql and Relay speak), add `ws` or `bun` next to it. Both can run side by side.

## Errors

Only `GraphQLError`s reach clients. Anything else that's thrown, such as a failing database or a bug, is replaced by `"Unexpected error."` and passed to `onUnexpectedError` (default: `console.error`), so it isn't lost. This applies to queries, mutations and subscriptions alike, over every transport, including a subscription that fails while starting or while streaming, and a `context` hook that throws. Throw a `GraphQLError` from `context` (say, `UNAUTHENTICATED` for a bad token) and the client gets it as a normal GraphQL error: status 200 over HTTP, an error event over SSE, a close reason over WebSocket.

```ts
throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } }); // the client sees this
throw new Error("connection refused"); // the client sees "Unexpected error."
```

Options, on every adapter:

| Option | Default |  |
| --- | --- | --- |
| `context` | none | Builds `ctx`: from the request (`fetch`, `node`), or from `{ request, connectionParams }` (`ws`, `bun`) |
| `subscriptionContext` | `context` | `fetch` and `node` only: builds `sub_ctx` for server-sent event requests |
| `maskErrors` | `true` | Hide errors that aren't `GraphQLError`s. Turn off only while developing |
| `onUnexpectedError` | `console.error` | Receives each hidden error |
