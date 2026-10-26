import { afterAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createModule, olio } from "@nxlab/olio";
import { GraphQLError, type ValidationRule } from "graphql";

import { fetchHandler } from "../src/fetch.js";
import { errorMasker, validateOperation } from "../src/index.js";
import { nodeHandler } from "../src/node.js";

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

test("errorMasker: defaults, caught values, and any result shape", () => {
  const reported: unknown[] = [];
  const mask = errorMasker({ onUnexpectedError: (e) => reported.push(e) });
  const forbidden = new GraphQLError("Forbidden");
  expect(mask.error(forbidden)).toBe(forbidden);
  expect(mask.error(new Error("db")).message).toBe("Unexpected error.");
  expect(mask.error("not even an Error").message).toBe("Unexpected error.");
  // graphql-sse's onNext also hands incremental results: kept as they are.
  const patch = {
    hasNext: true,
    errors: [new GraphQLError("db", { originalError: new Error("db") })]
  };
  const masked = mask.result(patch);
  expect(masked.hasNext).toBe(true);
  expect(masked.errors.map((e) => e.message)).toEqual(["Unexpected error."]);
  expect(reported).toHaveLength(3);
  // No options needed.
  expect(errorMasker().error(forbidden)).toBe(forbidden);
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

// Rejects any selection of `field`, before a resolver runs.
const forbid =
  (field: string): ValidationRule =>
  (context) => ({
    Field(node) {
      if (node.name.value === field) {
        context.reportError(
          new GraphQLError(`${field} is off limits`, { nodes: node })
        );
      }
    }
  });

describe("validationRules", () => {
  const ask = (
    handler: (r: Request) => Promise<Response>,
    query: string,
    variables?: Record<string, unknown>
  ) =>
    handler(
      new Request("http://localhost/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables })
      })
    ).then((r) => r.json() as Promise<{ errors?: { message: string }[] }>);

  test("run with graphql's own rules, before any resolver", async () => {
    const handler = fetchHandler(app, { validationRules: [forbid("broken")] });
    // broken throws if it runs; the rule's message means it never did.
    expect((await ask(handler, "{ broken }")).errors?.[0]?.message).toBe(
      "broken is off limits"
    );
    // graphql's rules still apply next to yours.
    expect((await ask(handler, "{ nope }")).errors?.[0]?.message).toBe(
      'Cannot query field "nope" on type "Query".'
    );
    expect(await ask(handler, "{ hello }")).toEqual({
      data: { hello: "hi" }
    } as never);
  });

  test("a function builds them per operation, from its variables", async () => {
    const handler = fetchHandler(app, {
      validationRules: ({ variables }) =>
        variables.strict ? [forbid("hello")] : []
    });
    const query =
      "query ($strict: Boolean!) { hello again: hello @skip(if: $strict) }";
    expect(await ask(handler, query, { strict: false })).toEqual({
      data: { hello: "hi", again: "hi" }
    } as never);
    expect(
      (await ask(handler, query, { strict: true })).errors?.[0]?.message
    ).toBe("hello is off limits");
  });

  test("validateOperation applies the same, for subscription servers", () => {
    const rules = [forbid("hello")];
    expect(
      validateOperation(app.schema, { query: "{ whoami }" }, rules)
    ).toEqual([]);
    expect(
      validateOperation(app.schema, { query: "{ hello }" }, rules).map(
        (e) => e.message
      )
    ).toEqual(["hello is off limits"]);
    expect(
      validateOperation(app.schema, { query: "{ hello" }, rules).map(
        (e) => e.message
      )
    ).toEqual(["Syntax Error: Expected Name, found <EOF>."]);
  });
});

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
});

describe("onOperationEnd", () => {
  test("runs once per operation, with its context, after the response", async () => {
    const ended: string[] = [];
    let n = 0;
    const onOperationEnd = (ctx: unknown) =>
      void ended.push((ctx as { user: string }).user);
    const handler = fetchHandler(app, {
      context: () => ({ user: `fetch-${++n}` }),
      onOperationEnd
    });
    await post(handler, "{ hello }");
    await post(handler, "{ hello }");
    expect(ended).toEqual(["fetch-1", "fetch-2"]);

    const port = await listen(
      createServer(
        nodeHandler(app, { context: () => ({ user: "node" }), onOperationEnd })
      )
    );
    await fetch(`http://localhost:${port}/graphql`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "{ hello }" })
    });
    expect(ended).toEqual(["fetch-1", "fetch-2", "node"]);
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
