import { afterAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createModule, olio } from "@nxlab/olio";
import { GraphQLError } from "graphql";
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
