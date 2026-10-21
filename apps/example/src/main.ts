import type { Context } from "@nxlab/olio";
import { graphql, parse, subscribe, type ExecutionResult } from "graphql";

import { createContext, createSubscriptionContext } from "./context.js";
import { app } from "./index.js";

// A day at the warehouse, end to end: every request goes through the same
// schema an HTTP server would serve. Indented lines are middleware logs.

const show = (result: ExecutionResult): void => {
  const errors = result.errors?.map((e) => e.message);
  console.log(
    JSON.stringify(errors ? { data: result.data, errors } : result.data)
  );
};

const run = async (
  title: string,
  source: string,
  ctx: Context
): Promise<ExecutionResult> => {
  console.log(`\n▸ ${title}`);
  const result = await graphql({
    schema: app.schema,
    source,
    contextValue: ctx
  });
  show(result);
  return result;
};

const login = async (email: string): Promise<string> => {
  const result = await run(
    `${email} signs in`,
    `mutation { login(email: "${email}", password: "demo") {
      ... on Session { token employee { name role } }
      ... on UserError { message }
    } }`,
    createContext()
  );
  const session = result.data?.login as { token?: string } | undefined;
  if (!session?.token) throw new Error(`login failed for ${email}`);
  return session.token;
};

// auth: login and me are public ("-login" / "-me"), everything else is not.
await run(
  "A wrong password is a typed result, not an error",
  `mutation { login(email: "carl@erp.test", password: "nope") {
    __typename ... on UserError { message }
  } }`,
  createContext()
);
const carl = await login("carl@erp.test"); // clerk
const mia = await login("mia@erp.test"); // manager

await run("Nobody signed in", "{ me { name } }", createContext());
await run("Carl", "{ me { name role } }", createContext(carl));

// inventory: products need a session; the filter input copies PageArgs.
await run(
  "Anonymous product search",
  `{ products(filter: { search: "desk" }) { items { sku } } }`,
  createContext()
);
await run(
  "Carl searches products",
  `{ products(filter: { search: "desk", pageSize: 5 }) {
    pageInfo { total hasNextPage }
    items { sku name price { amount currency } onHand stock { warehouse { code } quantity } }
  } }`,
  createContext(carl)
);

// Mia watches chair stock while the floor works.
const stream = await subscribe({
  schema: app.schema,
  document: parse(
    `subscription { stockChanged(sku: "CHAIR-01") { sku onHand updatedAt } }`
  ),
  contextValue: createSubscriptionContext("ws-1", mia)
});
if (!(Symbol.asyncIterator in stream)) throw new Error("subscription failed");
const firstEvent = stream.next();
// ponytail: let the subscription start before publishing; graphql-ws pulls
// right away, so a real server needs no such wait.
await new Promise((resolve) => setTimeout(resolve, 0));

// inventory middleware: adjusting stock is for managers.
await run(
  "Carl tries to book stock in",
  `mutation { adjustStock(sku: "DESK-01", warehouse: "AMS", delta: 10) { onHand } }`,
  createContext(carl)
);
await run(
  "Mia books 10 desks into Amsterdam",
  `mutation { adjustStock(sku: "DESK-01", warehouse: "AMS", delta: 10) { sku onHand } }`,
  createContext(mia)
);

// sales: placing orders returns SalesOrder | InsufficientStock.
await run(
  "Carl orders 50 chairs for Acme",
  `mutation { placeOrder(customerId: "c1", lines: [{ sku: "CHAIR-01", quantity: 50 }]) {
    __typename ... on InsufficientStock { message requested available }
  } }`,
  createContext(carl)
);
await run(
  "Carl orders 14 chairs and a desk for Acme",
  `mutation { placeOrder(customerId: "c1", lines: [
    { sku: "CHAIR-01", quantity: 14 }, { sku: "DESK-01", quantity: 1 }
  ]) {
    ... on SalesOrder {
      number status total { amount currency }
      lines { product { sku } quantity lineTotal { amount } }
      customer { name }
    }
  } }`,
  createContext(carl)
);

const event = await firstEvent;
if (!event.done) {
  console.log("\n▸ Mia's subscription sees the chairs go");
  show(event.value);
}
await stream.return?.();

// sales adds Product.unitsSold (inventory's type) and Customer.orders.
await run(
  "Sales fields on inventory's Product",
  `{ product(sku: "CHAIR-01") { sku onHand unitsSold } }`,
  createContext(mia)
);

// Customer.email has no resolver; its middleware still runs.
await run(
  "Carl looks up customers (email is managers only)",
  "{ customers { name email orders { number } } }",
  createContext(carl)
);
await run(
  "Mia looks up customers",
  "{ customers { name email creditLimit { amount } } }",
  createContext(mia)
);

await run(
  "Carl tries to cancel the order",
  `mutation { cancelOrder(id: "o1") { status } }`,
  createContext(carl)
);
await run(
  "Mia cancels it",
  `mutation { cancelOrder(id: "o1") { number status } }`,
  createContext(mia)
);

await run("Carl signs out", "mutation { logout }", createContext(carl));
await run("Carl's old token", "{ me { name } }", createContext(carl));
