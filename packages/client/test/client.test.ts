import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { codegenClient } from "@nxlab/codegen";
import { fetchHandler } from "@nxlab/http/fetch";
import { createModule, olio } from "@nxlab/olio";
import axios from "axios";
import { GraphQLError, GraphQLScalarType } from "graphql";
import ky from "ky";

import { createClient, fromAxios, testClient } from "../src/index.js";
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
          async *ticks(_root, args) {
            for (let n = 1; n <= Number(args.upTo); n++) yield n;
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
const client = testClient(operations, handler, {
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
    const rotating = testClient(operations, handler, {
      headers: () => ({ "x-user": token })
    });
    expect((await rotating.query.whoami()).data?.whoami).toBe("t1");
    token = "t2";
    expect((await rotating.query.whoami()).data?.whoami).toBe("t2");
  });

  test("a response that isn't GraphQL is an error, not a result", async () => {
    const broken = createClient(operations, {
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
  test("stream over server-sent events on the same URL", async () => {
    const values: unknown[] = [];
    for await (const event of client.subscription.ticks({ upTo: 3 })) {
      values.push(event.data?.ticks);
    }
    expect(values).toEqual([1, 2, 3]);
  });
});

describe("custom fetch", () => {
  test("ky and axios (through fromAxios) work as the client's fetch", async () => {
    const server = Bun.serve({ port: 0, fetch: handler });
    const url = `http://localhost:${server.port}/graphql`;
    try {
      const withKy = createClient(operations, {
        url,
        headers: { "x-user": "ky" },
        // GraphQL errors can come with 4xx/5xx: let the client read them.
        fetch: ky.create({ throwHttpErrors: false })
      });
      expect((await withKy.query.whoami()).data).toEqual({ whoami: "ky" });
      const ticks: unknown[] = [];
      for await (const { data } of withKy.subscription.ticks({ upTo: 2 })) {
        ticks.push(data?.ticks);
      }
      expect(ticks).toEqual([1, 2]);

      const withAxios = createClient(operations, {
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
