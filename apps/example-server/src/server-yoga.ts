import { createServer } from "node:http";

import type { Context } from "@nxara/olio";
import { validateOperation } from "@nxara/olio-http";
import { createYoga, type Plugin } from "graphql-yoga";
import { WebSocketServer } from "ws";

import { createContext } from "./context.js";
import { bearer } from "./http.js";
import { app } from "./index.js";
import { validationRules } from "./limits.js";
import { serveWebSockets, sseHandler } from "./subscriptions.js";

const plugin: Plugin<Context> = {
  // Yoga has its own SSE, but it would run subscriptions with `ctx`; the app's
  // graphql-sse handler builds `sub_ctx`.
  async onRequest({ request, endResponse }) {
    if (request.headers.get("accept")?.includes("text/event-stream")) {
      endResponse(await sseHandler(request));
    }
  },
  // Not onValidate: Yoga caches validation per document, and an operation's
  // cost depends on its variables.
  onParams({ params: { query, variables, operationName }, setResult }) {
    if (!query) return;
    const errors = validateOperation(
      app.schema,
      { query, variables, operationName },
      validationRules
    );
    if (errors.length) setResult({ errors });
  },
  onExecute: ({ args }) => ({
    onExecuteDone: () => args.contextValue.di.dispose()
  })
};

const yoga = createYoga<object, Context>({
  schema: app.schema,
  context: ({ request }) =>
    createContext(bearer(request.headers.get("authorization"))),
  plugins: [plugin]
});

export const server = createServer(yoga);
serveWebSockets(new WebSocketServer({ server, path: "/graphql" }));

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => {
  console.log(`ERP GraphQL on Yoga: http://localhost:${port}/graphql`);
});
