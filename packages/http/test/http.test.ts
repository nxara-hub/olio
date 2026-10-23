import { afterAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createModule, olio } from "@nxlab/olio";
import { GraphQLError } from "graphql";
import { createClient as createSseClient } from "graphql-sse";
import { createClient } from "graphql-ws/client";
import { WebSocketServer } from "ws";

import { bunWebSocket } from "../src/bun.js";
import { fetchHandler } from "../src/fetch.js";
import { nodeHandler } from "../src/node.js";
import { wsServer } from "../src/ws.js";

const app = olio({
  modules: [
    createModule("demo", {
      typeDefs: /* GraphQL */ `
        type Query {
          hello: String!
          whoami: String
          forbidden: String
          broken: String
        }
        type Subscription {
          ticks(upTo: Int!): Int!
          whoami: String!
          broken: Int!
        }
      `,
      resolvers: {
        Query: {
          hello: () => "hi",
          whoami: (_root, _args, ctx) =>
            (ctx as { user?: string }).user ?? null,
          forbidden: () => {
            throw new GraphQLError("Forbidden", {
              extensions: { code: "FORBIDDEN" }
            });
          },
          broken: () => {
            throw new Error("database is down");
          }
        },
        Subscription: {
          async *ticks(_root, args) {
            for (let n = 1; n <= Number(args.upTo); n++) yield n;
          },
          async *whoami(_root, _args, ctx) {
            yield (ctx as { user: string }).user;
          },
          // oxlint-disable-next-line require-yield -- fails before yielding
          async *broken() {
            throw new Error("queue is down");
          }
        }
      }
    })
  ]
});

const post = (
  handler: (r: Request) => Promise<Response>,
  query: string,
  headers = {}
) =>
  handler(
    new Request("http://localhost/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ query })
    })
  ).then(
    (r) =>
      r.json() as Promise<{ data?: unknown; errors?: { message: string }[] }>
  );

describe("fetch", () => {
  const unexpected: unknown[] = [];
  const handler = fetchHandler(app, {
    context: (request) => ({
      user: request.headers.get("x-user") ?? undefined
    }),
    onUnexpectedError: (error) => unexpected.push(error)
  });

  test("runs queries over POST and GET, with context from the request", async () => {
    expect(
      await post(handler, "{ hello whoami }", { "x-user": "ada" })
    ).toEqual({
      data: { hello: "hi", whoami: "ada" }
    });
    const get = await handler(
      new Request("http://localhost/graphql?query=%7B%20hello%20%7D", {
        headers: { accept: "application/graphql-response+json" }
      })
    );
    expect(await get.json()).toEqual({ data: { hello: "hi" } });
  });

  test("hides unexpected errors, passes GraphQLErrors, and reports what it hid", async () => {
    const result = await post(handler, "{ forbidden broken }");
    expect(result.errors?.map((e) => e.message)).toEqual([
      "Forbidden",
      "Unexpected error."
    ]);
    expect(result.errors?.[0]).toMatchObject({
      extensions: { code: "FORBIDDEN" }
    });
    expect(unexpected.map((e) => (e as Error).message)).toEqual([
      "database is down"
    ]);

    const open = fetchHandler(app, {
      maskErrors: false,
      onUnexpectedError: () => {}
    });
    expect((await post(open, "{ broken }")).errors?.[0]?.message).toBe(
      "database is down"
    );
  });
});

/** Listen on a free port; closed after the tests. */
const servers: { close(): unknown }[] = [];
const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => {
    servers.push(server);
    server.listen(0, () => resolve((server.address() as AddressInfo).port));
  });
afterAll(() => {
  for (const server of servers) server.close();
});

