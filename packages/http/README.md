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

Pass them `app.schema`; `errorMasker` hides their unexpected errors the way the HTTP handler does, and `validateOperation` applies its rules. Both, with a context (and DI scope) per subscription, disposed when it ends:

```ts
import { errorMasker, validateOperation } from "@nxlab/http";
import type { SubscriptionContext } from "@nxlab/olio";
import { createHandler } from "graphql-sse/lib/use/fetch";
import { useServer } from "graphql-ws/use/ws";

const mask = errorMasker<SubscriptionContext>();

// graphql-sse: route requests with `Accept: text/event-stream` here, GET and
// POST (what @nxlab/client sends; single-connection mode also needs PUT and DELETE).
export const sseHandler = createHandler({
  schema: app.schema,
  context: (req) =>
    createContext(req.raw.headers.get("authorization")) as never,
  onSubscribe: (_req, params) => {
    const errors = validateOperation(app.schema, params, validationRules);
    return errors.length ? { data: null, errors: [...errors] } : undefined; // needs `data`
  },
  onNext: (ctx, _req, result) =>
    mask.result(result, ctx as unknown as SubscriptionContext),
  onComplete: (ctx) => (ctx as unknown as SubscriptionContext).di.dispose()
});

// graphql-ws, on a `ws` server: `context` runs once per subscription, so the
// scope is per operation; keep it by connection and id to end it.
const live = new WeakMap<object, Map<string, SubscriptionContext>>();
useServer(
  {
    schema: app.schema,
    context: (ctx, id) => {
      // A browser can't set WebSocket headers: @nxlab/client sends them here.
      const headers = ctx.connectionParams?.headers as
        | Record<string, string>
        | undefined;
      const value = createContext(headers?.authorization);
      live.set(ctx, (live.get(ctx) ?? new Map()).set(id, value));
      return value as never;
    },
    onSubscribe: (_ctx, _id, payload) => {
      const errors = validateOperation(app.schema, payload, validationRules);
      return errors.length ? errors : undefined;
    },
    onNext: (ctx, id, _payload, _args, result) =>
      mask.result(result, live.get(ctx)?.get(id)),
    onError: (ctx, id, _payload, errors) =>
      errors.map((e) => mask.error(e, live.get(ctx)?.get(id)).toJSON()),
    // Also runs when the socket closes mid-subscription (see the note below).
    onComplete: async (ctx, id) => {
      const value = live.get(ctx)?.get(id);
      live.get(ctx)?.delete(id);
      await value?.di.dispose();
    }
  },
  new WebSocketServer({ server, path: "/graphql" })
);
```

