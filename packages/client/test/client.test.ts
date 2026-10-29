import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { codegenClient } from "@nxlab/codegen";
import { errorMasker } from "@nxlab/http";
import { fetchHandler } from "@nxlab/http/fetch";
import { createModule, olio } from "@nxlab/olio";
import axios from "axios";
import { GraphQLError, GraphQLScalarType } from "graphql";
import { createClient as createSseClient } from "graphql-sse";
import { createHandler as createSseHandler } from "graphql-sse/lib/use/fetch";
import { createClient as createWsClient, type ServerOptions } from "graphql-ws";
import { makeHandler } from "graphql-ws/use/bun";
import ky from "ky";

import { createClient, fromAxios } from "../src/index.js";
import { testClient } from "../src/test.js";
import { operations } from "./generated.js";

declare module "@nxlab/client" {
  interface ClientScalars {
    // Like the server's CustomScalars: variables may be Dates, results are strings.
    DateTime: { input: Date | string; output: string };
  }
}

const products = [
  {
    id: "p1",
    name: "Chair",
    price: 150,
    tags: ["office"],
    createdAt: new Date("2026-01-02")
  },
  {
    id: "p2",
    name: "Desk",
    price: 500,
    tags: [],
    createdAt: new Date("2026-03-04")
  }
];
const seen: Record<string, unknown>[] = [];

const app = olio({
  modules: [
    createModule("shop", {
      typeDefs: readFileSync(new URL("schema.gql", import.meta.url), "utf8"),
      resolvers: {
        DateTime: new GraphQLScalarType({
          name: "DateTime",
          serialize: (value) => (value as Date).toISOString()
        }),
        Node: {
          __resolveType: (node: object) =>
            "price" in node ? "Product" : "Order"
        },
        Lookup: {
          __resolveType: (value: object) =>
            "price" in value ? "Product" : "NotFound"
        },
        Product: {
          price: (row, args) =>
            (row as { price: number }).price * (args.currency === "USD" ? 2 : 1)
        },
        Order: {
          lines: (order, args) =>
            (order as { lines: unknown[] }).lines.slice(
              0,
              Number(args.first ?? 99)
            )
        },
        Query: {
          products: (_root, args) => {
            seen.push(args);
            return products.slice(0, Number(args.first ?? 99));
          },
          product: (_root, args) =>
            products.find((p) => p.id === args.id) ?? { id: args.id },
          node: (_root, args) => products.find((p) => p.id === args.id) ?? null,
          recent: (_root, args) =>
            products.filter((p) => p.createdAt > new Date(String(args.after))),
          hello: () => "hi",
          echo: (_root, args) => String(args.text),
          whoami: (_root, _args, ctx) =>
            (ctx as { user?: string }).user ?? null,
          secret: () => {
            throw new GraphQLError("Forbidden", {
              extensions: { code: "FORBIDDEN" }
            });
          }
        },
        Mutation: {
          order: (_root, args) => ({
            id: "o1",
            status: "OPEN",
            lines: (
              args.lines as { productId: string; quantity: number }[]
            ).map((l) => ({
              product: products.find((p) => p.id === l.productId),
              quantity: l.quantity
            }))
          })
        },
        Subscription: {
          ticks(_root, args) {
            // A bug the app's masking must hide.
            if (Number(args.upTo) < 0) throw new Error("database is down");
            return (async function* () {
              for (let n = 1; n <= Number(args.upTo); n++) yield n;
            })();
          },
          // Yields who's asking, then stays open until the client leaves.
          async *viewer(_root, _args, ctx) {
            yield (ctx as { user?: string }).user ?? null;
            await new Promise(() => {});
          }
        }
      }
    })
  ]
});

const ended: unknown[] = [];
const handler = fetchHandler(app, {
  context: (request) => ({ user: request.headers.get("x-user") ?? undefined }),
  onOperationEnd: (ctx) => void ended.push(ctx)
});
// The app's own subscription servers, as in production: context from the
// client's headers, errors masked, each finished subscription recorded.
const subscriptionContext = (headers: Headers) => {
  const user = headers.get("x-user") ?? undefined;
  if (user === "banned") throw new GraphQLError("Banned");
  return { user };
};
const mask = errorMasker({ onUnexpectedError: () => {} });
const subscriptionsEnded: string[] = [];
const wsOptions: ServerOptions<Record<string, unknown> | undefined> = {
  schema: app.schema,
  context: ({ connectionParams }) =>
    subscriptionContext(
      new Headers(connectionParams?.headers as Record<string, string>)
    ),
  onNext: (_ctx, _id, _payload, _args, result) => mask.result(result),
  onComplete: () => void subscriptionsEnded.push("ws")
};
const sseHandler = createSseHandler({
  schema: app.schema,
  context: (req) => subscriptionContext(req.raw.headers) as never,
  onNext: (_ctx, _req, result) => mask.result(result),
  onComplete: () => void subscriptionsEnded.push("sse")
});
const handlers = { http: handler, ws: wsOptions, sse: sseHandler };
// Queries only, so no subscription clients are needed.
const queries = { query: operations.query };
const client = testClient(operations, handlers, {
  headers: { "x-user": "ada" }
});

