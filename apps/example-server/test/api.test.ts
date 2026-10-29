import { describe, expect, test } from "bun:test";

import { testClient } from "@nxara/olio-client/test";

import { graphqlHandler } from "../src/http.js";
import { sseHandler, wsOptions } from "../src/subscriptions.js";
import { operations } from "./generated.js";

declare module "@nxara/olio-client" {
  interface ClientScalars {
    DateTime: string;
  }
}

// The same handlers server.ts serves, called in-process.
const servers = { http: graphqlHandler, ws: wsOptions, sse: sseHandler };
const anonymous = testClient(operations, servers);

const signIn = async (email: string) => {
  const { data } = await anonymous.mutation.login({ email, password: "demo" });
  if (data?.login.__typename !== "Session")
    throw new Error(`login failed: ${email}`);
  return testClient(operations, servers, {
    headers: { authorization: `Bearer ${data.login.token}` }
  });
};

describe("the ERP over HTTP", () => {
  test("a wrong password is a typed result", async () => {
    const { data } = await anonymous.mutation.login({
      email: "carl@erp.test",
      password: "nope"
    });
    expect(data?.login).toEqual({
      __typename: "InvalidCredentials",
      message: "Wrong email or password"
    });
  });

  test("products need a session; variables and nested fields are typed", async () => {
    const denied = await anonymous.query.products({ search: "chair" });
    expect(denied.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");

    const carl = await signIn("carl@erp.test");
    const { data } = await carl.query.products({ search: "chair" });
    expect(data?.products.items).toEqual([
      { sku: "CHAIR-01", price: { amount: 14_900, currency: "EUR" } }
    ]);
  });

  test("an operation over the cost limit is rejected before any resolver", async () => {
    // A page costs its size times its items' selection (src/limits.ts):
    // 600 × 2 is over 1000, so even the session check never runs.
    const expensive = await anonymous.query.productPage({ pageSize: 600 });
    expect(expensive.errors?.[0]?.message).toBe(
      "The query exceeds the maximum complexity of 1000. Actual complexity is 1200"
    );
    const carl = await signIn("carl@erp.test");
    const { data } = await carl.query.productPage({ pageSize: 2 });
    expect(data?.products.items).toHaveLength(2);
  });
});

describe("subscriptions, through the app's own servers", () => {
  test("need a signed-in user, over WebSocket and server-sent events", async () => {
    const results = await Promise.all([
      anonymous.subscription.stockChanged({ sku: "CHAIR-01" }).next(),
      anonymous.subscription.stockChangedOverSse({ sku: "CHAIR-01" }).next()
    ]);
    for (const { value } of results) {
      expect(value?.errors?.[0]?.extensions?.code).toBe("UNAUTHENTICATED");
    }
  });
});