When a socket closes, graphql-ws ends each live subscription and waits for it before `onComplete`. A resolver that's an `async *` waiting inside `for await` can only end at its next event, so until one arrives, nothing is cleaned up. Return the event source's own iterator instead (olio's README, [Subscriptions](../olio/README.md#subscriptions)).

With `@hono/node-server`, `serve()` is typed to return HTTP/2 servers too: pass `server as Server` (from `node:http`) to `WebSocketServer`. [`apps/example-server/src/subscriptions.ts`](../../apps/example-server/src/subscriptions.ts) is all of this, running. For tests, `testClient` from `@nxlab/client/test` runs these same options and handler in memory, so export them (the example exports `wsOptions` and `sseHandler`).

## Refusing a bad token

Don't throw from `context`. A throw there refuses the whole request before any field runs, so a client still holding an expired token can't even call `login` to get a new one. Build a context without a user instead, and refuse in middleware; public fields skip it with `@bypass` (olio's README, [Skipping middleware](../olio/README.md#skipping-middleware-bypass)):

```ts
fetchHandler(app, {
  // An invalid or expired token gives `userId: undefined`, not an error.
  context: (request) => ({
    userId: verify(request.headers.get("authorization"))
  })
});

const requireAuth =
  (): MiddlewareFn =>
  ({ ctx, bypass }, next) => {
    if (!ctx.userId && !bypass.has("auth")) throw unauthenticated();
    return next();
  };
```

It's also the only way that gives clients the same `UNAUTHENTICATED` result, at once, on every transport. Over subscriptions, a `context` that throws is a server error to both libraries: graphql-ws closes the socket with 4500 (the error's code is lost), graphql-sse's handler throws (your framework answers 500). Refusing the socket in graphql-ws's `onConnect` closes it with 4403, which graphql-ws's client retries by default ([@nxlab/client](../client/README.md#subscriptions)).

## Validation rules

`validationRules` run with graphql's own, before any resolver: a cost or depth limit, say. They're added to graphql's rules, never in their place. Pass a list, or a function of the operation (`{ variables, operationName }`) for rules that need its variables, like [graphql-query-complexity](https://github.com/slicknode/graphql-query-complexity) pricing a page by its size:

```ts
import {
  createComplexityRule,
  fieldExtensionsEstimator,
  simpleEstimator
} from "graphql-query-complexity";

fetchHandler(app, {
  context,
  validationRules: ({ variables }) => [
    createComplexityRule({
      maximumComplexity: 1000,
      variables,
      estimators: [
        fieldExtensionsEstimator(),
        simpleEstimator({ defaultComplexity: 1 })
      ]
    })
  ]
});
```

`fieldExtensionsEstimator` reads each field's `complexity` extension, which olio sets from the resolver's `{ resolve, extensions }`. An operation over the limit gets the rule's error, and nothing runs.

Subscription servers take the same rules through `validateOperation(schema, operation, rules)` in their `onSubscribe`; it returns the errors (none when the operation is valid):

```ts
import { validateOperation } from "@nxlab/http";

// graphql-ws
onSubscribe: (_ctx, _id, payload) => {
  const errors = validateOperation(app.schema, payload, validationRules);
  return errors.length ? errors : undefined;
};
// graphql-sse: a result needs `data` to be read as one
onSubscribe: (_req, params) => {
  const errors = validateOperation(app.schema, params, validationRules);
  return errors.length ? { data: null, errors: [...errors] } : undefined;
};
```

## Errors

Only `GraphQLError`s reach clients. Anything else that's thrown, such as a failing database or a bug, is replaced by `"Unexpected error."` and passed to `onUnexpectedError` (default: `console.error`), so it isn't lost. That includes a `context` hook that throws: a `GraphQLError` from it (say, `BAD_REQUEST` for a malformed header) reaches the client as a normal GraphQL error with status 200; anything else is a 500 with "Unexpected error.". It refuses the whole request, so a bad token belongs in middleware instead ([Refusing a bad token](#refusing-a-bad-token)).

```ts
throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } }); // the client sees this
throw new Error("connection refused"); // the client sees "Unexpected error."
```

`onUnexpectedError(error, { ctx, request })` gets what the error happened in, so logs can tie it to a request: `ctx` is the operation's context (`undefined` when the `context` hook itself failed), `request` the adapter's (a Fetch `Request`, or Node's `IncomingMessage`).

```ts
fetchHandler(app, {
  context,
  onUnexpectedError: (error, { ctx, request }) =>
    log.error({ error, requestId: ctx?.requestId, url: request.url })
});
```

`errorMasker(options?)`, from `@nxlab/http`, is the same masking for your own subscription servers. It takes the handlers' `maskErrors` and `onUnexpectedError` (both optional), and gives the functions below. Each takes the operation's context as a last argument, which `onUnexpectedError` receives as `ctx` (`request` is `undefined` there); type it with `errorMasker<SubscriptionContext>()`:

|  |  |
| --- | --- |
| `mask.result(result, ctx?)` | The result with its errors masked, any shape: graphql's `ExecutionResult`, or what graphql-sse's and graphql-ws's `onNext` hand you |
| `mask.error(error, ctx?)` | One error, or any caught value: a `GraphQLError` passes (unless it wraps an unexpected error), anything else becomes "Unexpected error." and is reported |
| `mask.report(error, ctx?)` | Sends an error to `onUnexpectedError` |

```ts
import { errorMasker } from "@nxlab/http";

const mask = errorMasker<SubscriptionContext>();
createHandler({
  schema: app.schema,
  onNext: (ctx, _req, result) => mask.result(result, ctx)
}); // graphql-sse
```

## Options

| Option | Default |  |
| --- | --- | --- |
| `context` | none | Builds `ctx` from the request. Required once the app registers a `ctx` type |
| `validationRules` | none | Rules run with graphql's own before execution: a list, or `({ variables, operationName }) => rules`. See [Validation rules](#validation-rules) |
| `onOperationEnd` | none | Called once per operation, after the response is built. Release per-operation resources here, e.g. `(ctx) => ctx.di.dispose()`. A failure in it goes to `onUnexpectedError` |
| `maskErrors` | `true` | Hide errors that aren't `GraphQLError`s. Turn off only while developing |
| `onUnexpectedError` | `console.error` of the error | `(error, { ctx, request }) => void`: receives each hidden error, with the context and request it happened in (`ctx` is `undefined` when the `context` hook failed) |
| graphql-http's own | its defaults | `execute`, `parse`, `validate`, `getOperationAST`, `rootValue`, `formatError` (runs after masking) and `parseRequestParams` (e.g. persisted queries: map an id to its stored query) go to [graphql-http](https://github.com/graphql/graphql-http) as they are. Not `onSubscribe`: operation args returned from it would skip `context` and every validation rule |