describe("queries and mutations", () => {
  test("variables go as variables; data is the operation's result, typed", async () => {
    const { data, errors } = await client.query.products({
      first: 1,
      status: "OPEN",
      currency: "USD"
    });
    expect(errors).toBeUndefined();
    expect(data).toEqual({
      products: [
        { name: "Chair", price: 300, createdAt: "2026-01-02T00:00:00.000Z" }
      ]
    });
    expect(seen.at(-1)).toEqual({ first: 1, status: "OPEN" });
  });

  test("fragments: unions narrow on __typename, named fragments apply per type", async () => {
    const found = await client.query.product({ id: "p2" });
    expect(found.data?.product).toEqual({
      __typename: "Product",
      name: "Desk"
    });
    const missing = await client.query.product({ id: "p9" });
    expect(missing.data?.product).toEqual({ __typename: "NotFound", id: "p9" });
    if (missing.data?.product.__typename === "NotFound") {
      expect(missing.data.product.id).toBe("p9");
    }
    const node = await client.query.node({ id: "p1" });
    expect(node.data?.node).toEqual({ id: "p1", tags: ["office"] });
  });

  test("aliases, @include, mutations with input lists, optional variables", async () => {
    const greetings = await client.query.greetings({
      withTags: false
    });
    expect(greetings.data).toEqual({
      hello: "hi",
      shout: "hey",
      products: [{}, {}]
    });
    const { data } = await client.mutation.order({
      lines: [
        { productId: "p1", quantity: 2 },
        { productId: "p2", quantity: 1 }
      ],
      first: 1
    });
    expect(data?.order).toEqual({
      status: "OPEN",
      lines: [{ quantity: 2, product: { name: "Chair" } }]
    });
    expect((await client.query.products()).data?.products).toHaveLength(2);
  });

  test("the request goes through the handler: context, errors, onOperationEnd", async () => {
    ended.length = 0;
    expect((await client.query.whoami()).data?.whoami).toBe("ada");
    const other = await client.query.whoami(
      {},
      { headers: { "x-user": "alan" } }
    );
    expect(other.data?.whoami).toBe("alan");
    const denied = await client.query.secret();
    expect(denied.data).toEqual({ secret: null });
    expect(denied.errors?.[0]).toMatchObject({
      message: "Forbidden",
      extensions: { code: "FORBIDDEN" }
    });
    expect(ended).toHaveLength(3);

    let token = "t1";
    const rotating = testClient(operations, handlers, {
      headers: () => ({ "x-user": token })
    });
    expect((await rotating.query.whoami()).data?.whoami).toBe("t1");
    token = "t2";
    expect((await rotating.query.whoami()).data?.whoami).toBe("t2");
  });

  test("header values may be undefined; they're left out, not sent as text", async () => {
    const session: { user?: string } = {};
    const signedOut = testClient(operations, handlers, {
      headers: () => (session.user ? { "x-user": session.user } : {})
    });
    expect((await signedOut.query.whoami()).data?.whoami).toBeNull();
    session.user = "ada";
    expect((await signedOut.query.whoami()).data?.whoami).toBe("ada");

    const optional = testClient(operations, handlers, {
      headers: { "x-user": undefined }
    });
    // new Headers() would have sent the string "undefined".
    expect((await optional.query.whoami()).data?.whoami).toBeNull();
    const perCall = await optional.query.whoami(
      {},
      { headers: { "x-user": session.user && "alan" } }
    );
    expect(perCall.data?.whoami).toBe("alan");
  });

  test("a response that isn't GraphQL is an error, not a result", async () => {
    const broken = createClient(queries, {
      url: "http://localhost/graphql",
      fetch: async () =>
        new Response("<h1>Bad Gateway</h1>", {
          status: 502,
          statusText: "Bad Gateway"
        })
    });
    await expect(broken.query.whoami()).rejects.toThrow(
      "Whoami: HTTP 502 Bad Gateway"
    );
  });
});

describe("scalars", () => {
  test("custom scalars take their input type in variables, output type in results", async () => {
    const { data } = await client.query.recent({
      after: new Date("2026-02-01")
    });
    expect(data?.recent).toEqual([
      { name: "Desk", createdAt: "2026-03-04T00:00:00.000Z" }
    ]);
    const createdAt: string | undefined = data?.recent[0]?.createdAt;
    expect(createdAt).toBeString();
    // @ts-expect-error DateTime's input is Date | string
    void client.query.recent({ after: 1 });
  });
});

