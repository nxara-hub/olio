import type { Context, Fields } from "@nxlab/olio";
import { graphql } from "graphql";

import { app } from "./index.js";

const execute = async (source: string, ctx: Context): Promise<void> => {
  const result = await graphql({
    schema: app.schema,
    source,
    contextValue: ctx
  });
  console.log(
    JSON.stringify(result.errors?.map((e) => e.message) ?? result.data)
  );
};

const ada = { req_id: "r", userId: "1" }; // Admin
const alan = { req_id: "r", userId: "2" }; // Guest

// auth: public, "-login" opts out of the app-level requireAuth.
await execute(
  `{ login(input: { email: "ada@example.com", password: "x" }) { __typename ... on A { dataA } } }`,
  { req_id: "r" }
);

// users/profile: any signed-in user.
await execute(`{ user(id: "1") { _id name(trim: true) role } }`, {
  req_id: "r"
});
await execute(`{ user(id: "1") { _id name(trim: true) role } }`, alan);

// users/admin: admins only (the admin feature's own middleware).
await execute(`{ users { totalDocs data { name role } } }`, alan);
await execute(`mutation { setRole(id: "2", role: Admin) { name role } }`, ada);

await execute(`mutation { logout }`, ada);
