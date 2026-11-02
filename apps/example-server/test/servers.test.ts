import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createClient as createOlioClient } from "@nxara/olio-client";
import { createClient as createSseClient } from "graphql-sse";
import { createClient as createWsClient } from "graphql-ws";

import { container } from "../src/di.js";
import { operations } from "./generated.js";

// The port is the OS's, since both files listen as soon as they're imported.
process.env.PORT = "0";

let disposed = 0;
let failing = false;
const scope = container.scope.bind(container);
container.scope = ((request: never) => {
  const real = scope(request) as unknown as Record<string, unknown> & {
    dispose(): Promise<void>;
  };
  return new Proxy(real, {
    get(target, key) {
      if (key === "dispose") {
        return () => {
          disposed += 1;
          return target.dispose();
        };
      }
      if (failing && key === "productLoader") {
        throw new Error("secret db password");
      }
      return target[key as string];
    }
  });
}) as unknown as typeof container.scope;

const servers = {
  yoga: () => import("../src/server-yoga.js"),
  apollo: () => import("../src/server-apollo.js")
};

describe.each(Object.entries(servers))("the ERP on %s", (_name, load) => {
  let server: Server;
  let ws: ReturnType<typeof createWsClient>;
  let client: ReturnType<typeof clientFor>;
  let url: string;

  const clientFor = (url: string) => {
    ws = createWsClient({
      url: url.replace(/^http/, "ws"),
      retryAttempts: 0
    });
    return createOlioClient(operations, {
      url,
      ws,
      sse: createSseClient({ url, retryAttempts: 0 })
    });
  };

  beforeAll(async () => {
    ({ server } = await load());
    if (!server.listening) {
      await new Promise((resolve) => server.once("listening", resolve));
    }
    const { port } = server.address() as AddressInfo;
    url = `http://localhost:${port}/graphql`;
    client = clientFor(url);
  });

  afterAll(async () => {
    await ws.dispose();
    server.closeAllConnections();
    server.close();
  });

  test("a wrong password is a typed result, and the scope is disposed", async () => {
    const before = disposed;
    const { data } = await client.mutation.login({
      email: "carl@erp.test",
      password: "nope"
    });
    expect(data?.login).toEqual({
      __typename: "InvalidCredentials",
      message: "Wrong email or password"
    });
    expect(disposed).toBe(before + 1);
  });

  test("an unexpected error stays on the server", async () => {
    const login = await client.mutation.login({
      email: "mia@erp.test",
      password: "demo"
    });
    if (login.data?.login.__typename !== "Session") {
      throw new Error("Sign-in failed");
    }
    const report = spyOn(console, "error").mockImplementation(() => undefined);
    failing = true;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${login.data.login.token}`
      },
      body: JSON.stringify({
        query: `mutation {
          placeOrder(customerId: "c1", lines: [{ sku: "LAMP-01", quantity: 1 }]) {
            ... on SalesOrder { lines { product { sku } } }
          }
        }`
      })
    });
    const { errors } = (await response.json()) as {
      errors: { message: string }[];
    };
    failing = false;
    report.mockRestore();
    expect(errors[0]?.message).toBe("Unexpected error.");
    expect(JSON.stringify(errors)).not.toContain("secret");
  });

  test("middleware refuses without a session", async () => {
    const { errors } = await client.query.products({ search: "chair" });
    expect(errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
  });

  test("the cost limit reads each request's variables", async () => {
    // Small first, so a cached validation of the document would let 600 through.
    const small = await client.query.productPage({ pageSize: 2 });
    expect(small.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    const large = await client.query.productPage({ pageSize: 600 });
    expect(large.errors?.[0]?.message).toBe(
      "The query exceeds the maximum complexity of 1000. Actual complexity is 1200"
    );
  });

  test("subscriptions refuse over WebSocket and server-sent events", async () => {
    const results = await Promise.all([
      client.subscription.stockChanged({ sku: "CHAIR-01" }).next(),
      client.subscription.stockChangedOverSse({ sku: "CHAIR-01" }).next()
    ]);
    for (const { value } of results) {
      expect(value?.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    }
  });
});
