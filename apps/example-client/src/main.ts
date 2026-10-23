import { createClient, type Result } from "@nxlab/client";

import { operations } from "./generated.js";

// Run the server first: bun run --cwd apps/example-server serve
const url = process.env.GRAPHQL_URL ?? "http://localhost:4000/graphql";

const session: { token?: string } = {};
const client = createClient(operations, {
  url,
  headers: (): Record<string, string> =>
    session.token ? { authorization: `Bearer ${session.token}` } : {}
});

const show = (title: string, { data, errors }: Result<unknown>): void => {
  console.log(`\n▸ ${title}`);
  console.log(
    JSON.stringify(
      errors ? { data, errors: errors.map((e) => e.message) } : data
    )
  );
};

const login = await client.mutation.login({
  email: "mia@erp.test",
  password: "demo"
});
show("Mia signs in", login);
if (login.data?.login.__typename !== "Session")
  throw new Error("Sign-in failed");
session.token = login.data.login.token;

show(
  'Products matching "desk"',
  await client.query.products({ search: "desk" })
);

// Watch chair stock over server-sent events while it moves below.
const changes = (async () => {
  const seen: unknown[] = [];
  for await (const { data } of client.subscription.stockChanged({
    sku: "CHAIR-01"
  })) {
    seen.push(data?.stockChanged);
    if (seen.length === 2) break;
  }
  return seen;
})();
// ponytail: lets the stream open before stock moves; a UI subscribes early anyway.
await new Promise((resolve) => setTimeout(resolve, 200));

show(
  "Book 5 chairs into Amsterdam",
  await client.mutation.adjustStock({
    sku: "CHAIR-01",
    warehouse: "AMS",
    delta: 5
  })
);
show(
  "Acme orders 3 chairs",
  await client.mutation.placeOrder({
    customerId: "c1",
    lines: [{ sku: "CHAIR-01", quantity: 3 }]
  })
);
console.log("\n▸ Stock changes, as the subscription saw them");
console.log(JSON.stringify(await changes));

show("Sign out", await client.mutation.logout());