test("node: serves node:http requests", async () => {
  const port = await listen(
    createServer(
      nodeHandler(app, { context: (req) => ({ user: req.headers["x-user"] }) })
    )
  );
  const response = await fetch(`http://localhost:${port}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user": "alan" },
    body: JSON.stringify({ query: "{ whoami }" })
  });
  expect(await response.json()).toEqual({ data: { whoami: "alan" } });
});

/** Resolves once `check` holds, polling every 10ms for up to 2s. */
const until = (check: () => boolean): Promise<void> =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (check() || Date.now() - started > 2000) {
        clearInterval(timer);
        if (check()) resolve();
        else reject(new Error("timed out"));
      }
    }, 10);
  });

/** Every value a graphql-ws subscription emits. */
async function collect(url: string, query: string, connectionParams = {}) {
  const client = createClient({
    url,
    webSocketImpl: WebSocket,
    connectionParams,
    retryAttempts: 0
  });
  const values: unknown[] = [];
  try {
    for await (const result of client.iterate({ query })) values.push(result);
  } catch (errors) {
    values.push({ errors });
  } finally {
    await client.dispose();
  }
  return values;
}

describe.each([
  [
    "ws",
    async () => {
      const server = createServer();
      const port = await listen(server);
      const close = wsServer(
        app,
        new WebSocketServer({ server, path: "/graphql" }),
        {
          context: ({ connectionParams, request }) => ({
            user: `${String(connectionParams?.user)} via ${request.url}`
          }),
          onUnexpectedError: () => {}
        }
      );
      servers.push({ close });
      return `ws://localhost:${port}/graphql`;
    }
  ],
  [
    "bun",
    async () => {
      const subscriptions = bunWebSocket(app, {
        context: ({ connectionParams, request }) => ({
          user: `${String(connectionParams?.user)} via ${new URL(request.url).pathname}`
        }),
        onUnexpectedError: () => {}
      });
      const server = Bun.serve({
        port: 0,
        fetch: (request, srv) =>
          subscriptions.upgrade(request, srv)
            ? undefined
            : new Response("not found", { status: 404 }),
        websocket: subscriptions.websocket
      });
      servers.push({ close: () => server.stop(true) });
      return `ws://localhost:${server.port}/graphql`;
    }
  ]
])("%s: subscriptions over graphql-ws", (_name, start) => {
  test("streams values, with context from the connection, and hides unexpected errors", async () => {
    const url = await start();
    expect(await collect(url, "subscription { ticks(upTo: 3) }")).toEqual([
      { data: { ticks: 1 } },
      { data: { ticks: 2 } },
      { data: { ticks: 3 } }
    ]);
    expect(
      await collect(url, "subscription { whoami }", { user: "ada" })
    ).toEqual([{ data: { whoami: "ada via /graphql" } }]);
    const broken = (await collect(url, "subscription { broken }")) as {
      errors?: { message: string }[];
    }[];
    expect(broken[0]?.errors?.[0]?.message).toBe("Unexpected error.");
  });
});

/** Every value a graphql-sse subscription emits; errors end the list. */
function sseCollect(client: ReturnType<typeof createSseClient>, query: string) {
  return new Promise<unknown[]>((resolve) => {
    const values: unknown[] = [];
    client.subscribe(
      { query },
      {
        next: (value) => values.push(value),
        error: (errors) => resolve([...values, { errors }]),
        complete: () => resolve(values)
      }
    );
  });
}

describe.each([
  [
    "fetch",
    () => {
      const handler = fetchHandler(app, {
        context: () => ({ user: "http" }),
        subscriptionContext: (request) => ({
          user: `${request.headers.get("x-user")} over sse`
        }),
        onUnexpectedError: () => {}
      });
      return {
        url: "http://localhost/graphql",
        // graphql-sse's client calls fetchFn with a URL string.
        fetchFn: ((input: string, init?: RequestInit) =>
          handler(new Request(input, init))) as typeof fetch
      };
    }
  ],
  [
    "node",
    async () => {
      const port = await listen(
        createServer(
          nodeHandler(app, {
            context: () => ({ user: "http" }),
            subscriptionContext: (req) => ({
              user: `${String(req.headers["x-user"])} over sse`
            }),
            onUnexpectedError: () => {}
          })
        )
      );
      return { url: `http://localhost:${port}/graphql`, fetchFn: fetch };
    }
  ]
])(
  "%s: subscriptions over server-sent events, on the same URL",
  (_name, start) => {
    test("streams values with their own context, hides unexpected errors, still serves queries", async () => {
      const { url, fetchFn } = await start();
      const client = createSseClient({
        url,
        fetchFn,
        headers: { "x-user": "ada" },
        retryAttempts: 0
      });
      try {
        expect(
          await sseCollect(client, "subscription { ticks(upTo: 2) }")
        ).toEqual([{ data: { ticks: 1 } }, { data: { ticks: 2 } }]);
        expect(await sseCollect(client, "subscription { whoami }")).toEqual([
          { data: { whoami: "ada over sse" } }
        ]);
        const [broken] = (await sseCollect(
          client,
          "subscription { broken }"
        )) as {
          errors?: { message: string }[];
        }[];
        expect(broken?.errors?.[0]?.message).toBe("Unexpected error.");
      } finally {
        client.dispose();
      }

      // A plain POST to the same URL is still GraphQL over HTTP, with `context`.
      const response = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "{ whoami }" })
      });
      expect(await response.json()).toEqual({ data: { whoami: "http" } });
    });
  }
);

