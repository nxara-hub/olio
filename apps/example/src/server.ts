import type { Server } from "node:http";

import { serve } from "@hono/node-server";
import { fetchHandler } from "@nxlab/http/fetch";
import { wsServer } from "@nxlab/http/ws";
import { Hono } from "hono";
import { WebSocketServer } from "ws";

import { createContext, createSubscriptionContext } from "./context.js";
import { app } from "./index.js";

const bearer = (header: string | null): string | undefined =>
  header?.match(/^Bearer (.+)$/)?.[1];

let streams = 0;
const graphql = fetchHandler(app, {
  context: (request) =>
    createContext(bearer(request.headers.get("authorization"))),
  subscriptionContext: (request) => {
    streams += 1;
    return createSubscriptionContext(
      `sse-${streams}`,
      bearer(request.headers.get("authorization"))
    );
  },
  // Each operation's DI scope (DataLoaders, …) is disposed once it's done.
  onOperationEnd: (ctx) => ctx.di.dispose()
});

const hono = new Hono();
hono.on(["GET", "POST"], "/graphql", (c) => graphql(c.req.raw));

const port = Number(process.env.PORT ?? 4000);
const server = serve({ fetch: hono.fetch, port }, () => {
  console.log(
    `ERP GraphQL on http://localhost:${port}/graphql (ws://… for subscriptions)`
  );
});

let connections = 0;
wsServer(
  app,
  new WebSocketServer({ server: server as Server, path: "/graphql" }),
  {
    // Browsers can't set headers on a WebSocket, so clients send the token as
    // connectionParams: createClient({ url, connectionParams: { token } }).
    context: ({ connectionParams }) => {
      connections += 1;
      const token = connectionParams?.token;
      return createSubscriptionContext(
        `ws-${connections}`,
        typeof token === "string" ? token : undefined
      );
    },
    onOperationEnd: (ctx) => ctx.di.dispose()
  }
);