describe("subscriptions", () => {
  const take = async <T>(
    events: AsyncIterableIterator<T>,
    count: number
  ): Promise<T[]> => {
    const seen: T[] = [];
    for await (const event of events) {
      seen.push(event);
      if (seen.length === count) break;
    }
    return seen;
  };

  test("over WebSocket by default, server-sent events with @sse", async () => {
    const overWs = await take(client.subscription.ticks({ upTo: 3 }), 3);
    expect(overWs.map((e) => e.data?.ticks)).toEqual([1, 2, 3]);
    const overSse = await take(
      client.subscription.ticksOverSse({ upTo: 2 }),
      2
    );
    expect(overSse.map((e) => e.data?.ticks)).toEqual([1, 2]);
  });

  test("testClient sends its headers to the subscription context", async () => {
    const [event] = await take(client.subscription.viewer(), 1);
    expect(event?.data).toEqual({ viewer: "ada" });
  });

  test("a context that throws: an error result over WebSocket, a NetworkError at once over SSE", async () => {
    const banned = testClient(operations, handlers, {
      headers: { "x-user": "banned" }
    });
    const [refused] = await take(banned.subscription.viewer(), 1);
    expect(refused).toEqual({
      data: null,
      errors: [
        {
          message: "Banned",
          extensions: { code: "WEBSOCKET_CLOSED", closeCode: 4500 }
        }
      ]
    });
    await expect(
      take(banned.subscription.ticksOverSse({ upTo: 1 }), 1)
    ).rejects.toThrow("Banned");
  });

  test("the app's own servers run: its masking, and its cleanup when a subscription ends", async () => {
    const [overWs] = await take(client.subscription.ticks({ upTo: -1 }), 1);
    expect(overWs?.errors?.map((e) => e.message)).toEqual([
      "Unexpected error."
    ]);
    const [overSse] = await take(
      client.subscription.ticksOverSse({ upTo: -1 }),
      1
    );
    expect(overSse?.errors?.map((e) => e.message)).toEqual([
      "Unexpected error."
    ]);

    subscriptionsEnded.length = 0;
    await take(client.subscription.ticks({ upTo: 1 }), 1);
    await take(client.subscription.ticksOverSse({ upTo: 1 }), 1);
    // The servers hear the subscriptions end on a later tick.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(subscriptionsEnded.sort()).toEqual(["sse", "ws"]);
  });

  test("testClient needs the app's server for each transport the operations use", () => {
    // @ts-expect-error these operations subscribe over ws and sse
    expect(() => testClient(operations, handler)).toThrow(
      "pass testClient(operations, { http, sse })"
    );
    const sseOnly = { http: handler, sse: sseHandler };
    // @ts-expect-error the graphql-ws server is missing
    expect(() => testClient(operations, sseOnly)).toThrow(
      "graphql-ws server options"
    );
  });

  // The app's own graphql-ws server and clients, as in production.
  const serve = (options: Omit<ServerOptions, "schema">) =>
    Bun.serve({
      port: 0,
      fetch: (request, bun) =>
        bun.upgrade(request)
          ? undefined
          : new Response("Unauthorized", { status: 401 }),
      websocket: makeHandler({ schema: app.schema, ...options })
    });

  test("subscriptions go through the app's graphql-ws client: terminate() reconnects with new credentials", async () => {
    const server = serve({
      context: ({ connectionParams }) => ({
        user: (
          connectionParams?.headers as Record<string, string> | undefined
        )?.["x-user"]
      })
    });
    let user = "t1";
    const socket = createWsClient({
      url: `ws://localhost:${server.port}/graphql`,
      connectionParams: () => ({ headers: { "x-user": user } }),
      // A reconnect the app asks for needn't wait out the backoff.
      retryWait: async () => {}
    });
    try {
      const live = createClient(operations, {
        url: `http://localhost:${server.port}/graphql`,
        ws: socket,
        sse: createSseClient({ url: `http://localhost:${server.port}/graphql` })
      });
      const held = live.subscription.viewer();
      expect((await held.next()).value?.data).toEqual({ viewer: "t1" });
      user = "t2";
      socket.terminate();
      // graphql-ws resubscribes on the new socket.
      expect((await held.next()).value?.data).toEqual({ viewer: "t2" });
      await held.return?.();
    } finally {
      await socket.dispose();
      await server.stop(true);
    }
  });

  test("a server refusing: ws gives an error result, sse throws graphql-sse's NetworkError", async () => {
    const server = serve({ onConnect: () => false });
    const url = `http://localhost:${server.port}/graphql`;
    // Both libraries retry a refusal by default, for about 40 s.
    const socket = createWsClient({
      url: url.replace(/^http/, "ws"),
      retryAttempts: 0
    });
    try {
      const refused = createClient(operations, {
        url,
        ws: socket,
        sse: createSseClient({ url, retryAttempts: 0 })
      });
      const [overWs] = await take(refused.subscription.viewer(), 1);
      expect(overWs?.errors?.[0]?.extensions).toEqual({
        code: "WEBSOCKET_CLOSED",
        closeCode: 4403
      });
      await expect(
        take(refused.subscription.ticksOverSse({ upTo: 1 }), 1)
      ).rejects.toThrow("401");
    } finally {
      await socket.dispose();
      await server.stop(true);
    }
  });

  test("an operation the server rejects is an error result over WebSocket too", async () => {
    const server = serve({
      onSubscribe: () => [new GraphQLError("Too costly")]
    });
    const url = `http://localhost:${server.port}/graphql`;
    const socket = createWsClient({ url: url.replace(/^http/, "ws") });
    try {
      const live = createClient(operations, {
        url,
        ws: socket,
        sse: createSseClient({ url })
      });
      expect(await take(live.subscription.viewer(), 1)).toEqual([
        { data: null, errors: [{ message: "Too costly" }] }
      ]);
    } finally {
      await socket.dispose();
      await server.stop(true);
    }
  });
});