describe("a context hook that throws", () => {
  const leak = () => {
    throw new Error("password=hunter2");
  };
  const denied = () => {
    throw new GraphQLError("Bad token", {
      extensions: { code: "UNAUTHENTICATED" }
    });
  };
  const query = (handler: (r: Request) => Promise<Response>) =>
    handler(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "{ hello }" })
      })
    );

  test("over HTTP: a GraphQL error, hidden and reported unless deliberate", async () => {
    const reported: unknown[] = [];
    const unexpected = await query(
      fetchHandler(app, {
        context: leak,
        onUnexpectedError: (e) => reported.push(e)
      })
    );
    expect(unexpected.status).toBe(500);
    expect(await unexpected.json()).toEqual({
      errors: [{ message: "Unexpected error." }]
    });
    expect(reported.map((e) => (e as Error).message)).toEqual([
      "password=hunter2"
    ]);

    const deliberate = await query(fetchHandler(app, { context: denied }));
    expect(deliberate.status).toBe(200);
    expect(await deliberate.json()).toEqual({
      errors: [
        { message: "Bad token", extensions: { code: "UNAUTHENTICATED" } }
      ]
    });
  });

  test("over SSE and WebSocket: hidden, never the raw message", async () => {
    const reported: unknown[] = [];
    const onUnexpectedError = (e: unknown) => reported.push(e);
    const handler = fetchHandler(app, {
      subscriptionContext: leak,
      onUnexpectedError
    });
    const sse = createSseClient({
      url: "http://localhost/graphql",
      fetchFn: ((input: string, init?: RequestInit) =>
        handler(new Request(input, init))) as typeof fetch,
      retryAttempts: 0
    });
    const [sseResult] = (await sseCollect(
      sse,
      "subscription { ticks(upTo: 1) }"
    )) as {
      errors?: unknown;
    }[];
    sse.dispose();
    expect(JSON.stringify(sseResult?.errors)).toContain("Unexpected error.");
    expect(JSON.stringify(sseResult?.errors)).not.toContain("hunter2");

    const nodePort = await listen(
      createServer(
        nodeHandler(app, { subscriptionContext: leak, onUnexpectedError })
      )
    );
    const nodeSse = createSseClient({
      url: `http://localhost:${nodePort}/graphql`,
      retryAttempts: 0
    });
    const [nodeResult] = (await sseCollect(
      nodeSse,
      "subscription { ticks(upTo: 1) }"
    )) as {
      errors?: unknown;
    }[];
    nodeSse.dispose();
    expect(JSON.stringify(nodeResult?.errors)).toContain("Unexpected error.");

    const server = createServer();
    const port = await listen(server);
    const close = wsServer(
      app,
      new WebSocketServer({ server, path: "/graphql" }),
      {
        context: leak,
        onUnexpectedError
      }
    );
    servers.push({ close });
    const ws = await collect(
      `ws://localhost:${port}/graphql`,
      "subscription { ticks(upTo: 1) }"
    );
    const closed = (ws[0] as { errors?: { reason?: string } }).errors;
    expect(closed?.reason).toBe("Unexpected error.");
    expect(reported.map((e) => (e as Error).message)).toEqual([
      "password=hunter2",
      "password=hunter2",
      "password=hunter2"
    ]);
  });
});

describe("onOperationEnd", () => {
  test("runs once per operation, with its context, on every transport", async () => {
    const ended: string[] = [];
    let n = 0;
    const make = (label: string) => ({ user: `${label}-${++n}` });
    const onOperationEnd = (ctx: unknown) =>
      void ended.push((ctx as { user: string }).user);

    // HTTP: after the response.
    const handler = fetchHandler(app, {
      context: () => make("http"),
      subscriptionContext: () => make("sse"),
      onOperationEnd
    });
    await post(handler, "{ hello }");
    expect(ended).toEqual(["http-1"]);

    // SSE: when the stream completes.
    const sse = createSseClient({
      url: "http://localhost/graphql",
      fetchFn: ((input: string, init?: RequestInit) =>
        handler(new Request(input, init))) as typeof fetch,
      retryAttempts: 0
    });
    await sseCollect(sse, "subscription { ticks(upTo: 2) }");
    sse.dispose();
    expect(ended).toEqual(["http-1", "sse-2"]);

    // WebSocket: when an operation completes, and when its socket closes early.
    const server = createServer();
    const port = await listen(server);
    const close = wsServer(
      app,
      new WebSocketServer({ server, path: "/graphql" }),
      {
        context: () => make("ws"),
        onOperationEnd
      }
    );
    servers.push({ close });
    const url = `ws://localhost:${port}/graphql`;
    await collect(url, "subscription { ticks(upTo: 1) }");

    const client = createClient({
      url,
      webSocketImpl: WebSocket,
      retryAttempts: 0
    });
    const endless = client.iterate({
      query: "subscription { ticks(upTo: 1000000) }"
    });
    await endless.next();
    await client.dispose(); // closes the socket mid-subscription
    await until(() => ended.length >= 4);
    expect(ended).toEqual(["http-1", "sse-2", "ws-3", "ws-4"]);
  });

  test("a failing hook is reported, never sent to the client", async () => {
    const reported: unknown[] = [];
    const handler = fetchHandler(app, {
      context: () => ({}),
      onOperationEnd: () => {
        throw new Error("cleanup failed");
      },
      onUnexpectedError: (e) => reported.push(e)
    });
    expect(await post(handler, "{ hello }")).toEqual({ data: { hello: "hi" } });
    expect(reported.map((e) => (e as Error).message)).toEqual([
      "cleanup failed"
    ]);
  });
});
