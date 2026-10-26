# @nxlab/http

Serve an olio app over HTTP, on any framework: GraphQL over HTTP ([graphql-http](https://github.com/graphql/graphql-http), the reference implementation), with `context`, error masking and per-operation cleanup. Nothing more: subscriptions are yours to serve, with the libraries you choose (below).

```sh
bun add @nxlab/http
```

`graphql` 16 and `@nxlab/olio` are peer dependencies; graphql-http is the only dependency.

## Adapters

| Import | For |
| --- | --- |
| `@nxlab/http/fetch` | Anything that speaks the Fetch API: Hono, Elysia, Bun.serve, Deno, Cloudflare Workers, Next.js route handlers, SvelteKit, Remix |
| `@nxlab/http/node` | Node's `IncomingMessage` / `ServerResponse`: `node:http`, Express, Connect, Koa (`ctx.req`, `ctx.res`), Fastify (`request.raw`, `reply.raw`) |

Your `context` hook receives the framework's request: a Fetch `Request`, or a Node `IncomingMessage`. Once your app registers a `ctx` type (`interface Olio { ctx: … }`), the hook is required: without it graphql-http passes no context, and every resolver reading `ctx` would fail at runtime. So `fetchHandler(app)` is then a compile error (`Expected 2 arguments`), as is an options object without `context`.

```ts
import { fetchHandler } from "@nxlab/http/fetch";

const graphql = fetchHandler(app, {
  context: (request) => createContext(request.headers.get("authorization")),
  onOperationEnd: (ctx) => ctx.di.dispose()
});

hono.on(["GET", "POST"], "/graphql", (c) => graphql(c.req.raw)); // Hono
Bun.serve({ fetch: graphql }); // Bun
```

```ts
import { nodeHandler } from "@nxlab/http/node";

const graphql = nodeHandler(app, {
  context: (req) => createContext(req.headers.authorization)
});
expressApp.all("/graphql", (req, res) => graphql(req, res)); // or: createServer(graphql)
```

## Subscriptions

Not included, the way Apollo Server leaves them out: install and run the reference libraries yourself, at the versions you want, next to the HTTP handler.

- [graphql-ws](https://github.com/enisdenjo/graphql-ws): subscriptions over WebSocket (`useServer` on a `ws` server, `makeHandler` on Bun).
- [graphql-sse](https://github.com/enisdenjo/graphql-sse): subscriptions as server-sent events, on the same URL (route `Accept: text/event-stream` to its handler).

Pass them `app.schema`. `errorMasker` hides their unexpected errors the way the HTTP handler does. [`apps/example-server/src/subscriptions.ts`](../../apps/example-server/src/subscriptions.ts) sets up both, with masking and DI disposal, in about 70 lines. For tests, `testClient` from `@nxlab/client/test` runs both transports in memory.

## Errors

Only `GraphQLError`s reach clients. Anything else that's thrown, such as a failing database or a bug, is replaced by `"Unexpected error."` and passed to `onUnexpectedError` (default: `console.error`), so it isn't lost. That includes a `context` hook that throws: a `GraphQLError` from it (say, `UNAUTHENTICATED` for a bad token) reaches the client as a normal GraphQL error with status 200; anything else is a 500 with "Unexpected error.".

```ts
throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } }); // the client sees this
throw new Error("connection refused"); // the client sees "Unexpected error."
```

`errorMasker(options?)`, from `@nxlab/http`, is the same masking for your own subscription servers. It takes the handlers' `maskErrors` and `onUnexpectedError` (both optional), and gives:

|  |  |
| --- | --- |
| `mask.result(result)` | The result with its errors masked, any shape: graphql's `ExecutionResult`, or what graphql-sse's and graphql-ws's `onNext` hand you |
| `mask.error(error)` | One error, or any caught value: a `GraphQLError` passes (unless it wraps an unexpected error), anything else becomes "Unexpected error." and is reported |
| `mask.report(error)` | Sends an error to `onUnexpectedError` |

```ts
import { errorMasker } from "@nxlab/http";

const mask = errorMasker();
createHandler({
  schema: app.schema,
  onNext: (_ctx, _req, result) => mask.result(result)
}); // graphql-sse
```

## Options

| Option | Default |  |
| --- | --- | --- |
| `context` | none | Builds `ctx` from the request. Required once the app registers a `ctx` type |
| `onOperationEnd` | none | Called once per operation, after the response is built. Release per-operation resources here, e.g. `(ctx) => ctx.di.dispose()`. A failure in it goes to `onUnexpectedError` |
| `maskErrors` | `true` | Hide errors that aren't `GraphQLError`s. Turn off only while developing |
| `onUnexpectedError` | `console.error` | Receives each hidden error |