describe("custom fetch", () => {
  test("ky and axios (through fromAxios) work as the client's fetch", async () => {
    const server = Bun.serve({ port: 0, fetch: handler });
    const url = `http://localhost:${server.port}/graphql`;
    try {
      const withKy = createClient(queries, {
        url,
        headers: { "x-user": "ky" },
        // GraphQL errors can come with 4xx/5xx: let the client read them.
        fetch: ky.create({ throwHttpErrors: false })
      });
      expect((await withKy.query.whoami()).data).toEqual({ whoami: "ky" });

      const withAxios = createClient(queries, {
        url,
        headers: { "x-user": "axios" },
        fetch: fromAxios(axios)
      });
      expect((await withAxios.query.whoami()).data).toEqual({
        whoami: "axios"
      });
      expect((await withAxios.query.secret()).errors?.[0]?.message).toBe(
        "Forbidden"
      );
    } finally {
      await server.stop();
    }
  });
});

describe("codegen", () => {
  test("the schema can come from a running server, by introspection", async () => {
    const server = Bun.serve({ port: 0, fetch: handler });
    try {
      const output = join(
        mkdtempSync(join(tmpdir(), "nxlab-client-")),
        "generated.ts"
      );
      await codegenClient({
        schema: `http://localhost:${server.port}/graphql`,
        documents: new URL("operations.graphql", import.meta.url).pathname,
        output,
        logs: false
      });
      expect(readFileSync(output, "utf8")).toBe(
        readFileSync(new URL("generated.ts", import.meta.url), "utf8")
      );
    } finally {
      await server.stop();
    }
  });
});

describe("types", () => {
  test("ws and sse are required exactly for the transports the operations use", () => {
    const wsOnly = { query: {}, transports: ["ws"] } as const;
    const ws = createWsClient({ url: "ws://x" });
    const sse = createSseClient({ url: "http://x" });
    createClient(wsOnly, { url: "http://x", ws });
    // @ts-expect-error an operation subscribes over WebSocket
    createClient(wsOnly, { url: "http://x" });
    // @ts-expect-error no operation subscribes over SSE
    createClient(wsOnly, { url: "http://x", ws, sse });
    // @ts-expect-error nor over WebSocket
    createClient({ query: {} } as const, { url: "http://x", ws });
    // @ts-expect-error a client of the transport's library, not its options
    createClient(wsOnly, { url: "http://x", ws: { url: "ws://x" } });
  });

  test("variables and results are typed from the operation", () => {
    const check = async () => {
      const { data } = await client.query.products({ first: 1 });
      const price: number | undefined = data?.products[0]?.price;
      // @ts-expect-error tags isn't selected in Products
      void data?.products[0]?.tags;
      // @ts-expect-error first is an Int
      await client.query.products({ first: "1" });
      // @ts-expect-error status is OPEN | CLOSED
      await client.query.products({ status: "DONE" });
      // @ts-expect-error not a variable of Products
      await client.query.products({ nope: 1 });
      // @ts-expect-error text is required
      await client.query.echo();
      // @ts-expect-error not one of the operations
      void client.query.nope;
      const lookup = await client.query.product({ id: "p1" });
      // @ts-expect-error narrow on __typename first: NotFound has no name
      void lookup.data?.product.name;
      const greetings = await client.query.greetings({
        withTags: true
      });
      const first = greetings.data?.products[0];
      if (first) {
        // @ts-expect-error tags is under @include, so it may be missing
        const tags: string[] = first.tags;
        void tags;
      }
      const created: string | undefined = data?.products[0]?.createdAt;
      return [price, created];
    };
    expect(typeof check).toBe("function");
  });
});
