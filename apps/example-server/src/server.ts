import type { Server } from "node:http";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";

import { graphqlHandler } from "./http.js";
import { serveWebSockets, sseHandler } from "./subscriptions.js";

const hono = new Hono();
hono.on(["GET", "POST"], "/graphql", (c) =>
  c.req.header("accept")?.includes("text/event-stream")
    ? sseHandler(c.req.raw)
    : graphqlHandler(c.req.raw)
);

const port = Number(process.env.PORT ?? 4000);
const server = serve({ fetch: hono.fetch, port }, () => {
  console.log(
    `ERP GraphQL on http://localhost:${port}/graphql (ws://… for subscriptions)`
  );
});

serveWebSockets(
  new WebSocketServer({ server: server as Server, path: "/graphql" })
);
